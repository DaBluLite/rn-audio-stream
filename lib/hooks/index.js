"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAudioPlayer = useAudioPlayer;
exports.useProgress = useProgress;
exports.useQueue = useQueue;
exports.usePlaybackControls = usePlaybackControls;
exports.useRepeatShuffle = useRepeatShuffle;
exports.usePlaybackState = usePlaybackState;
exports.useNowPlaying = useNowPlaying;
const react_1 = require("react");
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
function useAudioPlayer(player) {
    const [state, setState] = (0, react_1.useState)(() => player.state);
    (0, react_1.useEffect)(() => {
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
function useProgress(player) {
    const [progress, setProgress] = (0, react_1.useState)({
        position: player.state.position,
        duration: player.state.duration,
        buffered: player.state.buffered,
    });
    (0, react_1.useEffect)(() => {
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
function useQueue(player) {
    const [queue, setQueue] = (0, react_1.useState)(player.state.queue);
    const [currentIndex, setCurrentIndex] = (0, react_1.useState)(player.state.currentIndex);
    (0, react_1.useEffect)(() => {
        const off = player.on("stateChange", (s) => {
            setQueue(s.queue);
            setCurrentIndex(s.currentIndex);
        });
        return off;
    }, [player]);
    const addToQueue = (0, react_1.useCallback)((t) => player.addToQueue(t), [player]);
    const playNext = (0, react_1.useCallback)((t) => player.playNext(t), [player]);
    const removeFromQueue = (0, react_1.useCallback)((id) => player.removeFromQueue(id), [player]);
    const skipToIndex = (0, react_1.useCallback)((i) => player.skipToIndex(i), [player]);
    const clearQueue = (0, react_1.useCallback)(() => player.clearQueue(), [player]);
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
function usePlaybackControls(player) {
    return {
        play: (0, react_1.useCallback)(() => player.play(), [player]),
        pause: (0, react_1.useCallback)(() => player.pause(), [player]),
        stop: (0, react_1.useCallback)(() => player.stop(), [player]),
        togglePlayPause: (0, react_1.useCallback)(() => player.togglePlayPause(), [player]),
        next: (0, react_1.useCallback)(() => player.next(), [player]),
        previous: (0, react_1.useCallback)(() => player.previous(), [player]),
        seek: (0, react_1.useCallback)((p) => player.seek(p), [player]),
        setVolume: (0, react_1.useCallback)((v) => player.setVolume(v), [player]),
        setRate: (0, react_1.useCallback)((r) => player.setRate(r), [player]),
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
function useRepeatShuffle(player) {
    const [repeatMode, setRepeatMode_] = (0, react_1.useState)(player.state.repeatMode);
    const [shuffle, setShuffle_] = (0, react_1.useState)(player.state.shuffle);
    (0, react_1.useEffect)(() => {
        const off = player.on("stateChange", (s) => {
            setRepeatMode_(s.repeatMode);
            setShuffle_(s.shuffle);
        });
        return off;
    }, [player]);
    const setRepeatMode = (0, react_1.useCallback)((m) => player.setRepeatMode(m), [player]);
    const cycleRepeatMode = (0, react_1.useCallback)(() => player.cycleRepeatMode(), [player]);
    const setShuffle = (0, react_1.useCallback)((e) => player.setShuffle(e), [player]);
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
function usePlaybackState(player) {
    const [ps, setPs] = (0, react_1.useState)(player.state.playbackState);
    (0, react_1.useEffect)(() => {
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
function useNowPlaying(player) {
    const [track, setTrack] = (0, react_1.useState)(player.state.currentTrack);
    (0, react_1.useEffect)(() => {
        const off = player.on("trackChange", ({ current }) => setTrack(current));
        return off;
    }, [player]);
    return track;
}
//# sourceMappingURL=index.js.map