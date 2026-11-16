import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  copyFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
await mkdir(".test-data", { recursive: true });
await mkdir("artifacts", { recursive: true });
const temp = await mkdtemp(path.resolve(".test-data/import-desktop-"));
const root = path.join(temp, "Music");
await mkdir(root);
await mkdir(path.join(root, "Dub"));
const fixture = spawnSync(
  "C:\\Python312\\python.exe",
  ["scripts/import-fixture.py", temp],
  { windowsHide: true },
);
if (fixture.status !== 0) throw new Error(fixture.stderr.toString());
const zip = path.join(temp, "Test Album.zip");
const incoming = path.join(temp, "Folder Album");
await mkdir(incoming);
await copyFile(
  path.join(temp, "01 Dub.wav"),
  path.join(incoming, "01 Dub.wav"),
);
await writeFile(
  path.join(incoming, "unknown-sidecar.bin"),
  "Preserve every sidecar",
);
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const before = await hash(zip);
const env = { ...process.env, CRATE_DATA_DIR: path.join(temp, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes("--packaged");
const app = await electron.launch({
  ...(packaged
    ? {
        executablePath: path.resolve(
          process.env.CRATE_PACKAGE_DIR || "release/win-unpacked",
          "Crate Digger.exe",
        ),
        args: [],
      }
    : { args: ["."], cwd: process.cwd() }),
  env,
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ dialog, shell, clipboard }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
    globalThis.testExternal = [];
    globalThis.testClipboard = [];
    shell.openExternal = async (url) => {
      globalThis.testExternal.push(url);
    };
    clipboard.writeText = (text) => globalThis.testClipboard.push(text);
    globalThis.fetch = async (url) => {
      if (String(url).startsWith("https://album.link/"))
        return new Response(
          '<script id="__NEXT_DATA__">' +
            JSON.stringify({
              props: {
                pageProps: {
                  pageData: {
                    entityData: {
                      type: "album",
                      artistName: "Beach House",
                      title: "Bloom",
                    },
                    sections: [
                      {
                        links: [
                          {
                            platform: "amazonMusic",
                            url: "https://music.amazon.com/albums/B00DVSJVK8",
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            }) +
            "</script>",
        );
      return Response.json({ results: [], "release-groups": [], data: [] });
    };
  }, root);
  await page.getByRole("button", { name: "Import music", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose folder", exact: true })
    .click();
  await expect(page.getByText(root, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Dub", exact: true }),
  ).toHaveCount(1);
  await page
    .getByLabel("Import destination folder", { exact: true })
    .selectOption("Dub");
  await page
    .getByRole("switch", {
      name: "Set genre tag to destination folder name",
      exact: true,
    })
    .check();
  await page.evaluate(async () => {
    const item = {
      id: "import-wish",
      kind: "album",
      artist: "Test Artist",
      title: "Test Album (Deluxe Edition)",
      genre: "Dub",
      year: null,
      cover: "",
      preview: null,
      reason: "",
      seeds: [],
      sourceFolder: "",
    };
    await window.crate.shelf(item, "wishlist");
    await window.crate.shelf(
      { ...item, id: "other-wish", title: "Another Album" },
      "wishlist",
    );
  });
  // A native-backed File is essential: constructed JS Files have no filesystem path.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "test-native-file";
    input.hidden = true;
    document.body.appendChild(input);
  });
  await page.locator("#test-native-file").setInputFiles(zip);
  await page.evaluate(() => {
    const input = document.querySelector("#test-native-file");
    const dt = new DataTransfer();
    dt.items.add(input.files[0]);
    document.querySelector(".import-drop-zone").dispatchEvent(
      new DragEvent("dragenter", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".file-drop-overlay")).toHaveCount(0);
  await expect(page.locator(".import-drop-zone")).toHaveClass(/is-dragging/);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(document.querySelector("#test-native-file").files[0]);
    document.querySelector(".import-drop-zone").dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".file-drop-overlay")).toHaveCount(0);
  await expect(page.locator(".import-job.complete")).toHaveCount(1, {
    timeout: 45000,
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.crate.state())).tracks.length,
      { timeout: 15000 },
    )
    .toBe(1);
  const state = await page.evaluate(() => window.crate.state());
  expect(state.shelves["import-wish"]).toBeUndefined();
  expect(state.shelves["other-wish"].status).toBe("wishlist");
  expect(state.tracks[0].genre).toBe("Dub");
  expect(state.tracks[0].artist).toBe("Test Artist");
  expect(state.tracks[0].album).toBe("Test Album");
  expect(state.folders).toContain(root);
  expect(
    path.relative(root, state.imports[0].stagingRoot).startsWith(".."),
  ).toBe(true);
  expect(await hash(zip)).toBe(before);
  await page.screenshot({ path: path.resolve("artifacts/zip-import.png") });
  console.log(
    "PASS native file drop, automatic ZIP extraction/tagging/routing, source ZIP retained, library rescanned, matching Wishlist entry cleared",
  );
  await mkdir(path.join(root, "Roots & Steppers"));
  await page
    .getByRole("button", { name: "Refresh folders", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: "Roots & Steppers", exact: true }),
  ).toHaveCount(1);
  await page
    .getByLabel("Import destination folder", { exact: true })
    .selectOption("");
  await page
    .getByRole("switch", {
      name: "Set genre tag to destination folder name",
      exact: true,
    })
    .uncheck();
  const cdp = await page.context().newCDPSession(page);
  await page.locator(".import-drop-zone").scrollIntoViewIfNeeded();
  const box = await page.locator(".import-drop-zone").boundingBox();
  const dropX = box.x + box.width / 2,
    dropY = box.y + box.height / 2;
  const data = { items: [], files: [incoming], dragOperationsMask: 1 };
  await cdp.send("Input.dispatchDragEvent", {
    type: "dragEnter",
    x: dropX,
    y: dropY,
    data,
  });
  await cdp.send("Input.dispatchDragEvent", {
    type: "dragOver",
    x: dropX,
    y: dropY,
    data,
  });
  await expect(page.locator(".file-drop-overlay")).toHaveCount(0);
  await expect(page.locator(".import-drop-zone")).toHaveClass(/is-dragging/);
  await cdp.send("Input.dispatchDragEvent", {
    type: "drop",
    x: dropX,
    y: dropY,
    data,
  });
  await expect(page.locator(".import-job.complete")).toHaveCount(2, {
    timeout: 45000,
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.crate.state())).tracks.length,
      { timeout: 15000 },
    )
    .toBe(2);
  const moved = (await page.evaluate(() => window.crate.state())).imports.find(
    (j) => j.kind === "folder",
  );
  expect(moved.sourceRemoved).toBe(true);
  expect(moved.destination).toBe(path.join(root, "Folder Album"));
  const movedTrack = (
    await page.evaluate(() => window.crate.state())
  ).tracks.find((t) => t.path.includes("Folder Album"));
  expect(movedTrack.genre).toBe("Old Genre");
  expect(
    await stat(incoming)
      .then(() => true)
      .catch(() => false),
  ).toBe(false);
  expect(
    await readFile(path.join(moved.destination, "unknown-sidecar.bin"), "utf8"),
  ).toBe("Preserve every sidecar");
  await page.locator(".import-jobs").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.resolve("artifacts/folder-and-zip-import.png"),
  });
  console.log(
    "PASS native folder drop to scan root, genre toggle off preserves tags, folder refresh finds actual directories, sidecars preserved and original removed after verification",
  );
  const release = {
    id: "test",
    kind: "album",
    artist: "Beach House",
    title: "Bloom",
    album: "Bloom",
    storeUrl: "https://music.apple.com/us/album/bloom/509665145",
  };
  const direct = await page.evaluate(
    (item) => window.crate.musicLink(item, "copy"),
    release,
  );
  expect(direct.exact).toBe(true);
  expect(await app.evaluate(() => globalThis.testClipboard)).toEqual([
    "https://music.amazon.com/albums/B00DVSJVK8",
  ]);
  const fallback = await page.evaluate(
    (item) =>
      window.crate.musicLink({ ...item, storeUrl: undefined }, "amazon"),
    release,
  );
  expect(fallback.exact).toBe(false);
  await page.evaluate(
    (item) => window.crate.musicLink(item, "youtube"),
    release,
  );
  expect(await app.evaluate(() => globalThis.testExternal)).toEqual([
    fallback.amazon,
    direct.youtube,
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "About & updates", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Explore sample", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(async (item) => {
    await window.crate.shelf(
      {
        ...item,
        genre: "Dream pop",
        year: 2012,
        cover: "",
        preview: null,
        reason: "",
        seeds: [],
        sourceFolder: "",
      },
      "wishlist",
    );
    localStorage.setItem("crate-demo", "true");
  }, release);
  await page.reload();
  await expect(page.locator(".demo-note")).toHaveCount(0);
  await page.getByRole("button", { name: /^Wishlist/ }).click();
  await page.locator(".record-title").filter({ hasText: "Bloom" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Record details" })
      .getByRole("button", { name: /Copy Amazon Music URL/ }),
  ).toBeVisible();
  await page.screenshot({
    path: path.resolve("artifacts/discovery-links.png"),
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS direct Amazon copy, explicit search fallback, YouTube search, detail links and isolated clipboard",
  );
} finally {
  await app.close();
}
