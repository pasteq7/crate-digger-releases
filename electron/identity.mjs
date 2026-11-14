export const normalize = (value = "") =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]/gu, "");
export function albumKey(artist, album) {
  const title = album
    .replace(/\s*[([]([^\])]+)[\])]/g, (match, label) =>
      /\b(deluxe|remaster(?:ed)?|expanded|anniversary|bonus|special|edition)\b/i.test(
        label,
      )
        ? ""
        : match,
    )
    .replace(
      /\s*[-–—]\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|deluxe|expanded|anniversary)\b.*$/i,
      "",
    );
  return `${normalize(artist)}:${normalize(title)}`;
}
export function trackKey(artist, title = "") {
  const parts = title.match(/^(.*?)\s+[-–—]\s+(.+)$/);
  return albumKey(
    artist,
    parts && normalize(parts[1]) === normalize(artist) ? parts[2] : title,
  );
}
