import path from "node:path";

import { albumKey, normalize, trackKey } from "./identity.mjs";
export { normalize, albumKey, trackKey } from "./identity.mjs";
export function inferTrack(file, root, common = {}) {
  const parts = path.relative(root, file).split(path.sep);
  const folders = parts.slice(0, -1);
  const disc = /^(cd|disc|disk)\s*\d+$/i.test(folders.at(-1) || "");
  if (disc) folders.pop();
  const albumFolder = folders.at(-1) || path.basename(root);
  const year =
    common.year ||
    Number(
      albumFolder.match(/(?:^|[\s[(])(19\d{2}|20\d{2})(?:[\s)\]]|$)/)?.[1],
    ) ||
    null;
  return {
    path: file,
    root,
    folder: folders.join(path.sep),
    title:
      common.title?.trim() ||
      path.basename(file, path.extname(file)).replace(/^\d+[\s.\-_]+/, ""),
    artist:
      common.albumartist?.trim() ||
      common.artist?.trim() ||
      folders.at(-2) ||
      (folders.length ? path.basename(root) : "Unknown artist"),
    album:
      common.album?.trim() || albumFolder.replace(/^\[?\d{4}\]?[\s\-_]+/, ""),
    genre: common.genre?.filter(Boolean).join(", ") || "Untagged",
    year,
  };
}
export function taste(tracks) {
  const genres = Object.create(null),
    artists = Object.create(null),
    eras = Object.create(null);
  for (const t of tracks) {
    const tags = t.genre
      .split(/[,;/]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const tag of tags) genres[tag] = (genres[tag] || 0) + 1 / tags.length;
    artists[t.artist] = (artists[t.artist] || 0) + 1;
    const era = t.year ? `${Math.floor(t.year / 10) * 10}s` : "Unknown";
    eras[era] = (eras[era] || 0) + 1;
  }
  const sorted = (obj) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  return {
    total: tracks.length,
    albums: new Set(tracks.map((t) => albumKey(t.artist, t.album))).size,
    genres: sorted(genres),
    artists: sorted(artists),
    eras: sorted(eras),
  };
}
export function filterUnowned(items, tracks, shelves) {
  const owned = new Set(tracks.map((t) => albumKey(t.artist, t.album)));
  const songs = new Set(
    tracks.filter((t) => t.title).map((t) => trackKey(t.artist, t.title)),
  );
  const seen = new Set();
  const shelved = new Set(
    Object.values(shelves).map(
      (x) =>
        `${x.item.kind === "track" ? "track" : "album"}:${x.item.kind === "track" ? trackKey(x.item.artist, x.item.title) : albumKey(x.item.artist, x.item.title)}`,
    ),
  );
  return items.filter((item) => {
    const name =
      item.kind === "track"
        ? trackKey(item.artist, item.title)
        : albumKey(item.artist, item.title);
    const key = `${item.kind === "track" ? "track" : "album"}:${name}`;
    const isOwned =
      item.kind === "track"
        ? songs.has(name) ||
          (item.album && owned.has(albumKey(item.artist, item.album)))
        : owned.has(name);
    const albumShelved =
      item.kind === "track" &&
      item.album &&
      shelved.has(`album:${albumKey(item.artist, item.album)}`);
    if (
      isOwned ||
      albumShelved ||
      shelved.has(key) ||
      shelves[item.id] ||
      seen.has(key)
    )
      return false;
    seen.add(key);
    return true;
  });
}
// A small ranking signal, never a genre ban. Positive choices counterbalance
// negative ones; exact rejected releases are excluded by filterUnowned.
export function rankByFeedback(items, shelves) {
  const signals = new Map();
  const artistSignals = new Map();
  const tags = (genre = "") =>
    genre.split(/[,;/]/).map(normalize).filter(Boolean);
  for (const entry of Object.values(shelves)
    .sort((a, b) => String(a.added || "").localeCompare(String(b.added || "")))
    .slice(-120)) {
    const weight = entry.status === "rejected" ? -1 : 1;
    const artist = normalize(entry.item.artist || "");
    if (artist)
      artistSignals.set(artist, (artistSignals.get(artist) || 0) + weight);
    for (const genre of tags(entry.item.genre))
      signals.set(genre, (signals.get(genre) || 0) + weight);
  }
  const score = (item) =>
    2 *
      Math.max(
        -3,
        Math.min(3, artistSignals.get(normalize(item.artist || "")) || 0),
      ) +
    tags(item.genre).reduce(
      (sum, genre) => sum + Math.max(-3, Math.min(3, signals.get(genre) || 0)),
      0,
    );
  return [...items].sort((a, b) => score(b) - score(a));
}
export const escapeQuery = (s) =>
  s.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, " ").trim();
export function exportShelf(items, format) {
  if (format === "txt")
    return items
      .map((i) => `${i.artist} — ${i.title}${i.year ? ` (${i.year})` : ""}`)
      .join("\n");
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return [
    "Artist,Album,Genre,Year,Reason",
    ...items.map((i) =>
      [i.artist, i.title, i.genre, i.year, i.reason].map(cell).join(","),
    ),
  ].join("\r\n");
}
export const neighbors = {
  dub: ["roots reggae", "steppers", "dub"],
  "roots dub": ["roots reggae", "dub", "steppers"],
  "dub techno": ["dub techno", "minimal techno", "ambient dub"],
  dubstep: ["uk bass", "2-step", "dubstep"],
  shoegaze: ["dream pop", "neo-psychedelia", "noise pop"],
  "dream pop": ["shoegaze", "indie pop", "ambient pop"],
  "post-punk": ["new wave", "gothic rock", "art rock"],
  ambient: ["electronic", "minimalism", "modern classical"],
  "indie rock": ["dream pop", "alternative rock", "post-rock"],
  rock: ["post-punk", "psychedelic rock", "indie rock"],
  jazz: ["soul", "jazz fusion", "ambient"],
  electronic: ["ambient", "trip hop", "idm"],
  "hip-hop": ["jazz rap", "neo-soul", "trip hop"],
  classical: ["modern classical", "minimalism", "ambient"],
  metal: ["post-metal", "progressive rock", "dark ambient"],
  folk: ["indie folk", "chamber pop", "americana"],
  pop: ["indie pop", "synthpop", "art pop"],
};
