import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultGeminiModel,
  geminiRequest,
  geminiText,
} from "../electron/gemini.mjs";

test("Gemini sends a text-only request with header authentication to Google's fixed host", () => {
  const request = geminiRequest(
    "models/gemini-3.8-flash",
    "Explain this record.",
    "test-google-key",
  );
  assert.equal(
    request.url,
    `https://generativelanguage.googleapis.com/v1beta/models/${defaultGeminiModel}:generateContent`,
  );
  assert.equal(new URL(request.url).search, "");
  assert.equal(request.headers["x-goog-api-key"], "test-google-key");
  assert.equal(request.headers.Authorization, undefined);
  assert.deepEqual(request.body.contents, [
    { role: "user", parts: [{ text: "Explain this record." }] },
  ]);
  assert.equal(request.body.generationConfig.maxOutputTokens, 1024);
  assert.equal(geminiRequest("", "Prompt", "key").url, request.url);
});

test("Gemini model names cannot override the API host or inject URL parameters", () => {
  for (const name of [
    "https://example.com",
    "../other",
    "gemini?key=secret",
    "models/../other",
    "   ",
  ]) {
    assert.throws(
      () => geminiRequest(name, "Prompt", "key"),
      /Gemini model name/,
    );
  }
});

test("Gemini joins response text and skips thought and non-text parts", () => {
  assert.equal(
    geminiText({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "Internal thought" },
              { text: "A familiar " },
              { inlineData: {} },
              { text: "guitar sound." },
            ],
          },
        },
      ],
    }),
    "A familiar guitar sound.",
  );
  assert.equal(
    geminiText({
      candidates: [{ content: { parts: [{ text: "x".repeat(900) }] } }],
    }).length,
    600,
  );
});

test("Gemini safety blocks and empty responses surface a useful error", () => {
  for (const data of [
    {},
    { promptFeedback: { blockReason: "SAFETY" } },
    { candidates: [{ finishReason: "SAFETY" }] },
    {
      candidates: [
        { content: { parts: [{ thought: true, text: "Only thoughts" }] } },
      ],
    },
  ]) {
    assert.throws(() => geminiText(data), /returned no explanation/);
  }
});
