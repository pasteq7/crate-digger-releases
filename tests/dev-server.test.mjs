import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

test("the dev server serves the renderer on Electron's IPv4 loopback address", async () => {
  const server = await createServer({
    logLevel: "silent",
    server: { port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.equal(address.address, "127.0.0.1");
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    assert.equal(origin, `http://127.0.0.1:${address.port}`);
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /\/src\/main\.tsx/);
  } finally {
    await server.close();
  }
});
