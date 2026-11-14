import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Store } from "../electron/store.mjs";
await mkdir(".test-data", { recursive: true });
await mkdir("artifacts", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/release-details-"));
const root = path.join(profile, "Music"),
  cwd = path.join(profile, "Output");
await mkdir(root);
await mkdir(cwd);
const program = path.join(profile, "literal url tool.mjs");
await writeFile(
  program,
  `import {writeFileSync} from 'node:fs';const args=process.argv.slice(2);writeFileSync('args.json',JSON.stringify(args));console.log('Input URL:',args[0]);`,
);
const item = {
  id: "album:sinner",
  kind: "album",
  title: "Sinner",
  album: "Sinner",
  artist: "Drowning Pool",
  genre: "Metal",
  year: 2001,
  preview: null,
  cover: "",
  reason: "Test recommendation",
  seeds: [],
  sourceFolder: root,
  storeUrl: "https://music.apple.com/fr/album/sinner/1440777715",
  catalogVerified: true,
  origin: "ai",
};
const saved = new Store(path.join(profile, "crate-digger.sqlite"));
saved.set("folders", [root]);
saved.set("settings", {
  autoScan: false,
  view: "activity",
  scope: "genre:Metal",
  ai: "none",
  engine: "ai",
  externalCommand: `"${process.execPath}" "${program}" {url} --mode literal`,
  externalCwdMode: "custom",
  externalCwd: cwd,
});
saved.track(
  {
    path: path.join(root, "Owned.wav"),
    root,
    folder: "",
    artist: "Owned Artist",
    album: "Owned Album",
    title: "Owned Track",
    genre: "Metal",
    year: 2000,
  },
  { mtimeMs: 1, size: 1 },
);
saved.shelf(item.id, {
  item,
  status: "wishlist",
  added: new Date().toISOString(),
});
saved.close();
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
  await app.evaluate(({ shell }) => {
    globalThis.lookupCalls = [];
    globalThis.openedLinks = [];
    shell.openExternal = async (url) => {
      globalThis.openedLinks.push(url);
    };
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      globalThis.lookupCalls.push(String(url));
      if (u.hostname === "itunes.apple.com")
        return Response.json({
          results: [
            {
              artistName: "Drowning Pool",
              collectionName: "Sinner",
              collectionId: 1440777715,
              trackCount: 11,
              collectionViewUrl:
                "https://music.apple.com/fr/album/sinner/1440777715",
            },
          ],
        });
      if (u.hostname === "api.deezer.com")
        return Response.json({
          data: [
            {
              artist: { name: "Drowning Pool" },
              title: "Sinner (25th Anniversary)",
              id: 993678671,
            },
          ],
        });
      if (u.hostname === "album.link") {
        const alternate = u.pathname.includes("/d/");
        return new Response(
          '<script id="__NEXT_DATA__">' +
            JSON.stringify({
              props: {
                pageProps: {
                  pageData: {
                    entityData: {
                      type: "album",
                      artistName: "Drowning Pool",
                      title: alternate ? "Sinner (25th Anniversary)" : "Sinner",
                      numTracks: alternate ? 14 : 11,
                    },
                    sections: [
                      {
                        links: alternate
                          ? [
                              {
                                platform: "amazonMusic",
                                url: "https://music.amazon.com/albums/B0GSXB6DS8",
                              },
                            ]
                          : [],
                      },
                    ],
                  },
                },
              },
            }) +
            "</script>",
        );
      }
      return Response.json({ results: [], data: [], "release-groups": [] });
    };
  });
  await expect(
    page.getByRole("heading", { name: "Activity", exact: true }),
  ).toBeVisible();
  const pasted =
    "https://music.amazon.fr/albums/B0GSXB6DS8?literal={url}&replace=$&x=$(ignored)";
  const manual = page.getByRole("region", { name: "Run a pasted URL" });
  await manual.getByLabel("URL for external program").fill(pasted);
  await manual
    .getByRole("button", { name: "Run pasted URL", exact: true })
    .click();
  await expect(page.locator(".external-job.complete")).toHaveCount(1);
  expect(
    JSON.parse(await readFile(path.join(cwd, "args.json"), "utf8")),
  ).toEqual([pasted, "--mode", "literal"]);
  await expect(page.locator(".cli-output")).toContainText(
    "catalog lookup skipped",
  );
  expect(await app.evaluate(() => globalThis.lookupCalls.length)).toBe(0);
  for (const url of [
    "file:///C:/music",
    "javascript:alert(1)",
    "https://user:secret@example.com/album",
  ]) {
    const error = await page.evaluate(async (url) => {
      try {
        await window.crate.externalRunUrl(url, "all");
        return "";
      } catch (error) {
        return error.message;
      }
    }, url);
    expect(error).toContain("URL");
  }
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  await expect(page.locator(".record-card .track-count")).toHaveText(
    "Track count unavailable",
  );
  await page.getByRole("button", { name: "Sinner", exact: true }).click();
  await expect(page.locator(".detail-meta .track-count")).toHaveText(
    "11 tracks",
  );
  await expect(page.locator(".record-card .track-count")).toHaveText(
    "11 tracks",
  );
  expect(
    (await page.evaluate(() => window.crate.state())).shelves[item.id].item
      .trackCount,
  ).toBe(11);
  await page.getByRole("button", { name: "Amazon Music", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Only a different edition" }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".amazon-alternatives")).toContainText(
    "Sinner (25th Anniversary) · 14 tracks",
  );
  expect((await app.evaluate(() => globalThis.openedLinks)).at(-1)).toContain(
    "/search/",
  );
  await expect(
    page.getByRole("button", { name: "Retry Amazon lookup", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: path.resolve("artifacts/sinner-track-count-and-links.png"),
  });
  expect(
    await page
      .locator(".detail-scroll")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Run this edition", exact: true })
    .click();
  await expect(page.locator(".external-job.complete")).toHaveCount(2);
  expect(
    JSON.parse(await readFile(path.join(cwd, "args.json"), "utf8"))[0],
  ).toBe("https://music.amazon.com/albums/B0GSXB6DS8");
  await expect(page.locator(".external-job").first()).toContainText(
    "Sinner (25th Anniversary)",
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  await page.getByRole("button", { name: "Sinner", exact: true }).click();
  await page.locator(".external-url-details > summary").click();
  await page
    .locator(".external-url-details")
    .getByLabel("URL for external program")
    .fill("https://soundcloud.com/artist/track?from=record");
  await page
    .locator(".external-url-details")
    .getByRole("button", { name: "Run pasted URL", exact: true })
    .click();
  await expect(page.locator(".external-job.complete")).toHaveCount(3);
  expect(
    JSON.parse(await readFile(path.join(cwd, "args.json"), "utf8"))[0],
  ).toBe("https://soundcloud.com/artist/track?from=record");
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
    path: path.resolve("artifacts/pasted-url-activity-compact.png"),
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS catalog-backed track counts and saved-record hydration, Sinner edition alternatives, explicit pasted URL entry in Activity and record details, literal command arguments, skipped lookup, invalid URL rejection and compact layout",
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close();
}
