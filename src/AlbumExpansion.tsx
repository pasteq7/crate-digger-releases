import { useEffect, useRef, useState } from "react";
import { Heart, ListPlus, Loader2, Play, Shuffle, X } from "lucide-react";
import { clock, LocalArt } from "./LocalPlayer";
import type { LibraryGroup, LocalTrack } from "./types";

export default function AlbumExpansion({
  group,
  resolve,
  revision,
  current,
  onPlay,
  onFavorite,
  onQueue,
  onClose,
}: {
  group: LibraryGroup;
  resolve: (ids: string[]) => Promise<LocalTrack[]>;
  revision: number;
  current?: string;
  onPlay: (tracks: LocalTrack[], at?: number, shuffled?: boolean) => void;
  onFavorite: (track: LocalTrack) => void;
  onQueue: (tracks: LocalTrack[]) => void;
  onClose: () => void;
}) {
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [color, setColor] = useState("");
  const section = useRef<HTMLElement>(null);
  const revealed = useRef("");
  const loader = useRef(resolve);
  loader.current = resolve;
  const ids = JSON.stringify(group.tracks);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    void loader
      .current(JSON.parse(ids))
      .then((items) => {
        if (live)
          setTracks(
            items.sort(
              (a, b) =>
                (a.discNumber || 1) - (b.discNumber || 1) ||
                (a.trackNumber || 0) - (b.trackNumber || 0) ||
                a.path.localeCompare(b.path, undefined, { numeric: true }),
            ),
          );
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [group.id, ids, revision]);
  useEffect(() => {
    if (!busy && revealed.current !== group.id) {
      revealed.current = group.id;
      section.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [group.id, busy]);
  useEffect(() => {
    let live = true;
    setColor("");
    const id = group.tracks[0];
    if (id && !id.startsWith("sample-"))
      void window.crate
        ?.albumColor(id)
        .then((value) => {
          if (live && value) setColor(value);
        })
        .catch(() => {
          /* Unavailable artwork uses the palette fallback. */
        });
    return () => {
      live = false;
    };
  }, [group.id, group.cover, group.tracks[0]]);
  const liked = tracks.filter((t) => t.favorite);
  const multiDisc = tracks.some((t) => (t.discNumber || 1) > 1);
  return (
    <section
      ref={section}
      className="album-expansion"
      aria-label={`${group.title} tracklist`}
      style={{ backgroundColor: color || undefined }}
    >
      <button
        className="icon-button album-expansion-close"
        aria-label="Close album"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <div className="album-expansion-art">
        <LocalArt track={group} />
      </div>
      <div className="album-expansion-content">
        <header>
          <h2>{group.title}</h2>
          <p>
            {group.artist}
            {group.year ? ` · ${group.year}` : ""}
          </p>
          <div className="album-expansion-actions">
            <button
              disabled={busy || !tracks.length}
              onClick={() => onPlay(tracks)}
            >
              <Play size={14} /> Play album
            </button>
            <button
              disabled={busy || !tracks.length}
              onClick={() => onPlay(tracks, 0, true)}
              aria-label={`Shuffle ${group.title}`}
            >
              <Shuffle size={14} />
            </button>
            <button
              disabled={busy || !liked.length}
              onClick={() => onPlay(liked)}
            >
              <Heart size={14} /> Play liked
              {liked.length ? ` · ${liked.length}` : ""}
            </button>
            <button
              disabled={busy || !tracks.length}
              onClick={() => onQueue(tracks)}
              aria-label={`Queue ${group.title}`}
            >
              <ListPlus size={15} />
            </button>
          </div>
        </header>
        {busy ? (
          <p role="status">
            <Loader2 className="spin" size={18} /> Loading tracks…
          </p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : (
          <ol className="album-inline-tracks">
            {tracks.map((t, i) => (
              <li
                key={t.id}
                className={current === t.id ? "playing-track" : ""}
              >
                <button
                  className="inline-track-play"
                  aria-label={`Play ${t.title}`}
                  disabled={!!t.missing}
                  onClick={() => onPlay(tracks, i)}
                >
                  <span className="inline-track-number">
                    {current === t.id ? (
                      <Play size={12} fill="currentColor" />
                    ) : (
                      `${multiDisc ? `${t.discNumber || 1}.` : ""}${t.trackNumber || i + 1}`
                    )}
                  </span>
                  <span className="inline-track-title">
                    {t.title}
                    {t.artist !== group.artist && <small>{t.artist}</small>}
                    {t.missing && <small>File unavailable</small>}
                  </span>
                </button>
                <button
                  className="icon-button"
                  aria-label={`Favorite ${t.title}`}
                  aria-pressed={!!t.favorite}
                  onClick={() => onFavorite(t)}
                >
                  <Heart
                    size={14}
                    fill={t.favorite ? "currentColor" : "none"}
                  />
                </button>
                <span className="inline-track-time">
                  {clock(t.duration || 0)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
