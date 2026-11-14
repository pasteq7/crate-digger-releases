import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { Store } from "../electron/store.mjs";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/soundcloud-desktop-"));
const root = path.join(profile, "Music");
const item = {
  id: "track:soundcloud-fixture",
  kind: "track",
  releaseType: "track",
  artist: "Niche Artist",
  title: "Niche Single",
  genre: "Dub",
  year: 2026,
  preview: null,
  cover: "",
  reason: "A test connection to Seed Album.",
  seeds: ["Seed Artist"],
  sourceFolder: "Dub",
  origin: "ai",
  catalogVerified: false,
};
const store = new Store(path.join(profile, "crate-digger.sqlite"));
store.set("folders", [root]);
store.set("settings", {
  autoScan: false,
  view: "wishlist",
  ai: "none",
  engine: "ai",
  scope: "genre:Dub",
});
store.track(
  {
    path: path.join(root, "Seed Artist", "Seed Album", "Seed Song.flac"),
    root,
    folder: "Dub/Seed Artist/Seed Album",
    title: "Seed Song",
    artist: "Seed Artist",
    album: "Seed Album",
    genre: "Dub",
    year: 2020,
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
  await page.route("https://w.soundcloud.com/player/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body style="background:#151516;color:white;font:16px sans-serif"><p>SoundCloud waveform fixture</p><button>Play SoundCloud fixture</button></body></html>',
    }),
  );
  await app.evaluate(() => {
    globalThis.soundcloudCalls = [];
    globalThis.fetch = async (url, options = {}) => {
      const u = new URL(String(url));
      globalThis.soundcloudCalls.push({ host: u.hostname, path: u.pathname });
      if (u.hostname === "soundcloud.com" && u.pathname === "/oembed")
        return {
          ok: true,
          json: async () => ({
            provider_name: "SoundCloud",
            title: "Niche Single by Niche Artist",
            author_name: "Niche Artist",
            html: '<script src="https://evil.test"></script>',
          }),
        };
      if (u.hostname === "secure.soundcloud.com")
        return {
          ok: true,
          json: async () => ({
            access_token: "dummy-sc-access",
            refresh_token: "dummy-sc-refresh",
            expires_in: 3600,
          }),
        };
      if (u.hostname === "api.soundcloud.com") {
        if (globalThis.failSoundcloud)
          return {
            ok: false,
            status: 429,
            json: async () => ({ error: "dummy-sc-secret" }),
          };
        const playlist = u.pathname === "/playlists";
        return {
          ok: true,
          json: async () => ({
            collection: [
              {
                kind: playlist ? "playlist" : "track",
                title: playlist ? "Cloud EP" : "Cloud Single",
                metadata_artist: "Cloud Artist",
                sharing: "public",
                access: "playable",
                permalink_url: playlist
                  ? "https://soundcloud.com/cloud-artist/sets/cloud-ep"
                  : "https://soundcloud.com/cloud-artist/cloud-single",
                playlist_type: playlist ? "ep" : undefined,
                user: {
                  username: "Cloud Artist",
                  permalink_url: "https://soundcloud.com/cloud-artist",
                },
                genre: "Dub",
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          }),
        };
      }
      if (u.hostname === "generativelanguage.googleapis.com") {
        const body = JSON.parse(options.body);
        const prompt = body.contents[0].parts[0].text;
        globalThis.soundcloudAiPrompt = prompt;
        const candidates = JSON.parse(
          prompt.split("SOUNDCLOUD_CANDIDATES: ")[1].split("\nCOLLECTION: ")[0],
        );
        const picks = candidates.map((source) => ({
          artist: "Model artist must not override upload",
          album: "Model title must not override upload",
          releaseType: source.releaseType,
          sourceId: source.sourceId,
          year: 2026,
          genre: "Dub",
          reason:
            "Connects Seed Album's spare rhythms to this SoundCloud upload.",
          basedOn: [0],
          previewTrack: "",
        }));
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ recommendations: picks }) }],
                },
              },
            ],
          }),
        };
      }
      throw new Error(
        "Unexpected request: mainstream catalog must not be required for SoundCloud sources",
      );
    };
  });
  await expect(page.locator(".record-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Niche Single", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Listen on SoundCloud for Niche Single",
      exact: true,
    })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Search SoundCloud", exact: true }),
  ).toBeDisabled();
  await modal
    .getByLabel("SoundCloud track or playlist link")
    .fill("https://evil.test/artist/song");
  await modal
    .getByRole("button", { name: "Load SoundCloud", exact: true })
    .click();
  await expect(modal.getByRole("status")).toContainText("public");
  await expect(modal.locator("iframe")).toHaveCount(0);
  await modal
    .getByLabel("SoundCloud track or playlist link")
    .fill("https://soundcloud.com/niche-artist/niche-single?si=tracking");
  await modal
    .getByRole("button", { name: "Load SoundCloud", exact: true })
    .click();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("button", { name: "Play SoundCloud fixture" }),
  ).toBeVisible();
  expect(
    new URL(await modal.locator("iframe").getAttribute("src")).searchParams.get(
      "auto_play",
    ),
  ).toBe("false");
  expect(
    new URL(await modal.locator("iframe").getAttribute("src")).searchParams.get(
      "url",
    ),
  ).toBe("https://soundcloud.com/niche-artist/niche-single");
  const remote = page
    .frames()
    .find((frame) =>
      frame.url().startsWith("https://w.soundcloud.com/player/"),
    );
  expect(await remote.evaluate(() => typeof window.crate)).toBe("undefined");
  const attached = await page.evaluate(
    (id) => window.crate.state().then((state) => state.shelves[id].item),
    item.id,
  );
  expect(attached.catalogVerified).toBe(false);
  expect(attached.soundcloud.url).toBe(
    "https://soundcloud.com/niche-artist/niche-single",
  );
  expect(
    await app.evaluate(() =>
      globalThis.soundcloudCalls.some(
        (call) => call.host === "api.soundcloud.com",
      ),
    ),
  ).toBe(false);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await page
    .getByRole("button", { name: "Play on SoundCloud", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Connect a SoundCloud app", exact: true })
    .click();
  await page
    .getByLabel("SoundCloud client ID", { exact: true })
    .fill("dummy-sc-id");
  await page
    .getByLabel("SoundCloud client secret", { exact: true })
    .fill("dummy-sc-secret");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(
    page.getByLabel("SoundCloud client secret", { exact: true }),
  ).toHaveValue("");
  const settings = await page.evaluate(() =>
    window.crate.state().then((state) => state.settings),
  );
  expect(settings.hasSoundcloudCredentials).toBe(true);
  expect(JSON.stringify(settings)).not.toContain("dummy-sc");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  await page
    .getByRole("button", { name: "SoundCloud for Niche Single", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Search SoundCloud", exact: true })
    .click();
  await expect(modal.locator(".youtube-results > button")).toHaveCount(1);
  await modal.locator(".youtube-results > button").click();
  await expect(modal.locator("iframe")).toBeVisible();
  expect(
    await page
      .locator("audio")
      .first()
      .evaluate((audio) => audio.paused),
  ).toBe(true);
  await page.screenshot({
    path: path.resolve("artifacts/soundcloud-preview.png"),
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
    .getByRole("button", { name: "Reload SoundCloud", exact: true })
    .click();
  await expect(modal.locator("iframe")).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  expect(
    await modal.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.resolve("artifacts/soundcloud-preview-compact.png"),
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  await modal.getByRole("button", { name: "Close SoundCloud player" }).click();
  const saved = new Store(path.join(profile, "crate-digger.sqlite"));
  const encrypted = saved.get("soundcloudAuth", "");
  expect(encrypted.length).toBeGreaterThan(0);
  expect(encrypted).not.toContain("dummy-sc");
  expect(JSON.stringify(saved.get("settings", {}))).not.toContain("dummy-sc");
  saved.close();
  // Configure an AI provider, then explicitly opt into real SoundCloud candidate lookup.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("button", { name: "AI", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "AI provider" })
    .selectOption("gemini");
  await page.getByLabel("API key", { exact: true }).fill("dummy-gemini-key");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "AI discovery scope" })
    .selectOption("genre:Dub");
  await page.locator(".ai-options > summary").click();
  await page
    .getByLabel("Include SoundCloud discoveries", { exact: true })
    .check();
  await page.getByRole("button", { name: "Find records", exact: true }).click();
  await expect(page.locator(".record-card")).toHaveCount(2);
  await expect(page.locator(".record-title")).toHaveText([
    "Cloud Single",
    "Cloud EP",
  ]);
  await expect(page.locator(".ai-preview-status").first()).toHaveText(
    "SoundCloud upload",
  );
  const prompt = await app.evaluate(() => globalThis.soundcloudAiPrompt);
  expect(prompt).toContain("SOUNDCLOUD_CANDIDATES");
  expect(prompt).not.toContain("dummy-sc");
  expect(prompt).not.toContain(root);
  await page
    .getByRole("button", { name: "SoundCloud for Cloud Single", exact: true })
    .click();
  await expect(modal.locator("iframe")).toBeVisible();
  await modal.getByRole("button", { name: "Close SoundCloud player" }).click();
  const single = page
    .locator(".record-card")
    .filter({ hasText: "Cloud Single" });
  await single.getByRole("button", { name: "Save", exact: true }).click();
  const savedSource = await page.evaluate(() =>
    window.crate
      .state()
      .then(
        (state) =>
          Object.values(state.shelves).find(
            (entry) => entry.item.title === "Cloud Single",
          ).item,
      ),
  );
  expect(savedSource.kind).toBe("track");
  expect(savedSource.album).toBeUndefined();
  expect(savedSource.soundcloud.url).toBe(
    "https://soundcloud.com/cloud-artist/cloud-single",
  );
  expect(savedSource.catalogVerified).toBe(true);
  await page.evaluate(() =>
    window.crate.settings({ soundcloudCredentials: null }),
  );
  expect(
    (await page.evaluate(() => window.crate.state())).settings
      .hasSoundcloudCredentials,
  ).toBe(false);
  expect(errors).toEqual([]);
  console.log(
    "PASS SoundCloud pasted links without credentials, safe waveform embeds, encrypted credentials/tokens, source retention, hidden playback stop, compact layout, AI selection from real SoundCloud tracks/EPs, independent catalog verification and credential removal",
  );
} finally {
  await app.close();
}
