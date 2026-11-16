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
import { pathToFileURL } from "node:url";
import { LikedImport } from "../electron/liked-import.mjs";
import { artworkColor } from "../electron/artwork-color.mjs";

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
test("dominant artwork colors ignore transparency and retain readable dark surfaces", () => {
  assert.equal(
    artworkColor(
      Buffer.from([
        128, 154, 16, 255, 128, 154, 16, 255, 255, 255, 255, 255, 0, 0, 255, 0,
      ]),
    ),
    "rgb(7, 64, 53)",
  );
  assert.equal(artworkColor(Buffer.from([0, 0, 255, 0])), null);
  assert.equal(
    artworkColor(Buffer.from([255, 255, 255, 255])),
    "rgb(64, 64, 64)",
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

test("liked playlist imports are reviewed, deduplicated, additive, and refresh only remembered exports", async (t) => {
  const f = await fixture(t);
  const a = await f.add("Album", "01 Étoile");
  const b = await f.add("Album", "02 Song");
  const local = await f.add("Other", "03 Local like");
  f.manager.update([a.id], { rating: 4, note: "Keep this" });
  f.manager.update([local.id], { favorite: true });
  const service = new LikedImport(f.manager);
  const file = path.join(f.root, "MusicBee loved.m3u8");
  const text = `\uFEFF#EXTM3U\nAlbum/01 Étoile.wav\n${pathToFileURL(a.path)}\nmissing.wav\nhttps://example.com/music.mp3\n`;
  await writeFile(file, text);
  const before = await readFile(a.path);
  const plan = await service.review(file);
  assert.equal(plan.matched, 1);
  assert.equal(plan.alreadyLiked, 0);
  assert.equal(plan.unresolved, 2);
  assert.equal(
    f.manager.query({ favorite: true }).total,
    1,
    "review does not mutate likes",
  );
  assert.throws(() => service.apply("forged", true), /expired/);
  assert.deepEqual(service.apply(plan.token, true), {
    imported: 1,
    skipped: 0,
  });
  assert.throws(() => service.apply(plan.token, true), /expired/);
  const source = service.sources()[0];
  assert.equal(source.file, file);
  assert.equal(f.manager.resolve([a.id])[0].rating, 4);
  assert.equal(f.manager.resolve([a.id])[0].note, "Keep this");
  assert.equal(
    f.manager.playlists().length,
    0,
    "likes import does not create a playlist",
  );
  await writeFile(file, `#EXTM3U\n${b.path}\n`);
  const refresh = await service.refresh(source.id);
  assert.equal(refresh.matched, 1);
  assert.equal(f.manager.resolve([b.id])[0].favorite, false);
  service.apply(refresh.token, true);
  assert.equal(service.sources().length, 1);
  assert.equal(
    f.manager.query({ favorite: true }).total,
    3,
    "removing an exported entry preserves local likes",
  );
  service.remove(source.id);
  await assert.rejects(service.refresh(source.id), /not found/);
  await assert.rejects(service.refresh(file), /not found/);
  assert.equal(f.manager.query({ favorite: true }).total, 3);
  assert.deepEqual(await readFile(a.path), before);
});

test("liked imports reject invalid exports, expired plans, and missing matches without mutations", async (t) => {
  const f = await fixture(t);
  const track = await f.add("Album", "01 Song");
  const file = path.join(f.root, "foobar.m3u8");
  const service = new LikedImport(f.manager);
  await writeFile(file, "missing.wav");
  const empty = await service.review(file);
  assert.throws(() => service.apply(empty.token, true), /No indexed/);
  assert.equal(service.sources().length, 0);
  await writeFile(file, `${track.path}\n`);
  const plan = await service.review(file);
  service.plans.get(plan.token).expires = 0;
  assert.throws(() => service.apply(plan.token, false), /expired/);
  await writeFile(file, Buffer.from([0xff, 0xfe, 0x41, 0x00]));
  await assert.rejects(service.review(file), /UTF-8/);
  await writeFile(file, "#EXTM3U\0");
  await assert.rejects(service.review(file), /UTF-8/);
  await writeFile(file, "a".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(service.review(file), /too large/);
  await assert.rejects(service.review(path.join(f.root, "database.db")), /M3U/);
  assert.equal(f.manager.query({ favorite: true }).total, 0);
});

test("liked playback scopes combine artist, album, genre and year, with stable pagination", async (t) => {
  const f = await fixture(t);
  const a = await f.add("First", "01 Favorite", "Artist A", "First");
  const b = await f.add("First", "02 Other", "Artist A", "First");
  const c = await f.add("Second", "01 Favorite", "Artist B", "Second");
  f.manager.update([a.id, c.id], { favorite: true });
  f.manager.update([c.id], {
    overrides: { genre: "Rock; Shoegaze", year: 2001 },
  });
  assert.deepEqual(f.manager.facets(), {
    artists: ["Artist A", "Artist B"],
    years: [2001, 1993],
    genres: ["Ambient", "Rock", "Shoegaze"],
  });
  for (const options of [
    { artist: "Artist A" },
    { album: albumIdentity(a) },
    { year: 1993 },
    { genre: "Ambient" },
    { genre: "Ambient", year: 1993, artist: "Artist A" },
  ]) {
    assert.deepEqual(
      f.manager.query({ ...options, favorite: true }).tracks.map((t) => t.id),
      [a.id],
    );
  }
  assert.equal(
    f.manager.query({
      favorite: true,
      genre: "Shoegaze",
      artist: "Artist B",
      year: 1993,
    }).total,
    0,
  );
  const groups = f.manager.query({ view: "albums", favorite: true });
  assert.equal(groups.total, 2);
  assert.ok(groups.groups.every((g) => g.tracks.length === 1));
  const ids = [0, 1].flatMap((offset) =>
    f.manager
      .query({ favorite: true, limit: 1, offset })
      .tracks.map((t) => t.id),
  );
  assert.deepEqual(new Set(ids), new Set([a.id, c.id]));
  assert.ok(!ids.includes(b.id));
});
