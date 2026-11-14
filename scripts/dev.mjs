import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
const server = await createServer();
await server.listen();
server.printUrls();
const env = {
  ...process.env,
  CRATE_DEV_URL: new URL(server.resolvedUrls.local[0]).origin,
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env,
  // Electron is the visible desktop app, even when a tray launcher starts it.
  windowsHide: false,
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code || 0);
});
process.on("SIGINT", () => child.kill());
