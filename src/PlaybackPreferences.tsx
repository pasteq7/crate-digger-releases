import { useState } from "react";
import Dialog from "./Dialog";
import type { Settings, SettingsUpdate } from "./types";
export default function PlaybackPreferences({
  settings,
  demo,
  onSave,
}: {
  settings: Settings;
  demo: boolean;
  onSave: (patch: SettingsUpdate) => Promise<boolean>;
}) {
  const [clear, setClear] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="settings-section">
      <h2>Playback</h2>
      <p>
        Full tracks, a persistent queue, and your preferred listening controls.
      </p>
      <label className="setting-row">
        <span>
          <strong>Restore your session</strong>
          <small>
            Bring back the queue and position, paused, when you reopen the app.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.playbackResume !== false}
          onChange={(e) => void onSave({ playbackResume: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        <span>
          <strong>Volume normalization</strong>
          <small>
            Use existing ReplayGain tags. Peak limits prevent gain from
            clipping; untagged tracks keep their volume.
          </small>
        </span>
        <select
          aria-label="Volume normalization"
          value={settings.normalization || "off"}
          onChange={(e) =>
            void onSave({
              normalization: e.target.value as Settings["normalization"],
            })
          }
        >
          <option value="off">Off</option>
          <option value="track">Track gain</option>
          <option value="album">Album gain</option>
        </select>
      </label>
      <label className="setting-row">
        <span>
          <strong>Crossfade</strong>
          <small>
            Overlap consecutive local tracks. Shuffle and repeat-one use normal
            transitions.
          </small>
        </span>
        <select
          aria-label="Crossfade"
          value={settings.crossfadeSeconds || 0}
          onChange={(e) =>
            void onSave({ crossfadeSeconds: Number(e.target.value) })
          }
        >
          {[0, 2, 4, 6, 8, 10].map((n) => (
            <option key={n} value={n}>
              {n ? `${n} seconds` : "Off"}
            </option>
          ))}
        </select>
      </label>
      <div className="setting-row">
        <div>
          <strong>Listening history</strong>
          <span>
            Stored on this device, separately from your collection profile.
          </span>
        </div>
        <button
          className="secondary-button"
          disabled={demo}
          onClick={() => setClear(true)}
        >
          Clear listening history
        </button>
      </div>
      <p className="settings-footnote">
        Space: play or pause · Left/Right: previous or next · Ctrl+K: search.
        Shortcuts stay inactive while you type. Windows media keys are
        supported.
      </p>
      <p className="settings-footnote">
        Discovery previews pause your local session. Return to your music
        continues from the same position.
      </p>
      {message && <p role="status">{message}</p>}
      {clear && (
        <Dialog title="Clear listening history" onClose={() => setClear(false)}>
          <p>
            Clear local listening history and play counts? Favorites, ratings,
            playlists, and collection snapshots are kept.
          </p>
          <button
            className="primary-button"
            onClick={async () => {
              try {
                await window.crate!.listeningClear();
                window.dispatchEvent(new Event("crate-library-changed"));
                setMessage("Listening history cleared.");
                setClear(false);
              } catch (e) {
                setMessage(String(e));
              }
            }}
          >
            Clear history
          </button>
        </Dialog>
      )}
    </section>
  );
}
