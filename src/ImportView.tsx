import { useState } from "react";
import {
  Check,
  FileArchive,
  FolderOpen,
  Loader2,
  Upload,
  RefreshCw,
  X,
} from "lucide-react";
import type { ExternalJob, ImportRoutes, Settings, State } from "./types";
export default function ImportView({
  state,
  genre,
  clean,
  pending,
  demo,
  onGenre,
  onClean,
  onChoose,
  onChooseFolder,
  onSettings,
  onImport,
  onError,
  routes,
  tagGenre,
  onTagGenre,
  onRefresh,
  externalJob,
  onImportExternal,
  onDismissExternal,
}: {
  externalJob?: ExternalJob;
  onImportExternal: () => void;
  onDismissExternal: () => void;
  state: State;
  routes: ImportRoutes;
  tagGenre: boolean;
  onTagGenre: (value: boolean) => void;
  onRefresh: () => void;
  genre: string;
  clean: boolean;
  pending: string[];
  demo: boolean;
  onGenre: (s: string) => void;
  onClean: (v: boolean) => void;
  onChoose: () => void;
  onChooseFolder: () => void;
  onSettings: (s: Settings) => void;
  onImport: (files: string[], genre?: string) => void;
  onError: (s: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const root = state.settings.importRoot;
  const rootName =
    root?.split(/[\\/]/).filter(Boolean).at(-1) || root || "Scan root";
  const folderName = genre.split(/[\\/]/).filter(Boolean).at(-1) || rootName;
  return (
    <div className="content-wrap import-page">
      <h1>Import music</h1>
      <p className="import-intro">
        Choose where your music belongs, then import a folder, ZIP or completed
        program output.
      </p>
      <section className="import-routing">
        <label>Destination folder</label>
        <div className="import-destination">
          <FolderOpen size={21} />
          <span>{root || "Choose where your imported music belongs"}</span>
          <button
            className="secondary-button"
            disabled={demo}
            onClick={async () => {
              try {
                const s = await window.crate?.importDestination();
                if (s) onSettings(s);
              } catch (e) {
                onError(String(e));
              }
            }}
          >
            {root ? "Change" : "Choose folder"}
          </button>
        </div>
        <div className="import-genre">
          <label>
            Save into
            <select
              aria-label="Import destination folder"
              value={genre}
              onChange={(e) => onGenre(e.target.value)}
              disabled={!root || demo}
            >
              <option value="">{rootName} (main folder)</option>
              {routes.folders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder.replaceAll("\\", " / ")}
                </option>
              ))}
            </select>
          </label>
          <p>
            <strong>{genre || rootName} / original name</strong>
          </p>
          <button
            className="text-button"
            disabled={!root || demo}
            onClick={onRefresh}
          >
            <RefreshCw size={13} />
            Refresh folders
          </button>
        </div>
        {routes.truncated && (
          <p className="muted small">
            Showing the first 500 folders. Choose a more specific root to see
            deeper folders.
          </p>
        )}
        <label className="import-checkbox genre-tag-toggle">
          <input
            type="checkbox"
            role="switch"
            aria-label="Set genre tag to destination folder name"
            checked={tagGenre}
            onChange={(e) => onTagGenre(e.target.checked)}
          />
          Set genre tag to destination folder name
          <strong>
            {tagGenre ? folderName : "Off · keep existing genre tags"}
          </strong>
        </label>
        <label className="import-checkbox">
          <input
            type="checkbox"
            checked={clean}
            onChange={(e) => onClean(e.target.checked)}
          />{" "}
          Clear comment and description tags on imported copies
        </label>
        <p className="muted small">
          Dropped folders are moved after copying and verification. Source ZIPs
          are kept. Artist, album and track tags are preserved; existing
          destination albums are never overwritten.
        </p>
      </section>
      {externalJob && (
        <section
          className="import-external-source"
          aria-label="Program output ready to import"
        >
          <div className="import-source-heading">
            <FolderOpen size={23} />
            <div>
              <strong>
                {externalJob.artist} — {externalJob.title}
              </strong>
              <p>Output from your external program · no drag and drop needed</p>
            </div>
            <button
              className="icon-button"
              aria-label="Dismiss program output"
              disabled={externalJob.phase === "importing"}
              onClick={onDismissExternal}
            >
              <X size={17} />
            </button>
          </div>
          <ul>
            {externalJob.outputPaths.map((file) => (
              <li key={file} title={file}>
                {file}
              </li>
            ))}
          </ul>
          <div className="import-source-actions">
            <p>
              {externalJob.importIds.length
                ? "Output sent to the import queue below."
                : root
                  ? "Review the destination and tags above, then start."
                  : "Choose a destination folder above to continue."}
            </p>
            <button
              className="primary-button"
              disabled={
                !root ||
                demo ||
                externalJob.phase !== "complete" ||
                !!externalJob.importIds.length
              }
              onClick={onImportExternal}
            >
              {externalJob.phase === "importing"
                ? "Importing…"
                : "Import program output"}
            </button>
          </div>
        </section>
      )}
      {!externalJob && (
        <>
          <button
            className={`import-drop-zone ${dragging ? "is-dragging" : ""}`}
            disabled={demo}
            onClick={onChoose}
            onDragEnter={(e) => {
              if (!demo && e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                setDragging(true);
              }
            }}
            onDragOver={(e) => {
              if (!demo && e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              e.stopPropagation();
              setDragging(false);
              if (demo) return;
              const files = Array.from(e.dataTransfer.files)
                .map((f) => window.crate?.filePath(f) || "")
                .filter(Boolean);
              if (files.length) onImport(files);
            }}
          >
            <Upload size={32} />
            <strong>Drop music folders or ZIPs here</strong>
            <span>
              MP3, FLAC, M4A, WAV, Ogg, Opus and more · artwork and booklets
              kept
            </span>
          </button>
          <div className="import-picker-actions">
            <button
              className="secondary-button"
              disabled={demo}
              onClick={onChoose}
            >
              <FileArchive size={15} /> Choose ZIPs
            </button>
            <button
              className="secondary-button"
              disabled={demo}
              onClick={onChooseFolder}
            >
              <FolderOpen size={15} /> Choose a folder to move
            </button>
          </div>
          {pending.length > 0 && (
            <div className="import-pending" role="status">
              <FileArchive size={22} />
              <div>
                <strong>
                  {pending.length} item{pending.length > 1 ? "s" : ""} ready to
                  import
                </strong>
                <p>
                  {root
                    ? "Review the routing above, then start."
                    : "Choose a destination folder above to continue."}
                </p>
              </div>
              <button
                className="primary-button"
                disabled={!root}
                onClick={() => onImport(pending)}
              >
                Import now
              </button>
            </div>
          )}
        </>
      )}
      <section className="import-jobs" aria-label="Import queue">
        {(state.imports || [])
          .slice()
          .reverse()
          .map((job) => (
            <article className={`import-job ${job.phase}`} key={job.id}>
              {job.phase === "complete" ? (
                <Check size={21} />
              ) : job.phase === "failed" ? (
                <X size={21} />
              ) : (
                <Loader2 size={21} className="spin" />
              )}
              <div>
                <strong>{job.name}</strong>
                <p>
                  {job.phase === "complete"
                    ? `${job.tracks} tracks · ${job.destination}`
                    : job.phase === "failed"
                      ? job.error
                      : `${job.phase} · ${job.done} / ${job.total || "…"} · ${job.genre}`}
                </p>
                {job.phase === "complete" && (
                  <p>
                    {job.kind === "folder"
                      ? job.sourceRemoved
                        ? "Folder moved · original removed after verification"
                        : "Sorted copy ready · original files retained (see details)"
                      : "Source ZIP retained"}
                  </p>
                )}
                {!["complete", "failed", "queued"].includes(job.phase) && (
                  <progress max={job.total || 1} value={job.done} />
                )}
                {job.indexWarning && <p>{job.indexWarning}</p>}
                {!!job.warnings?.length && (
                  <details>
                    <summary>{job.warnings.length} import note(s)</summary>
                    {job.warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </details>
                )}
              </div>
              {job.phase === "failed" && (
                <button
                  className="text-button"
                  onClick={() => {
                    onGenre(job.destinationFolder || "");
                    onImport([job.zip], job.destinationFolder || "");
                  }}
                >
                  Retry
                </button>
              )}
            </article>
          ))}
      </section>
      {demo && (
        <p className="settings-footnote">
          Leave the sample collection to import your own music.
        </p>
      )}
    </div>
  );
}
