import { normalize, trackKey } from "./identity.mjs";
import { soundcloudUrl, soundcloudSearchUrl } from "./soundcloud-url.mjs";
export { soundcloudUrl, soundcloudSearchUrl } from "./soundcloud-url.mjs";

const clean = (value, max = 240) =>
  typeof value === "string"
    ? value
        .replace(/[\x00-\x1f]/g, " ")
        .trim()
        .slice(0, max)
    : "";
const identity = (auth) =>
  `${auth?.clientId || ""}:${auth?.clientSecret || ""}`;
function source(row) {
  const url = soundcloudUrl(row.permalink_url);
  const title = clean(row.title);
  const artist = clean(
    row.metadata_artist || row.publisher_metadata?.artist || row.user?.username,
  );
  const playlist = row.kind === "playlist";
  if (
    !url ||
    new URL(url).hostname !== "soundcloud.com" ||
    !title ||
    !artist ||
    row.sharing !== "public" ||
    (!playlist && !["playable", "preview"].includes(row.access))
  )
    return null;
  return {
    url,
    title,
    artist,
    uploader: clean(row.user?.username),
    uploaderUrl: /^https:\/\/soundcloud\.com\/[a-zA-Z0-9_-]+$/.test(
      row.user?.permalink_url || "",
    )
      ? row.user.permalink_url
      : "",
    kind: playlist ? "album" : "track",
    trackCount:
      playlist && Number.isInteger(row.track_count) && row.track_count > 0
        ? row.track_count
        : playlist
          ? null
          : 1,
    releaseType: playlist
      ? row.playlist_type === "ep"
        ? "ep"
        : row.playlist_type === "album"
          ? "album"
          : "playlist"
      : "track",
    access: playlist ? "unknown" : row.access,
    cover: /^https:\/\//.test(row.artwork_url || "") ? row.artwork_url : "",
    genre: clean(row.genre),
    year:
      Number(String(row.release_date || row.created_at || "").slice(0, 4)) ||
      null,
    confirmed: true,
  };
}
export class SoundCloud {
  constructor(store, getAuth, saveAuth, request = (...args) => fetch(...args)) {
    Object.assign(this, { store, getAuth, saveAuth, request });
    this.pending = new Map();
    this.tokens = new Map();
  }
  configured() {
    const auth = this.getAuth();
    return !!(auth?.clientId && auth?.clientSecret);
  }
  async requestJson(url, options = {}) {
    let response;
    try {
      response = await this.request(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(18000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        "SoundCloud could not be reached. Try again or use browser search.",
      );
    }
    if (!response.ok) {
      const message =
        response.status === 429
          ? "SoundCloud rate limit reached. Try later or use browser search."
          : [401, 403].includes(response.status)
            ? "SoundCloud access was denied. Check your app credentials in Settings → SoundCloud."
            : "SoundCloud lookup is unavailable. The upload may be private, restricted, or removed. Try opening it on SoundCloud.";
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      throw new Error(
        "SoundCloud returned an unreadable response. Try again later.",
      );
    }
  }
  async token(force = false) {
    const auth = this.getAuth();
    if (!auth?.clientId || !auth?.clientSecret)
      throw new Error(
        "Add your SoundCloud app credentials in Settings → SoundCloud, or use browser search and paste a link.",
      );
    const key = identity(auth);
    if (!force && auth.token?.expires > Date.now() + 60000)
      return auth.token.accessToken;
    if (this.tokens.has(key)) return this.tokens.get(key);
    const work = (async () => {
      const refresh = auth.token?.refreshToken;
      const options = {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(
          refresh
            ? {
                grant_type: "refresh_token",
                client_id: auth.clientId,
                client_secret: auth.clientSecret,
                refresh_token: refresh,
              }
            : { grant_type: "client_credentials" },
        ).toString(),
      };
      if (!refresh)
        options.headers.Authorization = `Basic ${Buffer.from(key).toString("base64")}`;
      const data = await this.requestJson(
        "https://secure.soundcloud.com/oauth/token",
        options,
      );
      if (
        typeof data.access_token !== "string" ||
        !data.access_token ||
        !Number.isFinite(Number(data.expires_in)) ||
        Number(data.expires_in) <= 0
      )
        throw new Error(
          "SoundCloud did not return a usable access token. Check your app credentials.",
        );
      const token = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || "",
        expires: Date.now() + Number(data.expires_in) * 1000,
      };
      if (identity(this.getAuth()) !== key)
        throw new Error(
          "SoundCloud credentials changed. Try the search again.",
        );
      this.saveAuth({ ...auth, token });
      return token.accessToken;
    })().finally(() => this.tokens.delete(key));
    this.tokens.set(key, work);
    return work;
  }
  async api(path, params, signal) {
    const run = async (token) =>
      this.requestJson(
        `https://api.soundcloud.com/${path}?${new URLSearchParams(params)}`,
        {
          headers: {
            Accept: "application/json; charset=utf-8",
            Authorization: `OAuth ${token}`,
          },
          signal,
        },
      );
    try {
      return await run(await this.token());
    } catch (error) {
      if (error.status !== 401) throw error;
      return run(await this.token(true));
    }
  }
  async searchQuery(query, kind = "track", signal) {
    if (!this.configured())
      throw new Error(
        "Add your SoundCloud app credentials in Settings → SoundCloud, or use browser search and paste a link.",
      );
    query = clean(query, 300);
    if (!query)
      throw new Error(
        "Enter an artist, release, or genre for SoundCloud search.",
      );
    const key = `soundcloud-search:v2:${JSON.stringify([kind, query])}`;
    const cached = this.store.cached(key);
    if (cached) return cached;
    // Cancellable AI requests must not share another request's AbortSignal.
    if (!signal && this.pending.has(key)) return this.pending.get(key);
    const work = this.api(
      kind === "track" ? "tracks" : "playlists",
      {
        q: query,
        limit: "12",
        linked_partitioning: "true",
        ...(kind === "track" ? { access: "playable,preview" } : {}),
      },
      signal,
    )
      .then((data) =>
        (Array.isArray(data) ? data : data.collection || [])
          .map(source)
          .filter(Boolean),
      )
      .then((rows) => {
        if (signal?.aborted)
          throw new Error("SoundCloud discovery was canceled.");
        this.store.cache(key, rows, rows.length ? 86400000 : 600000);
        return rows;
      })
      .finally(() => {
        if (!signal) this.pending.delete(key);
      });
    if (!signal) this.pending.set(key, work);
    return work;
  }
  async search(item) {
    if (
      !item ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      item.artist.length > 240 ||
      item.title.length > 240 ||
      !["album", "track", "artist"].includes(item.kind)
    )
      throw new Error("Invalid record for SoundCloud search.");
    const rows = await this.searchQuery(
      `${item.artist} ${item.title}`,
      item.kind === "album" ? "album" : "track",
    );
    return rows
      .map((row) => ({
        ...row,
        closeMatch:
          normalize(row.artist) === normalize(item.artist) &&
          (trackKey(item.artist, row.title) ===
            trackKey(item.artist, item.title) ||
            normalize(row.title) === normalize(`${item.artist} ${item.title}`)),
      }))
      .sort((a, b) => Number(b.closeMatch) - Number(a.closeMatch));
  }
  async discover(context, brief = "", signal) {
    const genres = [
      ...new Set(context.albums.map((a) => a.genre).filter(Boolean)),
    ]
      .slice(0, 3)
      .join(" ");
    const parts = [context.label, brief || genres].filter(Boolean);
    const query = clean(
      [...new Map(parts.map((part) => [normalize(part), part])).values()].join(
        " ",
      ),
      220,
    );
    const rows = (
      await Promise.all([
        this.searchQuery(query, "track", signal),
        this.searchQuery(query, "album", signal),
      ])
    ).flat();
    return [...new Map(rows.map((row) => [row.url, row])).values()].slice(
      0,
      24,
    );
  }
  async resolve(value) {
    let url = soundcloudUrl(value);
    if (!url)
      throw new Error("Paste a public SoundCloud track or playlist URL.");
    if (new URL(url).hostname === "on.soundcloud.com") {
      let response;
      try {
        response = await this.request(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new Error(
          "SoundCloud share link could not be resolved. Paste the full track or playlist URL instead.",
        );
      }
      url = soundcloudUrl(response.headers.get("location"));
      if (!url || new URL(url).hostname !== "soundcloud.com")
        throw new Error(
          "Paste the full soundcloud.com track or playlist URL from your browser.",
        );
    }
    const key = `soundcloud-oembed:v1:${url}`;
    const cached = this.store.cached(key);
    if (cached) return cached;
    const data = await this.requestJson(
      `https://soundcloud.com/oembed?${new URLSearchParams({ url, format: "json", auto_play: "false" })}`,
    );
    if (data.provider_name !== "SoundCloud" || typeof data.title !== "string")
      throw new Error("SoundCloud could not confirm this upload.");
    // Never inject third-party HTML or turn a manually associated URL into a verified recommendation.
    const result = {
      url,
      title: clean(data.title),
      artist: clean(data.author_name),
      uploader: clean(data.author_name),
      kind: url.includes("/sets/") ? "album" : "track",
      releaseType: url.includes("/sets/") ? "playlist" : "track",
      access: "unknown",
      confirmed: false,
    };
    this.store.cache(key, result, 86400000);
    return result;
  }
}
