import { spawn } from "node:child_process";
import {
  readdir,
  realpath,
  stat,
  mkdir,
  copyFile,
  unlink,
  rename,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { terminalOutputFilter } from "./terminal-output.mjs";

const audio = new Set(
  ".mp3 .flac .m4a .aac .ogg .opus .wav .aiff .aif .wma .ape .wv".split(" "),
);
export const externalDefaults = {
  externalCommand: "",
  externalCwdMode: "scan",
  externalCwd: "",
  externalAutoOpenImport: false,
};
export function validateExternalSettings(s) {
  for (const key of ["externalCommand", "externalCwd"])
    if (
      typeof s[key] !== "string" ||
      s[key].length > 8192 ||
      /[\0\r\n]/.test(s[key])
    )
      throw new Error("Invalid external program settings.");
  if (
    !["scan", "custom"].includes(s.externalCwdMode) ||
    typeof s.externalAutoOpenImport !== "boolean"
  )
    throw new Error("Invalid external program settings.");
}
// Parse quoted paths and arguments without interpreting shell operators or URL characters.
export function commandArgs(command, amazonUrl) {
  const parts = [];
  let word = "",
    quote = "",
    started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "\\" && command[i + 1] === quote && quote) {
      word += quote;
      i++;
    } else if (quote) {
      if (c === quote) quote = "";
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) {
        parts.push(word);
        word = "";
        started = false;
      }
    } else {
      word += c;
      started = true;
    }
  }
  if (quote) throw new Error("Close the quote in your external command.");
  if (started) parts.push(word);
  if (!parts[0])
    throw new Error("Set an external program command in Settings first.");
  if (parts[0].includes("{amazonUrl}"))
    throw new Error("Put {amazonUrl} after the program name.");
  const hasUrl = parts.some((p) => p.includes("{amazonUrl}"));
  const result = parts.map((p) => p.replaceAll("{amazonUrl}", amazonUrl));
  if (!hasUrl) result.splice(1, 0, amazonUrl);
  return result;
}
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return (
    !rel ||
    (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
};
export async function scanSnapshot(root) {
  const files = new Map(),
    dirs = new Set([root]);
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith(".crate-digger") ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      )
        continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.add(file);
        await walk(file);
      } else if (entry.isFile()) {
        const s = await stat(file);
        files.set(file, `${s.size}:${s.mtimeMs}`);
      }
      if (files.size + dirs.size > 200000)
        throw new Error(
          "The working folder is too large to monitor for imports. Choose a smaller folder.",
        );
    }
  }
  await walk(root);
  return { files, dirs };
}
const digest = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

