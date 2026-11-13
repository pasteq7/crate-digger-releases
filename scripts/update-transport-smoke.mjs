// Run with Electron: node node_modules/electron/cli.js scripts/update-transport-smoke.mjs
// Downloads the built installer through a loopback feed, without installing it.
import { app } from "electron";
import electronUpdater from "electron-updater";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { AppUpdates } from "../electron/app-updates.mjs";

const timeout = setTimeout(() => {
  console.error("Updater transport timed out");
  app.exit(1);
}, 60000);
let server;
async function run() {
  try {
    await mkdir(".test-data", { recursive: true });
    const data = await mkdtemp(path.resolve(".test-data/update-transport-"));
    const manifest = await readFile("release/latest.yml", "utf8");
    const version = manifest.match(/^version: (.+)$/m)[1].trim();
    const filename = manifest.match(/^path: (.+)$/m)[1].trim();
    server = createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/latest.yml") {
        response.end(manifest);
        return;
      }
      if (pathname === `/${filename}`) {
        createReadStream(path.resolve("release", filename)).pipe(response);
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const configPath = path.join(data, "app-update.yml");
    await writeFile(configPath, "updaterCacheDirName: transport-cache\n");
    const updater = new electronUpdater.NsisUpdater({
      provider: "generic",
      url: `http://127.0.0.1:${server.address().port}`,
    });
    updater.currentVersion = new updater.currentVersion.constructor("0.0.0");
    updater.app = {
      version: "0.0.0",
      name: "CrateDiggerTransportTest",
      isPackaged: true,
      userDataPath: data,
      baseCachePath: data,
      appUpdateConfigPath: configPath,
      whenReady: () => app.whenReady(),
    };
    updater.disableDifferentialDownload = true;
    updater.disableWebInstaller = true;
    const events = [];
    const controller = new AppUpdates({
      updater,
      version: "0.0.0",
      emit: (state) => events.push(state),
      busy: () => false,
    });
    const result = await controller.check();
    assert.equal(result.phase, "ready");
    assert.equal(result.nextVersion, version);
    assert.ok(events.some((event) => event.phase === "downloading"));
    assert.ok(updater.installerPath.startsWith(data));
    assert.equal(updater.autoInstallOnAppQuit, false);
    console.log(
      "PASS real NSIS updater: version detection, installer download, SHA-512 verification, isolated cache, ready state; no installation attempted",
    );
    controller.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error);
    server?.closeAllConnections();
    server?.close();
    clearTimeout(timeout);
    app.exit(1);
  }
}
void app.whenReady().then(run);
