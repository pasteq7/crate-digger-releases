// Electron-independent update lifecycle, also exercised with a fake transport in tests.
export class AppUpdates {
  constructor({
    updater,
    version,
    unavailable = "",
    automatic = true,
    emit,
    busy,
  }) {
    Object.assign(this, { updater, emit, busy });
    this.state = {
      version,
      phase: unavailable ? "disabled" : "idle",
      message: unavailable,
      automatic,
    };
    if (unavailable) return;
    updater.autoDownload = false;
    // Installation is explicit so closing the app can never interrupt music work.
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on("checking-for-update", () =>
      this.set({ phase: "checking", message: "Checking for updates…" }),
    );
    updater.on("update-available", (info) =>
      this.set({
        phase: "available",
        nextVersion: info.version,
        message: `Version ${info.version} is available.`,
      }),
    );
    updater.on("update-not-available", () =>
      this.set({
        phase: "current",
        message: "You’re up to date.",
        checkedAt: new Date().toISOString(),
      }),
    );
    updater.on("download-progress", ({ percent }) =>
      this.set({
        phase: "downloading",
        percent: Math.max(0, Math.min(100, Number(percent) || 0)),
        message: "Downloading update…",
      }),
    );
    updater.on("update-downloaded", (info) =>
      this.set({
        phase: "ready",
        nextVersion: info.version,
        percent: 100,
        message: "Update downloaded. Restart when you’re ready.",
      }),
    );
    updater.on("error", () => this.fail());
  }
  set(patch) {
    // Once downloaded, a late transport error must not discard the install action.
    if (
      ["ready", "installing"].includes(this.state.phase) &&
      !["ready", "installing", undefined].includes(patch.phase)
    )
      return;
    this.state = { ...this.state, ...patch };
    this.emit({ ...this.state });
  }
  fail() {
    if (this.state.phase === "installing") {
      this.set({
        phase: "ready",
        message: "Couldn’t start the installer. Try Restart to update again.",
      });
      return;
    }
    this.set({
      phase: "error",
      percent: undefined,
      message:
        "Couldn’t download or check for updates. Check your connection and try again.",
    });
  }
  async check() {
    if (
      !this.updater ||
      this.state.phase === "disabled" ||
      ["ready", "installing"].includes(this.state.phase)
    )
      return { ...this.state };
    if (this.pending) return this.pending;
    // Defer one microtask so concurrent IPC requests share the same operation.
    this.pending = Promise.resolve()
      .then(async () => {
        try {
          await this.updater.checkForUpdates();
          if (this.state.phase === "available") {
            this.set({
              phase: "downloading",
              percent: 0,
              message: "Downloading update…",
            });
            await this.updater.downloadUpdate();
          }
        } catch {
          this.fail();
        }
        return { ...this.state };
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  setAutomatic(automatic) {
    if (typeof automatic !== "boolean")
      throw new Error("Invalid update preference.");
    this.set({ automatic });
    if (automatic && this.state.phase !== "disabled") void this.check();
    return { ...this.state };
  }
  start() {
    if (this.state.phase === "disabled") return;
    this.startup = setTimeout(() => {
      if (this.state.automatic) void this.check();
    }, 15000);
    this.timer = setInterval(
      () => {
        if (this.state.automatic) void this.check();
      },
      6 * 60 * 60 * 1000,
    );
    this.startup.unref?.();
    this.timer.unref?.();
  }
  install() {
    if (this.state.phase !== "ready")
      throw new Error("Download an update before restarting.");
    if (this.busy())
      throw new Error(
        "Wait for imports, scans, and external commands to finish, then restart to update.",
      );
    this.set({ phase: "installing", message: "Restarting to install update…" });
    try {
      this.updater.quitAndInstall(false, true);
    } catch {
      this.fail();
      throw new Error("Couldn’t start the installer. Try again.");
    }
    return true;
  }
  close() {
    clearTimeout(this.startup);
    clearInterval(this.timer);
  }
}
