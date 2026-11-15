import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import { AiActivity, tokenUsage } from "../electron/ai-activity.mjs";
import { AiService } from "../electron/ai-service.mjs";
import { aiJson } from "../electron/ai-http.mjs";
import { Store } from "../electron/store.mjs";

test("normalizes all providers, including reasoning and cached subsets without double counting", () => {
  assert.deepEqual(
    tokenUsage("gemini", {
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 30,
        totalTokenCount: 150,
        cachedContentTokenCount: 70,
      },
    }),
    { input: 100, output: 50, total: 150, reasoning: 30, cached: 70 },
  );
  assert.deepEqual(
    tokenUsage("openai", {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        completion_tokens_details: { reasoning_tokens: 30 },
        prompt_tokens_details: { cached_tokens: 70 },
      },
    }),
    { input: 100, output: 50, total: 150, reasoning: 30, cached: 70 },
  );
  assert.deepEqual(
    tokenUsage("ollama", { prompt_eval_count: 7, eval_count: 3 }),
    { input: 7, output: 3, total: 10, reasoning: null, cached: null },
  );
  assert.deepEqual(tokenUsage("gemini", {}), {
    input: null,
    output: null,
    total: null,
    reasoning: null,
    cached: null,
  });
  assert.equal(
    tokenUsage("openai", {
      usage: { prompt_tokens: -1, completion_tokens: "20" },
    }).total,
    null,
  );
});

const memory = () => {
  const map = new Map();
  return {
    get: (k, fallback) => structuredClone(map.get(k) ?? fallback),
    set: (k, v) => map.set(k, structuredClone(v)),
  };
};

test("tracks retry progress, usage, missing counts and sanitized failure details across restarts", async () => {
  const original = globalThis.fetch;
  const store = memory(),
    updates = [];
  const activity = new AiActivity(
    store,
    (state) => updates.push(structuredClone(state)),
    (...args) =>
      aiJson(...args.slice(0, 3), {
        ...args[3],
        sleep: async () => {},
        random: () => 0,
      }),
  );
  let n = 0;
  globalThis.fetch = async () =>
    ++n === 1
      ? Response.json(
          { error: { message: "Unavailable private-key" } },
          { status: 503 },
        )
      : Response.json({
          response: "A record explanation",
          prompt_eval_count: 8,
          eval_count: 12,
        });
  try {
    const service = new AiService(
      () => ({
        ai: "ollama",
        aiModel: "test",
        aiEndpoint: "http://localhost:11434",
      }),
      () => "",
      activity,
    );
    assert.equal(
      await service.generate("private prompt", { purpose: "Explain record" }),
      "A record explanation",
    );
    assert.equal(n, 2);
    assert.ok(updates.some((s) => s.calls[0]?.status === "retrying"));
    assert.equal(activity.state.calls[0].attempts, 2);
    assert.equal(activity.state.calls[0].status, "succeeded");
    assert.equal(activity.state.calls[0].usage.total, 20);
    assert.equal(activity.state.totals.unreported, 1);
    assert.ok(
      !JSON.stringify(store.get("aiActivity")).includes("private prompt"),
    );
    globalThis.fetch = async () =>
      Response.json(
        { error: { message: "Rejected private-key" } },
        { status: 401 },
      );
    await assert.rejects(
      () =>
        activity.request(
          "https://example.test",
          { headers: { Authorization: "Bearer private-key" } },
          "openai",
        ),
      /key was rejected/,
    );
    assert.ok(
      !JSON.stringify(store.get("aiActivity")).includes("Rejected private-key"),
    );
    const restored = new AiActivity(store);
    assert.equal(restored.state.totals.total, 20);
    assert.equal(restored.state.totals.calls, 2);
    assert.equal(restored.state.totals.failed, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("keeps usage when the AI result is unusable; model checks generate no tokens", async () => {
  const transport = async (url, options, provider, hooks) => {
    hooks.onAttempt(1);
    const data = {
      usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
    };
    hooks.onResponse(data);
    return data;
  };
  const activity = new AiActivity(memory(), undefined, transport);
  const service = new AiService(
    () => ({ ai: "openai", aiModel: "test" }),
    () => "key",
    activity,
  );
  await assert.rejects(() => service.generate("prompt"), /no suggestions/);
  assert.equal(activity.state.totals.total, 10);
  assert.equal(activity.state.calls[0].status, "failed");
  await activity.request("https://example.test/models", {}, "gemini", {
    generation: false,
  });
  assert.equal(activity.state.calls[1].usage.total, 0);
  assert.equal(activity.state.totals.total, 10);
});

test("bounds recent history while preserving lifetime totals in the real store", async () => {
  await mkdir(".test-data", { recursive: true });
  const dir = await mkdtemp(path.resolve(".test-data/ai-usage-"));
  const file = path.join(dir, "profile.sqlite");
  const store = new Store(file);
  const activity = new AiActivity(
    store,
    undefined,
    async (url, options, provider, hooks) => {
      hooks.onAttempt(1);
      hooks.onResponse({ prompt_eval_count: 1, eval_count: 2 });
      return {};
    },
  );
  for (let i = 0; i < 205; i++)
    await activity.request("http://localhost", {}, "ollama");
  assert.equal(activity.state.calls.length, 200);
  store.close();
  const reopened = new Store(file);
  try {
    const restored = new AiActivity(reopened);
    assert.equal(restored.state.calls.length, 200);
    assert.equal(restored.state.totals.calls, 205);
    assert.equal(restored.state.totals.total, 615);
  } finally {
    reopened.close();
  }
});

test("unfinished calls become interrupted failures without losing usage or counting twice", () => {
  const store = memory();
  const activity = new AiActivity(store);
  activity.state.calls.push({
    status: "retrying",
    started: new Date().toISOString(),
  });
  activity.state.totals.calls = 1;
  activity.save();
  const restored = new AiActivity(store);
  assert.equal(restored.state.calls[0].status, "failed");
  assert.match(restored.state.calls[0].error, /app closed/);
  assert.equal(new AiActivity(store).state.totals.failed, 1);
});
