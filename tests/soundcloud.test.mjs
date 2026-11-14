import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SoundCloud,
  soundcloudUrl,
  soundcloudSearchUrl,
} from "../electron/soundcloud.mjs";
import {
  parseSuggestions,
  discoveryPrompt,
  AiDiscovery,
} from "../electron/ai-discovery.mjs";
import { filterUnowned } from "../electron/core.mjs";
import { Discovery } from "../electron/discovery.mjs";

const storeFor = () => {
  const cache = new Map();
  return {
    cached: (key) => cache.get(key),
    cache: (key, value) => cache.set(key, value),
    shelves: () => ({}),
    tracks: () => [
      {
        artist: "Seed Artist",
        album: "Seed Album",
        title: "Seed Song",
        genre: "Dub",
        root: "C:/Music",
        folder: "Dub/Seed Artist/Seed Album",
        path: "C:/Music/Dub/Seed Artist/Seed Album/song.flac",
      },
    ],
  };
};
const row = (extra = {}) => ({
  kind: "track",
  title: "Niche Single",
  metadata_artist: "Niche Artist",
  permalink_url: "https://soundcloud.com/niche-artist/niche-single",
  sharing: "public",
  access: "playable",
  user: {
    username: "Niche Artist",
    permalink_url: "https://soundcloud.com/niche-artist",
  },
  genre: "Dub",
  ...extra,
});
const context = {
  label: "Dub",
  albums: [{ id: 0, artist: "Seed Artist", album: "Seed Album" }],
};
const suggestion = (extra = {}) => ({
  artist: "Niche Artist",
  album: "Niche Single",
  genre: "Dub",
  year: 2026,
  reason: "Shares Seed Album's sparse production and dub rhythms.",
  basedOn: [0],
  previewTrack: "",
  releaseType: "track",
  sourceId: null,
  ...extra,
});

