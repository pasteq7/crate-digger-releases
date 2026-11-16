import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  Cloud,
  ChevronDown,
  ChevronRight,
  Disc3,
  Ellipsis,
  ExternalLink,
  Folder,
  FolderOpen,
  Headphones,
  Heart,
  Library,
  Loader2,
  Menu,
  Minus,
  Moon,
  Music2,
  Upload,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tag,
  Terminal,
  Volume2,
  VolumeX,
  WandSparkles,
  Youtube,
  X,
} from "lucide-react";
import MusicLinks from "./MusicLinks";
import { ChromeContext, Toolbar } from "./Chrome";
import AppearanceSettings, { useAppearance } from "./Appearance";
import LibraryView from "./LibraryView";
import { LocalPlayer, QueuePanel } from "./LocalPlayer";
import { useLocalPlayer } from "./useLocalPlayer";
import Tasks, { activeTaskCount } from "./Tasks";
import { AiActivity } from "./AiActivity";
import Dialog from "./Dialog";
import LibraryTools from "./LibraryTools";
import PlaybackPreferences from "./PlaybackPreferences";
import YoutubePreview from "./YoutubePreview";
import SoundCloudPreview from "./SoundCloudPreview";
import TrackCount from "./TrackCount";
import { folderOptions } from "./scope";
import ImportView from "./ImportView";
import {
  ExternalActivity,
  ExternalProgramSettings,
  ExternalUrlForm,
} from "./ExternalProgram";
import AlbumTracks from "./AlbumTracks";
import AiDiscovery, { DiscoverySwitch } from "./AiDiscovery";
import { UpdateBanner, UpdateSettings } from "./AppUpdates";
import { albumKey, trackKey } from "../electron/identity.mjs";
import { providerSearchLinks } from "../electron/music-providers.mjs";
import type {
  Item,
  Kind,
  Mode,
  Settings,
  SettingsUpdate,
  SoundCloudSource,
  Shelf,
  State,
  View,
  Engine,
  ImportRoutes,
  ExternalJob,
} from "./types";
import {
  defaults,
  emptyState,
  loadSample,
  profile,
  sampleItems,
  saveSample,
} from "./data";

const modes: Mode[] = ["safe", "adjacent", "wildcard"];
const shelfNames: Record<Shelf, string> = {
  wishlist: "Wishlist",
  rejected: "Discovery feedback",
};
const colors = [
  "#b9a6db",
  "#879e99",
  "#c1a286",
  "#91a5c1",
  "#c38d96",
  "#a5a477",
  "#8b839f",
];
const nameOf = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) || p;
const seconds = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
const compact = (n: number) => n.toLocaleString();
function userMessage(value: unknown) {
  return String(value instanceof Error ? value.message : value)
    .replace(
      /^(?:Error:\s*)?Error invoking remote method ['"][^'"]+['"]:\s*/,
      "",
    )
    .replace(/^Error:\s*/, "");
}
const inFolder = (track: State["tracks"][number], folder: string) =>
  track.root === folder ||
  track.folder === folder ||
  track.path
    .replaceAll("\\", "/")
    .toLowerCase()
    .startsWith(
      folder.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase() + "/",
    );
