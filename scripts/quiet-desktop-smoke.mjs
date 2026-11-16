import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Store } from "../electron/store.mjs";
import { Scanner } from "../electron/scanner.mjs";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts/quiet-collection", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/quiet-"));
const root = path.join(profile, "Music");
const files = [];
const wave = Buffer.alloc(480044);
wave.write("RIFF");
wave.writeUInt32LE(wave.length - 8, 4);
wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(8000, 24);
wave.writeUInt32LE(16000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write("data", 36);
wave.writeUInt32LE(wave.length - 44, 40);
for (const [i, name] of [
  "Souvlaki",
  "Bloom",
  "Deceiver",
  "Apollo",
  "Nowhere",
  "Treasure",
  "Loveless",
  "Disintegration",
  "Mezzanine",
  "Geogaddi",
  "Moon Safari",
  "Vespertine",
].entries()) {
  const dir = path.join(
    root,
    [
      "Slowdive",
      "Beach House",
      "DIIV",
      "Brian Eno",
      "Ride",
      "Cocteau Twins",
      "My Bloody Valentine",
      "The Cure",
      "Massive Attack",
      "Boards of Canada",
      "Air",
      "Björk",
    ][i],
    `1993 - ${name}`,
  );
  await mkdir(dir, { recursive: true });
  for (const title of ["01 Alison", "02 Second Song", "03 Third Song"]) {
    const file = path.join(dir, `${title}.wav`);
    await writeFile(file, wave);
    files.push(file);
  }
}
const digest = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const before = await Promise.all(files.map(digest));
const store = new Store(path.join(profile, "crate-digger.sqlite"));
store.set("folders", [root]);
store.set("settings", {
  view: "library",
  autoScan: false,
  ai: "none",
  engine: "catalog",
});
await new Scanner(store, () => {}).scan([root]);
store.close();
const env = { ...process.env, CRATE_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".library-album")).toHaveCount(12);
  return page;
}
try {
  let page = await launch();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Search music" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".library-content > h1")
      .evaluate((heading) => heading.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(1);
  const bounds = await page.locator(".library-cover").first().boundingBox();
  expect(bounds.y).toBeLessThan(135);
  await page.screenshot({ path: "artifacts/quiet-collection/library.png" });
  await page
    .getByRole("button", { name: "Open Souvlaki", exact: true })
    .click();
  await expect(page.locator(".album-inline-tracks li")).toHaveCount(3);
  await expect(page.locator(".library-album")).toHaveCount(12);
  await page.getByRole("button", { name: "Play Alison", exact: true }).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('[data-testid="local-audio"]');
    return audio && !audio.paused && audio.currentTime > 0.2;
  });
  const initialQueue = await page.evaluate(() => window.crate.libraryState());
  await expect(
    page.getByRole("button", { name: "Pause music", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search music" }).fill("Beach House");
  await expect(page.locator(".library-tracks tbody tr")).toHaveCount(3);
  await expect(page.locator(".local-now")).toContainText("Slowdive");
  await page.getByRole("button", { name: "Clear search" }).click();
  await page
    .getByRole("button", { name: "Toggle queue", exact: true })
    .first()
    .click();
  await expect(page.locator(".queue-list li")).toHaveCount(3);
  await page.screenshot({ path: "artifacts/quiet-collection/queue.png" });
  await page.getByRole("button", { name: "Close queue" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("button"),
  ).toHaveCount(6);
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ink");
  await page.getByRole("button", { name: "Apply appearance" }).click();
  await page.screenshot({
    path: "artifacts/quiet-collection/settings-ink.png",
  });
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page
    .getByLabel("Palette name", { exact: true })
    .fill("My night palette");
  await page.getByRole("button", { name: "Save palette", exact: true }).click();
  await page.getByRole("button", { name: "Apply appearance" }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.crate.state())).settings.appearance
          .custom.length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.locator("#settings-connections")).toContainText(
    "Choose the services you use",
  );
  await page
    .locator("#settings-connections .setting-row")
    .last()
    .getByRole("button", { name: /Manage/ })
    .click();
  await page
    .getByLabel("Program command", { exact: true })
    .fill('"C:\\Example\\tool.exe" {url}');
  await page
    .getByRole("button", { name: "Library", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Unsaved connection" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard and continue" }).click();
  await expect(page.locator(".library-album")).toHaveCount(12);
  await page.getByRole("button", { name: "New playlist", exact: true }).click();
  await page.getByLabel("Playlist name", { exact: true }).fill("Late nights");
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(page.locator(".sidebar-playlists")).toContainText("Late nights");
  await page
    .getByRole("button", { name: "Library", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tasks-drawer")).not.toContainText("Total tokens");
  await page.getByRole("button", { name: "Close tasks" }).click();
  // The persisted queue is independent of navigation and global searching.
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.crate.libraryState())).playback?.queue
          .length,
    )
    .toBe(3);
  await page.getByRole("button", { name: "Pause music", exact: true }).click();
  await page.getByRole("slider", { name: "Seek music", exact: true }).fill("8");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Close tasks" }).click();
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => window.crate.libraryState());
  expect(saved.playback.queue).toHaveLength(3);
  expect(saved.playback.position).toBeGreaterThanOrEqual(7.8);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  await page.screenshot({ path: "artifacts/quiet-collection/compact.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await app.close();
  page = await launch();
  await expect(page.locator("html")).toHaveAttribute(
    "data-palette",
    /^custom-/,
  );
  await expect(page.locator(".sidebar-playlists")).toContainText("Late nights");
  await expect(
    page.getByRole("button", { name: "Play music", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator('[data-testid="local-audio"]')
      .evaluate((audio) => audio.paused),
  ).toBe(true);
  await page.getByRole("button", { name: "Play music", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="local-audio"]').currentTime >= 8,
  );
  await page.getByRole("button", { name: "Mini player", exact: true }).click();
  await expect(page.locator(".quiet-shell")).toHaveClass(/mini-mode/);
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getBounds().width,
      ),
    )
    .toBe(480);
  await page.screenshot({ path: "artifacts/quiet-collection/mini-player.png" });
  await page
    .getByRole("button", { name: "Expand player", exact: true })
    .click();
  await expect(page.locator(".quiet-shell")).not.toHaveClass(/mini-mode/);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Playback", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Crossfade", exact: true })
    .selectOption("2");
  await page
    .getByRole("button", { name: "Library", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Open Souvlaki", exact: true })
    .click();
  await page.getByRole("button", { name: "Play Alison", exact: true }).click();
  await page
    .getByRole("slider", { name: "Seek music", exact: true })
    .fill("28");
  await expect(page.locator(".local-now strong")).toHaveText("Second Song", {
    timeout: 10000,
  });
  await page
    .getByRole("slider", { name: "Seek music", exact: true })
    .fill("28");
  await expect(page.locator(".local-now strong")).toHaveText("Third Song", {
    timeout: 10000,
  });
  await expect(
    page.getByRole("button", { name: "Pause music", exact: true }),
  ).toBeVisible();
  await page.getByRole("slider", { name: "Seek music", exact: true }).fill("6");
  const previewQueue = (await page.evaluate(() => window.crate.libraryState()))
    .playback.queue;
  await page.evaluate(async () => {
    const track = (await window.crate.libraryQuery()).tracks[0];
    await window.crate.shelf(
      {
        id: "generated-preview",
        kind: "album",
        artist: "Discovery fixture",
        title: "Preview record",
        album: "Preview record",
        genre: "Ambient",
        year: 2020,
        cover: "",
        preview: track.mediaUrl,
        previewTitle: "Preview song",
        previewSource: "apple",
        reason: "Generated preview fixture",
        seeds: [],
        sourceFolder: "",
      },
      "wishlist",
    );
    window.dispatchEvent(new Event("crate-library-changed"));
  });
  await page
    .getByRole("button", { name: /Wishlist/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Preview Preview record", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="preview-audio"]').paused,
  );
  await page
    .getByRole("button", { name: "Return to your music", exact: true })
    .click();
  await expect(page.locator(".local-now strong")).toHaveText("Third Song");
  expect(
    await page
      .locator('[data-testid="preview-audio"]')
      .evaluate((audio) => audio.paused),
  ).toBe(true);
  expect(
    (await page.evaluate(() => window.crate.libraryState())).playback.queue,
  ).toEqual(previewQueue);
  expect(errors).toEqual([]);
  expect(await Promise.all(files.map(digest))).toEqual(before);
  console.log(
    "PASS content-only library, full local playback, stable queue, global search, themes/custom palettes, six-category settings, unsaved connection guard, playlists, Tasks, paused restoration, mini player, crossfade, preview return, compact layout, and read-only music",
  );
} finally {
  await app?.close();
}
