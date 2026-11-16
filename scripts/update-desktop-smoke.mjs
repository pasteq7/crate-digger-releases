import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

await mkdir(".test-data", { recursive: true });
const data = await mkdtemp(path.resolve(".test-data/updates-"));
const env = { ...process.env, CRATE_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const initial = await page.evaluate(() => window.crate.updateState());
  expect(initial.phase).toBe("disabled");
  expect(initial.version).toBe(version);
  await page.getByRole("button", { name: /take a look around/ }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "About & updates", exact: true })
    .click();
  const section = page.getByRole("region", { name: "App updates" });
  await expect(
    section.getByText(`Crate Digger ${version}`, { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Check for updates" }),
  ).toBeDisabled();
  // Send transport events through the real main-to-preload subscription, without
  // downloading an installer or allowing the test to restart the machine's app.
  const send = (state) =>
    app.evaluate(({ BrowserWindow }, state) => {
      BrowserWindow.getAllWindows()[0].webContents.send(
        "crate:update-progress",
        state,
      );
    }, state);
  await send({
    ...initial,
    phase: "downloading",
    percent: 42,
    message: "Downloading update…",
  });
  await expect(section.getByRole("progressbar")).toHaveAttribute("value", "42");
  await expect(
    section.getByRole("button", { name: "Downloading…", exact: true }),
  ).toBeDisabled();
  await send({
    ...initial,
    phase: "ready",
    nextVersion: "0.4.2",
    message: "Update downloaded. Restart when you’re ready.",
  });
  const banner = page.getByRole("complementary", { name: "App update" });
  await expect(
    banner.getByRole("button", { name: "Restart to update" }),
  ).toBeEnabled();
  await expect(
    section.getByRole("button", { name: "Restart to update" }),
  ).toBeEnabled();
  // Main still knows this is a disabled development build, so IPC must reject
  // installation even when renderer state has been spoofed.
  await banner.getByRole("button", { name: "Restart to update" }).click();
  await expect(banner).toContainText("Download an update before restarting");
  await page.evaluate(() => window.crate.automaticUpdates(false));
  expect(
    (await page.evaluate(() => window.crate.updateState())).automatic,
  ).toBe(false);
  expect(errors).toEqual([]);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  await page.waitForFunction(() => innerWidth < 900);
  expect(
    await page
      .locator(".workspace")
      .evaluate((el) => el.getBoundingClientRect().width / innerWidth),
  ).toBeGreaterThan(0.9);
  await section.scrollIntoViewIfNeeded();
  await expect(
    section.getByRole("heading", { name: "App updates" }),
  ).toBeInViewport();
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/app-updates.png" });
  console.log(
    "PASS update IPC, Settings, download progress, ready banner, install guard, preferences, compact layout",
  );
} finally {
  await app.close();
}
// Confirm update preferences survive a real process restart, even in sample mode.
const second = await electron.launch({ args: ["."], env, timeout: 60000 });
try {
  const page = await second.firstWindow();
  expect(
    (await page.evaluate(() => window.crate.updateState())).automatic,
  ).toBe(false);
  console.log("PASS update preference persists across restarts");
} finally {
  await second.close();
}
