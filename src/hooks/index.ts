/**
 * @module rn-audio-stream/hooks
 *
 * React hooks for consuming an `AudioPlayer` instance in components.
 *
 * ## Usage pattern
 *
 * Create **one** `AudioPlayer` at the top of your app (e.g. in a Context),
 * then use these hooks anywhere in the tree.
 *
 * ```tsx
 * // PlayerContext.tsx
 * import React, { createContext, useContext, useEffect, useState } from "react";
 * import { AudioPlayer } from "rn-audio-stream";
 *
 * const PlayerContext = createContext<AudioPlayer | null>(null);
 *
 * export function PlayerProvider({ children }: { children: React.ReactNode }) {
 *   const [player, setPlayer] = useState<AudioPlayer | null>(null);
 *
 *   useEffect(() => {
 *     const p = new AudioPlayer({ gapless: true });
 *     p.init().then(() => setPlayer(p));
 *     return () => { p.destroy(); };
 *   }, []);
 *
 *   if (!player) return null;
 *   return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>;
 * }
 *
 * export const usePlayer = () => useContext(PlayerContext)!;
 * ```
 *
 * Then in any component:
 * ```tsx
 * import { useAudioPlayer, useProgress } from "rn-audio-stream";
 * import { usePlayer } from "./PlayerContext";
 *
 * function NowPlaying() {
 *   const player = usePlayer();
 *   const { currentTrack, playbackState, shuffle, repeatMode } = useAudioPlayer(player);
 *   const { position, duration } = useProgress(player);
 *
 *   return (
 *     <View>
 *       <Text>{currentTrack?.title}</Text>
 *       <Text>{playbackState}</Text>
 *       <Slider value={position} maximumValue={duration} onSlidingComplete={(v) => player.seek(v)} />
 *     </View>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback } from "react";
import type { AudioPlayer } from "../AudioPlayer";
import type { PlayerState, Track, PlaybackState, RepeatMode } from "../types";

// ─── useAudioPlayer ───────────────────────────────────────────────────────────

/**
 * Subscribe to the full `PlayerState` of a given `AudioPlayer` instance.
 *
 * The returned object is a stable reference — React will only re-render your
 * component when the state actually changes.
 *
 * @param player  The `AudioPlayer` to observe.
 * @returns A read-only `PlayerState` snapshot, updated on every state change.
 *
 * @example
 * const { currentTrack, playbackState } = useAudioPlayer(player);
 */
export function useAudioPlayer(player: AudioPlayer): Readonly<PlayerState> {
  const [state, setState] = useState<PlayerState>(() => player.state);

  useEffect(() => {
    // Sync immediately in case state changed between render and effect.
    setState(player.state);
    const off = player.on("stateChange", setState);
    return off;
  }, [player]);

  return state;
}

// ─── useProgress ──────────────────────────────────────────────────────────────

/**
 * Lightweight hook that only re-renders on progress tick (position / duration /
 * buffered changes). Use this for seek bars to avoid re-rendering the entire
 * player UI every second.
 *
 * @param player  The `AudioPlayer` to observe.
 * @returns `{ position, duration, buffered }` — all in seconds.
 *
 * @example
 * const { position, duration, buffered } = useProgress(player);
 * const percent = duration > 0 ? position / duration : 0;
 */
export function useProgress(player: AudioPlayer): {
  position: number;
  duration: number;
  buffered: number;
} {
  const [progress, setProgress] = useState({
    position: player.state.position,
    duration: player.state.duration,
    buffered: player.state.buffered,
  });

  useEffect(() => {
    const off = player.on("progress", setProgress);
    return off;
  }, [player]);

  return progress;
}

// ─── useQueue ─────────────────────────────────────────────────────────────────

/**
 * Returns the current track queue and helpers to manipulate it.
 *
 * Re-renders only when the queue array reference changes (on add / remove /
 * shuffle).
 *
 * @example
 * const { queue, currentIndex, addToQueue, skipToIndex } = useQueue(player);
 */
export function useQueue(player: AudioPlayer): {
  /** The current (possibly shuffled) queue. */
  queue: Track[];

  /** Index of the playing track within `queue`. */
  currentIndex: number;

  /** Append tracks to the end of the queue. */
  addToQueue: (tracks: Track[]) => Promise<void>;

  /** Play next (insert immediately after current). */
  playNext: (track: Track) => Promise<void>;

  /** Remove a track by its `id`. */
  removeFromQueue: (id: string) => Promise<void>;

  /** Jump to a specific index and start playing. */
  skipToIndex: (index: number) => Promise<void>;

  /** Clear the entire queue. */
  clearQueue: () => Promise<void>;
} {
  const [queue, setQueue] = useState<Track[]>(player.state.queue);
  const [currentIndex, setCurrentIndex] = useState(player.state.currentIndex);

  useEffect(() => {
    const off = player.on("stateChange", (s) => {
      setQueue(s.queue);
      setCurrentIndex(s.currentIndex);
    });
    return off;
  }, [player]);

  const addToQueue    = useCallback((t: Track[]) => player.addToQueue(t), [player]);
  const playNext      = useCallback((t: Track)   => player.playNext(t),   [player]);
  const removeFromQueue = useCallback((id: string) => player.removeFromQueue(id), [player]);
  const skipToIndex   = useCallback((i: number)  => player.skipToIndex(i), [player]);
  const clearQueue    = useCallback(()            => player.clearQueue(),   [player]);

  return { queue, currentIndex, addToQueue, playNext, removeFromQueue, skipToIndex, clearQueue };
}

