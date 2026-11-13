import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";

await mkdir(".test-data", { recursive: true });
await mkdir("artifacts", { recursive: true });
const data = await mkdtemp(path.resolve(".test-data/ux-"));
const env = { ...process.env, CRATE_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes("--packaged");
const app = await electron.launch({
  ...(packaged
    ? {
        executablePath: path.resolve(
          process.env.CRATE_PACKAGE_DIR || "release/updated-0.4.0/win-unpacked",
          "Crate Digger.exe",
        ),
        args: [],
      }
    : { args: ["."], cwd: process.cwd() }),
  env,
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.getByRole("button", { name: /take a look around/ }).click();
  await expect(page.locator(".record-card")).toHaveCount(13);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("button")).toHaveCount(3);
  await expect(page.locator(".sidebar")).not.toContainText(
    /YOUR LIBRARY|Maybe|Rejected/,
  );
  const first = page.locator(".record-card").first();
  const title = await first.locator(".record-title").innerText();
  await expect(
    first.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await navigation.getByRole("button", { name: /Wishlist/ }).click();
  await expect(page.locator(".record-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: `Remove ${title} from Wishlist`, exact: true })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".record-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".record-card")).toHaveCount(1);
  await expect(page.locator(".record-card").first()).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.resolve("artifacts/ux-wishlist.png") });
  await page
    .getByRole("button", { name: `Select ${title}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove selected", exact: true })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(0);
  await navigation
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(13);
  await page
    .locator(".record-card")
    .first()
    .getByRole("button", { name: "Less like this", exact: true })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(12);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Review hidden records" }).click();
  await expect(page.locator(".record-card")).toHaveCount(1);
  await page.getByRole("button", { name: /Restore .+ to discovery/ }).click();
  await expect(page.locator(".record-card")).toHaveCount(0);
  await navigation
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await expect(page.locator(".record-card")).toHaveCount(13);
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll(".record-card img")]
          .slice(0, 3)
          .every((img) => img.complete),
      null,
      { timeout: 12000 },
    )
    .catch(() => {});
  await expect(page.locator(".record-card").first()).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.resolve("artifacts/ux-discover.png") });
  await page.getByRole("button", { name: "Switch color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".record-title").first()).toHaveCSS(
    "color",
    "rgb(39, 46, 35)",
  );
  await expect(page.locator(".record-card").first()).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.resolve("artifacts/ux-light.png") });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 700),
  );
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toBeInViewport();
  await navigation.getByRole("button", { name: /Wishlist/ }).click();
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  await page.screenshot({ path: path.resolve("artifacts/ux-compact.png") });
  expect(errors).toEqual([]);
  console.log(
    "PASS simplified navigation, save, remove, undo, persistence, bulk removal, feedback restore, themes, compact layout, and no renderer errors",
  );
} finally {
  await app.close();
}
