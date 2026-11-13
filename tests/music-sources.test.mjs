import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MusicLinks,
  searchLinks,
  allowedExternal,
} from "../electron/music-links.mjs";
import { Discovery } from "../electron/discovery.mjs";
import { discoveryPrompt } from "../electron/ai-discovery.mjs";
const item = {
  kind: "album",
  title: "Bloom",
  artist: "Beach House",
  storeUrl: "https://music.apple.com/us/album/wild/509665145?i=509665326",
};
const store = () => {
  const cache = new Map();
  return { cached: (k) => cache.get(k), cache: (k, v) => cache.set(k, v) };
};
test("Amazon links use album identity, verified public page mapping and cache; search fallback is explicit", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(url, "https://album.link/i/509665145");
    return new Response(
      '<script id="__NEXT_DATA__" type="application/json">' +
        JSON.stringify({
          props: {
            pageProps: {
              pageData: {
                entityData: {
                  type: "album",
                  artistName: "Beach House",
                  title: "Bloom",
                },
                sections: [
                  {
                    links: [
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
        }) +
        "</script>",
    );
  };
  try {
    const links = new MusicLinks(store(), "FR");
    const result = await links.resolve(item);
    assert.equal(result.exact, true);
    assert.equal(result.amazon, "https://music.amazon.com/albums/B00DVSJVK8");
    await links.resolve(item);
    assert.equal(calls, 1);
    const fallback = await links.resolve({ ...item, storeUrl: undefined });
    assert.equal(fallback.exact, false);
    assert.ok(
      fallback.amazon.includes("music.amazon.fr/search/Beach%20House%20Bloom"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("unmatched entities, malicious hosts and unavailable metadata never become direct Amazon links", async () => {
  const original = globalThis.fetch;
  for (const [artist, url] of [
    ["Wrong Artist", "https://music.amazon.com/albums/B123"],
    ["Beach House", "https://music.amazon.com.evil.test/albums/B123"],
  ]) {
    globalThis.fetch = async () =>
      new Response(
        '<script id="__NEXT_DATA__">' +
          JSON.stringify({
            props: {
              pageProps: {
                pageData: {
                  entityData: {
                    type: "album",
                    artistName: artist,
                    title: "Bloom",
                  },
                  sections: [{ links: [{ platform: "amazonMusic", url }] }],
                },
              },
            },
          }) +
          "</script>",
      );
    try {
      assert.equal((await new MusicLinks(store()).resolve(item)).exact, false);
    } finally {
      globalThis.fetch = original;
    }
  }
  assert.equal(allowedExternal("file:///C:/Windows/System32/cmd.exe"), false);
  assert.equal(
    allowedExternal("https://music.amazon.fr.evil.test/albums/a"),
    false,
  );
  assert.equal(
    allowedExternal("https://user:pass@music.amazon.fr/albums/a"),
    false,
  );
  assert.equal(allowedExternal(searchLinks(item).youtube), true);
});
test("Deezer fallback accepts exact Dub album/artist and rejects a same-title track on a compilation", async () => {
  const d = new Discovery(store());
  d.json = async (url) =>
    new URL(url).hostname === "api.deezer.com"
      ? {
          data: [
            {
              title: "Dub From The Roots",
              preview: "https://wrong/clip",
              artist: { name: "King Tubby" },
              album: { title: "Generic Dub Hits", id: 1 },
            },
            {
              title: "Dub From The Roots",
              preview: "https://right/clip",
              artist: { name: "King Tubby" },
              album: {
                title: "Dub From The Roots",
                id: 128803,
                cover_big: "https://art/cover",
              },
            },
            {
              title: "Dub From The Roots",
              preview: "https://wrong/other",
              artist: { name: "Other Artist" },
              album: { title: "Dub From The Roots", id: 3 },
            },
          ],
        }
      : { results: [] };
  const result = await d.resolveAlbum(
    "King Tubby",
    "Dub From The Roots",
    "Dub From The Roots",
  );
  assert.equal(result.preview, "https://right/clip");
  assert.equal(result.previewSource, "deezer");
  assert.equal(result.storeUrl, "https://www.deezer.com/album/128803");
  d.json = async () => ({
    data: [
      {
        title: "Wanted",
        preview: "https://wrong/clip",
        artist: { name: "Other Artist" },
        album: { title: "Dub From The Roots" },
      },
    ],
  });
  assert.equal(await d.deezerPreview("King Tubby", "Dub From The Roots"), null);
});
test("AI prompt keeps niche musical relevance ahead of preview availability and carries listener direction", () => {
  const p = discoveryPrompt(
    { albums: [], label: "Dub" },
    "safe",
    [],
    0,
    "UK steppers, no dub techno",
  );
  assert.ok(p.includes("regardless of streaming or preview availability"));
  assert.ok(p.includes("UK steppers, no dub techno"));
  assert.ok(p.includes("distinct scenes"));
});
