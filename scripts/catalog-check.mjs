import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { Store } from "../electron/store.mjs";
import { Discovery } from "../electron/discovery.mjs";
await mkdir(".test-data", { recursive: true });
const dir = await mkdtemp(path.resolve(".test-data/catalog-"));
const store = new Store(path.join(dir, "library.sqlite"));
store.track(
  {
    path: "test-fixture",
    root: "test-fixture",
    folder: "",
    artist: "Slowdive",
    album: "Souvlaki",
    title: "Alison",
    genre: "Shoegaze",
    year: 1993,
  },
  { mtimeMs: 1, size: 1 },
);
try {
  const r = await new Discovery(store).recommend({
    scope: "all",
    mode: "safe",
    offset: 0,
    kind: "album",
    gaps: false,
  });
  console.log(
    JSON.stringify(
      {
        count: r.items.length,
        previews: r.items.filter((i) => i.preview).length,
        message: r.message,
        warning: r.warning,
        examples: r.items
          .slice(0, 3)
          .map((i) => ({
            artist: i.artist,
            title: i.title,
            hasPreview: !!i.preview,
            hasArtwork: !!i.cover,
            reason: i.reason,
          })),
      },
      null,
      2,
    ),
  );
  if (!r.items.length) process.exitCode = 1;
} finally {
  store.close();
}
