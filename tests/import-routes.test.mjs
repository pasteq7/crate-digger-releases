import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { importRoutes } from "../electron/import-routes.mjs";
test("import destinations come from actual root folders, include nested folders, and refresh new names", async () => {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data/routes-"));
  await mkdir(path.join(root, "Unusual local folder", "Albums"), {
    recursive: true,
  });
  await mkdir(path.join(root, ".crate-digger-import-staging", "pending"), {
    recursive: true,
  });
  await writeFile(path.join(root, "not-a-folder.txt"), "ignored");
  const first = await importRoutes(root);
  assert.deepEqual(first.folders, [
    "Unusual local folder",
    path.join("Unusual local folder", "Albums"),
  ]);
  assert.equal(first.root.toLowerCase(), root.toLowerCase());
  await mkdir(path.join(root, "New folder from disk"));
  assert.ok(
    (await importRoutes(root)).folders.includes("New folder from disk"),
  );
  assert.deepEqual(await importRoutes(""), {
    root: "",
    folders: [],
    truncated: false,
  });
});
