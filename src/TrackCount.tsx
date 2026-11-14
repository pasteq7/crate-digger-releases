import type { Item } from "./types";
export default function TrackCount({
  item,
  busy = false,
}: {
  item: Item;
  busy?: boolean;
}) {
  if (item.kind !== "album") return null;
  const count =
    Number.isInteger(item.trackCount) && item.trackCount! > 0
      ? item.trackCount
      : null;
  const credit = [item.trackCountSource, item.trackCountEdition]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className="track-count"
      title={
        count
          ? `Track count for the matched edition${credit ? ` · ${credit}` : ""}`
          : "No reliable count available for this release"
      }
    >
      {busy
        ? "Loading track count…"
        : count
          ? `${count} track${count === 1 ? "" : "s"}`
          : "Track count unavailable"}
    </span>
  );
}
