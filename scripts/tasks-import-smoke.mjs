import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  writeFile,
  copyFile,
  readFile,
  stat,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { Store } from "../electron/store.mjs";
import { Scanner } from "../electron/scanner.mjs";
import { existsSync } from "node:fs";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts/quiet-collection", { recursive: true });
const profile = await mkdtemp(path.resolve(".test-data/tasks-")),
  root = path.join(profile, "Music"),
  output = path.join(profile, "Output");
await mkdir(root);
await mkdir(output);
const python =
  process.env.CRATE_PYTHON ||
  (existsSync("C:\\Python312\\python.exe")
    ? "C:\\Python312\\python.exe"
    : "python");
const fixture = spawnSync(python, ["scripts/import-fixture.py", profile], {
  windowsHide: true,
});
if (fixture.status !== 0) throw new Error(fixture.stderr.toString());
const original = path.join(profile, "01 Dub.wav");
await copyFile(original, path.join(root, "Owned.wav"));
const hash = (b) => createHash("sha256").update(b).digest("hex"),
  before = hash(await readFile(path.join(root, "Owned.wav")));
const program = path.join(profile, "tool.mjs");
await writeFile(
  program,
  `import {mkdirSync,copyFileSync} from 'node:fs';console.log('Received:',process.argv[2]);console.log('\\x1b[32mFinished fixture\\x1b[0m');mkdirSync('New album');copyFileSync(${JSON.stringify(original)},'New album/01 Dub.wav');`,
);
const store = new Store(path.join(profile, "crate-digger.sqlite"));
store.set("folders", [root]);
store.set("settings", {
  view: "imports",
  autoScan: false,
  externalCommand: `"${process.execPath}" "${program}" {url}`,
  externalCwdMode: "custom",
  externalCwd: output,
  externalAutoOpenImport: false,
});
await new Scanner(store, () => {}).scan([root]);
store.close();
const env = { ...process.env, CRATE_DATA_DIR: profile, CRATE_PYTHON: python };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ["."],
  cwd: process.cwd(),
  env,
  timeout: 60000,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.locator(".import-link-source > details > summary").click();
  const url =
    "https://music.example/album?literal={url}&argument=$&test=$(not-a-shell)";
  await page.getByLabel("URL for external program", { exact: true }).fill(url);
  await page
    .getByRole("button", { name: "Run pasted URL", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tasks-drawer")).not.toContainText("Total tokens");
  await page.waitForFunction(async () =>
    (await window.crate.state()).externalJobs.some(
      (j) => j.phase === "complete",
    ),
  );
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator(".task-row > details > summary").click();
  await expect(page.locator(".cli-output")).toContainText(url);
  await expect(page.locator(".cli-output")).toContainText("Finished fixture");
  await expect(page.locator(".cli-output")).not.toContainText("\x1b");
  await page.screenshot({
    path: "artifacts/quiet-collection/task-details.png",
  });
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await page
    .getByRole("button", { name: "Review import", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Program output ready to import" }),
  ).toContainText("New album");
  const pre = await page.evaluate(() => window.crate.state());
  expect(pre.imports).toHaveLength(0);
  await page
    .getByRole("button", { name: "Import program output", exact: true })
    .click();
  await expect(page.locator(".import-job.complete")).toHaveCount(1, {
    timeout: 30000,
  });
  const result = await page.evaluate(() => window.crate.state());
  expect(result.imports[0].phase).toBe("complete");
  expect(result.imports[0].sourceRemoved).toBe(true);
  expect(await stat(path.join(root, "New album", "01 Dub.wav"))).toBeTruthy();
  await expect(stat(path.join(output, "New album"))).rejects.toThrow();
  expect(hash(await readFile(path.join(root, "Owned.wav")))).toBe(before);
  expect(errors).toEqual([]);
  console.log(
    "PASS From link launcher, literal command arguments, focused Tasks/history/logs, explicit output review, verified folder import, and unchanged existing music",
  );
} finally {
  await app.close();
}
