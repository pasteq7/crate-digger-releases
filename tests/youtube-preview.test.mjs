import { test } from "node:test";
import assert from "node:assert/strict";
import {
  YoutubePreviews,
  youtubeVideoId,
  youtubeEmbedHeaders,
  youtubeAppIdentity,
} from "../electron/youtube-preview.mjs";

const item = {
  kind: "album",
  artist: "Beach House",
  title: "Bloom",
  previewTrack: "Myth",
};
const cacheStore = () => {
  const cache = new Map();
  return {
    cached: (key) => cache.get(key),
    cache: (key, value) => cache.set(key, value),
  };
};
const video = (
  id,
  title = "Beach House - Bloom (Full album)",
  channel = "Beach House",
  extra = {},
) => ({
  id,
  snippet: { title, channelTitle: channel, liveBroadcastContent: "none" },
  status: { embeddable: true, privacyStatus: "public" },
  contentDetails: { duration: "PT49M" },
  ...extra,
});
test("YouTube link parsing accepts only actual video URLs and canonical IDs", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=ABCDEFGHIJK&list=ignored",
    "https://youtu.be/ABCDEFGHIJK?t=30",
    "https://m.youtube.com/shorts/ABCDEFGHIJK",
    "https://www.youtube-nocookie.com/embed/ABCDEFGHIJK",
    "https://www.youtube.com/live/ABCDEFGHIJK",
  ])
    assert.equal(youtubeVideoId(url), "ABCDEFGHIJK");
  for (const url of [
    "ABCDEFGHIJK",
    "javascript:alert(1)",
    "file:///music",
    "https://youtube.com.evil.test/watch?v=ABCDEFGHIJK",
    "https://youtu.be/ABCDEFGHIJK/extra",
    "https://www.youtube.com/playlist?list=ABCDEFGHIJK",
    "https://user:pass@youtu.be/ABCDEFGHIJK",
    "https://youtu.be:444/ABCDEFGHIJK",
    "http://youtu.be/ABCDEFGHIJK",
    "https://www.youtube.com/watch?v=too-short",
    "https://youtu.be/ABCDEFGHIJ%2F",
  ])
    assert.equal(youtubeVideoId(url), null, url);
});
test("desktop identity header is limited to the app's YouTube embed subframes", () => {
  const request = {
    webContentsId: 5,
    resourceType: "subFrame",
    url: "https://www.youtube.com/embed/ABCDEFGHIJK?autoplay=0",
    requestHeaders: { referer: "file:///private/path", Accept: "*/*" },
  };
  assert.deepEqual(youtubeEmbedHeaders(request, 5), {
    Referer: youtubeAppIdentity,
    Accept: "*/*",
  });
  for (const change of [
    { webContentsId: 6 },
    { resourceType: "mainFrame" },
    { url: "https://www.youtube.com/watch?v=ABCDEFGHIJK" },
    { url: "https://www.youtube.com.evil.test/embed/ABCDEFGHIJK" },
  ])
    assert.deepEqual(
      youtubeEmbedHeaders({ ...request, ...change }, 5),
      request.requestHeaders,
    );
});
test("YouTube search checks playable videos, ranks title/artist matches and caches concurrent requests", async () => {
  let calls = 0;
  const service = new YoutubePreviews(
    cacheStore(),
    () => "secret-test-key",
    "FR",
    async (url, options) => {
      calls++;
      const u = new URL(url);
      assert.equal(options.headers["X-Goog-Api-Key"], "secret-test-key");
      assert.equal(url.includes("secret-test-key"), false);
      if (u.pathname.endsWith("/search")) {
        assert.equal(u.searchParams.get("videoEmbeddable"), "true");
        assert.equal(u.searchParams.get("regionCode"), "FR");
        assert.equal(u.searchParams.get("q"), "Beach House Bloom full album");
        return Response.json({
          items: [
            "AAAAAAAAAAA",
            "BBBBBBBBBBB",
            "CCCCCCCCCCC",
            "DDDDDDDDDDD",
            "EEEEEEEEEEE",
            "FFFFFFFFFFF",
          ].map((videoId) => ({ id: { videoId } })),
        });
      }
      return Response.json({
        items: [
          video("AAAAAAAAAAA", "Bloom - gardening", "Flowers"),
          video("BBBBBBBBBBB"),
          video("CCCCCCCCCCC", undefined, undefined, {
            status: { embeddable: false, privacyStatus: "public" },
          }),
          video("DDDDDDDDDDD", undefined, undefined, {
            contentDetails: { regionRestriction: { blocked: ["FR"] } },
          }),
          video("EEEEEEEEEEE", undefined, undefined, {
            snippet: { liveBroadcastContent: "live" },
          }),
          video("FFFFFFFFFFF", undefined, undefined, {
            contentDetails: { regionRestriction: { allowed: ["US"] } },
          }),
          video("NOTINSEARCH"),
        ],
      });
    },
  );
  const [first, duplicate] = await Promise.all([
    service.search(item),
    service.search(item),
  ]);
  assert.deepEqual(first, duplicate);
  assert.deepEqual(
    first.map((v) => v.id),
    ["BBBBBBBBBBB", "AAAAAAAAAAA"],
  );
  assert.equal(first[0].closeMatch, true);
  assert.equal(first[1].closeMatch, false);
  assert.equal("catalogVerified" in first[0], false);
  assert.deepEqual(await service.search(item), first);
  assert.equal(calls, 2);
});
test("missing key, invalid records, quotas and network errors never expose credentials or cache failures", async () => {
  let calls = 0;
  const noKey = new YoutubePreviews(
    cacheStore(),
    () => "",
    "US",
    () => {
      calls++;
    },
  );
  await assert.rejects(noKey.search(item), /Add a YouTube Data API key/);
  await assert.rejects(noKey.search({ ...item, artist: {} }), /Invalid record/);
  assert.equal(calls, 0);
  for (const failure of ["quota", "denied", "network"]) {
    const service = new YoutubePreviews(
      cacheStore(),
      () => "secret-test-key",
      "US",
      async () => {
        calls++;
        if (failure === "network") throw new Error("secret-test-key");
        return Response.json(
          {
            error: {
              message: "secret-test-key",
              errors: [
                {
                  reason: failure === "quota" ? "quotaExceeded" : "keyInvalid",
                },
              ],
            },
          },
          { status: 403 },
        );
      },
    );
    const before = calls;
    for (let i = 0; i < 2; i++)
      await assert.rejects(service.search(item), (error) => {
        assert.equal(error.message.includes("secret-test-key"), false);
        assert.match(
          error.message,
          failure === "quota"
            ? /quota reached/
            : failure === "network"
              ? /could not be reached/
              : /Check the saved key/,
        );
        return true;
      });
    assert.equal(calls - before, 2);
  }
});
