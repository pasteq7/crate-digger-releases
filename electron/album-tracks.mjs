import { albumKey, normalize } from "./identity.mjs";

const positive = (value, fallback = 0) =>
  Number.isSafeInteger(value) && value > 0 ? value : fallback;
const webUrl = (value) => {
  try {
    const url = new URL(value);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    ) {
      url.protocol = "https:";
      return url.href;
    }
  } catch {}
  return null;
};
const sourceId = (value, hosts, pattern) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts.includes(url.hostname)
      ? url.pathname.match(pattern)?.[1]
      : undefined;
  } catch {
    return undefined;
  }
};

export class AlbumTracks {
  constructor(catalog) {
    this.catalog = catalog;
    this.pending = new Map();
  }
  async list(item, { refresh = false } = {}) {
    const key = JSON.stringify([
      item.artist,
      item.album || item.title,
      item.storeUrl || "",
      refresh,
    ]);
    if (this.pending.has(key)) return this.pending.get(key);
    const json = (url) =>
      this.catalog.json(
        url,
        refresh ? `${url}:refresh:${Math.floor(Date.now() / 60000)}` : url,
      );
    const work = (async () => {
      const title = item.album || item.title;
      let apple,
        deezer,
        unavailable = false;
      try {
        apple = await this.apple(item, title, json);
      } catch {
        unavailable = true;
      }
      if (apple?.tracks.some((track) => track.preview)) return apple;
      try {
        deezer = await this.deezer(item, title, json);
      } catch {
        unavailable = true;
      }
      if (deezer?.tracks.some((track) => track.preview)) return deezer;
      if (apple || deezer) return apple || deezer;
      return {
        album: title,
        artist: item.artist,
        source: "",
        tracks: [],
        total: 0,
        complete: true,
        message: unavailable
          ? "Track list unavailable. Try again or open a provider link."
          : "No matching album track list found.",
      };
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  async apple(item, title, json) {
    let id = sourceId(
      item.storeUrl,
      ["music.apple.com"],
      /\/album\/(?:[^/]+\/)?(\d+)\/?$/,
    );
    if (!id) {
      const data = await json(
        `https://itunes.apple.com/search?${new URLSearchParams({ term: `${item.artist} ${title}`, entity: "album", media: "music", limit: "25", country: this.catalog.country })}`,
      );
      const matches = (data.results || []).filter(
        (r) =>
          albumKey(r.artistName || "", r.collectionName || "") ===
          albumKey(item.artist, title),
      );
      const album =
        matches.find((r) => normalize(r.collectionName) === normalize(title)) ||
        matches[0];
      id = album?.collectionId;
    }
    if (!/^\d+$/.test(String(id || ""))) return null;
    const data = await json(
      `https://itunes.apple.com/lookup?${new URLSearchParams({ id: String(id), entity: "song", limit: "200", country: this.catalog.country })}`,
    );
    const album = (data.results || []).find(
      (r) =>
        String(r.collectionId) === String(id) && r.wrapperType === "collection",
    );
    if (
      !album ||
      albumKey(album.artistName || "", album.collectionName || "") !==
        albumKey(item.artist, title)
    )
      return null;
    const seen = new Set();
    const tracks = (data.results || [])
      .filter(
        (r) =>
          r.wrapperType === "track" &&
          r.kind === "song" &&
          String(r.collectionId) === String(id) &&
          typeof r.trackName === "string" &&
          r.trackId &&
          !seen.has(r.trackId) &&
          seen.add(r.trackId),
      )
      .map((r) => ({
        id: `apple:${r.trackId}`,
        title: r.trackName,
        artist: r.artistName || item.artist,
        number: positive(r.trackNumber),
        disc: positive(r.discNumber, 1),
        durationMs: positive(r.trackTimeMillis),
        preview: webUrl(r.previewUrl),
        previewSource: "apple",
        trackUrl: webUrl(r.trackViewUrl),
      }));
    tracks.sort((a, b) => a.disc - b.disc || a.number - b.number);
    if (!tracks.length) return null;
    const total = positive(album.trackCount, tracks.length);
    return {
      album: album.collectionName,
      artist: album.artistName,
      source: "Apple Music",
      storeUrl: webUrl(album.collectionViewUrl),
      tracks,
      total,
      complete: tracks.length >= total,
    };
  }
  async deezer(item, title, json) {
    let id = sourceId(
      item.storeUrl,
      ["www.deezer.com", "deezer.com"],
      /\/album\/(\d+)\/?$/,
    );
    if (!id) {
      const data = await json(
        `https://api.deezer.com/search/album?${new URLSearchParams({ q: `${item.artist} ${title}`, limit: "25" })}`,
      );
      const matches = (data.data || []).filter(
        (r) =>
          albumKey(r.artist?.name || "", r.title || "") ===
          albumKey(item.artist, title),
      );
      const album =
        matches.find((r) => normalize(r.title) === normalize(title)) ||
        matches[0];
      id = album?.id;
    }
    if (!/^\d+$/.test(String(id || ""))) return null;
    const album = await json(`https://api.deezer.com/album/${id}`);
    if (
      albumKey(album.artist?.name || "", album.title || "") !==
      albumKey(item.artist, title)
    )
      return null;
    const tracks = [],
      seen = new Set();
    let page =
      album.tracks ||
      (await json(
        `https://api.deezer.com/album/${id}/tracks?limit=100&index=0`,
      ));
    let index = 0;
    for (let n = 0; n < 100; n++) {
      for (const r of page.data || []) {
        if (
          !r.id ||
          typeof r.title !== "string" ||
          seen.has(r.id) ||
          (r.album?.id && String(r.album.id) !== String(id))
        )
          continue;
        seen.add(r.id);
        tracks.push({
          id: `deezer:${r.id}`,
          title: r.title,
          artist: r.artist?.name || item.artist,
          number: positive(r.track_position, tracks.length + 1),
          disc: positive(r.disk_number, 1),
          durationMs: positive(r.duration) * 1000,
          preview: webUrl(r.preview),
          previewSource: "deezer",
          trackUrl: webUrl(r.link),
        });
      }
      if (!page.next) break;
      // Reconstruct a fixed-host request; never fetch a server-supplied URL.
      const next = new URL(page.next, "https://api.deezer.com");
      const nextIndex = Number(next.searchParams.get("index"));
      if (
        next.origin !== "https://api.deezer.com" ||
        next.pathname !== `/album/${id}/tracks` ||
        !Number.isSafeInteger(nextIndex) ||
        nextIndex <= index
      )
        break;
      index = nextIndex;
      page = await json(
        `https://api.deezer.com/album/${id}/tracks?limit=100&index=${index}`,
      );
    }
    if (!tracks.length) return null;
    const total = positive(album.nb_tracks, tracks.length);
    return {
      album: album.title,
      artist: album.artist?.name || item.artist,
      source: "Deezer",
      storeUrl: webUrl(album.link),
      tracks,
      total,
      complete: tracks.length >= total && !page.next,
    };
  }
}
