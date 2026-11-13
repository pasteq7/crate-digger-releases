import { MusicLinks } from "../electron/music-links.mjs";
import { Discovery } from "../electron/discovery.mjs";
const store = { cached: () => null, stale: () => null, cache: () => {} };
const links = await new MusicLinks(store, "FR").resolve({
  artist: "Beach House",
  title: "Bloom",
  kind: "album",
  storeUrl: "https://music.apple.com/us/album/bloom/509665145",
});
console.log(JSON.stringify({ amazon: links.amazon, exact: links.exact }));
const d = new Discovery(store, null, "FR");
for (const [artist, album] of [
  ["King Tubby", "Dub From The Roots"],
  ["Mad Professor", "Dub Me Crazy"],
  ["Rhythm & Sound", "With the Artists"],
]) {
  const match = await d.deezerPreview(artist, album);
  let status = null;
  if (match?.preview)
    status = (
      await fetch(match.preview, {
        method: "HEAD",
        signal: AbortSignal.timeout(15000),
      })
    ).status;
  console.log(
    JSON.stringify({
      artist,
      album,
      matched: !!match,
      source: match?.previewSource,
      track: match?.previewTitle,
      clipHTTP: status,
    }),
  );
}
