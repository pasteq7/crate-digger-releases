import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Disc3,
  Ellipsis,
  Folder,
  Grid2X2,
  Heart,
  List,
  Loader2,
  Play,
  Plus,
  Search,
  Shuffle,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import { Toolbar } from "./Chrome";
import { clock, LocalArt } from "./LocalPlayer";
import Dialog from "./Dialog";
import AlbumExpansion from "./AlbumExpansion";
import type { LocalPlayerController } from "./useLocalPlayer";
import type { Item, LibraryGroup, LocalTrack, Playlist, State } from "./types";
import { sampleItems } from "./data";

interface Props {
  state: State;
  demo: boolean;
  music: LocalPlayerController;
  playlist: string;
  onPlaylist: (id: string) => void;
  onAdd: () => void;
  notify: (message: string) => void;
  search: string;
  onOpenRecord: (item: Item) => void;
  onClearSearch: () => void;
}
export default function LibraryView({
  state,
  demo,
  music,
  playlist,
  onPlaylist,
  onAdd,
  notify,
  search,
  onOpenRecord,
  onClearSearch,
}: Props) {
  const [view, setView] = useState(
    () => localStorage.getItem("crate-library-view") || "albums",
  );
  const [sort, setSort] = useState("added"),
    [genre, setGenre] = useState(""),
    [artist, setArtist] = useState(""),
    [year, setYear] = useState(""),
    [favorites, setFavorites] = useState(false),
    [recent, setRecent] = useState(false),
    [minRating, setMinRating] = useState(0);
  const [tracks, setTracks] = useState<LocalTrack[]>([]),
    [groups, setGroups] = useState<LibraryGroup[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [storedDetail, setDetail] = useState<{
      kind: string;
      id: string;
      title: string;
    } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [editor, setEditor] = useState<LocalTrack | null>(null),
    [editNote, setEditNote] = useState(""),
    [editTitle, setEditTitle] = useState(""),
    [editArtist, setEditArtist] = useState(""),
    [editAlbum, setEditAlbum] = useState(""),
    [editTags, setEditTags] = useState("");
  const [playlistDialog, setPlaylistDialog] = useState<{
      tracks: LocalTrack[];
      existing?: Playlist;
    } | null>(null),
    [listName, setListName] = useState(""),
    [smart, setSmart] = useState(false),
    [ruleGenre, setRuleGenre] = useState(""),
    [ruleRating, setRuleRating] = useState(0),
    [ruleFavorite, setRuleFavorite] = useState(false),
    [dialogError, setDialogError] = useState("");
  const [layout, setLayout] = useState("grid");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [columns, setColumns] = useState(1);
  const grid = useRef<HTMLDivElement>(null);
  const [facets, setFacets] = useState<{
    artists: string[];
    years: number[];
    genres: string[];
  }>({ artists: [], years: [], genres: [] });
  const limit = 120;
  const list = music.playlists.find((p) => p.id === playlist);
  const detail = search ? null : storedDetail;
  const savedMatches = search
    ? Object.values(state.shelves)
        .filter(
          (entry) =>
            entry.status === "wishlist" &&
            `${entry.item.artist} ${entry.item.title} ${entry.item.genre}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
        )
        .map((entry) => entry.item)
    : [];
  const browseView = playlist || detail || search ? "tracks" : view;
  const scopeOptions = {
    query: search,
    genre: search ? "" : genre,
    artist: detail?.kind === "artists" ? detail.id : search ? "" : artist,
    year: search ? "" : year,
    favorite: search ? false : favorites,
    recent: search ? false : recent,
    rating: search ? 0 : minRating,
    sort: playlist && !search ? "playlist" : sort,
    playlist: playlist || undefined,
    ...(detail?.kind === "folders" ? { folder: detail.id } : {}),
  };
  const request = useRef(0);
  const demoTracks = useMemo(
    () =>
      state.tracks.map((t, i) => ({
        ...t,
        id: t.id || `sample-${i}`,
        cover: sampleItems.find((s) => s.artist === t.artist)?.cover || "",
        mediaUrl: "",
        duration: t.duration || 0,
      })) as LocalTrack[],
    [state.tracks],
  );
  useEffect(() => {
    setDetail(null);
    setExpanded(null);
    setSelected(new Set());
    setOffset(0);
  }, [playlist, view]);
  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [search, genre, artist, year, favorites, recent, minRating]);
  useEffect(() => {
    setExpanded(null);
  }, [search, genre, artist, year, favorites, recent, minRating, offset, sort]);
  useEffect(() => {
    let live = true;
    if (!demo && window.crate) {
      void window.crate
        .libraryFacets()
        .then((value) => {
          if (live) setFacets(value);
        })
        .catch((e) => notify(String(e)));
    } else
      setFacets({
        artists: [
          ...new Set(demoTracks.map((t) => t.albumArtist || t.artist)),
        ].sort(),
        years: [
          ...new Set(
            demoTracks.map((t) => t.year).filter((y): y is number => !!y),
          ),
        ].sort((a, b) => b - a),
        genres: [
          ...new Set(
            demoTracks.flatMap((t) =>
              t.genre
                .split(/[,;/]/)
                .map((g) => g.trim())
                .filter(Boolean),
            ),
          ),
        ].sort(),
      });
    return () => {
      live = false;
    };
  }, [demo, demoTracks, revision]);
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () =>
      setColumns(
        getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [browseView, layout, groups.length]);
  useEffect(() => {
    localStorage.setItem("crate-library-view", view);
  }, [view]);
  useEffect(() => {
    const run = ++request.current;
    setBusy(true);
    const options = {
      ...scopeOptions,
      view: browseView,
      offset,
      limit,
    };
    const execute = async () => {
      if (!demo && window.crate) return window.crate.libraryQuery(options);
      let items = demoTracks
        .filter(
          (t) =>
            !search ||
            `${t.title} ${t.artist} ${t.album}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .filter(
          (t) =>
            search ||
            !genre ||
            t.genre
              .split(/[,;/]/)
              .map((g) => g.trim())
              .includes(genre),
        )
        .filter(
          (t) =>
            search ||
            !artist ||
            t.artist === artist ||
            t.albumArtist === artist,
        )
        .filter((t) => search || !year || t.year === Number(year));
      if (!search && (favorites || recent || minRating)) items = [];
      if (detail)
        items = items.filter((t) =>
          detail.kind === "albums"
            ? JSON.stringify([
                t.root,
                t.folder,
                t.albumArtist || t.artist,
                t.album,
              ]) === detail.id
            : detail.kind === "artists"
              ? t.artist === detail.id
              : t.folder === detail.id,
        );
      if (browseView === "tracks")
        return {
          tracks: items.slice(offset, offset + limit),
          total: items.length,
          groups: [],
        };
      const map = new Map<string, LibraryGroup>();
      for (const t of items) {
        const key =
          browseView === "albums"
            ? JSON.stringify([
                t.root,
                t.folder,
                t.albumArtist || t.artist,
                t.album,
              ])
            : browseView === "artists"
              ? t.artist
              : t.folder;
        if (!map.has(key))
          map.set(key, {
            id: key,
            title:
              browseView === "albums"
                ? t.album
                : browseView === "artists"
                  ? t.artist
                  : t.folder,
            artist: t.artist,
            cover: t.cover,
            year: t.year,
            duration: 0,
            tracks: [],
            added: 0,
          });
        map.get(key)!.tracks.push(t.id);
      }
      return {
        tracks: [],
        groups: [...map.values()].slice(offset, offset + limit),
        total: map.size,
      };
    };
    void execute()
      .then((result) => {
        if (run !== request.current) return;
        setTracks(result.tracks);
        setGroups(result.groups || []);
        setTotal(result.total);
      })
      .catch((e) => {
        if (run === request.current) notify(String(e));
      })
      .finally(() => {
        if (run === request.current) setBusy(false);
      });
  }, [
    demo,
    demoTracks,
    browseView,
    search,
    genre,
    artist,
    year,
    favorites,
    recent,
    minRating,
    sort,
    playlist,
    detail,
    revision,
    offset,
  ]);
  useEffect(() => {
    const create = (event: Event) => {
      const queue = (event as CustomEvent<LocalTrack[]>).detail;
      setListName("");
      setSmart(false);
      setDialogError("");
      setPlaylistDialog({ tracks: queue || [] });
    };
    window.addEventListener("crate-new-playlist", create);
    return () => window.removeEventListener("crate-new-playlist", create);
  }, []);
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1);
    window.addEventListener("crate-library-changed", changed);
    return () => window.removeEventListener("crate-library-changed", changed);
  }, []);
  async function resolve(ids: string[]) {
    return demo
      ? demoTracks.filter((t) => ids.includes(t.id))
      : await window.crate!.libraryResolve(ids);
  }
  function play(items: LocalTrack[], at = 0, shuffled = false) {
    if (demo) {
      notify(
        "Sample records are for browsing. Add your music folder to play full tracks.",
      );
      return;
    }
    music.setShuffle(shuffled);
    music.start(items, at);
  }
  async function edit(ids: string[], patch: Record<string, unknown>) {
    if (demo) {
      notify("Library edits are available with your own music.");
      return false;
    }
    try {
      await window.crate!.libraryEdit(ids, patch);
      music.patchTracks(ids, patch as Partial<LocalTrack>);
      setRevision((v) => v + 1);
      return true;
    } catch (e) {
      notify(String(e));
      return false;
    }
  }
  const activeFilters = search
    ? 0
    : Number(!!genre) +
      Number(!!artist) +
      Number(!!year) +
      Number(favorites) +
      Number(recent) +
      Number(!!minRating);
  const selectedTracks = tracks.filter((t) => selected.has(t.id));
  function addToList(items: LocalTrack[]) {
    setListName("");
    setSmart(false);
    setDialogError("");
    setPlaylistDialog({ tracks: items });
  }
  async function playAll(shuffled = false) {
    if (demo) {
      play([]);
      return;
    }
    try {
      const result: LocalTrack[] = [];
      let count = 1;
      for (let offset = 0; offset < count; offset += 1000) {
        const page = await window.crate!.libraryQuery({
          ...scopeOptions,
          view: "tracks",
          limit: 1000,
          offset,
        });
        count = page.total;
        result.push(...page.tracks);
      }
      if (result.length) play(result, 0, shuffled);
    } catch (e) {
      notify(String(e));
    }
  }
  function openGroup(group: LibraryGroup) {
    if (browseView === "albums")
      setExpanded((id) => (id === group.id ? null : group.id));
    else {
      setDetail({ kind: browseView, id: group.id, title: group.title });
      setOffset(0);
    }
  }
  const expandedIndex = groups.findIndex((g) => g.id === expanded);
  const expansionAfter = Math.min(
    groups.length - 1,
    Math.ceil((expandedIndex + 1) / columns) * columns - 1,
  );
  const actions = (items: LocalTrack[]) => (
    <>
      <button onClick={() => music.enqueue(items, true)}>Play next</button>
      <button onClick={() => music.enqueue(items)}>Add to queue</button>
      <button onClick={() => addToList(items)}>Add to playlist</button>
    </>
  );
  return (
    <>
      <Toolbar>
        {detail && (
          <button
            className="icon-button"
            aria-label="Back to library"
            onClick={() => setDetail(null)}
          >
            <ArrowLeft size={17} />
          </button>
        )}
        {search ? (
          <span className="toolbar-context">Search results</span>
        ) : playlist ? (
          <>
            <span className="toolbar-context" title={list?.name}>
              {list?.name || "Playlist"}
            </span>
            <button
              className="icon-button"
              aria-label="Close playlist"
              onClick={() => onPlaylist("")}
            >
              <X size={15} />
            </button>
          </>
        ) : detail ? (
          <span className="toolbar-context" title={detail.title}>
            {detail.title}
          </span>
        ) : (
          <select
            aria-label="Library view"
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            <option value="albums">Albums</option>
            <option value="artists">Artists</option>
            <option value="tracks">Tracks</option>
            <option value="folders">Folders</option>
          </select>
        )}
        {!search && (
          <details className="toolbar-popover">
            <summary>
              <SlidersHorizontal size={14} />
              <span>Filters{activeFilters ? ` · ${activeFilters}` : ""}</span>
            </summary>
            <div className="popover-panel">
              <label>
                Genre
                <select
                  aria-label="Library genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                >
                  <option value="">All genres</option>
                  {facets.genres.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label>
                Artist
                <select
                  aria-label="Library artist"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                >
                  <option value="">All artists</option>
                  {facets.artists.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Year
                <select
                  aria-label="Library year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                >
                  <option value="">All years</option>
                  {facets.years.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={favorites}
                  onChange={(e) => setFavorites(e.target.checked)}
                />{" "}
                Liked tracks only
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={recent}
                  onChange={(e) => setRecent(e.target.checked)}
                />{" "}
                Recently played
              </label>
              <label>
                Minimum rating
                <select
                  value={minRating}
                  onChange={(e) => setMinRating(Number(e.target.value))}
                >
                  <option value="0">Any rating</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} stars
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="text-button"
                onClick={() => {
                  setGenre("");
                  setArtist("");
                  setYear("");
                  setFavorites(false);
                  setRecent(false);
                  setMinRating(0);
                }}
              >
                Clear all filters
              </button>
            </div>
          </details>
        )}
        {!search && (
          <button
            className="icon-button"
            aria-label="Show liked tracks only"
            title="Show liked tracks only"
            aria-pressed={favorites}
            onClick={() => setFavorites((value) => !value)}
          >
            <Heart size={15} fill={favorites ? "currentColor" : "none"} />
          </button>
        )}
        {
          <>
            <button
              className="icon-button"
              aria-label="Play displayed tracks"
              title={
                favorites
                  ? "Play liked tracks matching your filters"
                  : "Play all matching tracks"
              }
              disabled={!total || busy}
              onClick={() => void playAll()}
            >
              <Play size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Shuffle displayed tracks"
              title={
                favorites
                  ? "Shuffle liked tracks matching your filters"
                  : "Shuffle all matching tracks"
              }
              disabled={!total || busy}
              onClick={() => void playAll(true)}
            >
              <Shuffle size={16} />
            </button>
          </>
        }
        <span className="toolbar-spacer" />
        {total > limit && (
          <>
            <button
              className="icon-button"
              aria-label="Previous library page"
              disabled={!offset || busy}
              onClick={() => setOffset((n) => Math.max(0, n - limit))}
            >
              <ArrowLeft size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="Next library page"
              disabled={offset + limit >= total || busy}
              onClick={() => setOffset((n) => n + limit)}
            >
              <ArrowDown size={15} />
            </button>
          </>
        )}
        <span className="toolbar-count" role="status">
          {busy ? "Loading…" : `${total.toLocaleString()} ${browseView}`}
        </span>
        {!playlist && (
          <select
            aria-label="Sort library"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="added">Recently added</option>
            <option value="artist">Artist A–Z</option>
            <option value="title">Title A–Z</option>
            <option value="year">Newest first</option>
          </select>
        )}
        {browseView !== "tracks" && (
          <button
            className="icon-button"
            aria-label={
              layout === "grid" ? "Show compact list" : "Show album grid"
            }
            onClick={() => setLayout(layout === "grid" ? "list" : "grid")}
          >
            {layout === "grid" ? <List size={17} /> : <Grid2X2 size={17} />}
          </button>
        )}
        {list && (
          <details className="toolbar-popover">
            <summary aria-label="Playlist options">
              <Ellipsis size={18} />
            </summary>
            <div className="popover-panel">
              <button
                onClick={() => {
                  setListName(list.name);
                  setSmart(!!list.rule);
                  setRuleGenre(list.rule?.genre || "");
                  setRuleRating(list.rule?.rating || 0);
                  setRuleFavorite(!!list.rule?.favorite);
                  setDialogError("");
                  setPlaylistDialog({ tracks, existing: list });
                }}
              >
                Edit playlist
              </button>
              <button
                onClick={async () => {
                  if (!demo) await window.crate!.playlistExport(list.id);
                }}
              >
                Export M3U8
              </button>
              <button
                onClick={async () => {
                  if (demo) return;
                  await window.crate!.playlistDelete(list.id);
                  await music.refreshPlaylists();
                  onPlaylist("");
                }}
              >
                Delete playlist
              </button>
            </div>
          </details>
        )}
        <button
          className="icon-button"
          aria-label="Add music folder"
          title="Index an existing music folder"
          onClick={onAdd}
        >
          <Plus size={18} />
        </button>
      </Toolbar>
      <div className="library-content">
        <h1 className="sr-only">
          {search
            ? "Search your library"
            : detail?.title || list?.name || "Library"}
        </h1>
        {busy && !tracks.length && !groups.length ? (
          <div className="quiet-empty">
            <Loader2 className="spin" size={24} />
            <p>Opening your collection…</p>
          </div>
        ) : !total ? (
          <div className="quiet-empty">
            {search ? <Search size={30} /> : <Disc3 size={32} />}
            <h2>
              {search
                ? "No matching local tracks"
                : list
                  ? "This playlist is empty"
                  : activeFilters
                    ? "No music matches these filters"
                    : "Your music belongs here"}
            </h2>
            <p>
              {search
                ? "Try an artist, album, or track name."
                : list
                  ? "Add tracks from any album or track menu."
                  : "Browse existing music without changing your files."}
            </p>
            <button
              className="secondary-button"
              onClick={
                search
                  ? onClearSearch
                  : list
                    ? () => onPlaylist("")
                    : activeFilters
                      ? () => {
                          setGenre("");
                          setArtist("");
                          setYear("");
                          setFavorites(false);
                          setRecent(false);
                          setMinRating(0);
                        }
                      : onAdd
              }
            >
              {search
                ? "Clear search"
                : list
                  ? "Browse your library"
                  : activeFilters
                    ? "Clear filters"
                    : "Choose music folder"}
            </button>
          </div>
        ) : browseView === "tracks" ? (
          <>
            {!!selected.size && (
              <div className="selection-toolbar">
                <span>{selected.size} selected</span>
                <button
                  onClick={() => setSelected(new Set(tracks.map((t) => t.id)))}
                >
                  Select displayed
                </button>
                <button onClick={() => music.enqueue(selectedTracks)}>
                  Add to queue
                </button>
                <button onClick={() => addToList(selectedTracks)}>
                  Add to playlist
                </button>
                <button
                  onClick={() => void edit([...selected], { favorite: true })}
                >
                  Favorite
                </button>
                {list && !list.rule && (
                  <button
                    onClick={async () => {
                      await window.crate!.playlistSave({
                        ...list,
                        tracks: list.tracks.filter((id) => !selected.has(id)),
                      });
                      setSelected(new Set());
                      await music.refreshPlaylists();
                      setRevision((n) => n + 1);
                    }}
                  >
                    Remove from playlist
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="Clear track selection"
                  onClick={() => setSelected(new Set())}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <table className="library-tracks">
              <thead>
                <tr>
                  <th aria-label="Select" />
                  <th>Title</th>
                  <th>Artist</th>
                  <th className="album-column">Album</th>
                  <th className="rating-column">Rating</th>
                  <th>Time</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {tracks.map((t, i) => (
                  <tr
                    key={`${t.id}-${i}`}
                    className={`${music.current?.id === t.id ? "playing-track" : ""} ${selected.has(t.id) ? "selected" : ""}`}
                    tabIndex={0}
                    onDoubleClick={() => play(tracks, i)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        play(tracks, i);
                      }
                      if (e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelected((s) => {
                          const n = new Set(s);
                          n.has(t.id) ? n.delete(t.id) : n.add(t.id);
                          return n;
                        });
                      }
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.title}`}
                        checked={selected.has(t.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            e.target.checked ? n.add(t.id) : n.delete(t.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td>
                      <div className="track-title-cell">
                        <button
                          className="track-art-play"
                          aria-label={`Play ${t.title}`}
                          onClick={() => play(tracks, i)}
                        >
                          <LocalArt track={{ ...t, title: t.album }} />
                          <Play size={14} />
                        </button>
                        <span>
                          <strong>{t.title}</strong>
                          {t.missing && <small>File unavailable</small>}
                        </span>
                        <button
                          className="track-heart icon-button"
                          aria-label={`Favorite ${t.title}`}
                          aria-pressed={!!t.favorite}
                          onClick={() =>
                            void edit([t.id], { favorite: !t.favorite })
                          }
                        >
                          <Heart
                            size={13}
                            fill={t.favorite ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                    </td>
                    <td>{t.artist}</td>
                    <td className="album-column">{t.album}</td>
                    <td className="rating-column">
                      <select
                        aria-label={`Rating for ${t.title}`}
                        value={t.rating || 0}
                        onChange={(e) =>
                          void edit([t.id], { rating: Number(e.target.value) })
                        }
                      >
                        <option value="0">—</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {"★".repeat(n)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="time-cell">
                      {t.duration ? clock(t.duration) : "—"}
                    </td>
                    <td>
                      <details className="row-menu">
                        <summary aria-label={`Actions for ${t.title}`}>
                          <Ellipsis size={17} />
                        </summary>
                        <div>
                          {actions([t])}
                          <button
                            onClick={() => {
                              setEditor(t);
                              setEditTitle(t.title);
                              setEditArtist(t.artist);
                              setEditAlbum(t.album);
                              setEditTags((t.tags || []).join(", "));
                              setEditNote(t.note || "");
                            }}
                          >
                            Edit library details
                          </button>
                          {list && !list.rule && (
                            <>
                              <button
                                disabled={i === 0}
                                onClick={async () => {
                                  const ids = [...list.tracks];
                                  [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                                  await window.crate!.playlistSave({
                                    ...list,
                                    tracks: ids,
                                  });
                                  setRevision((n) => n + 1);
                                }}
                              >
                                <ArrowUp size={12} /> Move up
                              </button>
                              <button
                                disabled={i === tracks.length - 1}
                                onClick={async () => {
                                  const ids = [...list.tracks];
                                  [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                                  await window.crate!.playlistSave({
                                    ...list,
                                    tracks: ids,
                                  });
                                  setRevision((n) => n + 1);
                                }}
                              >
                                <ArrowDown size={12} /> Move down
                              </button>
                            </>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div
            ref={grid}
            className={`library-grid ${layout === "list" ? "compact-library" : ""}`}
          >
            {groups.map((g, index) => (
              <Fragment key={g.id}>
                <article
                  className={`library-album ${expanded === g.id ? "album-is-expanded" : ""}`}
                >
                  <div className="library-cover">
                    <button
                      className="album-open"
                      aria-label={`Open ${g.title}`}
                      aria-expanded={
                        browseView === "albums" ? expanded === g.id : undefined
                      }
                      onClick={() => openGroup(g)}
                    >
                      <LocalArt track={g} />
                    </button>
                    <button
                      className="album-play"
                      aria-label={`Play ${g.title}`}
                      onClick={async () => play(await resolve(g.tracks))}
                    >
                      <Play size={20} fill="currentColor" />
                    </button>
                    <details className="row-menu album-menu">
                      <summary aria-label={`Actions for ${g.title}`}>
                        <Ellipsis size={17} />
                      </summary>
                      <div>
                        <button
                          onClick={async () =>
                            music.enqueue(await resolve(g.tracks), true)
                          }
                        >
                          Play next
                        </button>
                        <button
                          onClick={async () =>
                            music.enqueue(await resolve(g.tracks))
                          }
                        >
                          Add to queue
                        </button>
                        <button
                          onClick={async () =>
                            addToList(await resolve(g.tracks))
                          }
                        >
                          Add to playlist
                        </button>
                      </div>
                    </details>
                  </div>
                  <button
                    className="album-caption"
                    onClick={() => openGroup(g)}
                  >
                    <strong>{g.title}</strong>
                    <span>
                      {browseView === "albums"
                        ? g.artist
                        : `${g.tracks.length} tracks`}
                    </span>
                  </button>
                </article>
                {browseView === "albums" &&
                  expandedIndex >= 0 &&
                  index === expansionAfter && (
                    <AlbumExpansion
                      key={expanded!}
                      group={groups[expandedIndex]}
                      resolve={resolve}
                      revision={revision}
                      current={music.current?.id}
                      onPlay={play}
                      onQueue={(items) => music.enqueue(items)}
                      onFavorite={(track) => {
                        void edit([track.id], { favorite: !track.favorite });
                      }}
                      onClose={() => {
                        const index = expandedIndex;
                        setExpanded(null);
                        requestAnimationFrame(() => {
                          const button =
                            grid.current?.querySelectorAll<HTMLButtonElement>(
                              ".album-open",
                            )[index];
                          button?.focus();
                        });
                      }}
                    />
                  )}
              </Fragment>
            ))}
          </div>
        )}

        {!!savedMatches.length && (
          <section className="search-saved">
            <h2>Wishlist</h2>
            <div className="library-grid">
              {savedMatches.map((item) => (
                <article key={item.id} className="library-album">
                  <button
                    className="album-open"
                    onClick={() => onOpenRecord(item)}
                  >
                    <LocalArt track={item} />
                  </button>
                  <button
                    className="album-caption"
                    onClick={() => onOpenRecord(item)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.artist}</span>
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
      {editor && (
        <Dialog title="Library details" onClose={() => setEditor(null)}>
          <p className="muted small">
            Saved in Crate Digger. Your audio files stay unchanged.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const saved = await edit([editor.id], {
                overrides: {
                  title: editTitle,
                  artist: editArtist,
                  album: editAlbum,
                  albumArtist: editor.albumArtist || editor.artist,
                  genre: editor.genre,
                  year: editor.year,
                },
                note: editNote,
                tags: editTags
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              if (saved) setEditor(null);
            }}
          >
            <label>
              Title
              <input
                value={editTitle}
                maxLength={500}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </label>
            <label>
              Artist
              <input
                value={editArtist}
                maxLength={500}
                onChange={(e) => setEditArtist(e.target.value)}
              />
            </label>
            <label>
              Album
              <input
                value={editAlbum}
                maxLength={500}
                onChange={(e) => setEditAlbum(e.target.value)}
              />
            </label>
            <label>
              Personal tags
              <input
                value={editTags}
                maxLength={1000}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="Separate with commas"
              />
            </label>
            <label>
              Note
              <textarea
                value={editNote}
                maxLength={2000}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </label>
            <p className="file-info">
              {editor.path}
              <br />
              {editor.format} ·{" "}
              {editor.sampleRate ? `${editor.sampleRate / 1000} kHz` : ""} ·{" "}
              {clock(editor.duration || 0)}
            </p>
            <button className="primary-button">Save library details</button>
          </form>
        </Dialog>
      )}
      {playlistDialog && (
        <Dialog
          title={playlistDialog.existing ? "Edit playlist" : "Add to playlist"}
          onClose={() => setPlaylistDialog(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (demo) {
                setDialogError("Add your own music folder to save playlists.");
                return;
              }
              try {
                const value = await window.crate!.playlistSave({
                  id: playlistDialog.existing?.id,
                  name: listName,
                  tracks:
                    playlistDialog.existing?.tracks ||
                    playlistDialog.tracks.map((t) => t.id),
                  ...(smart
                    ? {
                        rule: {
                          ...playlistDialog.existing?.rule,
                          genre: ruleGenre,
                          rating: ruleRating,
                          favorite: ruleFavorite,
                        },
                      }
                    : {}),
                });
                await music.refreshPlaylists();
                setPlaylistDialog(null);
                onPlaylist(value.id);
              } catch (e) {
                setDialogError(String(e));
              }
            }}
          >
            {!playlistDialog.existing &&
              !!music.playlists.filter((p) => !p.rule).length && (
                <label>
                  Add to existing
                  <select
                    defaultValue=""
                    aria-label="Existing playlist"
                    onChange={async (e) => {
                      const p = music.playlists.find(
                        (p) => p.id === e.target.value,
                      );
                      if (!p) return;
                      try {
                        await window.crate!.playlistSave({
                          ...p,
                          tracks: [
                            ...p.tracks,
                            ...playlistDialog.tracks.map((t) => t.id),
                          ],
                        });
                        await music.refreshPlaylists();
                        setPlaylistDialog(null);
                        notify(`Added to ${p.name}.`);
                      } catch (e) {
                        setDialogError(String(e));
                      }
                    }}
                  >
                    <option value="">Choose a playlist…</option>
                    {music.playlists
                      .filter((p) => !p.rule)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            <label>
              Playlist name
              <input
                autoFocus
                required
                maxLength={100}
                value={listName}
                onChange={(e) => setListName(e.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={smart}
                onChange={(e) => setSmart(e.target.checked)}
              />{" "}
              Smart playlist · match rules automatically
            </label>
            {smart && (
              <>
                <label>
                  Genre contains
                  <input
                    value={ruleGenre}
                    maxLength={100}
                    onChange={(e) => setRuleGenre(e.target.value)}
                  />
                </label>
                <label>
                  Minimum rating
                  <select
                    value={ruleRating}
                    onChange={(e) => setRuleRating(Number(e.target.value))}
                  >
                    <option value="0">Any</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} stars
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={ruleFavorite}
                    onChange={(e) => setRuleFavorite(e.target.checked)}
                  />{" "}
                  Favorites only
                </label>
              </>
            )}
            {dialogError && <p role="alert">{dialogError}</p>}
            <button className="primary-button">
              {playlistDialog.existing ? "Save playlist" : "Create playlist"}
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
