import { test } from "node:test";
import assert from "node:assert/strict";
import { aiErrorMessage, aiJson as requestJson } from "../electron/ai-http.mjs";
const aiJson = (url, options, provider, retry = {}) =>
  requestJson(url, options, provider, {
    sleep: async () => {},
    random: () => 0,
    ...retry,
  });
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

test("transient HTTP, network, timeout and unreadable failures recover with exponential backoff", async () => {
  const original = globalThis.fetch;
  try {
    for (const failure of [408, 429, 500, 503, "network", "timeout", "json"]) {
      let calls = 0;
      const waits = [],
        attempts = [];
      globalThis.fetch = async () => {
        if (++calls === 3) return Response.json({ ok: true });
        if (failure === "network") throw new TypeError("fetch failed");
        if (failure === "timeout")
          throw Object.assign(new Error(), { name: "TimeoutError" });
        if (failure === "json") return new Response("bad JSON");
        return Response.json({}, { status: failure });
      };
      assert.deepEqual(
        await aiJson("https://example.test", {}, "gemini", {
          sleep: async (delay) => waits.push(delay),
          onAttempt: (n) => attempts.push(n),
        }),
        { ok: true },
      );
      assert.deepEqual(attempts, [1, 2, 3]);
      assert.deepEqual(waits, [1000, 2000]);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("permanent HTTP errors fail once and transient errors stop after three attempts", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [400, 401, 402, 403, 404, 429, 503]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json({}, { status });
      };
      await assert.rejects(
        () => aiJson("https://example.test", {}, "openai"),
        new RegExp(`HTTP ${status}`),
      );
      assert.equal(calls, status >= 429 ? 3 : 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("honors Retry-After seconds and HTTP dates within the bounded wait", async () => {
  const original = globalThis.fetch;
  try {
    for (const header of [
      "5",
      new Date(Date.now() + 15000).toUTCString(),
      "9999",
      "invalid",
    ]) {
      let calls = 0;
      const waits = [];
      globalThis.fetch = async () =>
        ++calls === 1
          ? Response.json(
              {},
              { status: 429, headers: { "Retry-After": header } },
            )
          : Response.json({});
      await aiJson("https://example.test", {}, "openai", {
        sleep: async (delay) => waits.push(delay),
      });
      if (header === "5") assert.equal(waits[0], 5000);
      else if (header === "9999") assert.equal(waits[0], 60000);
      else if (header === "invalid") assert.equal(waits[0], 1000);
      else assert.ok(waits[0] >= 13000 && waits[0] <= 15000);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("cancellation before fetch, during fetch, and during backoff never retries", async () => {
  const original = globalThis.fetch;
  try {
    for (const phase of ["before", "fetch", "backoff"]) {
      const controller = new AbortController();
      let calls = 0;
      if (phase === "before") controller.abort();
      globalThis.fetch = async () => {
        calls++;
        if (phase === "fetch") {
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        }
        return Response.json({}, { status: 503 });
      };
      await assert.rejects(
        () =>
          requestJson(
            "https://example.test",
            { signal: controller.signal },
            "gemini",
            {
              onRetry: () => controller.abort(),
            },
          ),
        { name: "AbortError" },
      );
      assert.equal(calls, phase === "before" ? 0 : 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});
