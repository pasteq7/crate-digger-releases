import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { Store } from "../electron/store.mjs";
import catalog from "../src/sample-catalog.json" with { type: "json" };

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts", { recursive: true });
const temp = await mkdtemp(path.resolve(".test-data/ai-desktop-")),
  profile = path.join(temp, "profile"),
  root = path.join(temp, "Music");
await mkdir(profile, { recursive: true });
const store = new Store(path.join(profile, "crate-digger.sqlite"));
store.set("folders", [root]);
store.set("settings", {
  autoScan: false,
  engine: "ai",
  ai: "none",
  view: "discover",
  scope: "genre:Shoegaze",
  mode: "adjacent",
});
for (const [artist, album, genre] of [
  ["Slowdive", "Souvlaki", "Shoegaze"],
  ["Ride", "Nowhere", "Shoegaze"],
  ["My Bloody Valentine", "Loveless", "Shoegaze"],
  ["Brian Eno", "Apollo", "Ambient"],
]) {
  const folder = path.join(genre, artist, album);
  store.track(
    {
      path: path.join(root, folder, "Track.flac"),
      root,
      folder,
      artist,
      album,
      title: "Track",
      genre,
      year: 1993,
    },
    { mtimeMs: 1, size: 1 },
  );
}
store.shelf("old-rejected", {
  item: {
    id: "old-rejected",
    artist: "Whirr",
    title: "Feels Like You",
    album: "Feels Like You",
    genre: "Shoegaze",
  },
  status: "rejected",
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
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.getByText("Find your next favorite.")).toBeVisible();
  await app.evaluate(({}, catalog) => {
    globalThis.discoveryAiCalls = [];
    globalThis.catalogCalls = [];
    globalThis.fetch = async (url, options = {}) => {
      const u = new URL(String(url));
      if (u.hostname === "generativelanguage.googleapis.com") {
        const body = JSON.parse(options.body);
        globalThis.discoveryAiCalls.push(body);
        if (globalThis.failDiscovery)
          return {
            ok: false,
            status: 429,
            json: async () => ({
              error: { message: "Quota exhausted for dummy-google-key" },
            }),
          };
        const context = JSON.parse(
          body.contents[0].parts[0].text
            .split("COLLECTION: ")[1]
            .split("\nPREVIOUS_SUGGESTIONS: ")[0],
        );
        const seed =
          context.albums.find((a) => a.album === "Souvlaki")?.id || 0;
        const pick = (artist, album) => ({
          artist,
          album,
          year: 2019,
          genre: "Shoegaze",
          reason:
            "Souvlaki's layered guitars lead naturally into this record's slow-building, textured arrangements.",
          basedOn: [seed],
          previewTrack: "Skin Game",
        });
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        recommendations: [
                          pick("Slowdive", "Souvlaki"),
                          pick("Whirr", "Feels Like You"),
                          pick("DIIV", "Deceiver"),
                          pick("Grouper", "Dragging a Dead Deer Up a Hill"),
                          pick("Imaginary Test Artist", "Invented Album"),
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      globalThis.catalogCalls.push(String(url));
      if (u.hostname === "itunes.apple.com") {
        const term = u.searchParams.get("term");
        const entity = u.searchParams.get("entity");
        const sample = catalog.find((i) => term === `${i.artist} ${i.title}`);
        if (sample?.artist === "DIIV")
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  artistName: sample.artist,
                  collectionName: sample.title,
                  trackName: sample.previewTitle,
                  trackId: 123,
                  previewUrl: sample.preview,
                  artworkUrl100: sample.cover,
                  collectionViewUrl: sample.storeUrl,
                },
              ],
            }),
          };
        if (sample?.artist === "Grouper" && entity === "album")
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  artistName: sample.artist,
                  collectionName: sample.title,
                  artworkUrl100: sample.cover,
                  collectionViewUrl: sample.storeUrl,
                },
              ],
            }),
          };
        return { ok: true, json: async () => ({ results: [] }) };
      }
      if (u.hostname === "musicbrainz.org")
        return { ok: true, json: async () => ({ "release-groups": [] }) };
      throw new Error("Unexpected test lookup");
    };
  }, catalog);
  await page
    .getByRole("button", { name: "Choose AI provider", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "AI provider" })
    .selectOption("gemini");
  await page.getByLabel("API key", { exact: true }).fill("dummy-google-key");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Find records", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("3 albums from Shoegaze", { exact: true }),
  ).toBeVisible();
  expect(await app.evaluate(() => globalThis.discoveryAiCalls.length)).toBe(0);
  await page.locator(".ai-options > summary").click();
  await page
    .getByText("Review what is sent to Google Gemini", { exact: true })
    .click();
  await expect(page.locator(".ai-context-scroll tbody tr")).toHaveCount(3);
  await page.screenshot({ path: path.resolve("artifacts/ai-context.png") });
  await page.getByRole("button", { name: "Find records", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "With previews", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "With previews", exact: true })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(".record-title")).toHaveText("Deceiver");
  const sent = await app.evaluate(() => globalThis.discoveryAiCalls[0]);
  const prompt = sent.contents[0].parts[0].text;
  expect(prompt).toContain("Souvlaki");
  expect(prompt).toContain("Nowhere");
  expect(prompt).toContain("Loveless");
  expect(prompt).toContain("Shoegaze");
  expect(prompt).not.toContain("Apollo");
  expect(prompt).not.toContain(root);
  expect(prompt).not.toContain(".flac");
  expect(sent.generationConfig.responseMimeType).toBe("application/json");
  expect(sent.generationConfig.maxOutputTokens).toBe(8192);
  await page.getByText("Inspect AI request & response", { exact: true }).click();
  await page.getByText("Exact prompt sent to AI", { exact: true }).click();
  await expect(page.locator(".ai-exchange-text").first()).toHaveText(prompt);
  await page.getByText("Raw AI response before filtering", { exact: true }).click();
  await expect(page.locator(".ai-exchange-text").nth(1)).toContainText("Souvlaki");
  await expect(page.locator(".ai-exchange")).toContainText(
    "2 owned, shelved, or previously suggested albums removed locally",
  );
  await page.getByText("Inspect AI request & response", { exact: true }).click();
  await page.getByRole("button", { name: "All records", exact: true }).click();
  await expect(
    page.getByText(/unverified suggestions kept for review/),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".record-card")).toHaveCount(3);
  expect(await page.locator(".record-title").allTextContents()).toEqual([
    "Deceiver",
    "Dragging a Dead Deer Up a Hill",
    "Invented Album",
  ]);
  const grouper = page
    .locator(".record-card")
    .filter({ hasText: "Dragging a Dead Deer Up a Hill" });
  await expect(
    grouper.getByRole("button", { name: /^YouTube for / }),
  ).toBeEnabled();
  await expect(
    grouper.getByText("No clip · try YouTube", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".record-card")
      .filter({ hasText: "Invented Album" })
      .getByText("Unverified · check release", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Review what is sent to Google Gemini", { exact: true })
    .click();
  await page.locator(".ai-options > summary").click();
  await page.locator(".main-scroll").evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".record-card img")].every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );
  await page.screenshot({ path: path.resolve("artifacts/ai-discovery.png") });
  await page
    .locator(".ai-results-heading")
    .evaluate((el) =>
      el.scrollIntoView({ behavior: "instant", block: "start" }),
    );
  await page.screenshot({
    path: path.resolve("artifacts/ai-listening-queue.png"),
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toBeInViewport();
  await page
    .getByRole("button", { name: "Close navigation", exact: true })
    .click();
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  await page.screenshot({ path: path.resolve("artifacts/ai-compact.png") });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  await page
    .getByRole("button", { name: "With previews", exact: true })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.locator(".ai-listen")).toBeVisible();
  await expect(page.locator(".listen-info h2")).toHaveText("Deceiver");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".listen-info h2")).toHaveText("Deceiver");
  await page.keyboard.press("k");
  await expect(page.locator(".ai-listen")).toHaveCount(0);
  await expect(
    page.getByText("No matching clips in this batch.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "AI discovery scope" })
    .selectOption("genre:Ambient");
  await expect(
    page.getByText("1 album from Ambient", { exact: true }),
  ).toBeVisible();
  expect(await app.evaluate(() => globalThis.discoveryAiCalls.length)).toBe(1);
  await page
    .getByRole("combobox", { name: "AI discovery scope" })
    .selectOption("genre:Shoegaze");
  await expect(
    page.getByRole("button", { name: "Find records", exact: true }),
  ).toBeEnabled();
  await app.evaluate(() => {
    globalThis.failDiscovery = true;
  });
  await page.getByRole("button", { name: "Find records", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Google Gemini (HTTP 429)",
  );
  await expect(page.getByRole("alert")).not.toContainText("dummy-google-key");
  await expect(page.locator(".record-card")).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "PASS AI genre context, explicit generation, full structured response, owned/rejected filtering, preview verification, retention of unverified albums, playable-only queue, shelving, scope changes without hidden AI calls, and provider failures without catalog fallback",
  );
} finally {
  await app.close();
}
