import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { Store } from "../electron/store.mjs";
import { LibraryManager } from "../electron/library-manager.mjs";
import { LocalMedia } from "../electron/local-media.mjs";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts/collection", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/collection-"));
const root = path.join(profile, "Music");
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
function chunk(type, data) {
  const value = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, value, tail]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(32);
ihdr.writeUInt32BE(32, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const pixels = Buffer.alloc(32 * 97);
for (let y = 0; y < 32; y++)
  for (let x = 0; x < 32; x++) pixels.set([16, 154, 128], y * 97 + 1 + x * 3);
const art = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(pixels)),
  chunk("IEND", Buffer.alloc(0)),
]);
const store = new Store(path.join(profile, "crate-digger.sqlite"));
store.set("folders", [root]);
store.set("settings", {
  view: "library",
  autoScan: false,
  ai: "none",
  engine: "catalog",
});
const files = [];
for (let album = 0; album < 8; album++) {
  const folder = `Album ${album}`;
  const dir = path.join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "cover.png"), art);
  for (let number = 1; number <= 20; number++) {
    const title = `${String(number).padStart(2, "0")} Song ${album}`;
    const file = path.join(dir, `${title}.wav`);
    await writeFile(file, wave);
    files.push(file);
    store.track(
      {
        path: file,
        root,
        folder,
        title,
        artist: album < 4 ? "Artist A" : "Artist B",
        albumArtist: album < 4 ? "Artist A" : "Artist B",
        album: folder,
        genre: album % 2 ? "Rock" : "Ambient",
        year: album % 2 ? 2001 : 1993,
        duration: 30,
        trackNumber: number,
        discNumber: 1,
        metadataVersion: 2,
      },
      await stat(file),
    );
  }
}
const manager = new LibraryManager(store, new LocalMedia(store));
manager.update([store.tracks().find((t) => t.path === files.at(-1)).id], {
  favorite: true,
  rating: 5,
});
store.close();
const exported = path.join(root, "MusicBee loved.m3u8");
await writeFile(
  exported,
  `#EXTM3U\n${files.slice(0, 140).join("\n")}\nmissing.wav\nhttps://example.com/unmatched.mp3\n`,
);
const digest = async () =>
  createHash("sha256")
    .update(
      Buffer.concat(
        await Promise.all([...files, exported].map((file) => readFile(file))),
      ),
    )
    .digest("hex");
