import {
  ArrowDown,
  ArrowUp,
  Heart,
  Info,
  ListMusic,
  Loader2,
  Minimize2,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LocalTrack } from "./types";
import type { LocalPlayerController } from "./useLocalPlayer";

export const clock = (n: number) =>
  `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, "0")}`;
export function LocalArt({
  track,
  className = "",
}: {
  track: { cover?: string; title: string; artist: string };
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track.cover]);
  return (
    <span
      className={`local-art ${className}`}
      style={
        {
          "--cover-tone": `${((track.artist.charCodeAt(0) || 1) * 17) % 360}`,
        } as React.CSSProperties
      }
    >
      {track.cover && !failed ? (
        <img
          src={track.cover}
          alt={`${track.title} artwork`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="local-art-fallback">
          <span>{track.artist.slice(0, 1)}</span>
          <small>{track.title}</small>
        </span>
      )}
    </span>
  );
}
export function LocalPlayer({
  music,
  hidden,
  onFavorite,
  mini,
  onMini,
}: {
  music: LocalPlayerController;
  hidden?: boolean;
  onFavorite: (track: LocalTrack) => void;
  mini: boolean;
  onMini: () => void;
}) {
  const t = music.current;
  return (
    <>
      <audio
        ref={music.element}
        {...music.audioEvents}
        preload="metadata"
        data-testid="local-audio"
      />
      {!hidden && (
        <footer className="local-player" aria-label="Music player">
          <div className="local-now">
            {t ? (
              <>
                <button
                  className="now-cover"
                  aria-label="Show current track in collection"
                  onClick={() =>
                    window.dispatchEvent(new Event("crate-reveal-playing"))
                  }
                >
                  <LocalArt track={{ ...t, title: t.album }} />
                </button>
                <div>
                  <strong title={t.title}>{t.title}</strong>
                  <span>{t.artist}</span>
                  <small>
                    Local file ·{" "}
                    {t.format || t.path.split(".").at(-1)?.toUpperCase()}
                  </small>
                </div>
                <button
                  className="icon-button"
                  aria-label={
                    t.favorite
                      ? "Unfavorite current track"
                      : "Favorite current track"
                  }
                  onClick={() => onFavorite(t)}
                >
                  <Heart
                    size={16}
                    fill={t.favorite ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className="icon-button"
                  aria-label="Current track metadata"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("crate-track-details", { detail: t }),
                    )
                  }
                >
                  <Info size={16} />
                </button>
              </>
            ) : (
              <div className="player-idle">
                <ListMusic size={23} />
                <span>Pick something from your collection</span>
              </div>
            )}
          </div>
          <div className="local-transport">
            <div className="transport-buttons">
              <button
                className={`icon-button ${music.shuffle ? "active" : ""}`}
                aria-label="Shuffle"
                aria-pressed={music.shuffle}
                onClick={() => music.setShuffle(!music.shuffle)}
              >
                <Shuffle size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Previous track"
                disabled={!t}
                onClick={music.previous}
              >
                <SkipBack size={18} />
              </button>
              <button
                className="transport-play"
                aria-label={music.playing ? "Pause music" : "Play music"}
                disabled={!t}
                onClick={music.toggle}
              >
                {music.loading ? (
                  <Loader2 size={18} className="spin" />
                ) : music.playing ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
              <button
                className="icon-button"
                aria-label="Next track"
                disabled={!t}
                onClick={() => music.next()}
              >
                <SkipForward size={18} />
              </button>
              <button
                className={`icon-button ${music.repeat !== "off" ? "active" : ""}`}
                aria-label={`Repeat: ${music.repeat}`}
                title={`Repeat: ${music.repeat}`}
                onClick={() =>
                  music.setRepeat(
                    music.repeat === "off"
                      ? "all"
                      : music.repeat === "all"
                        ? "one"
                        : "off",
                  )
                }
              >
                {music.repeat === "one" ? (
                  <Repeat1 size={16} />
                ) : (
                  <Repeat size={16} />
                )}
              </button>
            </div>
            <div className="local-seek">
              <span>{clock(music.position)}</span>
              <input
                aria-label="Seek music"
                type="range"
                min="0"
                max={music.duration || t?.duration || 1}
                step=".1"
                value={Math.min(
                  music.position,
                  music.duration || t?.duration || 1,
                )}
                disabled={!t}
                onChange={(e) => music.seek(Number(e.target.value))}
              />
              <span>{clock(music.duration || t?.duration || 0)}</span>
            </div>
          </div>
          <div className="local-volume">
            <button
              className="icon-button mini-toggle"
              aria-label={mini ? "Expand player" : "Mini player"}
              title={mini ? "Expand player" : "Mini player"}
              onClick={onMini}
            >
              {mini ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
            </button>
            <button
              className="icon-button"
              aria-label={music.volume ? "Mute music" : "Unmute music"}
              onClick={() => music.setVolume(music.volume ? 0 : 0.65)}
            >
              {music.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <input
              aria-label="Music volume"
              type="range"
              min="0"
              max="1"
              step=".01"
              value={music.volume}
              onChange={(e) => music.setVolume(Number(e.target.value))}
            />
            <button
              className={`icon-button ${music.queueOpen ? "active" : ""}`}
              aria-label="Toggle queue"
              aria-pressed={music.queueOpen}
              onClick={() => music.setQueueOpen(!music.queueOpen)}
            >
              <ListMusic size={20} />
            </button>
          </div>
        </footer>
      )}
    </>
  );
}
export function QueuePanel({
  music,
  onSave,
}: {
  music: LocalPlayerController;
  onSave: (tracks: LocalTrack[]) => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(() => Math.floor(music.index / 100));
  const offset = Math.min(
    page * 100,
    Math.max(0, Math.floor((music.queue.length - 1) / 100) * 100),
  );
  useEffect(() => setPage(Math.floor(music.index / 100)), [music.index]);
  useEffect(() => {
    close.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") music.setQueueOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <aside className="queue-panel" aria-label="Playback queue">
      <header>
        <h2>Up next</h2>
        <button
          ref={close}
          className="icon-button"
          aria-label="Close queue"
          onClick={() => music.setQueueOpen(false)}
        >
          <X size={18} />
        </button>
      </header>
      {music.current && (
        <div className="queue-current">
          <LocalArt track={{ ...music.current, title: music.current.album }} />
          <div>
            <strong>{music.current.title}</strong>
            <span>{music.current.artist}</span>
            <small>
              {music.suspended
                ? "Paused for preview"
                : music.playing
                  ? "Now playing"
                  : "Paused"}
            </small>
          </div>
        </div>
      )}
      <div className="queue-actions">
        <button
          disabled={!music.queue.length}
          className="text-button"
          onClick={() => onSave(music.queue)}
        >
          Save as playlist
        </button>
        <button
          disabled={music.queue.length <= music.index + 1}
          className="text-button"
          onClick={music.clearUpcoming}
        >
          Clear upcoming
        </button>
      </div>
      {music.queue.length > 100 && (
        <nav className="bounded-list-pages" aria-label="Queue pages">
          <button
            disabled={!offset}
            onClick={() => setPage((n) => Math.max(0, n - 1))}
          >
            Previous
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 100, music.queue.length)} of{" "}
            {music.queue.length}
          </span>
          <button
            disabled={offset + 100 >= music.queue.length}
            onClick={() => setPage((n) => n + 1)}
          >
            Next
          </button>
        </nav>
      )}
      <ol className="queue-list" start={offset + 1}>
        {music.queue.slice(offset, offset + 100).map((track, row) => {
          const i = offset + row;
          return (
            <li
              key={`${track.id}-${i}`}
              className={
                i === music.index ? "current" : i < music.index ? "played" : ""
              }
            >
              <button
                className="queue-track"
                onClick={() => void music.playAt(i)}
              >
                <LocalArt track={{ ...track, title: track.album }} />
                <span>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
                <time>{clock(track.duration || 0)}</time>
              </button>
              <details className="row-menu">
                <summary aria-label={`Queue actions for ${track.title}`}>
                  ···
                </summary>
                <div>
                  <button disabled={i === 0} onClick={() => music.move(i, -1)}>
                    <ArrowUp size={13} /> Move up
                  </button>
                  <button
                    disabled={i === music.queue.length - 1}
                    onClick={() => music.move(i, 1)}
                  >
                    <ArrowDown size={13} /> Move down
                  </button>
                  <button onClick={() => music.remove(i)}>
                    Remove from queue
                  </button>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      {!music.queue.length && (
        <p className="empty-hint">
          Play an album, or add tracks to your queue. Browsing never changes
          what plays next.
        </p>
      )}
    </aside>
  );
}
