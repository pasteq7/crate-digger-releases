import { test } from "node:test";
import assert from "node:assert/strict";
import { aiErrorMessage, aiJson } from "../electron/ai-http.mjs";
import { geminiModels } from "../electron/gemini.mjs";

test("provider errors distinguish invalid keys, permissions, missing models, quotas, and outages", () => {
  for (const [status, pattern] of [
    [401, /key was rejected/],
    [403, /Access was denied/],
    [404, /model is unavailable/],
    [429, /quota limit/],
    [402, /credits/],
    [503, /temporarily unavailable/],
    [400, /request was rejected/],
  ]) {
    assert.match(
      aiErrorMessage("gemini", status, {
        error: { message: "Provider detail" },
      }),
      pattern,
    );
    assert.match(
      aiErrorMessage("gemini", status, {}),
      new RegExp(`Google Gemini \\(HTTP ${status}\\)`),
    );
  }
  assert.match(
    aiErrorMessage("gemini", 400, {
      error: { message: "API key not valid. Please pass a valid API key." },
    }),
    /key was rejected/,
  );
});

test("provider details never expose request credentials, even when Google echoes them", () => {
  const key = "private-example-key";
  const message = aiErrorMessage(
    "gemini",
    400,
    {
      error: {
        message: `Bad key ${key}. Bearer another-secret; API key AIzaFakeKey4567`,
      },
    },
    key,
  );
  for (const value of [key, "another-secret", "AIzaFakeKey4567"])
    assert.ok(!message.includes(value));
  assert.match(message, /\[redacted\]/);
});

test("HTTP failures preserve sanitized Google details rather than becoming a generic settings error", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          message: "Quota exhausted for test-key",
          status: "RESOURCE_EXHAUSTED",
        },
      },
      { status: 429 },
    );
  try {
    await assert.rejects(
      () =>
        aiJson(
          "https://example.test",
          { headers: { "x-goog-api-key": "test-key" } },
          "gemini",
        ),
      (error) =>
        error.message.includes("HTTP 429") &&
        error.message.includes("Quota exhausted") &&
        !error.message.includes("test-key"),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("network, timeout, and non-JSON responses produce readable messages", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("fetch failed");
    };
    await assert.rejects(
      () => aiJson("https://example.test", {}, "gemini"),
      /Couldn't reach Google Gemini/,
    );
    globalThis.fetch = async () => {
      throw Object.assign(new Error(), { name: "TimeoutError" });
    };
    await assert.rejects(
      () => aiJson("https://example.test", {}, "gemini"),
      /timed out/,
    );
    globalThis.fetch = async () =>
      new Response("<html>bad gateway</html>", { status: 502 });
    await assert.rejects(
      () => aiJson("https://example.test", {}, "gemini"),
      /HTTP 502/,
    );
    globalThis.fetch = async () => new Response("not JSON");
    await assert.rejects(
      () => aiJson("https://example.test", {}, "gemini"),
      /unreadable response/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Gemini connection checks list accessible text models across pages without generating content", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json(
      requests.length === 1
        ? {
            nextPageToken: "page-two",
            models: [
              {
                name: "models/gemini-test-flash",
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: "models/gemini-test-image",
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: "models/embedding-test",
                supportedGenerationMethods: ["embedContent"],
              },
            ],
          }
        : {
            models: [
              {
                name: "models/gemini-test-pro",
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: "models/gemini-test-flash",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          },
    );
  };
  try {
    assert.deepEqual(await geminiModels(" test-key "), [
      "gemini-test-flash",
      "gemini-test-pro",
    ]);
    assert.equal(requests.length, 2);
    assert.ok(requests[1].url.includes("pageToken=page-two"));
    for (const request of requests) {
      assert.equal(request.options.headers["x-goog-api-key"], "test-key");
      assert.equal(request.options.body, undefined);
      assert.ok(!request.url.includes("test-key"));
    }
  } finally {
    globalThis.fetch = original;
  }
});