const before = await digest();
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
  await expect(page.locator(".library-album")).toHaveCount(8);
  return page;
}
try {
  let page = await launch();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1100, 850),
  );
  const filters = () =>
    page
      .locator(".toolbar-popover")
      .filter({ has: page.locator("summary").filter({ hasText: /^Filters/ }) });
  await filters().locator("summary").click();
  for (const width of [1100, 780]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setSize(width, 850),
      width,
    );
    await expect
      .poll(() =>
        filters()
          .locator(".popover-panel")
          .evaluate((panel) => {
            const r = panel.getBoundingClientRect();
            const points = [
              [r.left + 5, r.top + 5],
              [r.right - 5, r.top + 5],
              [r.left + 5, r.bottom - 5],
            ];
            return (
              r.left >= 0 &&
              r.right <= innerWidth &&
              points.every(([x, y]) =>
                panel.contains(document.elementFromPoint(x, y)),
              )
            );
          }),
      )
      .toBe(true);
  }
  await page.screenshot({ path: "artifacts/collection/filters-780.png" });
  await page.keyboard.press("Escape");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 900),
  );
  await page.getByRole("button", { name: "Open Album 0", exact: true }).click();
  await expect(page.locator(".album-inline-tracks li")).toHaveCount(20);
  await expect(page.locator(".library-album")).toHaveCount(8);
  await expect(
    page.getByRole("combobox", { name: "Library view", exact: true }),
  ).toHaveValue("albums");
  await expect
    .poll(() =>
      page
        .locator(".album-expansion")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe("rgb(7, 64, 53)");
  await expect(
    page.getByRole("button", { name: "Play liked", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "artifacts/collection/inline-album.png" });
  await page.getByRole("button", { name: "Close album", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Album 0", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Library", exact: true })
    .last()
    .click();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, exported);
  await page
    .getByRole("button", { name: "Import liked tracks", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Review liked tracks" }),
  ).toContainText("140 matched · 0 already liked · 2 unresolved paths");
  expect(
    (await page.evaluate(() => window.crate.libraryQuery({ favorite: true })))
      .total,
  ).toBe(1);
  await page.screenshot({ path: "artifacts/collection/import-review.png" });
  await page.getByRole("button", { name: "Import likes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh likes from MusicBee loved" }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.crate.libraryQuery({ favorite: true })))
      .total,
  ).toBe(141);
  await page
    .getByRole("button", { name: "Refresh likes from MusicBee loved" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "140 matched · 140 already liked",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "About & updates", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Explore sample", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Library", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Show liked tracks only", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Library view", exact: true })
    .selectOption("tracks");
  await expect(page.locator(".library-tracks tbody tr")).toHaveCount(120);
  await page
    .getByRole("button", { name: "Play displayed tracks", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.crate.libraryState())).playback?.queue
          .length,
    )
    .toBe(141);
  await page
    .getByRole("combobox", { name: "Library view", exact: true })
    .selectOption("albums");
  await page.getByRole("button", { name: "Open Album 0", exact: true }).click();
  await page
    .getByRole("button", { name: "Favorite 01 Song 0", exact: true })
    .click();
  await expect(page.locator(".album-inline-tracks li")).toHaveCount(19);
  await page
    .getByRole("button", { name: "Play liked · 19", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.crate.libraryState())).playback?.queue
          .length,
    )
    .toBe(19);
  await filters().locator("summary").click();
  await page
    .getByLabel("Library genre", { exact: true })
    .selectOption("Ambient");
  await page
    .getByLabel("Library artist", { exact: true })
    .selectOption("Artist A");
  await page.getByLabel("Library year", { exact: true }).selectOption("1993");
  await page.keyboard.press("Escape");
  await expect(page.locator(".library-album")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Shuffle displayed tracks", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.crate.libraryState())).playback?.queue
          .length,
    )
    .toBe(39);
  const queue = await page.evaluate(async () => {
    const { playback } = await window.crate.libraryState();
    return window.crate.libraryResolve(playback.queue);
  });
  expect(
    queue.every(
      (t) =>
        t.favorite &&
        t.artist === "Artist A" &&
        t.year === 1993 &&
        t.genre === "Ambient",
    ),
  ).toBe(true);
  await filters().locator("summary").click();
  await page
    .getByRole("button", { name: "Clear all filters", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".library-album")).toHaveCount(8);
  await page.evaluate(() => localStorage.setItem("crate-demo", "true"));
  await app.close();
  page = await launch();
  await expect(page.locator(".demo-note")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("crate-demo"))).toBe(
    "false",
  );
  expect(
    (await page.evaluate(() => window.crate.libraryQuery({ favorite: true })))
      .total,
  ).toBe(140);
  expect(await digest()).toBe(before);
  await app.close();
  const emptyProfile = await mkdtemp(path.resolve(".test-data/sample-exit-"));
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...env, CRATE_DATA_DIR: emptyProfile },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", {
      name: /take a look around with a sample collection/,
    })
    .click();
  await expect(page.locator(".demo-note")).toBeVisible();
  await page
    .getByRole("button", { name: "Leave sample collection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Choose your music folder", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-note")).toHaveCount(0);
  expect((await page.evaluate(() => window.crate.state())).folders).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    "PASS visible filters at 780/1100px, inline artwork colors, reviewed and refreshed likes, all-page scoped playback, sample-mode recovery, read-only music/exports",
  );
} finally {
  await app?.close();
}
