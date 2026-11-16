import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { largeLibraryFixture } from "../scripts/large-library-fixture.mjs";
import { LibraryManager } from "../electron/library-manager.mjs";

test("folder groups start at indexed roots and locate a playing track across collection and track pages", async (t) => {
  await mkdir(".test-data", { recursive: true });
  const directory = await mkdtemp(path.resolve(".test-data/navigation-unit-"));
  const fixture = await largeLibraryFixture(directory, 1500);
  t.after(() => fixture.store.close());
  const library = new LibraryManager(fixture.store, { url: (id) => id });
  const roots = library.query({ view: "folders" });
  assert.equal(roots.total, 1);
  assert.equal(roots.groups[0].id, fixture.root);
  assert.equal(roots.groups[0].tracks.length, 1500);
  const target = fixture.store.tracks().find((t) => t.title === "Track 001499");
  const albums = library.query({
    view: "albums",
    sort: "title",
    locate: target.id,
    limit: 120,
  });
  assert.equal(albums.location.offset, 120);
  assert.ok(
    albums.groups
      .find((g) => g.id === albums.location.groupId)
      .tracks.includes(target.id),
  );
  const tracks = library.query({
    folder: fixture.root,
    sort: "artist",
    locate: target.id,
    limit: 100,
  });
  assert.equal(tracks.location.offset, 1400);
  assert.equal(tracks.tracks.at(-1).id, target.id);
  assert.equal(
    library.query({ favorite: true, locate: target.id }).location,
    undefined,
  );
  const before = await readFile(fixture.tracks[0].path);
  library.update([fixture.tracks[0].id], {
    overrides: {
      title: "Edited",
      albumArtist: "Compilation",
      genre: "Jazz",
      year: 2026,
      trackNumber: 7,
      discNumber: 2,
    },
  });
  assert.equal(library.resolve([fixture.tracks[0].id])[0].discNumber, 2);
  assert.equal(library.resolve([fixture.tracks[0].id])[0].trackNumber, 7);
  assert.throws(
    () =>
      library.update([fixture.tracks[0].id], { overrides: { discNumber: -1 } }),
    /Invalid/,
  );
  assert.deepEqual(await readFile(fixture.tracks[0].path), before);
});
