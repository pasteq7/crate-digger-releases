import { useEffect, useRef, useState } from "react";
import type { LocalTrack, PlaybackState, Playlist, Settings } from "./types";

export function useLocalPlayer(
  demo: boolean,
  notify: (message: string) => void,
  settings: Settings,
) {
  const audio = useRef<HTMLAudioElement>(null);
  const element = useRef<HTMLAudioElement>(null);
  const spare = useRef<HTMLAudioElement | null>(null);
  const fade = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeAttempt = useRef(false),
    heard = useRef(0),
    lastTime = useRef(0);
  const preferences = useRef(settings);
  preferences.current = settings;
  const [queue, setQueue] = useState<LocalTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.65);
  const [repeat, setRepeat] = useState<PlaybackState["repeat"]>("off");
  const [shuffle, setShuffle] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const hydrated = useRef(false),
    request = useRef(0),
    seekTo = useRef<number | null>(null);
  const history = useRef<number[]>([]),
    remaining = useRef<number[]>([]),
    failed = useRef(new Set<number>()),
    counted = useRef(false);
  const currentState = useRef({
    queue,
    index,
    position,
    volume,
    repeat,
    shuffle,
  });
  currentState.current = { queue, index, position, volume, repeat, shuffle };
  const current = queue[index] || null;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  function effectiveVolume(
    track: LocalTrack | null,
    value = currentState.current.volume,
  ) {
    const mode = preferences.current.normalization || "off";
    if (!track || mode === "off") return value;
    const db =
      mode === "album"
        ? (track.albumGainDb ?? track.trackGainDb)
        : track.trackGainDb;
    const peak =
      mode === "album" ? track.albumPeak || track.trackPeak : track.trackPeak;
    if (db === undefined || db === null || !Number.isFinite(db)) return value;
    const gain = Math.pow(10, Math.max(-30, Math.min(20, db)) / 20);
    return Math.max(
      0,
      Math.min(1, value * Math.min(gain, peak && peak > 0 ? 1 / peak : 1)),
    );
  }
  function cancelFade() {
    if (fade.current) clearInterval(fade.current);
    fade.current = null;
    spare.current?.pause();
    if (audio.current)
      audio.current.volume = effectiveVolume(
        currentState.current.queue[currentState.current.index],
      );
  }
  useEffect(() => {
    audio.current = element.current;
    const next = new Audio();
    next.preload = "auto";
    spare.current = next;
    return () => {
      cancelFade();
      next.pause();
      next.removeAttribute("src");
      next.load();
      audio.current?.pause();
    };
  }, []);
  const persist = () => {
    if (!hydrated.current || demo || !window.crate) return;
    const s = currentState.current;
    void window.crate
      .playbackSave({
        ...s,
        queue: s.queue.map((t) => t.id),
        position: audio.current?.currentTime || s.position,
      })
      .catch((e) => notifyRef.current(String(e)));
  };
  useEffect(() => {
    let alive = true;
    hydrated.current = false;
    request.current++;
    audio.current?.pause();
    setQueue([]);
    setIndex(0);
    setPosition(0);
    setSuspended(false);
    setPlaylists([]);
    if (demo || !window.crate) return;
    void (async () => {
      try {
        const snapshot = await window.crate!.libraryState();
        const tracks =
          snapshot.playback && preferences.current.playbackResume !== false
            ? await window.crate!.libraryResolve(snapshot.playback.queue)
            : [];
        if (!alive) return;
        setPlaylists(snapshot.playlists);
        if (snapshot.playback) {
          const s = snapshot.playback;
          setQueue(tracks);
          setIndex(
            tracks.length
              ? Math.min(s.index, Math.max(0, tracks.length - 1))
              : 0,
          );
          setPosition(tracks.length ? s.position : 0);
          setVolume(s.volume);
          setRepeat(s.repeat);
          setShuffle(s.shuffle);
          seekTo.current = tracks.length ? s.position : 0;
        }
        hydrated.current = true;
      } catch (e) {
        notifyRef.current(String(e));
      }
    })();
    return () => {
      alive = false;
      hydrated.current = false;
      audio.current?.pause();
    };
  }, [demo]);
  useEffect(() => {
    if (audio.current) audio.current.volume = effectiveVolume(current);
  }, [volume, settings.normalization, current?.id]);
  useEffect(() => {
    cancelFade();
    fadeAttempt.current = false;
    const nextIndex =
      index + 1 < queue.length ? index + 1 : repeat === "all" ? 0 : -1;
    if (
      settings.crossfadeSeconds &&
      !shuffle &&
      repeat !== "one" &&
      nextIndex >= 0 &&
      nextIndex !== index &&
      spare.current &&
      queue[nextIndex]
    ) {
      spare.current.src = queue[nextIndex].mediaUrl;
      spare.current.volume = 0;
      spare.current.load();
    }
  }, [queue, index, shuffle, repeat, settings.crossfadeSeconds]);
  useEffect(() => {
    const timer = setTimeout(persist, 350);
    return () => clearTimeout(timer);
  }, [queue, index, volume, shuffle, repeat]);
  useEffect(() => {
    const timer = setInterval(persist, 5000);
    window.addEventListener("beforeunload", persist);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", persist);
    };
  }, [demo]);
  useEffect(() => {
    const pause = () => {
      cancelFade();
      audio.current?.pause();
      if (currentState.current.queue.length) setSuspended(true);
    };
    window.addEventListener("crate-preview-start", pause);
    return () => window.removeEventListener("crate-preview-start", pause);
  }, []);
  async function playAt(
    nextIndex: number,
    tracks = currentState.current.queue,
    start = 0,
  ) {
    if (!tracks.length || !tracks[nextIndex]) return;
    cancelFade();
    fadeAttempt.current = false;
    const el = audio.current;
    if (!el) return;
    const id = ++request.current;
    window.dispatchEvent(new Event("crate-local-start"));
    setSuspended(false);
    setQueue(tracks);
    setIndex(nextIndex);
    setPosition(start);
    setDuration(tracks[nextIndex].duration || 0);
    setLoading(true);
    if (
      !start ||
      tracks[nextIndex].id !==
        currentState.current.queue[currentState.current.index]?.id
    ) {
      counted.current = false;
      heard.current = 0;
    }
    lastTime.current = start;
    seekTo.current = start;
    currentState.current = {
      ...currentState.current,
      queue: tracks,
      index: nextIndex,
      position: start,
    };
    el.src = tracks[nextIndex].mediaUrl;
    el.volume = effectiveVolume(tracks[nextIndex]);
    try {
      await el.play();
      if (id === request.current) setPlaying(true);
    } catch (e) {
      if (id === request.current && (e as DOMException).name !== "AbortError") {
        setPlaying(false);
        notifyRef.current(
          "This file could not play. Check its location and audio format.",
        );
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  function start(tracks: LocalTrack[], at = 0) {
    history.current = [];
    remaining.current = [];
    failed.current.clear();
    void playAt(at, [...tracks]);
  }
  function next(ended = false) {
    const s = currentState.current;
    if (!s.queue.length) return;
    if (ended && s.repeat === "one") {
      void playAt(s.index);
      return;
    }
    let target = s.index + 1;
    if (s.shuffle) {
      if (!remaining.current.length) {
        if (
          ended &&
          history.current.length >= s.queue.length - 1 &&
          s.repeat === "off"
        ) {
          setPlaying(false);
          persist();
          return;
        }
        remaining.current = s.queue
          .map((_, i) => i)
          .filter((i) => i !== s.index && !failed.current.has(i));
        for (let i = remaining.current.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [remaining.current[i], remaining.current[j]] = [
            remaining.current[j],
            remaining.current[i],
          ];
        }
      }
      target = remaining.current.pop() ?? -1;
    } else {
      while (target < s.queue.length && failed.current.has(target)) target++;
      if (target >= s.queue.length && s.repeat === "all")
        target = s.queue.findIndex((_, i) => !failed.current.has(i));
    }
    if (target < 0 || target >= s.queue.length) {
      setPlaying(false);
      audio.current?.pause();
      persist();
      return;
    }
    history.current.push(s.index);
    void playAt(target);
  }
  function previous() {
    if ((audio.current?.currentTime || position) > 3) {
      seek(0);
      return;
    }
    const target = shuffle ? history.current.pop() : Math.max(0, index - 1);
    if (target !== undefined) void playAt(target);
  }
  function toggle() {
    cancelFade();
    const el = audio.current;
    if (!el || !current) return;
    if (!el.paused && !suspended) {
      el.pause();
      persist();
      return;
    }
    if (suspended || !el.src) {
      void playAt(index, queue, el.src ? el.currentTime : position);
      return;
    }
    window.dispatchEvent(new Event("crate-local-start"));
    void el
      .play()
      .catch(() =>
        notifyRef.current("This file could not play. Try another track."),
      );
  }
  function seek(value: number) {
    cancelFade();
    fadeAttempt.current = false;
    lastTime.current = value;
    if (audio.current?.src) audio.current.currentTime = value;
    else seekTo.current = value;
    setPosition(value);
    currentState.current = { ...currentState.current, position: value };
    persist();
  }
  function enqueue(tracks: LocalTrack[], nextItem = false) {
    const s = currentState.current,
      items = [...s.queue];
    items.splice(nextItem ? s.index + 1 : items.length, 0, ...tracks);
    remaining.current = [];
    setQueue(items);
    currentState.current = { ...s, queue: items };
    notifyRef.current(
      `${tracks.length} track${tracks.length === 1 ? "" : "s"} added ${nextItem ? "next" : "to queue"}.`,
    );
  }
  function remove(at: number) {
    const s = currentState.current;
    const items = s.queue.filter((_, i) => i !== at);
    if (at === s.index) {
      audio.current?.pause();
      if (items.length) void playAt(Math.min(at, items.length - 1), items);
      else {
        setQueue([]);
        setIndex(0);
        setPosition(0);
      }
    } else {
      setQueue(items);
      setIndex(at < s.index ? s.index - 1 : s.index);
    }
    remaining.current = [];
    history.current = [];
  }
  function move(at: number, delta: number) {
    const target = at + delta;
    if (target < 0 || target >= queue.length) return;
    const items = [...queue];
    [items[at], items[target]] = [items[target], items[at]];
    setQueue(items);
    if (index === at) setIndex(target);
    else if (index === target) setIndex(at);
    remaining.current = [];
    history.current = [];
  }
  function timeUpdate() {
    const el = audio.current;
    if (!el) return;
    setPosition(el.currentTime);
    const delta = el.currentTime - lastTime.current;
    if (!el.paused && delta > 0 && delta < 1.5) heard.current += delta;
    lastTime.current = el.currentTime;
    const threshold = Math.min(
      30,
      (el.duration || current?.duration || 60) / 2,
    );
    if (!counted.current && !el.paused && heard.current >= threshold) {
      counted.current = true;
      if (current) void window.crate?.trackPlayed(current.id).catch(() => {});
    }
    const seconds = preferences.current.crossfadeSeconds || 0,
      s = currentState.current;
    const target =
      s.index + 1 < s.queue.length ? s.index + 1 : s.repeat === "all" ? 0 : -1;
    if (
      seconds > 0 &&
      !s.shuffle &&
      s.repeat !== "one" &&
      !el.paused &&
      !fade.current &&
      !fadeAttempt.current &&
      target >= 0 &&
      target !== s.index &&
      el.duration - el.currentTime <= seconds &&
      spare.current?.readyState &&
      spare.current.readyState >= 2
    ) {
      fadeAttempt.current = true;
      const incoming = spare.current,
        outgoing = el;
      const length = Math.max(
        0.15,
        Math.min(seconds, outgoing.duration - outgoing.currentTime),
      );
      const started = performance.now();
      incoming.currentTime = 0;
      incoming.volume = 0;
      void incoming
        .play()
        .then(() => {
          if (
            audio.current !== outgoing ||
            outgoing.paused ||
            preferences.current.crossfadeSeconds === 0
          ) {
            incoming.pause();
            return;
          }
          fade.current = setInterval(() => {
            const ratio = Math.min(
              1,
              (performance.now() - started) / (length * 1000),
            );
            outgoing.volume = effectiveVolume(s.queue[s.index]) * (1 - ratio);
            incoming.volume = effectiveVolume(s.queue[target]) * ratio;
            if (ratio >= 1) {
              clearInterval(fade.current!);
              fade.current = null;
              outgoing.pause();
              audio.current = incoming;
              spare.current = outgoing;
              counted.current = false;
              heard.current = 0;
              lastTime.current = incoming.currentTime;
              currentState.current = {
                ...currentState.current,
                index: target,
                position: incoming.currentTime,
              };
              setIndex(target);
              setPosition(incoming.currentTime);
              setDuration(incoming.duration);
              setPlaying(true);
            }
          }, 40);
        })
        .catch(() => {});
    }
  }
  useEffect(() => {
    if (!current || suspended || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: [],
    });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      [
        "play",
        () => {
          if (audio.current?.paused) toggle();
        },
      ],
      ["pause", () => audio.current?.pause()],
      ["previoustrack", previous],
      ["nexttrack", () => next()],
      [
        "seekto",
        (data) => {
          if (data.seekTime !== undefined) seek(data.seekTime);
        },
      ],
    ];
    for (const [name, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(name, handler);
      } catch {}
    }
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    return () => {
      for (const [name] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(name, null);
        } catch {}
      }
    };
  }, [current?.id, playing, suspended, index, queue, shuffle, repeat]);
  const events = {
    onPlay: () => setPlaying(true),
    onPause: () => {
      if (!fade.current) {
        setPlaying(false);
        if (audio.current) setPosition(audio.current.currentTime);
        persist();
      }
    },
    onTimeUpdate: timeUpdate,
    onLoadedMetadata: () => {
      const el = audio.current;
      if (!el) return;
      setDuration(
        Number.isFinite(el.duration) ? el.duration : current?.duration || 0,
      );
      if (seekTo.current !== null) {
        el.currentTime = Math.min(
          seekTo.current,
          Number.isFinite(el.duration)
            ? Math.max(0, el.duration - 0.1)
            : seekTo.current,
        );
        seekTo.current = null;
      }
    },
    onEnded: () => {
      if (!fade.current) next(true);
    },
    onError: () => {
      if (!audio.current?.src) return;
      failed.current.add(currentState.current.index);
      setLoading(false);
      notifyRef.current(
        "File unavailable or unsupported. Skipping to the next queued track.",
      );
      if (failed.current.size < currentState.current.queue.length) next(true);
      else {
        setPlaying(false);
        audio.current?.pause();
      }
    },
  };
  const eventsRef = useRef(events);
  eventsRef.current = events;
  useEffect(() => {
    const extra = spare.current;
    if (!extra) return;
    const handlers = Object.fromEntries(
      Object.entries({
        play: "onPlay",
        pause: "onPause",
        timeupdate: "onTimeUpdate",
        loadedmetadata: "onLoadedMetadata",
        ended: "onEnded",
        error: "onError",
      }).map(([name, handler]) => [
        name,
        () => {
          if (audio.current === extra)
            eventsRef.current[handler as keyof typeof events]();
        },
      ]),
    );
    for (const [name, handler] of Object.entries(handlers))
      extra.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of Object.entries(handlers))
        extra.removeEventListener(name, handler);
    };
  }, []);
  return {
    audio,
    element,
    queue,
    index,
    current,
    position,
    duration,
    playing,
    volume,
    repeat,
    shuffle,
    suspended,
    queueOpen,
    playlists,
    loading,
    setPlaylists,
    setQueueOpen,
    setVolume,
    setRepeat,
    setShuffle: (value: boolean) => {
      remaining.current = [];
      history.current = [];
      setShuffle(value);
    },
    start,
    playAt,
    toggle,
    next,
    previous,
    seek,
    enqueue,
    remove,
    move,
    patchTracks: (ids: string[], patch: Partial<LocalTrack>) =>
      setQueue((items) =>
        items.map((t) => (ids.includes(t.id) ? { ...t, ...patch } : t)),
      ),
    clearUpcoming: () => {
      const items = queue.slice(0, index + 1);
      setQueue(items);
      remaining.current = [];
    },
    refreshPlaylists: async () => {
      if (window.crate && !demo)
        setPlaylists((await window.crate.libraryState()).playlists);
    },
    audioEvents: Object.fromEntries(
      Object.entries(events).map(([key, handler]) => [
        key,
        (event: React.SyntheticEvent<HTMLAudioElement>) => {
          if (event.currentTarget === audio.current) handler();
        },
      ]),
    ) as {
      [K in keyof typeof events]: (
        event: React.SyntheticEvent<HTMLAudioElement>,
      ) => void;
    },
  };
}
export type LocalPlayerController = ReturnType<typeof useLocalPlayer>;
