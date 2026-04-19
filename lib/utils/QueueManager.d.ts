/**
 * @module rn-audio-stream/utils/QueueManager
 *
 * Manages the ordered track queue and shuffle state.
 *
 * The `QueueManager` holds two arrays:
 *  - `_original`  — tracks in the order the caller supplied them.
 *  - `_shuffled`  — a Fisher-Yates shuffled copy, regenerated on demand.
 *
 * The "active" array is `_shuffled` when shuffle is on, `_original` otherwise.
 * This lets us toggle shuffle without losing the original order.
 */
import type { Track } from "../types";
export declare class QueueManager {
    private _original;
    private _shuffled;
    private _shuffle;
    private _currentIndex;
    constructor(shuffle?: boolean);
    /** The currently active array (shuffled or original). */
    private get _active();
    /**
     * Fisher-Yates in-place shuffle.
     * Always keeps the current track at index 0 after shuffling.
     */
    private _rebuildShuffle;
    /** All tracks in display order (respects shuffle). */
    get tracks(): Track[];
    /** The track at the current index, or `null` if the queue is empty. */
    get current(): Track | null;
    /** Current index within the active queue. `-1` if empty. */
    get currentIndex(): number;
    /** `true` when shuffle mode is active. */
    get shuffle(): boolean;
    /**
     * Replace the entire queue.
     *
     * @param tracks  New list of tracks.
     * @param startIndex  Index to treat as current immediately. Default `0`.
     */
    setQueue(tracks: Track[], startIndex?: number): void;
    /**
     * Append tracks to the end of the queue without changing the current track.
     */
    add(tracks: Track[]): void;
    /**
     * Insert a track immediately after the current position ("play next").
     */
    insertNext(track: Track): void;
    /**
     * Remove a track by its `id`.
     * If the removed track is the current one, the player should call
     * `next()` or `previous()` after this.
     *
     * @returns `true` if the track was found and removed.
     */
    remove(id: string): boolean;
    /**
     * Move forward one position.
     *
     * @param repeat  Current repeat mode; controls wrap-around behaviour.
     * @returns The new track, or `null` if there is nowhere to go.
     */
    next(repeat: "off" | "track" | "queue"): Track | null;
    /**
     * Move backward one position.
     * If `position > 3` the caller should typically seek to 0 instead of
     * actually skipping; this method doesn't enforce that — it just moves
     * the index.
     *
     * @returns The new track, or `null` if already at the start with no wrap.
     */
    previous(repeat: "off" | "track" | "queue"): Track | null;
    /**
     * Jump directly to a specific index in the active queue.
     *
     * @throws RangeError if `index` is out of bounds.
     */
    jumpTo(index: number): Track;
    /**
     * Toggle or explicitly set shuffle mode.
     *
     * - Turning shuffle **on**: rebuilds the shuffled array, keeping the
     *   current track at position 0.
     * - Turning shuffle **off**: restores the original order and re-syncs
     *   `_currentIndex` to point to the same track.
     *
     * @param enabled  If omitted, toggles the current value.
     */
    setShuffle(enabled?: boolean): void;
    /**
     * Peek at the next track without advancing the index.
     * Returns `null` if there is no next track and repeat is `"off"`.
     */
    peek(repeat: "off" | "track" | "queue"): Track | null;
    /** Clear the entire queue and reset to idle. */
    clear(): void;
}
//# sourceMappingURL=QueueManager.d.ts.map