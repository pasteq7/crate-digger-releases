import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  ExternalProgram,
  commandArgs,
  externalDefaults,
  validateExternalSettings,
} from "../electron/external-program.mjs";

const url = "https://music.amazon.com/albums/EXAMPLE?x=1&y=$(echo-no)";
test("command templates preserve quoted Windows paths and URL as one literal argument", () => {
  assert.deepEqual(
    commandArgs(
      '"C:\\Program Files\\Tool\\tool.exe" {amazonUrl} --format "high quality"',
      url,
    ),
    ["C:\\Program Files\\Tool\\tool.exe", url, "--format", "high quality"],
  );
  assert.deepEqual(commandArgs("tool --flag", url), ["tool", url, "--flag"]);
  assert.deepEqual(commandArgs('tool --url="{amazonUrl}" ""', url), [
    "tool",
    `--url=${url}`,
    "",
  ]);
  assert.throws(() => commandArgs('"unfinished', url), /quote/);
  assert.throws(() => commandArgs("", url), /Settings/);
  assert.throws(
    () =>
      validateExternalSettings({
        ...externalDefaults,
        externalAutoOpenImport: "yes",
      }),
    /Invalid/,
  );
});

async function fixture(script, overrides = {}) {
  await mkdir(".test-data", { recursive: true });
  const base = await mkdtemp(path.resolve(".test-data/external-"));
  const cwd = path.join(base, "working folder"),
    root = path.join(base, "library");
  await mkdir(cwd);
  await mkdir(root);
  await mkdir(path.join(root, "Dub"));
  const program = path.join(base, "program.mjs");
  await writeFile(program, script);
  const importer = {
    jobs: [],
    stagingForRoot: () => path.join(base, "staging"),
    async enqueue(files, options) {
      for (const source of files)
        this.jobs.push({
          id: String(this.jobs.length),
          zip: source,
          options,
          phase: "complete",
        });
      return this.jobs;
    },
  };
  const updates = [];
  const runner = new ExternalProgram({
    importer,
    emit: (jobs) => updates.push(structuredClone(jobs)),
    scratch: path.join(base, "scratch"),
  });
  const settings = {
    ...externalDefaults,
    externalCommand: `"${process.execPath}" "${program}" {amazonUrl} --flag`,
    externalCwdMode: "custom",
    externalCwd: cwd,
    importRoot: root,
    ...overrides,
  };
  const start = (s = settings, extra = {}) =>
    runner.start({
      item: { artist: "Test", title: "Album", sourceFolder: "" },
      amazonUrl: url,
      exact: true,
      roots: [root],
      scope: "all",
      settings: s,
      ...extra,
    });
  const importOutput = (id, options = {}) =>
    runner.importJob(id, {
      root,
      destinationFolder: "Dub",
      tagGenre: true,
      cleanComments: true,
      ...options,
    });
  return {
    base,
    cwd,
    root,
    importer,
    runner,
    updates,
    settings,
    start,
    importOutput,
  };
}
async function finished(runner) {
  const deadline = Date.now() + 10000;
  while (runner.running && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(runner.running, false, "program must finish");
  return runner.jobs.at(-1);
}
test("executes in custom cwd, streams stdout/stderr, passes literal URL, and rejects simultaneous runs", async () => {
  const f = await fixture(
    'console.log(process.cwd()); console.log(JSON.stringify(process.argv.slice(2))); console.error("stderr line"); setTimeout(() => {}, 150);',
  );
  await f.start();
  await assert.rejects(f.start(), /already running/);
  const job = await finished(f.runner);
  assert.equal(job.phase, "complete");
  assert.equal(job.exitCode, 0);
  assert.ok(job.output.includes(f.cwd));
  assert.ok(job.output.includes(JSON.stringify([url, "--flag"])));
  assert.ok(job.output.includes("stderr line"));
  assert.ok(
    f.updates.some(
      (jobs) =>
        jobs[0].phase === "running" && jobs[0].output.includes("stderr line"),
    ),
  );
});
test("failed exits and spawn errors skip automatic import and release the runner", async () => {
  const f = await fixture('console.error("failure"); process.exit(7);', {
    externalAutoOpenImport: true,
  });
  await f.start();
  const job = await finished(f.runner);
  assert.equal(job.phase, "failed");
  assert.equal(job.exitCode, 7);
  assert.equal(f.importer.jobs.length, 0);
  await f.start({
    ...f.settings,
    externalCommand: '"missing-crate-digger-program.exe"',
  });
  assert.equal((await finished(f.runner)).phase, "failed");
});
test("imports only new output, carries tag routing, and retains modified existing files", async () => {
  const f = await fixture(
    `import { mkdirSync, writeFileSync } from 'node:fs';
    mkdirSync('New album'); writeFileSync('New album/01.wav', 'audio');
    writeFileSync('old.wav', 'changed'); writeFileSync('download.zip', 'zip');
    writeFileSync('loose.wav', 'loose'); writeFileSync('cover.jpg', 'cover');`,
    { externalAutoOpenImport: true },
  );
  await writeFile(path.join(f.cwd, "old.wav"), "original");
  await f.start();
  const job = await finished(f.runner);
  assert.equal(job.phase, "complete");
  assert.equal(
    f.importer.jobs.length,
    0,
    "completion only prepares output for review",
  );
  assert.equal(job.outputPaths.length, 3);
  await f.importOutput(job.id);
  assert.equal(job.importIds.length, 3);
  assert.equal(await readFile(path.join(f.cwd, "old.wav"), "utf8"), "changed");
  assert.ok(!f.importer.jobs.some((j) => j.zip.endsWith("old.wav")));
  assert.ok(
    f.importer.jobs.every(
      (j) =>
        j.options.destinationFolder === "Dub" &&
        j.options.tagGenre &&
        j.options.cleanComments,
    ),
  );
  const loose = f.importer.jobs.find((j) => j.zip.includes("scratch"));
  assert.equal(
    await readFile(path.join(loose.zip, "loose.wav"), "utf8"),
    "loose",
  );
  assert.equal(
    await readFile(path.join(loose.zip, "cover.jpg"), "utf8"),
    "cover",
  );
  await assert.rejects(stat(path.join(f.cwd, "loose.wav")), { code: "ENOENT" });
});
test("scan mode uses selected root and root output is held safely before tagging", async () => {
  const f = await fixture(
    `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('New album'); writeFileSync('New album/01.wav', 'audio');`,
    {
      externalAutoOpenImport: true,
      externalCwdMode: "scan",
    },
  );
  await f.start(f.settings, { scope: `folder:${path.join(f.root, "Dub")}` });
  const job = await finished(f.runner);
  assert.equal(job.cwd, f.root);
  assert.equal(job.phase, "complete");
  await f.importOutput(job.id, { destinationFolder: "" });
  assert.ok(f.importer.jobs[0].zip.includes("external-output"));
  assert.equal(
    await readFile(path.join(f.importer.jobs[0].zip, "01.wav"), "utf8"),
    "audio",
  );
  await assert.rejects(
    f.start(f.settings, { roots: [f.root, f.cwd], scope: "all" }),
    /Select a scanned folder/,
  );
});
test("stop terminates a running program and prevents automatic import", async () => {
  const f = await fixture(
    'console.log("ready"); setInterval(() => {}, 1000);',
    { externalAutoOpenImport: true },
  );
  const job = await f.start();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(f.runner.cancel(job.id), true);
  assert.equal((await finished(f.runner)).phase, "cancelled");
  assert.equal(f.importer.jobs.length, 0);
});

test("handoff detects output without a configured destination and never imports automatically", async () => {
  const f = await fixture(
    `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('New album'); writeFileSync('New album/01.wav', 'audio');`,
    { externalAutoOpenImport: true, importRoot: "" },
  );
  await f.start();
  const job = await finished(f.runner);
  assert.equal(job.autoOpenImport, true);
  assert.deepEqual(job.outputPaths, [path.join(f.cwd, "New album")]);
  assert.equal(f.importer.jobs.length, 0);
  await assert.rejects(
    f.importOutput(job.id, { destinationFolder: "../outside" }),
    /destination/,
  );
  assert.equal(job.phase, "complete");
  assert.equal(
    await readFile(path.join(f.cwd, "New album", "01.wav"), "utf8"),
    "audio",
  );
  await f.importOutput(job.id);
  await assert.rejects(f.importOutput(job.id), /completed run/);
});

test("activity cleanup removes finished and stopped entries while retaining running jobs and output files", async () => {
  const f = await fixture(
    `import { writeFileSync } from 'node:fs'; writeFileSync('new.zip', 'zip');`,
  );
  await f.start();
  const completed = await finished(f.runner);
  await writeFile(
    path.join(f.base, "program.mjs"),
    'console.log("ready"); setInterval(() => {}, 1000);',
  );
  const active = await f.start();
  f.runner.clear(active.id);
  assert.equal(f.runner.jobs.length, 2);
  f.runner.clear(completed.id);
  assert.deepEqual(
    f.runner.jobs.map((job) => job.id),
    [active.id],
  );
  assert.equal(f.runner.outputs.has(completed.id), false);
  assert.equal(await readFile(path.join(f.cwd, "new.zip"), "utf8"), "zip");
  f.runner.clear();
  assert.equal(f.runner.jobs.length, 1);
  f.runner.cancel(active.id);
  await finished(f.runner);
  f.runner.clear();
  assert.equal(f.runner.jobs.length, 0);
  await assert.rejects(f.importOutput(completed.id), /completed run/);
});

test("activity cleanup retains a run until its import finishes", async () => {
  const f = await fixture(
    `import { writeFileSync } from 'node:fs'; writeFileSync('new.zip', 'zip');`,
  );
  await f.start();
  const job = await finished(f.runner);
  f.importer.enqueue = async function (files) {
    this.jobs.push({ id: "pending-import", zip: files[0], phase: "queued" });
  };
  const importing = f.importOutput(job.id);
  const deadline = Date.now() + 5000;
  while (!f.importer.jobs.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(job.phase, "importing");
  f.runner.clear();
  assert.equal(f.runner.jobs.length, 1);
  f.importer.jobs[0].phase = "complete";
  await importing;
  f.runner.clear();
  assert.equal(f.runner.jobs.length, 0);
});
