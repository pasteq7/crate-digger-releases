import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  copyFile,
  readFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { largeLibraryFixture } from "./large-library-fixture.mjs";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts/player-workflows", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/player-workflows-"));
const fixture = await largeLibraryFixture(profile, 1500);
const late = fixture.store.tracks().find((t) => t.title === "Track 001499");
await mkdir(path.dirname(late.path), { recursive: true });
await copyFile(fixture.tracks[0].path, late.path);
const second = path.join(profile, "Second root");
await mkdir(second);
const ape = path.join(second, "Generated.ape"),
  wav = path.join(second, "Original.wav");
const packaged = process.argv.includes("--packaged");
const packageDir = path.resolve(
  process.env.CRATE_PACKAGE_DIR || "release/win-unpacked",
);
const dll = packaged
  ? path.join(packageDir, "resources/ape/MACDll64.dll")
  : path.resolve("build/ape/MACDll64.dll");
const python =
  process.env.CRATE_PYTHON ||
  (existsSync("C:/Python312/python.exe")
    ? "C:/Python312/python.exe"
    : "python");
const generated = spawnSync(python, ["scripts/ape-fixture.py", dll, wav, ape], {
  windowsHide: true,
});
if (generated.status !== 0)
  throw new Error(
    generated.stderr?.toString() || "Build the APE decoder first.",
  );
fixture.store.set("folders", [fixture.root, second]);
fixture.store.track(
  {
    path: ape,
    root: second,
    folder: "",
    title: "Generated APE",
    artist: "APE Artist",
    albumArtist: "APE Artist",
    album: "APE album",
    genre: "Ambient",
    year: 2026,
    duration: 30,
    sampleRate: 8000,
    bitsPerSample: 16,
    format: "Monkey's Audio",
    trackNumber: 1,
    added: Date.now(),
  },
  await stat(ape),
);
const apeId = fixture.store.tracks().find((t) => t.path === ape).id;
fixture.store.close();
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const before = await hash(ape),
  beforeLate = await hash(late.path);
const env = { ...process.env, CRATE_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.join(packageDir, "Crate Digger.exe"), args: [] }
    : { args: ["."], cwd: process.cwd() }),
  env,
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".library-album")).toHaveCount(120);
  const view = page.getByRole("combobox", {
    name: "Library view",
    exact: true,
  });
  await view.selectOption("folders");
  await expect(page.locator(".library-album")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Open Generated music", exact: true })
    .click();
  await expect(page.locator(".album-inline-tracks li")).toHaveCount(100);
  await expect(
    page.getByRole("navigation", { name: "Album track pages" }),
  ).toContainText("of 1500");
  await expect(view).toHaveValue("folders");
  await page.getByRole("button", { name: "Shuffle", exact: true }).click();
  await page
    .getByRole("button", { name: "Play Track 000001", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Shuffle", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".local-now strong")).toHaveText("Track 000001");
  await view.selectOption("artists");
  await expect(
    page.getByRole("region", { name: "Artist 0000 tracklist" }),
  ).toBeVisible();
  await expect(page.locator(".album-inline-tracks li")).toHaveCount(50);
  await expect(view).toHaveValue("artists");
  const search = page.getByRole("textbox", {
    name: "Search music",
    exact: true,
  });
  await search.fill("Track 001499");
  await expect(page.locator(".library-tracks tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Play Track 001499", exact: true })
    .click();
  await expect(page.locator(".local-now strong")).toHaveText("Track 001499");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await view.selectOption("albums");
  await expect(
    page.getByRole("region", { name: "Album 00149 tracklist" }),
  ).toBeVisible();
  await expect(
    page.locator(".album-inline-tracks .playing-track"),
  ).toContainText("Track 001499");
  await expect(
    page.getByRole("button", { name: "Previous library page", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Follow playing track", exact: true })
    .click();
  await view.selectOption("folders");
  await page
    .getByRole("button", {
      name: "Show current track in collection",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Generated music tracklist" }),
  ).toBeVisible();
  await expect(
    page.locator(".album-inline-tracks .playing-track"),
  ).toContainText("Track 001499");
  await expect(
    page.getByRole("navigation", { name: "Album track pages" }),
  ).toContainText("1401–1500");
  await expect
    .poll(() =>
      page.locator(".album-inline-tracks .playing-track").evaluate((row) => {
        const bounds = row.getBoundingClientRect();
        const top = document
          .querySelector(".context-toolbar")
          .getBoundingClientRect().bottom;
        const bottom = document
          .querySelector(".local-player")
          .getBoundingClientRect().top;
        return bounds.top >= top && bounds.bottom <= bottom;
      }),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Open Second root", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Second root tracklist" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Play Generated APE", exact: true })
    .click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('[data-testid="local-audio"]');
    return (
      audio && !audio.paused && audio.currentTime > 0.2 && audio.duration > 29
    );
  });
  await expect(
    page.getByRole("button", { name: "Shuffle", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("slider", { name: "Seek music", exact: true })
    .fill("12");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="local-audio"]').currentTime >= 12,
  );
  await page
    .getByRole("button", { name: "Current track metadata", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Track metadata" });
  await expect(
    dialog.getByRole("textbox", { name: "Track file location", exact: true }),
  ).toHaveValue(ape);
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Updated APE title");
  await dialog
    .getByRole("textbox", { name: "Genre", exact: true })
    .fill("Ambient; Jazz");
  await dialog
    .getByRole("spinbutton", { name: "Year", exact: true })
    .fill("2025");
  await dialog
    .getByRole("spinbutton", { name: "Track number", exact: true })
    .fill("3");
  await dialog
    .getByRole("spinbutton", { name: "Disc number", exact: true })
    .fill("2");
  await dialog
    .getByRole("button", { name: "Save metadata", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".local-now strong")).toHaveText(
    "Updated APE title",
  );
  const saved = (
    await page.evaluate((id) => window.crate.libraryResolve([id]), apeId)
  )[0];
  expect(saved).toMatchObject({
    title: "Updated APE title",
    genre: "Ambient; Jazz",
    year: 2025,
    trackNumber: 3,
    discNumber: 2,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Font size", exact: true })
    .selectOption("160");
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((el) => el.style.getPropertyValue("--font-scale")),
    )
    .toBe("1.6");
  await page
    .getByRole("button", { name: "Library", exact: true })
    .first()
    .click();
  await expect(page.locator(".album-caption strong").first()).toHaveCSS(
    "font-size",
    "20.8px",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/player-workflows/${packaged ? "packaged" : "desktop"}-font-160.png`,
  });
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((el) => el.style.getPropertyValue("--font-scale")),
    )
    .toBe("1.6");
  await expect(
    page.getByRole("button", { name: "Play music", exact: true }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.crate.libraryState())).playback.shuffle,
  ).toBe(true);
  expect(await hash(ape)).toBe(before);
  expect(await hash(late.path)).toBe(beforeLate);
  expect(errors).toEqual([]);
  await writeFile(
    `artifacts/player-workflows/${packaged ? "packaged" : "desktop"}-validation.json`,
    JSON.stringify(
      {
        roots: 2,
        indexedTracks: 1501,
        inlineArtistsAndRoots: true,
        followAcrossPages: true,
        shufflePreserved: true,
        fontScale: 160,
        metadataEditedInLibrary: true,
        apeFullPlaybackAndSeek: true,
        sourceHashesUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${packaged ? "packaged" : "desktop"} root/artist inline tracks, paged follow, shuffle retention, persistent text size, metadata editor, APE playback/seek and read-only audio`,
  );
} finally {
  await app.close();
}
