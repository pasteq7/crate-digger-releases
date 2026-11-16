import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import { clock } from "./LocalPlayer";
import type { LocalTrack } from "./types";

const textFields = [
  ["title", "Title"],
  ["artist", "Artist"],
  ["album", "Album"],
  ["albumArtist", "Album artist"],
  ["genre", "Genre"],
] as const;
export default function TrackDetails({
  onSave,
  demo,
}: {
  demo: boolean;
  onSave: (track: LocalTrack, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [track, setTrack] = useState<LocalTrack | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const open = (event: Event) => {
      const value = (event as CustomEvent<LocalTrack>).detail;
      setTrack(value);
      setError("");
      setDraft(
        Object.fromEntries([
          ...textFields.map(([key]) => [key, value[key] || ""]),
          ...["year", "trackNumber", "discNumber", "rating", "note"].map(
            (key) => [key, String(value[key as keyof LocalTrack] ?? "")],
          ),
          ["tags", (value.tags || []).join(", ")],
        ]),
      );
    };
    window.addEventListener("crate-track-details", open);
    return () => window.removeEventListener("crate-track-details", open);
  }, []);
  if (!track) return null;
  return (
    <Dialog
      title="Track metadata"
      onClose={() => {
        if (!busy) setTrack(null);
      }}
    >
      <p className="muted small">
        Edits are saved in Crate Digger. Your original audio and file tags
        remain unchanged.
      </p>
      <form
        className="track-metadata-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const overrides = Object.fromEntries(
              textFields.map(([key]) => [key, draft[key].trim()]),
            );
            await onSave(track, {
              overrides: {
                ...overrides,
                year: draft.year ? Number(draft.year) : null,
                trackNumber: Number(draft.trackNumber) || 0,
                discNumber: Number(draft.discNumber) || 0,
              },
              rating: Number(draft.rating) || 0,
              note: draft.note || "",
              tags: (draft.tags || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            });
            setTrack(null);
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
        }}
      >
        {textFields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              value={draft[key]}
              maxLength={500}
              required={key === "title"}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <div className="metadata-number-fields">
          {(
            [
              ["year", "Year", 1000, 9999],
              ["trackNumber", "Track number", 0, 99999],
              ["discNumber", "Disc number", 0, 99999],
              ["rating", "Rating", 0, 5],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                aria-label={label}
                value={draft[key]}
                min={min}
                max={max}
                step="1"
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <label>
          Personal tags
          <input
            value={draft.tags}
            maxLength={1000}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            placeholder="Separate with commas"
          />
        </label>
        <label>
          Note
          <textarea
            value={draft.note}
            maxLength={2000}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </label>
        <details className="metadata-audio-details" open>
          <summary>Audio and file information</summary>
          <dl>
            <dt>Format</dt>
            <dd>
              {track.format ||
                track.path.split(".").at(-1)?.toUpperCase() ||
                "Unknown"}
            </dd>
            <dt>Duration</dt>
            <dd>{clock(track.duration || 0)}</dd>
            <dt>Sample rate</dt>
            <dd>
              {track.sampleRate
                ? `${(track.sampleRate / 1000).toLocaleString()} kHz`
                : "Unknown"}
            </dd>
            <dt>Bit depth</dt>
            <dd>
              {track.bitsPerSample ? `${track.bitsPerSample} bit` : "Unknown"}
            </dd>
            <dt>Bitrate</dt>
            <dd>
              {track.bitrate
                ? `${Math.round(track.bitrate / 1000)} kbps`
                : "Unknown"}
            </dd>
            <dt>Track ReplayGain</dt>
            <dd>
              {track.trackGainDb == null
                ? "Not tagged"
                : `${track.trackGainDb.toFixed(2)} dB`}
            </dd>
          </dl>
          <label>
            File location
            <input
              readOnly
              value={track.path}
              aria-label="Track file location"
            />
          </label>
          {track.missing && <p>File unavailable at its indexed location.</p>}
        </details>
        {error && <p role="alert">{error}</p>}
        <button
          className="primary-button"
          type="submit"
          disabled={busy || demo}
        >
          {busy ? "Saving…" : "Save metadata"}
        </button>
      </form>
    </Dialog>
  );
}
