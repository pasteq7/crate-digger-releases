import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts", { recursive: true });
const temp = await mkdtemp(path.resolve(".test-data/external-desktop-"));
const root = path.join(temp, "Library"),
  cwd = path.join(temp, "Downloads");
await mkdir(path.join(root, "Dub"), { recursive: true });
await mkdir(cwd);
const fixture = spawnSync(
  "C:\\Python312\\python.exe",
  ["scripts/import-fixture.py", temp],
  { windowsHide: true },
);
if (fixture.status !== 0) throw new Error(fixture.stderr.toString());
const program = path.join(temp, "external tool.mjs");
await writeFile(
  program,
  `import { mkdirSync, copyFileSync } from 'node:fs';
console.log('Amazon URL:', process.argv[2]); console.error('Encoding complete');
mkdirSync('External Album'); copyFileSync(${JSON.stringify(path.join(temp, "01 Dub.wav"))}, 'External Album/01 Dub.wav');`,
);
const item = {
  id: "external-smoke",
  kind: "album",
  title: "External Album",
  artist: "Test Artist",
  genre: "Dub",
  year: 2026,
  cover: "",
  preview: null,
  reason: "Test",
  seeds: [],
  sourceFolder: "",
};
const env = { ...process.env, CRATE_DATA_DIR: path.join(temp, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.argv.includes("--packaged")
    ? {
        executablePath: path.resolve(
          "release/external-integration-0.4.0/win-unpacked/Crate Digger.exe",
        ),
        args: [],
      }
    : { args: ["."], cwd: process.cwd() }),
  env,
  timeout: 60000,
});
const errors = [];
app.process().stderr.on("data", chunk => {
  const message = chunk.toString();
  if (/preload|Error:|ERR_FILE/.test(message)) console.error(message);
});
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForLoadState("domcontentloaded");
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  await page.waitForFunction(() => !!window.crate, null, { timeout: 10000 });
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
    globalThis.fetch = async () => new Response("{}", { status: 404 });
  }, root);
  await page.evaluate(async (item) => {
    await window.crate.chooseFolder();
    await window.crate.shelf(item, "wishlist");
  }, item);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Program command", { exact: true })
    .fill(
      `"${process.execPath}" "${program}" {amazonUrl} --quality "high quality"`,
    );
  await page
    .getByLabel("Working folder", { exact: true })
    .selectOption("custom");
  await page.getByLabel("Custom folder path").fill(cwd);
  await page.getByLabel("Import music after the command succeeds").check();
  await page.getByLabel("Import destination folder").selectOption("Dub");
  await page.getByRole("button", { name: /Save/ }).last().click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await page.locator(".external-settings").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/external-settings.png" });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Wishlist/ })
    .click();
  await page
    .getByRole("button", { name: "More about External Album", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Run external program for External Album",
      exact: true,
    })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Activity", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".external-job.complete")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".cli-output")).toContainText(
    "Amazon URL: https://music.amazon.",
  );
  await expect(page.locator(".cli-output")).toContainText("Encoding complete");
  await expect(page.locator(".cli-output")).toContainText(
    "Tagging and moving finished",
  );
  await page.screenshot({ path: "artifacts/external-activity.png" });
  const state = await page.evaluate(() => window.crate.state());
  const imported = state.imports.find((j) => j.name === "External Album");
  expect(imported.phase).toBe("complete");
  expect(imported.sourceRemoved).toBe(true);
  expect(imported.destination).toBe(path.join(root, "Dub", "External Album"));
  expect(
    await stat(path.join(imported.destination, "01 Dub.wav")),
  ).toBeTruthy();
  await expect(stat(path.join(cwd, "External Album"))).rejects.toThrow();
  const tag = spawnSync(
    "C:\\Python312\\python.exe",
    [
      "-c",
      "from mutagen.wave import WAVE; import sys; print(WAVE(sys.argv[1]).tags['TCON'].text[0])",
      path.join(imported.destination, "01 Dub.wav"),
    ],
    { windowsHide: true },
  );
  expect(tag.stdout.toString().trim()).toBe("Dub");
  await page.getByRole("button", { name: "View imports" }).click();
  await expect(
    page.getByRole("heading", { name: "Import music", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Program command", { exact: true })).toHaveValue(
    `"${process.execPath}" "${program}" {amazonUrl} --quality "high quality"`,
  );
  await page.evaluate(
    async ({ item, root }) => {
      await window.crate.settings({
        externalCwdMode: "scan",
        externalDestinationFolder: "",
      });
      await window.crate.externalRun(item, `folder:${root}\\Dub`);
    },
    { item, root },
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          async () => (await window.crate.state()).externalJobs.at(-1)?.phase,
        ),
      { timeout: 30000 },
    )
    .toBe("complete");
  const rootState = await page.evaluate(() => window.crate.state());
  expect(rootState.externalJobs.at(-1).cwd).toBe(root);
  expect(rootState.externalJobs.at(-1).output).toContain(
    "Output held for tagging",
  );
  expect(rootState.imports.at(-1).destination).toBe(
    path.join(root, "External Album"),
  );
  expect(rootState.imports.at(-1).sourceRemoved).toBe(true);
  expect(
    await readFile(
      path.join(root, "External Album", ".crate-digger-import.json"),
      "utf8",
    ),
  ).toContain('"genre": "Library"');
  expect(errors).toEqual([]);
  console.log(
    "PASS external command settings, album button, IPC, CLI output, custom/scan-root working folders, real tagging/moving, and import navigation",
  );
} finally {
  // Force test-only teardown even when an assertion fires while an import is active.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
