import { randomUUID } from "node:crypto";
import { aiJson } from "./ai-http.mjs";

const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
export function tokenUsage(provider, data) {
  let input, output, total, reasoning, cached;
  if (provider === "gemini") {
    const u = data?.usageMetadata;
    input = count(u?.promptTokenCount);
    const candidates = count(u?.candidatesTokenCount);
    reasoning = count(u?.thoughtsTokenCount);
    output = candidates === null ? null : candidates + (reasoning || 0);
    total = count(u?.totalTokenCount);
    cached = count(u?.cachedContentTokenCount);
  } else if (provider === "openai") {
    const u = data?.usage;
    input = count(u?.prompt_tokens);
    output = count(u?.completion_tokens);
    total = count(u?.total_tokens);
    reasoning = count(u?.completion_tokens_details?.reasoning_tokens);
    cached = count(u?.prompt_tokens_details?.cached_tokens);
  } else {
    input = count(data?.prompt_eval_count);
    output = count(data?.eval_count);
    reasoning = cached = null;
  }
  total ??= input !== null && output !== null ? input + output : null;
  return { input, output, total, reasoning, cached };
}

const emptyTotals = () => ({
  calls: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
  retries: 0,
  input: 0,
  output: 0,
  total: 0,
  reasoning: 0,
  cached: 0,
  unreported: 0,
});

export class AiActivity {
  constructor(store, emit = () => {}, transport = aiJson) {
    this.store = store;
    this.emit = emit;
    this.transport = transport;
    this.state = store.get("aiActivity", { calls: [], totals: emptyTotals() });
    for (const call of this.state.calls) {
      if (["running", "retrying"].includes(call.status)) {
        call.status = "failed";
        call.error =
          "The app closed before this call finished. Usage may be incomplete.";
        call.finished = new Date().toISOString();
        call.durationMs = Math.max(
          0,
          Date.parse(call.finished) - Date.parse(call.started),
        );
        this.state.totals.failed++;
      }
    }
    this.save();
  }
  save() {
    this.store.set("aiActivity", this.state);
    this.emit(this.state);
  }
  async request(
    url,
    options,
    provider,
    { purpose, model = "", generation = true, read, describe } = {},
  ) {
    const started = Date.now();
    const call = {
      id: randomUUID(),
      provider,
      model,
      purpose: purpose || "AI request",
      generation,
      started: new Date(started).toISOString(),
      status: "running",
      attempts: 0,
      retries: [],
      usage: Object.fromEntries(
        ["input", "output", "total", "reasoning", "cached"].map((key) => [
          key,
          generation ? null : 0,
        ]),
      ),
      reported: false,
      unreported: 0,
    };
    this.state.calls.push(call);
    // Keep active calls even when many requests run concurrently.
    const finished = this.state.calls.filter(
      (c) => !["running", "retrying"].includes(c.status),
    );
    const retained = new Set(finished.slice(-199));
    this.state.calls = this.state.calls.filter(
      (c) => retained.has(c) || ["running", "retrying"].includes(c.status),
    );
    this.state.totals.calls++;
    this.save();
    try {
      const data = await this.transport(url, options, provider, {
        onAttempt: (attempt) => {
          call.attempts = attempt;
          call.status = "running";
          this.save();
        },
        onRetry: ({ attempt, delay, message }) => {
          call.status = "retrying";
          call.retries.push({ attempt, delay, message });
          this.state.totals.retries++;
          this.save();
        },
        onResponse: (data) => {
          if (!generation) return;
          const usage = tokenUsage(provider, data);
          if (usage.total === null) {
            call.unreported++;
            this.state.totals.unreported++;
          } else call.reported = true;
          for (const key of Object.keys(call.usage)) {
            if (usage[key] !== null)
              call.usage[key] = (call.usage[key] || 0) + usage[key];
            this.state.totals[key] += usage[key] || 0;
          }
          this.save();
        },
      });
      const result = read ? read(data) : data;
      if (describe) call.result = String(describe(result)).slice(0, 2000);
      call.status = "succeeded";
      this.state.totals.succeeded++;
      return result;
    } catch (error) {
      call.status =
        options.signal?.aborted || error.name === "AbortError"
          ? "cancelled"
          : "failed";
      call.error = error.message;
      this.state.totals[call.status]++;
      throw error;
    } finally {
      call.finished = new Date().toISOString();
      call.durationMs = Date.now() - started;
      this.save();
    }
  }
}
