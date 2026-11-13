import { _electron as electron } from "playwright";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
await mkdir(".test-data", { recursive: true });
const data = await mkdtemp(path.resolve(".test-data/visual-"));
const env = { ...process.env, CRATE_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ["."],
  cwd: process.cwd(),
  env,
  timeout: 60000,
});
const page = await app.firstWindow();
page.on("requestfailed", (r) =>
  console.log("FAILED", r.url().split("?")[0], r.failure()),
);
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});
await page.getByRole("button", { name: /take a look around/ }).click();
await page.waitForFunction(
  () => document.querySelectorAll(".record-card").length > 0,
);
await page
  .waitForFunction(
    () =>
      [...document.querySelectorAll(".record-card img")]
        .slice(0, 3)
        .every((i) => i.complete),
    null,
    { timeout: 30000 },
  )
  .catch((e) => console.log("Image timeout"));
console.log(
  await page
    .locator("img")
    .evaluateAll((imgs) =>
      imgs.map((i) => ({
        src: i.src,
        complete: i.complete,
        width: i.naturalWidth,
        box: i.getBoundingClientRect().toJSON(),
      })),
    ),
);
await page.screenshot({ path: path.resolve("artifacts/discover-full.png") });
await app.close();
