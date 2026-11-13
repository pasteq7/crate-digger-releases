// Build-time sample metadata only. Audio previews are streamed, never downloaded.
import { albumKey } from "../electron/identity.mjs";
import { writeFile } from "node:fs/promises";
const seeds = [
  [
    "DIIV",
    "Deceiver",
    "Shoegaze",
    2019,
    "The hazy guitars in your Slowdive and Ride records.",
  ],
  [
    "Beach House",
    "Bloom",
    "Dream pop",
    2012,
    "A dreamier turn from your Cocteau Twins records.",
  ],
  [
    "Slowdive",
    "Just for a Day",
    "Shoegaze",
    1991,
    "An earlier chapter in your Slowdive collection.",
  ],
  [
    "Cocteau Twins",
    "Heaven or Las Vegas",
    "Dream pop",
    1990,
    "For the shimmering edges of your dream pop collection.",
  ],
  [
    "Nothing",
    "Tired of Tomorrow",
    "Shoegaze",
    2016,
    "The heavier side of your My Bloody Valentine records.",
  ],
  [
    "Beach Fossils",
    "Somersault",
    "Indie rock",
    2017,
    "A sunlit detour from your jangly guitar records.",
  ],
  [
    "Alvvays",
    "Blue Rev",
    "Indie pop",
    2022,
    "A little more melody, a familiar wall of guitars.",
  ],
  [
    "Wisp",
    "Pandora",
    "Shoegaze",
    2024,
    "A new generation of the sound on your shelves.",
  ],
  [
    "Grouper",
    "Dragging a Dead Deer Up a Hill",
    "Ambient",
    2008,
    "Where your ambient and dream pop records meet.",
  ],
  [
    "Boards of Canada",
    "Music Has the Right to Children",
    "Electronic",
    1998,
    "An analog, electronic detour from your ambient collection.",
  ],
  [
    "Talk Talk",
    "Laughing Stock",
    "Post-rock",
    1991,
    "The space between your post-punk and ambient records.",
  ],
  [
    "Nala Sinephro",
    "Space 1.8",
    "Jazz",
    2021,
    "A spiritual jazz stretch from your Brian Eno records.",
  ],
  [
    "CAN",
    "Future Days",
    "Krautrock",
    1973,
    "A rhythmic wildcard for your atmospheric side.",
  ],
  [
    "Brian Eno",
    "Another Green World",
    "Ambient",
    1975,
    "A missing Eno album between art rock and ambient.",
  ],
  [
    "Ride",
    "Going Blank Again",
    "Shoegaze",
    1992,
    "The next chapter after your copy of Nowhere.",
  ],
];
const items = [];
for (const [artist, title, genre, year, reason] of seeds) {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${title}`, entity: "song", media: "music", limit: "15" })}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const data = await res.json();
    const match = data.results?.find(
      (t) =>
        albumKey(t.artistName, t.collectionName) === albumKey(artist, title),
    );
    items.push({
      id: `sample-${items.length + 1}`,
      kind: "album",
      title,
      album: title,
      artist,
      genre,
      year,
      reason,
      seeds: ["Slowdive", "Ride", "My Bloody Valentine"],
      sourceFolder: "Sample collection / Guitar music",
      cover: match?.artworkUrl100.replace("100x100bb", "600x600bb") || "",
      preview: match?.previewUrl || null,
      previewTitle: match?.trackName,
      storeUrl: match?.collectionViewUrl || match?.trackViewUrl,
    });
    console.log(`${artist}: ${match ? "art + preview" : "no match"}`);
  } catch (e) {
    console.log(`${artist}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 500));
}
await writeFile(
  new URL("../src/sample-catalog.json", import.meta.url),
  JSON.stringify(items, null, 2),
);
