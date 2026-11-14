const videoId = /^[a-zA-Z0-9_-]{11}$/;
export const youtubeAppIdentity = "https://local.cratedigger.desktop/";

export function youtubeVideoId(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    let id;
    if (url.hostname === "youtu.be") id = url.pathname.slice(1);
    else if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "www.youtube-nocookie.com",
      ].includes(url.hostname)
    ) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else
        id = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
    }
    return videoId.test(id || "") ? id : null;
  } catch {
    return null;
  }
}

// Local file pages have no HTTP referrer. YouTube requires the installed app's
// identity for desktop embeds. Never change headers for another window/resource.
export function youtubeEmbedHeaders(details, webContentsId) {
  const headers = { ...details.requestHeaders };
  if (
    details.webContentsId === webContentsId &&
    details.resourceType === "subFrame" &&
    /^https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]{11}(?:\?|$)/.test(
      details.url,
    )
  ) {
    for (const key of Object.keys(headers))
      if (key.toLowerCase() === "referer") delete headers[key];
    headers.Referer = youtubeAppIdentity;
  }
  return headers;
}

function queryFor(item) {
  if (
    !item ||
    !["album", "track", "artist"].includes(item.kind) ||
    typeof item.artist !== "string" ||
    !item.artist.trim() ||
    item.artist.length > 200 ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    item.title.length > 200 ||
    (item.previewTrack !== undefined &&
      (typeof item.previewTrack !== "string" || item.previewTrack.length > 200))
  )
    throw new Error("Invalid record for YouTube search.");
  return `${item.artist} ${item.title}${item.kind === "album" ? " full album" : ""}`;
}
function includesName(haystack, needle) {
  const tokens = (value) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  const words = tokens(needle);
  const text = new Set(tokens(haystack));
  return words.length > 0 && words.every((word) => text.has(word));
}
export class YoutubePreviews {
  constructor(
    store,
    getKey,
    country = "US",
    request = (...args) => fetch(...args),
  ) {
    Object.assign(this, { store, getKey, country, request });
    this.pending = new Map();
  }
  async json(method, params, key) {
    let response;
    try {
      response = await this.request(
        `https://www.googleapis.com/youtube/v3/${method}?${new URLSearchParams(params)}`,
        {
          headers: { "X-Goog-Api-Key": key },
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new Error(
        "YouTube could not be reached. Try again or paste a video link.",
      );
    }
    if (!response.ok) {
      const reason = await response
        .json()
        .then((data) => data.error?.errors?.[0]?.reason)
        .catch(() => "");
      if (
        ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(
          reason,
        )
      )
        throw new Error(
          "YouTube search quota reached. Try later, or search in your browser and paste a video link.",
        );
      throw new Error(
        "YouTube search is unavailable. Check the saved key and that YouTube Data API v3 is enabled, or paste a video link.",
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error(
        "YouTube returned an unreadable response. Try again later.",
      );
    }
  }
  async search(item) {
    const query = queryFor(item);
    const key = this.getKey();
    if (!key)
      throw new Error(
        "Add a YouTube Data API key in Settings → YouTube, or search in your browser and paste a video link.",
      );
    const cacheKey = `youtube-preview:v1:${JSON.stringify([this.country, item.kind, item.artist, item.title, item.previewTrack || ""])}`;
    const cached = this.store.cached(cacheKey);
    if (cached) return cached;
    if (this.pending.has(cacheKey)) return this.pending.get(cacheKey);
    const work = this.lookup(item, query, key)
      .then((videos) => {
        this.store.cache(
          cacheKey,
          videos,
          videos.length ? 7 * 86400000 : 600000,
        );
        return videos;
      })
      .finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, work);
    return work;
  }
  async lookup(item, query, key) {
    const search = await this.json(
      "search",
      {
        part: "snippet",
        q: query,
        type: "video",
        maxResults: "8",
        videoEmbeddable: "true",
        videoSyndicated: "true",
        regionCode: this.country,
      },
      key,
    );
    const ids = [
      ...new Set(
        (search.items || [])
          .map((row) => row.id?.videoId)
          .filter((id) => videoId.test(id || "")),
      ),
    ];
    if (!ids.length) return [];
    const details = await this.json(
      "videos",
      {
        part: "snippet,contentDetails,status",
        id: ids.join(","),
      },
      key,
    );
    return (details.items || [])
      .filter((row) => {
        const region = row.contentDetails?.regionRestriction;
        return (
          ids.includes(row.id) &&
          row.status?.embeddable === true &&
          row.status?.privacyStatus === "public" &&
          row.snippet?.liveBroadcastContent === "none" &&
          !region?.blocked?.includes(this.country) &&
          (!region?.allowed || region.allowed.includes(this.country))
        );
      })
      .map((row) => {
        const title = String(row.snippet.title || "").slice(0, 300);
        const channel = String(row.snippet.channelTitle || "").slice(0, 200);
        const artistMatch = includesName(`${title} ${channel}`, item.artist);
        const closeMatch =
          artistMatch &&
          (includesName(title, item.title) ||
            (item.previewTrack && includesName(title, item.previewTrack)));
        const artistChannel = includesName(channel, item.artist);
        return {
          id: row.id,
          title,
          channel,
          duration: String(row.contentDetails?.duration || ""),
          closeMatch: !!closeMatch,
          rank: (closeMatch ? 10 : 0) + (artistChannel ? 2 : 0),
        };
      })
      .sort((a, b) => b.rank - a.rank)
      .map(({ rank, ...video }) => video);
  }
}
