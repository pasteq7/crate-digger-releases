import type { State } from "./types";

export function folderOptions(state: State) {
  const paths = new Map<string, string>();
  for (const root of state.folders) {
    const name = root.split(/[\\/]/).filter(Boolean).at(-1) || root;
    paths.set(root, name);
    for (const track of state.tracks.filter((t) => t.root === root)) {
      const parts = track.folder.split(/[\\/]/).filter(Boolean);
      for (let depth = 1; depth <= parts.length; depth++) {
        const relative = parts.slice(0, depth);
        const path =
          root +
          (root.includes("\\") ? "\\" : "/") +
          relative.join(root.includes("\\") ? "\\" : "/");
        paths.set(path, `${name} / ${relative.join(" / ")}`);
      }
    }
  }
  return [...paths]
    .map(([path, label]) => ({ path, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
