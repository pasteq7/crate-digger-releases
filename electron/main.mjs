import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  clipboard,
  protocol,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import electronUpdater from "electron-updater";
import { AppUpdates } from "./app-updates.mjs";
import { Store } from "./store.mjs";
import { Scanner } from "./scanner.mjs";
import { Discovery } from "./discovery.mjs";
import { AlbumTracks } from "./album-tracks.mjs";
import { taste, exportShelf } from "./core.mjs";
import { geminiModels } from "./gemini.mjs";
import { AiActivity } from "./ai-activity.mjs";
import { AiService } from "./ai-service.mjs";
import { AiDiscovery } from "./ai-discovery.mjs";
import { MusicLinks, allowedExternal, searchLinks } from "./music-links.mjs";
import { musicProviders, suppliedProviderLinks } from "./music-providers.mjs";
import { YoutubePreviews, youtubeEmbedHeaders } from "./youtube-preview.mjs";
import { SoundCloud } from "./soundcloud.mjs";
import { Importer } from "./importer.mjs";
import { importRoutes } from "./import-routes.mjs";
import { LibraryWatcher } from "./library-watcher.mjs";
import { LocalMedia } from "./local-media.mjs";
import { LibraryManager } from "./library-manager.mjs";
import { importM3u, exportM3u, LibraryRelink } from "./library-files.mjs";
import { validateAppearance, themePresets } from "./themes.mjs";
import {
  ExternalProgram,
  externalDefaults,
  validateExternalSettings,
  validateExternalUrl,
} from "./external-program.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "crate-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
if (process.env.CRATE_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.CRATE_DATA_DIR));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const musicActions = new Set([
  "import-zips",
  "external-run",
  "external-run-url",
  "external-import",
  "scan",
  "choose-folder",
  "library-relink-review",
  "library-relink-apply",
]);
let activeMusicRequests = 0;
let win,
  store,
  scanner,
  discovery,
  albumTracks,
  aiDiscovery,
  aiActivity,
  musicLinks,
  youtubePreviews,
  soundcloud,
  importer,
  externalProgram,
  appUpdates,
  libraryWatcher;
let localMedia, library, libraryRelink;
let miniature = false,
  regularBounds = null,
  wasMaximized = false;
