import { albumKey, normalize, trackKey } from "./identity.mjs";
import {
  musicProviderForUrl,
  suppliedProviderLinks,
} from "./music-providers.mjs";
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
      (!!musicProviderForUrl(value) ||
        amazonHosts.has(u.hostname) ||
        [
          "music.apple.com",
          "musicbrainz.org",
          "www.deezer.com",
          "deezer.com",
          "www.youtube.com",
          "youtu.be",
          "soundcloud.com",
          "www.soundcloud.com",
          "on.soundcloud.com",
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
export function isAmazonMusicUrl(value, kind = "album") {
  if (!allowedExternal(value)) return false;
  const url = new URL(value);
  if (!amazonHosts.has(url.hostname)) return false;
  if (kind === "track")
    return /^\/(?:tracks|albums)\/[a-z0-9]{10}\/?$/i.test(url.pathname);
  return (
    /^\/albums\/[a-z0-9]{10}\/?$/i.test(url.pathname) &&
    !url.searchParams.has("trackAsin")
  );
}
function pageForSource(value, kind) {
  if (!allowedExternal(value)) return "";
  const url = new URL(value);
  if (url.hostname === "music.apple.com") {
    const id =
      kind === "track"
        ? url.searchParams.get("i")
        : url.pathname.match(/\/(\d+)\/?$/)?.[1];
    return /^\d+$/.test(id || "")
      ? `https://${kind === "track" ? "song" : "album"}.link/i/${id}`
      : "";
  }
  if (["deezer.com", "www.deezer.com"].includes(url.hostname)) {
    const id = url.pathname.match(
      kind === "track" ? /\/track\/(\d+)/ : /\/album\/(\d+)/,
    )?.[1];
    return id
      ? `https://${kind === "track" ? "song" : "album"}.link/d/${id}`
      : "";
  }
  return "";
}
export class MusicLinks {
  constructor(store, country = "US", catalog = null) {
    Object.assign(this, { store, country, catalog });
    this.queue = Promise.resolve();
    this.last = 0;
    this.pending = new Map();
  }
  async page(url, force) {
    const key = `music-sharing:v5:${url}`;
    if (!force) {
      const cached = this.store.cached(key);
      if (cached) return cached;
    }
    const work = async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 6100 - (Date.now() - this.last))),
      );
      this.last = Date.now();
      let result;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(18000),
          headers: { "User-Agent": "CrateDigger/0.6 (personal music links)" },
        });
        if (!response.ok)
          return {
            error: response.status === 429 ? "rate_limit" : "unavailable",
          };
        const html = await response.text();
        if (html.length > 2000000) return { error: "format" };
        const embedded = html.match(
          /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/,
        )?.[1];
        const data = embedded
          ? JSON.parse(embedded).props?.pageProps?.pageData
          : null;
        result = data?.entityData
          ? {
              entity: data.entityData,
              providerLinks: (data.sections || [])
                .flatMap((section) => section.links || [])
                .map((link) => ({
                  provider: musicProviderForUrl(link.url),
                  url: link.url,
                }))
                .filter((link) => link.provider)
                .map(({ provider, url }) => ({
                  id: provider.id,
                  label: provider.label,
                  url,
                  exact: true,
                })),
              links: (data.sections || [])
                .flatMap((section) => section.links || [])
                .filter((link) => link.platform === "amazonMusic" && link.url)
                .map((link) => link.url),
            }
          : { error: "format" };
      } catch {
        result = { error: "unavailable" };
      }
      this.store.cache(key, result, result.error ? 60000 : 86400000);
      return result;
    };
    const pending = this.queue.then(work, work);
    this.queue = pending.catch(() => {});
    return pending;
  }
  async catalogPages(item) {
    if (!this.catalog) return [];
    const title = item.kind === "track" ? item.title : item.album || item.title;
    const term = `${item.artist} ${title}`;
    const same = (artist, candidate) =>
      item.kind === "track"
        ? normalize(artist || "") === normalize(item.artist) &&
          trackKey(artist, candidate || "") === trackKey(item.artist, title)
        : albumKey(artist || "", candidate || "") ===
          albumKey(item.artist, title);
    const [apple, deezer] = await Promise.all([
      this.catalog
        .json(
          `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: item.kind === "track" ? "song" : "album", media: "music", limit: "12", country: this.country })}`,
        )
        .catch(() => null),
      this.catalog
        .json(
          `https://api.deezer.com/search/${item.kind === "track" ? "track" : "album"}?${new URLSearchParams({ q: term, limit: "12" })}`,
        )
        .catch(() => null),
    ]);
    const ap = (apple?.results || []).filter((row) =>
      same(
        row.artistName,
        item.kind === "track" ? row.trackName : row.collectionName,
      ),
    );
    const dz = (deezer?.data || []).filter((row) =>
      same(row.artist?.name, row.title),
    );
    ap.sort(
      (a, b) =>
        Number(
          normalize(
            (item.kind === "track" ? b.trackName : b.collectionName) || "",
          ) === normalize(title),
        ) -
        Number(
          normalize(
            (item.kind === "track" ? a.trackName : a.collectionName) || "",
          ) === normalize(title),
        ),
    );
    dz.sort(
      (a, b) =>
        Number(normalize(b.title || "") === normalize(title)) -
        Number(normalize(a.title || "") === normalize(title)),
    );
    return [
      ...ap
        .slice(0, 2)
        .map(
          (row) =>
            `https://${item.kind === "track" ? "song" : "album"}.link/i/${item.kind === "track" ? row.trackId : row.collectionId}`,
        ),
      ...dz
        .slice(0, 2)
        .map(
          (row) =>
            `https://${item.kind === "track" ? "song" : "album"}.link/d/${row.id}`,
        ),
    ].filter((url) => /\/\d+$/.test(url));
  }
  async providers(item, { force = false } = {}) {
    const key = `music-providers:v1:${JSON.stringify([this.country, item.kind, item.artist, item.album || item.title, item.storeUrl, item.trackUrl, item.soundcloud?.url])}`;
    if (!force) {
      const cached = this.store.cached(key);
      if (cached) return cached;
    }
    const links = new Map(
      suppliedProviderLinks(item, this.country).map((p) => [p.id, p]),
    );
    if (item.kind !== "artist") {
      const title =
        item.kind === "track" ? item.title : item.album || item.title;
      let pages = [
        ...new Set(
          [item.kind === "track" ? item.trackUrl : "", item.storeUrl]
            .filter(Boolean)
            .map((url) => pageForSource(url, item.kind))
            .filter(Boolean),
        ),
      ];
      if (!pages.length) pages = await this.catalogPages(item);
      for (const page of pages) {
        const data = await this.page(page, force);
        if (
          !data.entity ||
          data.entity.type !== (item.kind === "track" ? "song" : "album") ||
          normalize(data.entity.artistName || "") !== normalize(item.artist) ||
          normalize(data.entity.title || "") !== normalize(title)
        )
          continue;
        for (const link of data.providerLinks || []) links.set(link.id, link);
        // Compatible with cached/test sharing pages containing only Amazon links.
        for (const url of data.links || []) {
          const p = musicProviderForUrl(url);
          if (p)
            links.set(p.id, { id: p.id, label: p.label, url, exact: true });
        }
        break;
      }
    }
    const result = [...links.values()];
    this.store.cache(key, result, 600000);
    return result;
  }
  async brainzLink(item) {
    if (
      !this.catalog ||
      !/^https:\/\/musicbrainz\.org\/release-group\/[a-f0-9-]{36}$/.test(
        item.catalogUrl || "",
      ) ||
      item.kind !== "album"
    )
      return null;
    const id = item.catalogUrl.split("/").pop();
    const data = await this.catalog
      .json(
        `https://musicbrainz.org/ws/2/release-group/${id}?inc=url-rels&fmt=json`,
        undefined,
        true,
      )
      .catch(() => null);
    return (
      data?.relations
        ?.map((relation) => relation.url?.resource)
        .find((url) => isAmazonMusicUrl(url, "album")) || null
    );
  }
  async resolve(item, { force = false } = {}) {
    const fallback = searchLinks(item, this.country);
    if (item.kind === "artist")
      return { ...fallback, reason: "Artist pages use Amazon search." };
    const title = item.kind === "track" ? item.title : item.album || item.title;
    const cacheKey = `music-links:v4:${JSON.stringify([this.country, item.kind, item.artist, title, item.storeUrl || "", item.trackUrl || "", item.catalogUrl || ""])}`;
    if (!force) {
      const cached = this.store.cached(cacheKey);
      if (cached) return { ...fallback, ...cached };
    }
    if (this.pending.has(cacheKey)) return this.pending.get(cacheKey);
    const work = (async () => {
      const supplied = [
        item.kind === "track" ? item.trackUrl : "",
        item.storeUrl,
      ].filter(Boolean);
      for (const url of supplied)
        if (isAmazonMusicUrl(url, item.kind))
          return { ...fallback, amazon: url, exact: true };
      let pages = [
        ...new Set(
          supplied.map((url) => pageForSource(url, item.kind)).filter(Boolean),
        ),
      ];
      const visited = new Set(),
        alternatives = new Map();
      let reason =
          "No catalog identifier is available for a direct Amazon match.",
        expanded = false;
      while (true) {
        for (const page of pages) {
          if (visited.has(page)) continue;
          visited.add(page);
          const data = await this.page(page, force);
          if (data.error) {
            reason =
              data.error === "rate_limit"
                ? "The sharing service is rate-limiting lookups. Try again later."
                : data.error === "format"
                  ? "The sharing page format could not be read."
                  : "The sharing service could not be reached.";
            continue;
          }
          const entity = data.entity;
          if (
            entity.type !== (item.kind === "track" ? "song" : "album") ||
            albumKey(entity.artistName || "", entity.title || "") !==
              albumKey(item.artist, title)
          ) {
            reason = "The sharing page did not match this artist and release.";
            continue;
          }
          const amazon = data.links.find((url) =>
            isAmazonMusicUrl(url, item.kind),
          );
          if (!amazon) {
            reason =
              "The matching sharing pages have no Amazon Music URL. The release may still exist on Amazon.";
            continue;
          }
          if (
            item.kind === "album" &&
            normalize(entity.title) !== normalize(title)
          ) {
            alternatives.set(amazon, {
              amazon,
              title: entity.title,
              trackCount:
                Number.isInteger(entity.numTracks) && entity.numTracks > 0
                  ? entity.numTracks
                  : null,
            });
            continue;
          }
          return { ...fallback, amazon, exact: true };
        }
        if (expanded) break;
        expanded = true;
        const relation = await this.brainzLink(item);
        if (relation) return { ...fallback, amazon: relation, exact: true };
        pages = (await this.catalogPages(item)).filter(
          (page) => !visited.has(page),
        );
        if (!pages.length) break;
      }
      if (alternatives.size)
        reason =
          "Only a different edition has a direct Amazon link. Choose that edition explicitly, or use Amazon search.";
      return { ...fallback, reason, alternatives: [...alternatives.values()] };
    })()
      .then((result) => {
        this.store.cache(
          cacheKey,
          result,
          result.exact ? 7 * 86400000 : 600000,
        );
        return result;
      })
      .finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, work);
    return work;
  }
}
