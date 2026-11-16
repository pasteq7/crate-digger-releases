import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  stat,
  lstat,
  realpath,
  open,
  readdir,
  unlink,
  rename,
} from "node:fs/promises";

const MAX_BYTES = 2 * 1024 ** 3;
const abortError = () => new Error("Audio preparation was canceled.");
export class ApeDecoder {
  constructor({ command, cache }) {
    this.command = command;
    this.cache = path.resolve(cache);
    this.jobs = new Map();
    this.waiting = [];
    this.active = 0;
    this.leases = new Map();
    this.children = new Set();
  }
  retain(file) {
    this.leases.set(file, (this.leases.get(file) || 0) + 1);
    return () => {
      const n = (this.leases.get(file) || 1) - 1;
      n ? this.leases.set(file, n) : this.leases.delete(file);
    };
  }
  async valid(file) {
    try {
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size < 44 ||
        info.size > MAX_BYTES
      )
        return false;
      const input = await open(file, "r");
      try {
        const header = Buffer.alloc(12);
        await input.read(header, 0, 12, 0);
        return (
          header.toString("ascii", 0, 4) === "RIFF" &&
          header.toString("ascii", 8, 12) === "WAVE" &&
          header.readUInt32LE(4) + 8 <= info.size
        );
      } finally {
        await input.close();
      }
    } catch {
      return false;
    }
  }
  async prepare(source, info, signal) {
    if (signal?.aborted) throw abortError();
    if (!this.ready)
      this.ready = (async () => {
        await mkdir(this.cache, { recursive: true });
        const canonical = await realpath(this.cache);
        const expected = path.join(
          await realpath(path.dirname(this.cache)),
          path.basename(this.cache),
        );
        if (canonical.toLowerCase() !== expected.toLowerCase())
          throw new Error(
            "The audio cache must be a local application directory.",
          );
        this.cache = canonical;
        for (const name of await readdir(this.cache))
          if (/^[a-f\d-]{36}\.part\.wav$/.test(name))
            await unlink(path.join(this.cache, name)).catch(() => {});
      })();
    await this.ready;
    if (signal?.aborted) throw abortError();
    const key = createHash("sha256")
      .update(`monkey-1347:${source}:${info.size}:${info.mtimeMs}`)
      .digest("hex");
    const output = path.join(this.cache, `${key}.wav`);
    const reusable = await this.valid(output);
    if (signal?.aborted) throw abortError();
    if (reusable) return output;
    const invalid = await lstat(output).catch(() => null);
    if (invalid) {
      if (
        !invalid.isFile() ||
        invalid.isSymbolicLink() ||
        this.leases.has(output)
      )
        throw new Error("Invalid audio cache entry.");
      await unlink(output).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
    let job = this.jobs.get(key);
    if (signal?.aborted) throw abortError();
    if (!job) {
      if (this.jobs.size >= 3)
        throw new Error(
          "Audio preparation is busy. Try this track again shortly.",
        );
      job = { controller: new AbortController(), waiters: new Set() };
      this.jobs.set(key, job);
      job.promise = this.decode(source, output, job.controller.signal).finally(
        () => this.jobs.delete(key),
      );
    }
    const waiter = {};
    job.waiters.add(waiter);
    return new Promise((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener("abort", cancel);
        job.waiters.delete(waiter);
        if (!job.waiters.size) job.controller.abort();
      };
      const cancel = () => {
        finish();
        reject(abortError());
      };
      signal?.addEventListener("abort", cancel, { once: true });
      job.promise.then(
        (file) => {
          finish();
          resolve(file);
        },
        (error) => {
          finish();
          reject(error);
        },
      );
      if (signal?.aborted) cancel();
    });
  }
  async permit(signal) {
    if (signal.aborted) throw abortError();
    if (!this.active) {
      this.active++;
      return;
    }
    await new Promise((resolve, reject) => {
      const cancel = () => {
        this.waiting = this.waiting.filter((entry) => entry !== next);
        reject(abortError());
      };
      const next = () => {
        signal.removeEventListener("abort", cancel);
        resolve();
      };
      this.waiting.push(next);
      signal.addEventListener("abort", cancel, { once: true });
    });
  }
  async decode(source, output, signal) {
    await this.permit(signal);
    const temporary = path.join(this.cache, `${randomUUID()}.part.wav`);
    try {
      if (signal.aborted) throw abortError();
      if (!(await stat(this.command)).isFile())
        throw new Error("The bundled APE decoder is unavailable.");
      await new Promise((resolve, reject) => {
        const child = spawn(this.command, [source, temporary], {
          windowsHide: true,
          shell: false,
          stdio: "ignore",
        });
        this.children.add(child);
        let failure = null;
        const stop = (error) => {
          failure ||= error;
          child.kill();
        };
        const cancel = () => stop(abortError());
        signal.addEventListener("abort", cancel, { once: true });
        const timeout = setTimeout(
          () => stop(new Error("APE audio preparation timed out.")),
          5 * 60 * 1000,
        );
        const sizeCheck = setInterval(() => {
          void stat(temporary)
            .then((info) => {
              if (info.size > MAX_BYTES)
                stop(
                  new Error(
                    "Decoded audio exceeds the 2 GB per-file cache limit.",
                  ),
                );
            })
            .catch(() => {});
        }, 500);
        const done = (error) => {
          clearTimeout(timeout);
          clearInterval(sizeCheck);
          signal.removeEventListener("abort", cancel);
          this.children.delete(child);
          error ? reject(error) : resolve();
        };
        child.once("error", done);
        child.once("close", (code) =>
          done(
            failure ||
              (code === 0
                ? null
                : new Error("This APE file could not be decoded.")),
          ),
        );
        if (signal.aborted) cancel();
      });
      if (signal.aborted) throw abortError();
      if (!(await this.valid(temporary)))
        throw new Error(
          "The APE decoder did not produce a supported WAV file.",
        );
      if (await lstat(output).catch(() => null))
        throw new Error("An invalid audio cache entry already exists.");
      await rename(temporary, output);
      await this.evict(output);
      return output;
    } finally {
      await unlink(temporary).catch(() => {});
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  async evict(exclude) {
    const files = [];
    for (const name of await readdir(this.cache)) {
      if (!/^[a-f0-9]{64}\.wav$/.test(name)) continue;
      const file = path.join(this.cache, name),
        info = await lstat(file).catch(() => null);
      if (info?.isFile() && !info.isSymbolicLink())
        files.push({ file, ...info });
    }
    let bytes = files.reduce((n, file) => n + file.size, 0);
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (bytes <= MAX_BYTES) break;
      if (file.file !== exclude && !this.leases.has(file.file)) {
        await unlink(file.file).catch(() => {});
        bytes -= file.size;
      }
    }
  }
  close() {
    for (const job of this.jobs.values()) job.controller.abort();
    for (const child of this.children) child.kill();
  }
}
