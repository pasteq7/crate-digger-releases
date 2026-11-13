import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, writeFile, readFile, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import catalog from "../src/sample-catalog.json" with { type: "json" };
import { Store } from "../electron/store.mjs";

const root = path.resolve(".test-data");
await mkdir(root, { recursive: true });
const data = await mkdtemp(path.join(root, "desktop-"));
const library = path.join(data, "music");
const albumDir = path.join(library, "Slowdive", "1993 - Souvlaki");
await mkdir(albumDir, { recursive: true });
const source = path.join(albumDir, "01 Alison.wav");
const wave = Buffer.alloc(1644);
wave.write("RIFF", 0);
wave.writeUInt32LE(1636, 4);
wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(8000, 24);
wave.writeUInt32LE(16000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write("data", 36);
wave.writeUInt32LE(1600, 40);
await writeFile(source, wave);
const before = createHash("sha256")
  .update(await readFile(source))
  .digest("hex");
const artifact = path.resolve("artifacts");
await mkdir(artifact, { recursive: true });
const env = { ...process.env, CRATE_DATA_DIR: path.join(data, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  const app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
try {
  let context = await launch();
  app = context.app;
  let page = context.page;
  await expect(
    page.getByRole("button", { name: "Choose your music folder", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(artifact, "onboarding.png") });
  await page.getByRole("button", { name: /take a look around/ }).click();
  await expect(page.locator(".record-card")).toHaveCount(13);
  await expect(
    page.getByText("Sample collection", { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".record-card")
    .first()
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("kept for later");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".record-card")).toHaveCount(13);
  await page
    .locator(".record-card")
    .first()
    .getByRole("button", { name: "Preview Deceiver" })
    .click();
  await expect(page.locator(".playing-title")).toHaveText("Skin Game");
  await page.waitForFunction(
    () => {
      const a = document.querySelector("audio");
      return a && !a.paused && a.currentTime > 0;
    },
    null,
    { timeout: 25000 },
  );
  console.log("PASS real streamed preview played inside Electron");
  await page
    .getByRole("button", { name: "Pause preview", exact: true })
    .click();
  await page.locator(".main-scroll").evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".record-card img")]
      .slice(0, 4)
      .every((i) => i.complete && i.naturalWidth > 0),
  );
  await page.screenshot({ path: path.join(artifact, "discover.png") });
  await page.keyboard.press("k");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(1);
  await expect(page.locator(".record-title")).toHaveText("Deceiver");
  await page.getByRole("button", { name: "Your taste", exact: true }).click();
  await expect(page.getByText("Your sonic fingerprint")).toBeVisible();
  await page.screenshot({ path: path.join(artifact, "taste.png") });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.locator(".listen-view")).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.locator(".listen-view")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".listen-view")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: path.join(artifact, "light.png") });
  await page.getByRole("button", { name: "Switch color theme" }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  await page.screenshot({ path: path.join(artifact, "compact.png") });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  console.log(
    "PASS sample onboarding, shelves, undo, shortcuts, listen mode, taste, themes, resizing",
  );

  // Stub only external services and the OS picker. Exercise the real IPC bridge,
  // scanner, database, recommendation pipeline, and native export implementation.
  await app.evaluate(({ dialog }, lib) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [lib] });
  }, library);
  await app.evaluate(({}, seed) => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("musicbrainz.org"))
        return {
          ok: true,
          json: async () => ({
            "release-groups": [
              {
                id: "owned",
                title: "Souvlaki",
                "artist-credit": [{ name: "Slowdive" }],
              },
              ...seed.slice(0, 4).map((i, n) => ({
                id: `live-${n}`,
                title: i.title,
                "artist-credit": [{ name: i.artist }],
                "first-release-date": `${i.year}-01-01`,
              })),
            ],
          }),
        };
      const term = new URL(String(url)).searchParams.get("term");
      const item = seed.find((i) => term === `${i.artist} ${i.title}`);
      return {
        ok: true,
        json: async () => ({
          results: item
            ? [
                {
                  artistName: item.artist,
                  collectionName: item.title,
                  trackName: item.previewTitle,
                  trackId: item.id,
                  previewUrl: item.preview,
                  artworkUrl100: item.cover,
                  collectionViewUrl: item.storeUrl,
                },
              ]
            : [],
        }),
      };
    };
  }, catalog);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Add folder", exact: true }).click();
  await expect(page.locator(".record-card")).toHaveCount(4, { timeout: 30000 });
  const native = await page.evaluate(() => window.crate.state());
  expect(native.tracks).toHaveLength(1);
  expect(native.tracks[0].artist).toBe("Slowdive");
  expect(native.tracks[0].album).toBe("Souvlaki");
  expect(native.shelves).toEqual({});
  expect(await page.evaluate(() => typeof window.require)).toBe("undefined");
  expect(before).toBe(
    createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
  );
  await page
    .locator(".record-card")
    .first()
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .locator(".record-card")
    .first()
    .getByRole("button", { name: "Less like this", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  const exported = path.join(data, "wishlist.csv");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, exported);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("button", { name: "Spreadsheet (.csv)", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("exported");
  expect(await readFile(exported, "utf8")).toContain("Deceiver");
  const saved = await page.evaluate(() => window.crate.state());
  expect(
    Object.values(saved.shelves).filter((s) => s.status === "rejected"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const provider = page.getByRole("combobox", { name: "AI provider" });
  await provider.selectOption("gemini");
  await expect(
    page.getByRole("textbox", { name: "Model", exact: true }),
  ).toHaveValue("gemini-3.8-flash");
  await expect(
    page.getByText(
      /Sends selected album\/folder metadata or explanation context to Google Gemini/,
    ),
  ).toBeVisible();
  await page
    .getByLabel("API key", { exact: true })
    .fill("unsaved-google-test-key");
  await provider.selectOption("openai");
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await provider.selectOption("gemini");
  await page.screenshot({ path: path.join(artifact, "gemini-settings.png") });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  await app.evaluate(() => {
    const previous = globalThis.fetch;
    globalThis.aiRequests = [];
    globalThis.fetch = async (url, options) => {
      if (
        String(url).startsWith(
          "https://generativelanguage.googleapis.com/v1beta/models?",
        )
      ) {
        return {
          ok: true,
          json: async () => ({
            models: [
              {
                name: "models/gemini-3.8-flash",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          }),
        };
      }
      if (
        String(url).includes("api.openai.com") ||
        String(url).includes("generativelanguage.googleapis.com") ||
        String(url).includes("/api/generate")
      ) {
        globalThis.aiRequests.push({
          url: String(url),
          body: JSON.parse(options.body),
          headers: options.headers,
        });
        if (
          globalThis.aiFailure &&
          String(url).includes("generativelanguage.googleapis.com")
        ) {
          return {
            ok: false,
            status: 429,
            json: async () => ({
              error: { message: "Quota exceeded for crate-google-test-key" },
            }),
          };
        }
        return {
          ok: true,
          json: async () =>
            String(url).includes("generativelanguage.googleapis.com")
              ? {
                  candidates: [
                    {
                      content: {
                        parts: [
                          { thought: true, text: "Do not show this." },
                          { text: "A Google " },
                          { text: "test explanation." },
                        ],
                      },
                    },
                  ],
                }
              : String(url).includes("api.openai.com")
                ? { choices: [{ message: { content: "A test explanation." } }] }
                : { response: "A local test explanation." },
        };
      }
      return previous(url, options);
    };
  });
  const item = Object.values(saved.shelves)[0].item;
  await page.evaluate(() =>
    window.crate.settings({
      ai: "openai",
      aiModel: "gpt-4.1-mini",
      aiKey: "crate-test-key",
    }),
  );
  expect(await page.evaluate((i) => window.crate.explain(i), item)).toBe(
    "A test explanation.",
  );
  const keyState = await page.evaluate(() => window.crate.state());
  expect(keyState.settings.hasAiKey).toBe(true);
  expect(keyState.settings.aiKey).toBeUndefined();
  const aiRequest = await app.evaluate(() => globalThis.aiRequests[0]);
  expect(aiRequest.body.store).toBe(false);
  expect(aiRequest.body.max_completion_tokens).toBe(160);
  await page.evaluate(() =>
    window.crate.settings({ ai: "gemini", aiModel: "gemini-3.8-flash" }),
  );
  const googleState = await page.evaluate(() => window.crate.state());
  expect(googleState.settings.hasAiKey).toBe(false);
  expect(googleState.settings.hasAiKeys).toEqual({
    openai: true,
    gemini: false,
  });
  const missingGoogleKey = await page.evaluate(async (i) => {
    try {
      await window.crate.explain(i);
      return "";
    } catch (e) {
      return e.message;
    }
  }, item);
  expect(missingGoogleKey).toContain("Google Gemini API key");
  expect(await app.evaluate(() => globalThis.aiRequests.length)).toBe(1);
  await page.evaluate(() =>
    window.crate.settings({ ai: "gemini", aiKey: "crate-google-test-key" }),
  );
  expect(await page.evaluate((i) => window.crate.explain(i), item)).toBe(
    "A Google test explanation.",
  );
  expect(
    await page.evaluate(
      (i) => window.crate.explain({ ...i, id: "taste-profile" }),
      item,
    ),
  ).toBe("A Google test explanation.");
  const googleRequest = await app.evaluate(() => globalThis.aiRequests[1]);
  expect(googleRequest.url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
  );
  expect(googleRequest.headers["x-goog-api-key"]).toBe("crate-google-test-key");
  expect(googleRequest.headers.Authorization).toBeUndefined();
  expect(googleRequest.body.contents[0].parts[0].text).toContain(
    "Recommendation:",
  );
  expect(
    (await app.evaluate(() => globalThis.aiRequests[2])).body.contents[0]
      .parts[0].text,
  ).toContain("Summarize");
  await page.evaluate(() =>
    window.crate.settings({ ai: "openai", aiModel: "gpt-4.1-mini" }),
  );
  expect(await page.evaluate((i) => window.crate.explain(i), item)).toBe(
    "A test explanation.",
  );
  expect(
    (await app.evaluate(() => globalThis.aiRequests[3])).headers.Authorization,
  ).toBe("Bearer crate-test-key");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page
    .getByRole("combobox", { name: "AI provider" })
    .selectOption("gemini");
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(page.locator(".connection-result")).toContainText(
    "Connected. This model is available.",
  );
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue("gemini-3.8-flash");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  await page.locator(".record-title").first().click();
  await app.evaluate(() => {
    globalThis.aiFailure = true;
  });
  await page
    .getByRole("button", { name: "Ask your AI for more context" })
    .click();
  await expect(page.locator(".toast")).toContainText(
    "Google Gemini (HTTP 429)",
  );
  await expect(page.locator(".toast")).not.toContainText(
    "crate-google-test-key",
  );
  await expect(page.locator(".toast")).not.toContainText(
    "Error invoking remote method",
  );
  await app.evaluate(() => {
    globalThis.aiFailure = false;
  });
  await page.getByRole("button", { name: "Close details" }).click();
  console.log(
    "PASS saved-key connection check, available model selection, and readable credential-safe Google errors",
  );
  console.log(
    "PASS Google Gemini Settings, explanations, taste summaries, missing-key handling, and provider key isolation (responses stubbed)",
  );
  await page.evaluate(() =>
    window.crate.settings({
      ai: "ollama",
      aiEndpoint: "http://127.0.0.1:11434",
      aiModel: "llama3.2",
    }),
  );
  expect(await page.evaluate((i) => window.crate.explain(i), item)).toBe(
    "A local test explanation.",
  );
  await page.evaluate(() =>
    window.crate.settings({ ai: "ollama", aiEndpoint: "https://example.com" }),
  );
  const blocked = await page.evaluate(async (i) => {
    try {
      await window.crate.explain(i);
      return false;
    } catch {
      return true;
    }
  }, item);
  expect(blocked).toBe(true);
  await page.evaluate(() =>
    window.crate.settings({
      ai: "none",
      aiEndpoint: "http://127.0.0.1:11434",
      aiKey: "",
    }),
  );
  console.log(
    "PASS optional AI request schemas, encrypted key state, and local endpoint restrictions (provider responses stubbed)",
  );
  const legacyKey = await app.evaluate(({ safeStorage }) =>
    safeStorage
      .encryptString("crate-legacy-openai-test-key")
      .toString("base64"),
  );
  await app.close();
  app = null;
  const legacyStore = new Store(
    path.join(data, "profile", "crate-digger.sqlite"),
  );
  legacyStore.set("aiKey", legacyKey);
  legacyStore.set("aiKey:openai", null);
  legacyStore.close();
  context = await launch();
  app = context.app;
  page = context.page;
  await expect(page.locator(".record-card")).toHaveCount(1);
  await expect(page.locator(".record-title")).toHaveText("Deceiver");
  const restored = await page.evaluate(() => window.crate.state());
  expect(restored.tracks).toHaveLength(1);
  expect(Object.keys(restored.shelves)).toHaveLength(2);
  expect(restored.settings.hasAiKeys).toEqual({ openai: true, gemini: true });
  const migratedStore = new Store(
    path.join(data, "profile", "crate-digger.sqlite"),
  );
  expect(migratedStore.get("aiKey", null)).toBe(null);
  expect(migratedStore.get("aiKey:openai", null)).toBe(legacyKey);
  migratedStore.close();
  console.log(
    "PASS existing encrypted OpenAI key migrates without becoming a Google key",
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(2, { timeout: 30000 });
  expect(await page.locator(".record-title").allTextContents()).not.toContain(
    "Bloom",
  );
  console.log(
    "PASS native folder scan, read-only files, IPC isolation, catalog filtering, export, restart persistence, rejection persistence",
  );
  expect(errors).toEqual([]);
  console.log("PASS no renderer errors");
} finally {
  if (app) await app.close();
}
