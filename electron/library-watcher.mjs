import { watch } from "node:fs";

export class LibraryWatcher {
  constructor({ scan, running, enabled, delay = 1200 }) {
    Object.assign(this, { scan, running, enabled, delay });
    this.watchers = new Map();
  }
  setRoots(roots) {
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
        // Unavailable roots are retried on the next periodic scan.
      }
    }
  }
  schedule() {
    clearTimeout(this.timer);
    if (!this.enabled()) return;
    this.timer = setTimeout(async () => {
      if (!this.enabled()) return;
      if (this.running()) return this.schedule();
      try {
        await this.scan();
      } catch (error) {
        console.error(error);
      }
    }, this.delay);
    this.timer.unref();
  }
  close() {
    clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
