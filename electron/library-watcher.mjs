import { watch } from "node:fs";

export class LibraryWatcher {
  constructor({
    scan,
    running,
    enabled,
    delay = 10000,
    minInterval = 15 * 60000,
  }) {
    Object.assign(this, { scan, running, enabled, delay, minInterval });
    this.watchers = new Map();
    this.lastScan = 0;
  }
  setRoots(roots) {
    if (!roots.length) clearTimeout(this.timer);
    for (const [root, watcher] of this.watchers) {
      if (!roots.includes(root)) {
        watcher.close();
        this.watchers.delete(root);
      }
    }
    for (const root of roots) {
      if (this.watchers.has(root)) continue;
      try {
        const watcher = watch(
          root,
          { recursive: true, persistent: false },
          (_event, file) => {
            if (String(file).includes(".crate-digger-import-staging")) return;
            this.schedule();
          },
        );
        watcher.on("error", () => {
          watcher.close();
          this.watchers.delete(root);
        });
        this.watchers.set(root, watcher);
      } catch {
        // Retry unavailable roots after a scan or when watching is enabled again.
      }
    }
  }
  schedule() {
    clearTimeout(this.timer);
    if (!this.enabled()) return;
    this.timer = setTimeout(
      async () => {
        if (!this.enabled()) return;
        if (this.running()) return this.schedule();
        if (Date.now() - this.lastScan < this.minInterval)
          return this.schedule();
        try {
          this.lastScan = Date.now();
          await this.scan();
        } catch (error) {
          console.error(error);
        }
      },
      Math.max(this.delay, this.minInterval - (Date.now() - this.lastScan)),
    );
    this.timer.unref();
  }
  close() {
    clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
  noteScan() {
    this.lastScan = Date.now();
  }
}
