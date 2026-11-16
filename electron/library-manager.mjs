import path from "node:path";
import { randomUUID } from "node:crypto";

const short = (value, max = 250) =>
  typeof value === "string" && value.length <= max;
export function albumIdentity(track) {
  return JSON.stringify([
    track.root,
    track.folder,
    track.albumArtist || track.artist,
    track.album,
  ]);
}
export const orderTracks = (a, b) =>
  (a.discNumber || 1) - (b.discNumber || 1) ||
  (a.trackNumber || 0) - (b.trackNumber || 0) ||
  a.path.localeCompare(b.path, undefined, { numeric: true });
export class LibraryManager {
  constructor(store, media) {
    this.store = store;
    this.media = media;
  }
  playlists() {
    return this.store.db
      .prepare("SELECT data FROM playlists")
      .all()
      .map((r) => JSON.parse(r.data));
  }
  meta() {
    return Object.fromEntries(
      this.store.db
        .prepare("SELECT id,data FROM library_meta")
        .all()
        .map((r) => [r.id, JSON.parse(r.data)]),
    );
  }
  decorate(track, meta) {
    const data = meta?.[track.id] || this.meta()[track.id] || {};
    return {
      ...track,
      ...data.overrides,
      favorite: !!data.favorite,
      rating: data.rating || 0,
      tags: data.tags || [],
      note: data.note || "",
      playCount: data.playCount || 0,
      lastPlayed: data.lastPlayed || null,
      cover: this.media.url(track.id, "cover"),
      mediaUrl: this.media.url(track.id),
    };
  }
  tracks() {
    const meta = this.meta();
    return this.store.tracks().map((t) => this.decorate(t, meta));
  }
  facets() {
    const tracks = this.tracks();
    return {
      artists: [
        ...new Set(
          tracks.flatMap((t) => [t.artist, t.albumArtist].filter(Boolean)),
        ),
      ].sort((a, b) => a.localeCompare(b)),
      years: [...new Set(tracks.map((t) => t.year).filter(Boolean))].sort(
        (a, b) => b - a,
      ),
      genres: [
        ...new Set(
          tracks.flatMap((t) =>
            t.genre
              .split(/[,;/]/)
              .map((g) => g.trim())
              .filter(Boolean),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    };
  }
  snapshot() {
    return {
      playlists: this.playlists(),
      playback: this.store.get("playback", null),
    };
  }
  query(options = {}) {
    if (
      !options ||
      typeof options !== "object" ||
      (options.query !== undefined && !short(options.query, 500))
    )
      throw new Error("Invalid library query.");
    let tracks = this.tracks();
    if (options.playlist) {
      const list = this.playlists().find((p) => p.id === options.playlist);
      if (!list) throw new Error("Playlist not found.");
      if (list.rule) tracks = tracks.filter((t) => this.matches(t, list.rule));
      else {
        const map = new Map(tracks.map((t) => [t.id, t]));
        tracks = list.tracks
          .map((id) => map.get(id) || this.store.trackById(id))
          .filter(Boolean)
          .map((t) =>
            t.mediaUrl ? t : this.decorate({ ...t, missing: true }),
          );
      }
    }
    const query = (options.query || "").trim().toLocaleLowerCase();
    if (query)
      tracks = tracks.filter((t) =>
        [t.title, t.artist, t.album, t.genre, t.folder, ...(t.tags || [])]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
      );
    if (options.genre)
      tracks = tracks.filter((t) =>
        t.genre.split(/[,;/]/).some((g) => g.trim() === options.genre),
      );
    if (options.folder)
      tracks = tracks.filter(
        (t) =>
          t.root === options.folder ||
          t.folder === options.folder ||
          t.path
            .toLowerCase()
            .startsWith(options.folder.toLowerCase() + path.sep),
      );
    if (options.album)
      tracks = tracks
        .filter((t) => albumIdentity(t) === options.album)
        .sort(orderTracks);
    if (options.artist)
      tracks = tracks.filter(
        (t) => t.artist === options.artist || t.albumArtist === options.artist,
      );
    if (options.favorite) tracks = tracks.filter((t) => t.favorite);
    if (options.rating)
      tracks = tracks.filter((t) => t.rating >= options.rating);
    if (options.format)
      tracks = tracks.filter(
        (t) =>
          path.extname(t.path).slice(1).toLowerCase() ===
          String(options.format).toLowerCase(),
      );
    if (options.year)
      tracks = tracks.filter((t) => t.year === Number(options.year));
    if (options.recent)
      tracks = tracks
        .filter((t) => t.lastPlayed)
        .sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
    if (options.sort === "artist")
      tracks.sort(
        (a, b) =>
          a.artist.localeCompare(b.artist) ||
          a.album.localeCompare(b.album) ||
          orderTracks(a, b),
      );
    else if (options.sort === "title")
      tracks.sort((a, b) => a.title.localeCompare(b.title));
    else if (options.sort === "year")
      tracks.sort((a, b) => (b.year || 0) - (a.year || 0) || orderTracks(a, b));
    else if (options.sort === "added")
      tracks.sort(
        (a, b) => (b.added || 0) - (a.added || 0) || orderTracks(a, b),
      );
    else if (!options.playlist && !options.recent)
      tracks.sort(
        (a, b) => a.album.localeCompare(b.album) || orderTracks(a, b),
      );
    let groups;
    if (["albums", "artists", "folders"].includes(options.view)) {
      const grouped = new Map();
      for (const t of tracks) {
        const key =
          options.view === "albums"
            ? albumIdentity(t)
            : options.view === "artists"
              ? t.albumArtist || t.artist
              : t.root + path.sep + t.folder;
        if (!grouped.has(key))
          grouped.set(key, {
            id: key,
            title:
              options.view === "albums"
                ? t.album
                : options.view === "artists"
                  ? t.albumArtist || t.artist
                  : t.folder || path.basename(t.root),
            artist: t.albumArtist || t.artist,
            cover: t.cover,
            year: t.year,
            duration: 0,
            tracks: [],
            added: t.added || 0,
          });
        const group = grouped.get(key);
        group.tracks.push(t.id);
        group.duration += t.duration || 0;
        group.added = Math.max(group.added, t.added || 0);
      }
      groups = [...grouped.values()];
      if (options.sort === "added") groups.sort((a, b) => b.added - a.added);
      else if (options.sort === "year")
        groups.sort((a, b) => (b.year || 0) - (a.year || 0));
      else
        groups.sort(
          (a, b) =>
            (options.sort === "artist"
              ? a.artist.localeCompare(b.artist)
              : 0) || a.title.localeCompare(b.title),
        );
    }
    const total = groups ? groups.length : tracks.length;
    const offset = Math.max(0, Math.min(1000000, Number(options.offset) || 0));
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
    return {
      tracks: groups ? [] : tracks.slice(offset, offset + limit),
      ...(groups ? { groups: groups.slice(offset, offset + limit) } : {}),
      total,
    };
  }
  matches(t, rule) {
    return (
      (!rule.genre ||
        t.genre.toLowerCase().includes(rule.genre.toLowerCase())) &&
      (!rule.favorite || t.favorite) &&
      (!rule.rating || t.rating >= rule.rating) &&
      (!rule.yearFrom || t.year >= rule.yearFrom) &&
      (!rule.yearTo || t.year <= rule.yearTo) &&
      (!rule.unplayed || !t.playCount)
    );
  }
  update(ids, patch, validateOnly = false) {
    if (
      !Array.isArray(ids) ||
      ids.length > 10000 ||
      !ids.length ||
      ids.some((id) => typeof id !== "string" || !this.store.trackById(id))
    )
      throw new Error("Choose indexed tracks.");
    if (
      !patch ||
      typeof patch !== "object" ||
      Object.keys(patch).some(
        (k) => !["favorite", "rating", "tags", "note", "overrides"].includes(k),
      )
    )
      throw new Error("Invalid library edit.");
    if (
      (patch.favorite !== undefined && typeof patch.favorite !== "boolean") ||
      (patch.rating !== undefined &&
        (!Number.isInteger(patch.rating) ||
          patch.rating < 0 ||
          patch.rating > 5)) ||
      (patch.note !== undefined && !short(patch.note, 2000)) ||
      (patch.tags !== undefined &&
        (!Array.isArray(patch.tags) ||
          patch.tags.length > 30 ||
          patch.tags.some((s) => !short(s, 60))))
    )
      throw new Error("Invalid rating, tags, or note.");
    if (patch.overrides !== undefined) {
      if (
        !patch.overrides ||
        typeof patch.overrides !== "object" ||
        Object.entries(patch.overrides).some(
          ([key, value]) =>
            ![
              "title",
              "artist",
              "album",
              "albumArtist",
              "genre",
              "year",
            ].includes(key) ||
            (key === "year"
              ? value !== null &&
                (!Number.isInteger(value) || value < 1000 || value > 9999)
              : !short(value, 500)),
        )
      )
        throw new Error("Invalid virtual metadata.");
    }
    if (validateOnly) return true;
    const put = this.store.db.prepare(
      "INSERT OR REPLACE INTO library_meta VALUES (?,?)",
    );
    this.store.db.exec("BEGIN");
    try {
      const meta = this.meta();
      for (const id of ids)
        put.run(id, JSON.stringify({ ...meta[id], ...patch }));
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    return true;
  }
  playlist(value, validateOnly = false) {
    if (
      !value ||
      !short(value.name, 100) ||
      !value.name.trim() ||
      !Array.isArray(value.tracks) ||
      value.tracks.length > 50000 ||
      value.tracks.some(
        (id) => typeof id !== "string" || !this.store.trackById(id),
      )
    )
      throw new Error("Invalid playlist.");
    const existing =
      value.id && this.playlists().find((p) => p.id === value.id);
    if (value.id && !existing) throw new Error("Playlist not found.");
    if (
      value.rule &&
      (typeof value.rule !== "object" ||
        Object.keys(value.rule).some(
          (k) =>
            ![
              "genre",
              "favorite",
              "rating",
              "yearFrom",
              "yearTo",
              "unplayed",
            ].includes(k),
        ) ||
        (value.rule.genre && !short(value.rule.genre, 100)) ||
        ["rating", "yearFrom", "yearTo"].some(
          (k) =>
            value.rule[k] !== undefined &&
            (!Number.isInteger(value.rule[k]) ||
              value.rule[k] < 0 ||
              value.rule[k] > (k === "rating" ? 5 : 9999)),
        ) ||
        ["favorite", "unplayed"].some(
          (k) =>
            value.rule[k] !== undefined && typeof value.rule[k] !== "boolean",
        ))
    )
      throw new Error("Invalid smart playlist rule.");
    const list = {
      id: existing?.id || randomUUID(),
      name: value.name.trim(),
      tracks: value.tracks,
      ...(value.rule ? { rule: value.rule } : {}),
      updated: new Date().toISOString(),
    };
    if (!validateOnly)
      this.store.db
        .prepare("INSERT OR REPLACE INTO playlists VALUES (?,?)")
        .run(list.id, JSON.stringify(list));
    return list;
  }
  removePlaylist(id) {
    this.store.db.prepare("DELETE FROM playlists WHERE id=?").run(String(id));
    return true;
  }
  played(id) {
    if (!this.store.trackById(id)) throw new Error("Track not found.");
    const data = this.meta()[id] || {},
      now = new Date().toISOString();
    this.store.db
      .prepare("INSERT OR REPLACE INTO library_meta VALUES (?,?)")
      .run(
        id,
        JSON.stringify({
          ...data,
          playCount: (data.playCount || 0) + 1,
          lastPlayed: now,
        }),
      );
    this.store.db
      .prepare("INSERT INTO listening_history(track_id,played) VALUES (?,?)")
      .run(id, now);
    this.store.db
      .prepare(
        "DELETE FROM listening_history WHERE id NOT IN (SELECT id FROM listening_history ORDER BY id DESC LIMIT 10000)",
      )
      .run();
    return true;
  }
  playback(value) {
    if (
      !value ||
      !Array.isArray(value.queue) ||
      value.queue.length > 50000 ||
      value.queue.some(
        (id) => typeof id !== "string" || !/^[a-f\d-]{36}$/.test(id),
      ) ||
      !Number.isSafeInteger(value.index) ||
      value.index < 0 ||
      value.index >= Math.max(1, value.queue.length) ||
      !Number.isFinite(value.position) ||
      value.position < 0 ||
      !Number.isFinite(value.volume) ||
      value.volume < 0 ||
      value.volume > 1 ||
      !["off", "all", "one"].includes(value.repeat) ||
      typeof value.shuffle !== "boolean"
    )
      throw new Error("Invalid playback state.");
    this.store.set("playback", {
      queue: value.queue,
      index: value.index,
      position: value.position,
      volume: value.volume,
      repeat: value.repeat,
      shuffle: value.shuffle,
    });
    return true;
  }
  resolve(ids) {
    if (!Array.isArray(ids) || ids.length > 50000)
      throw new Error("Invalid queue.");
    const meta = this.meta();
    return ids
      .map((id) => typeof id === "string" && this.store.trackById(id))
      .filter(Boolean)
      .map((t) => this.decorate(t, meta));
  }
  duplicates() {
    const groups = new Map();
    for (const t of this.tracks()) {
      const key = `${t.artist.toLocaleLowerCase()}\0${t.title.toLocaleLowerCase()}\0${Math.round(t.duration || 0)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    return [...groups.values()].filter((g) => g.length > 1).slice(0, 200);
  }
  backup() {
    const meta = this.meta();
    return {
      format: "crate-digger-library",
      version: 1,
      tracks: this.store.db
        .prepare("SELECT id,path FROM track_ids")
        .all()
        .map((t) => ({
          ...t,
          details: Object.fromEntries(
            Object.entries(meta[t.id] || {}).filter(([k]) =>
              ["favorite", "rating", "tags", "note", "overrides"].includes(k),
            ),
          ),
        })),
      playlists: this.playlists(),
    };
  }
  restore(value) {
    if (
      !value ||
      value.format !== "crate-digger-library" ||
      value.version !== 1 ||
      !Array.isArray(value.tracks) ||
      value.tracks.length > 100000 ||
      !Array.isArray(value.playlists) ||
      value.playlists.length > 1000
    )
      throw new Error("Invalid library backup.");
    const indexed = new Map(
      this.store.db
        .prepare("SELECT id,path FROM track_ids")
        .all()
        .map((t) => [t.path.toLowerCase(), t.id]),
    );
    const mapping = new Map(),
      edits = [];
    for (const t of value.tracks) {
      if (!short(t.id, 100) || !short(t.path, 32000))
        throw new Error("Invalid backup track.");
      const id = indexed.get(t.path.toLowerCase());
      if (!id) continue;
      mapping.set(t.id, id);
      this.update([id], t.details || {}, true);
      edits.push([id, t.details || {}]);
    }
    const lists = value.playlists.map((p) => {
      if (!Array.isArray(p.tracks)) throw new Error("Invalid backup playlist.");
      return this.playlist(
        {
          name: p.name,
          tracks: p.tracks.map((id) => mapping.get(id)).filter(Boolean),
          ...(p.rule ? { rule: p.rule } : {}),
        },
        true,
      );
    });
    const meta = this.meta();
    this.store.db.exec("BEGIN");
    try {
      const put = this.store.db.prepare(
        "INSERT OR REPLACE INTO library_meta VALUES (?,?)",
      );
      for (const [id, patch] of edits)
        put.run(id, JSON.stringify({ ...meta[id], ...patch }));
      const putList = this.store.db.prepare(
        "INSERT INTO playlists VALUES (?,?)",
      );
      for (const p of lists) putList.run(p.id, JSON.stringify(p));
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    return {
      restored: edits.length,
      playlists: lists.length,
      unresolved: value.tracks.length - edits.length,
    };
  }
  clearListening() {
    this.store.db.exec("BEGIN");
    try {
      this.store.db.exec("DELETE FROM listening_history");
      for (const [id, meta] of Object.entries(this.meta())) {
        delete meta.playCount;
        delete meta.lastPlayed;
        this.store.db
          .prepare("INSERT OR REPLACE INTO library_meta VALUES (?,?)")
          .run(id, JSON.stringify(meta));
      }
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    return true;
  }
}
