import test from "node:test";
import assert from "node:assert/strict";
import { Discovery } from "../electron/discovery.mjs";
import { MusicLinks } from "../electron/music-links.mjs";
const store = () => {
  const cache = new Map();
  return {
    cached: (key) => cache.get(key),
    cache: (key, value) => cache.set(key, value),
  };
};
test("album previews prefer the requested Sinner edition and carry its reported count", async () => {
  const discovery = new Discovery(store(), null, "FR");
  discovery.json = async () => ({
    results: [
      {
        artistName: "Drowning Pool",
        collectionName: "Sinner (Unlucky 13th Anniversary Deluxe Edition)",
        trackName: "Bodies",
        previewUrl: "https://audio.test/deluxe",
        trackCount: 25,
      },
      {
        artistName: "Drowning Pool",
        collectionName: "Sinner",
        trackName: "Bodies",
        previewUrl: "https://audio.test/standard",
        trackCount: 11,
      },
    ],
  });
  const standard = await discovery.resolveAlbum(
    "Drowning Pool",
    "Sinner",
    "Bodies",
  );
  assert.equal(standard.trackCount, 11);
  assert.equal(standard.preview, "https://audio.test/standard");
  assert.equal(standard.trackCountEdition, "Sinner · FR");
  const deluxe = await discovery.resolveAlbum(
    "Drowning Pool",
    "Sinner (Unlucky 13th Anniversary Deluxe Edition)",
    "Bodies",
  );
  assert.equal(deluxe.trackCount, 25);
});
test("Deezer album counts require matching album metadata, not the preview search result length", async () => {
  const discovery = new Discovery(store());
  discovery.json = async (url) =>
    url.includes("/album/")
      ? { title: "Sinner", artist: { name: "Drowning Pool" }, nb_tracks: 11 }
      : {
          data: [
            {
              title: "Bodies",
              preview: "https://audio.test/clip",
              artist: { name: "Drowning Pool" },
              album: { id: 8015602, title: "Sinner" },
            },
          ],
        };
  assert.equal(
    (await discovery.deezerPreview("Drowning Pool", "Sinner")).trackCount,
    11,
  );
  discovery.json = async (url) =>
    url.includes("/album/")
      ? {
          title: "Another Album",
          artist: { name: "Someone Else" },
          nb_tracks: 100,
        }
      : {
          data: [
            {
              title: "Bodies",
              artist: { name: "Drowning Pool" },
              album: { id: 8015602, title: "Sinner" },
            },
          ],
        };
  assert.equal(
    (await discovery.deezerPreview("Drowning Pool", "Sinner")).trackCount,
    null,
  );
});
test("MusicBrainz counts sum all discs of a selected official edition and identify it", async () => {
  const discovery = new Discovery(store(), null, "FR");
  const group = "11111111-1111-1111-1111-111111111111",
    edition = "22222222-2222-2222-2222-222222222222";
  discovery.json = async (url) =>
    url.includes("release?")
      ? {
          releases: [
            {
              id: edition,
              title: "Double Album",
              status: "Official",
              country: "FR",
              date: "2001-06-05",
            },
          ],
        }
      : { media: [{ "track-count": 11 }, { "track-count": 14 }] };
  const counts = await discovery.musicbrainzCount(
    group,
    "Artist",
    "Double Album",
  );
  assert.equal(counts.trackCount, 25);
  assert.match(counts.trackCountEdition, /FR.*2001-06-05/);
  discovery.json = async () => ({ releases: [] });
  assert.deepEqual(
    await discovery.musicbrainzCount(group, "Artist", "Double Album"),
    {},
  );
});
test("unknown album counts stay unknown and standalone tracks never use a parent album count", async () => {
  const discovery = new Discovery(store());
  discovery.resolveAlbum = async () => ({ preview: null });
  assert.deepEqual(
    await discovery.countFor({
      kind: "album",
      artist: "Unknown",
      title: "Rare Release",
    }),
    { trackCount: null },
  );
  assert.deepEqual(
    await discovery.countFor({
      kind: "track",
      artist: "Unknown",
      title: "Single",
    }),
    {},
  );
});
test("Sinner missing Amazon mappings offer a 14-track anniversary alternative without replacing the 11-track release", async () => {
  const catalog = {
    json: async (url) =>
      url.includes("itunes")
        ? {
            results: [
              {
                artistName: "Drowning Pool",
                collectionName: "Sinner",
                collectionId: 1440777715,
              },
            ],
          }
        : {
            data: [
              {
                artist: { name: "Drowning Pool" },
                title: "Sinner (25th Anniversary)",
                id: 993678671,
              },
            ],
          },
  };
  const links = new MusicLinks(store(), "FR", catalog);
  const pages = [];
  links.page = async (url) => {
    pages.push(url);
    return url.includes("/d/")
      ? {
          entity: {
            type: "album",
            artistName: "Drowning Pool",
            title: "Sinner (25th Anniversary)",
            numTracks: 14,
          },
          links: ["https://music.amazon.com/albums/B0GSXB6DS8"],
        }
      : {
          entity: {
            type: "album",
            artistName: "Drowning Pool",
            title: "Sinner",
            numTracks: 11,
          },
          links: [],
        };
  };
  const result = await links.resolve({
    kind: "album",
    artist: "Drowning Pool",
    title: "Sinner",
    storeUrl: "https://music.apple.com/fr/album/sinner/1440777715",
  });
  assert.equal(result.exact, false);
  assert.match(result.amazon, /music.amazon.fr\/search\//);
  assert.match(result.reason, /different edition/);
  assert.deepEqual(result.alternatives, [
    {
      amazon: "https://music.amazon.com/albums/B0GSXB6DS8",
      title: "Sinner (25th Anniversary)",
      trackCount: 14,
    },
  ]);
  assert.equal(pages.length, 2);
});
test("Amazon lookup can recover a source-less exact album from catalog identifiers", async () => {
  const links = new MusicLinks(store(), "FR", {
    json: async (url) =>
      url.includes("itunes")
        ? {
            results: [
              {
                artistName: "Beach House",
                collectionName: "Bloom",
                collectionId: 509665145,
              },
            ],
          }
        : { data: [] },
  });
  links.page = async () => ({
    entity: {
      type: "album",
      artistName: "Beach House",
      title: "Bloom",
      numTracks: 10,
    },
    links: ["https://music.amazon.com/albums/B00DVSJVK8"],
  });
  const result = await links.resolve({
    kind: "album",
    artist: "Beach House",
    title: "Bloom",
  });
  assert.equal(result.exact, true);
  assert.equal(result.amazon, "https://music.amazon.com/albums/B00DVSJVK8");
});
test("explicit Amazon retry bypasses failed mapping cache and never accepts a search URL as a direct release", async () => {
  const links = new MusicLinks(store());
  let available = false,
    calls = 0;
  links.page = async () => {
    calls++;
    return {
      entity: { type: "album", artistName: "Artist", title: "Album" },
      links: available
        ? [
            "https://music.amazon.com/search/Album",
            "https://music.amazon.com/albums/B00DVSJVK8",
          ]
        : [],
    };
  };
  const item = {
    kind: "album",
    artist: "Artist",
    title: "Album",
    storeUrl: "https://music.apple.com/us/album/album/123",
  };
  assert.equal((await links.resolve(item)).exact, false);
  available = true;
  assert.equal((await links.resolve(item)).exact, false);
  const result = await links.resolve(item, { force: true });
  assert.equal(result.exact, true);
  assert.equal(result.amazon, "https://music.amazon.com/albums/B00DVSJVK8");
  assert.equal(calls, 2);
});
