import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { ApeDecoder } from "../electron/ape-decoder.mjs";
import { Store } from "../electron/store.mjs";
import { LocalMedia } from "../electron/local-media.mjs";

test("canceling audio preparation stops its child process", async (t) => {
  await mkdir(".test-data", { recursive: true });
  const directory = await mkdtemp(path.resolve(".test-data/ape-cancel-"));
  const fake = path.join(directory, "waiting.cjs");
  await writeFile(
    fake,
    "require('node:fs').writeFileSync(process.argv[2], 'partial'); setInterval(() => {}, 1000);",
  );
  const decoder = new ApeDecoder({
    command: process.execPath,
    cache: path.join(directory, "cache"),
  });
  t.after(() => decoder.close());
  const controller = new AbortController();
  const pending = decoder.prepare(fake, await stat(fake), controller.signal);
  const rejected = assert.rejects(pending, /canceled/);
  for (let i = 0; i < 100 && !decoder.children.size; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(decoder.children.size, 1);
  controller.abort();
  await rejected;
  for (let i = 0; i < 100 && decoder.children.size; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(decoder.children.size, 0);
});

test(
  "APE decodes in the app cache, preserves source bytes, supports byte ranges and repairs truncated cache entries",
  {
    skip:
      process.platform !== "win32" ||
      !existsSync("build/ape/CrateDiggerApe.exe"),
  },
  async (t) => {
    await mkdir(".test-data", { recursive: true });
    const directory = await mkdtemp(path.resolve(".test-data/ape-unit-"));
    const root = path.join(directory, "Music");
    await mkdir(root);
    const wav = path.join(root, "Source.wav"),
      ape = path.join(root, "Source.ape");
    const python =
      process.env.CRATE_PYTHON ||
      (existsSync("C:/Python312/python.exe")
        ? "C:/Python312/python.exe"
        : "python");
    const generated = spawnSync(
      python,
      [
        "scripts/ape-fixture.py",
        path.resolve("build/ape/MACDll64.dll"),
        wav,
        ape,
      ],
      { windowsHide: true },
    );
    assert.equal(generated.status, 0, generated.stderr?.toString());
    const original = await readFile(ape),
      pcm = await readFile(wav);
    const store = new Store(path.join(directory, "test.sqlite"));
    t.after(() => store.close());
    store.set("folders", [root]);
    store.track(
      {
        path: ape,
        root,
        folder: "",
        artist: "Fixture",
        title: "APE",
        album: "Test",
        genre: "Ambient",
        year: 2026,
      },
      await stat(ape),
    );
    const decoder = new ApeDecoder({
      command: path.resolve("build/ape/CrateDiggerApe.exe"),
      cache: path.join(directory, "Decoded"),
    });
    t.after(() => decoder.close());
    const media = new LocalMedia(store, "null", decoder),
      id = store.tracks()[0].id;
    const [a, b] = await Promise.all([
      decoder.prepare(ape, await stat(ape)),
      decoder.prepare(ape, await stat(ape)),
    ]);
    assert.equal(a, b);
    assert.ok(a.startsWith(path.join(directory, "Decoded")));
    assert.deepEqual(await readFile(a), pcm);
    const range = await media.handle(
      new Request(media.url(id), { headers: { Range: "bytes=44-59" } }),
    );
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-type"), "audio/wav");
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      pcm.subarray(44, 60),
    );
    const head = await media.handle(
      new Request(media.url(id), { method: "HEAD" }),
    );
    assert.equal(Number(head.headers.get("content-length")), pcm.length);
    await writeFile(a, pcm.subarray(0, 100));
    assert.deepEqual(
      await readFile(await decoder.prepare(ape, await stat(ape))),
      pcm,
    );
    const canceled = new AbortController();
    canceled.abort();
    await assert.rejects(
      decoder.prepare(ape, await stat(ape), canceled.signal),
      /canceled/,
    );
    const bad = path.join(root, "Invalid.ape");
    await writeFile(bad, "Not audio");
    await assert.rejects(
      decoder.prepare(bad, await stat(bad)),
      /could not be decoded/,
    );
    assert.deepEqual(await readFile(ape), original);
    store.set("folders", []);
    assert.equal((await media.handle(new Request(media.url(id)))).status, 404);
  },
);
