import path from "node:path";
import { realpath, stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { parseFile } from "music-metadata";

const audioTypes = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".wma": "audio/x-ms-wma",
  ".ape": "audio/x-ape",
  ".wv": "audio/wavpack",
};
export const insideRoot = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};
export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error("Invalid range");
  let start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  let end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    throw new Error("Invalid range");
  return { start, end };
}
export class LocalMedia {
  constructor(store, origin = "null") {
    this.store = store;
    this.origin = origin;
    this.key = randomBytes(24).toString("hex");
    this.covers = new Map();
    this.coverBytes = 0;
    this.coverActive = 0;
    this.coverWaiting = [];
    this.coverPending = new Map();
  }
  url(id, kind = "audio") {
    return `crate-media://local/${kind}/${encodeURIComponent(id)}?key=${this.key}`;
  }
  async resolve(id) {
    const track = this.store.trackById(id);
    if (
      !track ||
      track.missing ||
      !this.store.get("folders", []).includes(track.root)
    )
      throw new Error("This track is no longer indexed.");
    const [file, root] = await Promise.all([
      realpath(track.path),
      realpath(track.root),
    ]);
    if (
      !insideRoot(root, file) ||
      !audioTypes[path.extname(file).toLowerCase()]
    )
      throw new Error("This file is outside your music library.");
    return { track, file, root };
  }
  async cover(id) {
    if (this.coverPending.has(id)) return this.coverPending.get(id);
    const task = (async () => {
      if (this.coverActive >= 4)
        await new Promise((resolve) => this.coverWaiting.push(resolve));
      else this.coverActive++;
      try {
        return await this.loadCover(id);
      } finally {
        const next = this.coverWaiting.shift();
        if (next) next();
        else this.coverActive--;
      }
    })().finally(() => this.coverPending.delete(id));
    this.coverPending.set(id, task);
    return task;
  }
  async loadCover(id) {
    const { file, root } = await this.resolve(id);
    const key = file + ":" + (await stat(file)).mtimeMs;
    if (this.covers.has(key)) {
      const cached = this.covers.get(key);
      this.covers.delete(key);
      this.covers.set(key, cached);
      return cached;
    }
    let cover = null;
    const directory = path.dirname(file);
    const albumDirectory = /^(cd|disc|disk)\s*\d+$/i.test(
      path.basename(directory),
    )
      ? path.dirname(directory)
      : directory;
    for (const dir of [...new Set([albumDirectory, directory])]) {
      for (const name of [
        "cover.jpg",
        "folder.jpg",
        "front.jpg",
        "cover.png",
        "folder.png",
        "cover.webp",
      ]) {
        try {
          const candidate = await realpath(path.join(dir, name));
          if (!insideRoot(root, candidate)) continue;
          const info = await stat(candidate);
          if (info.size > 12 * 1024 * 1024 || !info.isFile()) continue;
          cover = {
            data: await readFile(candidate),
            type: candidate.toLowerCase().endsWith(".png")
              ? "image/png"
              : candidate.toLowerCase().endsWith(".webp")
                ? "image/webp"
                : "image/jpeg",
          };
          break;
        } catch {
          /* Folder art is optional. */
        }
      }
      if (cover) break;
    }
    if (!cover) {
      try {
        const metadata = await parseFile(file, { duration: false });
        const picture = metadata.common.picture?.find(
          (p) =>
            ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
              p.format,
            ) && p.data.byteLength <= 12 * 1024 * 1024,
        );
        if (picture) cover = { data: picture.data, type: picture.format };
      } catch {
        /* Missing art uses the app's fallback. */
      }
    }
    this.covers.set(key, cover);
    this.coverBytes += cover?.data.byteLength || 0;
    // Bound in-memory art; audio is always streamed and never cached here.
    while (this.covers.size > 256 || this.coverBytes > 32 * 1024 * 1024) {
      const oldest = this.covers.keys().next().value;
      this.coverBytes -= this.covers.get(oldest)?.data.byteLength || 0;
      this.covers.delete(oldest);
    }
    return cover;
  }
  async handle(request) {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      if (origin && origin !== this.origin)
        return new Response(null, { status: 403 });
      const match = /^\/(audio|cover)\/([a-f\d-]{36})$/.exec(url.pathname);
      if (
        url.hostname !== "local" ||
        url.searchParams.get("key") !== this.key ||
        !match
      )
        return new Response("Not found", { status: 404 });
      if (!["GET", "HEAD"].includes(request.method))
        return new Response(null, { status: 405 });
      const [, kind, id] = match;
      const headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": this.origin,
        "Access-Control-Expose-Headers":
          "Content-Length, Content-Range, Accept-Ranges",
      };
      if (kind === "cover") {
        const cover = await this.cover(id);
        return cover
          ? new Response(request.method === "HEAD" ? null : cover.data, {
              headers: {
                ...headers,
                "Content-Type": cover.type,
                "Content-Length": String(cover.data.byteLength),
              },
            })
          : new Response(null, { status: 404 });
      }
      const { file } = await this.resolve(id);
      const info = await stat(file);
      if (!info.isFile()) return new Response(null, { status: 404 });
      let range;
      try {
        range = byteRange(request.headers.get("range"), info.size);
      } catch {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}` },
        });
      }
      const start = range?.start || 0,
        end = range?.end ?? info.size - 1;
      const responseHeaders = {
        ...headers,
        "Content-Type": audioTypes[path.extname(file).toLowerCase()],
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${info.size}` }
          : {}),
      };
      if (request.method === "HEAD")
        return new Response(null, {
          status: range ? 206 : 200,
          headers: responseHeaders,
        });
      const stream = createReadStream(file, { start, end });
      const abort = () => stream.destroy();
      request.signal?.addEventListener("abort", abort, { once: true });
      stream.once("close", () =>
        request.signal?.removeEventListener("abort", abort),
      );
      return new Response(Readable.toWeb(stream), {
        status: range ? 206 : 200,
        headers: responseHeaders,
      });
    } catch {
      return new Response("File unavailable", { status: 404 });
    }
  }
}
