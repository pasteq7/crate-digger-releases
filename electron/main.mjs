import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  clipboard,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import electronUpdater from "electron-updater";
import { AppUpdates } from "./app-updates.mjs";
import { Store } from "./store.mjs";
import { Scanner } from "./scanner.mjs";
import { Discovery } from "./discovery.mjs";
import { taste, exportShelf } from "./core.mjs";
import { geminiRequest, geminiText, geminiModels } from "./gemini.mjs";
import { aiJson } from "./ai-http.mjs";
import { AiService } from "./ai-service.mjs";
import { AiDiscovery } from "./ai-discovery.mjs";
import { MusicLinks, allowedExternal } from "./music-links.mjs";
import { YoutubePreviews, youtubeEmbedHeaders } from "./youtube-preview.mjs";
import { SoundCloud } from "./soundcloud.mjs";
import { Importer } from "./importer.mjs";
import { importRoutes } from "./import-routes.mjs";
import { LibraryWatcher } from "./library-watcher.mjs";
import {
  ExternalProgram,
  externalDefaults,
  validateExternalSettings,
  validateExternalUrl,
} from "./external-program.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
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
]);
let activeMusicRequests = 0;
let win,
  store,
  scanner,
  discovery,
  aiDiscovery,
  musicLinks,
  youtubePreviews,
  soundcloud,
  importer,
  externalProgram,
  appUpdates,
  libraryWatcher;
const defaults = {
  ...externalDefaults,
  mode: "adjacent",
  theme: "dark",
  ai: "none",
  aiModel: "llama3.2",
  aiEndpoint: "http://127.0.0.1:11434",
  autoScan: true,
  view: "discover",
  scope: "all",
  kind: "album",
  engine: "catalog",
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
  };
}
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  await mkdir(app.getPath("userData"), { recursive: true });
  store = new Store(path.join(app.getPath("userData"), "crate-digger.sqlite"));
  store.reconcileWishlist();
  // Earlier versions had one cloud provider. Preserve its encrypted key as OpenAI-only.
  const legacyKey = store.get("aiKey", null);
  if (legacyKey) {
    if (!store.get("aiKey:openai", null)) store.set("aiKey:openai", legacyKey);
    store.set("aiKey", null);
  }
  scanner = new Scanner(store, (p) => {
    libraryWatcher?.setRoots(store.get("folders", []));
    if (win && !win.isDestroyed())
      win.webContents.send("crate:scan-progress", p);
  });
  libraryWatcher = new LibraryWatcher({
    scan: () => scanner.scan(store.get("folders", [])),
    running: () => scanner.running,
    enabled: () =>
      !!win &&
      !win.isDestroyed() &&
      settings().autoScan &&
      appUpdates?.state.phase !== "installing",
  });
  libraryWatcher.setRoots(store.get("folders", []));
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
  const aiService = new AiService(settings, (provider) => {
    const encrypted = store.get(`aiKey:${provider}`, null);
    return encrypted
      ? safeStorage.decryptString(Buffer.from(encrypted, "base64"))
      : "";
  });
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
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
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
    store.set("bounds", win.getBounds());
    if (externalProgram.running) {
      event.preventDefault();
      win.webContents.send("crate:external-close");
    } else if (importer.running) {
      event.preventDefault();
      win.webContents.send("crate:import-close");
    }
  });
  handle("state", publicState);
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
  handle("external-run", async (item, scope) => {
    if (
      !item ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      JSON.stringify(item).length > 25000 ||
      typeof scope !== "string"
    )
      throw new Error("Invalid release.");
    const result = await musicLinks.resolve(item);
    return externalProgram.start({
      item,
      scope,
      amazonUrl: result.amazon,
      exact: result.exact,
      lookupReason: result.reason,
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
  handle("music-link", async (item, action) => {
    if (
      !item ||
      typeof item.artist !== "string" ||
      typeof item.title !== "string" ||
      JSON.stringify(item).length > 25000 ||
      !["amazon", "copy", "youtube", "retry"].includes(action)
    )
      throw new Error("Invalid music link.");
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
    libraryWatcher.setRoots(store.get("folders", []));
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
      "view",
      "scope",
      "kind",
      "engine",
      ...Object.keys(externalDefaults),
    ])
      if (key in value) next[key] = value[key];
    if (
      !["safe", "adjacent", "wildcard"].includes(next.mode) ||
      !["dark", "light"].includes(next.theme) ||
      !["none", "ollama", "openai", "gemini"].includes(next.ai) ||
      !["catalog", "ai"].includes(next.engine)
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
    const models = await geminiModels(key);
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
    let url,
      body,
      headers = { "Content-Type": "application/json" };
    if (s.ai === "ollama") {
      const base = new URL(s.aiEndpoint);
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
        base.protocol !== "http:"
      )
        throw new Error(
          "Use a local Ollama address, such as http://127.0.0.1:11434.",
        );
      url = new URL("/api/generate", base);
      body = { model: s.aiModel, prompt, stream: false };
    } else if (s.ai === "gemini") {
      const key = store.get("aiKey:gemini", null);
      if (!key)
        throw new Error("Add your Google Gemini API key in Settings first.");
      ({ url, body, headers } = geminiRequest(
        s.aiModel,
        prompt,
        safeStorage.decryptString(Buffer.from(key, "base64")),
      ));
    } else {
      const key = store.get("aiKey:openai", null);
      if (!key) throw new Error("Add an API key in Settings first.");
      headers.Authorization = `Bearer ${safeStorage.decryptString(Buffer.from(key, "base64"))}`;
      url = "https://api.openai.com/v1/chat/completions";
      body = {
        model: s.aiModel || "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 160,
        store: false,
      };
    }
    const data = await aiJson(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      s.ai,
    );
    if (s.ai === "gemini") return geminiText(data);
    return String(
      data.response || data.choices?.[0]?.message?.content || item.reason,
    ).slice(0, 600);
  });
  if (process.env.CRATE_DEV_URL) await win.loadURL(process.env.CRATE_DEV_URL);
  else await win.loadFile(path.join(here, "../dist/index.html"));
  win.show();
  appUpdates.start();
  if (settings().autoScan && store.get("folders", []).length)
    scanner.scan(store.get("folders", [])).catch(console.error);
  setInterval(() => {
    if (
      settings().autoScan &&
      appUpdates.state.phase !== "installing" &&
      !scanner.running &&
      store.get("folders", []).length
    )
      scanner.scan(store.get("folders", [])).catch(console.error);
  }, 300000).unref();
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
