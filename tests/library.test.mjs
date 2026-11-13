import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  unlink,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  inferTrack,
  taste,
  filterUnowned,
  albumKey,
  normalize,
  exportShelf,
} from "../electron/core.mjs";
import { Store } from "../electron/store.mjs";
import { Scanner } from "../electron/scanner.mjs";
import { Discovery } from "../electron/discovery.mjs";

function wave(tags = {}) {
  const chunk = (id, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(data.length);
    return Buffer.concat([
      Buffer.from(id),
      len,
      data,
      ...(data.length % 2 ? [Buffer.alloc(1)] : []),
    ]);
  };
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(8000, 4);
  fmt.writeUInt32LE(16000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const info = Buffer.concat([
    Buffer.from("INFO"),
    ...Object.entries(tags).map(([id, v]) => chunk(id, Buffer.from(v + "\0"))),
  ]);
  const body = Buffer.concat([
    Buffer.from("WAVE"),
    chunk("fmt ", fmt),
    chunk("LIST", info),
    chunk("data", Buffer.alloc(1600)),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, body]);
}

test("folder fallback respects disc folders, Unicode and partial tags", () => {
  const root = path.resolve("music");
  const file = path.join(
    root,
    "Slowdive",
    "1993 - Souvlaki",
    "CD1",
    "01 - Alison.flac",
  );
  const t = inferTrack(file, root, {});
  assert.equal(t.artist, "Slowdive");
  assert.equal(t.album, "Souvlaki");
  assert.equal(t.year, 1993);
  assert.equal(t.title, "Alison");
  assert.equal(t.genre, "Untagged");
  assert.equal(
    inferTrack(file, root, {
      artist: "Actual",
      album: "Tagged",
      genre: ["Shoegaze"],
    }).artist,
    "Actual",
  );
  assert.notEqual(normalize("東京"), normalize("大阪"));
  assert.equal(
    albumKey("Ride", "Nowhere (2011 Remastered Edition)"),
    albumKey("Ride", "Nowhere"),
  );
  assert.equal(
    albumKey("Björk", "Vespertine (Deluxe Edition)"),
    albumKey("Bjork", "Vespertine"),
  );
});
test("genre weights sum to track count; era and album counts are stable", () => {
  const p = taste([
    { artist: "A", album: "X", genre: "Shoegaze, Dream pop", year: 1991 },
    { artist: "A", album: "X", genre: "Ambient", year: null },
  ]);
  assert.equal(p.albums, 1);
  assert.equal(p.total, 2);
  assert.equal(
    p.genres.reduce((s, g) => s + g.count, 0),
    2,
  );
  assert.equal(p.artists[0].count, 2);
  assert.equal(p.eras.find((e) => e.name === "1990s").count, 1);
});
test("ownership and rejection filtering removes alternate editions and duplicate API records", () => {
  const tracks = [{ artist: "Slowdive", album: "Souvlaki" }];
  const rejected = {
    old: {
      item: { artist: "Ride", title: "Going Blank Again" },
      status: "rejected",
    },
  };
  const result = filterUnowned(
    [
      { id: "1", artist: "Slowdive", title: "Souvlaki (Remastered)" },
      { id: "2", artist: "Ride", title: "Going Blank Again (Deluxe)" },
      { id: "3", artist: "DIIV", title: "Deceiver" },
      { id: "4", artist: "DIIV", title: "Deceiver" },
    ],
    tracks,
    rejected,
  );
  assert.deepEqual(
    result.map((x) => x.id),
    ["3"],
  );
});
test("CSV quotes fields and neutralizes spreadsheet formulas; text stays readable", () => {
  const item = {
    artist: '=HYPERLINK("evil")',
    title: 'A, "B"',
    genre: "Rock",
    year: 1991,
    reason: "A\nB",
  };
  const csv = exportShelf([item], "csv");
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"A, ""B"""'));
  assert.ok(exportShelf([item], "txt").includes("1991"));
});
test("real tag scan is incremental, read-only, prunes deleted files, and preserves offline roots", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "crate-scan-"));
  const root = path.join(temp, "music");
  const dir = path.join(root, "Folder Artist", "1991 - Folder Album");
  await mkdir(dir, { recursive: true });
  const tagged = path.join(dir, "01 Track.wav");
  const untagged = path.join(dir, "02 Fallback.mp3");
  await writeFile(
    tagged,
    wave({
      INAM: "Real title",
      IART: "Real artist",
      IPRD: "Real album",
      IGNR: "Shoegaze",
      ICRD: "1991",
    }),
  );
  await writeFile(untagged, "malformed tags");
  const before = await readFile(tagged),
    mtime = (await stat(tagged)).mtimeMs;
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  const store = new Store(path.join(temp, "test.sqlite"));
  const events = [];
  const scanner = new Scanner(store, (p) => events.push(p));
  try {
    await scanner.scan([root]);
    assert.equal(store.tracks().length, 2);
    assert.equal(
      store.tracks().find((t) => t.path === tagged).artist,
      "Real artist",
    );
    assert.equal(
      store.tracks().find((t) => t.path === tagged).album,
      "Real album",
    );
    assert.equal(
      store.tracks().find((t) => t.path === untagged).artist,
      "Folder Artist",
    );
    assert.equal(scanner.progress.updated, 2);
    assert.ok(scanner.progress.errors <= 1);
    assert.equal(hash(await readFile(tagged)), hash(before));
    assert.equal((await stat(tagged)).mtimeMs, mtime);
    await scanner.scan([root]);
    assert.equal(scanner.progress.updated, 0);
    assert.equal(scanner.progress.checked, 2);
    await unlink(untagged);
    await scanner.scan([root]);
    assert.equal(store.tracks().length, 1);
    const offline = path.join(temp, "disconnected");
    const t = inferTrack(path.join(offline, "a.mp3"), offline);
    store.track(t, { mtimeMs: 1, size: 1 });
    await scanner.scan([offline]);
    assert.equal(store.tracks().length, 2);
    assert.ok(scanner.progress.errors > 0);
    assert.equal(events.at(-1).running, false);
    await assert.rejects(
      () => scanner.validateRoot(dir, [root]),
      /already covered/,
    );
    assert.equal(store.histories().length, 1);
  } finally {
    store.close();
  }
});
test("SQLite state, cache TTL, and shelves survive reopening; undo removes a shelf row", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-store-"));
  const file = path.join(dir, "test.sqlite");
  let s = new Store(file);
  s.set("folders", ["C:/Music"]);
  s.shelf("a", {
    item: { id: "a", artist: "A", title: "B" },
    status: "rejected",
  });
  s.cache("fresh", { answer: 42 });
  s.cache("old", { answer: 1 }, -1);
  s.close();
  s = new Store(file);
  try {
    assert.deepEqual(s.get("folders", []), ["C:/Music"]);
    assert.equal(s.shelves().a.status, "rejected");
    assert.equal(s.cached("fresh").answer, 42);
    assert.equal(s.cached("old"), undefined);
    s.shelf("a", null);
    assert.equal(Object.keys(s.shelves()).length, 0);
  } finally {
    s.close();
  }
});
test("discovery uses actual catalog results, exact preview matches, cache, and ownership filters", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-discovery-"));
  const store = new Store(path.join(dir, "test.sqlite"));
  store.track(
    {
      path: "a",
      root: "root",
      folder: "",
      artist: "Slowdive",
      album: "Souvlaki",
      title: "Alison",
      genre: "Shoegaze",
      year: 1993,
    },
    { mtimeMs: 1, size: 1 },
  );
  let requests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests++;
    const u = String(url);
    if (u.includes("musicbrainz"))
      return {
        ok: true,
        json: async () => ({
          "release-groups": [
            {
              id: "owned",
              title: "Souvlaki",
              "artist-credit": [{ name: "Slowdive" }],
            },
            {
              id: "new",
              title: "Deceiver",
              "artist-credit": [{ name: "DIIV" }],
              "first-release-date": "2019-01-01",
            },
          ],
        }),
      };
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            artistName: "DIIV",
            collectionName: "Deceiver",
            trackName: "Skin Game",
            trackId: 5,
            previewUrl: "https://audio.example/clip",
            artworkUrl100: "https://art.example/100x100bb.jpg",
          },
        ],
      }),
    };
  };
  try {
    const discovery = new Discovery(store);
    const options = {
      scope: "all",
      mode: "adjacent",
      offset: 0,
      kind: "album",
    };
    const r = await discovery.recommend(options);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].artist, "DIIV");
    assert.equal(r.items[0].preview, "https://audio.example/clip");
    assert.ok(r.items[0].cover.includes("600x600"));
    await discovery.recommend(options);
    assert.equal(requests, 2);
    store.shelf("new", { item: r.items[0], status: "rejected" });
    assert.equal((await discovery.recommend(options)).items.length, 0);
  } finally {
    globalThis.fetch = original;
    store.close();
  }
});

