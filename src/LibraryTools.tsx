import { useState } from "react";
import { ArrowRight, Download, FolderOpen, Upload } from "lucide-react";
import Dialog from "./Dialog";
import type { Bridge, LocalTrack, State } from "./types";

const changed = () => window.dispatchEvent(new Event("crate-library-changed"));
export default function LibraryTools({
  state,
  demo,
}: {
  state: State;
  demo: boolean;
}) {
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<LocalTrack[][] | null>(null);
  const [relink, setRelink] =
    useState<Awaited<ReturnType<Bridge["libraryRelinkReview"]>>>(null);
  const [restore, setRestore] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(
        String(e).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="library-tools">
      <h2>Collection tools</h2>
      <div className="setting-row">
        <div>
          <strong>Playlists</strong>
          <span>
            Import M3U/M3U8 files. Only indexed music is linked; missing paths
            are reported.
          </span>
        </div>
        <button
          className="secondary-button"
          disabled={demo || busy}
          onClick={() =>
            void run(async () => {
              const result = await window.crate!.playlistImport();
              if (result) {
                changed();
                setMessage(
                  `Imported ${result.playlist.name}: ${result.playlist.tracks.length} linked tracks; ${result.unresolved.length} unresolved paths.`,
                );
              }
            })
          }
        >
          <Upload size={14} /> Import playlist
        </button>
      </div>
      <div className="setting-row">
        <div>
          <strong>Duplicate candidates</strong>
          <span>
            Compare matching titles, artists, and durations. Review only; files
            stay untouched.
          </span>
        </div>
        <button
          className="secondary-button"
          disabled={demo || busy}
          onClick={() =>
            void run(async () =>
              setDuplicates(await window.crate!.libraryDuplicates()),
            )
          }
        >
          Review candidates
        </button>
      </div>
      <div className="setting-row">
        <div>
          <strong>Back up library details</strong>
          <span>
            Personal tags, ratings, notes, and playlists. Audio and credentials
            are excluded.
          </span>
        </div>
        <button
          className="secondary-button"
          disabled={demo || busy}
          onClick={() =>
            void run(async () => {
              if (await window.crate!.libraryBackup())
                setMessage("Library backup saved.");
            })
          }
        >
          <Download size={14} /> Export backup
        </button>
      </div>
      <div className="setting-row">
        <div>
          <strong>Restore library details</strong>
          <span>
            Match your indexed paths, restore personal details, and add
            playlists from a backup.
          </span>
        </div>
        <button
          className="secondary-button"
          disabled={demo || busy}
          onClick={() => setRestore(true)}
        >
          Restore backup
        </button>
      </div>
      <h3 className="relink-heading">Moved or disconnected folders</h3>
      <p className="settings-footnote">
        Reconnect an offline drive, or locate a folder after it has moved.
        Review matching files before updating the index.
      </p>
      {state.folders.map((root) => (
        <div className="setting-row" key={root}>
          <div className="relink-location">
            <strong>{root.split(/[\\/]/).filter(Boolean).at(-1)}</strong>
            <span title={root}>{root}</span>
          </div>
          <button
            className="secondary-button"
            disabled={demo || busy || state.progress?.running}
            onClick={() =>
              void run(async () =>
                setRelink(await window.crate!.libraryRelinkReview(root)),
              )
            }
          >
            <FolderOpen size={14} /> Locate
          </button>
        </div>
      ))}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {duplicates && (
        <Dialog
          title="Duplicate candidates"
          onClose={() => setDuplicates(null)}
        >
          <p>
            Similar metadata can also mean different editions or recordings.
            Compare file locations before making decisions.
          </p>
          {!duplicates.length && <p>No matching candidates found.</p>}
          {duplicates.map((group, i) => (
            <section className="duplicate-group" key={i}>
              <strong>
                {group[0].artist} — {group[0].title}
              </strong>
              {group.map((t) => (
                <p className="file-info" key={t.id}>
                  {t.path}
                  <br />
                  {t.format} · {Math.round(t.duration || 0)} seconds
                </p>
              ))}
            </section>
          ))}
        </Dialog>
      )}
      {relink && (
        <Dialog title="Review folder recovery" onClose={() => setRelink(null)}>
          <p className="file-info">
            From: {relink.oldRoot}
            <br />
            To: {relink.newRoot}
          </p>
          <p>
            {relink.matched} matching files · {relink.missing} unresolved files
          </p>
          <p>
            Matching uses relative paths and file sizes. Playlists keep their
            track identities. No files are moved or changed.
          </p>
          {relink.examples.map((title, i) => (
            <p className="file-info" key={i}>
              Not found: {title}
            </p>
          ))}
          <button
            className="primary-button"
            disabled={busy || !relink.matched}
            onClick={() =>
              void run(async () => {
                const result = await window.crate!.libraryRelinkApply(
                  relink.token,
                );
                setRelink(null);
                changed();
                setMessage(
                  `Reconnected ${result.matched} tracks. The new location is being scanned.`,
                );
              })
            }
          >
            Update library location <ArrowRight size={14} />
          </button>
        </Dialog>
      )}
      {restore && (
        <Dialog
          title="Restore library details"
          onClose={() => setRestore(false)}
        >
          <p>
            Choose a Crate Digger library backup. Matching tracks receive its
            saved ratings, favorites, tags, and notes; playlists are added as
            new playlists. Audio files and credentials stay unchanged.
          </p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await window.crate!.libraryRestore();
                setRestore(false);
                if (result) {
                  changed();
                  setMessage(
                    `Restored ${result.restored} track details and ${result.playlists} playlists; ${result.unresolved} paths unresolved.`,
                  );
                }
              })
            }
          >
            Choose backup
          </button>
        </Dialog>
      )}
    </section>
  );
}
