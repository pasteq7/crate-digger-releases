import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Play, Search, X, Youtube } from "lucide-react";
import { youtubeVideoId } from "../electron/youtube-preview.mjs";
import type { Item, YoutubeVideo } from "./types";

export default function YoutubePreview({
  item,
  hasKey,
  onClose,
  onSettings,
}: {
  item: Item;
  hasKey: boolean;
  onClose: () => void;
  onSettings: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const request = useRef(0);
  const [videos, setVideos] = useState<YoutubeVideo[]>([]);
  const [selected, setSelected] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [suspended, setSuspended] = useState(document.hidden);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    const visibility = () => {
      if (document.hidden) setSuspended(true);
    };
    const unsubscribe = window.crate?.onYoutubeSuspend(() =>
      setSuspended(true),
    );
    document.addEventListener("visibilitychange", visibility);
    return () => {
      request.current++;
      unsubscribe?.();
      document.removeEventListener("visibilitychange", visibility);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    element.scrollIntoView({ block: "nearest" });
    let wasVisible = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) wasVisible = true;
        else if (wasVisible) setSuspended(true);
      },
      { root: dialog.current },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected?.id, suspended]);

  async function search(track = false) {
    if (!window.crate) return;
    const id = ++request.current;
    setBusy(true);
    setMessage("");
    setVideos([]);
    setSelected(null);
    try {
      const results = await window.crate.youtubeSearch(
        track && item.previewTrack
          ? { ...item, title: item.previewTrack, kind: "track" }
          : item,
      );
      if (id !== request.current) return;
      setVideos(results);
      if (!results.length)
        setMessage(
          "No playable videos found. Try a browser search or paste a video link.",
        );
    } catch (error) {
      if (id === request.current)
        setMessage(
          String(error instanceof Error ? error.message : error).replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            "",
          ),
        );
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="youtube-dialog"
      aria-labelledby="youtube-heading"
      onCancel={onClose}
      onClose={onClose}
    >
      <header className="youtube-heading">
        <div>
          <span className="eyebrow">
            <Youtube size={16} /> YouTube listening
          </span>
          <h2 id="youtube-heading">{item.title}</h2>
          <p>{item.artist}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close YouTube player"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <p className="muted small">
        Choose a video to check the recording. YouTube matches do not verify an
        AI recommendation.
      </p>
      <div className="youtube-actions">
        <button
          className="primary-button"
          disabled={busy || !hasKey}
          onClick={() => void search()}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />}{" "}
          Search YouTube
        </button>
        {item.previewTrack && hasKey && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void search(true)}
          >
            Search suggested track
          </button>
        )}
        <button
          className="secondary-button"
          onClick={() =>
            void window.crate
              ?.musicLink(item, "youtube")
              .catch(() => setMessage("Could not open YouTube. Try again."))
          }
        >
          <ExternalLink size={15} /> Search in browser
        </button>
      </div>
      {!hasKey && (
        <p className="settings-footnote">
          Search in your browser and paste a video link below, or{" "}
          <button className="text-button" onClick={onSettings}>
            add a YouTube API key
          </button>{" "}
          for in-app search.
        </p>
      )}
      <form
        className="youtube-link"
        onSubmit={(event) => {
          event.preventDefault();
          const id = youtubeVideoId(link);
          if (!id) {
            setMessage(
              "Paste a valid https://www.youtube.com/watch?v=… or https://youtu.be/… video link.",
            );
            return;
          }
          request.current++;
          setBusy(false);
          setMessage("");
          setSelected({ id, title: "Pasted YouTube video" });
          setSuspended(document.hidden);
        }}
      >
        <label htmlFor="youtube-link">YouTube video link</label>
        <div>
          <input
            id="youtube-link"
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            maxLength={2048}
            required
          />
          <button className="secondary-button" type="submit">
            Load video
          </button>
        </div>
      </form>
      {message && (
        <p role="status" className="youtube-message">
          {message}
        </p>
      )}
      {!!videos.length && (
        <div className="youtube-results" aria-label="YouTube search results">
          {videos.map((video) => (
            <button
              key={video.id}
              className={selected?.id === video.id ? "selected" : ""}
              onClick={() => {
                setSelected(video);
                setSuspended(document.hidden);
                setMessage("");
              }}
            >
              <Play size={17} />
              <span>
                <strong>{video.title}</strong>
                <small>
                  {video.channel} ·{" "}
                  {video.closeMatch
                    ? "Artist and title match · check recording"
                    : "Possible match · check artist and recording"}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <section className="youtube-playback" aria-label="YouTube video player">
          {!suspended ? (
            <iframe
              ref={frame}
              key={selected.id}
              title={selected.title}
              src={`https://www.youtube.com/embed/${selected.id}?playsinline=1&autoplay=0`}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <div>
              <p>Playback stopped because the player was out of view.</p>
              <button
                className="secondary-button"
                onClick={() => setSuspended(false)}
              >
                Reload video
              </button>
            </div>
          )}
          <p className="settings-footnote">
            Press play in the video. If playback is unavailable here,{" "}
            <button
              className="text-button"
              onClick={() =>
                void window.crate
                  ?.external(`https://www.youtube.com/watch?v=${selected.id}`)
                  .catch(() => setMessage("Could not open YouTube. Try again."))
              }
            >
              open on YouTube <ExternalLink size={12} />
            </button>
            . Ads and regional restrictions may apply.
          </p>
        </section>
      )}
      <p className="settings-footnote">
        Searches send this artist and release to YouTube. Loading a video
        connects to YouTube. Audio is streamed through its visible player.
      </p>
    </dialog>
  );
}
