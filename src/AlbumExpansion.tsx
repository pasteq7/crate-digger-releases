import { useEffect, useRef, useState } from "react";
import { Heart, Info, ListPlus, Loader2, Play, Shuffle, X } from "lucide-react";
import { clock, LocalArt } from "./LocalPlayer";
import type { Bridge, LibraryGroup, LocalTrack } from "./types";
type Query = (
  offset: number,
  limit: number,
  liked?: boolean,
  locate?: string,
) => ReturnType<Bridge["libraryQuery"]>;
export default function AlbumExpansion({
  group,
  kind,
  query,
  resolve,
  demo,
  follow,
  revision,
  current,
  onPlay,
  onFavorite,
  onQueue,
  onClose,
}: {
  group: LibraryGroup;
  kind: string;
  query: Query;
  demo: boolean;
  follow: boolean;
  resolve: (ids: string[]) => Promise<LocalTrack[]>;
  revision: number;
  current?: string;
  onPlay: (tracks: LocalTrack[], at?: number, shuffled?: boolean) => void;
  onFavorite: (track: LocalTrack) => void;
  onQueue: (tracks: LocalTrack[]) => void;
  onClose: () => void;
}) {
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [total, setTotal] = useState(group.tracks.length);
  const [busy, setBusy] = useState(true),
    [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState(""),
    [color, setColor] = useState("");
  const [shownOffset, setShownOffset] = useState(0),
    [reload, setReload] = useState(0);
  const requestedOffset = useRef(0);
  const section = useRef<HTMLElement>(null),
    revealed = useRef("");
  const loader = useRef(query),
    resolver = useRef(resolve),
    alive = useRef(true);
  const locate = useRef<string | undefined>(undefined),
    scrollToTrack = useRef(false);
  loader.current = query;
  resolver.current = resolve;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (follow && current && group.tracks.includes(current)) {
      locate.current = current;
      scrollToTrack.current = true;
      setReload((n) => n + 1);
    }
  }, [follow, current, group.id, revision]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    const target = locate.current;
    const offset = requestedOffset.current;
    const run = async () => {
      if (!demo) return loader.current(offset, 100, false, target);
      const items = await resolver.current(group.tracks);
      const index = target ? items.findIndex((t) => t.id === target) : -1;
      const start = index >= 0 ? Math.floor(index / 100) * 100 : offset;
      return {
        tracks: items.slice(start, start + 100),
        total: items.length,
        location: { offset: start },
      };
    };
    void run()
      .then((result) => {
        if (!live) return;
        setTracks(result.tracks);
        setTotal(result.total);
        setShownOffset(result.location?.offset ?? offset);
        requestedOffset.current = result.location?.offset ?? offset;
        if (locate.current === target) locate.current = undefined;
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [group.id, revision, reload, demo]);
  useEffect(() => {
    if (busy) return;
    const row = [
      ...(section.current?.querySelectorAll<HTMLElement>("[data-track-id]") ||
        []),
    ].find((row) => row.dataset.trackId === current);
    if (scrollToTrack.current && row) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      scrollToTrack.current = false;
    } else if (revealed.current !== group.id)
      section.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    revealed.current = group.id;
  }, [busy, group.id, current, shownOffset]);
  useEffect(() => {
    let live = true;
    setColor("");
    const id = group.tracks[0];
    if (id && !id.startsWith("sample-"))
      void window.crate
        ?.albumColor(id)
        .then((value) => {
          if (live && value) setColor(value);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [group.id, group.cover]);
  async function all(liked = false) {
    if (demo)
      return (await resolver.current(group.tracks)).filter(
        (t) => !liked || t.favorite,
      );
    const items: LocalTrack[] = [];
    let count = 1;
    for (let start = 0; start < count && alive.current; start += 1000) {
      const result = await loader.current(start, 1000, liked);
      count = result.total;
      items.push(...result.tracks);
    }
    return items;
  }
  async function action(
    kind: "play" | "shuffle" | "liked" | "queue",
    trackId?: string,
  ) {
    if (actionBusy) return;
    setActionBusy(true);
    setError("");
    try {
      const items = await all(kind === "liked");
      if (!alive.current) return;
      if (!items.length) {
        setError("No playable tracks match this selection.");
        return;
      }
      if (kind === "queue") onQueue(items);
      else
        onPlay(
          items,
          trackId
            ? Math.max(
                0,
                items.findIndex((t) => t.id === trackId),
              )
            : 0,
          kind === "shuffle" ? true : undefined,
        );
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setActionBusy(false);
    }
  }
  const multiDisc =
    kind === "albums" && tracks.some((t) => (t.discNumber || 1) > 1);
  const likedCount =
    group.favoriteCount ?? tracks.filter((t) => t.favorite).length;
  return (
    <section
      ref={section}
      className="album-expansion"
      aria-label={`${group.title} tracklist`}
      style={{ backgroundColor: color || undefined }}
    >
      <button
        className="icon-button album-expansion-close"
        aria-label={kind === "albums" ? "Close album" : "Close tracklist"}
        title="Close tracklist"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <div className="album-expansion-art">
        <LocalArt track={group} />
      </div>
      <div className="album-expansion-content">
        <header>
          <h2>{group.title}</h2>
          <p>
            {kind === "albums"
              ? `${group.artist}${group.year ? ` · ${group.year}` : ""}`
              : `${total.toLocaleString()} ${total === 1 ? "track" : "tracks"}${kind === "folders" ? ` · ${group.id}` : ""}`}
          </p>
          <div className="album-expansion-actions">
            <button
              disabled={busy || actionBusy || !total}
              onClick={() => void action("play")}
            >
              <Play size={14} />{" "}
              {kind === "albums"
                ? "Play album"
                : kind === "artists"
                  ? "Play artist"
                  : "Play folder"}
            </button>
            <button
              disabled={busy || actionBusy || !total}
              onClick={() => void action("shuffle")}
              aria-label={`Shuffle ${group.title}`}
            >
              <Shuffle size={14} />
            </button>
            <button
              disabled={busy || actionBusy || !likedCount}
              onClick={() => void action("liked")}
            >
              <Heart size={14} /> Play liked
              {likedCount ? ` · ${likedCount}` : ""}
            </button>
            <button
              disabled={busy || actionBusy || !total}
              onClick={() => void action("queue")}
              aria-label={`Queue ${group.title}`}
            >
              <ListPlus size={15} />
            </button>
            {actionBusy && <span role="status">Preparing tracks…</span>}
          </div>
        </header>
        {error && (
          <p role="alert">
            {error}{" "}
            <button onClick={() => setReload((n) => n + 1)}>Try again</button>
          </p>
        )}
        {busy ? (
          <p role="status">
            <Loader2 className="spin" size={18} /> Loading tracks…
          </p>
        ) : (
          <>
            <ol className="album-inline-tracks" start={shownOffset + 1}>
              {tracks.map((t, i) => (
                <li
                  key={t.id}
                  data-track-id={t.id}
                  className={current === t.id ? "playing-track" : ""}
                >
                  <button
                    className="inline-track-play"
                    aria-label={`Play ${t.title}`}
                    disabled={!!t.missing || actionBusy}
                    onClick={() => void action("play", t.id)}
                  >
                    <span className="inline-track-number">
                      {current === t.id ? (
                        <Play size={12} fill="currentColor" />
                      ) : (
                        `${multiDisc ? `${t.discNumber || 1}.` : ""}${kind === "albums" ? t.trackNumber || shownOffset + i + 1 : shownOffset + i + 1}`
                      )}
                    </span>
                    <span className="inline-track-title">
                      {t.title}
                      {kind !== "albums" ? (
                        <small>
                          {t.artist} · {t.album}
                        </small>
                      ) : (
                        t.artist !== group.artist && <small>{t.artist}</small>
                      )}
                      {t.missing && <small>File unavailable</small>}
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Favorite ${t.title}`}
                    aria-pressed={!!t.favorite}
                    onClick={() => onFavorite(t)}
                  >
                    <Heart
                      size={14}
                      fill={t.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Track details for ${t.title}`}
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("crate-track-details", { detail: t }),
                      )
                    }
                  >
                    <Info size={14} />
                  </button>
                  <span className="inline-track-time">
                    {clock(t.duration || 0)}
                  </span>
                </li>
              ))}
            </ol>
            {total > 100 && (
              <nav
                className="bounded-list-pages"
                aria-label="Album track pages"
              >
                <button
                  disabled={!shownOffset}
                  onClick={() => {
                    scrollToTrack.current = false;
                    locate.current = undefined;
                    requestedOffset.current = Math.max(0, shownOffset - 100);
                    revealed.current = "";
                    setReload((n) => n + 1);
                  }}
                >
                  Previous tracks
                </button>
                <span>
                  {shownOffset + 1}–{Math.min(shownOffset + 100, total)} of{" "}
                  {total}
                </span>
                <button
                  disabled={shownOffset + 100 >= total}
                  onClick={() => {
                    scrollToTrack.current = false;
                    locate.current = undefined;
                    requestedOffset.current = shownOffset + 100;
                    revealed.current = "";
                    setReload((n) => n + 1);
                  }}
                >
                  Next tracks
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </section>
  );
}