// ─── usePlaybackControls ──────────────────────────────────────────────────────

/**
 * Returns stable callbacks for the most common playback actions.
 * None of these callbacks change identity between renders, so they are
 * safe to pass as props without triggering re-renders.
 *
 * @example
 * const { play, pause, togglePlayPause, next, previous, seek } = usePlaybackControls(player);
 */
export function usePlaybackControls(player: AudioPlayer): {
  play:            () => Promise<void>;
  pause:           () => Promise<void>;
  stop:            () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next:            () => Promise<void>;
  previous:        () => Promise<void>;
  seek:            (position: number) => Promise<void>;
  setVolume:       (volume: number) => Promise<void>;
  setRate:         (rate: number) => Promise<void>;
} {
  return {
    play:            useCallback(() => player.play(),           [player]),
    pause:           useCallback(() => player.pause(),          [player]),
    stop:            useCallback(() => player.stop(),           [player]),
    togglePlayPause: useCallback(() => player.togglePlayPause(),[player]),
    next:            useCallback(() => player.next(),           [player]),
    previous:        useCallback(() => player.previous(),       [player]),
    seek:            useCallback((p) => player.seek(p),         [player]),
    setVolume:       useCallback((v) => player.setVolume(v),    [player]),
    setRate:         useCallback((r) => player.setRate(r),      [player]),
  };
}

// ─── useRepeatShuffle ─────────────────────────────────────────────────────────

/**
 * Exposes repeat / shuffle state and setters.
 *
 * @example
 * const { repeatMode, shuffle, cycleRepeatMode, setShuffle } = useRepeatShuffle(player);
 *
 * <Pressable onPress={cycleRepeatMode}>
 *   <RepeatIcon mode={repeatMode} />
 * </Pressable>
 *
 * <Pressable onPress={() => setShuffle(!shuffle)}>
 *   <ShuffleIcon active={shuffle} />
 * </Pressable>
 */
export function useRepeatShuffle(player: AudioPlayer): {
  repeatMode:       RepeatMode;
  shuffle:          boolean;
  setRepeatMode:    (mode: RepeatMode) => Promise<void>;
  cycleRepeatMode:  () => Promise<void>;
  setShuffle:       (enabled?: boolean) => Promise<void>;
} {
  const [repeatMode, setRepeatMode_] = useState<RepeatMode>(player.state.repeatMode);
  const [shuffle, setShuffle_]       = useState(player.state.shuffle);

  useEffect(() => {
    const off = player.on("stateChange", (s) => {
      setRepeatMode_(s.repeatMode);
      setShuffle_(s.shuffle);
    });
    return off;
  }, [player]);

  const setRepeatMode   = useCallback((m: RepeatMode) => player.setRepeatMode(m),   [player]);
  const cycleRepeatMode = useCallback(()              => player.cycleRepeatMode(),   [player]);
  const setShuffle      = useCallback((e?: boolean)   => player.setShuffle(e),       [player]);

  return { repeatMode, shuffle, setRepeatMode, cycleRepeatMode, setShuffle };
}

// ─── usePlaybackState ─────────────────────────────────────────────────────────

/**
 * Minimal hook that only returns the current `PlaybackState` string.
 * Useful when you only need to drive button icons (play/pause/loading).
 *
 * @example
 * const playbackState = usePlaybackState(player);
 * const isPlaying = playbackState === "playing";
 */
export function usePlaybackState(player: AudioPlayer): PlaybackState {
  const [ps, setPs] = useState<PlaybackState>(player.state.playbackState);

  useEffect(() => {
    const off = player.on("stateChange", (s) => setPs(s.playbackState));
    return off;
  }, [player]);

  return ps;
}

// ─── useNowPlaying ────────────────────────────────────────────────────────────

/**
 * Returns only the currently playing `Track` (or `null`).
 * Re-renders only on track changes, not on progress ticks.
 *
 * @example
 * const track = useNowPlaying(player);
 * return <Text>{track?.title ?? "Nothing playing"}</Text>;
 */
export function useNowPlaying(player: AudioPlayer): Track | null {
  const [track, setTrack] = useState<Track | null>(player.state.currentTrack);

  useEffect(() => {
    const off = player.on("trackChange", ({ current }) => setTrack(current));
    return off;
  }, [player]);

  return track;
}