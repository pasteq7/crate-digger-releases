import { test } from "node:test";
import assert from "node:assert/strict";
import {
  musicProviderForUrl,
  providerSearchLinks,
} from "../electron/music-providers.mjs";
import { MusicLinks, allowedExternal } from "../electron/music-links.mjs";

const item = {
  kind: "album",
  artist: "Artist & Guests",
  title: "Album",
  storeUrl: "https://music.apple.com/us/album/album/123",
};
const store = () => {
  const map = new Map();
  return { cached: (k) => map.get(k), cache: (k, v) => map.set(k, v) };
};

test("music providers have encoded search URLs and browser-safe host validation", () => {
  const links = providerSearchLinks(item, "FR");
  assert.ok(links.length >= 12);
  for (const link of links) {
    assert.equal(allowedExternal(link.url), true);
    assert.equal(musicProviderForUrl(link.url).id, link.id);
    assert.equal(link.exact, false);
  }
  assert.match(
    links.find((p) => p.id === "amazon").url,
    /^https:\/\/music.amazon.fr/,
  );
  assert.match(
    links.find((p) => p.id === "spotify").url,
    /Artist%20%26%20Guests%20Album/,
  );
  assert.equal(
    musicProviderForUrl("https://artist.bandcamp.com/album/name").id,
    "bandcamp",
  );
  for (const url of [
    "https://bandcamp.com.evil.example/album/x",
    "https://user:secret@open.spotify.com/album/x",
    "https://open.spotify.com:8443/album/x",
    "file:///C:/music",
    "https://evil.example",
  ]) {
    assert.equal(musicProviderForUrl(url), null);
    assert.equal(allowedExternal(url), false);
  }
});

test("sharing pages expose all supported provider URLs while dropping unsafe links", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            pageData: {
              entityData: {
                type: "album",
                artistName: item.artist,
                title: item.title,
              },
              sections: [
                {
                  links: [
                    {
                      platform: "spotify",
                      url: "https://open.spotify.com/album/real",
                    },
                    {
                      platform: "qobuz",
                      url: "https://www.qobuz.com/us-en/album/real",
                    },
                    { platform: "tidal", url: "https://tidal.com/album/real" },
                    {
                      platform: "bandcamp",
                      url: "https://artist.bandcamp.com/album/real",
                    },
                    {
                      platform: "spotify",
                      url: "https://open.spotify.com.evil.example/album/fake",
                    },
                    {
                      platform: "amazonMusic",
                      url: "https://music.amazon.com/albums/B00DVSJVK8",
                    },
                  ],
                },
              ],
            },
          },
        },
      })}</script>`,
    );
  try {
    const links = await new MusicLinks(store()).providers(item);
    for (const id of [
      "apple",
      "spotify",
      "qobuz",
      "tidal",
      "bandcamp",
      "amazon",
    ])
      assert.equal(links.find((p) => p.id === id).exact, true);
    assert.ok(links.every((p) => !p.url.includes("evil.example")));
  } finally {
    globalThis.fetch = original;
  }
});

test("different editions never become direct matches; provider searches remain available", async () => {
  const links = new MusicLinks(store());
  links.page = async () => ({
    entity: { type: "album", artistName: item.artist, title: "Album (Deluxe)" },
    providerLinks: [
      {
        id: "spotify",
        label: "Spotify",
        url: "https://open.spotify.com/album/deluxe",
        exact: true,
      },
    ],
  });
  const result = await links.providers(item);
  assert.equal(result.find((p) => p.id === "spotify").exact, false);
  assert.match(result.find((p) => p.id === "spotify").url, /\/search\//);
});
