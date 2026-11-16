import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../electron/store.mjs";
import { LocalMedia, byteRange } from "../electron/local-media.mjs";
import { LibraryManager, albumIdentity } from "../electron/library-manager.mjs";
import {
  themePresets,
  validateTheme,
  validateAppearance,
  deriveTheme,
} from "../electron/themes.mjs";
import {
  importM3u,
  exportM3u,
  LibraryRelink,
} from "../electron/library-files.mjs";
import { copyFile } from "node:fs/promises";

async function fixture(t) {
  const dir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "crate-quiet-")),
  );
  const root = path.join(dir, "Music");
  await mkdir(root);
  const store = new Store(path.join(dir, "test.sqlite"));
  t.after(() => store.close());
  store.set("folders", [root]);
  const add = async (
    folder,
    title,
    artist = "Artist",
    album = "Same title",
  ) => {
    const parent = path.join(root, folder);
    await mkdir(parent, { recursive: true });
    const file = path.join(parent, `${title}.wav`);
    await writeFile(file, Buffer.from("0123456789abcdef"));
    store.track(
      {
        path: file,
        root,
        folder,
        artist,
        albumArtist: artist,
        album,
        title,
        genre: "Ambient",
        year: 1993,
        duration: 60,
        trackNumber: Number(title[0]) || 1,
        discNumber: 1,
      },
      { mtimeMs: 1, size: 16 },
    );
    return store.tracks().find((track) => track.path === file);
  };
  const media = new LocalMedia(store),
    manager = new LibraryManager(store, media);
  return { dir, root, store, add, media, manager };
}
test("presets, safe custom themes, and imported palettes enforce readable data-only colors", () => {
  for (const p of themePresets) assert.equal(validateTheme(p).id, p.id);
  const custom = deriveTheme({
    background: "#171a20",
    surface: "#242830",
    accent: "#b0c8ee",
    name: "Night",
    id: "custom-night",
  });
  assert.equal(validateTheme(custom).name, "Night");
  assert.throws(
    () => validateTheme({ ...custom, background: "url(https://example.com)" }),
    /background/,
  );
  assert.throws(
    () => validateTheme({ ...custom, text: custom.background }),
    /contrast/,
  );
  assert.throws(
    () =>
      validateAppearance({
        palette: "sage",
        custom: [{ ...custom, id: "sage" }],
        followSystem: false,
      }),
    /unique/,
  );
  assert.throws(
    () =>
      validateAppearance({
        palette: "missing",
        custom: [],
        followSystem: false,
      }),
    /existing/,
  );
  assert.equal(
    validateAppearance({
      palette: custom.id,
      custom: [custom],
      followSystem: true,
    }).lightPalette,
    "paper",
  );
});
test("stable IDs survive reopening, virtual edits remain read-only, and album editions stay distinct", async (t) => {
  const f = await fixture(t),
    a = await f.add("Original", "01 Song"),
    b = await f.add("Remaster", "01 Song");
  const before = await readFile(a.path);
  const ids = f.store.tracks().map((track) => track.id);
  assert.equal(new Set(ids).size, 2);
  assert.notEqual(albumIdentity(a), albumIdentity(b));
  f.store.track({ ...a, title: "Scanned title" }, { mtimeMs: 2, size: 16 });
  assert.equal(f.store.tracks().find((t) => t.path === a.path).id, a.id);
  f.manager.update([a.id], {
    favorite: true,
    rating: 4,
    note: "Personal",
    tags: ["Late nights"],
    overrides: { title: "Library title" },
  });
  assert.equal(
    f.manager.query({ favorite: true }).tracks[0].title,
    "Library title",
  );
  assert.equal(f.store.trackById(a.id).title, "Scanned title");
  assert.deepEqual(await readFile(a.path), before);
  assert.equal(f.manager.query({ view: "albums" }).groups.length, 2);
  assert.throws(
    () =>
      f.manager.update([a.id], { overrides: { path: "C:\\Windows\\secret" } }),
    /Invalid/,
  );
  assert.throws(() => f.manager.update([a.id], { rating: 8 }), /Invalid/);
  const second = new Store(path.join(f.dir, "test.sqlite"));
  try {
    assert.deepEqual(
      second
        .tracks()
        .map((track) => track.id)
        .sort(),
      ids.sort(),
    );
    assert.equal(
      new LibraryManager(second, f.media).query({ favorite: true }).tracks
        .length,
      1,
    );
  } finally {
    second.close();
  }
});
test("manual and smart playlists, pagination, listening history, and persisted queues remain separate", async (t) => {
  const f = await fixture(t),
    a = await f.add("Album", "02 Second"),
    b = await f.add("Album", "01 First");
  const list = f.manager.playlist({
    name: "Late nights",
    tracks: [a.id, b.id],
  });
  assert.deepEqual(
    f.manager.query({ playlist: list.id }).tracks.map((t) => t.id),
    [a.id, b.id],
  );
  assert.deepEqual(
    f.manager.query({ limit: 1, offset: 1 }).tracks.map((t) => t.id),
    [a.id],
  );
  f.manager.update([b.id], { favorite: true });
  const smart = f.manager.playlist({
    name: "Favorites",
    tracks: [],
    rule: { favorite: true },
  });
  assert.deepEqual(
    f.manager.query({ playlist: smart.id }).tracks.map((t) => t.id),
    [b.id],
  );
  f.manager.played(a.id);
  assert.equal(f.manager.query({ recent: true }).tracks[0].id, a.id);
  assert.deepEqual(f.store.histories(), []);
  const queue = {
    queue: [a.id, b.id],
    index: 1,
    position: 12,
    volume: 0.5,
    repeat: "all",
    shuffle: false,
  };
  f.manager.playback(queue);
  f.manager.query({ query: "not found" });
  assert.deepEqual(f.manager.snapshot().playback, queue);
  f.store.removeRoot(f.root);
  assert.equal(f.manager.resolve([a.id])[0].missing, true);
  assert.equal(f.manager.query({ playlist: list.id }).tracks.length, 2);
  assert.throws(
    () => f.manager.playback({ ...queue, position: Infinity }),
    /Invalid/,
  );
});
test("local media uses authenticated opaque IDs, bounded ranges, HEAD, and canonical indexed roots", async (t) => {
  const f = await fixture(t),
    a = await f.add("Album", "01 Song");
  const url = f.media.url(a.id);
  const full = await f.media.handle(new Request(url));
  assert.equal(full.status, 200);
  assert.equal(await full.text(), "0123456789abcdef");
  const range = await f.media.handle(
    new Request(url, { headers: { range: "bytes=2-5" } }),
  );
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-5/16");
  assert.equal(await range.text(), "2345");
  const head = await f.media.handle(new Request(url, { method: "HEAD" }));
  assert.equal(head.headers.get("content-length"), "16");
  assert.equal(await head.text(), "");
  assert.equal(
    (await f.media.handle(new Request(url.replace(f.media.key, "wrong"))))
      .status,
    404,
  );
  assert.equal(
    (
      await f.media.handle(
        new Request(url, { headers: { range: "bytes=999-" } }),
      )
    ).status,
    416,
  );
  assert.equal(
    (await f.media.handle(new Request(url, { method: "POST" }))).status,
    405,
  );
  const outside = path.join(f.dir, "outside.wav");
  await writeFile(outside, "private");
  f.store.track({ ...a, path: outside }, { mtimeMs: 1, size: 7 });
  const external = f.store.tracks().find((t) => t.path === outside);
  assert.equal(
    (await f.media.handle(new Request(f.media.url(external.id)))).status,
    404,
  );
  f.store.set("folders", []);
  assert.equal((await f.media.handle(new Request(url))).status, 404);
  assert.deepEqual(byteRange("bytes=-4", 16), { start: 12, end: 15 });
  for (const value of [
    "bytes=0-1,4-5",
    "bytes=-0",
    "bytes=6-2",
    "bytes=",
    "bytes=9007199254740993-",
  ])
    assert.throws(() => byteRange(value, 16));
});

