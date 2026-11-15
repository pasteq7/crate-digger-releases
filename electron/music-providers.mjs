// Shared names and browser destinations; provider URLs never become shell commands.
export const musicProviders = [
  {
    id: "amazon",
    label: "Amazon Music",
    hosts: [
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
    ],
  },
  { id: "apple", label: "Apple Music", hosts: ["music.apple.com"] },
  { id: "spotify", label: "Spotify", hosts: ["open.spotify.com"] },
  { id: "deezer", label: "Deezer", hosts: ["deezer.com", "www.deezer.com"] },
  {
    id: "tidal",
    label: "TIDAL",
    hosts: ["tidal.com", "www.tidal.com", "listen.tidal.com"],
  },
  {
    id: "bandcamp",
    label: "Bandcamp",
    hosts: ["bandcamp.com"],
    subdomains: true,
  },
  {
    id: "soundcloud",
    label: "SoundCloud",
    hosts: ["soundcloud.com", "www.soundcloud.com", "on.soundcloud.com"],
  },
  {
    id: "youtube",
    label: "YouTube",
    hosts: ["www.youtube.com", "youtube.com", "youtu.be"],
  },
  { id: "youtubeMusic", label: "YouTube Music", hosts: ["music.youtube.com"] },
  {
    id: "beatport",
    label: "Beatport",
    hosts: ["www.beatport.com", "beatport.com"],
  },
  {
    id: "traxsource",
    label: "Traxsource",
    hosts: ["www.traxsource.com", "traxsource.com"],
  },
  {
    id: "discogs",
    label: "Discogs",
    hosts: ["www.discogs.com", "discogs.com"],
  },
  {
    id: "qobuz",
    label: "Qobuz",
    hosts: ["www.qobuz.com", "qobuz.com", "open.qobuz.com", "play.qobuz.com"],
  },
  {
    id: "pandora",
    label: "Pandora",
    hosts: ["www.pandora.com", "pandora.com"],
  },
  {
    id: "napster",
    label: "Napster",
    hosts: ["play.napster.com", "app.napster.com", "www.napster.com"],
  },
  {
    id: "audiomack",
    label: "Audiomack",
    hosts: ["audiomack.com", "www.audiomack.com"],
  },
  {
    id: "anghami",
    label: "Anghami",
    hosts: ["play.anghami.com", "www.anghami.com"],
  },
  {
    id: "boomplay",
    label: "Boomplay",
    hosts: ["www.boomplay.com", "boomplay.com"],
  },
  {
    id: "yandex",
    label: "Yandex Music",
    hosts: ["music.yandex.ru", "music.yandex.com"],
  },
  { id: "qqmusic", label: "QQ Music", hosts: ["y.qq.com"] },
  { id: "netease", label: "NetEase Music", hosts: ["music.163.com"] },
  { id: "itunes", label: "iTunes", hosts: ["itunes.apple.com"] },
  {
    id: "amazonStore",
    label: "Amazon Store",
    hosts: [
      "www.amazon.com",
      "www.amazon.fr",
      "www.amazon.de",
      "www.amazon.co.uk",
    ],
  },
];

export function musicProviderForUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    return (
      musicProviders.find(
        (p) =>
          p.hosts.includes(url.hostname) ||
          (p.subdomains &&
            p.hosts.some((host) => url.hostname.endsWith(`.${host}`))),
      ) || null
    );
  } catch {
    return null;
  }
}

export function providerSearchLinks(item, country = "US") {
  const term =
    `${item.artist} ${item.kind === "artist" ? "" : item.kind === "track" ? item.title : item.album || item.title}`.trim();
  const q = encodeURIComponent(term);
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
  const urls = {
    amazon: `https://music.amazon.${suffix}/search/${q}`,
    apple: `https://music.apple.com/${country.toLowerCase()}/search?term=${q}`,
    spotify: `https://open.spotify.com/search/${q}`,
    deezer: `https://www.deezer.com/search/${q}`,
    tidal: `https://listen.tidal.com/search?q=${q}`,
    bandcamp: `https://bandcamp.com/search?q=${q}`,
    soundcloud: `https://soundcloud.com/search?q=${q}`,
    youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(term + (item.kind === "album" ? " full album" : ""))}`,
    youtubeMusic: `https://music.youtube.com/search?q=${q}`,
    beatport: `https://www.beatport.com/search?q=${q}`,
    traxsource: `https://www.traxsource.com/search?term=${q}`,
    discogs: `https://www.discogs.com/search/?q=${q}&type=${item.kind === "artist" ? "artist" : "release"}`,
  };
  return musicProviders
    .filter((p) => urls[p.id])
    .map(({ id, label }) => ({ id, label, url: urls[id], exact: false }));
}

export function suppliedProviderLinks(item, country = "US") {
  const links = new Map(
    providerSearchLinks(item, country).map((p) => [p.id, p]),
  );
  for (const url of [
    item.storeUrl,
    item.kind === "track" ? item.trackUrl : "",
    item.soundcloud?.url,
  ].filter(Boolean)) {
    const provider = musicProviderForUrl(url);
    if (provider)
      links.set(provider.id, {
        id: provider.id,
        label: provider.label,
        url,
        exact: true,
      });
  }
  return [...links.values()];
}
