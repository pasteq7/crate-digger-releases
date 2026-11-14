import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Disc3,
  Headphones,
  Heart,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import MusicLinks from "./MusicLinks";
import { folderOptions } from "./scope";
import type { AiContext, AiResult, Item, Mode, Shelf, State } from "./types";

const readable = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .replace(
      /^(?:Error:\s*)?Error invoking remote method ['"][^'"]+['"]:\s*/,
      "",
    )
    .replace(/^Error:\s*/, "");
export function DiscoverySwitch({
  engine,
  onChange,
}: {
  engine: "ai" | "catalog";
  onChange: (v: "ai" | "catalog") => void;
}) {
  return (
    <div className="discovery-switch" aria-label="Discovery source">
      <button
        className={engine === "ai" ? "active" : ""}
        aria-pressed={engine === "ai"}
        onClick={() => onChange("ai")}
      >
        <Sparkles size={15} />
        Personal picks
      </button>
      <button
        className={engine === "catalog" ? "active" : ""}
        aria-pressed={engine === "catalog"}
        onClick={() => onChange("catalog")}
      >
        <Disc3 size={15} />
        Explore
      </button>
    </div>
  );
}
interface Props {
  state: State;
  demo: boolean;
  scope: string;
  mode: Mode;
  items: Item[];
  visible: Item[];
  onlyPlayable: boolean;
  onScope: (v: string) => void;
  onMode: (v: Mode) => void;
  onItems: (items: Item[]) => void;
  onPlayable: (v: boolean) => void;
  onConfigure: () => void;
  renderCard: (item: Item, index: number) => ReactNode;
  renderArt: (item: Item) => ReactNode;
  listen: boolean;
  chosen?: Item;
  current: Item | null;
  playing: boolean;
  onListen: () => void;
  onLeave: () => void;
  onPlay: (i: Item) => void;
  onShelf: (i: Item, s: Shelf) => void;
}
export default function AiDiscovery(props: Props) {
  const {
    state,
    demo,
    scope,
    mode,
    items,
    visible,
    onlyPlayable,
    onScope,
    onMode,
    onItems,
    onPlayable,
    onConfigure,
    renderCard,
    renderArt,
    listen,
    chosen,
    current,
    playing,
    onListen,
    onLeave,
    onPlay,
    onShelf,
  } = props;
  const [context, setContext] = useState<AiContext | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [brief, setBrief] = useState(
    () => localStorage.getItem("crate-ai-direction") || "",
  );
  const [includeSoundcloud, setIncludeSoundcloud] = useState(false);
  useEffect(() => {
    if (!state.settings.hasSoundcloudCredentials) setIncludeSoundcloud(false);
  }, [state.settings.hasSoundcloudCredentials]);
  useEffect(() => {
    localStorage.setItem("crate-ai-direction", brief);
  }, [brief]);
  const [error, setError] = useState("");
  const resultsHeading = useRef<HTMLDivElement>(null);
  const scrolledBatch = useRef(0);
  const request = useRef(0),
    batch = useRef(0),
    itemsRef = useRef(items);
  const seen = useRef<{ artist: string; album: string; kind?: Item["kind"] }[]>(
    [],
  );
  itemsRef.current = items;
  useEffect(() => {
    request.current++;
    batch.current = 0;
    seen.current = [];
    setError("");
    setBusy(false);
    setResult(null);
    setContext(null);
    const saved = itemsRef.current.filter(
      (i) =>
        i.origin === "ai" &&
        i.discoveryScope === scope &&
        i.discoveryMode === mode &&
        !i.loadingPreview,
    );
    onItems(saved);
    return () => {
      request.current++;
      void window.crate?.cancelAi();
    };
  }, [scope, mode, demo, onItems]);
  useEffect(() => {
    if (demo || scope === "all") {
      setContext(null);
      setContextBusy(false);
      return;
    }
    let live = true;
    setContextBusy(true);
    window.crate
      ?.aiContext(scope)
      .then((value) => {
        if (live) setContext(value);
      })
      .catch((e) => {
        if (live) setError(readable(e));
      })
      .finally(() => {
        if (live) setContextBusy(false);
      });
    return () => {
      live = false;
    };
  }, [scope, mode, demo, state.lastScan, state.profile.total]);
  useEffect(() => {
    if (!window.crate || demo) return;
    return window.crate.onFinds((data) => {
      if (data.engine !== "ai" || data.requestId !== request.current) return;
      onItems(data.items);
      setResult(data as AiResult);
      setBusy(false);
      if (data.message) setError(data.message);
    });
  }, [demo, onItems]);
  async function generate() {
    if (!window.crate || demo || !context?.albums.length) return;
    const id = Math.max(Date.now(), request.current + 1);
    request.current = id;
    const past = [
      ...seen.current,
      ...itemsRef.current
        .filter((i) => i.origin === "ai")
        .map((i) => ({
          artist: i.artist,
          album: i.album || i.title,
          kind: i.kind,
        })),
    ];
    const exclude = [
      ...new Map(
        past.map((i) => [
          `${i.kind || "album"}:${i.artist.toLowerCase()}:${i.album.toLowerCase()}`,
          i,
        ]),
      ).values(),
    ].slice(-100);
    seen.current = exclude;
    setBusy(true);
    setError("");
    setResult(null);
    onItems([]);
    onLeave();
    try {
      const value = await window.crate.aiDiscover({
        scope,
        mode,
        batch: batch.current++,
        exclude,
        requestId: id,
        brief,
        soundcloud: includeSoundcloud,
      });
      if (request.current === id) {
        onItems(value.items);
        setResult(value);
      }
    } catch (e) {
      if (request.current === id) setError(readable(e));
    } finally {
      if (request.current === id) setBusy(false);
    }
  }
  const configured = state.settings.ai !== "none";
  const provider = {
    none: "your AI provider",
    gemini: "Google Gemini",
    openai: "OpenAI",
    ollama: "local Ollama",
  }[state.settings.ai];
  const pending = !!result?.pending;
  const playable = items.filter(
    (i) => i.preview && !i.loadingPreview && !state.shelves[i.id],
  ).length;
  useEffect(() => {
    if (
      !playable ||
      request.current < 1000000000000 ||
      scrolledBatch.current === request.current
    )
      return;
    scrolledBatch.current = request.current;
    resultsHeading.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [playable]);
  const genres = state.profile.genres.filter((g) => g.name !== "Untagged");
  return (
    <div
      className={`ai-discovery-page ${items.length || result ? "has-results" : ""}`}
    >
      <header className="ai-discovery-heading">
        <h1>Find your next favorite.</h1>
        <p>Album picks, connected to the music you own.</p>
      </header>
      <div className="scope-toolbar ai-scope-toolbar">
        <label className="scope-select">
          <Disc3 size={16} />
          <select
            aria-label="AI discovery scope"
            value={scope}
            onChange={(e) => onScope(e.target.value)}
          >
            <option value="all">Choose a genre or folder</option>
            <optgroup label="Genres">
              {genres.map((g) => (
                <option key={g.name} value={`genre:${g.name}`}>
                  {g.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Folders">
              {folderOptions(state).map((f) => (
                <option key={f.path} value={`folder:${f.path}`}>
                  {f.label}
                </option>
              ))}
              {scope.startsWith("folder:") &&
                !state.folders.includes(scope.slice(7)) && (
                  <option value={scope}>
                    {scope.slice(7).split(/[\\/]/).at(-1)}
                  </option>
                )}
            </optgroup>
          </select>
          <ChevronDown size={13} />
        </label>
        <div className="toolbar-separator" />
        <div className="mode-control" aria-label="AI discovery distance">
          {(["safe", "adjacent", "wildcard"] as Mode[]).map((m) => (
            <button
              key={m}
              className={mode === m ? "active" : ""}
              aria-pressed={mode === m}
              onClick={() => onMode(m)}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className="ai-provider-label">{provider}</span>
      </div>
      {demo ? (
        <div className="ai-setup-panel">
          <Sparkles size={24} />
          <h2>Start with your own collection.</h2>
          <p>Add your music folder and connect a provider in Settings.</p>
          <button className="primary-button" onClick={onConfigure}>
            Open Settings
            <ArrowRight size={15} />
          </button>
        </div>
      ) : !configured ? (
        <div className="ai-setup-panel">
          <Settings2 size={24} />
          <h2>Let your collection do the talking.</h2>
          <p>
            Choose Google Gemini, OpenAI, or a local Ollama model. Personal
            picks uses your album list to choose the records, not just to
            describe them.
          </p>
          <button className="primary-button" onClick={onConfigure}>
            Choose AI provider
            <ArrowRight size={15} />
          </button>
        </div>
      ) : scope === "all" ? (
        <div className="ai-setup-panel">
          <Disc3 size={27} />
          <h2>Pick one corner of your collection.</h2>
          <p>Choose a genre or folder to get started.</p>
          <div className="genre-quick-picks">
            {genres.slice(0, 6).map((g) => (
              <button key={g.name} onClick={() => onScope(`genre:${g.name}`)}>
                {g.name}
                <ArrowRight size={13} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <section className="ai-context-panel">
            <div className="ai-context-summary">
              <span className="ai-context-icon">
                {contextBusy ? (
                  <Loader2 size={21} className="spin" />
                ) : (
                  <Disc3 size={23} />
                )}
              </span>
              <div>
                <h2>
                  {context
                    ? `${context.albums.length} album${context.albums.length === 1 ? "" : "s"} from ${context.label}`
                    : "Reading this collection…"}
                </h2>
                <p>
                  Complete scanned album list for this selection, including
                  subfolders. Your album list, never your audio.
                </p>
              </div>
              <button
                className="primary-button ai-generate"
                disabled={
                  busy || pending || contextBusy || !context?.albums.length
                }
                onClick={() => void generate()}
              >
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Sparkles size={16} />
                )}{" "}
                {busy
                  ? "Finding connections…"
                  : items.length
                    ? "More picks"
                    : "Find records"}
              </button>
            </div>
            <details className="ai-options">
              <summary>
                <SlidersHorizontal size={14} /> Personalize & review{" "}
                <ChevronDown size={13} />
              </summary>
              <label className="checkbox-label soundcloud-discovery-option">
                <input
                  type="checkbox"
                  checked={includeSoundcloud}
                  disabled={busy || !state.settings.hasSoundcloudCredentials}
                  onChange={(event) =>
                    setIncludeSoundcloud(event.target.checked)
                  }
                />{" "}
                Include SoundCloud discoveries
              </label>
              <p className="settings-footnote">
                {state.settings.hasSoundcloudCredentials
                  ? "When you press Find records, search public SoundCloud tracks and playlists for this scope and direction, then let your AI choose relevant releases. Upload titles, artists, and links are sent with the recommendation request."
                  : "Add app credentials in Settings → SoundCloud to let AI choose from real SoundCloud uploads. Pasted links and browser search work without credentials."}
              </p>
              <label className="ai-direction">
                A direction for this dig <span>Optional</span>
                <input
                  aria-label="Discovery direction"
                  maxLength={1000}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="e.g. Roots dub and UK steppers, deep cuts; no dub techno"
                />
              </label>
              {context && (
                <details className="ai-context-details">
                  <summary>
                    Review what is sent to {provider}
                    <ChevronDown size={13} />
                  </summary>
                  <div className="ai-context-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Artist</th>
                          <th>Album</th>
                          <th>Folder labels</th>
                        </tr>
                      </thead>
                      <tbody>
                        {context.albums.map((a) => (
                          <tr key={a.id}>
                            <td>{a.artist}</td>
                            <td>
                              {a.album}
                              {a.year ? ` (${a.year})` : ""}
                            </td>
                            <td>{a.folders.join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="settings-footnote">
                    {context.feedback.length} relevant shelf choices are
                    included as taste feedback. Rejected and owned albums are
                    also filtered locally. Requests happen only when you press
                    Find records with AI; provider usage may incur charges.
                  </p>
                  {context.feedback.length > 0 && (
                    <details className="ai-feedback">
                      <summary>
                        Review shelf feedback ({context.feedback.length})
                      </summary>
                      <ul>
                        {context.feedback.map((entry, i) => (
                          <li key={i}>
                            {entry.artist} — {entry.album} · {entry.choice}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </details>
              )}
            </details>
            {result?.exchange && (
              <details className="ai-context-details ai-exchange">
                <summary>
                  Inspect AI request & response
                  <ChevronDown size={13} />
                </summary>
                <p className="settings-footnote">
                  {result.exchange.provider} · {result.exchange.model}
                  {result.cached ? " · cached response" : ""} ·{" "}
                  {result.exchange.filtered} owned, shelved, or previously
                  suggested albums removed locally. Uses the scanned library;
                  rescan after adding music or changing tags.
                </p>
                <details>
                  <summary>Exact prompt sent to AI</summary>
                  <pre className="ai-exchange-text">
                    {result.exchange.prompt}
                  </pre>
                </details>
                <details>
                  <summary>Raw AI response before filtering</summary>
                  <pre className="ai-exchange-text">
                    {result.exchange.response}
                  </pre>
                </details>
              </details>
            )}
          </section>
          {error && (
            <div className="ai-error" role="alert">
              <X size={17} />
              <p>{error}</p>
              <button className="text-button" onClick={onConfigure}>
                Settings
                <ArrowRight size={13} />
              </button>
            </div>
          )}
          {busy && (
            <div className="ai-thinking" role="status">
              <Loader2 className="spin" size={22} />
              <div>
                <h3>Looking for the connections between your records.</h3>
                <p>
                  {provider} is choosing specific releases. Catalog and preview
                  checks come next.
                </p>
              </div>
            </div>
          )}
          {(items.length > 0 || result) && (
            <>
              <div className="ai-results-heading" ref={resultsHeading}>
                <div>
                  <h2>Your next records</h2>
                  <span>
                    {pending
                      ? `Checking ${result?.stats.checked || 0} / ${result?.stats.suggested || 0}`
                      : `${playable} ready to hear`}
                    {result?.cached ? " · cached AI picks" : ""}
                  </span>
                </div>
                <div className="ai-result-actions">
                  <div className="group-toggle">
                    <button
                      className={onlyPlayable ? "active" : ""}
                      aria-pressed={onlyPlayable}
                      onClick={() => onPlayable(true)}
                    >
                      With previews
                    </button>
                    <button
                      className={!onlyPlayable ? "active" : ""}
                      aria-pressed={!onlyPlayable}
                      onClick={() => onPlayable(false)}
                    >
                      All records
                    </button>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={!playable}
                    onClick={onListen}
                  >
                    <Headphones size={15} />
                    Listen
                  </button>
                </div>
              </div>
              {pending && (
                <div className="ai-verifying" role="status">
                  <Loader2 className="spin" size={13} />
                  Matching releases and previews…
                </div>
              )}
              {listen && chosen ? (
                <section className="listen-view ai-listen">
                  <div className="listen-top">
                    <span>
                      <Headphones size={15} />
                      LISTEN MODE
                    </span>
                    <button className="text-button" onClick={onLeave}>
                      Back to your finds
                      <X size={15} />
                    </button>
                  </div>
                  <div className="listen-body">
                    <button
                      className="listen-cover"
                      onClick={() => onPlay(chosen)}
                      aria-label={`Preview ${chosen.title}`}
                    >
                      {renderArt(chosen)}
                      <span className="listen-play">
                        {playing && current?.id === chosen.id ? (
                          <Pause size={30} fill="currentColor" />
                        ) : (
                          <Play size={30} fill="currentColor" />
                        )}
                      </span>
                    </button>
                    <div className="listen-info">
                      <span className="genre-tag">
                        {chosen.genre} · {chosen.year}
                      </span>
                      <h2>{chosen.title}</h2>
                      <h3>{chosen.artist}</h3>
                      <p>
                        <Sparkles size={15} />
                        {chosen.reason}
                      </p>
                      <div className="ai-seed-albums">
                        {chosen.basedOn?.map((a) => (
                          <span key={`${a.artist}:${a.album}`}>
                            {a.artist} · {a.album}
                          </span>
                        ))}
                      </div>
                      <MusicLinks item={chosen} />
                      <div className="listen-actions">
                        <button onClick={() => onShelf(chosen, "rejected")}>
                          <X size={22} />
                          <span>
                            Less like this <kbd>R</kbd>
                          </span>
                        </button>
                        <button
                          className="keep-listen"
                          onClick={() => onShelf(chosen, "wishlist")}
                        >
                          <Heart size={22} />
                          <span>
                            Save <kbd>K</kbd>
                          </span>
                        </button>
                      </div>
                      <div className="listen-hint">
                        ← → to skip · Space to pause · Esc to leave
                      </div>
                    </div>
                  </div>
                </section>
              ) : visible.length ? (
                <div className="records-grid ai-records-grid">
                  {visible.map(renderCard)}
                </div>
              ) : (
                <div className="empty-state">
                  <Headphones size={28} />
                  <h3>
                    {pending
                      ? "Verifying the first previews…"
                      : onlyPlayable
                        ? "No matching clips in this batch."
                        : "No finds remain in this batch."}
                  </h3>
                  <p>
                    {pending
                      ? "You can inspect pending suggestions under All records while the catalog catches up."
                      : onlyPlayable
                        ? "A good recommendation can be absent from the preview catalog. Check All records and try SoundCloud or YouTube."
                        : "Owned and shelved suggestions are excluded. Try another batch or discovery distance."}
                  </p>
                  {onlyPlayable && !pending && (
                    <button
                      className="secondary-button"
                      onClick={() => onPlayable(false)}
                    >
                      See all records
                      <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              )}
              {result && !pending && (
                <p className="ai-batch-note">
                  <Check size={13} />
                  {result.stats.playable} with previews ·{" "}
                  {result.stats.noPreview} verified releases without a catalog
                  clip · {result.stats.unverified} unverified suggestions kept
                  for review.
                </p>
              )}
            </>
          )}
          {!busy && !result && !items.length && !error && (
            <div className="ai-start-note">
              <Sparkles size={20} />
              <p>
                Expect specific musical connections, a cited starting point from
                your collection, and a queue you can actually listen through.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
