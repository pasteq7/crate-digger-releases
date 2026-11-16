import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, X } from "lucide-react";
import { CommandActivity } from "./ExternalProgram";
import type { ExternalJob, State } from "./types";

export function activeTaskCount(state: State) {
  return (
    Number(!!state.progress?.running) +
    (state.aiActivity?.calls.filter((c) =>
      ["running", "retrying"].includes(c.status),
    ).length || 0) +
    (state.imports?.filter((j) => !["complete", "failed"].includes(j.phase))
      .length || 0) +
    (state.externalJobs?.filter((j) =>
      ["queued", "running", "importing"].includes(j.phase),
    ).length || 0)
  );
}
export default function Tasks({
  state,
  onClose,
  onImport,
  onSend,
  onUsage,
  onClear,
}: {
  state: State;
  onClose: () => void;
  onImport: () => void;
  onSend: (job: ExternalJob) => void;
  onUsage: () => void;
  onClear: (id?: string) => Promise<void>;
}) {
  const [tab, setTab] = useState("active");
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const jobs = state.externalJobs || [],
    calls = state.aiActivity?.calls || [],
    imports = state.imports || [];
  const count = activeTaskCount(state);
  const ready = jobs.filter(
    (j) =>
      j.phase === "complete" && j.outputPaths.length && !j.importIds.length,
  );
  return (
    <aside className="tasks-drawer" aria-label="Tasks">
      <header>
        <h2>Tasks{count > 0 && <span>{count}</span>}</h2>
        <button
          ref={close}
          className="icon-button"
          aria-label="Close tasks"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="drawer-tabs">
        <button
          aria-pressed={tab === "active"}
          onClick={() => setTab("active")}
        >
          Active
        </button>
        <button
          aria-pressed={tab === "history"}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>
      <div className="tasks-body">
        {tab === "active" && state.progress?.running && (
          <article className="task-row">
            <strong>
              <Loader2 size={15} className="spin" /> Updating library
            </strong>
            <p>{state.progress.checked.toLocaleString()} files checked</p>
            <small>{state.progress.current}</small>
          </article>
        )}
        {calls
          .filter((c) =>
            tab === "active"
              ? ["running", "retrying"].includes(c.status)
              : !["running", "retrying"].includes(c.status),
          )
          .slice()
          .reverse()
          .slice(0, 30)
          .map((call) => (
            <article className="task-row" key={call.id}>
              <strong>
                {["running", "retrying"].includes(call.status) && (
                  <Loader2 size={14} className="spin" />
                )}
                {call.purpose}
              </strong>
              <p>
                {call.status} · {call.model || call.provider}
              </p>
              {call.error && <p role="alert">{call.error}</p>}
              <button className="text-button" onClick={onUsage}>
                Usage and request details <ArrowRight size={13} />
              </button>
            </article>
          ))}
        {imports
          .filter((j) =>
            tab === "active"
              ? !["complete", "failed"].includes(j.phase)
              : ["complete", "failed"].includes(j.phase),
          )
          .slice()
          .reverse()
          .map((job) => (
            <article className="task-row" key={job.id}>
              <strong>
                {job.phase === "complete" ? (
                  <Check size={15} />
                ) : job.phase !== "failed" ? (
                  <Loader2 className="spin" size={15} />
                ) : null}
                {job.name}
              </strong>
              <p>
                {job.phase}
                {job.total ? ` · ${job.done}/${job.total}` : ""}
              </p>
              {job.error && <p role="alert">{job.error}</p>}
              <button className="text-button" onClick={onImport}>
                Open import <ArrowRight size={13} />
              </button>
            </article>
          ))}
        {jobs
          .filter((j) =>
            tab === "active"
              ? ["queued", "running", "importing"].includes(j.phase)
              : !["queued", "running", "importing"].includes(j.phase),
          )
          .slice()
          .reverse()
          .map((job) => (
            <article className="task-row" key={job.id}>
              <strong>
                {["running", "importing"].includes(job.phase) && (
                  <Loader2 size={14} className="spin" />
                )}
                {job.title || "External tool"}
              </strong>
              <p>
                {job.phase} · {job.artist}
              </p>
              <details>
                <summary>View details</summary>
                <CommandActivity
                  job={job}
                  onImports={onImport}
                  onSend={onSend}
                  onClear={onClear}
                />
              </details>
            </article>
          ))}
        {tab === "active" && !!ready.length && (
          <section className="tasks-attention">
            <h3>Ready to review</h3>
            {ready.map((job) => (
              <article className="task-row" key={job.id}>
                <strong>{job.title || "External tool finished"}</strong>
                <p>{job.outputPaths.length} output item(s)</p>
                <button
                  className="secondary-button"
                  onClick={() => onSend(job)}
                >
                  Review import <ArrowRight size={13} />
                </button>
              </article>
            ))}
          </section>
        )}
        {tab === "active" && !count && !ready.length && (
          <div className="quiet-empty">
            <Check size={25} />
            <p>All caught up</p>
            <small>Scans, imports, and discovery progress appear here.</small>
          </div>
        )}
        {tab === "history" &&
          !jobs.length &&
          !calls.length &&
          !imports.length && (
            <p className="empty-hint">No completed tasks yet.</p>
          )}
      </div>
    </aside>
  );
}