test("expired cached responses remain available offline", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-offline-"));
  const store = new Store(path.join(dir, "test.sqlite"));
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    store.cache("https://musicbrainz.org/test", { saved: true }, -100);
    const result = await new Discovery(store).json(
      "https://musicbrainz.org/test",
    );
    assert.deepEqual(result, { saved: true });
  } finally {
    globalThis.fetch = original;
    store.close();
  }
});

test("progressive discovery publishes hydrated previews and preserves early shelf choices", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-progress-"));
  const store = new Store(path.join(dir, "test.sqlite"));
  store.track(
    {
      path: path.resolve("music/Artist/Owned/track.mp3"),
      root: path.resolve("music"),
      folder: "Artist/Owned",
      artist: "Artist",
      album: "Owned",
      title: "Track",
      genre: "Shoegaze",
      year: 1993,
    },
    { mtimeMs: 1, size: 1 },
  );
  const original = globalThis.fetch;
  let resolvePreview;
  const gate = new Promise((resolve) => {
    resolvePreview = resolve;
  });
  globalThis.fetch = async (url) =>
    String(url).includes("musicbrainz")
      ? {
          ok: true,
          json: async () => ({
            "release-groups": [
              {
                id: "new",
                title: "New Album",
                "artist-credit": [{ name: "New Artist" }],
              },
            ],
          }),
        }
      : await gate;
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const events = [];
  try {
    const d = new Discovery(store, (data) => {
      events.push(data);
      if (!data.pending) finish();
    });
    const r = await d.recommend({
      scope: `folder:${path.resolve("music/Artist")}`,
      mode: "safe",
      offset: 0,
      kind: "album",
      requestId: 42,
    });
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].loadingPreview, true);
    store.shelf("new", { item: r.items[0], status: "wishlist" });
    resolvePreview({
      ok: true,
      json: async () => ({
        results: [
          {
            artistName: "New Artist",
            collectionName: "New Album",
            trackName: "Preview track",
            trackId: 9,
            previewUrl: "https://audio.example/preview",
            artworkUrl100: "https://art.example/100x100bb.jpg",
          },
        ],
      }),
    });
    await done;
    assert.equal(events.at(-1).requestId, 42);
    assert.equal(events.at(-1).items.length, 0);
    assert.equal(store.shelves().new.item.previewTitle, "Preview track");
    assert.equal(store.shelves().new.item.loadingPreview, false);
    assert.ok(events.at(-1).shelfUpdate);
  } finally {
    globalThis.fetch = original;
    store.close();
  }
});
