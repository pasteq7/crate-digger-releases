import { useState } from "react";
import { Copy, ExternalLink, Loader2, Youtube, Terminal } from "lucide-react";
import type { Item } from "./types";
export default function MusicLinks({ item }: { item: Item }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  async function act(action: "amazon" | "copy" | "youtube") {
    setBusy(action);
    setMessage("");
    try {
      if (!window.crate) {
        setMessage("Music links are available in the desktop app.");
        return;
      }
      const result = await window.crate.musicLink(item, action);
      setMessage(
        action === "copy"
          ? result.exact
            ? "Album URL copied"
            : "No exact link found · Amazon search URL copied"
          : action === "amazon" && !result.exact
            ? "Opened Amazon search for this release"
            : "",
      );
    } catch {
      setMessage("Link unavailable. Please try again.");
    } finally {
      setBusy("");
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
          onClick={() => void act("youtube")}
          title="Search YouTube for this release"
          aria-label={`Search YouTube for ${item.title}`}
        >
          <Youtube size={15} />
        </button>
      </div>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
