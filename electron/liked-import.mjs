import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { matchM3u } from "./library-files.mjs";

// All sources originate in a native file picker. The renderer can only refresh
// their opaque IDs, never request arbitrary filesystem paths.
export class LikedImport {
  constructor(manager) {
    this.manager = manager;
    this.plans = new Map();
  }
  sources() {
    return this.manager.store
      .get("likedSources", [])
      .map(({ id, file, name, updated }) => ({ id, file, name, updated }));
  }
  async review(file, sourceId = null) {
    if (!/\.m3u8?$/i.test(file))
      throw new Error("Choose an M3U or M3U8 playlist of liked tracks.");
    if ((await stat(file)).size > 2 * 1024 * 1024)
      throw new Error("This playlist is too large (maximum 2 MB).");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await readFile(file),
      );
    } catch {
      throw new Error("Save this playlist as UTF-8 / M3U8 and try again.");
    }
    const { ids, unresolved } = matchM3u(text, file, this.manager);
    const unique = [...new Set(ids)];
    const tracks = this.manager.resolve(unique);
    const token = randomUUID();
    const name = path.basename(file, path.extname(file));
    for (const [key, plan] of this.plans)
      if (plan.expires < Date.now()) this.plans.delete(key);
    if (this.plans.size >= 20)
      this.plans.delete(this.plans.keys().next().value);
    this.plans.set(token, {
      ids: unique,
      file,
      name,
      sourceId,
      expires: Date.now() + 600000,
    });
    return {
      token,
      name,
      file,
      matched: unique.length,
      alreadyLiked: tracks.filter((t) => t.favorite).length,
      unresolved: unresolved.length,
      unmatched: unresolved.slice(0, 20),
      examples: tracks.slice(0, 12).map((t) => `${t.artist} — ${t.title}`),
    };
  }
  async refresh(id) {
    const source = this.sources().find((s) => s.id === id);
    if (!source) throw new Error("Liked-track source not found.");
    return this.review(source.file, source.id);
  }
  apply(token, remember) {
    const plan = this.plans.get(token);
    if (!plan || plan.expires < Date.now())
      throw new Error(
        "This review expired. Choose or refresh the playlist again.",
      );
    if (typeof remember !== "boolean")
      throw new Error("Invalid import choice.");
    const available = new Set(this.manager.store.tracks().map((t) => t.id));
    const ids = plan.ids.filter((id) => available.has(id));
    if (!ids.length)
      throw new Error(
        "No indexed tracks match this playlist. Add the music folder first.",
      );
    // Additive by design: removing a track from an export never erases a local like.
    this.manager.store.db.exec("BEGIN");
    try {
      const meta = this.manager.meta();
      const put = this.manager.store.db.prepare(
        "INSERT OR REPLACE INTO library_meta VALUES (?,?)",
      );
      for (const id of ids)
        put.run(id, JSON.stringify({ ...meta[id], favorite: true }));
      if (remember) {
        const sources = this.sources();
        const existing = sources.find(
          (s) =>
            s.id === plan.sourceId ||
            s.file.toLowerCase() === plan.file.toLowerCase(),
        );
        if (!existing && sources.length >= 20)
          throw new Error(
            "Remove an older export before remembering another one.",
          );
        const source = {
          id: existing?.id || randomUUID(),
          file: plan.file,
          name: plan.name,
          updated: new Date().toISOString(),
        };
        this.manager.store.set("likedSources", [
          ...sources.filter((s) => s.id !== source.id),
          source,
        ]);
      }
      this.manager.store.db.exec("COMMIT");
    } catch (e) {
      this.manager.store.db.exec("ROLLBACK");
      throw e;
    }
    this.plans.delete(token);
    return { imported: ids.length, skipped: plan.ids.length - ids.length };
  }
  remove(id) {
    const sources = this.sources();
    if (!sources.some((s) => s.id === id))
      throw new Error("Liked-track source not found.");
    this.manager.store.set(
      "likedSources",
      sources.filter((s) => s.id !== id),
    );
    return true;
  }
}
