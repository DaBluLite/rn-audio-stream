"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueManager = void 0;
class QueueManager {
    constructor(shuffle = false) {
        this._original = [];
        this._shuffled = [];
        this._currentIndex = -1;
        this._shuffle = shuffle;
    }
    // ─── Internal helpers ────────────────────────────────────────────────────
    /** The currently active array (shuffled or original). */
    get _active() {
        return this._shuffle ? this._shuffled : this._original;
    }
    /**
     * Fisher-Yates in-place shuffle.
     * Always keeps the current track at index 0 after shuffling.
     */
    _rebuildShuffle() {
        const pool = [...this._original];
        // Pull out the current track so it stays first.
        const current = this._currentIndex >= 0
            ? this._original[this._currentIndex]
            : null;
        if (current) {
            const idx = pool.findIndex((t) => t.id === current.id);
            if (idx !== -1)
                pool.splice(idx, 1);
        }
        // Fisher-Yates
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        this._shuffled = current ? [current, ...pool] : pool;
        // Keep _currentIndex consistent — it now points to index 0 (current track).
        if (current) {
            this._currentIndex = 0;
        }
    }
    // ─── Public API ──────────────────────────────────────────────────────────
    /** All tracks in display order (respects shuffle). */
    get tracks() {
        return [...this._active];
    }
    /** The track at the current index, or `null` if the queue is empty. */
    get current() {
        return this._active[this._currentIndex] ?? null;
    }
    /** Current index within the active queue. `-1` if empty. */
    get currentIndex() {
        return this._currentIndex;
    }
    /** `true` when shuffle mode is active. */
    get shuffle() {
        return this._shuffle;
    }
    /**
     * Replace the entire queue.
     *
     * @param tracks  New list of tracks.
     * @param startIndex  Index to treat as current immediately. Default `0`.
     */
    setQueue(tracks, startIndex = 0) {
        this._original = [...tracks];
        this._currentIndex = tracks.length > 0 ? Math.max(0, Math.min(startIndex, tracks.length - 1)) : -1;
        if (this._shuffle)
            this._rebuildShuffle();
    }
    /**
     * Append tracks to the end of the queue without changing the current track.
     */
    add(tracks) {
        this._original.push(...tracks);
        if (this._shuffle) {
            // Append to shuffled array in random positions after current.
            const insertions = [...tracks];
            for (let i = insertions.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [insertions[i], insertions[j]] = [insertions[j], insertions[i]];
            }
            this._shuffled.push(...insertions);
        }
        // If queue was empty, jump to first track.
        if (this._currentIndex === -1 && this._active.length > 0) {
            this._currentIndex = 0;
        }
    }
    /**
     * Insert a track immediately after the current position ("play next").
     */
    insertNext(track) {
        const insertAt = this._currentIndex + 1;
        // Insert into original (find real position).
        if (!this._shuffle) {
            this._original.splice(insertAt, 0, track);
        }
        else {
            // In shuffle mode, find where "next" is in the original and insert there too.
            const nextShuffled = this._shuffled[insertAt];
            const origIdx = nextShuffled
                ? this._original.findIndex((t) => t.id === nextShuffled.id)
                : this._original.length;
            this._original.splice(origIdx, 0, track);
            this._shuffled.splice(insertAt, 0, track);
        }
    }
    /**
     * Remove a track by its `id`.
     * If the removed track is the current one, the player should call
     * `next()` or `previous()` after this.
     *
     * @returns `true` if the track was found and removed.
     */
    remove(id) {
        const origIdx = this._original.findIndex((t) => t.id === id);
        if (origIdx === -1)
            return false;
        this._original.splice(origIdx, 1);
        if (this._shuffle) {
            const shuffIdx = this._shuffled.findIndex((t) => t.id === id);
            if (shuffIdx !== -1) {
                this._shuffled.splice(shuffIdx, 1);
                if (shuffIdx < this._currentIndex)
                    this._currentIndex--;
            }
        }
        else {
            if (origIdx < this._currentIndex)
                this._currentIndex--;
        }
        if (this._currentIndex >= this._active.length) {
            this._currentIndex = Math.max(0, this._active.length - 1);
        }
        if (this._active.length === 0)
            this._currentIndex = -1;
        return true;
    }
    /**
     * Move forward one position.
     *
     * @param repeat  Current repeat mode; controls wrap-around behaviour.
     * @returns The new track, or `null` if there is nowhere to go.
     */
    next(repeat) {
        if (this._active.length === 0)
            return null;
        if (repeat === "track")
            return this.current; // stay put
        const nextIndex = this._currentIndex + 1;
        if (nextIndex < this._active.length) {
            this._currentIndex = nextIndex;
        }
        else if (repeat === "queue") {
            // Rebuild shuffle so we get a fresh order on every loop.
            if (this._shuffle)
                this._rebuildShuffle();
            this._currentIndex = 0;
        }
        else {
            // repeat === "off", past the end.
            return null;
        }
        return this.current;
    }
    /**
     * Move backward one position.
     * If `position > 3` the caller should typically seek to 0 instead of
     * actually skipping; this method doesn't enforce that — it just moves
     * the index.
     *
     * @returns The new track, or `null` if already at the start with no wrap.
     */
    previous(repeat) {
        if (this._active.length === 0)
            return null;
        if (repeat === "track")
            return this.current;
        const prevIndex = this._currentIndex - 1;
        if (prevIndex >= 0) {
            this._currentIndex = prevIndex;
        }
        else if (repeat === "queue") {
            this._currentIndex = this._active.length - 1;
        }
        else {
            // Already at start, no wrap.
            this._currentIndex = 0;
            return this.current;
        }
        return this.current;
    }
    /**
     * Jump directly to a specific index in the active queue.
     *
     * @throws RangeError if `index` is out of bounds.
     */
    jumpTo(index) {
        if (index < 0 || index >= this._active.length) {
            throw new RangeError(`QueueManager.jumpTo: index ${index} out of range (queue length ${this._active.length})`);
        }
        this._currentIndex = index;
        return this.current;
    }
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
    setShuffle(enabled) {
        const next = enabled ?? !this._shuffle;
        if (next === this._shuffle)
            return;
        const currentId = this.current?.id;
        this._shuffle = next;
        if (next) {
            this._rebuildShuffle();
        }
        else {
            // Restore original order; re-find the current track.
            if (currentId) {
                const idx = this._original.findIndex((t) => t.id === currentId);
                this._currentIndex = idx === -1 ? 0 : idx;
            }
        }
    }
    /**
     * Peek at the next track without advancing the index.
     * Returns `null` if there is no next track and repeat is `"off"`.
     */
    peek(repeat) {
        if (this._active.length === 0)
            return null;
        if (repeat === "track")
            return this.current;
        const nextIndex = this._currentIndex + 1;
        if (nextIndex < this._active.length)
            return this._active[nextIndex];
        if (repeat === "queue")
            return this._active[0];
        return null;
    }
    /** Clear the entire queue and reset to idle. */
    clear() {
        this._original = [];
        this._shuffled = [];
        this._currentIndex = -1;
    }
}
exports.QueueManager = QueueManager;
//# sourceMappingURL=QueueManager.js.map