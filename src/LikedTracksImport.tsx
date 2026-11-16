import { useEffect, useState } from "react";
import { Heart, RefreshCw, Upload, X } from "lucide-react";
import Dialog from "./Dialog";
import type { LikedReview, LikedSource } from "./types";

export default function LikedTracksImport({ demo }: { demo: boolean }) {
  const [sources, setSources] = useState<LikedSource[]>([]);
  const [review, setReview] = useState<LikedReview | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    if (!demo)
      void window.crate
        ?.likedSources()
        .then((value) => {
          if (live) setSources(value);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    return () => {
      live = false;
    };
  }, [demo]);
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
    <section className="liked-import" aria-label="Import liked tracks">
      <h2>
        <Heart size={17} /> Liked tracks
      </h2>
      <p className="settings-footnote">
        Bring your MusicBee or foobar2000 favorites into Crate Digger.
      </p>
      <div className="setting-row">
        <div>
          <strong>Import a liked-track playlist</strong>
          <span>
            Export your loved or favorite tracks as a UTF-8 M3U/M3U8 playlist,
            then review matches here. Add the music folder to your library
            first.
          </span>
        </div>
        <button
          className="secondary-button"
          disabled={demo || busy}
          onClick={() =>
            void run(async () => {
              setRemember(true);
              setReview(await window.crate!.likedImportReview());
            })
          }
        >
          <Upload size={14} /> Import liked tracks
        </button>
      </div>
      <details className="liked-import-help">
        <summary>How to export from MusicBee or foobar2000</summary>
        <p>
          <strong>MusicBee:</strong> Create a playlist containing your Loved
          tracks, then export it as M3U8. For repeat imports, enable an
          automatically exported static copy in MusicBee’s playlist settings.
        </p>
        <p>
          <strong>foobar2000:</strong> Put the tracks you consider favorites in
          a playlist (for example, a query for your chosen rating or love tag),
          then save that playlist as M3U8.
        </p>
        <p>
          Ratings and love flags can live in each player’s own database. Only
          tracks included in the exported playlist are marked liked here. Keep
          the export beside your music or use absolute paths.
        </p>
      </details>
      {!!sources.length && (
        <div className="liked-sources">
          <h3>Remembered exports</h3>
          <p className="settings-footnote">
            Update the export in your other player, then refresh and review it
            here. Imports add likes; they never remove likes you set in Crate
            Digger.
          </p>
          {sources.map((source) => (
            <div className="setting-row" key={source.id}>
              <div className="relink-location">
                <strong>{source.name}</strong>
                <span title={source.file}>{source.file}</span>
                <span>
                  Last imported {new Date(source.updated).toLocaleString()}
                </span>
              </div>
              <button
                className="secondary-button"
                disabled={demo || busy}
                aria-label={`Refresh likes from ${source.name}`}
                onClick={() =>
                  void run(async () => {
                    setRemember(true);
                    setReview(
                      await window.crate!.likedImportRefresh(source.id),
                    );
                  })
                }
              >
                <RefreshCw size={14} /> Refresh export
              </button>
              <button
                className="icon-button"
                disabled={demo || busy}
                aria-label={`Forget ${source.name} export`}
                title="Forget export; keep imported likes"
                onClick={() =>
                  void run(async () => {
                    await window.crate!.likedSourceRemove(source.id);
                    setSources(await window.crate!.likedSources());
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {!review && error && <p role="alert">{error}</p>}
      {review && (
        <Dialog
          title="Review liked tracks"
          onClose={() => {
            if (!busy) {
              setReview(null);
              setError("");
            }
          }}
        >
          <p>
            <strong>{review.name}</strong>
          </p>
          <p className="file-info">{review.file}</p>
          <p>
            {review.matched} matched · {review.alreadyLiked} already liked ·{" "}
            {review.unresolved} unresolved paths
          </p>
          {!!review.examples.length && (
            <details open>
              <summary>
                Matched tracks
                {review.matched > review.examples.length
                  ? ` (first ${review.examples.length})`
                  : ""}
              </summary>
              <ul>
                {review.examples.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </details>
          )}
          {!!review.unmatched.length && (
            <details>
              <summary>
                Unresolved paths
                {review.unresolved > review.unmatched.length
                  ? ` (first ${review.unmatched.length})`
                  : ""}
              </summary>
              <p>
                Index the missing music or export paths pointing to this
                computer’s files, then import again.
              </p>
              <ul className="file-info">
                {review.unmatched.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </details>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />{" "}
            Remember this export for manual refresh
          </label>
          <p className="settings-footnote">
            This adds likes to matching tracks. Existing likes, ratings,
            playlists, and music files are preserved.
          </p>
          {error && <p role="alert">{error}</p>}
          <button
            className="primary-button"
            disabled={busy || !review.matched}
            onClick={() =>
              void run(async () => {
                const result = await window.crate!.likedImportApply(
                  review.token,
                  remember,
                );
                setReview(null);
                setSources(await window.crate!.likedSources());
                window.dispatchEvent(new Event("crate-library-changed"));
                setMessage(
                  `Imported likes for ${result.imported} tracks.${result.skipped ? ` ${result.skipped} tracks are no longer indexed.` : ""} Use the heart in the Library toolbar to play only liked tracks, with any genre, artist, or year filters.`,
                );
              })
            }
          >
            {busy ? "Importing…" : "Import likes"}
          </button>
        </Dialog>
      )}
    </section>
  );
}
