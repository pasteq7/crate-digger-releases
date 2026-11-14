import { useEffect, useRef, useState } from "react";
import { Cloud, ExternalLink, Loader2, Play, Search, X } from "lucide-react";
import {
  soundcloudSearchUrl,
  soundcloudUrl,
} from "../electron/soundcloud-url.mjs";
import type { Item, SoundCloudSource } from "./types";

export default function SoundCloudPreview({
  item,
  configured,
  onClose,
  onSettings,
  onAttach,
}: {
  item: Item;
  configured: boolean;
  onClose: () => void;
  onSettings: () => void;
  onAttach: (source: SoundCloudSource) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const request = useRef(0);
  const [link, setLink] = useState(item.soundcloud?.url || "");
  const [selected, setSelected] = useState<SoundCloudSource | null>(
    soundcloudUrl(item.soundcloud?.url || "") ? item.soundcloud! : null,
  );
  const [results, setResults] = useState<SoundCloudSource[]>([]);
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
  }, [selected?.url, suspended]);
  const choose = (source: SoundCloudSource) => {
    setLink(source.url);
    setSelected(source);
    setSuspended(document.hidden);
    setMessage("");
    onAttach(source);
  };
  async function search(track = false) {
    if (!window.crate) return;
    const id = ++request.current;
    setBusy(true);
    setMessage("");
    setResults([]);
    setSelected(null);
    try {
      const rows = await window.crate.soundcloudSearch(
        track
          ? { ...item, kind: "track", title: item.previewTrack || item.title }
          : item,
      );
      if (id !== request.current) return;
      setResults(rows);
      if (!rows.length)
        setMessage(
          "No uploads found. Try a track search, browser search, or paste a SoundCloud link.",
        );
    } catch (error) {
      if (id === request.current) setMessage(readable(error));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="youtube-dialog soundcloud-dialog"
      aria-labelledby="soundcloud-heading"
      onCancel={onClose}
      onClose={onClose}
    >
      <header className="youtube-heading">
        <div>
          <span className="eyebrow">
            <Cloud size={16} /> SoundCloud listening
          </span>
          <h2 id="soundcloud-heading">{item.title}</h2>
          <p>{item.artist}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close SoundCloud player"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <p className="muted small">
        Find tracks, EPs, and playlists, including music outside the album
        catalogs. Check the uploader and recording before saving a match.
      </p>
      <div className="youtube-actions">
        <button
          className="primary-button"
          disabled={busy || !configured}
          onClick={() => void search()}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />}{" "}
          Search SoundCloud
        </button>
        {(item.kind === "album" || item.previewTrack) && configured && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void search(true)}
          >
            Search tracks
          </button>
        )}
        <button
          className="secondary-button"
          onClick={() =>
            void window.crate
              ?.external(soundcloudSearchUrl(item.artist, item.title))
              .catch(() => setMessage("Could not open SoundCloud. Try again."))
          }
        >
          <ExternalLink size={15} /> Search in browser
        </button>
      </div>
      {!configured && (
        <p className="settings-footnote">
          Browser search and pasted links work without credentials.{" "}
          <button className="text-button" onClick={onSettings}>
            Connect a SoundCloud app
          </button>{" "}
          for in-app search and optional AI discovery.
        </p>
      )}
      <form
        className="youtube-link"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!soundcloudUrl(link)) {
            setMessage(
              "Paste a public https://soundcloud.com/artist/track or playlist link.",
            );
            return;
          }
          if (!window.crate) {
            setMessage("Open the desktop app to load SoundCloud tracks.");
            return;
          }
          const id = ++request.current;
          setBusy(true);
          setMessage("");
          try {
            const source = await window.crate.soundcloudResolve(link);
            if (id === request.current) choose(source);
          } catch (error) {
            if (id === request.current) setMessage(readable(error));
          } finally {
            if (id === request.current) setBusy(false);
          }
        }}
      >
        <label htmlFor="soundcloud-link">
          SoundCloud track or playlist link
        </label>
        <div>
          <input
            id="soundcloud-link"
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            maxLength={2048}
            required
            placeholder="https://soundcloud.com/artist/track"
          />
          <button className="secondary-button" disabled={busy} type="submit">
            Load SoundCloud
          </button>
        </div>
      </form>
      {message && (
        <p role="status" className="youtube-message">
          {message}
        </p>
      )}
      {!!results.length && (
        <div className="youtube-results" aria-label="SoundCloud search results">
          {results.map((source) => (
            <button
              key={source.url}
              onClick={() => choose(source)}
              className={selected?.url === source.url ? "selected" : ""}
            >
              <Play size={17} />
              <span>
                <strong>{source.title}</strong>
                <small>
                  {source.uploader || source.artist} ·{" "}
                  {source.releaseType.toUpperCase()} ·{" "}
                  {source.closeMatch
                    ? "Artist and title match"
                    : "Check artist and recording"}
                  {source.access === "preview" ? " · Preview only" : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <section className="soundcloud-playback" aria-label="SoundCloud player">
          {!suspended ? (
            <iframe
              ref={frame}
              key={selected.url}
              title={`SoundCloud: ${selected.title}`}
              src={`https://w.soundcloud.com/player/?${new URLSearchParams({ url: selected.url, auto_play: "false", show_artwork: "true", show_user: "true", visual: "false" })}`}
              allow="autoplay"
            />
          ) : (
            <div>
              <p>Playback stopped because the player was out of view.</p>
              <button
                className="secondary-button"
                onClick={() => setSuspended(false)}
              >
                Reload SoundCloud
              </button>
            </div>
          )}
          <p className="settings-footnote">
            {selected.title}
            {selected.uploader
              ? ` · Uploaded by ${selected.uploader}`
              : ""}.{" "}
            <button
              className="text-button"
              onClick={() =>
                void window.crate
                  ?.external(selected.url)
                  .catch(() => setMessage("Could not open SoundCloud."))
              }
            >
              Open on SoundCloud <ExternalLink size={12} />
            </button>
          </p>
          <p className="settings-footnote">
            SoundCloud controls playback availability; some uploads provide only
            a short preview or require sign-in. A chosen upload does not prove
            the artist's identity.
          </p>
        </section>
      )}
      <p className="settings-footnote">
        Loading an upload connects to SoundCloud. Audio plays in its official
        waveform player; your music files stay on your device.
      </p>
    </dialog>
  );
}
const readable = (error: unknown) =>
  String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
