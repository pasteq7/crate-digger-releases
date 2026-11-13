import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { Store } from "../electron/store.mjs";
import { Discovery } from "../electron/discovery.mjs";
await mkdir(".test-data", { recursive: true });
const dir = await mkdtemp(path.resolve(".test-data/preview-check-"));
const store = new Store(path.join(dir, "cache.sqlite"));
const discovery = new Discovery(store, null, "FR");
try {
  let found = 0;
  for (const [artist, album] of [
    ["DIIV", "Deceiver"],
    ["Beach House", "Bloom"],
    ["Nothing", "Tired of Tomorrow"],
    ["Grouper", "Dragging a Dead Deer Up a Hill"],
    ["Ride", "Going Blank Again"],
  ]) {
    const result = await discovery.resolveAlbum(artist, album);
    if (result?.preview) found++;
    console.log(
      JSON.stringify({
        artist,
        album,
        verified: !!result,
        preview: !!result?.preview,
        track: result?.previewTitle || null,
      }),
    );
  }
  console.log(
    `${found}/5 representative releases have a matching preview in the French catalog.`,
  );
  if (!found) process.exitCode = 1;
} finally {
  store.close();
}
