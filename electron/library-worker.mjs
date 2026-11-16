import { parentPort, workerData } from "node:worker_threads";
import { Store } from "./store.mjs";
import { LibraryManager } from "./library-manager.mjs";

const store = new Store(workerData.database, { readOnly: true });
const library = new LibraryManager(store, {
  url: (id, kind = "audio") =>
    `crate-media://local/${kind}/${encodeURIComponent(id)}?key=${workerData.mediaKey}`,
});
const allowed = new Set(["query", "facets", "resolve", "summary"]);
parentPort.on("message", ({ id, method, value }) => {
  try {
    if (!allowed.has(method)) throw new Error("Invalid collection request.");
    // Keep revision checks and decoded data in one consistent WAL snapshot.
    store.db.exec("BEGIN");
    let result;
    try {
      result = library[method](value);
      store.db.exec("COMMIT");
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
