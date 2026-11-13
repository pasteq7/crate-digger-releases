import path from "node:path";
import {
  taste,
  filterUnowned,
  escapeQuery,
  neighbors,
  normalize,
  albumKey,
  rankByFeedback,
} from "./core.mjs";

export class Discovery {
  constructor(store, emit = null, country = "US") {
    this.store = store;
    this.emit = emit;
    this.queue = Promise.resolve();
    this.appleQueue = Promise.resolve();
    this.lastMb = 0;
    this.lastApple = 0;
    this.generation = 0;
    this.country = /^[A-Z]{2}$/.test(country) ? country : "US";
  }
  async json(url, key = url, musicbrainz = false) {
    const cached = this.store.cached(key);
    if (cached) return cached;
    const request = async () => {
      const secondCache = this.store.cached(key);
      if (secondCache) return secondCache;
      if (musicbrainz) {
        await new Promise((r) =>
          setTimeout(r, Math.max(0, 1100 - (Date.now() - this.lastMb))),
        );
        this.lastMb = Date.now();
      }
      if (url.startsWith("https://itunes.apple.com/")) {
        await new Promise((r) =>
          setTimeout(r, Math.max(0, 3100 - (Date.now() - this.lastApple))),
        );
        this.lastApple = Date.now();
      }
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "CrateDigger/0.3.0 (personal local music discovery)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(18000),
        });
        if (!res.ok)
          throw new Error(
            res.status === 429
              ? "The music catalog is busy. Give it a moment, then try again."
              : `Music catalog returned ${res.status}. Please try again.`,
          );
        const data = await res.json();
        this.store.cache(
          key,
          data,
          url.startsWith("https://api.deezer.com/") ? 600000 : 7 * 86400000,
        );
        return data;
      } catch (e) {
        const stale = this.store.stale(key);
        if (stale && !url.startsWith("https://api.deezer.com/")) return stale;
        throw e;
      }
    };
    if (musicbrainz) {
      const pending = this.queue.then(request, request);
      this.queue = pending.catch(() => {});
      return pending;
    }
    if (url.startsWith("https://itunes.apple.com/")) {
      const pending = this.appleQueue.then(request, request);
      this.appleQueue = pending.catch(() => {});
      return pending;
    }
    return request();
  }
  async preview(artist, album, preferredTrack = "") {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${album}`, media: "music", entity: "song", limit: "50", country: this.country })}`;
    const data = await this.json(url);
    const matches =
      data.results?.filter(
        (t) => normalize(t.artistName) === normalize(artist),
      ) || [];
    const exact = matches.filter(
      (t) => albumKey(artist, t.collectionName) === albumKey(artist, album),
    );
    return (
      exact.find(
        (t) =>
          t.previewUrl && normalize(t.trackName) === normalize(preferredTrack),
      ) ||
      exact.find((t) => t.previewUrl) ||
      null
    );
  }
  async deezerPreview(artist, album, preferredTrack = "") {
    // Deezer's fielded artist search misses some aliases, including King Tubby.
    // Retrieve broadly, then accept only an exact artist + album identity locally.
    const data = await this.json(
      `https://api.deezer.com/search?${new URLSearchParams({ q: `${artist} ${album}`, limit: "100" })}`,
    );
    const exact = (data.data || []).filter(
      (t) =>
        albumKey(t.artist?.name || "", t.album?.title || "") ===
        albumKey(artist, album),
    );
    const p =
      exact.find(
        (t) => t.preview && normalize(t.title) === normalize(preferredTrack),
      ) ||
      exact.find((t) => t.preview) ||
      exact[0];
    if (!p) return null;
    return {
      cover: p.album.cover_big || p.album.cover_medium || "",
      preview: p.preview || null,
      previewTitle: p.title,
      previewSource: "deezer",
      storeUrl: `https://www.deezer.com/album/${p.album.id}`,
      trackUrl: p.link,
      year: null,
    };
  }
  async resolveAlbum(
    artist,
    album,
    preferredTrack = "",
    isCurrent = () => true,
  ) {
    if (!isCurrent()) return null;
    const info = (p) => ({
      cover: p.artworkUrl100?.replace("100x100bb", "600x600bb") || "",
      preview: p.previewUrl?.replace("http:", "https:") || null,
      previewTitle: p.trackName,
      previewSource: "apple",
      storeUrl: p.collectionViewUrl || p.trackViewUrl,
      trackUrl: p.trackViewUrl,
      year: Number(p.releaseDate?.slice(0, 4)) || null,
    });
    let p;
    try {
      p = await this.preview(artist, album, preferredTrack);
    } catch {}
    if (!isCurrent()) return null;
    if (p) return info(p);
    const data = await this.json(
      `https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${album}`, media: "music", entity: "album", limit: "12", country: this.country })}`,
    ).catch(() => null);
    if (!isCurrent()) return null;
    const match = data?.results?.find(
      (a) =>
        albumKey(a.artistName, a.collectionName) === albumKey(artist, album),
    );
    if (match) {
      if (match.collectionId) {
        const tracks = await this.json(
          `https://itunes.apple.com/lookup?${new URLSearchParams({ id: String(match.collectionId), entity: "song", limit: "200", country: this.country })}`,
        ).catch(() => null);
        if (!isCurrent()) return null;
        const songs =
          tracks?.results?.filter(
            (t) =>
              t.previewUrl &&
              albumKey(t.artistName, t.collectionName) ===
                albumKey(artist, album),
          ) || [];
        p =
          songs.find(
            (t) => normalize(t.trackName) === normalize(preferredTrack),
          ) || songs[0];
      }
      if (p) return info(p);
    }
    if (!isCurrent()) return null;
    const deezer = await this.deezerPreview(
      artist,
      album,
      preferredTrack,
    ).catch(() => null);
    if (!isCurrent()) return null;
    if (deezer) return deezer;
    if (match) return info(match);
    const mb = await this.json(
      `https://musicbrainz.org/ws/2/release-group/?${new URLSearchParams({ query: `artist:"${escapeQuery(artist)}" AND releasegroup:"${escapeQuery(album)}"`, fmt: "json", limit: "5" })}`,
      undefined,
      true,
    );
    const release = mb["release-groups"]?.find(
      (r) =>
        albumKey(
          r["artist-credit"]?.map((a) => a.name || a.artist?.name).join("") ||
            "",
          r.title,
        ) === albumKey(artist, album),
    );
    return release
      ? {
          preview: null,
          cover: `https://coverartarchive.org/release-group/${release.id}/front-250`,
          catalogUrl: `https://musicbrainz.org/release-group/${release.id}`,
          year: Number(release["first-release-date"]?.slice(0, 4)) || null,
        }
      : null;
  }
  async recommend(options) {
    const generation = ++this.generation;
    let tracks = this.store.tracks();
    if (options.scope?.startsWith("genre:")) {
      const genre = options.scope.slice(6).toLowerCase();
      tracks = tracks.filter((t) =>
        t.genre
          .toLowerCase()
          .split(/[,;/]/)
          .map((x) => x.trim())
          .includes(genre),
      );
    }
    if (options.scope?.startsWith("folder:")) {
      const folder = options.scope.slice(7);
      tracks = tracks.filter((t) => {
        const rel = path.relative(folder, t.path);
        return (
          t.root === folder ||
          t.folder === folder ||
          (rel && !rel.startsWith("..") && !path.isAbsolute(rel))
        );
      });
    }
    const profile = taste(tracks);
    if (!profile.total)
      return {
        items: [],
        message: "Add some music to this scope and we’ll start digging.",
      };
    const mode = options.mode || "adjacent",
      offset = Number(options.offset) || 0;
    const genres = profile.genres
      .filter((g) => g.name !== "Untagged")
      .slice(0, 4);
    const artists = profile.artists.slice(0, 6);
    const seed = artists[offset % artists.length]?.name;
    const base =
      genres[offset % Math.max(genres.length, 1)]?.name || "indie rock";
    const adjacent = rankByFeedback(
      (
        neighbors[base.toLowerCase()] || [
          "alternative rock",
          "electronic",
          "jazz",
        ]
      ).map((genre) => ({ genre })),
      this.store.shelves(),
    ).map((item) => item.genre);
    const tag =
      mode === "safe"
        ? base
        : mode === "adjacent"
          ? adjacent[offset % adjacent.length]
          : [
              "spiritual jazz",
              "krautrock",
              "afrobeat",
              "modern classical",
              "bossa nova",
              "dub",
            ][offset % 6];
    let discography = options.gaps || genres.length === 0;
    let query;
    if (discography)
      query = `artist:"${escapeQuery(seed)}" AND primarytype:album`;
    else query = `tag:"${escapeQuery(tag)}" AND primarytype:album`;
    let data;
    try {
      data = await this.json(
        `https://musicbrainz.org/ws/2/release-group/?${new URLSearchParams({ query, fmt: "json", limit: "50", offset: String(Math.floor(offset / 3) * 25) })}`,
        undefined,
        true,
      );
      // Untagged libraries still have useful artist discographies to dig through.
      if (!data["release-groups"]?.length && seed) {
        discography = true;
        data = await this.json(
          `https://musicbrainz.org/ws/2/release-group/?${new URLSearchParams({ query: `artist:"${escapeQuery(seed)}" AND primarytype:album`, fmt: "json", limit: "50" })}`,
          undefined,
          true,
        );
      }
    } catch (e) {
      return { items: [], message: e.message };
    }
    const source = data["release-groups"] || [];
    const names = artists
      .slice(0, 2)
      .map((a) => a.name)
      .join(" and ");
    let items = source.map((r) => ({
      id: r.id,
      kind: "album",
      title: r.title,
      album: r.title,
      artist:
        r["artist-credit"]?.map((a) => a.name || a.artist?.name).join("") ||
        "Unknown artist",
      genre: discography ? genres[0]?.name || "Untagged" : tag,
      year: Number(r["first-release-date"]?.slice(0, 4)) || null,
      cover: "",
      preview: null,
      reason: discography
        ? `A missing chapter in your ${seed} collection.`
        : mode === "safe"
          ? `More ${base.toLowerCase()}, a favorite in your library.`
          : mode === "adjacent"
            ? `${tag} is a neighbor of your ${base.toLowerCase()} records.`
            : `A ${tag} detour from your ${base.toLowerCase()} collection.`,
      seeds: artists.slice(0, 3).map((a) => a.name),
      sourceFolder: tracks[0]?.root || "",
      catalogUrl: `https://musicbrainz.org/release-group/${r.id}`,
      seedContext: names,
    }));
    items = filterUnowned(items, this.store.tracks(), this.store.shelves());
    if (options.kind === "artist") {
      const own = new Set(this.store.tracks().map((t) => normalize(t.artist)));
      items = items.filter((i) => !own.has(normalize(i.artist)));
    }
    // Rotate cached candidates between refreshes without repeating within a batch.
    const rotate = (offset % 3) * 8;
    items = [...items.slice(rotate), ...items.slice(0, rotate)].slice(0, 18);
    items = items.map((i) => ({ ...i, loadingPreview: true }));
    const finalize = () => {
      let results = items;
      if (options.kind === "track")
        results = results
          .filter((i) => i.preview)
          .map((i) => ({
            ...i,
            kind: "track",
            id: `track:${i.trackId}`,
            title: i.previewTitle,
          }));
      if (options.kind === "artist") {
        const seen = new Set();
        results = results
          .filter((i) => {
            const k = normalize(i.artist);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .map((i) => ({
            ...i,
            kind: "artist",
            id: `artist:${normalize(i.artist)}`,
            title: i.artist,
          }));
      }
      const ownedTracks = new Set(
        this.store
          .tracks()
          .map((t) => `${normalize(t.artist)}:${normalize(t.title)}`),
      );
      const shelves = this.store.shelves();
      return rankByFeedback(
        results.filter(
          (i) =>
            !shelves[i.id] &&
            !(
              i.kind === "track" &&
              ownedTracks.has(`${normalize(i.artist)}:${normalize(i.title)}`)
            ),
        ),
        shelves,
      );
    };
    let previewFailures = 0;
    const enrich = async () => {
      for (const i of items) {
        if (generation !== this.generation) break;
        try {
          const p = await this.resolveAlbum(
            i.artist,
            i.title,
            "",
            () => generation === this.generation,
          );
          if (p) {
            Object.assign(i, p);
            i.trackId = `${i.id}:${normalize(p.previewTitle)}`;
          }
        } catch {
          previewFailures++;
        }
        i.loadingPreview = false;
        // A record can be saved before its artwork arrives. Keep the shelf hydrated.
        const saved = this.store.shelves()[i.id];
        if (saved)
          this.store.shelf(i.id, { ...saved, item: { ...saved.item, ...i } });
        if (this.emit && generation === this.generation)
          this.emit({
            requestId: options.requestId,
            items: finalize(),
            pending: items.some((i) => i.loadingPreview),
            shelfUpdate: saved ? { id: i.id, item: i } : null,
          });
      }
    };
    if (this.emit) {
      void enrich().catch(() => {});
      return {
        items: finalize(),
        pending: true,
        message:
          options.kind === "track"
            ? "Matching preview tracks to your finds…"
            : "",
      };
    }
    await enrich();
    const results = finalize();
    return {
      items: results,
      message: results.length
        ? ""
        : "No new finds in this pocket. Try another mode or scope.",
      warning: previewFailures
        ? "Some previews could not be loaded. Your finds are still here."
        : undefined,
    };
  }
}
