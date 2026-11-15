import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Store } from "../electron/store.mjs";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/listening-"));
const root = path.join(profile, "Music"),
  output = path.join(profile, "Output");
await mkdir(root);
await mkdir(output);
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
await writeFile(path.join(root, "Owned.wav"), wave);
const program = path.join(profile, "queue tool.mjs");
await writeFile(
  program,
  `import { appendFileSync, existsSync } from 'node:fs';
  appendFileSync('order.txt', process.argv[2] + '\\n'); console.log('Started', process.argv[2]);
  const timer = setInterval(() => { if (existsSync('continue.flag')) clearInterval(timer); }, 50);`,
);
const item = {
  id: "album:test",
  kind: "album",
  artist: "Test Artist",
  title: "Test Album",
  album: "Test Album",
  genre: "Test",
  year: 2020,
  cover: "",
  preview: "https://audio.test/1.wav",
  previewTitle: "First Song",
  previewSource: "apple",
  reason: "Test recommendation",
  seeds: [],
  sourceFolder: root,
  trackCount: 3,
  trackCountSource: "Apple Music",
  storeUrl: "https://music.apple.com/us/album/test-album/123",
  catalogVerified: true,
  origin: "ai",
};
const store = new Store(path.join(profile, "crate-digger.sqlite"));
store.set("folders", [root]);
store.set("settings", {
  autoScan: false,
  view: "wishlist",
  ai: "none",
  engine: "catalog",
  externalCommand: `"${process.execPath}" "${program}" {url}`,
  externalCwdMode: "custom",
  externalCwd: output,
});
store.track(
  {
    path: path.join(root, "Owned.wav"),
    root,
    folder: "",
    artist: "Owned",
    album: "Owned",
    title: "Owned",
    genre: "Test",
    year: 2000,
  },
  { mtimeMs: 1, size: wave.length },
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
  await page.route("https://audio.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: wave }),
  );
  await app.evaluate(({ shell }) => {
    globalThis.linksOpened = [];
    globalThis.catalogCalls = [];
    shell.openExternal = async (url) => {
      globalThis.linksOpened.push(url);
    };
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      globalThis.catalogCalls.push(String(url));
      if (u.hostname === "itunes.apple.com")
        return Response.json({
          results: [
            {
              wrapperType: "collection",
              collectionId: 123,
              collectionName: "Test Album",
              artistName: "Test Artist",
              trackCount: 3,
            },
            ...["First Song", "Second Song", "No Clip"].map((title, index) => ({
              wrapperType: "track",
              kind: "song",
              collectionId: 123,
              trackId: index + 1,
              collectionName: "Test Album",
              artistName: "Test Artist",
              trackName: title,
              discNumber: 1,
              trackNumber: index + 1,
              trackTimeMillis: 180000,
              ...(index < 2
                ? { previewUrl: `https://audio.test/${index + 1}.wav` }
                : {}),
              trackViewUrl: `https://music.apple.com/us/album/test-album/123?i=${index + 1}`,
            })),
          ],
        });
      if (u.hostname === "album.link")
        return new Response(
          `<script id="__NEXT_DATA__">${JSON.stringify({
            props: {
              pageProps: {
                pageData: {
                  entityData: {
                    type: "album",
                    artistName: "Test Artist",
                    title: "Test Album",
                  },
                  sections: [
                    {
                      links: [
                        {
                          platform: "spotify",
                          url: "https://open.spotify.com/album/test123",
                        },
                        {
                          platform: "qobuz",
                          url: "https://www.qobuz.com/us-en/album/test123",
                        },
                        {
                          platform: "bandcamp",
                          url: "https://test-artist.bandcamp.com/album/test-album",
                        },
                      ],
                    },
                  ],
                },
              },
            },
          })}</script>`,
        );
      throw new Error(`Unexpected catalog request ${url}`);
    };
  });
  await expect(page.locator(".record-title")).toHaveText("Test Album");
  await page
    .getByRole("button", { name: "Search Test Album on YouTube", exact: true })
    .click();
  expect((await app.evaluate(() => globalThis.linksOpened)).at(-1)).toContain(
    "www.youtube.com/results?search_query=",
  );
  await page.getByRole("button", { name: "Test Album", exact: true }).click();
  await page
    .getByRole("button", { name: "Browse album tracks", exact: true })
    .click();
  await expect(page.locator(".album-track-list li")).toHaveCount(3, {
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "Preview No Clip", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Preview First Song", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const audio = document.querySelector("audio");
        return !!audio && !audio.paused && audio.currentTime > 0;
      }),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Preview Second Song", exact: true })
    .click();
  await expect(page.locator(".playing-title")).toHaveText("Second Song");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const audio = document.querySelector("audio");
        return !audio.paused && audio.src.endsWith("/2.wav");
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: path.resolve("artifacts/album-tracks-readable.png"),
  });
  await page
    .getByRole("button", { name: "Find provider links", exact: true })
    .click();
  await expect(
    page
      .getByRole("combobox", { name: "Music provider for Test Album" })
      .locator("option"),
  ).toHaveCount(13, { timeout: 15000 });
  await page
    .getByRole("combobox", { name: "Music provider for Test Album" })
    .selectOption("spotify");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  expect((await app.evaluate(() => globalThis.linksOpened)).at(-1)).toBe(
    "https://open.spotify.com/album/test123",
  );
  await page
    .getByRole("button", {
      name: "Copy Spotify URL for Test Album",
      exact: true,
    })
    .click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    "https://open.spotify.com/album/test123",
  );
  const before = await app.evaluate(() => globalThis.catalogCalls.length);
  await page
    .getByRole("button", { name: "YouTube search for Test Album", exact: true })
    .click();
  expect((await app.evaluate(() => globalThis.linksOpened)).at(-1)).toContain(
    "https://www.youtube.com/results?search_query=Test%20Artist%20Test%20Album%20full%20album",
  );
  expect(await app.evaluate(() => globalThis.catalogCalls.length)).toBe(before);
  await page
    .getByRole("button", {
      name: "Run external program for Test Album",
      exact: true,
    })
    .click();
  await expect(page.locator(".external-job.running")).toHaveCount(1);
  const form = page.getByRole("region", { name: "Run a pasted URL" });
  for (const url of [
    "https://www.deezer.com/album/remove-me",
    "https://test-artist.bandcamp.com/album/test-album",
  ]) {
    await form.getByLabel("URL for external program").fill(url);
    await form
      .getByRole("button", { name: "Run pasted URL", exact: true })
      .click();
  }
  const queue = page.getByRole("region", { name: "External run queue" });
  await expect(queue.locator("li")).toHaveCount(2);
  await queue
    .locator("li")
    .filter({ hasText: "remove-me" })
    .getByRole("button", { name: /Remove/ })
    .click();
  await expect(queue.locator("li")).toHaveCount(1);
  await expect(page.locator(".external-job").first()).toHaveClass(/running/);
  await queue.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.resolve("artifacts/external-run-queue.png"),
  });
  await writeFile(path.join(output, "continue.flag"), "go");
  await expect(page.locator(".external-job.complete")).toHaveCount(2, {
    timeout: 15000,
  });
  expect(
    (await readFile(path.join(output, "order.txt"), "utf8")).trim().split("\n"),
  ).toEqual([
    "https://open.spotify.com/album/test123",
    "https://test-artist.bandcamp.com/album/test-album",
  ]);
  await page.evaluate(() =>
    window.crate.settings({ autoScan: true, watchLibrary: false }),
  );
  await writeFile(path.join(root, "New.wav"), wave);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const state = await page.evaluate(() => window.crate.state());
  expect(state.tracks.length).toBe(1);
  expect(state.settings.watchLibrary).toBe(false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Watch for new music/ }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Rescan now", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.crate.state())).tracks.length,
    )
    .toBe(2);
  await page.screenshot({
    path: path.resolve("artifacts/settings-readable.png"),
  });
  const fontSizes = await page
    .locator(".settings-section:visible label")
    .evaluateAll((labels) =>
      labels.map((label) => parseFloat(getComputedStyle(label).fontSize)),
    );
  expect(fontSizes.every((size) => size >= 14)).toBe(true);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: path.resolve("artifacts/listening-compact.png"),
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS album tracks, switching previews, missing clips, provider open/copy/queue, one-click YouTube search, FIFO queue/removal, opt-in watching, manual rescan, and readable responsive settings",
  );
} finally {
  await app.close();
}
