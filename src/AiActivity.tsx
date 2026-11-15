import { useEffect, useState } from "react";
import type { AiActivityState } from "./types";

const providers: Record<string, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  ollama: "Ollama",
};
const tokens = (value: number | null) =>
  value === null ? "Unavailable" : value.toLocaleString();
export function AiActivity({ activity }: { activity?: AiActivityState }) {
  const [now, setNow] = useState(Date.now());
  const active = activity?.calls.some((call) =>
    ["running", "retrying"].includes(call.status),
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const totals = activity?.totals;
  return (
    <section className="ai-activity" aria-label="AI activity">
      <h2>AI activity</h2>
      <p className="settings-footnote">
        Reported usage on this device, saved across restarts.
      </p>
      <dl className="ai-usage-totals" aria-label="Total AI usage">
        <div>
          <dt>Total tokens</dt>
          <dd>{tokens(totals?.total || 0)}</dd>
        </div>
        <div>
          <dt>Input tokens</dt>
          <dd>{tokens(totals?.input || 0)}</dd>
        </div>
        <div>
          <dt>Output tokens</dt>
          <dd>{tokens(totals?.output || 0)}</dd>
        </div>
        <div>
          <dt>API calls</dt>
          <dd>{tokens(totals?.calls || 0)}</dd>
        </div>
        <div>
          <dt>Retries</dt>
          <dd>{tokens(totals?.retries || 0)}</dd>
        </div>
      </dl>
      <p className="settings-footnote">
        {totals?.succeeded || 0} succeeded · {totals?.failed || 0} failed ·{" "}
        {totals?.cancelled || 0} cancelled.
      </p>
      <details className="usage-help">
        <summary>About token counts</summary>
        <p>
          Totals include older calls. Cached discoveries make no API call.
          Reasoning and cached input are subsets, not additional tokens. Counts
          are not a billing estimate.
        </p>
      </details>
      {!!totals?.unreported && (
        <p className="settings-footnote">
          Usage unreported for {totals.unreported} attempt(s); actual usage may
          be higher.
        </p>
      )}
      {!activity?.calls.length && <p>No AI calls yet.</p>}
      <div className="ai-call-list">
        {[...(activity?.calls || [])].reverse().map((call) => {
          const retry = call.retries.at(-1);
          const duration =
            call.durationMs ?? Math.max(0, now - Date.parse(call.started));
          return (
            <details className="ai-call" key={call.id}>
              <summary>
                <span>
                  <strong>{call.purpose}</strong>
                  <small>
                    {providers[call.provider] || call.provider}
                    {call.model ? ` · ${call.model}` : ""}
                  </small>
                </span>
                <span className={`ai-call-status ${call.status}`}>
                  {call.status === "retrying"
                    ? `Retrying in ${Math.ceil((retry?.delay || 0) / 1000)}s`
                    : call.status === "running"
                      ? "Running"
                      : call.status === "succeeded"
                        ? "Succeeded"
                        : call.status === "cancelled"
                          ? "Cancelled"
                          : "Failed"}
                </span>
                <span>
                  {call.generation
                    ? `${tokens(call.usage.total)} tokens`
                    : "No generation"}
                </span>
              </summary>
              <p>
                {new Date(call.started).toLocaleString()} ·{" "}
                {(duration / 1000).toFixed(1)}s · {call.attempts} attempt(s)
              </p>
              {call.result && <p className="ai-call-result">{call.result}</p>}
              {call.generation && (
                <dl className="ai-call-usage">
                  <div>
                    <dt>Input</dt>
                    <dd>{tokens(call.usage.input)}</dd>
                  </div>
                  <div>
                    <dt>Output (including reasoning)</dt>
                    <dd>{tokens(call.usage.output)}</dd>
                  </div>
                  <div>
                    <dt>Reasoning subset</dt>
                    <dd>{tokens(call.usage.reasoning)}</dd>
                  </div>
                  <div>
                    <dt>Cached input subset</dt>
                    <dd>{tokens(call.usage.cached)}</dd>
                  </div>
                </dl>
              )}
              {call.unreported > 0 && (
                <p>
                  Usage unavailable for {call.unreported} attempt(s); displayed
                  counts may be incomplete.
                </p>
              )}
              {call.retries.map((r) => (
                <p key={r.attempt}>
                  Attempt {r.attempt}: {r.message} Retrying after{" "}
                  {(r.delay / 1000).toFixed(1)}s.
                </p>
              ))}
              {call.error && <p className="ai-call-error">{call.error}</p>}
            </details>
          );
        })}
      </div>
    </section>
  );
}
