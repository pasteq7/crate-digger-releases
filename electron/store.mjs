import { DatabaseSync } from "node:sqlite";
import { albumKey, normalize, trackKey } from "./identity.mjs";

export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tracks (path TEXT PRIMARY KEY, root TEXT, mtime REAL, size INTEGER, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER);
      CREATE TABLE IF NOT EXISTS shelves (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history (day TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    // Keep earlier saved finds when retiring the second-listen shelf.
    for (const [id, entry] of Object.entries(this.shelves())) {
      if (entry.status === "maybe")
        this.shelf(id, { ...entry, status: "wishlist" });
    }
  }
  get(key, fallback) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key, value) {
    this.db
      .prepare("INSERT OR REPLACE INTO meta VALUES (?,?)")
      .run(key, JSON.stringify(value));
  }
  tracks() {
    return this.db
      .prepare("SELECT data FROM tracks")
      .all()
      .map((r) => JSON.parse(r.data));
  }
  files() {
    return new Map(
      this.db
        .prepare("SELECT path,mtime,size FROM tracks")
        .all()
        .map((r) => [r.path, r]),
    );
  }
  track(track, stat) {
    this.db
      .prepare("INSERT OR REPLACE INTO tracks VALUES (?,?,?,?,?)")
      .run(
        track.path,
        track.root,
        stat.mtimeMs,
        stat.size,
        JSON.stringify(track),
      );
  }
  prune(root, seen) {
    const remove = this.db.prepare("DELETE FROM tracks WHERE path=?");
    this.db.exec("BEGIN");
    try {
      for (const r of this.db
        .prepare("SELECT path FROM tracks WHERE root=?")
        .all(root))
        if (!seen.has(r.path)) remove.run(r.path);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  removeRoot(root) {
    this.db.prepare("DELETE FROM tracks WHERE root=?").run(root);
  }
  shelves() {
    return Object.fromEntries(
      this.db
        .prepare("SELECT id,data FROM shelves")
        .all()
        .map((r) => [r.id, JSON.parse(r.data)]),
    );
  }
  shelf(id, value) {
    if (value)
      this.db
        .prepare("INSERT OR REPLACE INTO shelves VALUES (?,?)")
        .run(id, JSON.stringify(value));
    else this.db.prepare("DELETE FROM shelves WHERE id=?").run(id);
  }
  reconcileWishlist() {
    const tracks = this.tracks();
    const albums = new Set(tracks.map((t) => albumKey(t.artist, t.album)));
    const songs = new Set(tracks.map((t) => trackKey(t.artist, t.title)));
    const artists = new Set(tracks.map((t) => normalize(t.artist)));
    let removed = 0;
    for (const [id, entry] of Object.entries(this.shelves())) {
      if (entry.status !== "wishlist") continue;
      const item = entry.item;
      const owned =
        item.kind === "artist"
          ? artists.has(normalize(item.artist))
          : item.kind === "track"
            ? songs.has(trackKey(item.artist, item.title))
            : albums.has(albumKey(item.artist, item.album || item.title));
      if (owned) {
        this.shelf(id, null);
        removed++;
      }
    }
    return removed;
  }
  cached(key) {
    const row = this.db
      .prepare("SELECT value,expires FROM cache WHERE key=?")
      .get(key);
    return row && row.expires > Date.now() ? JSON.parse(row.value) : undefined;
  }
  stale(key) {
    const row = this.db.prepare("SELECT value FROM cache WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : undefined;
  }
  cache(key, value, ttl = 7 * 86400000) {
    this.db
      .prepare("INSERT OR REPLACE INTO cache VALUES (?,?,?)")
      .run(key, JSON.stringify(value), Date.now() + ttl);
  }
  history(profile) {
    this.db
      .prepare("INSERT OR REPLACE INTO history VALUES (?,?)")
      .run(new Date().toISOString().slice(0, 10), JSON.stringify(profile));
  }
  histories() {
    return this.db
      .prepare("SELECT day,data FROM history ORDER BY day DESC LIMIT 30")
      .all()
      .reverse()
      .map((r) => ({ day: r.day, ...JSON.parse(r.data) }));
  }
  close() {
    this.db.close();
  }
}
