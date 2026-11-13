import { spawn } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class Importer {
  constructor({
    command,
    args = [],
    emit,
    completed,
    jobs = [],
    stagingForRoot = (root) =>
      path.join(path.dirname(root), ".crate-digger-import-staging"),
  }) {
    Object.assign(this, { command, args, emit, completed });
    this.jobs = jobs.map((job) =>
      ["complete", "failed"].includes(job.phase)
        ? job
        : {
            ...job,
            phase: "failed",
            error:
              "The previous import was interrupted. Your ZIP is retained; retry when ready.",
          },
    );
    this.running = false;
    this.stagingForRoot = stagingForRoot;
  }
  async enqueue(files, options) {
    if (
      !Array.isArray(files) ||
      !files.length ||
      files.length > 30 ||
      files.some(
        (f) => typeof f !== "string" || !path.isAbsolute(f) || f.length > 32767,
      )
    )
      throw new Error("Drop up to 30 ZIP files or music folders at a time.");
    const root = await realpath(options.root || "");
    if (!(await stat(root)).isDirectory())
      throw new Error("Choose your import destination first.");
    const destinationFolder = options.destinationFolder ?? "";
    if (
      typeof destinationFolder !== "string" ||
      destinationFolder.length > 4096 ||
      path.isAbsolute(destinationFolder) ||
      destinationFolder.split(/[\\/]/).some((p) => p === ".." || p === ".")
    )
      throw new Error("Choose a destination from the folder list.");
    const destination = await realpath(path.join(root, destinationFolder));
    const relative = path.relative(root, destination);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !(await stat(destination)).isDirectory()
    )
      throw new Error("Choose a folder inside the scan root.");
    const genre = path.basename(destination);
    const kinds = new Map();
    for (const file of files) {
      const info = await stat(file);
      if (info.isDirectory()) kinds.set(file, "folder");
      else if (info.isFile() && path.extname(file).toLowerCase() === ".zip")
        kinds.set(file, "zip");
      else throw new Error("Drop ZIP archives or music folders.");
    }
    for (const file of files) {
      if (
        this.jobs.some(
          (j) => j.zip === file && !["complete", "failed"].includes(j.phase),
        )
      )
        continue;
      this.jobs.push({
        id: randomUUID(),
        zip: file,
        kind: kinds.get(file),
        name: path.basename(file),
        root,
        stagingRoot: this.stagingForRoot(root),
        genre,
        destinationFolder,
        tagGenre: options.tagGenre === true,
        cleanComments: options.cleanComments !== false,
        phase: "queued",
        done: 0,
        total: 0,
      });
    }
    this.report();
    void this.run();
    return this.jobs;
  }
  report(force = true) {
    if (!force && Date.now() - (this.lastReport || 0) < 180) return;
    this.lastReport = Date.now();
    this.emit(this.jobs.map((j) => ({ ...j })));
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of this.jobs.filter((j) => j.phase === "queued")) {
        job.phase = "extracting";
        this.report();
        try {
          await this.extract(job);
          await this.completed(job);
        } catch (error) {
          if (job.phase === "complete")
            job.indexWarning =
              "Files imported. Rescan the library to refresh the index.";
          else {
            job.phase = "failed";
            job.error = error.message;
          }
        }
        this.report();
      }
    } finally {
      this.running = false;
      if (this.jobs.some((j) => j.phase === "queued")) void this.run();
    }
  }
  extract(job) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let buffer = "",
        failure = "",
        stderr = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.phase === "failed") failure = data.error;
            Object.assign(job, data);
            this.report(["complete", "failed"].includes(data.phase));
          } catch {
            /* Ignore non-JSON helper diagnostics. */
          }
        }
      });
      child.stderr.on("data", (data) => {
        stderr = (stderr + data).slice(-2000);
      });
      child.on("error", () =>
        reject(
          new Error(
            "The import helper could not start. Reinstall Crate Digger.",
          ),
        ),
      );
      child.on("close", (code) =>
        code === 0 && job.phase === "complete"
          ? resolve()
          : reject(
              new Error(
                failure ||
                  "The ZIP could not be imported. Check the archive and destination.",
              ),
            ),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(
        JSON.stringify({
          zip: job.zip,
          source: job.zip,
          kind: job.kind || "zip",
          root: job.root,
          stagingRoot: job.stagingRoot,
          genre: job.genre,
          destinationFolder: job.destinationFolder,
          tagGenre: job.tagGenre,
          cleanComments: job.cleanComments,
        }) + "\n",
      );
    });
  }
}
