import { Worker } from "node:worker_threads";

export class LibraryReader {
  constructor(
    database,
    mediaKey,
    workerPath = new URL("./library-worker.mjs", import.meta.url),
  ) {
    this.database = database;
    this.mediaKey = mediaKey;
    this.workerPath = workerPath;
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
  }
  start() {
    if (this.worker) return;
    const worker = new Worker(this.workerPath, {
      workerData: { database: this.database, mediaKey: this.mediaKey },
      name: "collection-reader",
    });
    this.worker = worker;
    const failed = (error) => {
      if (this.worker !== worker) return;
      this.worker = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      this.pending.clear();
    };
    worker.on("message", ({ id, result, error }) => {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      clearTimeout(request.timeout);
      error ? request.reject(new Error(error)) : request.resolve(result);
    });
    worker.on("error", failed);
    worker.on("exit", () =>
      failed(new Error("Collection loading was interrupted. Try again.")),
    );
    worker.unref();
  }
  request(method, value) {
    if (this.closed)
      return Promise.reject(new Error("Collection reader is closed."));
    this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timeout = setTimeout(() => {
        const worker = this.worker;
        this.worker = null;
        for (const request of this.pending.values()) {
          clearTimeout(request.timeout);
          request.reject(
            new Error(
              "Collection loading took too long. Try again after the current scan.",
            ),
          );
        }
        this.pending.clear();
        void worker?.terminate();
      }, 30000);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, method, value });
    });
  }
  query(options) {
    return this.request("query", options);
  }
  facets() {
    return this.request("facets");
  }
  summary() {
    return this.request("summary");
  }
  resolve(ids) {
    return this.request("resolve", ids);
  }
  async close() {
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Collection reader closed."));
    }
    this.pending.clear();
    const worker = this.worker;
    this.worker = null;
    await worker?.terminate();
  }
}
