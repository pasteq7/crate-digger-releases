import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  Copy,
  ExternalLink,
  Loader2,
  Youtube,
  Terminal,
} from "lucide-react";
import type { Item } from "./types";
import { ExternalUrlForm } from "./ExternalProgram";
export default function MusicLinks({ item }: { item: Item }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState(false);
  const [alternatives, setAlternatives] = useState<
    { amazon: string; title: string; trackCount: number | null }[]
  >([]);
  const request = useRef(0);
  useEffect(() => {
    request.current++;
    setBusy("");
    setMessage("");
    setFallback(false);
    setAlternatives([]);
  }, [item.id]);
  async function act(action: "amazon" | "copy" | "youtube" | "retry") {
    const id = ++request.current;
    setBusy(action);
    setMessage("");
    try {
      if (!window.crate) {
        setMessage("Music links are available in the desktop app.");
        return;
      }
      const result = await window.crate.musicLink(item, action);
      if (id !== request.current) return;
      setFallback(!result.exact);
      setAlternatives(result.alternatives || []);
      setMessage(
        action === "retry"
          ? result.exact
            ? "Direct Amazon Music link found. Open or copy it above."
            : result.reason || "No direct Amazon match found."
          : action === "copy"
            ? result.exact
              ? "Album URL copied"
              : `Amazon search URL copied · ${result.reason || "No direct mapping found."}`
            : action === "amazon" && !result.exact
              ? `Opened Amazon search · ${result.reason || "No direct mapping found."}`
              : "",
      );
    } catch {
      if (id === request.current)
        setMessage("Link unavailable. Please try again.");
    } finally {
      if (id === request.current) setBusy("");
    }
  }
  return (
    <div className="music-links">
      <div className="music-link-buttons">
        <button
          disabled={!!busy}
          onClick={() => void act("amazon")}
          title="Find this release on Amazon Music"
        >
          {busy === "amazon" ? (
            <Loader2 size={13} className="spin" />
          ) : (
            <ExternalLink size={13} />
          )}{" "}
          Amazon Music
        </button>
        <button
          disabled={!!busy}
          onClick={() => void act("copy")}
          aria-label={`Copy Amazon Music URL for ${item.title}`}
          title="Copy Amazon Music URL"
        >
          {busy === "copy" ? (
            <Loader2 size={13} className="spin" />
          ) : (
            <Copy size={13} />
          )}
        </button>
        <button
          disabled={!!busy}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("crate-run-external", { detail: item }),
            )
          }
          aria-label={`Run external program for ${item.title}`}
          title="Run external program"
        >
          <Terminal size={14} />
        </button>
        <button
          disabled={!!busy}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("crate-youtube", { detail: item }),
            )
          }
          title="Listen with YouTube"
          aria-label={`Listen on YouTube for ${item.title}`}
        >
          <Youtube size={15} /> YouTube
        </button>
        <button
          disabled={!!busy}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("crate-soundcloud", { detail: item }),
            )
          }
          title="Listen with SoundCloud"
          aria-label={`Listen on SoundCloud for ${item.title}`}
        >
          <Cloud size={15} /> SoundCloud
        </button>
      </div>
      {message && <small role="status">{message}</small>}
      {fallback && (
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => void act("retry")}
        >
          Retry Amazon lookup
        </button>
      )}
      {!!alternatives.length && (
        <div className="amazon-alternatives">
          <p>Other editions found:</p>
          {alternatives.map((edition) => (
            <div key={edition.amazon}>
              <span>
                {edition.title}
                {edition.trackCount ? ` · ${edition.trackCount} tracks` : ""}
              </span>
              <button
                className="text-button"
                onClick={() => void window.crate?.external(edition.amazon)}
              >
                Open edition
              </button>
              <button
                className="text-button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("crate-run-external", {
                      detail: {
                        item: {
                          ...item,
                          title: edition.title,
                          album: edition.title,
                          trackCount: edition.trackCount,
                        },
                        url: edition.amazon,
                      },
                    }),
                  )
                }
              >
                Run this edition
              </button>
            </div>
          ))}
        </div>
      )}
      <details className="external-url-details">
        <summary>Run program with pasted URL</summary>
        <ExternalUrlForm
          onRun={async (url) => {
            window.dispatchEvent(
              new CustomEvent("crate-run-external", { detail: { item, url } }),
            );
          }}
        />
      </details>
    </div>
  );
}
