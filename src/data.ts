import catalog from "./sample-catalog.json";
import type { Item, Profile, Settings, State, Track } from "./types";
export const sampleItems = catalog as Item[];
export const defaults: Settings = {
  mode: "adjacent",
  theme: "dark",
  ai: "none",
  aiModel: "llama3.2",
  aiEndpoint: "http://127.0.0.1:11434",
  autoScan: false,
  watchLibrary: false,
  view: "discover",
  scope: "all",
  kind: "album",
  externalCommand: "",
  externalCwdMode: "scan",
  externalCwd: "",
  externalAutoOpenImport: false,
};
export function profile(tracks: Track[]): Profile {
  const count = (values: string[]) => {
    const counts: Record<string, number> = Object.create(null);
    for (const value of values) counts[value] = (counts[value] || 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  };
  const genres: Record<string, number> = Object.create(null);
  for (const t of tracks) {
    const tags = t.genre
      .split(/[,;/]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const tag of tags) genres[tag] = (genres[tag] || 0) + 1 / tags.length;
  }
  return {
    total: tracks.length,
    albums: new Set(tracks.map((t) => `${t.artist}:${t.album}`)).size,
    genres: Object.entries(genres)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    artists: count(tracks.map((t) => t.artist)),
    eras: count(
      tracks.map((t) =>
        t.year ? `${Math.floor(t.year / 10) * 10}s` : "Unknown",
      ),
    ),
  };
}
const records = [
  ["Slowdive", "Souvlaki", "Shoegaze", 1993, 10],
  ["Ride", "Nowhere", "Shoegaze", 1990, 11],
  ["My Bloody Valentine", "Loveless", "Shoegaze", 1991, 11],
  ["Cocteau Twins", "Treasure", "Dream pop", 1984, 10],
  ["The Cure", "Disintegration", "Post-punk", 1989, 12],
  ["Joy Division", "Unknown Pleasures", "Post-punk", 1979, 10],
  ["Brian Eno", "Apollo", "Ambient", 1983, 12],
  ["Aphex Twin", "Selected Ambient Works 85–92", "Ambient", 1992, 13],
];
export const sampleTracks: Track[] = records.flatMap(
  ([artist, album, genre, year, n]) =>
    Array.from({ length: Number(n) }, (_, i) => ({
      path: `Sample collection / ${["Shoegaze", "Dream pop", "Post-punk"].includes(String(genre)) ? "Guitar music" : "After hours"}/${artist}/${album}/${i}.mp3`,
      root: `Sample collection / ${["Shoegaze", "Dream pop", "Post-punk"].includes(String(genre)) ? "Guitar music" : "After hours"}`,
      folder: `${artist}/${album}`,
      title: `Track ${i + 1}`,
      artist: String(artist),
      album: String(album),
      genre: String(genre),
      year: Number(year),
    })),
);
export const emptyState: State = {
  tracks: [],
  profile: profile([]),
  folders: [],
  shelves: {},
  settings: defaults,
  history: [],
  lastScan: null,
  progress: null,
};
export function loadSample(): State {
  let saved: Partial<State> = {};
  try {
    saved = JSON.parse(localStorage.getItem("crate-sample-state") || "{}");
  } catch {
    /* recover invalid local data */
  }
  for (const entry of Object.values(saved.shelves || {})) {
    if ((entry.status as string) === "maybe") entry.status = "wishlist";
  }
  return {
    ...emptyState,
    ...saved,
    tracks: sampleTracks,
    profile: profile(sampleTracks),
    folders: [...new Set(sampleTracks.map((t) => t.root))],
    settings: { ...defaults, ...saved.settings },
    history: [],
    progress: null,
  };
}
export function saveSample(state: State) {
  localStorage.setItem(
    "crate-sample-state",
    JSON.stringify({ shelves: state.shelves, settings: state.settings }),
  );
}
