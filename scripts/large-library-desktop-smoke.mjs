import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { largeLibraryFixture } from "./large-library-fixture.mjs";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts/large-library", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/large-desktop-"));
const fixture = await largeLibraryFixture(profile);
fixture.store.close();
const hash = async () =>
  createHash("sha256")
    .update(
      Buffer.concat(
        await Promise.all(fixture.tracks.map((t) => readFile(t.path))),
      ),
    )
    .digest("hex");
const before = await hash();
const env = { ...process.env, CRATE_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [],
  metrics = { indexedTracks: 50000, albums: 5000 };
let app;
try {
  let start = performance.now();
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env,
    timeout: 60000,
  });
  let page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".library-album")).toHaveCount(120);
  await expect(page.locator(".toolbar-count")).toContainText(
    /5[,\s\u202f]000 albums/,
  );
  metrics.startupMs = Math.round(performance.now() - start);
  const summary = await page.evaluate(() =>
    window.crate.state({ includeTracks: false }),
  );
  expect(summary.tracks).toEqual([]);
  expect(summary.profile.total).toBe(50000);
  await app.evaluate(() => {
    globalThis.collectionHeartbeat = {
      last: performance.now(),
      max: 0,
      ticks: 0,
    };
    setInterval(() => {
      const h = globalThis.collectionHeartbeat,
        now = performance.now();
      h.max = Math.max(h.max, now - h.last);
      h.last = now;
      h.ticks++;
    }, 10);
  });
  await page.evaluate(() => {
    window.collectionFrames = { last: performance.now(), max: 0, ticks: 0 };
    const frame = (now) => {
      const h = window.collectionFrames;
      h.max = Math.max(h.max, now - h.last);
      h.last = now;
      h.ticks++;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  // No giant hidden filter DOM is built while browsing.
  await expect(page.getByLabel("Library artist", { exact: true })).toHaveCount(
    0,
  );
  start = performance.now();
  await page
    .getByRole("button", { name: "Next library page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Album 00120", exact: true }),
  ).toBeVisible();
  metrics.nextPageMs = Math.round(performance.now() - start);
  await expect(page.locator(".library-album")).toHaveCount(120);
  await page
    .getByRole("button", { name: "Previous library page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Album 00000", exact: true }),
  ).toBeVisible();
  start = performance.now();
  await page
    .getByRole("button", { name: "Open Album 00000", exact: true })
    .click();
  await expect(page.locator(".album-inline-tracks li")).toHaveCount(10);
  await expect(
    page.getByRole("button", { name: "Play Track 000001", exact: true }),
  ).toBeEnabled();
  metrics.albumOpenMs = Math.round(performance.now() - start);
  await page
    .getByRole("button", { name: "Favorite Track 000001", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Favorite Track 000001", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close album", exact: true }).click();
  const filters = page
    .locator(".toolbar-popover")
    .filter({ has: page.locator("summary").filter({ hasText: /^Filters/ }) });
  await filters.locator("summary").click();
  await expect(
    page.getByLabel("Find library artist", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByLabel("Library artist", { exact: true })
      .locator("option")
      .count(),
  ).toBeLessThanOrEqual(202);
  await page.getByLabel("Find library artist", { exact: true }).fill("0999");
  await page
    .getByLabel("Library artist", { exact: true })
    .selectOption("Artist 0999");
  await page.keyboard.press("Escape");
  await expect(page.locator(".library-album")).toHaveCount(5);
  await filters.locator("summary").click();
  await page
    .getByRole("button", { name: "Clear all filters", exact: true })
    .click();
  await page.keyboard.press("Escape");
  const search = page.getByRole("textbox", {
    name: "Search music",
    exact: true,
  });
  await search.fill("Track 000");
  await search.fill("Track 0499");
  await search.fill("Track 049999");
  await expect(page.locator(".library-tracks tbody tr")).toHaveCount(1);
  await expect(page.locator(".library-tracks tbody")).toContainText(
    "Track 049999",
  );
  // Navigating while a query is pending must leave the new page in control.
  await search.fill("Track");
  start = performance.now();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Settings categories" }),
  ).toBeVisible();
  metrics.navigateDuringQueryMs = Math.round(performance.now() - start);
  await page
    .getByRole("button", { name: "Library", exact: true })
    .first()
    .click();
  await expect(page.locator(".library-album")).toHaveCount(120);
  const list = await page.evaluate(async () => {
    const result = await window.crate.libraryQuery({
      sort: "added",
      limit: 1000,
    });
    const list = await window.crate.playlistSave({
      name: "Large queue",
      tracks: result.tracks.map((t) => t.id),
    });
    window.dispatchEvent(new Event("crate-library-changed"));
    return list;
  });
  await page
    .locator(".sidebar-playlists")
    .getByRole("button", { name: list.name, exact: true })
    .click();
  await expect(page.locator(".library-tracks tbody tr")).toHaveCount(120);
  await page
    .getByRole("button", { name: "Play displayed tracks", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause music", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle queue", exact: true })
    .first()
    .click();
  await expect(page.locator(".queue-list li")).toHaveCount(100);
  await expect(
    page.getByRole("navigation", { name: "Queue pages" }),
  ).toContainText("of 1000");
  await page
    .getByRole("navigation", { name: "Queue pages" })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(page.locator(".queue-list li").first()).toContainText(
    "Track 000100",
  );
  await page.getByRole("button", { name: "Close queue", exact: true }).click();
  metrics.mainHeartbeat = await app.evaluate(
    () => globalThis.collectionHeartbeat,
  );
  metrics.rendererFrames = await page.evaluate(() => window.collectionFrames);
  expect(metrics.mainHeartbeat.ticks).toBeGreaterThan(20);
  expect(metrics.mainHeartbeat.max).toBeLessThan(1000);
  expect(metrics.rendererFrames.max).toBeLessThan(1000);
  expect(metrics.albumOpenMs).toBeLessThan(3000);
  expect(await hash()).toBe(before);
  await page.screenshot({ path: "artifacts/large-library/collection.png" });
  await app.close();
  // A single unusually large album must also keep its rendered row count bounded.
  const albumProfile = await mkdtemp(path.resolve(".test-data/large-album-"));
  const bigAlbum = await largeLibraryFixture(albumProfile, 1000, 1000);
  bigAlbum.store.close();
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...env, CRATE_DATA_DIR: albumProfile },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "Open Album 00000", exact: true })
    .click();
  await expect(page.locator(".album-inline-tracks li")).toHaveCount(100);
  await page.getByRole("button", { name: "Next tracks", exact: true }).click();
  await expect(page.locator(".album-inline-tracks li").first()).toContainText(
    "Track 000100",
  );
  await expect(
    page.getByRole("navigation", { name: "Album track pages" }),
  ).toContainText("101–200 of 1000");
  await page.getByRole("button", { name: "Close album", exact: true }).click();
  expect(errors).toEqual([]);
  await writeFile(
    "artifacts/large-library/metrics.json",
    JSON.stringify(metrics, null, 2),
  );
  console.log(
    "PASS 50,000-track/5,000-album desktop browse, paging, inline likes, bounded artist choices, latest search, responsive navigation, 1,000-track queue/album, unchanged generated audio",
    JSON.stringify(metrics),
  );
} finally {
  await app?.close();
}
