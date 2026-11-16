import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store.mjs";

// Synthetic catalog plus representative generated audio, never a real profile.
export async function largeLibraryFixture(
  profile,
  count = 50000,
  albumSize = 10,
) {
  const root = path.join(profile, "Generated music");
  await mkdir(root, { recursive: true });
  const file = path.join(profile, "crate-digger.sqlite");
  const store = new Store(file);
  store.set("folders", [root]);
  store.set("settings", {
    view: "library",
    autoScan: false,
    ai: "none",
    engine: "catalog",
  });
  const putTrack = store.db.prepare("INSERT INTO tracks VALUES (?,?,?,?,?)");
  const putId = store.db.prepare("INSERT INTO track_ids VALUES (?,?,?)");
  const putMeta = store.db.prepare("INSERT INTO library_meta VALUES (?,?)");
  const ids = [];
  store.db.exec("BEGIN");
  try {
    for (let i = 0; i < count; i++) {
      const album = Math.floor(i / albumSize),
        artist = Math.floor(album / 5);
      const folder = `Artist ${String(artist).padStart(4, "0")}/Album ${String(album).padStart(5, "0")}`;
      const track = {
        id: randomUUID(),
        path: path.join(root, folder, `${i}.wav`),
        root,
        folder,
        title: `Track ${String(i).padStart(6, "0")}`,
        artist: `Artist ${String(artist).padStart(4, "0")}`,
        albumArtist: `Artist ${String(artist).padStart(4, "0")}`,
        album: `Album ${String(album).padStart(5, "0")}`,
        genre: ["Ambient", "Rock", "Jazz"][album % 3],
        year: 1980 + (album % 40),
        duration: 30,
        trackNumber: (i % albumSize) + 1,
        discNumber: 1,
        added: count - i,
        metadataVersion: 2,
      };
      const data = JSON.stringify(track);
      putId.run(track.id, track.path, data);
      putTrack.run(track.path, root, 1, 480044, data);
      if (i % 10 === 0)
        putMeta.run(track.id, JSON.stringify({ favorite: true, rating: 4 }));
      if (i < 12) ids.push(track);
    }
    store.db.exec("COMMIT");
  } catch (e) {
    store.db.exec("ROLLBACK");
    store.close();
    throw e;
  }
  const wave = Buffer.alloc(480044);
  wave.write("RIFF");
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(wave.length - 44, 40);
  for (const track of ids) {
    await mkdir(path.dirname(track.path), { recursive: true });
    await writeFile(track.path, wave);
  }
  return { store, file, root, tracks: ids, count };
}
