import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Store } from "../electron/store.mjs";
import { Scanner } from "../electron/scanner.mjs";

await mkdir(".test-data", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/codecs-"));
const root = path.join(profile, "Generated audio");
await mkdir(root);
// Local tooling creates fixtures only; FFmpeg is not a runtime app dependency.
for (const ext of [
  "wav",
  "flac",
  "mp3",
  "m4a",
  "ogg",
  "opus",
  "aiff",
  "wma",
  "wv",
]) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=3",
      "-metadata",
      `title=Tone ${ext}`,
      "-metadata",
      "artist=Generated fixture",
      "-metadata",
      "album=Codec fixtures",
      "-y",
      path.join(root, `Tone ${ext}.${ext}`),
    ],
    { windowsHide: true },
  );
  if (result.status !== 0)
    throw new Error(
      result.stderr?.toString() ||
        "Install FFmpeg to generate codec fixtures for this optional check.",
    );
}
const store = new Store(path.join(profile, "crate-digger.sqlite"));
store.set("folders", [root]);
store.set("settings", { view: "library", autoScan: false });
await new Scanner(store, () => {}).scan([root]);
store.close();
const env = { ...process.env, CRATE_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ["."],
  cwd: process.cwd(),
  env,
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page
    .getByRole("combobox", { name: "Library view" })
    .selectOption("tracks");
  const results = [];
  const { tracks } = await page.evaluate(() =>
    window.crate.libraryQuery({ limit: 100 }),
  );
  for (const t of tracks) {
    const supported = await page.evaluate(async (url) => {
      const audio = new Audio(url);
      return await new Promise((resolve) => {
        const finish = (value) => {
          clearTimeout(timeout);
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          resolve(value);
        };
        const timeout = setTimeout(() => finish(false), 8000);
        audio.addEventListener("error", () => finish(false), { once: true });
        audio.addEventListener("timeupdate", () => {
          if (audio.currentTime > 0.1) finish(true);
        });
        void audio.play().catch(() => finish(false));
      });
    }, t.mediaUrl);
    const format = path.extname(t.path).slice(1);
    results.push({ format, supported });
    if (["wav", "flac", "mp3", "m4a", "ogg", "opus"].includes(format))
      expect(supported, `${format} playback`).toBe(true);
  }
  const audioUrl = tracks.find((t) => t.path.endsWith(".wav")).mediaUrl;
  const range = await page.evaluate(async (url) => {
    const response = await fetch(url, { headers: { Range: "bytes=44-83" } });
    return {
      status: response.status,
      bytes: (await response.arrayBuffer()).byteLength,
      range: response.headers.get("Content-Range"),
    };
  }, audioUrl);
  expect(range.status).toBe(206);
  expect(range.bytes).toBe(40);
  await mkdir("artifacts/quiet-collection", { recursive: true });
  await writeFile(
    "artifacts/quiet-collection/codec-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(
    "PASS generated codec matrix and real Electron streaming/byte ranges",
    results,
  );
} finally {
  await app.close();
}
