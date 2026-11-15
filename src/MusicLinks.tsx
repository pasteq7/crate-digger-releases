import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  Copy,
  ExternalLink,
  Loader2,
  Youtube,
  Terminal,
  Play,
} from "lucide-react";
import type { Item, ProviderLink } from "./types";
import { suppliedProviderLinks } from "../electron/music-providers.mjs";
import { ExternalUrlForm } from "./ExternalProgram";
export default function MusicLinks({ item }: { item: Item }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState(false);
  const [links, setLinks] = useState<ProviderLink[]>(() =>
    suppliedProviderLinks(item),
  );
  const [provider, setProvider] = useState(
    () => localStorage.getItem("crate-music-provider") || "amazon",
  );
  const selected = links.find((link) => link.id === provider) || links[0];
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
    const initial = suppliedProviderLinks(item);
    setLinks(initial);
    setProvider((id) => (initial.some((p) => p.id === id) ? id : "amazon"));
  }, [item.id]);
  async function act(action: "amazon" | "open" | "copy" | "youtube" | "retry") {
    const id = ++request.current;
    setBusy(action);
    setMessage("");
    try {
      if (!window.crate) {
        setMessage("Music links are available in the desktop app.");
        return;
      }
      const result = await window.crate.musicLink(
        item,
        action === "open" && selected.id === "amazon" ? "amazon" : action,
        selected.id === "amazon" || action === "youtube"
          ? undefined
          : selected.id,
      );
      if (id !== request.current) return;
      setFallback(
        selected.id === "amazon" && action !== "youtube" && !result.exact,
      );
      setAlternatives(result.alternatives || []);
      if (result.links) setLinks(result.links);
      if (selected.id !== "amazon" || action === "youtube") {
        setMessage(
          action === "youtube"
            ? ""
            : `${result.label || selected.label} ${result.exact ? "link" : "search"}${action === "copy" ? " copied" : action === "retry" ? " found" : " opened"}.`,
        );
        return;
      }
      setMessage(
        action === "retry"
          ? result.exact
            ? "Direct Amazon Music link found. Open or copy it above."
            : result.reason || "No direct Amazon match found."
          : action === "copy"
            ? result.exact
              ? "Album URL copied"
              : `Amazon search URL copied · ${result.reason || "No direct mapping found."}`
            : (action === "amazon" || action === "open") && !result.exact
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
  async function findLinks() {
    const id = ++request.current;
    setBusy("links");
    try {
      const result = await window.crate?.providerLinks(item);
      if (id !== request.current || !result) return;
      setLinks(result);
      setMessage(
        `${result.filter((link) => link.exact).length} direct provider links found.`,
      );
    } catch {
      if (id === request.current)
        setMessage("Provider lookup unavailable. Search links still work.");
    } finally {
      if (id === request.current) setBusy("");
    }
  }
  return (
    <div className="music-links">
      <div className="music-link-buttons">
        <select
          aria-label={`Music provider for ${item.title}`}
          value={selected.id}
          onChange={(e) => {
            setProvider(e.target.value);
            localStorage.setItem("crate-music-provider", e.target.value);
            setMessage("");
            setAlternatives([]);
            setFallback(false);
          }}
        >
          {links.map((link) => (
            <option key={link.id} value={link.id}>
              {link.label}
              {link.exact ? " · release" : " · search"}
            </option>
          ))}
        </select>
        <button
          disabled={!!busy}
          onClick={() => void act("open")}
          title={`Open ${selected.label}`}
        >
          {busy === "open" ? (
            <Loader2 size={13} className="spin" />
          ) : (
            <ExternalLink size={13} />
          )}{" "}
          Open
        </button>
        <button
          disabled={!!busy}
          onClick={() => void act("copy")}
          aria-label={`Copy ${selected.label} URL for ${item.title}`}
          title={`Copy ${selected.label} URL`}
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
              new CustomEvent("crate-run-external", {
                detail: selected.exact
                  ? { item, url: selected.url }
                  : { item, provider: selected.id },
              }),
            )
          }
          aria-label={`Run external program for ${item.title}`}
          title={`Queue ${selected.label} URL`}
        >
          <Terminal size={14} /> Queue
        </button>
      </div>
      <div className="music-link-buttons secondary-links">
        <button
          onClick={() => void act("youtube")}
          title="Open YouTube search in your browser"
          aria-label={`YouTube search for ${item.title}`}
        >
          <Youtube size={15} /> YouTube search
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
          <Play size={15} /> In-app YouTube
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
      <button
        className="text-button"
        disabled={!!busy}
        onClick={() => void findLinks()}
      >
        {busy === "links" ? <Loader2 size={14} className="spin" /> : null} Find
        provider links
      </button>
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
