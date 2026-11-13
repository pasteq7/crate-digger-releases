import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
export async function importRoutes(root) {
  if (!root) return { root: "", folders: [], truncated: false };
  root = await realpath(root);
  const folders = [],
    queue = [{ dir: root, depth: 0 }];
  while (queue.length && folders.length < 500) {
    const { dir, depth } = queue.shift();
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        entry.name.startsWith(".")
      )
        continue;
      const full = path.join(dir, entry.name),
        resolved = await realpath(full).catch(() => "");
      const rel = resolved && path.relative(root, resolved);
      if (!resolved || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      folders.push(path.relative(root, full));
      if (depth < 2) queue.push({ dir: full, depth: depth + 1 });
      if (folders.length >= 500) break;
    }
  }
  return { root, folders, truncated: folders.length >= 500 };
}
