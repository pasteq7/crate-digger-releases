import { test } from "node:test";
import assert from "node:assert/strict";
import { AlbumTracks } from "../electron/album-tracks.mjs";

const item = {
  kind: "album",
  artist: "Artist",
  title: "Album",
  storeUrl: "https://music.apple.com/us/album/album/123",
};
test("Apple lists every track across discs, retaining guests and tracks with no preview", async () => {
  const calls = [];
  const service = new AlbumTracks({
    country: "US",
    json: async (url) => {
      calls.push(url);
      return {
        results: [
          {
            wrapperType: "collection",
            collectionId: 123,
            artistName: "Artist",
            collectionName: "Album",
            trackCount: 3,
          },
          ...[
            {
              trackId: 3,
              discNumber: 2,
              trackNumber: 1,
              artistName: "Guest",
              previewUrl: "https://audio.example/three",
            },
            { trackId: 2, discNumber: 1, trackNumber: 2 },
            {
              trackId: 1,
              discNumber: 1,
              trackNumber: 1,
              previewUrl: "http://audio.example/one",
            },
            { trackId: 9, collectionId: 999, discNumber: 1, trackNumber: 1 },
          ].map((row) => ({
            wrapperType: "track",
            kind: "song",
            collectionId: 123,
            collectionName: "Album",
            artistName: "Artist",
            trackName: `Song ${row.trackId}`,
            trackTimeMillis: 123000,
            ...row,
          })),
        ],
      };
    },
  });
  const result = await service.list(item);
  assert.deepEqual(
    result.tracks.map((t) => t.id),
    ["apple:1", "apple:2", "apple:3"],
  );
  assert.equal(result.tracks[1].preview, null);
  assert.equal(result.tracks[2].artist, "Guest");
  assert.equal(result.tracks[0].preview, "https://audio.example/one");
  assert.equal(result.complete, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/itunes.apple.com\/lookup\?/);
});

test("Deezer follows album pagination in order, without dropping tracks lacking previews", async () => {
  const calls = [];
  const track = (id) => ({
    id,
    title: `Song ${id}`,
    artist: { name: "Artist" },
    preview: id === 2 ? null : `https://audio.example/${id}`,
    duration: 180,
  });
  const service = new AlbumTracks({
    country: "FR",
    json: async (url) => {
      calls.push(url);
      if (url.includes("itunes.apple.com")) return { results: [] };
      if (url.endsWith("/album/7"))
        return {
          id: 7,
          artist: { name: "Artist" },
          title: "Album",
          nb_tracks: 3,
          tracks: {
            data: [track(1)],
            next: "https://api.deezer.com/album/7/tracks?index=1&limit=1",
          },
        };
      if (url.includes("index=1")) return { data: [track(2), track(3)] };
      throw new Error(`Unexpected ${url}`);
    },
  });
  const result = await service.list({
    ...item,
    storeUrl: "https://www.deezer.com/album/7",
  });
  assert.equal(result.source, "Deezer");
  assert.deepEqual(
    result.tracks.map((t) => t.id),
    ["deezer:1", "deezer:2", "deezer:3"],
  );
  assert.equal(result.tracks[1].preview, null);
  assert.equal(result.complete, true);
  assert.ok(
    calls.includes("https://api.deezer.com/album/7/tracks?limit=100&index=1"),
  );
});

test("never accepts another album or follows arbitrary catalog URLs", async () => {
  const calls = [];
  const service = new AlbumTracks({
    country: "US",
    json: async (url) => {
      calls.push(url);
      if (url.includes("itunes"))
        return {
          results: [
            {
              wrapperType: "collection",
              collectionId: 123,
              artistName: "Wrong",
              collectionName: "Album",
            },
          ],
        };
      if (url.includes("search/album"))
        return { data: [{ id: 1, artist: { name: "Wrong" }, title: "Album" }] };
      throw new Error("Unexpected URL");
    },
  });
  assert.equal((await service.list(item)).tracks.length, 0);
  await service.list({ ...item, storeUrl: "https://evil.example/album/123" });
  assert.ok(calls.every((url) => new URL(url).hostname !== "evil.example"));
});

test("reports incomplete lists and rejects hostile pagination links", async () => {
  const calls = [];
  const service = new AlbumTracks({
    country: "US",
    json: async (url) => {
      calls.push(url);
      if (url.includes("itunes")) return { results: [] };
      return {
        artist: { name: "Artist" },
        title: "Album",
        nb_tracks: 3,
        tracks: {
          data: [{ id: 1, title: "Song", preview: "https://audio.example/1" }],
          next: "https://evil.example/album/7/tracks?index=1",
        },
      };
    },
  });
  const result = await service.list({
    ...item,
    storeUrl: "https://www.deezer.com/album/7",
  });
  assert.equal(result.tracks.length, 1);
  assert.equal(result.complete, false);
  assert.ok(calls.every((url) => !url.includes("evil.example")));
});

test("outages produce a retryable message and refresh requests bypass older preview metadata", async () => {
  const keys = [];
  const service = new AlbumTracks({
    country: "US",
    json: async (url, key) => {
      keys.push(key);
      throw new Error("offline");
    },
  });
  const result = await service.list(item, { refresh: true });
  assert.match(result.message, /unavailable/);
  assert.ok(keys.every((key) => key.includes(":refresh:")));
});
