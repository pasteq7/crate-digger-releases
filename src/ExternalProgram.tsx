import { useEffect, useRef, useState } from "react";
import { FolderOpen, Terminal } from "lucide-react";
import type { ExternalJob, ImportRoutes, Settings } from "./types";

export function ExternalProgramSettings({
  draft,
  change,
  routes,
}: {
  draft: Settings;
  change: (settings: Partial<Settings>) => void;
  routes: ImportRoutes;
}) {
  const [error, setError] = useState("");
  return (
    <section className="settings-section external-settings">
      <div className="settings-section-heading">
        <div>
          <h2>External program</h2>
          <p>Run a command for a record using its current Amazon Music URL.</p>
        </div>
        <Terminal size={22} />
      </div>
      <label>
        Program command
        <input
          value={draft.externalCommand || ""}
          placeholder={'"C:\\Tools\\program.exe" {amazonUrl} -option1 -option2'}
          onChange={(e) => change({ externalCommand: e.target.value })}
        />
      </label>
      <p className="settings-footnote">
        Use <code>{"{amazonUrl}"}</code> where the URL belongs. If omitted, the
        URL is inserted immediately after the program name. Quote paths or
        options containing spaces. Commands run directly; shell operators such
        as pipes are not interpreted.
      </p>
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
      <p className="settings-footnote">
        Select a folder in Discover to choose its scan root. With several roots
        and no folder selected, choose a custom working folder.
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={draft.externalAutoImport || false}
          onChange={(e) => change({ externalAutoImport: e.target.checked })}
        />
        Import music after the command succeeds
      </label>
      {draft.externalAutoImport && (
        <div className="external-import-options">
          <p className="settings-footnote">
            New music folders, ZIPs, and loose tracks created under the working
            folder are tagged and moved through Import music. Existing files and
            modified existing files are excluded. The command must wait until
            its output is finished.
          </p>
          <label>
            Import destination folder
            <select
              aria-label="Import destination folder"
              value={draft.externalDestinationFolder || ""}
              onChange={(e) =>
                change({ externalDestinationFolder: e.target.value })
              }
            >
              <option value="">
                Root — {routes.root || "choose a destination in Import music"}
              </option>
              {routes.folders.filter(Boolean).map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.externalTagGenre !== false}
              onChange={(e) => change({ externalTagGenre: e.target.checked })}
            />
            Tag genre from the destination folder name
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.externalCleanComments !== false}
              onChange={(e) =>
                change({ externalCleanComments: e.target.checked })
              }
            />
            Remove comment tags
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function CommandActivity({
  job,
  onImports,
}: {
  job: ExternalJob;
  onImports: () => void;
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
        {!!job.importIds.length && (
          <button className="secondary-button" onClick={onImports}>
            View imports
          </button>
        )}
      </div>
      <p className="external-cwd">Working folder: {job.cwd}</p>
      <code className="external-command">{job.command}</code>
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
      {(job.error || error) && <p role="alert">{job.error || error}</p>}
      {job.phase === "importing" && (
        <p role="status">Tagging and moving music…</p>
      )}
    </article>
  );
}
export function ExternalActivity({
  jobs,
  onImports,
  onSettings,
}: {
  jobs: ExternalJob[];
  onImports: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="content-wrap activity-page">
      <h1>Activity</h1>
      <p className="page-subtitle">
        External commands and live CLI output. Recent runs stay here until you
        close the app.
      </p>
      {!jobs.length ? (
        <div className="settings-empty">
          <Terminal size={24} />
          <p>
            Use the terminal button beside Copy Amazon URL on a record to run
            your program.
          </p>
          <button className="secondary-button" onClick={onSettings}>
            Configure external program
          </button>
        </div>
      ) : (
        [...jobs]
          .reverse()
          .map((job) => (
            <CommandActivity key={job.id} job={job} onImports={onImports} />
          ))
      )}
    </div>
  );
}
