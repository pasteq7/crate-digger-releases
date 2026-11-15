import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Pause, Play } from "lucide-react";
import type { AlbumTrack, AlbumTrackList, Item } from "./types";

export default function AlbumTracks({
  item,
  currentId,
  playing,
  onPlay,
}: {
  item: Item;
  currentId?: string;
  playing: boolean;
  onPlay: (track: AlbumTrack) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [list, setList] = useState<AlbumTrackList | null>(null),
    [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => {
    request.current++;
    setList(null);
    setError("");
    setOpen(false);
    setBusy(false);
  }, [item.id]);
  async function load() {
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      if (!window.crate)
        throw new Error("Album tracks are available in the desktop app.");
      const result = await window.crate.albumTracks(item);
      if (id === request.current) setList(result);
    } catch {
      if (id === request.current) setError("Could not load tracks. Try again.");
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <section className="album-tracks" aria-label="Album tracks">
      <button
        className="secondary-button album-tracks-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && !list && !busy) void load();
        }}
      >
        Browse album tracks {busy && <Loader2 size={15} className="spin" />}
      </button>
      {open && (
        <div>
          {list?.source && (
            <p className="album-track-credit">
              {list.album} · {list.source} · {list.total} tracks
            </p>
          )}
          {list && !list.complete && (
            <p className="muted">
              {list.tracks.length} of {list.total} tracks available in this
              catalog.
            </p>
          )}
          {(error || list?.message) && (
            <p role="status">{error || list?.message}</p>
          )}
          {!!list?.tracks.length && (
            <ol className="album-track-list">
              {list.tracks.map((track) => (
                <li key={track.id}>
                  <button
                    disabled={!track.preview}
                    onClick={() => onPlay(track)}
                    aria-label={`${currentId === track.id && playing ? "Pause" : "Preview"} ${track.title}`}
                    title={
                      track.preview ? "Play preview" : "No preview available"
                    }
                  >
                    {currentId === track.id && playing ? (
                      <Pause size={15} />
                    ) : (
                      <Play size={15} />
                    )}
                    <span className="album-track-number">
                      {track.disc > 1 ? `${track.disc}.` : ""}
                      {track.number || "—"}
                    </span>
                    <span>
                      <strong>{track.title}</strong>
                      <small>
                        {track.artist}
                        {!track.preview ? " · No preview" : ""}
                      </small>
                    </span>
                    <time>
                      {track.durationMs
                        ? `${Math.floor(track.durationMs / 60000)}:${String(Math.floor(track.durationMs / 1000) % 60).padStart(2, "0")}`
                        : ""}
                    </time>
                  </button>
                  {track.trackUrl && (
                    <button
                      className="icon-button"
                      title="Open track"
                      aria-label={`Open ${track.title} on ${list.source}`}
                      onClick={() =>
                        void window.crate?.external(track.trackUrl!)
                      }
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? "Loading tracks…" : "Refresh tracks"}
          </button>
        </div>
      )}
    </section>
  );
}