test("SoundCloud URLs accept public track/set/share links, strip tracking and reject foreign hosts or private paths", () => {
  assert.equal(
    soundcloudUrl("https://www.soundcloud.com/artist/track?si=tracking"),
    "https://soundcloud.com/artist/track",
  );
  assert.equal(
    soundcloudUrl("https://soundcloud.com/artist/sets/an-ep"),
    "https://soundcloud.com/artist/sets/an-ep",
  );
  assert.equal(
    soundcloudUrl("https://on.soundcloud.com/Share123?si=tracking"),
    "https://on.soundcloud.com/Share123",
  );
  for (const url of [
    "file:///music",
    "javascript:alert(1)",
    "http://soundcloud.com/artist/track",
    "https://soundcloud.com.evil.test/artist/track",
    "https://user:pass@soundcloud.com/artist/track",
    "https://soundcloud.com:444/artist/track",
    "https://soundcloud.com/artist",
    "https://soundcloud.com/artist/track/s-private",
    "https://soundcloud.com/search/tracks",
    "https://soundcloud.com/artist/sets",
    "https://soundcloud.com/artist/%2fetc",
    "https://on.soundcloud.com/share/more",
  ])
    assert.equal(soundcloudUrl(url), null, url);
  assert.equal(
    new URL(soundcloudSearchUrl("Niche & Artist", "A Track")).searchParams.get(
      "q",
    ),
    "Niche & Artist A Track",
  );
});
test("manual resolution validates oEmbed without credentials and never uses supplied HTML as app code", async () => {
  let calls = 0;
  const service = new SoundCloud(
    storeFor(),
    () => null,
    () => assert.fail("No credentials needed"),
    async (url) => {
      calls++;
      assert.equal(new URL(url).hostname, "soundcloud.com");
      return Response.json({
        provider_name: "SoundCloud",
        title: "Niche Single by Niche Artist",
        author_name: "Niche Artist",
        html: '<script src="https://evil.test/"></script>',
      });
    },
  );
  const result = await service.resolve(
    "https://soundcloud.com/niche-artist/niche-single?si=ignored",
  );
  assert.equal(result.url, "https://soundcloud.com/niche-artist/niche-single");
  assert.equal(result.confirmed, false);
  assert.equal("html" in result, false);
  await service.resolve(result.url);
  assert.equal(calls, 1);
  await assert.rejects(
    service.resolve("https://evil.test/artist/song"),
    /public SoundCloud/,
  );
});
test("short SoundCloud shares resolve only to canonical SoundCloud resources", async () => {
  let target = "https://soundcloud.com/niche-artist/niche-single?si=removed";
  const service = new SoundCloud(
    storeFor(),
    () => null,
    () => {},
    async (url) =>
      new URL(url).hostname === "on.soundcloud.com"
        ? new Response("", { status: 302, headers: { location: target } })
        : Response.json({ provider_name: "SoundCloud", title: "Niche Single" }),
  );
  assert.equal(
    (await service.resolve("https://on.soundcloud.com/share123")).url,
    "https://soundcloud.com/niche-artist/niche-single",
  );
  target = "https://evil.test/private";
  await assert.rejects(
    service.resolve("https://on.soundcloud.com/share456"),
    /full soundcloud.com/,
  );
});
test("SoundCloud search reuses encrypted-store tokens across instances, caches searches and retains only public upload URLs", async () => {
  const store = storeFor();
  let auth = { clientId: "dummy-client-id", clientSecret: "dummy-secret" };
  let tokenCalls = 0,
    searchCalls = 0;
  const request = async (url, options) => {
    const u = new URL(url);
    if (u.hostname === "secure.soundcloud.com") {
      tokenCalls++;
      assert.equal(
        options.headers.Authorization,
        `Basic ${Buffer.from("dummy-client-id:dummy-secret").toString("base64")}`,
      );
      assert.equal(
        new URLSearchParams(options.body).get("grant_type"),
        "client_credentials",
      );
      return Response.json({
        access_token: "dummy-access",
        refresh_token: "dummy-refresh",
        expires_in: 3600,
      });
    }
    searchCalls++;
    assert.equal(options.headers.Authorization, "OAuth dummy-access");
    assert.equal(url.includes("dummy-secret"), false);
    return Response.json({
      collection:
        u.pathname === "/tracks"
          ? [
              row(),
              row({ access: "blocked" }),
              row({ sharing: "private" }),
              row({ permalink_url: "https://evil.test/track" }),
            ]
          : [
              row({
                kind: "playlist",
                playlist_type: "ep",
                title: "Niche EP",
                track_count: 4,
                permalink_url:
                  "https://soundcloud.com/niche-artist/sets/niche-ep",
              }),
            ],
    });
  };
  const service = new SoundCloud(
    store,
    () => auth,
    (value) => {
      auth = value;
    },
    request,
  );
  const results = await service.discover({
    label: "Dub",
    albums: [{ genre: "Dub" }],
  });
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((item) => item.releaseType),
    ["track", "ep"],
  );
  assert.equal(results[1].trackCount, 4);
  assert.equal(tokenCalls, 1);
  assert.equal(searchCalls, 2);
  const again = new SoundCloud(
    store,
    () => auth,
    (value) => {
      auth = value;
    },
    request,
  );
  assert.equal(
    (
      await again.search({
        artist: "Niche Artist",
        title: "Niche Single",
        kind: "track",
      })
    )[0].closeMatch,
    true,
  );
  assert.equal(tokenCalls, 1);
  assert.equal(searchCalls, 3);
  await again.search({
    artist: "Niche Artist",
    title: "Niche Single",
    kind: "track",
  });
  assert.equal(searchCalls, 3);
});
test("SoundCloud refreshes once after an expired token and reports quota/auth/network failures without secrets", async () => {
  let auth = {
    clientId: "dummy-id",
    clientSecret: "dummy-secret",
    token: {
      accessToken: "old-access",
      refreshToken: "single-use-refresh",
      expires: Date.now() + 3600000,
    },
  };
  let refreshes = 0;
  const service = new SoundCloud(
    storeFor(),
    () => auth,
    (value) => {
      auth = value;
    },
    async (url, options) => {
      if (new URL(url).hostname === "secure.soundcloud.com") {
        refreshes++;
        assert.equal(
          new URLSearchParams(options.body).get("refresh_token"),
          "single-use-refresh",
        );
        return Response.json({
          access_token: "new-access",
          refresh_token: "next-refresh",
          expires_in: 3600,
        });
      }
      return options.headers.Authorization === "OAuth old-access"
        ? Response.json({}, { status: 401 })
        : Response.json({ collection: [row()] });
    },
  );
  await service.search({
    artist: "Niche Artist",
    title: "Niche Single",
    kind: "track",
  });
  assert.equal(refreshes, 1);
  assert.equal(auth.token.refreshToken, "next-refresh");
  for (const status of [403, 429, 500]) {
    const failed = new SoundCloud(
      storeFor(),
      () => auth,
      () => {},
      async () => Response.json({ error: "dummy-secret" }, { status }),
    );
    await assert.rejects(failed.searchQuery("Dub"), (error) => {
      assert.equal(error.message.includes("dummy-secret"), false);
      assert.match(
        error.message,
        status === 429
          ? /rate limit/
          : status === 403
            ? /denied/
            : /unavailable/,
      );
      return true;
    });
  }
  const removed = new SoundCloud(
    storeFor(),
    () => null,
    () => assert.fail("Must not restore credentials"),
  );
  await assert.rejects(removed.searchQuery("Dub"), /app credentials/);
});
test("AI track and EP parsing uses actual SoundCloud identities and ignores model URLs and invalid source IDs", () => {
  const upload = {
    url: "https://soundcloud.com/niche-artist/niche-single",
    title: "Niche Single",
    artist: "Niche Artist",
    kind: "track",
    releaseType: "track",
    confirmed: true,
  };
  const items = parseSuggestions(
    JSON.stringify({
      recommendations: [
        suggestion({
          sourceId: 0,
          artist: "Invented",
          album: "Invented",
          soundcloud: "https://evil.test",
        }),
        suggestion({ sourceId: 100 }),
        suggestion({ album: "Niche EP", releaseType: "ep" }),
      ],
    }),
    context,
    [upload],
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].artist, "Niche Artist");
  assert.equal(items[0].kind, "track");
  assert.equal(items[0].album, undefined);
  assert.equal(items[0].soundcloud.url, upload.url);
  assert.equal(items[1].releaseType, "ep");
  assert.equal(items[1].kind, "album");
  assert.match(
    discoveryPrompt(context, "safe", [], 0, "", [upload]),
    /SOUNDCLOUD_CANDIDATES:.*sourceId/,
  );
});
test("SoundCloud-only AI recommendations remain verified without any mainstream catalog lookup", async () => {
  const upload = {
    url: "https://soundcloud.com/niche-artist/niche-single",
    title: "Niche Single",
    artist: "Niche Artist",
    kind: "track",
    releaseType: "track",
    confirmed: true,
  };
  let complete;
  const done = new Promise((resolve) => {
    complete = resolve;
  });
  let soundcloudCalls = 0;
  const engine = new AiDiscovery(
    storeFor(),
    {
      generation: 0,
      resolveAlbum: () => assert.fail("Must not require a mainstream album"),
      resolveTrack: () => assert.fail("Must not require a mainstream track"),
    },
    {
      generate: async (prompt) => {
        assert.match(
          prompt,
          /https:\/\/soundcloud.com\/niche-artist\/niche-single/,
        );
        return JSON.stringify({
          recommendations: [suggestion({ sourceId: 0 })],
        });
      },
    },
    () => ({ ai: "gemini", aiModel: "test" }),
    (event) => {
      if (!event.pending) complete(event);
    },
    {
      discover: async () => {
        soundcloudCalls++;
        return [upload];
      },
    },
  );
  await engine.recommend({
    scope: "genre:Dub",
    mode: "safe",
    batch: 0,
    requestId: 1,
    exclude: [],
    soundcloud: true,
  });
  const final = await done;
  assert.equal(soundcloudCalls, 1);
  assert.equal(final.items[0].catalogVerified, true);
  assert.equal(final.items[0].soundcloud.url, upload.url);
  assert.equal(final.stats.unverified, 0);
});
test("track ownership and shelves preserve same-artist singles and distinguish tracks from albums", () => {
  const tracks = [
    { artist: "Niche Artist", album: "Owned Album", title: "Owned Song" },
  ];
  const shelves = {
    hidden: {
      status: "rejected",
      item: { kind: "track", artist: "Niche Artist", title: "Hidden Song" },
    },
  };
  const items = ["Owned Song", "Hidden Song", "New Single"].map((title) => ({
    id: title,
    kind: "track",
    artist: "Niche Artist",
    title,
  }));
  items.push({
    id: "prefixed-owned",
    kind: "track",
    artist: "Niche Artist",
    title: "Niche Artist - Owned Song",
  });
  items.push({
    id: "different-type",
    kind: "album",
    artist: "Niche Artist",
    title: "Hidden Song",
  });
  assert.deepEqual(
    filterUnowned(items, tracks, shelves).map((item) => item.id),
    ["New Single", "different-type"],
  );
});
test("canceling SoundCloud candidate lookup prevents a subsequent AI request", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const engine = new AiDiscovery(
    storeFor(),
    { generation: 0 },
    { generate: () => assert.fail("Canceled discovery must not call AI") },
    () => ({ ai: "gemini", aiModel: "test" }),
    () => {},
    { discover: () => waiting },
  );
  const run = engine.recommend({
    scope: "genre:Dub",
    mode: "safe",
    batch: 0,
    requestId: 1,
    exclude: [],
    soundcloud: true,
  });
  engine.cancel();
  release([]);
  await assert.rejects(run, /canceled/);
});
test("individual track previews require matching artist and song, never a made-up parent album", async () => {
  const discovery = new Discovery(storeFor());
  discovery.json = async () => ({
    results: [
      {
        artistName: "Wrong Artist",
        trackName: "Niche Single",
        previewUrl: "https://wrong.test/preview",
      },
      {
        artistName: "Niche Artist",
        trackName: "Niche Single",
        collectionName: "Unrelated Album",
        previewUrl: "https://right.test/preview",
      },
    ],
  });
  const result = await discovery.resolveTrack("Niche Artist", "Niche Single");
  assert.equal(result.preview, "https://right.test/preview");
});
