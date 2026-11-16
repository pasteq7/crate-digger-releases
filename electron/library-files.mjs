import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { insideRoot } from "./local-media.mjs";

export function matchM3u(text, filename, manager) {
  if (
    typeof text !== "string" ||
    text.length > 2 * 1024 * 1024 ||
    text.includes("\0")
  )
    throw new Error(
      "This playlist is too large or is not a UTF-8 M3U playlist.",
    );
  const indexed = new Map(
    manager.store
      .tracks()
      .map((t) => [path.resolve(t.path).toLowerCase(), t.id]),
  );
  const ids = [],
    unresolved = [];
  for (const line of text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"))) {
    let location = line;
    if (/^file:\/\//i.test(location)) {
      try {
        location = fileURLToPath(location);
      } catch {
        unresolved.push(line);
        continue;
      }
    } else if (/^[a-z]+:\/\//i.test(line)) {
      unresolved.push(line);
      continue;
    }
    const id = indexed.get(
      path.resolve(path.dirname(filename), location).toLowerCase(),
    );
    if (id) ids.push(id);
    else unresolved.push(line);
  }
  return { ids, unresolved };
}
export function importM3u(text, filename, manager) {
  const { ids, unresolved } = matchM3u(text, filename, manager);
  const playlist = manager.playlist({
    name: path.basename(filename, path.extname(filename)),
    tracks: ids,
  });
  return { playlist, unresolved };
}
export function exportM3u(playlist, manager) {
  const ids = playlist.rule
    ? manager
        .tracks()
        .filter((t) => manager.matches(t, playlist.rule))
        .map((t) => t.id)
    : playlist.tracks;
  const tracks = manager.resolve(ids);
  return [
    "#EXTM3U",
    ...tracks.flatMap((t) => [
      `#EXTINF:${Math.round(t.duration || -1)},${`${t.artist} - ${t.title}`.replace(/[\r\n]/g, " ")}`,
      t.path.replace(/[\r\n]/g, " "),
    ]),
    "",
  ].join("\r\n");
}
export class LibraryRelink {
  constructor(store) {
    this.store = store;
    this.plans = new Map();
  }
  async review(oldRoot, newRoot) {
    if (!this.store.get("folders", []).includes(oldRoot))
      throw new Error("Choose an indexed music folder.");
    const root = await realpath(newRoot),
      files = this.store.files(),
      mappings = [],
      missing = [];
    if (root.toLowerCase() === oldRoot.toLowerCase())
      throw new Error(
        "This is already the indexed location. Reconnect the drive and rescan instead.",
      );
    for (const track of this.store.tracks().filter((t) => t.root === oldRoot)) {
      const candidate = path.join(root, path.relative(oldRoot, track.path));
      try {
        const file = await realpath(candidate);
        if (
          !insideRoot(root, file) ||
          !(await stat(file)).isFile() ||
          (await stat(file)).size !== files.get(track.path).size
        ) {
          missing.push(track.title);
          continue;
        }
        const conflict = this.store.db
          .prepare("SELECT id FROM track_ids WHERE path=?")
          .get(candidate);
        if (conflict && conflict.id !== track.id)
          throw new Error(
            "This location already has indexed track identities. Add it separately instead.",
          );
        mappings.push({ track, candidate });
      } catch (e) {
        if (e.message.includes("already has indexed")) throw e;
        missing.push(track.title);
      }
    }
    const token = randomUUID();
    this.plans.clear();
    this.plans.set(token, {
      oldRoot,
      root,
      mappings,
      expires: Date.now() + 600000,
    });
    return {
      token,
      oldRoot,
      newRoot: root,
      matched: mappings.length,
      missing: missing.length,
      examples: missing.slice(0, 10),
    };
  }
  apply(token) {
    const plan = this.plans.get(token);
    if (
      !plan ||
      plan.expires < Date.now() ||
      !this.store.get("folders", []).includes(plan.oldRoot)
    )
      throw new Error("Review this folder mapping again.");
    if (!plan.mappings.length)
      throw new Error(
        "No matching indexed files were found. Choose another location.",
      );
    this.store.db.exec("BEGIN");
    try {
      for (const { track, candidate } of plan.mappings) {
        const next = { ...track, path: candidate, root: plan.root };
        this.store.db
          .prepare("UPDATE track_ids SET path=?,data=? WHERE id=?")
          .run(candidate, JSON.stringify(next), track.id);
        this.store.db
          .prepare("UPDATE tracks SET path=?,root=?,data=? WHERE path=?")
          .run(candidate, plan.root, JSON.stringify(next), track.path);
      }
      // Unmatched entries remain in track_ids for playlist recovery, not as playable files.
      this.store.db
        .prepare("DELETE FROM tracks WHERE root=?")
        .run(plan.oldRoot);
      this.store.set(
        "folders",
        this.store
          .get("folders", [])
          .map((r) => (r === plan.oldRoot ? plan.root : r)),
      );
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    this.plans.delete(token);
    return { matched: plan.mappings.length, newRoot: plan.root };
  }
}
