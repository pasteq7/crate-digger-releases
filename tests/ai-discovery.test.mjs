import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { Store } from "../electron/store.mjs";
import {
  AiDiscovery,
  discoveryContext,
  discoveryPrompt,
  parseSuggestions,
  discoverySchema,
} from "../electron/ai-discovery.mjs";
import { AiService } from "../electron/ai-service.mjs";
import { Discovery } from "../electron/discovery.mjs";

const root = path.resolve("private-home/music");
const track = (artist, album, genre = "Shoegaze", title = "Track") => ({
  path: path.join(root, genre, artist, album, title + ".flac"),
  root,
  folder: path.join(genre, artist, album),
  artist,
  album,
  title,
  genre,
  year: 1993,
});
const collection = [
  track("Slowdive", "Souvlaki"),
  track("Slowdive", "Souvlaki", "Shoegaze", "Alison"),
  track("Ride", "Nowhere"),
  track("Brian Eno", "Apollo", "Ambient"),
];
const suggestion = (artist, album, extra = {}) => ({
  artist,
  album,
  genre: "Shoegaze",
  year: 2019,
  reason: "The sustained guitar textures connect to your Souvlaki record.",
  basedOn: [0],
  previewTrack: "First Track",
  ...extra,
});
test("AI context is deduplicated to the current genre, includes logical folders, and excludes absolute paths", () => {
  const c = discoveryContext(collection, {}, "genre:shoegaze");
  assert.equal(c.totalAlbums, 2);
  assert.equal(c.albums.length, 2);
  assert.ok(c.albums.every((a) => a.artist !== "Brian Eno"));
  const prompt = discoveryPrompt(c, "adjacent");
  assert.ok(prompt.includes("Souvlaki"));
  assert.ok(prompt.includes("Shoegaze"));
  assert.ok(!prompt.includes(root));
  assert.ok(!prompt.includes("private-home"));
  assert.ok(!prompt.includes(".flac"));
  assert.ok(!prompt.includes("Apollo"));
  assert.equal(
    discoveryContext(collection, {}, `folder:${path.join(root, "Ambient")}`)
      .albums[0].album,
    "Apollo",
  );
  assert.throws(
    () => discoveryContext(collection, {}, "all"),
    /Choose a genre/,
  );
});
test("large contexts are bounded and balanced across artists, with relevant shelf feedback", () => {
  const tracks = Array.from({ length: 300 }, (_, i) =>
    track("Prolific", `Album ${i}`),
  );
  tracks.push(track("Rare", "Only album"));
  const c = discoveryContext(
    tracks,
    {
      a: {
        item: {
          artist: "New Artist",
          title: "Adjacent",
          genre: "Dream pop",
          discoveryScope: "genre:Shoegaze",
        },
        status: "rejected",
      },
      b: {
        item: { artist: "Other", title: "Other", genre: "Jazz" },
        status: "maybe",
      },
    },
    "genre:Shoegaze",
  );
  assert.equal(c.totalAlbums, 301);
  assert.equal(c.albums.length, 250);
  assert.ok(c.albums.some((a) => a.artist === "Rare"));
  assert.equal(c.feedback.length, 1);
  assert.equal(c.feedback[0].choice, "rejected");
});
test("AI JSON is validated, grounded in owned album IDs, deduplicated, and never trusted for URLs", () => {
  const c = discoveryContext(collection, {}, "genre:Shoegaze");
  const raw = JSON.stringify({
    recommendations: [
      suggestion("DIIV", "Deceiver", { preview: "https://untrusted/clip" }),
      suggestion("DIIV", "Deceiver (Deluxe Edition)"),
      suggestion("Ghost", "Ghost", { basedOn: [999] }),
      null,
    ],
  });
  const rows = parseSuggestions("```json\n" + raw + "\n```", c);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].preview, null);
  assert.equal(rows[0].basedOn[0].album, c.albums[0].album);
  assert.ok(rows[0].id.startsWith("album:"));
  assert.throws(() => parseSuggestions("Not JSON", c), /valid album list/);
  assert.throws(
    () => parseSuggestions('{"recommendations":[]}', c),
    /no usable suggestions/,
  );
});
test("AI discovery excludes owned and rejected albums and removes unverified suggestions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-ai-"));
  const store = new Store(path.join(dir, "db"));
  for (const t of collection) store.track(t, { mtimeMs: 1, size: 1 });
  store.shelf("old", {
    item: { artist: "Rejected", title: "Rejected Album", genre: "Shoegaze" },
    status: "rejected",
  });
  let calls = 0;
  const service = {
    generate: async (prompt, opts) => {
      calls++;
      assert.ok(prompt.includes("Souvlaki"));
      assert.deepEqual(opts.schema, discoverySchema);
      return JSON.stringify({
        recommendations: [
          suggestion("Slowdive", "Souvlaki"),
          suggestion("Rejected", "Rejected Album"),
          suggestion("DIIV", "Deceiver"),
          suggestion("Grouper", "Dragging a Dead Deer Up a Hill"),
          suggestion("Imaginary", "Not Real"),
        ],
      });
    },
  };
  const events = [];
  let finish;
  let done = new Promise((resolve) => (finish = resolve));
  const resolver = {
    generation: 0,
    resolveAlbum: async (artist) =>
      artist === "DIIV"
        ? {
            preview: "https://audio.example/clip",
            cover: "https://art.example/cover",
            previewTitle: "Skin Game",
          }
        : artist === "Grouper"
          ? {
              preview: null,
              catalogUrl: "https://musicbrainz.org/release-group/test",
            }
          : null,
  };
  const engine = new AiDiscovery(
    store,
    resolver,
    service,
    () => ({ ai: "gemini", aiModel: "test" }),
    (e) => {
      events.push(e);
      if (!e.pending) finish();
    },
  );
  const options = {
    scope: "genre:Shoegaze",
    mode: "adjacent",
    batch: 0,
    requestId: 55,
    exclude: [],
  };
  try {
    const initial = await engine.recommend(options);
    assert.equal(initial.items.length, 3);
    assert.equal(initial.pending, true);
    await done;
    const final = events.at(-1);
    assert.equal(final.items.length, 2);
    assert.deepEqual(final.stats, {
      suggested: 3,
      checked: 3,
      playable: 1,
      noPreview: 1,
      unverified: 1,
    });
    assert.ok(final.items.every((i) => i.catalogVerified));
    assert.equal(final.requestId, 55);
    done = new Promise((resolve) => (finish = resolve));
    const cached = await engine.recommend(options);
    assert.equal(cached.cached, true);
    await done;
    assert.equal(calls, 1);
  } finally {
    engine.cancel();
    store.close();
  }
});
test("canceling a context change prevents stale AI output and further catalog lookups", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-ai-cancel-"));
  const store = new Store(path.join(dir, "db"));
  store.track(collection[0], { mtimeMs: 1, size: 1 });
  let release;
  const wait = new Promise((resolve) => (release = resolve));
  let lookups = 0;
  const engine = new AiDiscovery(
    store,
    {
      generation: 0,
      resolveAlbum: async () => {
        lookups++;
        return null;
      },
    },
    { generate: async () => wait },
    () => ({ ai: "gemini", aiModel: "test" }),
    () => assert.fail("stale progress"),
  );
  try {
    const run = engine.recommend({
      scope: "genre:Shoegaze",
      mode: "safe",
      batch: 0,
      requestId: 1,
      exclude: [],
    });
    engine.cancel();
    release(
      JSON.stringify({ recommendations: [suggestion("DIIV", "Deceiver")] }),
    );
    await assert.rejects(() => run, /canceled/);
    assert.equal(lookups, 0);
  } finally {
    store.close();
  }
});
test("Gemini structured discovery responses are not truncated to explanation length", async () => {
  const original = globalThis.fetch;
  const payload = JSON.stringify({
    recommendations: Array.from({ length: 12 }, (_, i) =>
      suggestion("Artist", `Album ${i}`),
    ),
  });
  let request;
  globalThis.fetch = async (url, opts) => {
    request = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return Response.json({
      candidates: [{ content: { parts: [{ text: payload }] } }],
    });
  };
  try {
    const s = new AiService(
      () => ({ ai: "gemini", aiModel: "gemini-test" }),
      () => "secret-test-key",
    );
    assert.equal(
      await s.generate("Selected albums", { schema: discoverySchema }),
      payload,
    );
    assert.ok(payload.length > 600);
    assert.equal(
      request.body.generationConfig.responseMimeType,
      "application/json",
    );
    assert.equal(request.body.generationConfig.maxOutputTokens, 8192);
    assert.deepEqual(
      request.body.generationConfig.responseJsonSchema,
      discoverySchema,
    );
    assert.equal(request.headers["x-goog-api-key"], "secret-test-key");
    assert.ok(
      !request.body.contents[0].parts[0].text.includes("secret-test-key"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("OpenAI and Ollama use structured output without sharing cloud keys", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, opts) => {
    requests.push({
      url: String(url),
      body: JSON.parse(opts.body),
      headers: opts.headers,
    });
    return Response.json(
      String(url).includes("openai")
        ? { choices: [{ message: { content: '{"recommendations":[]}' } }] }
        : { response: '{"recommendations":[]}' },
    );
  };
  try {
    await new AiService(
      () => ({ ai: "openai", aiModel: "gpt-4.1-mini" }),
      (p) => p + "-key",
    ).generate("prompt", { schema: discoverySchema });
    await new AiService(
      () => ({
        ai: "ollama",
        aiModel: "test",
        aiEndpoint: "http://127.0.0.1:11434",
      }),
      () => assert.fail("local provider needs no key"),
    ).generate("prompt", { schema: discoverySchema });
    assert.equal(requests[0].body.response_format.type, "json_schema");
    assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].headers.Authorization, "Bearer openai-key");
    assert.deepEqual(requests[1].body.format, discoverySchema);
    assert.equal(requests[1].headers.Authorization, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
test("preview matching falls back to the album's track list without substituting another record", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-preview-"));
  const store = new Store(path.join(dir, "db"));
  const d = new Discovery(store);
  const queries = [];
  d.json = async (url) => {
    queries.push(url);
    const u = new URL(url);
    if (u.pathname === "/lookup")
      return {
        results: [
          {
            artistName: "Wrong",
            collectionName: "Wrong",
            previewUrl: "https://wrong/clip",
          },
          {
            artistName: "DIIV",
            collectionName: "Deceiver (Deluxe Edition)",
            trackName: "Skin Game",
            previewUrl: "https://right/clip",
            artworkUrl100: "https://art/100x100bb.jpg",
          },
        ],
      };
    return {
      results:
        u.searchParams.get("entity") === "album"
          ? [
              {
                artistName: "DIIV",
                collectionName: "Deceiver",
                collectionId: 42,
              },
            ]
          : [],
    };
  };
  try {
    const match = await d.resolveAlbum("DIIV", "Deceiver", "Skin Game");
    assert.equal(match.preview, "https://right/clip");
    assert.equal(match.previewTitle, "Skin Game");
    assert.equal(new URL(queries[0]).searchParams.get("limit"), "50");
    assert.ok(queries.some((u) => new URL(u).pathname === "/lookup"));
  } finally {
    store.close();
  }
});

test("changing scope stops an in-flight resolver before it schedules fallback API calls", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-preview-cancel-"));
  const store = new Store(path.join(dir, "db"));
  const d = new Discovery(store);
  let active = true,
    calls = 0;
  d.json = async () => {
    calls++;
    active = false;
    return { results: [] };
  };
  try {
    assert.equal(
      await d.resolveAlbum("Artist", "Album", "", () => active),
      null,
    );
    assert.equal(calls, 1);
  } finally {
    store.close();
  }
});
