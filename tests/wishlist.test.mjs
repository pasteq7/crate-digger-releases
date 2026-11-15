import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../electron/store.mjs";
import { Scanner } from "../electron/scanner.mjs";
import { LibraryWatcher } from "../electron/library-watcher.mjs";
import { rankByFeedback } from "../electron/core.mjs";

test("previous Maybe choices migrate to Wishlist without losing record metadata", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-migration-"));
  const file = path.join(dir, "library.sqlite");
  let store = new Store(file);
  const entry = {
    item: {
      id: "saved",
      title: "Album",
      artist: "Artist",
      sourceFolder: "Jazz",
    },
    status: "maybe",
    added: "2026-01-01",
  };
  store.shelf("saved", entry);
  store.close();
  store = new Store(file);
  try {
    assert.deepEqual(store.shelves().saved, { ...entry, status: "wishlist" });
  } finally {
    store.close();
  }
});

test("a newly added folder is detected, scanned, and clears only owned Wishlist matches", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crate-watched-"));
  const root = path.join(dir, "music");
  await mkdir(root);
  const store = new Store(path.join(dir, "library.sqlite"));
  const save = (id, artist, title, kind = "album", status = "wishlist") =>
    store.shelf(id, {
      item: { id, artist, title, kind },
      status,
      added: new Date().toISOString(),
    });
  save("album", "Bjork", "Vespertine (Deluxe Edition)");
  save("track", "Björk", "Hidden Place", "track");
  save("other-track", "Björk", "Undo", "track");
  save("same-title", "Other Artist", "Vespertine");
  save("other-album", "Björk", "Post");
  save("feedback", "Björk", "Vespertine", "album", "rejected");
  const scanner = new Scanner(store, () => {});
  await scanner.scan([root]);
  assert.equal(Object.keys(store.shelves()).length, 6);
  let timer;
  const finished = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Folder change was not indexed")),
      8000,
    );
    scanner.emit = (progress) => {
      if (!progress.running && progress.checked) resolve(progress);
    };
  });
  const watcher = new LibraryWatcher({
    scan: () => scanner.scan([root]),
    running: () => scanner.running,
    enabled: () => true,
    delay: 80,
  });
  watcher.setRoots([root]);
  try {
    const album = path.join(root, "Björk", "2001 - Vespertine");
    await mkdir(album, { recursive: true });
    await writeFile(
      path.join(album, "01 Hidden Place.mp3"),
      "fallback metadata",
    );
    const progress = await finished;
    assert.equal(progress.wishlistRemoved, 2);
    assert.deepEqual(Object.keys(store.shelves()).sort(), [
      "feedback",
      "other-album",
      "other-track",
      "same-title",
    ]);
    assert.equal(store.tracks()[0].album, "Vespertine");
    watcher.setRoots([]);
    assert.equal(watcher.watchers.size, 0);
  } finally {
    clearTimeout(timer);
    watcher.close();
    store.close();
  }
});

test("negative feedback lowers similar catalog finds without banning the genre; restoring removes the signal", () => {
  const items = [
    { id: "a", genre: "Shoegaze" },
    { id: "b", genre: "Ambient" },
    { id: "c", genre: "Shoegaze" },
  ];
  const shelves = {
    reject: { status: "rejected", item: { genre: "Shoegaze" } },
  };
  assert.deepEqual(
    rankByFeedback(items, shelves).map((i) => i.id),
    ["b", "a", "c"],
  );
  shelves.keep = { status: "wishlist", item: { genre: "Shoegaze" } };
  assert.deepEqual(rankByFeedback(items, shelves), items);
  assert.deepEqual(rankByFeedback(items, {}), items);
});

test("feedback distinguishes artists even when catalog finds share the query genre", () => {
  const items = [
    { artist: "Ride", genre: "Shoegaze" },
    { artist: "DIIV", genre: "Shoegaze" },
  ];
  const shelves = {
    hidden: { status: "rejected", item: { artist: "Ride", genre: "Shoegaze" } },
  };
  assert.deepEqual(
    rankByFeedback(items, shelves).map((item) => item.artist),
    ["DIIV", "Ride"],
  );
  assert.deepEqual(rankByFeedback(items, {}), items);
});

test("folder watching coalesces changes, respects the cooldown and stops when disabled", async () => {
  let enabled = true,
    scans = 0;
  const watcher = new LibraryWatcher({
    scan: async () => {
      scans++;
    },
    running: () => false,
    enabled: () => enabled,
    delay: 10,
    minInterval: 150,
  });
  try {
    watcher.schedule();
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(scans, 1);
    for (let i = 0; i < 10; i++) watcher.schedule();
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(scans, 1);
    enabled = false;
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(scans, 1);
    enabled = true;
    watcher.schedule();
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(scans, 2);
    watcher.schedule();
    watcher.setRoots([]);
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(scans, 2);
  } finally {
    watcher.close();
  }
});
