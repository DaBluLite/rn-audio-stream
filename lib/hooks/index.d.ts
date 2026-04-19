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
import type { AudioPlayer } from "../AudioPlayer";
import type { PlayerState, Track, PlaybackState, RepeatMode } from "../types";
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
export declare function useAudioPlayer(player: AudioPlayer): Readonly<PlayerState>;
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
export declare function useProgress(player: AudioPlayer): {
    position: number;
    duration: number;
    buffered: number;
};
/**
 * Returns the current track queue and helpers to manipulate it.
 *
 * Re-renders only when the queue array reference changes (on add / remove /
 * shuffle).
 *
 * @example
 * const { queue, currentIndex, addToQueue, skipToIndex } = useQueue(player);
 */
export declare function useQueue(player: AudioPlayer): {
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
};
/**
 * Returns stable callbacks for the most common playback actions.
 * None of these callbacks change identity between renders, so they are
 * safe to pass as props without triggering re-renders.
 *
 * @example
 * const { play, pause, togglePlayPause, next, previous, seek } = usePlaybackControls(player);
 */
export declare function usePlaybackControls(player: AudioPlayer): {
    play: () => Promise<void>;
    pause: () => Promise<void>;
    stop: () => Promise<void>;
    togglePlayPause: () => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    seek: (position: number) => Promise<void>;
    setVolume: (volume: number) => Promise<void>;
    setRate: (rate: number) => Promise<void>;
};
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
export declare function useRepeatShuffle(player: AudioPlayer): {
    repeatMode: RepeatMode;
    shuffle: boolean;
    setRepeatMode: (mode: RepeatMode) => Promise<void>;
    cycleRepeatMode: () => Promise<void>;
    setShuffle: (enabled?: boolean) => Promise<void>;
};
/**
 * Minimal hook that only returns the current `PlaybackState` string.
 * Useful when you only need to drive button icons (play/pause/loading).
 *
 * @example
 * const playbackState = usePlaybackState(player);
 * const isPlaying = playbackState === "playing";
 */
export declare function usePlaybackState(player: AudioPlayer): PlaybackState;
/**
 * Returns only the currently playing `Track` (or `null`).
 * Re-renders only on track changes, not on progress ticks.
 *
 * @example
 * const track = useNowPlaying(player);
 * return <Text>{track?.title ?? "Nothing playing"}</Text>;
 */
export declare function useNowPlaying(player: AudioPlayer): Track | null;
//# sourceMappingURL=index.d.ts.map