function setMiniature(value) {
  if (value === miniature) return miniature;
  if (value) {
    regularBounds = win.getNormalBounds();
    wasMaximized = win.isMaximized();
    if (wasMaximized) win.unmaximize();
    win.setMinimumSize(420, 140);
    win.setSize(480, 150);
    win.setAlwaysOnTop(true, "floating");
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(780, 620);
    if (regularBounds) win.setBounds(regularBounds);
    if (wasMaximized) win.maximize();
  }
  miniature = value;
  win.webContents.send("crate:window-mode", value);
  return miniature;
}
const defaults = {
  ...externalDefaults,
  mode: "adjacent",
  theme: "dark",
  ai: "none",
  aiModel: "llama3.2",
  aiEndpoint: "http://127.0.0.1:11434",
  autoScan: false,
  watchLibrary: false,
  view: "library",
  scope: "all",
  kind: "album",
  engine: "catalog",
  appearance: {
    palette: "sage",
    custom: [],
    followSystem: false,
    darkPalette: "sage",
    lightPalette: "paper",
  },
  playbackResume: true,
  normalization: "off",
  crossfadeSeconds: 0,
  density: "comfortable",
  startupView: "last",
};
const settings = () => {
  const saved = store.get("settings", {});
  return {
    ...defaults,
    ...saved,
    engine:
      saved.engine || (saved.ai && saved.ai !== "none" ? "ai" : "catalog"),
  };
};
function publicSettings(value = settings()) {
  const hasAiKeys = {
    openai: !!store.get("aiKey:openai", null),
    gemini: !!store.get("aiKey:gemini", null),
  };
  return {
    ...value,
    importRoot: value.importRoot || store.get("folders", [])[0] || "",
    hasAiKeys,
    hasAiKey: !!hasAiKeys[value.ai],
    hasYoutubeKey: !!store.get("youtubeKey", null),
    hasSoundcloudCredentials: !!store.get("soundcloudAuth", null),
  };
}
function handle(name, fn) {
  ipcMain.handle(`crate:${name}`, async (event, ...args) => {
    const url = event.senderFrame?.url;
    const allowed = process.env.CRATE_DEV_URL
      ? url?.startsWith(`${process.env.CRATE_DEV_URL}/`)
      : url === new URL("../dist/index.html", import.meta.url).href;
    if (event.sender !== win?.webContents || !allowed)
      throw new Error("Untrusted app frame.");
    if (appUpdates?.state.phase === "installing" && musicActions.has(name))
      throw new Error("The app is restarting to install an update.");
    const musicAction = musicActions.has(name);
    if (musicAction) activeMusicRequests++;
    try {
      return await fn(...args);
    } finally {
      if (musicAction) activeMusicRequests--;
    }
  });
}
function publicState() {
  const tracks = store.tracks();
  return {
    tracks,
    profile: taste(tracks),
    folders: store.get("folders", []),
    shelves: store.shelves(),
    settings: publicSettings(),
    history: store.histories(),
    lastScan: store.get("lastScan", null),
    progress: scanner.progress,
    imports: importer?.jobs || [],
    externalJobs: externalProgram?.jobs || [],
    aiActivity: aiActivity?.state,
  };
}
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  await mkdir(app.getPath("userData"), { recursive: true });
  store = new Store(path.join(app.getPath("userData"), "crate-digger.sqlite"));
  localMedia = new LocalMedia(
    store,
    process.env.CRATE_DEV_URL
      ? new URL(process.env.CRATE_DEV_URL).origin
      : "null",
  );
  library = new LibraryManager(store, localMedia);
  libraryRelink = new LibraryRelink(store);
  store.reconcileWishlist();
  // Earlier versions had one cloud provider. Preserve its encrypted key as OpenAI-only.
  const legacyKey = store.get("aiKey", null);
  if (legacyKey) {
    if (!store.get("aiKey:openai", null)) store.set("aiKey:openai", legacyKey);
    store.set("aiKey", null);
  }
  scanner = new Scanner(store, (p) => {
    if (!p.running) libraryWatcher?.noteScan();
    libraryWatcher?.setRoots(
      settings().watchLibrary ? store.get("folders", []) : [],
    );
    if (win && !win.isDestroyed())
      win.webContents.send("crate:scan-progress", p);
  });
  libraryWatcher = new LibraryWatcher({
    scan: () => scanner.scan(store.get("folders", [])),
    running: () => scanner.running,
    enabled: () =>
      !!win &&
      !win.isDestroyed() &&
      settings().watchLibrary &&
      appUpdates?.state.phase !== "installing",
  });
  libraryWatcher.setRoots(
    settings().watchLibrary ? store.get("folders", []) : [],
  );
  discovery = new Discovery(
    store,
    (p) => win?.webContents.send("crate:finds-progress", p),
    app.getLocaleCountryCode() || "US",
  );
  musicLinks = new MusicLinks(
    store,
    app.getLocaleCountryCode() || "US",
    discovery,
  );
  albumTracks = new AlbumTracks(discovery);
  youtubePreviews = new YoutubePreviews(
    store,
    () => {
      const encrypted = store.get("youtubeKey", null);
      return encrypted
        ? safeStorage.decryptString(Buffer.from(encrypted, "base64"))
        : "";
    },
    app.getLocaleCountryCode() || "US",
  );
  importer = new Importer({
    stagingForRoot: (root) => {
      const local = app.getPath("userData");
      return path.parse(local).root.toLowerCase() ===
        path.parse(root).root.toLowerCase()
        ? path.join(local, "import-staging")
        : path.join(path.parse(root).root, ".crate-digger-import-staging");
    },
    jobs: store.get("imports", []),
    command: app.isPackaged
      ? path.join(process.resourcesPath, "importer", "CrateDiggerImport.exe")
      : process.env.CRATE_PYTHON || "C:\\Python312\\python.exe",
    args: app.isPackaged ? [] : [path.join(here, "import_music.py")],
    emit: (jobs) => {
      store.set("imports", jobs.slice(-100));
      win?.webContents.send("crate:import-progress", jobs);
    },
    completed: async (job) => {
      // The root was selected through a native folder picker. Add only if not already indexed.
      while (scanner.running) await new Promise((r) => setTimeout(r, 300));
      let folders = store.get("folders", []);
      if (job.kind === "folder" && job.sourceRemoved) {
        const removed = folders.filter((root) => {
          const rel = path.relative(job.zip, root);
          return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
        });
        for (const root of removed) store.removeRoot(root);
        folders = folders.filter((root) => !removed.includes(root));
        store.set("folders", folders);
      }
      const covered = folders.some((root) => {
        const rel = path.relative(root, job.root);
        return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
      });
      if (!covered) {
        const children = folders.filter((root) => {
          const rel = path.relative(job.root, root);
          return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
        });
        for (const root of children) store.removeRoot(root);
        folders = folders.filter((root) => !children.includes(root));
        const validated = await scanner.validateRoot(job.root, folders);
        folders = [...folders, validated];
        store.set("folders", folders);
      }
      await scanner.scan(folders);
    },
  });
  externalProgram = new ExternalProgram({
    importer,
    scratch: path.join(app.getPath("userData"), "external-output"),
    emit: (jobs) => win?.webContents.send("crate:external-progress", jobs),
  });
  const soundcloudAuth = () => {
    const encrypted = store.get("soundcloudAuth", null);
    return encrypted
      ? JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "base64")))
      : null;
  };
  soundcloud = new SoundCloud(store, soundcloudAuth, (auth) => {
    store.set(
      "soundcloudAuth",
      safeStorage.encryptString(JSON.stringify(auth)).toString("base64"),
    );
  });
  aiActivity = new AiActivity(store, (data) => {
    if (win && !win.isDestroyed())
      win.webContents.send("crate:ai-activity", data);
  });
  const aiService = new AiService(
    settings,
    (provider) => {
      const encrypted = store.get(`aiKey:${provider}`, null);
      return encrypted
        ? safeStorage.decryptString(Buffer.from(encrypted, "base64"))
        : "";
    },
    aiActivity,
  );
  aiDiscovery = new AiDiscovery(
    store,
    discovery,
    aiService,
    settings,
    (p) => win?.webContents.send("crate:finds-progress", p),
    soundcloud,
  );
  const bounds = store.get("bounds", { width: 1440, height: 960 });
  win = new BrowserWindow({
    ...bounds,
    minWidth: 780,
    minHeight: 620,
    title: "Crate Digger",
    icon: path.join(here, "../build/icon.ico"),
    backgroundColor: "#151516",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#181a18", symbolColor: "#edefe8", height: 43 },
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.session.protocol.handle("crate-media", (request) =>
    localMedia.handle(request),
  );
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["https://www.youtube.com/embed/*"] },
    (details, callback) =>
      callback({
        requestHeaders: youtubeEmbedHeaders(details, win.webContents.id),
      }),
  );
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Preserve the YouTube player's own links without allowing new app windows.
    if (
      /^https:\/\/(?:www\.)?(?:youtube|soundcloud)\.com\//.test(url) &&
      allowedExternal(url)
    )
      void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  const suspendYoutube = () => win.webContents.send("crate:youtube-suspend");
  win.on("minimize", suspendYoutube);
  win.on("hide", suspendYoutube);
  win.on("close", (event) => {
    store.set(
      "bounds",
      miniature && regularBounds ? regularBounds : win.getBounds(),
    );
    if (externalProgram.running) {
      event.preventDefault();
      if (miniature) setMiniature(false);
      win.webContents.send("crate:external-close");
    } else if (importer.running) {
      event.preventDefault();
      if (miniature) setMiniature(false);
      win.webContents.send("crate:import-close");
    }
  });
  handle("state", publicState);
  handle("mini-player", (value) => {
    if (typeof value !== "boolean") throw new Error("Invalid window mode.");
    return setMiniature(value);
  });
  handle("library-query", (options) => library.query(options));
  handle("library-state", () => library.snapshot());
  handle("library-resolve", (ids) => library.resolve(ids));
  handle("library-edit", (ids, patch) => library.update(ids, patch));
  handle("playlist-save", (value) => library.playlist(value));
  handle("playlist-delete", (id) => library.removePlaylist(id));
  handle("playback-save", (value) => library.playback(value));
  handle("track-played", (id) => library.played(id));
  handle("library-duplicates", () => library.duplicates());
  handle("listening-clear", () => library.clearListening());
  handle("playlist-import", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Import playlist",
      properties: ["openFile"],
      filters: [{ name: "M3U playlist", extensions: ["m3u", "m3u8"] }],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await stat(file)).size > 2 * 1024 * 1024)
      throw new Error("This playlist is too large.");
    return importM3u(await readFile(file, "utf8"), file, library);
  });
  handle("playlist-export", async (id) => {
    const list = library.playlists().find((p) => p.id === id);
    if (!list) throw new Error("Playlist not found.");
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${list.name.replace(/[<>:"/\\|?*]/g, "-")}.m3u8`,
      filters: [{ name: "M3U playlist", extensions: ["m3u8"] }],
    });
    if (result.canceled) return false;
    await writeFile(result.filePath, exportM3u(list, library), "utf8");
    return true;
  });
  handle("library-backup", async () => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: "Crate Digger Library.json",
      filters: [{ name: "Library backup", extensions: ["json"] }],
    });
    if (result.canceled) return false;
    await writeFile(
      result.filePath,
      JSON.stringify(library.backup(), null, 2),
      "utf8",
    );
    return true;
  });
  handle("library-restore", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Restore library notes and playlists",
      properties: ["openFile"],
      filters: [{ name: "Library backup", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    if ((await stat(result.filePaths[0])).size > 10 * 1024 * 1024)
      throw new Error("This backup is too large.");
    return library.restore(
      JSON.parse(await readFile(result.filePaths[0], "utf8")),
    );
  });
  handle("library-relink-review", async (root) => {
    if (scanner.running) throw new Error("Let the current scan finish first.");
    if (typeof root !== "string" || !store.get("folders", []).includes(root))
      throw new Error("Choose an indexed folder.");
    const result = await dialog.showOpenDialog(win, {
      title: "Locate this music folder",
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    const next = await scanner.validateRoot(
      result.filePaths[0],
      store.get("folders", []).filter((r) => r !== root),
    );
    return libraryRelink.review(root, next);
  });
  handle("library-relink-apply", (token) => {
    if (scanner.running) throw new Error("Let the current scan finish first.");
    const result = libraryRelink.apply(token);
    scanner.scan(store.get("folders", [])).catch(console.error);
    return result;
  });
  handle("chrome-theme", (value) => {
    if (
      !value ||
      !/^#[a-f\d]{6}$/i.test(value.background) ||
      !/^#[a-f\d]{6}$/i.test(value.text)
    )
      throw new Error("Invalid chrome colors.");
    win.setTitleBarOverlay({
      color: value.background,
      symbolColor: value.text,
      height: 43,
    });
    return true;
  });
  handle("youtube-search", (item) => youtubePreviews.search(item));
  handle("soundcloud-search", (item) => soundcloud.search(item));
  handle("soundcloud-resolve", (url) => soundcloud.resolve(url));
  const installed =
    app.isPackaged &&
    process.platform === "win32" &&
    existsSync(
      path.join(path.dirname(app.getPath("exe")), "Uninstall Crate Digger.exe"),
    );
  const configured = existsSync(
    path.join(process.resourcesPath, "app-update.yml"),
  );
  appUpdates = new AppUpdates({
    updater: electronUpdater.autoUpdater,
    version: app.getVersion(),
    unavailable: !installed
      ? "Install Crate Digger with the Windows installer to receive automatic updates."
      : !configured
        ? "Updates aren’t configured in this build."
        : "",
    automatic: store.get("automaticUpdates", true),
    emit: (state) => {
      if (!win.isDestroyed())
        win.webContents.send("crate:update-progress", state);
    },
    busy: () =>
      activeMusicRequests > 0 ||
      importer.running ||
      externalProgram.running ||
      scanner.running,
  });
  handle("update-state", () => ({ ...appUpdates.state }));
  handle("update-check", () => appUpdates.check());
  handle("update-install", () => appUpdates.install());
  handle("update-automatic", (value) => {
    if (typeof value !== "boolean")
      throw new Error("Invalid update preference.");
    store.set("automaticUpdates", value);
    return appUpdates.setAutomatic(value);
  });
  handle("external-folder", async () => {
    const selected = await dialog.showOpenDialog(win, {
      title: "Choose the external program working folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return selected.canceled ? null : selected.filePaths[0];
  });
  handle("external-run", async (item, scope, provider = "amazon") => {
    if (
      !item ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      JSON.stringify(item).length > 25000 ||
      typeof scope !== "string" ||
      scope.length > 4096 ||
      !musicProviders.some((p) => p.id === provider)
    )
      throw new Error("Invalid release.");
    const initial = suppliedProviderLinks(item, musicLinks.country).find(
      (p) => p.id === provider,
    );
    if (!initial)
      throw new Error("Find a provider link or paste its URL first.");
    const result = { amazon: initial.url, exact: initial.exact };
    return externalProgram.start({
      item,
      scope,
      amazonUrl: result.amazon,
      exact: result.exact,
      lookupReason: result.reason,
      lookupLabel: initial.label,
      resolveUrl:
        provider === "amazon"
          ? () => musicLinks.resolve(item)
          : async () => {
              const link = initial.exact
                ? initial
                : (await musicLinks.providers(item)).find(
                    (p) => p.id === provider,
                  );
              if (!link?.url)
                throw new Error(
                  "No provider link found. Paste the URL instead.",
                );
              return { amazon: link.url, exact: link.exact };
            },
      settings: publicSettings(),
      roots: store.get("folders", []),
    });
  });
  handle("external-run-url", async (value, scope, suppliedItem) => {
    const url = validateExternalUrl(value);
    if (
      typeof scope !== "string" ||
      scope.length > 4096 ||
      (suppliedItem &&
        (typeof suppliedItem.artist !== "string" ||
          typeof suppliedItem.title !== "string" ||
          JSON.stringify(suppliedItem).length > 25000))
    )
      throw new Error("Invalid external program request.");
    const item = suppliedItem || {
      title: "Pasted URL",
      artist: new URL(url).hostname,
      sourceFolder: "",
    };
    return externalProgram.start({
      item,
      scope,
      amazonUrl: url,
      exact: true,
      pasted: true,
      settings: publicSettings(),
      roots: store.get("folders", []),
    });
  });
  handle("album-tracks", async (item) => {
    if (
      !item ||
      item.kind !== "album" ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      JSON.stringify(item).length > 25000
    )
      throw new Error("Invalid album.");
    return albumTracks.list(item);
  });
  handle("release-count", async (item) => {
    if (
      !item ||
      item.kind !== "album" ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      JSON.stringify(item).length > 25000
    )
      throw new Error("Invalid album.");
    let counts;
    if (item.soundcloud?.confirmed && item.catalogVerified) {
      const match = (await soundcloud.search(item).catch(() => [])).find(
        (source) => source.url === item.soundcloud.url,
      );
      const count = match?.trackCount || item.soundcloud.trackCount;
      counts = {
        trackCount: Number.isInteger(count) && count > 0 ? count : null,
        trackCountSource: "SoundCloud",
      };
    } else counts = await discovery.countFor(item);
    const saved = store.shelves()[item.id];
    if (saved && counts.trackCount)
      store.shelf(item.id, { ...saved, item: { ...saved.item, ...counts } });
    return counts;
  });
  handle("external-cancel", (id) => externalProgram.cancel(id));
  handle("external-clear", (id) => externalProgram.clear(id));
  handle("external-import", (id, options) => {
    if (typeof id !== "string" || !publicSettings().importRoot)
      throw new Error("Choose your import destination first.");
    return externalProgram.importJob(id, {
      root: publicSettings().importRoot,
      destinationFolder: options?.destinationFolder ?? "",
      tagGenre: options?.tagGenre === true,
      cleanComments: options?.cleanComments !== false,
    });
  });
  handle("import-routes", () => importRoutes(publicSettings().importRoot));
  handle("import-destination", async () => {
    const selected = await dialog.showOpenDialog(win, {
      title: "Choose the folder where new music will be imported",
      properties: ["openDirectory", "createDirectory"],
    });
    if (selected.canceled) return null;
    const next = { ...settings(), importRoot: selected.filePaths[0] };
    store.set("settings", next);
    return publicSettings(next);
  });
  handle("choose-zips", async () => {
    const selected = await dialog.showOpenDialog(win, {
      title: "Import music ZIPs",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "ZIP archives", extensions: ["zip"] }],
    });
    return selected.canceled ? [] : selected.filePaths;
  });
  handle("choose-import-folder", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Choose a music folder to tag and move",
      properties: ["openDirectory"],
    });
    return result.canceled ? [] : result.filePaths;
  });
  handle("import-zips", (files, options) => {
    if (!publicSettings().importRoot)
      throw new Error("Choose your import destination first.");
    return importer.enqueue(files, {
      root: publicSettings().importRoot,
      destinationFolder: options?.destinationFolder ?? "",
      tagGenre: options?.tagGenre === true,
      cleanComments: options?.cleanComments,
    });
  });
  handle("provider-links", async (item) => {
    if (
      !item ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      JSON.stringify(item).length > 25000
    )
      throw new Error("Invalid release.");
    return musicLinks.providers(item, { force: true });
  });
  handle("music-link", async (item, action, provider) => {
    if (
      !item ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      JSON.stringify(item).length > 25000 ||
      !["amazon", "open", "copy", "youtube", "retry"].includes(action) ||
      (provider !== undefined && !musicProviders.some((p) => p.id === provider))
    )
      throw new Error("Invalid music link.");
    if (provider && action !== "youtube") {
      const initial = suppliedProviderLinks(item, musicLinks.country).find(
        (p) => p.id === provider,
      );
      const links =
        initial?.exact && action !== "retry"
          ? suppliedProviderLinks(item, musicLinks.country)
          : await musicLinks.providers(item, { force: action === "retry" });
      const link = links.find((p) => p.id === provider);
      if (!link?.url || !allowedExternal(link.url))
        throw new Error("No provider link found. Paste the URL instead.");
      if (action === "copy") clipboard.writeText(link.url);
      else if (action !== "retry") await shell.openExternal(link.url);
      return {
        ...searchLinks(item, musicLinks.country),
        amazon: link.url,
        ...link,
        links,
      };
    }
    const result =
      action === "youtube"
        ? (await import("./music-links.mjs")).searchLinks(
            item,
            musicLinks.country,
          )
        : await musicLinks.resolve(item, { force: action === "retry" });
    if (action === "copy") clipboard.writeText(result.amazon);
    else if (action !== "retry")
      await shell.openExternal(
        action === "youtube" ? result.youtube : result.amazon,
      );
    return result;
  });
  handle("refresh-preview", async (item) => {
    if (
      !item ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      JSON.stringify(item).length > 25000
    )
      throw new Error("Invalid release.");
    if (item.albumTrackId !== undefined) {
      if (
        typeof item.albumTrackId !== "string" ||
        !/^(apple|deezer):\d+$/.test(item.albumTrackId)
      )
        throw new Error("Invalid album track.");
      const list = await albumTracks.list(item, { refresh: true });
      const track = list.tracks.find((t) => t.id === item.albumTrackId);
      return track
        ? {
            preview: track.preview,
            previewTitle: track.title,
            previewSource: track.previewSource,
            trackUrl: track.trackUrl,
          }
        : null;
    }
    if (item.kind === "track")
      return discovery.resolveTrack(item.artist, item.title);
    return item.previewSource === "deezer"
      ? discovery.deezerPreview(
          item.artist,
          item.album || item.title,
          item.previewTitle || "",
        )
      : discovery.resolveAlbum(
          item.artist,
          item.album || item.title,
          item.previewTitle || "",
        );
  });
  handle("choose-folder", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Choose your music folder",
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    if (scanner.running)
      throw new Error("Let this scan finish before adding another folder.");
    const folders = store.get("folders", []),
      root = await scanner.validateRoot(result.filePaths[0], folders);
    store.set("folders", [...folders, root]);
    scanner.scan([...folders, root]).catch(console.error);
    return publicState();
  });
  handle("remove-folder", (root) => {
    if (scanner.running) throw new Error("Let this scan finish first.");
    if (typeof root !== "string") throw new Error("Invalid folder.");
    store.set(
      "folders",
      store.get("folders", []).filter((r) => r !== root),
    );
    store.removeRoot(root);
    libraryWatcher.setRoots(
      settings().watchLibrary ? store.get("folders", []) : [],
    );
    return publicState();
  });
  handle("scan", () => {
    scanner.scan(store.get("folders", [])).catch(console.error);
    return { started: true };
  });
  handle("discover", (options) => {
    if (
      !options ||
      !["safe", "adjacent", "wildcard"].includes(options.mode) ||
      !["album", "track", "artist"].includes(options.kind) ||
      typeof options.scope !== "string" ||
      options.scope.length > 4096 ||
      !Number.isSafeInteger(options.offset) ||
      options.offset < 0 ||
      options.offset > 100000
    )
      throw new Error("Invalid discovery options.");
    aiDiscovery.cancel();
    return discovery.recommend(options);
  });
  handle("ai-context", (scope) => {
    if (typeof scope !== "string" || scope.length > 4096)
      throw new Error("Invalid discovery scope.");
    return aiDiscovery.context(scope);
  });
  handle("ai-discover", (options) => {
    if (
      !options ||
      typeof options.scope !== "string" ||
      options.scope.length > 4096 ||
      !["safe", "adjacent", "wildcard"].includes(options.mode) ||
      !Number.isSafeInteger(options.requestId) ||
      !Number.isSafeInteger(options.batch) ||
      options.batch < 0 ||
      options.batch > 10000 ||
      (options.brief !== undefined &&
        (typeof options.brief !== "string" || options.brief.length > 1000)) ||
      (options.soundcloud !== undefined &&
        typeof options.soundcloud !== "boolean") ||
      !Array.isArray(options.exclude) ||
      options.exclude.length > 100 ||
      options.exclude.some(
        (i) =>
          !i ||
          typeof i.artist !== "string" ||
          typeof i.album !== "string" ||
          i.artist.length > 500 ||
          i.album.length > 500 ||
          (i.kind !== undefined &&
            !["album", "track", "artist"].includes(i.kind)),
      )
    )
      throw new Error("Invalid AI discovery request.");
    return aiDiscovery.recommend(options);
  });
  handle("cancel-ai", () => {
    aiDiscovery.cancel();
    return true;
  });
  handle("shelf", (item, status) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      JSON.stringify(item).length > 25000 ||
      !["wishlist", "rejected", null].includes(status)
    )
      throw new Error("Invalid shelf.");
    store.shelf(
      item.id,
      status ? { item, status, added: new Date().toISOString() } : null,
    );
    return store.shelves();
  });
  handle("settings", (value) => {
    if (!value || typeof value !== "object")
      throw new Error("Invalid settings.");
    const next = settings();
    for (const key of [
      "mode",
      "theme",
      "ai",
      "aiModel",
      "aiEndpoint",
      "autoScan",
      "watchLibrary",
      "view",
      "scope",
      "kind",
      "engine",
      "appearance",
      "playbackResume",
      "normalization",
      "crossfadeSeconds",
      "density",
      "startupView",
      ...Object.keys(externalDefaults),
    ])
      if (key in value) next[key] = value[key];
    if (
      !["safe", "adjacent", "wildcard"].includes(next.mode) ||
      !["dark", "light"].includes(next.theme) ||
      !["none", "ollama", "openai", "gemini"].includes(next.ai) ||
      !["catalog", "ai"].includes(next.engine) ||
      typeof next.autoScan !== "boolean" ||
      typeof next.watchLibrary !== "boolean"
    )
      throw new Error("Invalid setting.");
    if (
      typeof next.aiModel !== "string" ||
      next.aiModel.length > 150 ||
      typeof next.aiEndpoint !== "string" ||
      next.aiEndpoint.length > 250
    )
      throw new Error("Invalid model settings.");
    validateExternalSettings(next);
    if (
      typeof next.playbackResume !== "boolean" ||
      !["off", "track", "album"].includes(next.normalization) ||
      !Number.isFinite(next.crossfadeSeconds) ||
      next.crossfadeSeconds < 0 ||
      next.crossfadeSeconds > 10 ||
      !["comfortable", "compact"].includes(next.density) ||
      !["last", "library", "discover"].includes(next.startupView)
    )
      throw new Error("Invalid playback or appearance preference.");
    if (value.appearance !== undefined) {
      next.appearance = validateAppearance(value.appearance);
      const palette = [...themePresets, ...next.appearance.custom].find(
        (p) => p.id === next.appearance.palette,
      );
      next.theme = palette.mode;
    }
    if (value.soundcloudCredentials !== undefined) {
      const credentials = value.soundcloudCredentials;
      if (
        credentials !== null &&
        (!credentials ||
          typeof credentials !== "object" ||
          typeof credentials.clientId !== "string" ||
          !credentials.clientId.trim() ||
          credentials.clientId.length > 1024 ||
          typeof credentials.clientSecret !== "string" ||
          !credentials.clientSecret.trim() ||
          credentials.clientSecret.length > 2048)
      )
        throw new Error("Enter both a SoundCloud client ID and client secret.");
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Windows credential encryption is unavailable.");
      store.set(
        "soundcloudAuth",
        credentials
          ? safeStorage
              .encryptString(
                JSON.stringify({
                  clientId: credentials.clientId.trim(),
                  clientSecret: credentials.clientSecret.trim(),
                }),
              )
              .toString("base64")
          : null,
      );
    }
    if (value.youtubeKey !== undefined) {
      if (
        typeof value.youtubeKey !== "string" ||
        value.youtubeKey.length > 1024
      )
        throw new Error("Invalid YouTube key.");
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Windows credential encryption is unavailable.");
      store.set(
        "youtubeKey",
        value.youtubeKey.trim()
          ? safeStorage
              .encryptString(value.youtubeKey.trim())
              .toString("base64")
          : null,
      );
    }
    if (value.aiKey !== undefined && ["openai", "gemini"].includes(next.ai)) {
      if (typeof value.aiKey !== "string" || value.aiKey.length > 1024)
        throw new Error("Invalid key.");
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Windows credential encryption is unavailable.");
      store.set(
        `aiKey:${next.ai}`,
        value.aiKey
          ? safeStorage.encryptString(value.aiKey).toString("base64")
          : null,
      );
    }
    store.set("settings", next);
    libraryWatcher.setRoots(next.watchLibrary ? store.get("folders", []) : []);
    return publicSettings(next);
  });
  handle("export", async (items, format) => {
    if (
      !Array.isArray(items) ||
      items.length > 50000 ||
      !["txt", "csv"].includes(format)
    )
      throw new Error("Invalid export.");
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `Crate Digger Wishlist.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled) return false;
    await writeFile(result.filePath, exportShelf(items, format), "utf8");
    return true;
  });
  handle("test-ai", async (options) => {
    if (
      !options ||
      options.provider !== "gemini" ||
      (options.key !== undefined &&
        (typeof options.key !== "string" || options.key.length > 1024)) ||
      (options.model !== undefined &&
        (typeof options.model !== "string" || options.model.length > 150))
    ) {
      throw new Error("Invalid connection settings.");
    }
    const saved = store.get("aiKey:gemini", null);
    const key =
      options.key?.trim() ||
      (saved
        ? safeStorage.decryptString(Buffer.from(saved, "base64")).trim()
        : "");
    if (!key) throw new Error("Enter your Google Gemini API key first.");
    if (/\s/.test(key))
      throw new Error(
        "The API key contains spaces or line breaks. Paste it again.",
      );
    const models = await geminiModels(key, (url, options, provider) =>
      aiActivity.request(url, options, provider, {
        purpose: "Check connection · list available models",
        generation: false,
      }),
    );
    const selectedModelAvailable = models.includes(
      (options.model || "").trim().replace(/^models\//, ""),
    );
    return { models, selectedModelAvailable };
  });
  handle("external", (url) => {
    if (typeof url !== "string") return;
    if (allowedExternal(url)) return shell.openExternal(url);
  });
  handle("explain", async (item) => {
    if (
      !item ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string"
    )
      throw new Error("Invalid item.");
    const s = settings();
    if (s.ai === "none") return item.reason;
    const prompt =
      item.id === "taste-profile"
        ? `Summarize this music collection in 50 words or fewer, based only on these counts. Do not invent listening habits. Profile: ${JSON.stringify(taste(store.tracks()))}`
        : `Write one brief, factual music discovery explanation (max 35 words). Do not invent listening history or claim measured similarity. Library artists: ${taste(
            store.tracks(),
          )
            .artists.slice(0, 5)
            .map((x) => x.name)
            .join(
              ", ",
            )}. Recommendation: ${item.artist} — ${item.title}. Basis: ${item.reason}.`;
    return (
      await aiService.generate(prompt, {
        maxTokens: s.ai === "openai" ? 160 : 1024,
        purpose:
          item.id === "taste-profile"
            ? "Summarize collection taste"
            : `Explain recommendation · ${item.artist} — ${item.title}`,
      })
    ).slice(0, 600);
  });
  if (process.env.CRATE_DEV_URL) await win.loadURL(process.env.CRATE_DEV_URL);
  else await win.loadFile(path.join(here, "../dist/index.html"));
  win.show();
  appUpdates.start();
  if (settings().autoScan && store.get("folders", []).length)
    scanner.scan(store.get("folders", [])).catch(console.error);
});
app.on("window-all-closed", () => app.quit());
app.on("second-instance", () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
app.on("before-quit", () => {
  libraryWatcher?.close();
  appUpdates?.close();
});