export class ExternalProgram {
  constructor({ emit, importer, scratch }) {
    Object.assign(this, { emit, importer, scratch });
    this.jobs = [];
    this.outputs = new Map();
    this.running = false;
  }
  report() {
    this.emit(this.jobs.map((j) => ({ ...j })));
  }
  log(job, line) {
    job.output = (job.output + line).slice(-100000);
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = null;
        this.report();
      }, 100);
  }
  async start({ item, amazonUrl, exact, settings, roots, scope }) {
    if (this.running)
      throw new Error(
        "An external program is already running. Open Activity to follow it.",
      );
    this.running = true;
    try {
      validateExternalSettings(settings);
      const args = commandArgs(settings.externalCommand, amazonUrl);
      let selected = scope?.startsWith("folder:")
        ? scope.slice(7)
        : item.sourceFolder;
      if (!selected || !path.isAbsolute(selected)) selected = "";
      const root =
        roots.find((r) => selected && inside(r, selected)) ||
        (roots.length === 1 ? roots[0] : "");
      const requested =
        settings.externalCwdMode === "custom"
          ? settings.externalCwd
          : root || "";
      if (!path.isAbsolute(requested))
        throw new Error(
          "Select a scanned folder or set a custom working folder in Settings.",
        );
      const cwd = await realpath(requested);
      if (!(await stat(cwd)).isDirectory())
        throw new Error("The working folder must be an existing directory.");
      const before = await scanSnapshot(cwd);
      const job = {
        id: randomUUID(),
        title: item.title,
        artist: item.artist,
        amazonUrl,
        cwd,
        command: args.map((a) => JSON.stringify(a)).join(" "),
        phase: "running",
        started: new Date().toISOString(),
        output: "",
        importIds: [],
        outputPaths: [],
        autoOpenImport: settings.externalAutoOpenImport,
      };
      this.jobs.push(job);
      if (!exact)
        this.log(
          job,
          "No exact Amazon album URL found; using the Amazon search URL.\n",
        );
      this.report();
      void this.execute(job, args, before);
      return { ...job };
    } catch (error) {
      this.running = false;
      throw error;
    }
  }
  async execute(job, args, before) {
    try {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(args[0], args.slice(1), {
          cwd: job.cwd,
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.child = child;
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        const stdoutText = terminalOutputFilter();
        const stderrText = terminalOutputFilter();
        child.stdout.on("data", (chunk) => this.log(job, stdoutText(chunk)));
        child.stderr.on("data", (chunk) => this.log(job, stderrText(chunk)));
        child.once("error", reject);
        child.once("close", resolve);
      });
      this.child = null;
      job.exitCode = code;
      if (job.cancelRequested) {
        job.phase = "cancelled";
        return;
      }
      if (code !== 0)
        throw new Error(
          `Program exited with code ${code ?? "unknown"}. Output was not sent to import.`,
        );
      this.log(job, `\nProgram finished (exit ${code}).\n`);
      await this.detectOutput(job, before);
      job.phase = "complete";
    } catch (error) {
      job.phase = job.cancelRequested ? "cancelled" : "failed";
      job.error = error.message;
      this.log(job, `\n${error.message}\n`);
    } finally {
      this.child = null;
      this.running = false;
      job.finished = new Date().toISOString();
      this.report();
    }
  }
  cancel(id) {
    const job = this.jobs.find((j) => j.id === id && j.phase === "running");
    if (!job || !this.child) return false;
    job.cancelRequested = true;
    const child = this.child;
    if (process.platform === "win32") {
      const killer = spawn(
        "taskkill.exe",
        ["/pid", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.on("error", () => child.kill());
      killer.on("close", (code) => {
        if (code !== 0) child.kill();
      });
      const fallback = setTimeout(() => {
        if (this.child === child) child.kill();
      }, 1500);
      fallback.unref();
    } else child.kill();
    return true;
  }
  clear(id) {
    if (id !== undefined && typeof id !== "string")
      throw new Error("Invalid activity entry.");
    const removed = this.jobs.filter(
      (job) =>
        !["running", "importing"].includes(job.phase) &&
        (id === undefined || job.id === id),
    );
    this.jobs = this.jobs.filter((job) => !removed.includes(job));
    for (const job of removed) this.outputs.delete(job.id);
    this.report();
    return this.jobs.map((job) => ({ ...job }));
  }
  async importJob(id, options) {
    const job = this.jobs.find((job) => job.id === id);
    if (
      !job ||
      job.phase !== "complete" ||
      job.importIds.length ||
      !job.outputPaths.length
    )
      throw new Error("Choose a completed run with new output to import.");
    if (this.running)
      throw new Error("Wait for the current program or import to finish.");
    this.running = true;
    job.phase = "importing";
    delete job.error;
    this.report();
    try {
      await this.importOutput(job, options);
      job.phase = "complete";
    } catch (error) {
      job.phase = job.importIds.length ? "failed" : "complete";
      job.error = error.message;
      throw error;
    } finally {
      this.running = false;
      this.report();
    }
    return this.importer.jobs;
  }
  async detectOutput(job, before) {
    const after = await scanSnapshot(job.cwd);
    const added = [...after.files.keys()].filter((f) => !before.files.has(f));
    const sources = [],
      loose = [],
      covered = [];
    // Only wholly new folder trees may be handed to the folder mover.
    for (const file of added.filter((f) =>
      audio.has(path.extname(f).toLowerCase()),
    )) {
      let folder = path.dirname(file);
      if (before.dirs.has(folder)) {
        loose.push(file);
        continue;
      }
      while (!before.dirs.has(path.dirname(folder)))
        folder = path.dirname(folder);
      if (!covered.includes(folder)) {
        covered.push(folder);
        sources.push(folder);
      }
    }
    for (const file of added.filter(
      (f) => path.extname(f).toLowerCase() === ".zip",
    ))
      if (!covered.some((folder) => inside(folder, file))) sources.push(file);
    this.outputs.set(job.id, { sources, loose, covered, added });
    job.outputPaths = [...sources, ...loose];
    this.log(
      job,
      sources.length || loose.length
        ? `Found ${job.outputPaths.length} new output item(s). Ready for Import music.\n`
        : "No newly created music folders, ZIPs, or tracks found. Existing files were kept.\n",
    );
  }
  async importOutput(job, options) {
    const output = this.outputs.get(job.id);
    if (!output) throw new Error("This run has no output ready to import.");
    const { loose, covered, added } = output;
    const sources = [...output.sources];
    // Validate routing before copying or relocating any output.
    if (
      !options.root ||
      typeof options.destinationFolder !== "string" ||
      path.isAbsolute(options.destinationFolder) ||
      options.destinationFolder
        .split(/[\\/]/)
        .some((part) => part === ".." || part === ".")
    )
      throw new Error("Choose a destination in Import music first.");
    const root = await realpath(options.root);
    const destination = await realpath(
      path.join(root, options.destinationFolder),
    );
    if (!inside(root, destination) || !(await stat(destination)).isDirectory())
      throw new Error(
        "Choose an existing folder inside the import destination.",
      );
    // Loose tracks are copied into a private album folder. Delete originals only after
    // the importer succeeds and their content still matches the verified copy.
    const originals = [];
    if (loose.length) {
      const safeTitle =
        job.title
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
          .replace(/[. ]+$/, "")
          .slice(0, 100) || "Album";
      const stage = path.join(this.scratch, job.id, `Album - ${safeTitle}`);
      const parents = new Set(loose.map((f) => path.dirname(f)));
      const files = added.filter(
        (f) =>
          parents.has(path.dirname(f)) &&
          path.extname(f).toLowerCase() !== ".zip" &&
          !covered.some((d) => inside(d, f)),
      );
      for (const file of files) {
        const target = path.join(stage, path.relative(job.cwd, file));
        await mkdir(path.dirname(target), { recursive: true });
        const hash = await digest(file);
        await copyFile(file, target);
        if (hash !== (await digest(target)) || hash !== (await digest(file)))
          throw new Error(
            "Output changed while preparing import. Originals were kept.",
          );
        originals.push({ file, hash });
      }
      sources.push(stage);
      this.log(job, `Prepared loose tracks at ${stage}\n`);
    }
    if (!sources.length) {
      this.log(
        job,
        "No newly created music folders, ZIPs, or tracks found. Existing files were kept.\n",
      );
      return;
    }
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (
        !covered.includes(source) ||
        path.dirname(source).toLowerCase() !== destination.toLowerCase()
      )
        continue;
      // Make room for the verified tagged album at its original name. The original
      // remains recoverable at this scratch path until the normal importer commits.
      const held = path.join(
        this.importer.stagingForRoot(root),
        "external-output",
        job.id,
        path.basename(source),
      );
      await mkdir(path.dirname(held), { recursive: true });
      await rename(source, held);
      sources[i] = held;
      output.sources[output.sources.indexOf(source)] = held;
      this.log(job, `Output held for tagging at ${held}\n`);
    }
    const ids = new Set(this.importer.jobs.map((j) => j.id));
    try {
      for (let i = 0; i < sources.length; i += 30)
        await this.importer.enqueue(sources.slice(i, i + 30), {
          ...options,
          root,
        });
    } finally {
      job.importIds = this.importer.jobs
        .filter((j) => !ids.has(j.id) && sources.includes(j.zip))
        .map((j) => j.id);
    }
    this.log(
      job,
      `Queued ${job.importIds.length} import(s). Follow tagging and moving in Import music.\n`,
    );
    this.report();
    while (
      job.importIds.some((id) =>
        this.importer.jobs.some(
          (j) => j.id === id && !["complete", "failed"].includes(j.phase),
        ),
      )
    )
      await new Promise((r) => setTimeout(r, 200));
    if (
      this.importer.jobs.some(
        (j) => job.importIds.includes(j.id) && j.phase === "failed",
      )
    )
      throw new Error(
        "Import failed. Open Import music for details; source files were retained.",
      );
    for (const { file, hash } of originals) {
      if ((await digest(file)) === hash) await unlink(file);
      else this.log(job, `Changed source retained: ${file}\n`);
    }
    this.log(job, "Tagging and moving finished.\n");
  }
}