function Mark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="38" height="38" rx="11" fill="currentColor" />
      <g stroke="#29232f" strokeWidth="1.7" strokeLinejoin="round">
        <path d="M11 16h18v14H11zM14 12h12M17 8h6M11 20l9 4 9-4M20 24v6" />
      </g>
    </svg>
  );
}
function Art({ item, className = "" }: { item: Item; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [item.cover]);
  return (
    <div
      className={`art ${loaded ? "art-loaded" : ""} ${className}`}
      style={
        {
          "--art-hue": `${(item.artist.charCodeAt(0) * 13) % 360}deg`,
        } as React.CSSProperties
      }
    >
      {item.loadingPreview && !item.cover ? (
        <div className="art-loading">
          <Disc3 size={36} strokeWidth={1} />
        </div>
      ) : item.cover && !failed ? (
        <>
          <div className="art-loading">
            <Disc3 size={36} strokeWidth={1} />
          </div>
          <img
            src={item.cover}
            alt={`${item.title} cover`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        <div className="art-fallback">
          <Disc3 size={70} strokeWidth={0.8} />
          <span>{item.title}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State>(emptyState);
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState(
    () => localStorage.getItem("crate-demo") === "true",
  );
  const [view, setView] = useState<View>("library");
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [playlistId, setPlaylistId] = useState("");
  const [mini, setMini] = useState(false);
  useEffect(() => window.crate?.onWindowMode(setMini), []);
  useAppearance(state.settings);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      for (const el of document.querySelectorAll<HTMLDetailsElement>(
        ".toolbar-popover[open],.row-menu[open]",
      ))
        if (!el.contains(event.target as Node)) el.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const el of document.querySelectorAll<HTMLDetailsElement>(
        ".toolbar-popover[open],.row-menu[open]",
      )) {
        el.open = false;
        el.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const [settingsSection, setSettingsSection] = useState("library");
  const [scope, setScope] = useState("all");
  const [mode, setMode] = useState<Mode>("adjacent");
  const [kind, setKind] = useState<Kind>("album");
  const [engine, setEngine] = useState<Engine>("catalog");
  const [onlyPlayable, setOnlyPlayable] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recommended");
  const [gaps, setGaps] = useState(false);
  const [offset, setOffset] = useState(0);
  const [drawer, setDrawer] = useState<Item | null>(null);
  const [countBusyId, setCountBusyId] = useState<string | null>(null);
  const [countAttempt, setCountAttempt] = useState(0);
  useEffect(() => {
    if (
      !drawer ||
      drawer.kind !== "album" ||
      drawer.trackCount ||
      demo ||
      !window.crate
    ) {
      setCountBusyId(null);
      return;
    }
    let live = true;
    const item = drawer;
    setCountBusyId(item.id);
    window.crate
      .releaseCount(item)
      .then((counts) => {
        if (!live || !counts.trackCount) return;
        setDrawer((current) =>
          current?.id === item.id ? { ...current, ...counts } : current,
        );
        setItems((list) =>
          list.map((current) =>
            current.id === item.id ? { ...current, ...counts } : current,
          ),
        );
        setState((current) => {
          const entry = current.shelves[item.id];
          return entry
            ? {
                ...current,
                shelves: {
                  ...current.shelves,
                  [item.id]: { ...entry, item: { ...entry.item, ...counts } },
                },
              }
            : current;
        });
      })
      .catch(() => {})
      .finally(() => {
        if (live) setCountBusyId(null);
      });
    return () => {
      live = false;
    };
  }, [drawer?.id, countAttempt, demo]);
  const [youtubeItem, setYoutubeItem] = useState<Item | null>(null);
  const [soundcloudItem, setSoundcloudItem] = useState<Item | null>(null);
  const [current, setCurrent] = useState<Item | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(30);
  const [volume, setVolume] = useState(() =>
    Number(localStorage.getItem("crate-volume") ?? ".65"),
  );
  const [listen, setListen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    undo?: () => void;
  } | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [bulk, setBulk] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState<"genre" | "folder">("genre");
  const [exportOpen, setExportOpen] = useState(false);
  const [importFolder, setImportFolder] = useState(
    () => localStorage.getItem("crate-import-folder") || "",
  );
  const [importRoutes, setImportRoutes] = useState<ImportRoutes>({
    root: "",
    folders: [],
    truncated: false,
  });
  const [tagImportGenre, setTagImportGenre] = useState(
    () => localStorage.getItem("crate-import-tag-genre") === "true",
  );
  const [cleanImport, setCleanImport] = useState(
    () => localStorage.getItem("crate-import-clean") !== "false",
  );
  const [pendingImports, setPendingImports] = useState<string[]>([]);
  const [pendingExternal, setPendingExternal] = useState<string | null>(null);
  const handledExternal = useRef(new Set<string>());
  function sendExternalToImport(job: ExternalJob) {
    setPendingExternal(job.id);
    setPendingImports([]);
    setView("imports");
    setDrawer(null);
    setSidebar(false);
  }
  async function importExternal() {
    if (!pendingExternal || !window.crate) return;
    try {
      const jobs = await window.crate.externalImport(pendingExternal, {
        destinationFolder: importFolder,
        tagGenre: tagImportGenre,
        cleanComments: cleanImport,
      });
      setState((s) => ({ ...s, imports: jobs }));
      setPendingExternal(null);
    } catch (error) {
      notify(String(error));
    }
  }
  async function refreshImportFolders() {
    if (demo || !window.crate) return;
    try {
      const routes = await window.crate.importRoutes();
      setImportRoutes(routes);
      setImportFolder((current) =>
        routes.folders.includes(current) ? current : "",
      );
    } catch (e) {
      notify(String(e));
    }
  }
  useEffect(() => {
    void refreshImportFolders();
  }, [demo, state.settings.importRoot, state.lastScan]);
  useEffect(() => {
    if (!importRoutes.root) return;
    if (scope.startsWith("folder:")) {
      const selected = scope.slice(7),
        prefix =
          importRoutes.root + (importRoutes.root.includes("\\") ? "\\" : "/");
      const relative = selected.startsWith(prefix)
        ? selected.slice(prefix.length)
        : "";
      setImportFolder(importRoutes.folders.includes(relative) ? relative : "");
    } else if (scope.startsWith("genre:")) {
      const match = importRoutes.folders.find(
        (f) => nameOf(f).toLowerCase() === scope.slice(6).toLowerCase(),
      );
      setImportFolder(match || "");
    }
  }, [scope, importRoutes.root]);
  useEffect(() => {
    localStorage.setItem("crate-import-folder", importFolder);
  }, [importFolder]);
  useEffect(() => {
    localStorage.setItem("crate-import-tag-genre", String(tagImportGenre));
  }, [tagImportGenre]);
  useEffect(() => {
    localStorage.setItem("crate-import-clean", String(cleanImport));
  }, [cleanImport]);
  useEffect(
    () =>
      window.crate?.onAiActivity((aiActivity) =>
        setState((s) => ({ ...s, aiActivity })),
      ),
    [],
  );
  useEffect(
    () =>
      window.crate?.onImports((jobs) =>
        setState((s) => ({ ...s, imports: jobs })),
      ),
    [],
  );
  async function importFiles(files: string[], genreOverride?: string) {
    setPendingExternal(null);
    setView("imports");
    setSidebar(false);
    setDrawer(null);
    const zips = files.filter(Boolean);
    if (!zips.length) {
      notify("Drop a music folder or ZIP archive.");
      return;
    }
    if (demo) {
      notify("Leave the sample collection to import music.");
      return;
    }
    if (!state.settings.importRoot) {
      setPendingImports(zips);
      return;
    }
    try {
      const jobs = await window.crate!.importFiles(zips, {
        destinationFolder: genreOverride ?? importFolder,
        tagGenre: tagImportGenre,
        cleanComments: cleanImport,
      });
      setState((s) => ({ ...s, imports: jobs }));
      setPendingImports([]);
    } catch (e) {
      notify(String(e));
      setPendingImports(zips);
    }
  }
  async function chooseZips(folder = false) {
    try {
      const files = folder
        ? await window.crate?.chooseImportFolder()
        : await window.crate?.chooseZips();
      if (files?.length) await importFiles(files);
    } catch (e) {
      notify(String(e));
    }
  }
  const audio = useRef<HTMLAudioElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const mainScroll = useRef<HTMLElement>(null);
  useEffect(() => {
    mainScroll.current?.scrollTo({ top: 0, behavior: "instant" });
    setBulk(new Set());
    setQuery("");
  }, [view]);
  const request = useRef(0);
  const playRequest = useRef(0);
  function openYoutube(item: Item) {
    window.dispatchEvent(new Event("crate-preview-start"));
    playRequest.current++;
    audio.current?.pause();
    setBuffering(false);
    setListen(false);
    setYoutubeItem(item);
    setSoundcloudItem(null);
  }
  function openSoundcloud(item: Item) {
    window.dispatchEvent(new Event("crate-preview-start"));
    playRequest.current++;
    audio.current?.pause();
    setBuffering(false);
    setListen(false);
    setYoutubeItem(null);
    setSoundcloudItem(item);
  }
  useEffect(() => {
    const open = (event: Event) =>
      openYoutube((event as CustomEvent<Item>).detail);
    window.addEventListener("crate-youtube", open);
    const cloud = (event: Event) =>
      openSoundcloud((event as CustomEvent<Item>).detail);
    window.addEventListener("crate-soundcloud", cloud);
    return () => {
      window.removeEventListener("crate-youtube", open);
      window.removeEventListener("crate-soundcloud", cloud);
    };
  }, []);
  const boot = useRef(false);
  const prefs = useRef(false);
  const mutation = useRef(Promise.resolve());
  const shelvesRef = useRef(state.shelves);
  shelvesRef.current = state.shelves;
  const notify = (text: string, undo?: () => void) =>
    setToast({ text: userMessage(text), undo });
  const music = useLocalPlayer(demo, notify, state.settings);
  useEffect(() => {
    const refresh = () => {
      if (!demo && window.crate) {
        void window.crate
          .state({ includeTracks: false })
          .then((next) =>
            setState((current) =>
              current.libraryRevision === next.libraryRevision
                ? { ...next, tracks: current.tracks }
                : next,
            ),
          )
          .catch((e) => notify(String(e)));
        void music.refreshPlaylists();
      }
    };
    window.addEventListener("crate-library-changed", refresh);
    return () => window.removeEventListener("crate-library-changed", refresh);
  }, [demo]);
  useEffect(() => {
    const startLocal = () => {
      playRequest.current++;
      audio.current?.pause();
      setCurrent(null);
      setPlaying(false);
      setListen(false);
      setYoutubeItem(null);
      setSoundcloudItem(null);
    };
    window.addEventListener("crate-local-start", startLocal);
    return () => window.removeEventListener("crate-local-start", startLocal);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === search.current) {
        setGlobalQuery("");
        search.current?.blur();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(
    () =>
      window.crate?.onExternal((jobs) => {
        setState((s) => ({ ...s, externalJobs: jobs }));
        for (const job of jobs) {
          if (job.phase !== "complete" || handledExternal.current.has(job.id))
            continue;
          handledExternal.current.add(job.id);
          if (
            job.autoOpenImport &&
            job.outputPaths.length &&
            !job.importIds.length
          )
            sendExternalToImport(job);
        }
      }),
    [],
  );
  useEffect(
    () =>
      window.crate?.onExternalClose(() => {
        switchView("activity");
        notify(
          "An external command or its import is still running. Follow it in Activity before closing.",
        );
      }),
    [],
  );
  useEffect(() => {
    const run = async (event: Event) => {
      const detail = (
        event as CustomEvent<
          Item | { item: Item; url?: string; provider?: string }
        >
      ).detail;
      const item = "item" in detail ? detail.item : detail;
      const url = "item" in detail ? detail.url : undefined;
      const provider = "item" in detail ? detail.provider : undefined;
      if (demo || !window.crate) {
        notify(
          "External programs run in the desktop app with your own library.",
        );
        return;
      }
      if (!state.settings.externalCommand?.trim()) {
        openSettings("external");
        notify("Set your external program command, then save Settings.");
        return;
      }
      switchView("activity");
      try {
        const job = url
          ? await window.crate.externalRunUrl(url, scope, item)
          : await window.crate.externalRun(item, scope, provider);
        setState((s) => ({
          ...s,
          externalJobs: [
            ...(s.externalJobs || []).filter((j) => j.id !== job.id),
            job,
          ],
        }));
      } catch (e) {
        notify(String(e));
      }
    };
    window.addEventListener("crate-run-external", run);
    return () => window.removeEventListener("crate-run-external", run);
  }, [scope, demo, state.settings.externalCommand]);
  useEffect(
    () =>
      window.crate?.onImportClose(() => {
        setView("imports");
        notify(
          "An import is still running. You can close this window when the queue finishes.",
        );
      }),
    [],
  );
  const applyState = (s: State) => {
    for (const job of s.externalJobs || [])
      if (job.phase === "complete") handledExternal.current.add(job.id);
    setState(s);
    setView(
      s.settings.startupView && s.settings.startupView !== "last"
        ? s.settings.startupView
        : (s.settings.view as string) === "maybe"
          ? "wishlist"
          : s.settings.view === "activity"
            ? "library"
            : s.settings.view || "library",
    );
    setScope(s.settings.scope || "all");
    setMode(s.settings.mode);
    setKind(s.settings.kind || "album");
    setEngine(s.settings.engine || "catalog");
  };
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const native = window.crate
          ? await window.crate
              .state({ includeTracks: false })
              .catch(() => window.crate!.state())
          : emptyState;
        // Recover profiles left in sample mode by older Settings screens.
        const restoreLibrary = demo && native.folders.length > 0;
        if (restoreLibrary && mounted) {
          localStorage.setItem("crate-demo", "false");
          setDemo(false);
        }
        const s = demo && !restoreLibrary ? loadSample() : native;
        if (mounted) applyState(s);
      } catch (e) {
        notify(String(e));
      } finally {
        if (mounted) {
          setReady(true);
          boot.current = true;
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [demo]);
  useEffect(() => {
    if (
      !ready ||
      demo ||
      !window.crate ||
      state.tracks.length > 0 ||
      state.profile.total === 0 ||
      (view !== "discover" && view !== "taste")
    )
      return;
    let live = true;
    void window.crate
      .state()
      .then((next) => {
        if (live) setState(next);
      })
      .catch((e) => notify(String(e)));
    return () => {
      live = false;
    };
  }, [ready, demo, view, state.tracks, state.libraryRevision]);
  useEffect(() => {
    if (!ready || !boot.current) return;
    // Semantic appearance tokens are applied by useAppearance.
  }, [ready, state.settings.theme]);
  useEffect(() => {
    if (!ready) return;
    if (!prefs.current) {
      prefs.current = true;
      return;
    }
    const next = { view, scope, mode, kind, engine };
    if (demo) {
      setState((s) => ({ ...s, settings: { ...s.settings, ...next } }));
    } else window.crate?.settings(next).catch((e) => notify(String(e)));
  }, [view, scope, mode, kind, engine, ready, demo]);
  useEffect(() => {
    if (demo && ready) saveSample(state);
  }, [demo, ready, state]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? 9000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!window.crate || demo) return;
    let last = 0;
    return window.crate.onScan((p) => {
      setState((s) => ({ ...s, progress: p }));
      if (!p.running && p.wishlistRemoved)
        notify(
          `${p.wishlistRemoved} ${p.wishlistRemoved === 1 ? "record added" : "records added"} to your collection · removed from Wishlist.`,
        );
      if (!p.running || (p.checked > 0 && Date.now() - last > 1800)) {
        last = Date.now();
        window
          .crate!.state({ includeTracks: false })
          .then((s) => setState(s))
          .catch((e) => notify(String(e)));
      }
    });
  }, [demo]);
  useEffect(() => {
    if (!window.crate || demo) return;
    return window.crate.onFinds((data) => {
      if (data.engine === "ai") {
        if (data.shelfUpdate) {
          const update = data.shelfUpdate;
          setState((s) => {
            const entry = s.shelves[update.id];
            if (!entry) return s;
            return {
              ...s,
              shelves: {
                ...s.shelves,
                [update.id]: { ...entry, item: update.item },
              },
            };
          });
        }
        return;
      }
      if (data.requestId === request.current) {
        setItems(data.items);
        setBusy(false);
        if (data.shelfUpdate) {
          const update = data.shelfUpdate;
          setState((s) => {
            const entry = s.shelves[update.id];
            return entry
              ? {
                  ...s,
                  shelves: {
                    ...s.shelves,
                    [update.id]: { ...entry, item: update.item },
                  },
                }
              : s;
          });
        }
        if (!data.pending && !data.items.length)
          setMessage(
            "No preview tracks found in this pocket. Try albums or a different scope.",
          );
        else setMessage("");
      }
    });
  }, [demo]);
  const scanEpoch = state.profile.total > 0 ? 1 : 0;
  const scanDone = state.lastScan;
  useEffect(() => {
    if (!ready || !scanEpoch || engine === "ai") return;
    const id = ++request.current;
    setBusy(true);
    setMessage("");
    const timer = setTimeout(
      async () => {
        try {
          if (demo) {
            let result = sampleItems.filter((i) =>
              mode === "safe"
                ? ["Shoegaze", "Dream pop"].includes(i.genre)
                : mode === "wildcard"
                  ? [
                      "Jazz",
                      "Krautrock",
                      "Electronic",
                      "Ambient",
                      "Post-rock",
                    ].includes(i.genre)
                  : !["Jazz", "Krautrock"].includes(i.genre),
            );
            if (scope.startsWith("genre:")) {
              const tag = scope.slice(6);
              if (mode === "safe")
                result = result.filter((i) => i.genre === tag);
            }
            if (gaps)
              result = result.filter((i) =>
                ["Slowdive", "Ride", "Brian Eno", "Cocteau Twins"].includes(
                  i.artist,
                ),
              );
            if (kind === "track")
              result = result
                .filter((i) => i.preview)
                .map((i) => ({
                  ...i,
                  id: `track:${i.id}`,
                  kind: "track",
                  title: i.previewTitle || i.title,
                }));
            if (kind === "artist") {
              const owned = new Set(state.tracks.map((t) => t.artist));
              result = result
                .filter((i) => !owned.has(i.artist))
                .map((i) => ({
                  ...i,
                  id: `artist:${i.artist}`,
                  kind: "artist",
                  title: i.artist,
                }));
            }
            const r = offset % Math.max(1, result.length);
            result = [...result.slice(r), ...result.slice(0, r)];
            if (id === request.current) setItems(result);
          } else if (window.crate) {
            const result = await window.crate.discover({
              scope,
              mode,
              kind,
              gaps,
              offset,
              requestId: id,
            });
            if (id === request.current) {
              setItems(result.items);
              setMessage(result.message || "");
              if (result.warning) notify(result.warning);
            }
          }
        } catch (e) {
          if (id === request.current) {
            setItems([]);
            setMessage(
              `Couldn’t reach the music catalog. ${e instanceof Error ? e.message : "Please try again."}`,
            );
          }
        } finally {
          if (id === request.current) setBusy(false);
        }
      },
      demo ? 450 : 150,
    );
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [
    ready,
    demo,
    scope,
    mode,
    kind,
    gaps,
    offset,
    scanEpoch,
    scanDone,
    engine,
  ]);

  const scopedTracks = useMemo(
    () =>
      (view === "taste" ? state.tracks : []).filter(
        (t) =>
          scope === "all" ||
          (scope.startsWith("genre:") &&
            t.genre
              .split(/[,;/]/)
              .map((g) => g.trim())
              .includes(scope.slice(6))) ||
          (scope.startsWith("folder:") && inFolder(t, scope.slice(7))),
      ),
    [state.tracks, scope, view],
  );
  const scopedProfile = useMemo(() => profile(scopedTracks), [scopedTracks]);
  const ownedAlbums = useMemo(
    () =>
      new Set(
        (view === "discover" ? state.tracks : []).map((t) =>
          albumKey(t.artist, t.album),
        ),
      ),
    [state.tracks, view],
  );
  const ownedTracks = useMemo(
    () =>
      new Set(
        (view === "discover" ? state.tracks : []).map((t) =>
          trackKey(t.artist, t.title),
        ),
      ),
    [state.tracks, view],
  );
  const isShelf = ["wishlist", "rejected"].includes(view);
  const visible = useMemo(() => {
    let result = isShelf
      ? Object.values(state.shelves)
          .filter((e) => e.status === view)
          .map((e) => e.item)
      : items.filter(
          (i) =>
            !state.shelves[i.id] &&
            !Object.values(state.shelves).some(
              (e) =>
                (i.kind === "track"
                  ? trackKey(e.item.artist, e.item.title) ===
                    trackKey(i.artist, i.title)
                  : albumKey(e.item.artist, e.item.title) ===
                    albumKey(i.artist, i.title)) &&
                (e.item.kind === "track") === (i.kind === "track") &&
                e.status === "rejected",
            ),
        );
    if (!isShelf)
      result = result.filter((i) =>
        i.kind === "track"
          ? !ownedTracks.has(trackKey(i.artist, i.title)) &&
            (!i.album || !ownedAlbums.has(albumKey(i.artist, i.album)))
          : !ownedAlbums.has(albumKey(i.artist, i.album || i.title)),
      );
    if (!isShelf && engine === "ai" && onlyPlayable)
      result = result.filter((i) => !!i.preview && !i.loadingPreview);
    if (query)
      result = result.filter((i) =>
        `${i.title} ${i.artist} ${i.genre}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      );
    if (sort === "artist")
      result = [...result].sort((a, b) => a.artist.localeCompare(b.artist));
    if (sort === "year")
      result = [...result].sort((a, b) => (b.year || 0) - (a.year || 0));
    return result;
  }, [
    items,
    state.shelves,
    view,
    isShelf,
    query,
    sort,
    engine,
    onlyPlayable,
    ownedAlbums,
    ownedTracks,
  ]);
  const queue =
    engine === "ai" && !isShelf
      ? visible.filter((i) => i.preview && !i.loadingPreview)
      : visible;
  const chosen =
    (listen ? queue : visible).find((i) => i.id === selected) ||
    (listen ? queue : visible)[0];
  const activeItem = listen
    ? chosen
    : visible.find((i) => i.id === selected) || current || chosen;
  const nextItem =
    queue[
      (queue.findIndex((i) => i.id === current?.id) + 1) %
        Math.max(1, queue.length)
    ];
  const scopeLabel =
    scope === "all"
      ? "All your music"
      : scope.startsWith("genre:")
        ? scope.slice(6)
        : nameOf(scope.slice(7));

  async function chooseFolder() {
    try {
      if (!window.crate) {
        notify(
          "Folder scanning is available in the desktop app. Run “npm run dev” to open it.",
        );
        return;
      }
      const s = await window.crate.chooseFolder();
      if (s) {
        audio.current?.pause();
        setCurrent(null);
        setPlaying(false);
        setSelected(null);
        setListen(false);
        setDrawer(null);
        localStorage.setItem("crate-demo", "false");
        setDemo(false);
        setState(s);
        setScope("all");
        setView("library");
        setItems([]);
        notify("Folder added. Let’s see what’s on your shelves.");
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  }
  function startDemo() {
    audio.current?.pause();
    setCurrent(null);
    setPlaying(false);
    setSelected(null);
    localStorage.setItem("crate-demo", "true");
    setDemo(true);
    setListen(false);
    setDrawer(null);
    notify(
      "You’re exploring a sample collection. Add your folder whenever you’re ready.",
    );
  }
  async function updateSettings(value: SettingsUpdate) {
    if (
      (demo || !window.crate) &&
      (value.aiKey || value.youtubeKey || value.soundcloudCredentials)
    ) {
      notify("Add your own library before saving an API key.");
      return false;
    }
    try {
      const next = demo
        ? { ...state.settings, ...value }
        : window.crate
          ? await window.crate.settings(value)
          : { ...state.settings, ...value };
      setState((s) => ({ ...s, settings: next }));
      if (value.mode) setMode(value.mode);
      notify("Settings saved.");
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  async function writeShelf(item: Item, status: Shelf | null) {
    const previous = shelvesRef.current[item.id];
    const local = { ...shelvesRef.current };
    if (status)
      local[item.id] = { item, status, added: new Date().toISOString() };
    else delete local[item.id];
    shelvesRef.current = local;
    setState((s) => ({ ...s, shelves: local }));
    if (!demo && window.crate) {
      await new Promise<void>((resolve, reject) => {
        mutation.current = mutation.current.then(async () => {
          try {
            const saved = await window.crate!.shelf(item, status);
            shelvesRef.current = saved;
            setState((s) => ({ ...s, shelves: saved }));
            resolve();
          } catch (e) {
            setState((s) => {
              const rollback = { ...s.shelves };
              if (previous) rollback[item.id] = previous;
              else delete rollback[item.id];
              shelvesRef.current = rollback;
              return { ...s, shelves: rollback };
            });
            reject(e);
          }
        });
      });
    }
  }
  async function removeSaved(item: Item) {
    const previous = shelvesRef.current[item.id]?.status;
    if (!previous) return;
    try {
      await writeShelf(item, null);
      setBulk((ids) => {
        const next = new Set(ids);
        next.delete(item.id);
        return next;
      });
      notify(
        previous === "wishlist"
          ? `“${item.title}” removed from Wishlist.`
          : `“${item.title}” restored to discovery.`,
        () => {
          void writeShelf(item, previous).catch((e) => notify(String(e)));
          setToast(null);
        },
      );
    } catch (e) {
      notify(String(e));
    }
  }
  async function shelve(item: Item, status: Shelf) {
    const previous = shelvesRef.current[item.id]?.status || null;
    const actionQueue = listen ? queue : visible;
    const idx = actionQueue.findIndex((i) => i.id === item.id),
      next = actionQueue[idx + 1] || actionQueue[idx - 1];
    try {
      await writeShelf(item, status);
      notify(
        status === "wishlist"
          ? `“${item.title}” kept for later.`
          : `Less like “${item.title}”. Discovery updated.`,
        () => {
          writeShelf(item, previous).catch((e) => notify(String(e)));
          setToast(null);
        },
      );
      if (listen && next) {
        setSelected(next.id);
        void play(next);
      } else if (listen) {
        setListen(false);
        audio.current?.pause();
      }
    } catch (e) {
      notify(`Couldn’t save that choice. ${String(e)}`);
    }
  }
  async function play(item: Item) {
    window.dispatchEvent(new Event("crate-preview-start"));
    const playId = ++playRequest.current;
    if (item.loadingPreview) {
      notify("Finding the preview. Your record will be ready in a moment.");
      return;
    }
    if (!item.preview) {
      if (item.soundcloud) openSoundcloud(item);
      else openYoutube(item);
      return;
    }
    if (!demo && window.crate && item.previewSource === "deezer") {
      const expiry =
        Number(
          new URL(item.preview).searchParams
            .get("hdnea")
            ?.match(/exp=(\d+)/)?.[1],
        ) * 1000;
      if (!expiry || expiry < Date.now() + 60000) {
        setBuffering(true);
        try {
          const fresh = await window.crate.refreshPreview(item);
          if (playRequest.current !== playId) return;
          if (!fresh?.preview) {
            notify(
              "No matching clip is available now. Try the YouTube search for this release.",
            );
            return;
          }
          item = { ...item, ...fresh };
          setItems((list) => list.map((i) => (i.id === item.id ? item : i)));
        } catch {
          notify("Could not refresh this clip. Try the release link.");
          return;
        } finally {
          if (playRequest.current === playId) setBuffering(false);
        }
      }
    }
    const el = audio.current;
    if (!el) return;
    setSelected(item.id);
    if (current?.id === item.id && el.src === item.preview && !el.paused) {
      el.pause();
      return;
    }
    if (current?.id !== item.id || el.src !== item.preview) {
      setCurrent(item);
      el.src = item.preview!;
      setTime(0);
    }
    setBuffering(true);
    try {
      await el.play();
    } catch (e) {
      if ((e as DOMException).name !== "AbortError")
        notify("That preview couldn’t play. Try another record.");
    } finally {
      setBuffering(false);
    }
  }
  function navigate(delta: number) {
    if (!queue.length) return;
    const pos = queue.findIndex(
      (i) => i.id === (listen ? chosen?.id : current?.id || selected),
    );
    const item = queue[(pos + delta + queue.length) % queue.length];
    setSelected(item.id);
    if (listen || current) void play(item);
  }
  function surprise() {
    if (!queue.length) {
      if (engine === "ai") {
        notify("Generate a batch and wait for a matching preview first.");
        return;
      }
      setOffset((n) => n + 1);
      notify("Digging for something unexpected…");
      return;
    }
    const others = queue.filter((i) => i.id !== current?.id);
    const item = (others.length ? others : queue)[
      Math.floor(Math.random() * (others.length || queue.length))
    ];
    setSelected(item.id);
    setDrawer(item);
    void play(item);
  }
  useEffect(() => {
    if (listen && chosen?.preview && current?.id !== chosen.id)
      void play(chosen);
  }, [listen, chosen?.id, chosen?.preview, current?.id]);
  function openListen() {
    if (!queue.length) return;
    const first = queue.find((i) => i.id === selected) || queue[0];
    setListen(true);
    setDrawer(null);
    setSelected(first.id);
    void play(first);
  }
  useEffect(() => {
    const el = audio.current;
    if (el) el.volume = volume;
    localStorage.setItem("crate-volume", String(volume));
  }, [volume]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (youtubeItem || soundcloudItem) return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.matches("input,textarea,select") ||
          event.target.isContentEditable)
      )
        return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        [" ", "Enter"].includes(event.key) &&
        event.target instanceof Element &&
        event.target.closest("button,a,summary,[role=button]")
      )
        return;
      if (music.current && !current) {
        if (event.key === " ") {
          event.preventDefault();
          music.toggle();
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          music.next();
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          music.previous();
          return;
        }
      }
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        if (current) void play(current);
        else if (chosen) void play(chosen);
      }
      if (key === "/") {
        event.preventDefault();
        search.current?.focus();
      }
      if (key === "k" && activeItem) void shelve(activeItem, "wishlist");
      if (key === "r" && activeItem) void shelve(activeItem, "rejected");
      if (key === "s") surprise();
      if (key === "arrowright") {
        event.preventDefault();
        navigate(1);
      }
      if (key === "arrowleft") {
        event.preventDefault();
        navigate(-1);
      }
      if (key === "escape") {
        setListen(false);
        setDrawer(null);
        setSidebar(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    setBulk(new Set());
    setQuery("");
    setListen(false);
    setYoutubeItem(null);
    setSoundcloudItem(null);
    document.querySelector(".main-scroll")?.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    setSelected(null);
    setOffset(0);
    setListen(false);
  }, [scope, mode, kind, gaps, engine]);
  async function exportItems(format: "csv" | "txt") {
    setExportOpen(false);
    const entries = Object.values(state.shelves)
      .filter(
        (e) => e.status === view && (bulk.size === 0 || bulk.has(e.item.id)),
      )
      .map((e) => e.item);
    if (!entries.length) {
      notify("Save a few records to export them.");
      return;
    }
    if (!demo && window.crate) {
      try {
        if (await window.crate.export(entries, format))
          notify("Your finds are exported.");
      } catch (e) {
        notify(String(e));
      }
      return;
    }
    const cell = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return `"${s.replaceAll('"', '""')}"`;
    };
    const text =
      format === "txt"
        ? entries
            .map(
              (i) => `${i.artist} — ${i.title} (${i.year || "unknown year"})`,
            )
            .join("\n")
        : [
            "Artist,Album,Genre,Year,Reason",
            ...entries.map((i) =>
              [i.artist, i.title, i.genre, i.year, i.reason]
                .map(cell)
                .join(","),
            ),
          ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], {
        type:
          format === "csv"
            ? "text/csv;charset=utf-8"
            : "text/plain;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `Crate Digger ${shelfNames[view as Shelf]}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Your finds are exported.");
  }
  async function moveBulk(status: Shelf | null) {
    const moving = visible.filter((i) => bulk.has(i.id));
    try {
      for (const item of moving) await writeShelf(item, status);
      setBulk(new Set());
      notify(
        status
          ? `${moving.length} records saved.`
          : `${moving.length} records removed.`,
      );
    } catch (e) {
      notify(String(e));
    }
  }
  function switchView(next: View) {
    if (next === "activity") {
      setTasksOpen(true);
      music.setQueueOpen(false);
      setDrawer(null);
      return;
    }
    const proceed = () => {
      setGlobalQuery("");
      setView(next);
      setSidebar(false);
      setDrawer(null);
    };
    const event = new CustomEvent("crate-before-navigate", {
      cancelable: true,
      detail: proceed,
    });
    if (!window.dispatchEvent(event)) return;
    proceed();
  }
  function openSettings(section = "preferences") {
    setSettingsSection(section);
    switchView("settings");
  }
  const onboarding =
    ready &&
    !state.tracks.length &&
    !state.folders.length &&
    view !== "settings" &&
    view !== "activity" &&
    view !== "imports";
  const card = (item: Item, index: number) => (
    <article
      key={item.id}
      className={`record-card ${selected === item.id ? "selected" : ""}`}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("text/crate-item", JSON.stringify(item))
      }
    >
      <div className="cover-wrap">
        <button
          className="cover-button"
          onClick={() => {
            setSelected(item.id);
            setDrawer(item);
          }}
          aria-label={`Details for ${item.artist}, ${item.title}`}
        >
          <Art item={item} />
        </button>
        {item.origin === "ai" && (
          <span className="ai-preview-status">
            {item.loadingPreview
              ? "Checking release…"
              : item.preview
                ? "Preview ready"
                : item.soundcloud?.confirmed && item.catalogVerified
                  ? "SoundCloud upload"
                  : item.catalogVerified
                    ? "No clip · try YouTube"
                    : "Unverified · check release"}
          </span>
        )}
        <span className="cover-kind">
          {item.kind === "track"
            ? "TRACK"
            : item.kind === "artist"
              ? "ARTIST"
              : item.releaseType === "ep"
                ? "EP"
                : item.releaseType === "playlist"
                  ? "PLAYLIST"
                  : item.year || "ALBUM"}
        </span>
        {isShelf && (
          <button
            className={`bulk-check ${bulk.has(item.id) ? "checked" : ""}`}
            aria-label={`Select ${item.title}`}
            aria-pressed={bulk.has(item.id)}
            onClick={() =>
              setBulk((s) => {
                const n = new Set(s);
                n.has(item.id) ? n.delete(item.id) : n.add(item.id);
                return n;
              })
            }
          >
            {bulk.has(item.id) && <Check size={14} />}
          </button>
        )}
        <button
          className={`cover-play ${current?.id === item.id && playing ? "is-playing" : ""}`}
          aria-label={`${current?.id === item.id && playing ? "Pause" : item.preview ? "Preview" : item.soundcloud ? "SoundCloud for" : "YouTube for"} ${item.title}`}
          title={
            item.preview
              ? "Play preview"
              : item.soundcloud
                ? "Listen on SoundCloud"
                : "Find a YouTube video"
          }
          disabled={item.loadingPreview}
          onClick={() => void play(item)}
        >
          {item.loadingPreview ? (
            <Loader2 className="spin" size={20} />
          ) : current?.id === item.id && playing ? (
            <Pause fill="currentColor" size={23} />
          ) : !item.preview && item.soundcloud ? (
            <Cloud size={23} />
          ) : !item.preview ? (
            <Youtube size={23} />
          ) : (
            <Play fill="currentColor" size={23} />
          )}
        </button>
      </div>
      <div className="record-heading">
        <div>
          <button className="record-title" onClick={() => setDrawer(item)}>
            {item.title}
          </button>
          <p className="record-artist">
            {item.kind === "artist" ? `Featuring ${item.album}` : item.artist}
          </p>
        </div>
        <button
          className="icon-button more-button"
          aria-label={`More about ${item.title}`}
          title="Record details"
          onClick={() => setDrawer(item)}
        >
          <Ellipsis size={20} />
        </button>
      </div>
      <div className="record-tags">
        <button
          className="genre-tag"
          onClick={() => {
            setScope(`genre:${item.genre}`);
            setView("discover");
          }}
        >
          {item.genre}
        </button>
        {gaps && <span className="gap-label">A collection gap</span>}
        <TrackCount item={item} busy={!!item.loadingPreview} />
      </div>
      <p className="record-reason">
        <Sparkles size={12} />
        <span>{item.reason}</span>
      </p>
      {item.basedOn?.length ? (
        <p className="ai-card-basis">
          From your {item.basedOn.map((a) => a.album).join(" + ")} records
        </p>
      ) : null}
      <div className="card-actions">
        {isShelf ? (
          <button
            className="remove-record"
            onClick={() => void removeSaved(item)}
            aria-label={`${view === "wishlist" ? "Remove" : "Restore"} ${item.title}${view === "wishlist" ? " from Wishlist" : " to discovery"}`}
          >
            {view === "wishlist" ? (
              <Minus size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            <span>{view === "wishlist" ? "Remove" : "Restore"}</span>
          </button>
        ) : (
          <>
            <button
              title="Save to Wishlist · K"
              onClick={() => void shelve(item, "wishlist")}
            >
              <Heart size={15} />
              <span>Save</span>
            </button>
            <button
              title="Refine discovery · R"
              onClick={() => void shelve(item, "rejected")}
            >
              <X size={15} />
              <span>Less like this</span>
            </button>
          </>
        )}
        <button
          className="browser-search"
          title="Open YouTube search"
          aria-label={`Search ${item.title} on YouTube`}
          onClick={() =>
            openExternal(
              providerSearchLinks(item).find((link) => link.id === "youtube")!
                .url,
            )
          }
        >
          <Youtube size={16} />
        </button>
      </div>
    </article>
  );

  return (
    <ChromeContext.Provider value={toolbarHost}>
      <div
        className={`app-shell quiet-shell ${mini ? "mini-mode" : ""} ${music.queueOpen && !tasksOpen ? "has-queue" : ""} ${current ? "has-player" : "idle-player"} ${sidebar ? "sidebar-open" : ""} ${drawer ? "has-drawer" : ""}`}
      >
        <header className="app-titlebar">
          <button
            className="title-brand"
            onClick={() => {
              setPlaylistId("");
              switchView("library");
            }}
            aria-label="Crate Digger home"
          >
            <Mark />
            <span>Crate Digger</span>
          </button>
          <div className="global-search">
            <Search size={15} />
            <input
              ref={search}
              aria-label="Search music"
              placeholder="Search music"
              value={globalQuery}
              onChange={(e) => {
                const value = e.target.value;
                const event = new CustomEvent("crate-before-navigate", {
                  cancelable: true,
                  detail: () => setGlobalQuery(value),
                });
                if (globalQuery || window.dispatchEvent(event))
                  setGlobalQuery(value);
              }}
            />
            {globalQuery ? (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setGlobalQuery("")}
              >
                <X size={14} />
              </button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </div>
          <button
            className={`tasks-button ${tasksOpen ? "active" : ""}`}
            aria-label="Tasks"
            aria-pressed={tasksOpen}
            onClick={() => {
              setTasksOpen(!tasksOpen);
              music.setQueueOpen(false);
              setDrawer(null);
            }}
          >
            Tasks
            {activeTaskCount(state) > 0 && (
              <span>{activeTaskCount(state)}</span>
            )}
          </button>
        </header>
        <aside className="sidebar">
          <nav className="main-nav" aria-label="Main navigation">
            <button
              className={view === "library" && !playlistId ? "active" : ""}
              onClick={() => {
                setPlaylistId("");
                switchView("library");
              }}
            >
              <Library size={20} />
              <span>Library</span>
            </button>
            <button
              className={view === "discover" ? "active" : ""}
              onClick={() => switchView("discover")}
            >
              <Disc3 size={20} />
              <span>Discover</span>
            </button>
            <button
              className={view === "wishlist" ? "active" : ""}
              onClick={() => switchView("wishlist")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                try {
                  const data = JSON.parse(
                    e.dataTransfer.getData("text/crate-item"),
                  );
                  const item =
                    items.find((i) => i.id === data.id) ||
                    state.shelves[data.id]?.item;
                  if (item) void shelve(item, "wishlist");
                } catch {
                  /* Ignore external drops. */
                }
              }}
            >
              <Heart size={20} />
              <span>Wishlist</span>
              <span className="nav-count">
                {Object.values(state.shelves).filter(
                  (e) => e.status === "wishlist",
                ).length || ""}
              </span>
            </button>
          </nav>
          <section className="sidebar-playlists" aria-label="Playlists">
            <span className="sidebar-label">Playlists</span>
            {music.playlists.map((list) => (
              <button
                key={list.id}
                className={
                  view === "library" && playlistId === list.id ? "active" : ""
                }
                onClick={() => {
                  setPlaylistId(list.id);
                  switchView("library");
                }}
              >
                <Music2 size={15} />
                <span>{list.name}</span>
              </button>
            ))}
            <button
              onClick={() => {
                setPlaylistId("");
                switchView("library");
                setTimeout(
                  () =>
                    window.dispatchEvent(
                      new CustomEvent("crate-new-playlist", { detail: [] }),
                    ),
                  100,
                );
              }}
            >
              <Plus size={15} />
              <span>New playlist</span>
            </button>
          </section>
          <div className="sidebar-bottom">
            {demo && (
              <div className="demo-note">
                <span className="status-dot" />
                Sample collection
                <button
                  onClick={() => {
                    audio.current?.pause();
                    setCurrent(null);
                    setPlaying(false);
                    setSelected(null);
                    setDrawer(null);
                    localStorage.setItem("crate-demo", "false");
                    setDemo(false);
                    setView("library");
                  }}
                  title="Leave sample collection"
                  aria-label="Leave sample collection"
                >
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
            <button
              className={`settings-nav ${view === "imports" ? "active" : ""}`}
              onClick={() => switchView("imports")}
            >
              <Upload size={18} />
              Import music
            </button>
            <button
              className={`settings-nav ${view === "settings" ? "active" : ""}`}
              onClick={() => openSettings()}
            >
              <Settings2 size={18} />
              Settings
            </button>
          </div>
        </aside>
        {sidebar && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          />
        )}
        <div className="workspace">
          <header className="context-toolbar" aria-label="Page controls">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebar((v) => !v)}
            >
              <Menu size={18} />
            </button>
            {view === "discover" && !globalQuery && !onboarding && (
              <DiscoverySwitch engine={engine} onChange={setEngine} />
            )}
            {["imports", "settings", "taste"].includes(view) &&
              !globalQuery && (
                <span className="toolbar-context">
                  {view === "imports"
                    ? "Import music"
                    : view === "settings"
                      ? "Settings"
                      : "Collection profile"}
                </span>
              )}
            <div className="context-controls" ref={setToolbarHost} />
            <button
              className={`icon-button ${music.queueOpen ? "active" : ""}`}
              aria-label="Toggle queue"
              aria-pressed={music.queueOpen}
              onClick={() => {
                music.setQueueOpen(!music.queueOpen);
                setTasksOpen(false);
                setDrawer(null);
              }}
            >
              <Menu size={18} />
            </button>
          </header>
          <UpdateBanner />
          <main
            ref={mainScroll}
            className={`main-scroll ${onboarding ? "onboarding-scroll" : ""}`}
          >
            {/* Keep discovery mounted so Activity can monitor an in-flight call. */}
            {ready && !onboarding && engine === "ai" && (
              <div
                className="content-wrap ai-content-wrap"
                hidden={view !== "discover" || !!globalQuery}
              >
                <AiDiscovery
                  active={view === "discover" && !globalQuery}
                  state={state}
                  demo={demo}
                  scope={scope}
                  mode={mode}
                  items={items}
                  visible={visible}
                  onlyPlayable={onlyPlayable}
                  onScope={setScope}
                  onMode={setMode}
                  onItems={setItems}
                  onPlayable={setOnlyPlayable}
                  onConfigure={() => openSettings("ai")}
                  onActivity={() => openSettings("ai-usage")}
                  renderCard={card}
                  renderArt={(item) => <Art item={item} />}
                  listen={listen}
                  chosen={chosen}
                  current={current}
                  playing={playing}
                  onListen={openListen}
                  onLeave={() => setListen(false)}
                  onPlay={(item) => void play(item)}
                  onShelf={(item, shelf) => void shelve(item, shelf)}
                />
              </div>
            )}
            {!ready ? (
              <div className="loading-screen">
                <Mark />
                <Loader2 className="spin" />
                <p>Opening your record store…</p>
              </div>
            ) : onboarding ? (
              <div className="onboarding">
                <div className="onboarding-illustration">
                  <div className="onboard-record" />
                  <div className="onboard-sleeve">
                    <span>
                      GOOD MUSIC.
                      <br />
                      FOUND HERE.
                    </span>
                    <Disc3 size={46} strokeWidth={1} />
                    <small>CRATE DIGGER / VOL. 01</small>
                  </div>
                  <span className="floating-note">
                    <Music2 size={25} />
                  </span>
                </div>
                <p className="eyebrow">A PRIVATE LITTLE RECORD STORE</p>
                <h1>
                  Your next favorite
                  <br />
                  starts with your favorites.
                </h1>
                <p className="onboard-copy">
                  Point us to your music. We’ll get to know your shelves
                  <br className="wide-only" /> and find the records that belong
                  beside them.
                </p>
                <button
                  className="primary-button large"
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen size={19} />
                  Choose your music folder
                  <ArrowRight size={17} />
                </button>
                <button className="sample-button" onClick={startDemo}>
                  Or take a look around with a sample collection{" "}
                  <ArrowRight size={14} />
                </button>
                <div className="onboard-promises">
                  <span>
                    <Check size={13} />
                    No account, ever
                  </span>
                  <span>
                    <Check size={13} />
                    Existing music stays untouched
                  </span>
                  <span>
                    <Check size={13} />
                    Entirely your own
                  </span>
                </div>
              </div>
            ) : globalQuery || view === "library" ? (
              <LibraryView
                onOpenRecord={setDrawer}
                onClearSearch={() => setGlobalQuery("")}
                state={state}
                demo={demo}
                music={music}
                playlist={globalQuery ? "" : playlistId}
                search={globalQuery}
                onPlaylist={(id) => {
                  setPlaylistId(id);
                  switchView("library");
                }}
                onAdd={() => void chooseFolder()}
                notify={notify}
              />
            ) : view === "activity" ? (
              <ExternalActivity
                aiActivity={state.aiActivity}
                jobs={state.externalJobs || []}
                configured={!!state.settings.externalCommand?.trim() && !demo}
                onRunUrl={async (url) => {
                  if (!window.crate || demo)
                    throw new Error(
                      "Use your own library in the desktop app to run a program.",
                    );
                  const job = await window.crate.externalRunUrl(url, scope);
                  setState((current) => ({
                    ...current,
                    externalJobs: [
                      ...(current.externalJobs || []).filter(
                        (entry) => entry.id !== job.id,
                      ),
                      job,
                    ],
                  }));
                }}
                onImports={() => switchView("imports")}
                onSettings={() => openSettings("external")}
                onSend={sendExternalToImport}
                onClear={async (id) => {
                  try {
                    const jobs = await window.crate?.externalClear(id);
                    if (jobs) setState((s) => ({ ...s, externalJobs: jobs }));
                  } catch (error) {
                    notify(String(error));
                  }
                }}
              />
            ) : view === "imports" ? (
              <>
                <section
                  className="import-link-source"
                  aria-label="Run a pasted URL"
                >
                  <details>
                    <summary>From a music link</summary>
                    <ExternalUrlForm
                      disabled={demo || !state.settings.externalCommand?.trim()}
                      onRun={async (url) => {
                        if (!window.crate || demo) return;
                        const job = await window.crate.externalRunUrl(
                          url,
                          scope,
                        );
                        setState((s) => ({
                          ...s,
                          externalJobs: [...(s.externalJobs || []), job],
                        }));
                        setTasksOpen(true);
                      }}
                    />
                    {!state.settings.externalCommand?.trim() && (
                      <button
                        className="text-button"
                        onClick={() => openSettings("external")}
                      >
                        Set up an external tool
                      </button>
                    )}
                  </details>
                </section>
                <ImportView
                  state={state}
                  genre={importFolder}
                  routes={importRoutes}
                  tagGenre={tagImportGenre}
                  onTagGenre={setTagImportGenre}
                  onRefresh={() => void refreshImportFolders()}
                  clean={cleanImport}
                  pending={pendingImports}
                  externalJob={state.externalJobs?.find(
                    (job) => job.id === pendingExternal,
                  )}
                  onImportExternal={() => void importExternal()}
                  onDismissExternal={() => setPendingExternal(null)}
                  demo={demo}
                  onGenre={setImportFolder}
                  onClean={setCleanImport}
                  onChoose={() => void chooseZips()}
                  onChooseFolder={() => void chooseZips(true)}
                  onSettings={(settings) =>
                    setState((s) => ({ ...s, settings }))
                  }
                  onImport={(files, genre) => void importFiles(files, genre)}
                  onError={notify}
                />
              </>
            ) : view === "settings" ? (
              <SettingsView
                initialSection={settingsSection}
                state={state}
                demo={demo}
                onSave={updateSettings}
                onAdd={chooseFolder}
                onFeedback={() => switchView("rejected")}
                onRemove={async (root) => {
                  try {
                    if (demo) {
                      notify(
                        "These folders belong to the sample collection. Add your own to get started.",
                      );
                      return;
                    }
                    const s = await window.crate!.removeFolder(root);
                    setState(s);
                    setScope("all");
                    notify(
                      "Folder removed from the index. Music files are untouched.",
                    );
                  } catch (e) {
                    notify(String(e));
                  }
                }}
                onRescan={() => {
                  if (demo)
                    notify("The sample collection is already up to date.");
                  else
                    void window.crate?.scan().catch((e) => notify(String(e)));
                }}
              />
            ) : view === "taste" ? (
              <TasteView
                state={state}
                scope={scopeLabel}
                profile={scopedProfile}
                onGenre={(genre) => {
                  setScope(`genre:${genre}`);
                  switchView("discover");
                }}
                onDiscover={() => switchView("discover")}
                onExplain={async () => {
                  if (demo)
                    return `Your sample collection leans into shoegaze, with ambient textures and a post-punk backbone.`;
                  return await window.crate!.explain({
                    id: "taste-profile",
                    kind: "album",
                    title: "Your taste",
                    artist: "Your library",
                    genre: "",
                    year: null,
                    cover: "",
                    preview: null,
                    reason:
                      "A summary of your library genre mix and top artists.",
                    seeds: [],
                    sourceFolder: "",
                  });
                }}
                onError={notify}
              />
            ) : view === "discover" && engine === "ai" ? null : (
              <div className="content-wrap">
                {state.progress?.running && (
                  <div className="scan-banner">
                    <Loader2 size={16} className="spin" />
                    <div>
                      <strong>Getting to know your collection</strong>
                      <span>
                        {compact(state.progress.checked)} files checked ·{" "}
                        {state.progress.current}
                      </span>
                    </div>
                    <div className="scan-line" />
                  </div>
                )}
                <Toolbar>
                  {view === "discover" ? (
                    <>
                      <select
                        aria-label="Discovery scope"
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                      >
                        <option value="all">All your music</option>
                        <optgroup label="Genres">
                          {state.profile.genres.map((g) => (
                            <option key={g.name} value={"genre:" + g.name}>
                              {g.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Folders">
                          {folderOptions(state).map((f) => (
                            <option key={f.path} value={"folder:" + f.path}>
                              {f.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      <select
                        aria-label="Discovery mode"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as Mode)}
                      >
                        <option value="safe">Familiar</option>
                        <option value="adjacent">Explore</option>
                        <option value="wildcard">Adventurous</option>
                      </select>
                      <select
                        aria-label="Discovery format"
                        value={kind}
                        onChange={(e) => setKind(e.target.value as Kind)}
                      >
                        <option value="album">Albums</option>
                        <option value="track">Tracks</option>
                        <option value="artist">Artists</option>
                      </select>
                    </>
                  ) : (
                    <>
                      <span className="toolbar-context">
                        {shelfNames[view as Shelf]}
                      </span>
                      <select
                        aria-label="Group saved records"
                        value={group}
                        onChange={(e) =>
                          setGroup(e.target.value as "genre" | "folder")
                        }
                      >
                        <option value="genre">By genre</option>
                        <option value="folder">By folder</option>
                      </select>
                    </>
                  )}
                  <details className="toolbar-popover">
                    <summary>
                      <SlidersHorizontal size={14} />
                      Filters{query || gaps ? " · active" : ""}
                    </summary>
                    <div className="popover-panel">
                      <label>
                        Filter these records
                        <input
                          value={query}
                          aria-label="Filter your finds"
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Artist, album, genre"
                        />
                      </label>
                      {view === "discover" && (
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={gaps}
                            onChange={(e) => setGaps(e.target.checked)}
                          />
                          Collection gaps
                        </label>
                      )}
                      <button
                        className="text-button"
                        onClick={() => {
                          setQuery("");
                          setGaps(false);
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  </details>
                  <span className="toolbar-spacer" />
                  <span className="toolbar-count" role="status">
                    {busy ? "Digging…" : visible.length + " records"}
                  </span>
                  <select
                    aria-label="Sort finds"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="recommended">Picked for you</option>
                    <option value="artist">Artist A–Z</option>
                    <option value="year">Newest first</option>
                  </select>
                  {view === "discover" ? (
                    <>
                      <button
                        className="icon-button"
                        aria-label="Listen to previews"
                        disabled={!visible.length}
                        onClick={openListen}
                      >
                        <Headphones size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Find more records"
                        onClick={() => setOffset((n) => n + 1)}
                      >
                        <RefreshCw size={16} />
                      </button>
                      <details className="toolbar-popover">
                        <summary aria-label="Discovery pages">
                          <Ellipsis size={17} />
                        </summary>
                        <div className="popover-panel">
                          <button onClick={() => switchView("taste")}>
                            Collection profile
                          </button>
                          <button onClick={() => switchView("rejected")}>
                            Hidden records
                          </button>
                          <button onClick={surprise}>Surprise me</button>
                        </div>
                      </details>
                    </>
                  ) : (
                    <button
                      className="icon-button"
                      aria-label="Export saved records"
                      onClick={() => void exportItems("txt")}
                    >
                      <ArrowDownToLine size={16} />
                    </button>
                  )}
                </Toolbar>
                <section className="finds-section">
                  {bulk.size > 0 && isShelf && (
                    <div className="bulk-bar">
                      <span>{bulk.size} selected</span>
                      <button
                        onClick={() =>
                          setBulk(new Set(visible.map((i) => i.id)))
                        }
                      >
                        Select all
                      </button>
                      <span className="bulk-spacer" />
                      <button onClick={() => void moveBulk(null)}>
                        {view === "wishlist"
                          ? "Remove selected"
                          : "Restore selected"}
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => setBulk(new Set())}
                        aria-label="Clear selection"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  {listen && chosen ? (
                    <section className="listen-view">
                      <div className="listen-top">
                        <span>
                          <Headphones size={15} />
                          LISTEN MODE
                        </span>
                        <button
                          className="text-button"
                          onClick={() => setListen(false)}
                        >
                          Back to the crates <X size={15} />
                        </button>
                      </div>
                      <div className="listen-body">
                        <button
                          className="listen-cover"
                          onClick={() => void play(chosen)}
                          aria-label={`Preview ${chosen.title}`}
                        >
                          <Art item={chosen} />
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
                          <div className="listen-actions">
                            <button
                              onClick={() => void shelve(chosen, "rejected")}
                            >
                              <X size={22} />
                              <span>
                                Less like this <kbd>R</kbd>
                              </span>
                            </button>
                            <button
                              className="keep-listen"
                              onClick={() => void shelve(chosen, "wishlist")}
                            >
                              <Heart size={22} />
                              <span>
                                Save <kbd>K</kbd>
                              </span>
                            </button>
                          </div>
                          <div className="listen-hint">
                            <ArrowLeft size={13} />
                            <ArrowRight size={13} /> to skip · Space to pause ·
                            Esc to leave
                          </div>
                        </div>
                      </div>
                    </section>
                  ) : busy && !isShelf ? (
                    <div className="records-grid skeleton-grid">
                      {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="skeleton-card">
                          <div className="skeleton-cover" />
                          <div className="skeleton-line" />
                          <div className="skeleton-line short" />
                          <div className="skeleton-line tiny" />
                        </div>
                      ))}
                    </div>
                  ) : visible.length ? (
                    isShelf ? (
                      <>
                        {Object.entries(
                          visible.reduce(
                            (acc, i) => {
                              const k =
                                group === "genre"
                                  ? i.genre
                                  : nameOf(i.sourceFolder) || "All your music";
                              (acc[k] ??= []).push(i);
                              return acc;
                            },
                            {} as Record<string, Item[]>,
                          ),
                        ).map(([groupName, records]) => (
                          <div className="shelf-group" key={groupName}>
                            <h3>
                              <span className="genre-dot" />
                              {groupName}
                              <span>{records.length}</span>
                            </h3>
                            <div className="records-grid">
                              {records.map(card)}
                            </div>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="records-grid">{visible.map(card)}</div>
                    )
                  ) : (
                    <div className="empty-state">
                      {query ? (
                        <Search size={30} />
                      ) : isShelf ? (
                        <Heart size={30} />
                      ) : (
                        <Disc3 size={34} />
                      )}
                      <h3>
                        {query
                          ? "Nothing in this crate matches."
                          : isShelf
                            ? view === "wishlist"
                              ? "Your next favorites go here."
                              : "No hidden records."
                            : message
                              ? "A quiet corner of the record store."
                              : "Ready when your collection is."}
                      </h3>
                      <p>
                        {query
                          ? "Try an artist, album, or genre."
                          : isShelf
                            ? view === "rejected"
                              ? "Less like this helps shape your next discoveries."
                              : "Tap the heart on a record to save it."
                            : message ||
                              "We’ll start finding music as soon as your first tracks are indexed."}
                      </p>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          if (query) setQuery("");
                          else if (isShelf) switchView("discover");
                          else setOffset((n) => n + 1);
                        }}
                      >
                        {query
                          ? "Clear filter"
                          : isShelf
                            ? "Go digging"
                            : "Dig again"}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  {view === "discover" &&
                    !listen &&
                    !busy &&
                    visible.length > 0 && (
                      <div className="more-finds">
                        <span>There’s always another good record.</span>
                        <button
                          className="secondary-button"
                          onClick={() => setOffset((n) => n + 1)}
                        >
                          <RefreshCw size={15} />
                          Dig a little deeper
                        </button>
                      </div>
                    )}
                </section>
              </div>
            )}
          </main>
        </div>
        {drawer && (
          <DetailPanel
            item={drawer}
            status={state.shelves[drawer.id]?.status}
            ai={state.settings.ai}
            demo={demo}
            onClose={() => setDrawer(null)}
            onPlay={() => void play(drawer)}
            playingTrackId={
              current?.id === drawer.id ? current.albumTrackId : undefined
            }
            playing={playing}
            onAlbumTrack={(track) =>
              void play({
                ...drawer,
                preview: track.preview,
                previewTitle: track.title,
                previewSource: track.previewSource,
                trackUrl: track.trackUrl || undefined,
                albumTrackId: track.id,
                loadingPreview: false,
              })
            }
            onShelf={(s) =>
              s ? void shelve(drawer, s) : void removeSaved(drawer)
            }
            onExplain={async () => {
              if (demo) return drawer.reason;
              return await window.crate!.explain(drawer);
            }}
            onError={notify}
            countBusy={countBusyId === drawer.id}
            onCountRetry={() => setCountAttempt((value) => value + 1)}
          />
        )}
        {youtubeItem && (
          <YoutubePreview
            key={youtubeItem.id}
            item={youtubeItem}
            hasKey={!!state.settings.hasYoutubeKey && !demo}
            onClose={() => setYoutubeItem(null)}
            onSettings={() => {
              setYoutubeItem(null);
              openSettings("youtube");
            }}
          />
        )}
        {soundcloudItem && (
          <SoundCloudPreview
            key={soundcloudItem.id}
            item={soundcloudItem}
            configured={!!state.settings.hasSoundcloudCredentials && !demo}
            onClose={() => setSoundcloudItem(null)}
            onSettings={() => {
              setSoundcloudItem(null);
              openSettings("soundcloud");
            }}
            onAttach={(source) => {
              const updated = { ...soundcloudItem, soundcloud: source };
              setItems((list) =>
                list.map((item) => (item.id === updated.id ? updated : item)),
              );
              setDrawer((item) => (item?.id === updated.id ? updated : item));
              const entry = shelvesRef.current[updated.id];
              if (entry)
                void writeShelf(updated, entry.status).catch((error) =>
                  notify(String(error)),
                );
            }}
          />
        )}
        {current && (
          <footer className="player preview-player">
            {music.suspended && (
              <button className="return-local" onClick={music.toggle}>
                Return to your music <ArrowRight size={14} />
              </button>
            )}
            <div className="now-playing">
              {current ? (
                <>
                  <button
                    className="player-cover"
                    onClick={() => setDrawer(current)}
                    aria-label="Open playing record"
                  >
                    <Art item={current} />
                  </button>
                  <div>
                    <button
                      className="playing-title"
                      onClick={() => setDrawer(current)}
                    >
                      {current.previewTitle || current.title}
                    </button>
                    <span>
                      {current.artist}
                      <span className="player-album">
                        {" "}
                        · {current.album || current.title}
                      </span>
                    </span>
                  </div>
                  <button
                    className={`icon-button player-heart ${state.shelves[current.id]?.status === "wishlist" ? "saved" : ""}`}
                    title="Save to Wishlist · K"
                    aria-label={
                      state.shelves[current.id]?.status === "wishlist"
                        ? "Remove playing record from Wishlist"
                        : "Save playing record"
                    }
                    onClick={() =>
                      state.shelves[current.id]?.status === "wishlist"
                        ? void removeSaved(current)
                        : void shelve(current, "wishlist")
                    }
                  >
                    <Heart
                      size={17}
                      fill={
                        state.shelves[current.id]?.status === "wishlist"
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                </>
              ) : (
                <>
                  <div className="player-placeholder">
                    <Disc3 size={27} strokeWidth={1} />
                  </div>
                  <div>
                    <strong>A little curiosity sounds good.</strong>
                    <span>Pick a record to hear a preview.</span>
                  </div>
                </>
              )}
            </div>
            <div className="player-center">
              <div className="transport">
                <button
                  className="icon-button shuffle-player"
                  title="Surprise me · S"
                  aria-label="Surprise me"
                  onClick={surprise}
                >
                  <Shuffle size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Previous · ←"
                  aria-label="Previous preview"
                  onClick={() => navigate(-1)}
                  disabled={!visible.length}
                >
                  <SkipBack size={17} fill="currentColor" />
                </button>
                <button
                  className="main-play"
                  aria-label={playing ? "Pause preview" : "Play preview"}
                  title="Play / pause · Space"
                  disabled={!current && !chosen}
                  onClick={() => {
                    if (current) void play(current);
                    else if (chosen) void play(chosen);
                  }}
                >
                  {buffering ? (
                    <Loader2 size={19} className="spin" />
                  ) : playing ? (
                    <Pause size={18} fill="currentColor" />
                  ) : (
                    <Play size={18} fill="currentColor" />
                  )}
                </button>
                <button
                  className="icon-button"
                  title="Next · →"
                  aria-label="Next preview"
                  onClick={() => navigate(1)}
                  disabled={!visible.length}
                >
                  <SkipForward size={17} fill="currentColor" />
                </button>
              </div>
              <div className="player-timeline">
                <span>{seconds(time)}</span>
                <input
                  type="range"
                  aria-label="Preview position"
                  min="0"
                  max={duration || 30}
                  step="0.1"
                  value={time}
                  onChange={(e) => {
                    if (audio.current) {
                      audio.current.currentTime = Number(e.target.value);
                      setTime(Number(e.target.value));
                    }
                  }}
                  style={
                    {
                      "--progress": `${(time / (duration || 30)) * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <span>{seconds(duration || 30)}</span>
              </div>
            </div>
            <div className="player-right">
              <span className="preview-source">
                {current?.storeUrl ? (
                  <button onClick={() => openExternal(current.storeUrl!)}>
                    Preview on{" "}
                    {current.previewSource === "deezer"
                      ? "Deezer"
                      : "Apple Music"}{" "}
                    <ExternalLink size={11} />
                  </button>
                ) : (
                  <>
                    <Headphones size={13} />
                    Just a taste. All you.
                  </>
                )}
              </span>
              <button
                className="icon-button"
                aria-label={volume ? "Mute" : "Unmute"}
                onClick={() => setVolume(volume ? 0 : 0.65)}
              >
                {volume ? <Volume2 size={17} /> : <VolumeX size={17} />}
              </button>
              <input
                className="volume-slider"
                type="range"
                min="0"
                max="1"
                step=".01"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
              />
            </div>
          </footer>
        )}
        <LocalPlayer
          music={music}
          mini={mini}
          onMini={() => {
            if (window.crate)
              void window.crate
                .miniPlayer(!mini)
                .then(setMini)
                .catch((e) => notify(String(e)));
          }}
          hidden={!!current}
          onFavorite={async (track) => {
            if (!window.crate || demo) return;
            await window.crate.libraryEdit([track.id], {
              favorite: !track.favorite,
            });
            music.patchTracks([track.id], { favorite: !track.favorite });
            window.dispatchEvent(new Event("crate-library-changed"));
          }}
        />
        {music.queueOpen && !tasksOpen && (
          <QueuePanel
            music={music}
            onSave={(tracks) => {
              switchView("library");
              setTimeout(
                () =>
                  window.dispatchEvent(
                    new CustomEvent("crate-new-playlist", { detail: tracks }),
                  ),
                100,
              );
            }}
          />
        )}
        {tasksOpen && (
          <Tasks
            state={state}
            onClose={() => setTasksOpen(false)}
            onImport={() => {
              setTasksOpen(false);
              switchView("imports");
            }}
            onSend={(job) => {
              setTasksOpen(false);
              sendExternalToImport(job);
            }}
            onUsage={() => {
              setTasksOpen(false);
              openSettings("ai-usage");
            }}
            onClear={async (id) => {
              const jobs = await window.crate?.externalClear(id);
              if (jobs) setState((s) => ({ ...s, externalJobs: jobs }));
            }}
          />
        )}
        <audio
          data-testid="preview-audio"
          ref={audio}
          preload="auto"
          onPlay={() => {
            setYoutubeItem(null);
            setSoundcloudItem(null);
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
          onTimeUpdate={() => setTime(audio.current?.currentTime || 0)}
          onDurationChange={() => {
            const d = audio.current?.duration;
            if (d && Number.isFinite(d)) setDuration(d);
          }}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onEnded={() => {
            setPlaying(false);
            if (listen) navigate(1);
          }}
          onError={() => {
            setPlaying(false);
            setBuffering(false);
            notify("The preview is unavailable right now. Try another find.");
          }}
        />
        {nextItem?.preview && nextItem.id !== current?.id && (
          <audio
            key={nextItem.id}
            src={nextItem.preview}
            preload="auto"
            aria-hidden="true"
          />
        )}
        {toast && (
          <div className="toast" role="status">
            <span className="toast-icon">
              <Check size={14} />
            </span>
            <span>{toast.text}</span>
            {toast.undo && <button onClick={toast.undo}>Undo</button>}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </ChromeContext.Provider>
  );
}

function openExternal(url: string) {
  if (window.crate) void window.crate.external(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

function DetailPanel({
  item,
  status,
  ai,
  demo,
  onClose,
  onPlay,
  onShelf,
  onExplain,
  onError,
  countBusy,
  onCountRetry,
  onAlbumTrack,
  playingTrackId,
  playing,
}: {
  item: Item;
  status?: Shelf;
  ai: string;
  demo: boolean;
  onClose: () => void;
  onPlay: () => void;
  onShelf: (s: Shelf | null) => void;
  onExplain: () => Promise<string>;
  onError: (s: string) => void;
  countBusy: boolean;
  onCountRetry: () => void;
  onAlbumTrack: (track: import("./types").AlbumTrack) => void;
  playingTrackId?: string;
  playing: boolean;
}) {
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setExplanation(""), [item.id]);
  return (
    <aside className="detail-panel" aria-label="Record details">
      <div className="detail-top">
        <span>Record details</span>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="detail-scroll">
        <Art item={item} />
        <div className="detail-meta">
          <span className="genre-tag">{item.genre}</span>
          <span>{item.year}</span>
          <TrackCount item={item} busy={countBusy} />
        </div>
        <h2>{item.title}</h2>
        <h3>
          {item.kind === "artist" ? `Featuring ${item.album}` : item.artist}
        </h3>
        {item.kind === "album" && (
          <div className="detail-track-count">
            <p>
              {item.trackCount
                ? [item.trackCountSource, item.trackCountEdition]
                    .filter(Boolean)
                    .join(" · ") + " · Matched edition"
                : "Track count unavailable"}
            </p>
            {!item.trackCount && (
              <button
                className="text-button"
                disabled={countBusy}
                onClick={onCountRetry}
              >
                Retry track count
              </button>
            )}
          </div>
        )}
        <button className="primary-button detail-preview" onClick={onPlay}>
          <Play size={16} fill="currentColor" />
          {item.preview
            ? "Play preview"
            : item.soundcloud
              ? "Play on SoundCloud"
              : "Find on YouTube"}
        </button>
        <div className="detail-actions">
          {(["wishlist", "rejected"] as Shelf[]).map((s) => (
            <button
              key={s}
              className={status === s ? "active" : ""}
              onClick={() => onShelf(status === s ? null : s)}
            >
              {s === "wishlist" ? <Heart size={16} /> : <X size={16} />}
              <span>
                {s === "wishlist"
                  ? status === s
                    ? "Remove from Wishlist"
                    : "Save"
                  : status === s
                    ? "Restore"
                    : "Less like this"}
              </span>
            </button>
          ))}
        </div>
        {item.kind === "album" && (
          <AlbumTracks
            item={item}
            currentId={playingTrackId}
            playing={playing}
            onPlay={onAlbumTrack}
          />
        )}
        <MusicLinks item={item} />
        {item.origin === "ai" &&
          !item.loadingPreview &&
          !item.catalogVerified && (
            <p className="unverified-note">
              Unverified AI suggestion. You can still save it.
            </p>
          )}
        <section className="why-panel">
          <h4>
            <Sparkles size={15} />
            Why this record?
          </h4>
          <p>{explanation || item.reason}</p>
          {ai !== "none" && !demo && item.origin !== "ai" && (
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setExplanation(await onExplain());
                } catch (e) {
                  onError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <Loader2 className="spin" size={13} />
              ) : (
                <WandSparkles size={13} />
              )}
              Ask your AI for more context
            </button>
          )}
        </section>
        {item.seeds.length > 0 && (
          <h4 className="detail-label">From your collection</h4>
        )}
        <div className="seed-artists">
          {item.seeds.map((artist, i) => (
            <div key={artist}>
              <span style={{ background: colors[i % colors.length] }}>
                {artist
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{artist}</strong>
                <small>In your collection</small>
              </div>
              <AudioLines size={15} />
            </div>
          ))}
        </div>
        {item.kind !== "album" && (
          <>
            <h4 className="detail-label">Preview</h4>
            {item.preview ? (
              <button className="detail-track" onClick={onPlay}>
                <Play size={15} />
                <span>
                  {item.previewTitle || item.title}
                  <small>{item.artist}</small>
                </span>
                <span>Preview</span>
              </button>
            ) : (
              <p className="muted small">
                No clip available. Save it or try YouTube.
              </p>
            )}
          </>
        )}
        <p className="preview-credit">
          {item.previewSource === "deezer"
            ? "Preview provided by Deezer."
            : "Previews and artwork from Apple’s iTunes catalog or MusicBrainz."}{" "}
          Clips vary by region.
        </p>
        {item.storeUrl && (
          <button
            className="catalog-link"
            onClick={() => openExternal(item.storeUrl!)}
          >
            View on {item.previewSource === "deezer" ? "Deezer" : "Apple Music"}
            <ExternalLink size={13} />
          </button>
        )}
        {item.catalogUrl && (
          <button
            className="catalog-link"
            onClick={() => openExternal(item.catalogUrl!)}
          >
            Album details on MusicBrainz
            <ExternalLink size={13} />
          </button>
        )}
      </div>
    </aside>
  );
}

function TasteView({
  state,
  scope,
  profile: p,
  onGenre,
  onDiscover,
  onExplain,
  onError,
}: {
  state: State;
  scope: string;
  profile: State["profile"];
  onGenre: (s: string) => void;
  onDiscover: () => void;
  onExplain: () => Promise<string>;
  onError: (s: string) => void;
}) {
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const allGenres = [
    ...new Set([
      ...state.history.flatMap((h) => h.genres.map((g) => g.name)),
      ...state.profile.genres.map((g) => g.name),
    ]),
  ].sort();
  const genreColor = (name: string) =>
    colors[Math.max(0, allGenres.indexOf(name)) % colors.length];
  let total = 0;
  const segments = p.genres.map((g, i) => {
    const start = total;
    total += (g.count / Math.max(1, p.total)) * 100;
    return `${genreColor(g.name)} ${start}% ${total}%`;
  });
  return (
    <div className="content-wrap taste-page">
      <div className="page-title-row">
        <div>
          <h1>Your taste</h1>
          <p>A snapshot of your collection.</p>
        </div>
        <button className="secondary-button" onClick={onDiscover}>
          Find something new
          <ArrowRight size={15} />
        </button>
      </div>
      <div className="taste-insight">
        <Sparkles size={17} />
        <p>
          {summary ||
            (p.total
              ? `Your collection leans into ${p.genres
                  .slice(0, 2)
                  .map((g) => g.name.toLowerCase())
                  .join(
                    " and ",
                  )}${p.eras[0]?.name !== "Unknown" ? `, with a soft spot for the ${p.eras[0]?.name}` : ""}.`
              : "Your collection will tell its story here.")}
        </p>
        {state.settings.ai !== "none" && (
          <button
            className="text-button"
            disabled={summarizing}
            onClick={async () => {
              setSummarizing(true);
              try {
                setSummary(await onExplain());
              } catch (e) {
                onError(String(e));
              } finally {
                setSummarizing(false);
              }
            }}
          >
            {summarizing ? (
              <Loader2 className="spin" size={13} />
            ) : (
              <WandSparkles size={13} />
            )}
            Explain my taste
          </button>
        )}
      </div>
      <div className="taste-stats">
        <div>
          <Library size={19} />
          <strong>{compact(p.total)}</strong>
          <span>tracks</span>
        </div>
        <div>
          <Disc3 size={19} />
          <strong>{compact(p.albums)}</strong>
          <span>albums</span>
        </div>
        <div>
          <AudioLines size={19} />
          <strong>{compact(p.artists.length)}</strong>
          <span>artists</span>
        </div>
        <div>
          <Tag size={19} />
          <strong>{p.genres.length}</strong>
          <span>genres</span>
        </div>
      </div>
      <div className="taste-grid">
        <section className="taste-panel genre-panel">
          <div className="panel-heading">
            <h2>Your sonic fingerprint</h2>
            <span>{scope}</span>
          </div>
          {p.total ? (
            <>
              <div className="genre-chart-wrap">
                <div
                  className="genre-chart"
                  style={{
                    background: `conic-gradient(${segments.join(",")})`,
                  }}
                >
                  <div>
                    <AudioLines size={24} />
                    <strong>{p.genres.length}</strong>
                    <span>shades of you</span>
                  </div>
                </div>
              </div>
              <div className="genre-legend">
                {p.genres.slice(0, 10).map((g, i) => (
                  <button key={g.name} onClick={() => onGenre(g.name)}>
                    <span
                      className="genre-dot"
                      style={{ background: genreColor(g.name) }}
                    />
                    <span>{g.name}</span>
                    <strong>{Math.round((g.count / p.total) * 100)}%</strong>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
              <p className="chart-hint">
                Pick a genre to follow it somewhere new.
                <br />
                Based on file tags; multi-genre tracks share their weight.
              </p>
            </>
          ) : (
            <p className="muted">
              Add a music folder to see your taste take shape.
            </p>
          )}
        </section>
        <section className="taste-panel top-artists">
          <div className="panel-heading">
            <h2>Top artists</h2>
            <span>Top artists</span>
          </div>
          {p.artists.slice(0, 8).map((a, i) => (
            <div className="artist-row" key={a.name}>
              <span className="artist-rank">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="artist-avatar"
                style={{
                  background: `${colors[i % colors.length]}25`,
                  color: colors[i % colors.length],
                }}
              >
                {a.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div className="artist-meter">
                <strong>{a.name}</strong>
                <div>
                  <span
                    style={{
                      width: `${(a.count / (p.artists[0]?.count || 1)) * 100}%`,
                      background: colors[i % colors.length],
                    }}
                  />
                </div>
              </div>
              <span className="artist-tracks">{a.count} tracks</span>
            </div>
          ))}
        </section>
        <section className="taste-panel era-panel">
          <div className="panel-heading">
            <h2>Decades</h2>
            <span>Your collection, through time</span>
          </div>
          <div className="era-chart">
            {[...p.eras]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((e) => (
                <div key={e.name}>
                  <span>
                    {Math.round((e.count / Math.max(1, p.total)) * 100)}%
                  </span>
                  <div>
                    <i
                      style={{
                        height: `${(e.count / Math.max(...p.eras.map((x) => x.count), 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <strong>{e.name}</strong>
                </div>
              ))}
          </div>
        </section>
        <section className="taste-panel drift-panel">
          <div className="panel-heading">
            <h2>Collection over time</h2>
            <span>Taste drift</span>
          </div>
          {state.history.length > 1 ? (
            <div className="drift-chart">
              {state.history.map((h) => (
                <div key={h.day}>
                  <div className="drift-stack">
                    {h.genres.slice(0, 6).map((g, i) => (
                      <span
                        key={g.name}
                        title={`${g.name}: ${Math.round((g.count / h.total) * 100)}%`}
                        style={{
                          height: `${(g.count / h.total) * 100}%`,
                          background: genreColor(g.name),
                        }}
                      />
                    ))}
                  </div>
                  <small>{h.day.slice(5)}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="drift-empty">
              <AudioLines size={31} strokeWidth={1} />
              <h3>Good taste keeps growing.</h3>
              <p>
                As your collection changes, your genre mix will appear here. A
                daily snapshot, quietly kept on your machine.
              </p>
              <span>
                {state.history.length
                  ? "Your first snapshot is saved."
                  : "Your collection is the starting point."}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SettingsView({
  initialSection,
  state,
  demo,
  onSave,
  onAdd,
  onRemove,
  onRescan,
  onFeedback,
}: {
  initialSection: string;
  state: State;
  demo: boolean;
  onSave: (v: SettingsUpdate) => Promise<boolean>;
  onAdd: () => Promise<void>;
  onRemove: (root: string) => Promise<void>;
  onRescan: () => void;
  onFeedback: () => void;
}) {
  const [section, setSection] = useState(initialSection);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [draft, setDraft] = useState(state.settings);
  const [key, setKey] = useState("");
  const [youtubeKey, setYoutubeKey] = useState<string | undefined>(undefined);
  const [soundcloudCredentials, setSoundcloudCredentials] =
    useState<SettingsUpdate["soundcloudCredentials"]>(undefined);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [connection, setConnection] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (!dirty) setDraft(state.settings);
  }, [state.settings]);
  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);
  useEffect(() => {
    const guard = (event: Event) => {
      if (!dirty) return;
      event.preventDefault();
      setLeave(() => (event as CustomEvent<() => void>).detail);
    };
    window.addEventListener("crate-before-navigate", guard);
    return () => window.removeEventListener("crate-before-navigate", guard);
  }, [dirty]);
  async function saveConnection() {
    setSaving(true);
    try {
      const result = await onSave({
        ai: draft.ai,
        aiModel: draft.aiModel,
        aiEndpoint: draft.aiEndpoint,
        externalCommand: draft.externalCommand,
        externalCwdMode: draft.externalCwdMode,
        externalCwd: draft.externalCwd,
        externalAutoOpenImport: draft.externalAutoOpenImport,
        ...(key ? { aiKey: key } : {}),
        ...(youtubeKey !== undefined ? { youtubeKey } : {}),
        ...(soundcloudCredentials !== undefined
          ? { soundcloudCredentials }
          : {}),
      });
      if (result) {
        setDirty(false);
        setKey("");
        setYoutubeKey(undefined);
        setSoundcloudCredentials(undefined);
      }
      return result;
    } finally {
      setSaving(false);
    }
  }
  const change = (value: Partial<Settings>) => {
    setDraft((s) => ({ ...s, ...value }));
    if (
      Object.keys(value).every((key) =>
        ["autoScan", "watchLibrary", "mode"].includes(key),
      )
    )
      void onSave(value);
    else setDirty(true);
    setConnection(null);
    if (value.ai !== undefined) setModels([]);
  };
  return (
    <div className="content-wrap settings-page">
      <h1 className="sr-only">Settings</h1>
      <Toolbar>
        <input
          className="settings-search"
          type="search"
          aria-label="Find a setting"
          placeholder="Find a setting"
          value={settingsQuery}
          onChange={(e) => {
            const q = e.target.value.toLowerCase();
            setSettingsQuery(e.target.value);
            const matches = [
              ["theme palette color appearance", "preferences"],
              ["music folder scan watch library", "library"],
              ["resume playback player", "playback"],
              ["feedback hidden distance discovery", "discovery"],
              ["ai gemini openai ollama model usage", "ai"],
              ["youtube", "youtube"],
              ["soundcloud", "soundcloud"],
              ["external command tool", "external"],
              ["update version privacy", "app"],
            ];
            if (q.length > 1) {
              const match = matches.find(([terms]) =>
                terms.split(" ").some((term) => term.includes(q)),
              );
              if (match) setSection(match[1]);
            }
          }}
        />
      </Toolbar>
      <nav className="settings-tabs" aria-label="Settings categories">
        {[
          ["preferences", "General"],
          ["library", "Library"],
          ["playback", "Playback"],
          ["discovery", "Discovery"],
          ["connections", "Connections"],
          ["app", "About & updates"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={
              section === id ||
              (id === "connections" &&
                [
                  "ai",
                  "ai-usage",
                  "youtube",
                  "soundcloud",
                  "external",
                ].includes(section))
            }
            aria-controls={`settings-${id}`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div
        id="settings-library"
        className="settings-panel"
        hidden={section !== "library"}
      >
        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>Music folders</h2>
              <p>Scan on demand. Your files stay unchanged.</p>
            </div>
            <button className="secondary-button" onClick={() => void onAdd()}>
              <Plus size={15} />
              Add folder
            </button>
          </div>
          <div className="folder-list">
            {state.folders.length ? (
              state.folders.map((f) => (
                <div className="folder-row" key={f}>
                  <span className="folder-icon">
                    <Folder size={22} />
                  </span>
                  <div>
                    <strong>{nameOf(f)}</strong>
                    <span title={f}>{f}</span>
                  </div>
                  <span className="folder-state">
                    <Check size={12} />
                    {demo ? "Sample" : "Read-only"}
                  </span>
                  <button
                    className="icon-button"
                    title="Remove from index only"
                    aria-label={`Remove ${nameOf(f)} from library index`}
                    disabled={state.progress?.running}
                    onClick={() => void onRemove(f)}
                  >
                    <Minus size={17} />
                  </button>
                </div>
              ))
            ) : (
              <div className="settings-empty">
                <FolderOpen size={22} />
                <span>A good place to start: your music folder.</span>
              </div>
            )}
          </div>
          <div className="settings-inline">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.autoScan}
                onChange={(e) => change({ autoScan: e.target.checked })}
              />
              Scan when the app opens
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.watchLibrary || false}
                onChange={(e) => change({ watchLibrary: e.target.checked })}
              />
              Watch for new music (at most every 15 minutes)
            </label>
            <button
              className="text-button"
              disabled={state.progress?.running}
              onClick={onRescan}
            >
              <RefreshCw
                size={13}
                className={state.progress?.running ? "spin" : ""}
              />
              {state.progress?.running ? "Scanning…" : "Rescan now"}
            </button>
          </div>
          {state.lastScan && (
            <p className="settings-footnote">
              Last scan: {new Date(state.lastScan).toLocaleString()}{" "}
              {state.progress?.errors
                ? `· ${state.progress.errors} files or folders needed a fallback or could not be read.`
                : ""}
            </p>
          )}
        </section>
        <LibraryTools state={state} demo={demo} />
      </div>
      <div
        id="settings-preferences"
        className="settings-panel"
        hidden={section !== "preferences"}
      >
        <AppearanceSettings settings={state.settings} onSave={onSave} />
        <label className="setting-row">
          <span>
            <strong>Collection density</strong>
            <small>Use a tighter grid and shorter track rows.</small>
          </span>
          <select
            aria-label="Collection density"
            value={state.settings.density || "comfortable"}
            onChange={(e) =>
              void onSave({ density: e.target.value as Settings["density"] })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="setting-row">
          <span>
            <strong>Open on startup</strong>
          </span>
          <select
            aria-label="Open on startup"
            value={state.settings.startupView || "last"}
            onChange={(e) =>
              void onSave({
                startupView: e.target.value as Settings["startupView"],
              })
            }
          >
            <option value="last">Last page</option>
            <option value="library">Library</option>
            <option value="discover">Discover</option>
          </select>
        </label>
      </div>
      <div
        id="settings-playback"
        className="settings-panel"
        hidden={section !== "playback"}
      >
        <PlaybackPreferences
          settings={state.settings}
          demo={demo}
          onSave={onSave}
        />
      </div>
      <div
        id="settings-discovery"
        className="settings-panel"
        hidden={section !== "discovery"}
      >
        <section className="settings-section">
          <h2>Discovery</h2>
          <label className="setting-row">
            <span>
              <strong>Default exploration distance</strong>
              <small>How far to explore from your collection.</small>
            </span>
            <select
              value={draft.mode}
              onChange={(e) => change({ mode: e.target.value as Mode })}
            >
              <option value="safe">Familiar</option>
              <option value="adjacent">Explore</option>
              <option value="wildcard">Adventurous</option>
            </select>
          </label>
          <div className="setting-row">
            <div>
              <strong>Hidden records</strong>
              <span>Review releases you marked Less like this.</span>
            </div>
            <button className="secondary-button" onClick={onFeedback}>
              Review hidden records <ArrowRight size={14} />
            </button>
          </div>
        </section>
      </div>
      <div
        id="settings-connections"
        className="settings-panel"
        hidden={section !== "connections"}
      >
        <section className="settings-section">
          <h2>Connections</h2>
          <p>Choose the services you use.</p>
          {(
            [
              [
                "ai",
                "AI discovery",
                state.settings.ai === "none"
                  ? "Not connected"
                  : state.settings.ai === "ollama"
                    ? "Local Ollama"
                    : state.settings.ai === "gemini"
                      ? "Google Gemini"
                      : "OpenAI",
              ],
              [
                "youtube",
                "YouTube",
                state.settings.hasYoutubeKey
                  ? "Configured"
                  : "Browser search available",
              ],
              [
                "soundcloud",
                "SoundCloud",
                state.settings.hasSoundcloudCredentials
                  ? "Connected"
                  : "Not connected",
              ],
              [
                "external",
                "External tools",
                state.settings.externalCommand
                  ? "One tool configured"
                  : "Not configured",
              ],
            ] as string[][]
          ).map(([id, label, status]) => (
            <div className="setting-row" key={id}>
              <div>
                <strong>{label}</strong>
                <span>{status}</span>
              </div>
              <button
                className="secondary-button"
                onClick={() => setSection(id)}
              >
                Manage <ArrowRight size={14} />
              </button>
            </div>
          ))}
        </section>
      </div>
      {["ai", "ai-usage", "youtube", "soundcloud", "external"].includes(
        section,
      ) && (
        <div className="connection-back">
          <button
            className="text-button"
            onClick={() => setSection("connections")}
          >
            <ArrowLeft size={14} />
            All connections
          </button>
          {["ai", "ai-usage"].includes(section) && (
            <button
              className="text-button"
              onClick={() => setSection(section === "ai" ? "ai-usage" : "ai")}
            >
              {section === "ai" ? "Usage and history" : "Connection settings"}
            </button>
          )}
        </div>
      )}
      <div
        id="settings-ai-usage"
        className="settings-panel"
        hidden={section !== "ai-usage"}
      >
        <AiActivity activity={state.aiActivity} />
      </div>
      <div
        id="settings-ai"
        className="settings-panel"
        hidden={section !== "ai"}
      >
        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>
                AI discovery <span className="optional-badge">OPTIONAL</span>
              </h2>
              <p>
                Use AI to choose records from your collection, explain
                connections, and summarize your taste.
              </p>
            </div>
            <Sparkles size={20} />
          </div>
          <div className="setting-row">
            <div>
              <strong>AI provider</strong>
              <span>
                {draft.ai === "none"
                  ? "Simple explanations, drawn from your library."
                  : draft.ai === "ollama"
                    ? "Runs on your machine through Ollama."
                    : `Sends selected album/folder metadata or explanation context to ${draft.ai === "gemini" ? "Google Gemini" : "OpenAI"} only when you ask.`}
              </span>
            </div>
            <select
              value={draft.ai}
              disabled={testing}
              aria-label="AI provider"
              onChange={(e) => {
                setKey("");
                change({
                  ai: e.target.value as Settings["ai"],
                  aiModel:
                    e.target.value === "gemini"
                      ? "gemini-3.8-flash"
                      : e.target.value === "openai"
                        ? "gpt-4.1-mini"
                        : "llama3.2",
                });
              }}
            >
              <option value="none">No AI needed</option>
              <option value="ollama">Local · Ollama</option>
              <option value="openai">API key · OpenAI</option>
              <option value="gemini">API key · Google Gemini</option>
            </select>
          </div>
          {draft.ai !== "none" && (
            <div className="ai-fields">
              <label>
                Model
                {draft.ai === "gemini" && models.length > 0 ? (
                  <select
                    aria-label="Model"
                    value={draft.aiModel}
                    onChange={(e) => change({ aiModel: e.target.value })}
                  >
                    {!models.includes(draft.aiModel) && (
                      <option value={draft.aiModel}>
                        {draft.aiModel} · unavailable
                      </option>
                    )}
                    {models.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    disabled={testing}
                    value={draft.aiModel}
                    onChange={(e) => change({ aiModel: e.target.value })}
                    placeholder={
                      draft.ai === "gemini"
                        ? "gemini-3.8-flash"
                        : draft.ai === "ollama"
                          ? "llama3.2"
                          : "gpt-4.1-mini"
                    }
                  />
                )}
              </label>
              {draft.ai === "ollama" ? (
                <label>
                  Local address
                  <input
                    value={draft.aiEndpoint}
                    onChange={(e) => change({ aiEndpoint: e.target.value })}
                    placeholder="http://127.0.0.1:11434"
                  />
                </label>
              ) : (
                <label>
                  API key
                  <input
                    type="password"
                    autoComplete="off"
                    disabled={demo || testing}
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setDirty(true);
                      setConnection(null);
                      setModels([]);
                    }}
                    placeholder={
                      (draft.ai === "gemini" || draft.ai === "openai") &&
                      (state.settings.hasAiKeys?.[draft.ai] ??
                        (draft.ai === state.settings.ai &&
                          state.settings.hasAiKey))
                        ? "Key saved securely · leave blank to keep"
                        : "Paste your API key"
                    }
                  />
                </label>
              )}
              <p className="settings-footnote">
                {draft.ai === "ollama"
                  ? "Install and run your chosen model in Ollama first."
                  : "Your key is encrypted with Windows credential storage. API usage may incur charges from your provider."}
              </p>
              {draft.ai === "gemini" && (
                <div className="ai-connection">
                  <button
                    className="secondary-button"
                    disabled={demo || testing}
                    onClick={async () => {
                      setTesting(true);
                      setConnection(null);
                      try {
                        if (!window.crate)
                          throw new Error(
                            "Open the desktop app to check your connection.",
                          );
                        const result = await window.crate.testAi({
                          provider: "gemini",
                          model: draft.aiModel,
                          key,
                        });
                        setModels(result.models);
                        setConnection({
                          ok: true,
                          text: !result.models.length
                            ? "The key connected, but no supported text models are available to this project."
                            : result.selectedModelAvailable
                              ? "Connected. This model is available. Save preferences to use it. This check does not test generation quota."
                              : "Connected, but this model is unavailable. Choose a model from the list above, then save preferences.",
                        });
                      } catch (error) {
                        setConnection({ ok: false, text: userMessage(error) });
                      } finally {
                        setTesting(false);
                      }
                    }}
                  >
                    {testing ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}{" "}
                    {testing ? "Checking…" : "Check connection"}
                  </button>
                  <span className="settings-footnote">
                    Lists models using your entered key, or your saved Google
                    key. No music data is sent.
                  </span>
                  {connection && (
                    <p
                      className={`connection-result ${connection.ok ? "success" : "error"}`}
                      role="status"
                    >
                      {connection.text}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      <div
        id="settings-youtube"
        className="settings-panel"
        hidden={section !== "youtube"}
      >
        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>
                YouTube previews{" "}
                <span className="optional-badge">OPTIONAL</span>
              </h2>
              <p>
                Find a video when a catalog clip is missing. Searches only run
                when you ask.
              </p>
            </div>
            <Youtube size={20} />
          </div>
          <div className="ai-fields">
            <label>
              YouTube Data API key
              <input
                type="password"
                autoComplete="off"
                disabled={demo}
                value={youtubeKey || ""}
                onChange={(event) => {
                  setYoutubeKey(event.target.value || undefined);
                  setDirty(true);
                }}
                placeholder={
                  state.settings.hasYoutubeKey
                    ? "Key saved securely · leave blank to keep"
                    : "Paste a YouTube Data API v3 key"
                }
              />
            </label>
            <p className="settings-footnote">
              Enable YouTube Data API v3 in your Google Cloud project. This key
              is separate from your AI key and encrypted with Windows credential
              storage. Search quotas apply. Browser search and pasted video
              links work without a key.
            </p>
            {state.settings.hasYoutubeKey && (
              <button
                className="text-button"
                onClick={() => {
                  setYoutubeKey("");
                  setDirty(true);
                }}
              >
                {youtubeKey === ""
                  ? "Key will be removed when you save"
                  : "Remove saved YouTube key"}
              </button>
            )}
          </div>
        </section>
      </div>
      <div
        id="settings-soundcloud"
        className="settings-panel"
        hidden={section !== "soundcloud"}
      >
        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>
                SoundCloud <span className="optional-badge">OPTIONAL</span>
              </h2>
              <p>
                Listen to niche tracks and EPs, including uploads outside the
                album catalogs.
              </p>
            </div>
            <Cloud size={20} />
          </div>
          <p className="settings-footnote">
            Browser search and pasted links work without credentials. Register a
            SoundCloud app for in-app search and optional SoundCloud discoveries
            in Personal picks. Your client ID, secret, and tokens are encrypted
            on this device and never sent to your AI provider.
          </p>
          <div className="ai-fields">
            <label>
              SoundCloud client ID
              <input
                autoComplete="off"
                type="password"
                disabled={demo}
                value={soundcloudCredentials?.clientId || ""}
                placeholder={
                  state.settings.hasSoundcloudCredentials
                    ? "Credentials saved securely · leave blank to keep"
                    : "Paste your app client ID"
                }
                onChange={(event) => {
                  setSoundcloudCredentials({
                    clientId: event.target.value,
                    clientSecret: soundcloudCredentials?.clientSecret || "",
                  });
                  setDirty(true);
                }}
              />
            </label>
            <label>
              SoundCloud client secret
              <input
                autoComplete="off"
                type="password"
                disabled={demo}
                value={soundcloudCredentials?.clientSecret || ""}
                placeholder={
                  state.settings.hasSoundcloudCredentials
                    ? "Secret saved securely · leave blank to keep"
                    : "Paste your app client secret"
                }
                onChange={(event) => {
                  setSoundcloudCredentials({
                    clientId: soundcloudCredentials?.clientId || "",
                    clientSecret: event.target.value,
                  });
                  setDirty(true);
                }}
              />
            </label>
            <p className="settings-footnote">
              Enter both fields when replacing credentials. Only public search
              and playback are used; this does not connect to your personal
              SoundCloud account. SoundCloud controls API access and rate
              limits.
            </p>
            {state.settings.hasSoundcloudCredentials && (
              <button
                className="text-button"
                onClick={() => {
                  setSoundcloudCredentials(null);
                  setDirty(true);
                }}
              >
                {soundcloudCredentials === null
                  ? "Credentials will be removed when you save"
                  : "Remove saved SoundCloud credentials"}
              </button>
            )}
          </div>
        </section>
      </div>
      <div
        id="settings-external"
        className="settings-panel"
        hidden={section !== "external"}
      >
        <ExternalProgramSettings draft={draft} change={change} />
      </div>
      <div
        id="settings-app"
        className="settings-panel"
        hidden={section !== "app"}
      >
        <UpdateSettings />
        <div className="about-app">
          <Mark />
          <div>
            <strong>Crate Digger</strong>
            <p>Local music discovery. No account required.</p>
            <p>
              Catalog: MusicBrainz · Clips: Apple iTunes and Deezer · Optional
              players: YouTube and SoundCloud. Artist, album, and genre lookups
              leave your device; music files never do. Amazon link lookup uses
              public sharing-page metadata. ZIP imports tag newly extracted
              copies only.
            </p>
          </div>
        </div>
      </div>
      {dirty && (
        <div className="connection-save">
          <span>Unsaved connection changes</span>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => void saveConnection()}
          >
            {saving ? "Saving…" : "Save connection"}
          </button>
          <button
            className="text-button"
            onClick={() => {
              setDraft(state.settings);
              setKey("");
              setYoutubeKey(undefined);
              setSoundcloudCredentials(undefined);
              setDirty(false);
            }}
          >
            Discard changes
          </button>
        </div>
      )}
      {leave && (
        <Dialog title="Unsaved connection" onClose={() => setLeave(null)}>
          <p>Save your connection changes before leaving Settings?</p>
          <div className="dialog-actions">
            <button
              className="primary-button"
              disabled={saving}
              onClick={async () => {
                if (await saveConnection()) {
                  const go = leave;
                  setLeave(null);
                  go();
                }
              }}
            >
              Save and continue
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                const go = leave;
                setDirty(false);
                setLeave(null);
                go();
              }}
            >
              Discard and continue
            </button>
            <button className="text-button" onClick={() => setLeave(null)}>
              Stay here
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