test("playlist transfer reports unresolved paths; validated backups restore only library data", async (t) => {
  const f = await fixture(t),
    track = await f.add("Album", "01 Song");
  const result = importM3u(
    "#EXTM3U\nAlbum/01 Song.wav\nmissing.wav\nhttps://example.com/song.mp3",
    path.join(f.root, "Imported.m3u8"),
    f.manager,
  );
  assert.deepEqual(result.playlist.tracks, [track.id]);
  assert.equal(result.unresolved.length, 2);
  assert.match(
    exportM3u(result.playlist, f.manager),
    /#EXTINF:60,Artist - 01 Song/,
  );
  f.manager.update([track.id], {
    rating: 4,
    note: "Remember this",
    favorite: true,
  });
  f.store.set("aiKey:openai", "secret");
  const backup = f.manager.backup();
  assert.ok(!JSON.stringify(backup).includes("secret"));
  f.manager.update([track.id], { rating: 1 });
  assert.equal(f.manager.restore(backup).restored, 1);
  assert.equal(f.manager.query().tracks[0].rating, 4);
  const before = f.manager.playlists().length;
  assert.throws(
    () =>
      f.manager.restore({
        ...backup,
        tracks: [
          {
            ...backup.tracks[0],
            details: { overrides: { path: "outside.wav" } },
          },
        ],
      }),
    /Invalid/,
  );
  assert.equal(f.manager.playlists().length, before);
  f.manager.played(track.id);
  f.manager.clearListening();
  assert.equal(f.manager.query().tracks[0].playCount, 0);
  assert.equal(f.manager.query().tracks[0].rating, 4);
});

test("reviewed folder recovery preserves playlist identities without modifying either source", async (t) => {
  const f = await fixture(t),
    track = await f.add("Album", "01 Song");
  const next = path.join(f.dir, "Moved music");
  await mkdir(path.join(next, "Album"), { recursive: true });
  const file = path.join(next, "Album", "01 Song.wav");
  await copyFile(track.path, file);
  const playlist = f.manager.playlist({ name: "Keep", tracks: [track.id] });
  const relink = new LibraryRelink(f.store);
  const review = await relink.review(f.root, next);
  assert.equal(review.matched, 1);
  assert.equal(f.store.trackById(track.id).path, track.path);
  relink.apply(review.token);
  assert.equal(f.store.trackById(track.id).path, file);
  assert.deepEqual(
    f.manager.playlists().find((p) => p.id === playlist.id).tracks,
    [track.id],
  );
  assert.deepEqual(await readFile(file), await readFile(track.path));
  assert.equal(
    (await f.media.handle(new Request(f.media.url(track.id)))).status,
    200,
  );
  assert.throws(() => relink.apply(review.token), /Review/);
});
