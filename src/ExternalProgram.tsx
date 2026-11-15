import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, FolderOpen, Terminal, Trash2, X } from "lucide-react";
import type { ExternalJob, Settings } from "./types";
import { AiActivity } from "./AiActivity";
export function ExternalUrlForm({
  onRun,
  disabled = false,
}: {
  onRun: (url: string) => Promise<void>;
  disabled?: boolean;
}) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="external-url-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onRun(url.trim());
          setUrl("");
        } catch (error) {
          setError(
            String(error instanceof Error ? error.message : error).replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              "",
            ),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id}>URL for external program</label>
      <div>
        <input
          id={id}
          type="url"
          maxLength={8192}
          required
          value={url}
          placeholder="Paste a link from any music provider"
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          className="secondary-button"
          type="submit"
          disabled={disabled || busy}
        >
          {busy ? "Adding…" : "Run pasted URL"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function ExternalProgramSettings({
  draft,
  change,
}: {
  draft: Settings;
  change: (settings: Partial<Settings>) => void;
}) {
  const [error, setError] = useState("");
  return (
    <section className="settings-section external-settings">
      <div className="settings-section-heading">
        <div>
          <h2>External program</h2>
          <p>Queue a provider link or paste any music URL.</p>
        </div>
        <Terminal size={22} />
      </div>
      <label>
        Program command
        <input
          value={draft.externalCommand || ""}
          placeholder={'"C:\\Tools\\program.exe" {url} -option1 -option2'}
          onChange={(e) => change({ externalCommand: e.target.value })}
        />
      </label>
      <details className="command-help">
        <summary>Command format and URL placeholder</summary>
        <p className="settings-footnote">
          Use <code>{"{url}"}</code> or <code>{"{amazonUrl}"}</code> where the
          URL belongs. If omitted, the URL follows the program name. Quote paths
          with spaces. Commands run directly; shell pipes are not supported.
        </p>
      </details>
      <label>
        Working folder
        <select
          aria-label="Working folder"
          value={draft.externalCwdMode || "scan"}
          onChange={(e) =>
            change({ externalCwdMode: e.target.value as "scan" | "custom" })
          }
        >
          <option value="scan">Root of the current scanned folder</option>
          <option value="custom">Custom folder</option>
        </select>
      </label>
      {draft.externalCwdMode === "custom" && (
        <div className="external-folder-picker">
          <label>
            Custom folder path
            <input
              value={draft.externalCwd || ""}
              placeholder="C:\\Downloads\\Music"
              onChange={(e) => change({ externalCwd: e.target.value })}
            />
          </label>
          <button
            className="secondary-button"
            onClick={async () => {
              try {
                const folder = await window.crate?.externalFolder();
                if (folder) change({ externalCwd: folder });
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <FolderOpen size={15} /> Browse
          </button>
        </div>
      )}
      <div className="external-handoff-setting">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.externalAutoOpenImport || false}
            onChange={(e) =>
              change({ externalAutoOpenImport: e.target.checked })
            }
          />
          Open Import music when the program finishes
        </label>
        <p className="settings-footnote">
          Review new output and choose its destination before importing.
        </p>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function CommandActivity({
  job,
  onImports,
  onSend,
  onClear,
}: {
  job: ExternalJob;
  onImports: () => void;
  onSend: (job: ExternalJob) => void;
  onClear: (id?: string) => Promise<void>;
}) {
  const output = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (following.current && output.current)
      output.current.scrollTop = output.current.scrollHeight;
  }, [job.output]);
  return (
    <article className={`external-job ${job.phase}`}>
      <div className="external-job-heading">
        <div>
          <strong>
            {job.artist} — {job.title}
          </strong>
          <p>
            {new Date(job.started).toLocaleString()} · {job.phase}
            {job.exitCode != null ? ` · exit ${job.exitCode}` : ""}
          </p>
        </div>
        {job.phase === "running" && (
          <button
            className="secondary-button"
            onClick={async () => {
              try {
                await window.crate?.externalCancel(job.id);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Stop program
          </button>
        )}
        {job.phase === "complete" &&
          !job.importIds.length &&
          !!job.outputPaths.length && (
            <button className="primary-button" onClick={() => onSend(job)}>
              Send to Import music <ArrowRight size={15} />
            </button>
          )}
        {!!job.importIds.length && (
          <button className="secondary-button" onClick={onImports}>
            View imports
          </button>
        )}
        {!["queued", "running", "importing"].includes(job.phase) && (
          <button
            className="icon-button"
            aria-label={`Remove activity for ${job.title}`}
            title="Remove from activity"
            onClick={() => void onClear(job.id)}
          >
            <X size={17} />
          </button>
        )}
      </div>
      {job.phase === "complete" && !job.importIds.length && (
        <p className="external-output-summary">
          {job.outputPaths.length
            ? `${job.outputPaths.length} new output item(s) ready to import`
            : "No new music found in the working folder. Check the program’s output location."}
        </p>
      )}
      <details className="external-run-details">
        <summary>Command and working folder</summary>
        <p className="external-cwd">Working folder: {job.cwd}</p>
        <code className="external-command">{job.command}</code>
        <p className="external-cwd">
          {job.urlSource === "pasted" ? "Pasted URL" : "Resolved URL"}:{" "}
          {job.url || job.amazonUrl}
        </p>
      </details>
      {(job.output || ["running", "importing"].includes(job.phase)) && (
        <pre
          ref={output}
          className="cli-output"
          aria-label={`CLI output for ${job.title}`}
          tabIndex={0}
          onScroll={() => {
            const el = output.current;
            if (el)
              following.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          }}
        >
          {job.output || "Waiting for program output…"}
        </pre>
      )}
      {(job.error || error) && <p role="alert">{job.error || error}</p>}
      {job.phase === "importing" && (
        <p role="status">Tagging and moving music…</p>
      )}
    </article>
  );
}
export function ExternalActivity({
  aiActivity,
  jobs,
  onImports,
  onSettings,
  onSend,
  onClear,
  configured,
  onRunUrl,
}: {
  aiActivity?: import("./types").AiActivityState;
  jobs: ExternalJob[];
  onImports: () => void;
  onSettings: () => void;
  onSend: (job: ExternalJob) => void;
  onClear: (id?: string) => Promise<void>;
  configured: boolean;
  onRunUrl: (url: string) => Promise<void>;
}) {
  return (
    <div className="content-wrap activity-page">
      <div className="activity-heading">
        <div>
          <h1>Activity</h1>
          <p className="page-subtitle">
            Follow AI calls, token usage, and external programs.
          </p>
        </div>
        {jobs.some(
          (job) => !["queued", "running", "importing"].includes(job.phase),
        ) && (
          <button className="secondary-button" onClick={() => void onClear()}>
            <Trash2 size={15} /> Clear finished
          </button>
        )}
      </div>
      {aiActivity?.calls.length ? (
        <AiActivity activity={aiActivity} />
      ) : (
        <details className="idle-ai-activity">
          <summary>AI usage · 0 tokens</summary>
          <AiActivity activity={aiActivity} />
        </details>
      )}
      <h2>External programs</h2>
      <section className="external-manual-run" aria-label="Run a pasted URL">
        <ExternalUrlForm onRun={onRunUrl} disabled={!configured} />
        {!configured && (
          <button className="text-button" onClick={onSettings}>
            Configure external program
          </button>
        )}
      </section>
      <section className="external-queue" aria-label="External run queue">
        <h3>
          Run queue · {jobs.filter((job) => job.phase === "queued").length}{" "}
          waiting
        </h3>
        {jobs.some((job) => job.phase === "queued") ? (
          <ol>
            {jobs
              .filter((job) => job.phase === "queued")
              .map((job) => (
                <li key={job.id}>
                  <div>
                    <strong>
                      {job.artist} — {job.title}
                    </strong>
                    <small>{job.url || job.amazonUrl}</small>
                  </div>
                  <button
                    className="text-button"
                    aria-label={`Remove ${job.title} from queue`}
                    onClick={() => void window.crate?.externalCancel(job.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ol>
        ) : (
          <p className="muted">
            Add a provider link or paste a URL. Runs execute in order.
          </p>
        )}
      </section>
      {!jobs.length ? (
        <div className="settings-empty">
          <Terminal size={24} />
          <p>Choose a provider on any record to queue its URL.</p>
          {configured && (
            <button className="secondary-button" onClick={onSettings}>
              Configure external program
            </button>
          )}
        </div>
      ) : (
        [
          ...jobs.filter((job) => ["running", "importing"].includes(job.phase)),
          ...jobs
            .filter(
              (job) => !["queued", "running", "importing"].includes(job.phase),
            )
            .reverse(),
        ].map((job) => (
          <CommandActivity
            key={job.id}
            job={job}
            onImports={onImports}
            onSend={onSend}
            onClear={onClear}
          />
        ))
      )}
    </div>
  );
}
