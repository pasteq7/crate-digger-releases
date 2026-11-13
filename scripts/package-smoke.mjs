import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
await mkdir(".test-data", { recursive: true });
const data = await mkdtemp(path.resolve(".test-data/packaged-"));
const env = { ...process.env, CRATE_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: path.resolve(
    process.env.CRATE_PACKAGE_DIR || "release/win-unpacked",
    "Crate Digger.exe",
  ),
  args: [],
  env,
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await expect(
    page.getByRole("button", { name: "Choose your music folder", exact: true }),
  ).toBeVisible();
  const state = await page.evaluate(() => window.crate.state());
  expect(state.tracks).toEqual([]);
  expect(state.folders).toEqual([]);
  const info = await app.evaluate(({ app }) => ({
    name: app.getName(),
    packaged: app.isPackaged,
    version: app.getVersion(),
  }));
  expect(info.packaged).toBe(true);
  const update = await page.evaluate(() => window.crate.updateState());
  expect(update.version).toBe(info.version);
  expect(update.phase).toBe("disabled"); // Unpacked copies must not install NSIS updates.
  const feed = await readFile(
    path.resolve(
      process.env.CRATE_PACKAGE_DIR || "release/win-unpacked",
      "resources/app-update.yml",
    ),
    "utf8",
  );
  expect(feed).toContain("repo: crate-digger-releases");
  expect(feed).toContain("owner: pasteq7");
  console.log(
    "PASS packaged updater bridge, release source, and unpacked-build guard",
  );
  console.log(
    "PASS packaged executable, local SQLite, isolated preload, and first-launch screen",
    info,
  );
  await page.getByRole("button", { name: /take a look around/ }).click();
  await expect(page.locator(".record-card")).toHaveCount(13);
  console.log("PASS packaged assets and sample collection");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page
    .getByRole("combobox", { name: "AI provider" })
    .selectOption("gemini");
  await expect(
    page.getByRole("textbox", { name: "Model", exact: true }),
  ).toHaveValue("gemini-3.8-flash");
  console.log("PASS packaged Google Gemini settings");
  await expect(
    page.getByRole("button", { name: "Check connection", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => typeof window.crate.testAi)).toBe(
    "function",
  );
  console.log("PASS packaged connection check bridge and sample privacy guard");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await page.getByRole("button", { name: "Personal picks", exact: true }).click();
  await expect(page.getByText("Find your next favorite.")).toBeVisible();
  expect(await page.evaluate(() => typeof window.crate.aiDiscover)).toBe(
    "function",
  );
  expect(await page.evaluate(() => typeof window.crate.aiContext)).toBe(
    "function",
  );
  console.log("PASS packaged AI discovery page and native bridge");
} finally {
  await app.close();
}
