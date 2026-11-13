import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AppUpdates } from "../electron/app-updates.mjs";

function fixture(options = {}) {
  const transport = new EventEmitter();
  let checks = 0,
    downloads = 0,
    installs = 0;
  transport.checkForUpdates = async () => {
    checks++;
    transport.emit("checking-for-update");
    transport.emit("update-available", { version: "0.4.2" });
  };
  transport.downloadUpdate = async () => {
    downloads++;
    transport.emit("download-progress", { percent: 51 });
    transport.emit("update-downloaded", { version: "0.4.2" });
  };
  transport.quitAndInstall = (silent, runAfter) => {
    assert.equal(silent, false);
    assert.equal(runAfter, true);
    installs++;
  };
  const events = [];
  const controller = new AppUpdates({
    updater: transport,
    version: "0.4.1",
    emit: (state) => events.push(state),
    busy: () => false,
    ...options,
  });
  return {
    controller,
    transport,
    events,
    counts: () => ({ checks, downloads, installs }),
  };
}

test("concurrent checks download once, retain ready state, and install only explicitly", async () => {
  const f = fixture();
  await Promise.all([f.controller.check(), f.controller.check()]);
  assert.deepEqual(f.counts(), { checks: 1, downloads: 1, installs: 0 });
  assert.equal(f.controller.state.phase, "ready");
  assert.ok(f.events.some((event) => event.percent === 51));
  assert.equal(f.transport.autoInstallOnAppQuit, false);
  assert.equal(f.transport.allowPrerelease, false);
  assert.equal(f.transport.allowDowngrade, false);
  f.transport.emit("error", new Error("late network error"));
  await f.controller.check();
  assert.equal(f.controller.state.phase, "ready");
  assert.equal(f.counts().checks, 1);
  f.controller.install();
  assert.equal(f.counts().installs, 1);
  assert.equal(f.controller.state.phase, "installing");
});

test("busy music work prevents restart and leaves the downloaded update usable", async () => {
  let busy = true;
  const f = fixture({ busy: () => busy });
  assert.throws(() => f.controller.install(), /Download an update/);
  await f.controller.check();
  assert.throws(() => f.controller.install(), /Wait for imports/);
  assert.equal(f.controller.state.phase, "ready");
  assert.equal(f.counts().installs, 0);
  busy = false;
  f.controller.install();
  assert.equal(f.counts().installs, 1);
});

test("offline failure is recoverable and never exposes transport details", async () => {
  const f = fixture();
  const check = f.transport.checkForUpdates;
  f.transport.checkForUpdates = async () => {
    throw new Error("https://secret-token@host/update");
  };
  await f.controller.check();
  assert.equal(f.controller.state.phase, "error");
  assert.doesNotMatch(f.controller.state.message, /secret-token/);
  f.transport.checkForUpdates = check;
  await f.controller.check();
  assert.equal(f.controller.state.phase, "ready");
});

test("failed download can be retried", async () => {
  const f = fixture();
  const download = f.transport.downloadUpdate;
  f.transport.downloadUpdate = async () => {
    throw new Error("interrupted");
  };
  await f.controller.check();
  assert.equal(f.controller.state.phase, "error");
  f.transport.downloadUpdate = download;
  await f.controller.check();
  assert.equal(f.controller.state.phase, "ready");
});

test("disabled builds never check or install, and preference validation is strict", async () => {
  const f = fixture({ unavailable: "Use the installer." });
  f.controller.start();
  await f.controller.check();
  assert.equal(f.controller.state.phase, "disabled");
  assert.deepEqual(f.counts(), { checks: 0, downloads: 0, installs: 0 });
  assert.throws(() => f.controller.setAutomatic("false"), /Invalid/);
  f.controller.setAutomatic(false);
  assert.equal(f.controller.state.automatic, false);
  f.controller.close();
});

test("manual checks work when background updates are off", async () => {
  const f = fixture({ automatic: false });
  await f.controller.check();
  assert.equal(f.controller.state.phase, "ready");
  assert.equal(f.controller.state.automatic, false);
});

test("no newer release skips downloading", async () => {
  const f = fixture();
  f.transport.checkForUpdates = async () =>
    f.transport.emit("update-not-available");
  await f.controller.check();
  assert.equal(f.controller.state.phase, "current");
  assert.ok(f.controller.state.checkedAt);
  assert.equal(f.counts().downloads, 0);
});

test("installer failure restores the restart action", async () => {
  const f = fixture();
  await f.controller.check();
  f.transport.quitAndInstall = () => {
    throw new Error("access denied");
  };
  assert.throws(() => f.controller.install(), /Couldn’t start/);
  assert.equal(f.controller.state.phase, "ready");
});
