// Recovery helper for networks where @electron/get's downloader stalls.
// Downloads the official runtime and verifies Electron's published checksum.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const pkg = JSON.parse(
  await readFile(
    new URL("../node_modules/electron/package.json", import.meta.url),
    "utf8",
  ),
);
const file = `electron-v${pkg.version}-${process.platform}-${process.arch}.zip`;
const url = `https://github.com/electron/electron/releases/download/v${pkg.version}/${file}`;
console.log(`Downloading official Electron ${pkg.version}…`);
const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
if (!response.ok)
  throw new Error(`Runtime download returned ${response.status}`);
const chunks = [];
let bytes = 0,
  last = 0;
for await (const chunk of response.body) {
  chunks.push(chunk);
  bytes += chunk.length;
  if (Date.now() - last > 5000) {
    console.log(`${Math.round(bytes / 1048576)} MB received`);
    last = Date.now();
  }
}
const data = Buffer.concat(chunks);
const checks = JSON.parse(
  await readFile(
    new URL("../node_modules/electron/checksums.json", import.meta.url),
    "utf8",
  ),
);
const expected = checks[file];
if (!expected) throw new Error("No official checksum found for this runtime.");
if (createHash("sha256").update(data).digest("hex") !== expected)
  throw new Error("Runtime checksum mismatch.");
const out = new URL("../electron-runtime.zip", import.meta.url);
await writeFile(out, data);
const { default: extract } = await import("@electron-internal/extract-zip");
await extract(fileURLToPath(out), {
  dir: path.resolve("node_modules/electron/dist"),
});
await writeFile(
  new URL("../node_modules/electron/path.txt", import.meta.url),
  process.platform === "win32"
    ? "electron.exe"
    : process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : "electron",
);
console.log(
  `Verified and installed ${Math.round(bytes / 1048576)} MB runtime.`,
);
