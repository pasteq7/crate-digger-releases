import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { Store } from "../electron/store.mjs";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/youtube-desktop-"));
const root = path.join(profile, "Music");
const item = {
  id: "album:test-youtube",
  kind: "album",
  artist: "Beach House",
  title: "Bloom",
  album: "Bloom",
  genre: "Dream Pop",
  year: 2012,
  preview: null,
  previewTrack: "Myth",
  cover: "",
  reason: "An unverified test recommendation.",
  seeds: ["Slowdive"],
  sourceFolder: "Dream Pop",
  origin: "ai",
  catalogVerified: false,
};
const store = new Store(path.join(profile, "crate-digger.sqlite"));
store.set("folders", [root]);
store.set("settings", {
  autoScan: false,
  view: "wishlist",
  ai: "none",
  scope: "all",
});
store.track(
  {
    path: path.join(root, "Slowdive", "Souvlaki", "Alison.flac"),
    root,
    folder: "Slowdive/Souvlaki",
    title: "Alison",
    artist: "Slowdive",
    album: "Souvlaki",
    genre: "Dream Pop",
    year: 1993,
  },
  { mtimeMs: 1, size: 1 },
);
store.shelf(item.id, {
  item,
  status: "wishlist",
  added: new Date().toISOString(),
});
store.close();
const env = { ...process.env, CRATE_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ["."],
  cwd: process.cwd(),
  env,
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const embeds = [];
  await page.route("https://www.youtube.com/embed/**", async (route) => {
    embeds.push(route.request().url());
    await route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="background:#151516;color:white;font:18px sans-serif"><p>Isolated YouTube embed fixture</p><button>Play video fixture</button></body></html>',
    });
  });
  await app.evaluate(() => {
    globalThis.youtubeCalls = [];
    globalThis.fetch = async (url, options) => {
      const u = new URL(String(url));
      if (u.hostname !== "www.googleapis.com")
        throw new Error("Unexpected request");
      globalThis.youtubeCalls.push({
        method: u.pathname,
        query: u.searchParams.get("q"),
        key: options.headers["X-Goog-Api-Key"],
      });
      if (globalThis.failYoutube)
        return {
          ok: false,
          json: async () => ({
            error: {
              message: "dummy-youtube-key",
              errors: [{ reason: "quotaExceeded" }],
            },
          }),
        };
      if (u.pathname.endsWith("/search"))
        return {
          ok: true,
          json: async () => ({ items: [{ id: { videoId: "ABCDEFGHIJK" } }] }),
        };
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "ABCDEFGHIJK",
              snippet: {
                title: "Beach House - Bloom (Full Album)",
                channelTitle: "Beach House",
                liveBroadcastContent: "none",
              },
              contentDetails: { duration: "PT49M" },
              status: { embeddable: true, privacyStatus: "public" },
            },
          ],
        }),
      };
    };
  });
  await expect(page.locator(".record-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Bloom", exact: true }).click();
  await expect(page.locator(".unverified-note")).toContainText(
    "Unverified AI suggestion",
  );
  await page
    .getByRole("button", { name: "Find on YouTube", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Search YouTube", exact: true }),
  ).toBeDisabled();
  expect(await app.evaluate(() => globalThis.youtubeCalls.length)).toBe(0);
  await modal
    .getByLabel("YouTube video link")
    .fill("https://youtube.com.evil.test/watch?v=ABCDEFGHIJK");
  await modal.getByRole("button", { name: "Load video", exact: true }).click();
  await expect(modal.getByRole("status")).toContainText("Paste a valid");
  await expect(modal.locator("iframe")).toHaveCount(0);
  await modal
    .getByLabel("YouTube video link")
    .fill("https://youtu.be/ABCDEFGHIJK?t=30");
  await modal.getByRole("button", { name: "Load video", exact: true }).click();
  await expect(modal.locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube.com/embed/ABCDEFGHIJK?playsinline=1&autoplay=0",
  );
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("button", { name: "Play video fixture" }),
  ).toBeVisible();
  expect(
    await modal
      .locator("iframe")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(200);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Find on YouTube", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Find on YouTube", exact: true })
    .click();
  await modal.getByRole("button", { name: "add a YouTube API key" }).click();
  await expect(page.locator("#settings-youtube")).toBeVisible();
  await page
    .getByLabel("YouTube Data API key", { exact: true })
    .fill("dummy-youtube-key");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(
    page.getByLabel("YouTube Data API key", { exact: true }),
  ).toHaveValue("");
  const settings = await page.evaluate(() =>
    window.crate.state().then((s) => s.settings),
  );
  expect(settings.hasYoutubeKey).toBe(true);
  expect(JSON.stringify(settings)).not.toContain("dummy-youtube-key");
  const encryptedStore = new Store(path.join(profile, "crate-digger.sqlite"));
  expect(encryptedStore.get("youtubeKey", "")).not.toContain(
    "dummy-youtube-key",
  );
  expect(encryptedStore.get("youtubeKey", "").length).toBeGreaterThan(0);
  encryptedStore.close();
  expect(await app.evaluate(() => globalThis.youtubeCalls.length)).toBe(0);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  await page
    .getByRole("button", { name: "YouTube for Bloom", exact: true })
    .click();
  await expect(modal).toBeVisible();
  await modal
    .getByRole("button", { name: "Search YouTube", exact: true })
    .click();
  await expect(modal.locator(".youtube-results > button")).toHaveCount(1);
  await expect(modal.locator("iframe")).toHaveCount(0);
  await modal.locator(".youtube-results > button").click();
  await expect(modal.locator("iframe")).toBeVisible();
  expect(
    await page
      .locator("audio")
      .first()
      .evaluate((el) => el.paused),
  ).toBe(true);
  await page.screenshot({
    path: path.resolve("artifacts/youtube-preview.png"),
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].minimize(),
  );
  await expect(modal.locator("iframe")).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.restore();
    win.focus();
  });
  await expect(modal.locator("iframe")).toHaveCount(0);
  await modal
    .getByRole("button", { name: "Reload video", exact: true })
    .click();
  await expect(modal.locator("iframe")).toBeVisible();
  await expect(modal.locator("iframe")).toHaveAttribute("src", /autoplay=0/);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: path.resolve("artifacts/youtube-preview-compact.png"),
  });
  await modal
    .getByRole("button", { name: "Search YouTube", exact: true })
    .click();
  await expect(modal.locator(".youtube-results > button")).toHaveCount(1);
  expect(await app.evaluate(() => globalThis.youtubeCalls.length)).toBe(2);
  await app.evaluate(() => {
    globalThis.failYoutube = true;
  });
  await modal
    .getByRole("button", { name: "Search suggested track", exact: true })
    .click();
  await expect(modal.getByRole("status")).toContainText("quota reached");
  await expect(modal.getByRole("status")).not.toContainText(
    "dummy-youtube-key",
  );
  await modal.getByRole("button", { name: "Close YouTube player" }).click();
  // Remote embed frames must not inherit the sandbox preload bridge.
  await page
    .getByRole("button", { name: "YouTube for Bloom", exact: true })
    .click();
  await modal
    .getByLabel("YouTube video link")
    .fill("https://youtu.be/ABCDEFGHIJK");
  await modal.getByRole("button", { name: "Load video", exact: true }).click();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("button", { name: "Play video fixture" }),
  ).toBeVisible();
  const remote = page
    .frames()
    .find((frame) => frame.url().startsWith("https://www.youtube.com/embed/"));
  expect(await remote.evaluate(() => typeof window.crate)).toBe("undefined");
  expect(embeds.length).toBeGreaterThan(0);
  await modal.getByRole("button", { name: "Close YouTube player" }).click();
  await page.evaluate(() => window.crate.settings({ youtubeKey: "" }));
  expect(
    (await page.evaluate(() => window.crate.state())).settings.hasYoutubeKey,
  ).toBe(false);
  expect(errors).toEqual([]);
  console.log(
    "PASS YouTube manual links without a key, encrypted settings, on-demand search/cache, explicit video selection, sandboxed embeds, no simultaneous audio, hidden playback stop, compact layout, quota handling and key removal",
  );
} finally {
  await app.close();
}
const saved = new Store(path.join(profile, "crate-digger.sqlite"));
expect(saved.get("youtubeKey", null)).toBe(null);
expect(JSON.stringify(saved.get("settings", {}))).not.toContain(
  "dummy-youtube-key",
);
saved.close();
