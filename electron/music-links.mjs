import { albumKey } from "./identity.mjs";
const amazonHosts = new Set([
  "music.amazon.com",
  "music.amazon.fr",
  "music.amazon.de",
  "music.amazon.co.uk",
  "music.amazon.it",
  "music.amazon.es",
  "music.amazon.co.jp",
  "music.amazon.ca",
  "music.amazon.com.au",
  "music.amazon.com.br",
  "music.amazon.com.mx",
  "music.amazon.in",
]);
export function allowedExternal(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      (amazonHosts.has(u.hostname) ||
        [
          "music.apple.com",
          "musicbrainz.org",
          "www.deezer.com",
          "deezer.com",
          "www.youtube.com",
          "youtu.be",
        ].includes(u.hostname))
    );
  } catch {
    return false;
  }
}
export function searchLinks(item, country = "US") {
  const term =
    `${item.artist} ${item.kind === "artist" ? "" : item.kind === "track" ? item.title : item.album || item.title}`.trim();
  const suffix =
    {
      FR: "fr",
      DE: "de",
      GB: "co.uk",
      IT: "it",
      ES: "es",
      JP: "co.jp",
      CA: "ca",
      AU: "com.au",
      BR: "com.br",
      MX: "com.mx",
      IN: "in",
    }[country] || "com";
  return {
    amazon: `https://music.amazon.${suffix}/search/${encodeURIComponent(term)}`,
    youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(term + (item.kind === "album" ? " full album" : ""))}`,
    exact: false,
  };
}
export class MusicLinks {
  constructor(store, country = "US", catalog = null) {
    this.store = store;
    this.country = country;
    this.catalog = catalog;
    this.queue = Promise.resolve();
    this.last = 0;
    this.pending = new Map();
  }
  async resolve(item) {
    const fallback = searchLinks(item, this.country);
    const source =
      item.kind === "track" ? item.trackUrl || item.storeUrl : item.storeUrl;
    if (item.kind === "artist") return fallback;
    let pageUrl = "";
    if (source && allowedExternal(source)) {
      const u = new URL(source);
      if (u.hostname === "music.apple.com") {
        const id =
          item.kind === "track"
            ? u.searchParams.get("i")
            : u.pathname.match(/\/(\d+)\/?$/)?.[1];
        if (/^\d+$/.test(id || ""))
          pageUrl = `https://${item.kind === "track" ? "song" : "album"}.link/i/${id}`;
      } else if (["www.deezer.com", "deezer.com"].includes(u.hostname)) {
        const id = u.pathname.match(/\/(?:album|track)\/(\d+)/)?.[1];
        if (id)
          pageUrl = `https://${item.kind === "track" ? "song" : "album"}.link/d/${id}`;
      }
    }
    // MusicBrainz sometimes carries a direct streaming relation for catalog-only finds.
    if (
      !pageUrl &&
      this.catalog &&
      /^https:\/\/musicbrainz\.org\/release-group\/[a-f0-9-]{36}$/.test(
        item.catalogUrl || "",
      )
    ) {
      try {
        const id = item.catalogUrl.split("/").pop();
        const data = await this.catalog.json(
          `https://musicbrainz.org/ws/2/release-group/${id}?inc=url-rels&fmt=json`,
          undefined,
          true,
        );
        const amazon = data.relations
          ?.map((r) => r.url?.resource)
          .find(
            (url) =>
              allowedExternal(url) &&
              amazonHosts.has(new URL(url).hostname) &&
              /\/albums\//.test(new URL(url).pathname),
          );
        if (amazon) return { ...fallback, amazon, exact: true };
      } catch {}
    }
    if (!pageUrl) return fallback;
    const key = `music-links:v3:${pageUrl}:${this.country}:${item.kind}:${albumKey(item.artist, item.kind === "track" ? item.title : item.album || item.title)}`;
    const cached = this.store.cached(key);
    if (cached) return { ...fallback, ...cached };
    if (this.pending.has(key)) return this.pending.get(key);
    const work = async () => {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, 6100 - (Date.now() - this.last))),
      );
      this.last = Date.now();
      try {
        // The old Odesli public API was retired. Read the public sharing page's
        // structured release data on demand; missing/changed markup falls back to search.
        const response = await fetch(pageUrl, {
          signal: AbortSignal.timeout(18000),
          headers: { "User-Agent": "CrateDigger/0.3.0 (personal music links)" },
        });
        if (!response.ok) return fallback;
        const html = await response.text();
        if (html.length > 2000000) return fallback;
        const embedded = html.match(
          /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
        )?.[1];
        if (!embedded) return fallback;
        const data = JSON.parse(embedded).props?.pageProps?.pageData;
        const entity = data?.entityData;
        const expected =
          item.kind === "track" ? item.title : item.album || item.title;
        if (
          entity?.type !== (item.kind === "track" ? "song" : "album") ||
          albumKey(entity.artistName || "", entity.title || "") !==
            albumKey(item.artist, expected)
        )
          return fallback;
        const link = data.sections
          ?.flatMap((s) => s.links || [])
          .find((l) => l.platform === "amazonMusic" && l.url);
        if (
          !link ||
          !allowedExternal(link.url) ||
          !amazonHosts.has(new URL(link.url).hostname)
        )
          return fallback;
        const result = { amazon: link.url, exact: true };
        this.store.cache(key, result);
        return { ...fallback, ...result };
      } catch {
        return fallback;
      }
    };
    const result = this.queue
      .then(work, work)
      .then((result) => {
        if (!result.exact) this.store.cache(key, result, 600000);
        return result;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    this.queue = result.catch(() => {});
    return result;
  }
}
