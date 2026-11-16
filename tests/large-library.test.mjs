import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { largeLibraryFixture } from "../scripts/large-library-fixture.mjs";
import { LibraryManager } from "../electron/library-manager.mjs";
import { LibraryReader } from "../electron/library-reader.mjs";
import { LocalMedia } from "../electron/local-media.mjs";
import { Store } from "../electron/store.mjs";

test("50,000-track browsing reads metadata once, caches pages, and invalidates on real changes", async (t) => {
  await mkdir(".test-data", { recursive: true });
  const profile = await mkdtemp(path.resolve(".test-data/large-unit-"));
  const fixture = await largeLibraryFixture(profile);
  t.after(() => fixture.store.close());
  const library = new LibraryManager(fixture.store, { url: (id) => id });
  let reads = 0,
    scans = 0;
  const meta = library.meta.bind(library),
    tracks = fixture.store.tracks.bind(fixture.store);
  library.meta = () => {
    reads++;
    return meta();
  };
  fixture.store.tracks = () => {
    scans++;
    return tracks();
  };
  const start = performance.now();
  const first = library.query({ view: "albums", sort: "added", limit: 120 });
  assert.equal(first.total, 5000);
  assert.equal(first.groups.length, 120);
  assert.equal(
    reads,
    1,
    "unannotated tracks must not reload the metadata table",
  );
  assert.equal(scans, 1);
  const coldMs = performance.now() - start;
  const warm = performance.now();
  const next = library.query({
    view: "albums",
    sort: "added",
    limit: 120,
    offset: 120,
  });
  library.facets();
  assert.equal(reads, 1);
  assert.equal(scans, 1);
  assert.notEqual(next.groups[0].id, first.groups[0].id);
  const warmMs = performance.now() - warm;
  fixture.store.set("playback", { position: 7 });
  library.query({ view: "albums", sort: "added", limit: 120 });
  assert.equal(
    reads,
    1,
    "playback/settings writes must not rebuild the collection",
  );
  library.update([fixture.tracks[1].id], { favorite: true });
  assert.equal(library.query({ favorite: true }).total, 5001);
  assert.equal(scans, 1, "a heart change must reuse decoded track metadata");
  library.playlist({ name: "One", tracks: [fixture.tracks[0].id] });
  const before = reads;
  library.query({ view: "albums" });
  assert.equal(reads, before);
  fixture.store.removeRoot(fixture.root);
  assert.equal(library.query({ view: "albums" }).total, 0);
  console.log(
    JSON.stringify({
      catalogTracks: 50000,
      coldMs: Math.round(coldMs),
      warmPageAndFacetsMs: Math.round(warmMs),
      metadataReadsForInitialBrowse: 1,
    }),
  );
  assert.ok(
    coldMs < 10000,
    "cold browsing must finish within a generous CI budget",
  );
});

test("background collection reader keeps the event loop responsive and observes committed WAL edits", async (t) => {
  const profile = await mkdtemp(path.resolve(".test-data/large-worker-"));
  const fixture = await largeLibraryFixture(profile);
  const reader = new LibraryReader(fixture.file, "test-key");
  t.after(async () => {
    await reader.close();
    fixture.store.close();
  });
  let ticks = 0;
  const interval = setInterval(() => ticks++, 5);
  const [albums, facets] = await Promise.all([
    reader.query({ view: "albums", sort: "added", limit: 120 }),
    reader.facets(),
  ]);
  clearInterval(interval);
  assert.equal(albums.total, 5000);
  assert.equal(facets.artists.length, 1000);
  assert.ok(
    ticks > 3,
    "catalog decoding/sorting must run off the caller event loop",
  );
  const manager = new LibraryManager(fixture.store, { url: (id) => id });
  const id = fixture.tracks[1].id;
  manager.update([id], { favorite: true, overrides: { year: 2026 } });
  assert.equal(
    (await reader.query({ favorite: true, year: 2026 })).tracks[0].id,
    id,
  );
  assert.ok((await reader.facets()).years.includes(2026));
  const resolved = await reader.resolve(fixture.tracks.map((t) => t.id));
  assert.equal(resolved.length, 12);
  assert.equal(resolved[1].favorite, true);
  assert.ok(resolved.every((t) => !t.missing));
  assert.match(resolved[0].mediaUrl, /key=test-key$/);
  await reader.worker.terminate();
  assert.equal(
    (await reader.query({ view: "albums", limit: 1 })).total,
    5000,
    "a later request restarts an interrupted reader",
  );
  // Read-only workers cannot alter credentials, preferences, or indexed files.
  const readonly = new Store(fixture.file, { readOnly: true });
  assert.throws(() => readonly.set("aiKey", "bad"), /readonly/i);
  readonly.close();
  await reader.close();
  await assert.rejects(reader.query({}), /closed/);
});

test("artwork requests are deduplicated and concurrency stays bounded", async () => {
  const media = new LocalMedia({});
  let active = 0,
    peak = 0,
    reads = 0;
  media.loadCover = async () => {
    reads++;
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return null;
  };
  await Promise.all(
    Array.from({ length: 120 }, (_, i) => media.cover(String(i % 40))),
  );
  assert.equal(reads, 40);
  assert.ok(peak <= 4);
  assert.equal(media.coverPending.size, 0);
});
