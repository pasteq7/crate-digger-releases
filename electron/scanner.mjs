import { readdir, stat, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import { inferTrack, taste } from "./core.mjs";
export const extensions = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".aiff",
  ".aif",
  ".wma",
  ".ape",
  ".wv",
]);
export class Scanner {
  constructor(store, emit) {
    this.store = store;
    this.emit = emit;
    this.running = false;
    this.progress = null;
  }
  async scan(roots) {
    if (this.running) return;
    this.running = true;
    const previous = this.store.files();
    const p = {
      running: true,
      checked: 0,
      updated: 0,
      errors: 0,
      current: "Looking through your folders…",
    };
    let last = 0;
    const report = () => {
      this.progress = { ...p };
      if (Date.now() - last > 250) {
        last = Date.now();
        this.emit(this.progress);
      }
    };
    report();
    try {
      for (const root of roots) {
        const seen = new Set();
        let complete = true;
        const walk = async (dir, inheritedGenre = "") => {
          let importGenre = inheritedGenre;
          try {
            const manifest = JSON.parse(
              await readFile(
                path.join(dir, ".crate-digger-import.json"),
                "utf8",
              ),
            );
            if (manifest.version === 1 && typeof manifest.genre === "string")
              importGenre = manifest.genre.slice(0, 100);
          } catch {}
          let entries;
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch {
            p.errors++;
            complete = false;
            report();
            return;
          }
          for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (
                entry.name === ".crate-digger-import-staging" ||
                entry.name.startsWith(".crate-digger-original-")
              )
                continue;
              await walk(file, importGenre);
              continue;
            }
            if (!extensions.has(path.extname(file).toLowerCase())) continue;
            seen.add(file);
            p.checked++;
            p.current = entry.name;
            try {
              const s = await stat(file),
                old = previous.get(file);
              if (!old || old.mtime !== s.mtimeMs || old.size !== s.size) {
                let common = {};
                try {
                  common = (
                    await parseFile(file, { skipCovers: true, duration: false })
                  ).common;
                } catch {
                  p.errors++;
                }
                if (importGenre) common.genre = [importGenre];
                this.store.track(inferTrack(file, root, common), s);
                p.updated++;
              }
            } catch {
              p.errors++;
              complete = false;
            }
            report();
            if (p.checked % 20 === 0) await new Promise((r) => setImmediate(r));
          }
        };
        await walk(root);
        if (complete) this.store.prune(root, seen);
      }
      this.store.set("lastScan", new Date().toISOString());
      p.wishlistRemoved = this.store.reconcileWishlist();
      const profile = taste(this.store.tracks());
      if (profile.total) this.store.history(profile);
    } finally {
      this.running = false;
      this.progress = {
        ...p,
        running: false,
        current: "Your shelves are up to date",
      };
      this.emit(this.progress);
    }
    return this.progress;
  }
  async validateRoot(candidate, roots) {
    const resolved = await realpath(candidate);
    if (!(await stat(resolved)).isDirectory())
      throw new Error("Please choose a folder.");
    const inside = (a, b) => {
      const rel = path.relative(a, b);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    };
    if (roots.some((root) => inside(root, resolved) || inside(resolved, root)))
      throw new Error("That folder is already covered by a library folder.");
    return resolved;
  }
}
