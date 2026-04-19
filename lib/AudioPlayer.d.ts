/**
 * @module rn-audio-stream/AudioPlayer
 *
 * Core audio player class built on top of `react-native-track-player` (RNTP).
 *
 * ## Why wrap RNTP?
 * RNTP is the de-facto standard for production audio on React Native because
 * it handles the hard platform bits: AVAudioSession on iOS, ExoPlayer on
 * Android, lock-screen / notification media controls, background playback,
 * and CarPlay / Android Auto.  This wrapper adds:
 *  - A typed, event-driven `PlayerState` observable.
 *  - First-class gapless playback via RNTP's built-in pre-buffering queue.
 *  - Shuffle with a proper Fisher-Yates `QueueManager`.
 *  - Repeat modes (off / track / queue) with auto-advance logic.
 *  - Retry on stream failure with configurable back-off.
 *  - Live-stream detection (disables seek, progress, gapless).
 *
 * ## Installation
 * ```bash
 * # 1. Install this package
 * npm install rn-audio-stream
 *
 * # 2. Install the native peer dependency
 * npm install react-native-track-player
 *
 * # 3. iOS — link the native module
 * cd ios && pod install
 *
 * # 4. Android — no extra steps; auto-linked.
 * ```
 *
 * ## Minimal setup
 * ```tsx
 * // App.tsx  (or wherever your RN app boots)
 * import TrackPlayer from "react-native-track-player";
 * import { AudioPlayer } from "rn-audio-stream";
 *
 * // Register the RNTP playback service once, before any player is created.
 * TrackPlayer.registerPlaybackService(() => require("./playbackService"));
 *
 * const player = new AudioPlayer({ gapless: true });
 * await player.init();
 * await player.setQueue(myTracks);
 * await player.play();
 * ```
 */
import type { Track, PlayerState, RepeatMode, PlayerEvents, AudioPlayerOptions } from "./types";
type EventListener<T> = (payload: T) => void;
type UnsubscribeFn = () => void;
/**
 * The main audio player controller.
 *
 * Lifecycle:
 * ```
 * new AudioPlayer(options)
 *   → await player.init()          // sets up RNTP, subscribes to events
 *   → await player.setQueue(...)   // loads tracks
 *   → await player.play()          // starts playback
 *   → ...
 *   → await player.destroy()       // cleanup
 * ```
 *
 * ### Event system
 * ```ts
 * const off = player.on("progress", ({ position, duration }) => {
 *   console.log(`${position} / ${duration}s`);
 * });
 * // Later:
 * off(); // unsubscribe
 * ```
 */
export declare class AudioPlayer {
    private _opts;
    private _queue;
    private _state;
    private _listeners;
    private _rntpSubscriptions;
    private _retryAttempts;
    private _preloadedNextId;
    private _initialized;
    private _progressInterval;
    constructor(options?: AudioPlayerOptions);
    /**
     * **Must be called once before any other method.**
     *
     * Sets up the RNTP service with media-control capabilities and subscribes
     * to native playback events.
     *
     * @example
     * const player = new AudioPlayer({ gapless: true });
     * await player.init();
     */
    init(): Promise<void>;
    /**
     * Replace the queue with a new list of tracks and optionally start
     * playing immediately.
     *
     * @param tracks      Array of tracks to queue.
     * @param startIndex  Index of the first track to load. Default `0`.
     * @param autoPlay    Start playing immediately. Default `false`.
     *
     * @example
     * await player.setQueue(navidromeAlbumTracks, 0, true);
     */
    setQueue(tracks: Track[], startIndex?: number, autoPlay?: boolean): Promise<void>;
    /**
     * Append tracks to the end of the current queue.
     *
     * @example
     * await player.addToQueue(moreTracks);
     */
    addToQueue(tracks: Track[]): Promise<void>;
    /**
     * Insert a single track immediately after the currently playing one
     * ("play next" / "add to up-next").
     *
     * @example
     * await player.playNext(urgentTrack);
     */
    playNext(track: Track): Promise<void>;
    /**
     * Remove a track from the queue by its `id`.
     * If the track is currently playing, advances to the next one.
     */
    removeFromQueue(id: string): Promise<void>;
    /** Clear the entire queue and stop playback. */
    clearQueue(): Promise<void>;
    /**
     * Start or resume playback.
     *
     * If the queue is non-empty but nothing is loaded, loads the current
     * track first.
     */
    play(): Promise<void>;
    /** Pause playback. Position is preserved. */
    pause(): Promise<void>;
    /** Toggle between play and pause. */
    togglePlayPause(): Promise<void>;
    /** Stop playback and reset position to `0`. */
    stop(): Promise<void>;
    /**
     * Skip to the next track in the queue.
     *
     * Respects the current repeat mode:
     * - `"track"` — seeks to `0` on the same track instead.
     * - `"queue"` — wraps around to the beginning.
     * - `"off"`   — stops at the last track.
     */
    next(): Promise<void>;
    /**
     * Skip to the previous track.
     *
     * If more than 3 seconds into the current track, seeks to `0` first
     * (standard music-player behaviour). A second call within 1 second
     * will actually go to the previous track.
     */
    previous(): Promise<void>;
    /**
     * Jump to a specific index in the queue.
     *
     * @param index  Zero-based index into the current (possibly shuffled) queue.
     * @throws `RangeError` if the index is out of bounds.
     */
    skipToIndex(index: number): Promise<void>;
    /**
     * Seek to an absolute position in the current track.
     *
     * @param position  Seconds from the start. Clamped to `[0, duration]`.
     *
     * ⚠️  Has no effect when `currentTrack.isLive === true`.
     */
    seek(position: number): Promise<void>;
    /**
     * Set the playback volume.
     *
     * @param volume  Float in `[0.0, 1.0]`. Values outside are clamped.
     */
    setVolume(volume: number): Promise<void>;
    /**
     * Set the playback rate (speed).
     *
     * @param rate  Float in `[0.25, 4.0]`. `1.0` = normal speed.
     */
    setRate(rate: number): Promise<void>;
    /**
     * Change the repeat mode.
     *
     * | Mode      | Behaviour                               |
     * |-----------|-----------------------------------------|
     * | `"off"`   | Stop after the last track in the queue. |
     * | `"track"` | Loop the current track indefinitely.   |
     * | `"queue"` | Loop the whole queue.                  |
     *
     * @example
     * player.setRepeatMode("queue");
     */
    setRepeatMode(mode: RepeatMode): Promise<void>;
    /**
     * Cycle through repeat modes in order: off → track → queue → off.
     * Convenient for a single "repeat" button.
     */
    cycleRepeatMode(): Promise<void>;
    /**
     * Enable or disable shuffle.
     *
     * When toggled on, the queue is immediately re-ordered (Fisher-Yates)
     * with the currently playing track kept at position 0 so playback
     * continues uninterrupted.
     *
     * @param enabled  If omitted, the current value is toggled.
     *
     * @example
     * await player.setShuffle(true);
     */
    setShuffle(enabled?: boolean): Promise<void>;
    /** Read-only snapshot of the current player state. */
    get state(): Readonly<PlayerState>;
    /**
     * Subscribe to a player event.
     *
     * @returns An unsubscribe function. Call it to remove the listener.
     *
     * @example
     * const off = player.on("trackChange", ({ current }) => {
     *   console.log("Now playing:", current.title);
     * });
     * // Cleanup:
     * off();
     */
    on<K extends keyof PlayerEvents>(event: K, listener: EventListener<PlayerEvents[K]>): UnsubscribeFn;
    /**
     * Subscribe to an event but automatically unsubscribe after the first
     * time it fires.
     */
    once<K extends keyof PlayerEvents>(event: K, listener: EventListener<PlayerEvents[K]>): UnsubscribeFn;
    /**
     * Tear down the player and release all native resources.
     * The instance should not be used after calling this.
     */
    destroy(): Promise<void>;
    private _subscribeToRNTPEvents;
    private _handleRemote;
    private _startProgressPolling;
    private _stopProgressPolling;
    /**
     * Gapless works by relying on RNTP's internal queue: when a track is added
     * to the RNTP queue, ExoPlayer / AVPlayer will pre-buffer it while the
     * current track is still playing and cross-fade at the exact sample boundary.
     *
     * `_maybePreloadNext` ensures the *next* track is already in the RNTP
     * queue before it's needed, without duplicating it.
     */
    private _maybePreloadNext;
    private _scheduleGaplessPreload;
    /**
     * Rebuild the entire RNTP queue from our `QueueManager`.
     * Called on `setQueue` or when shuffle is toggled.
     */
    private _syncRNTPQueue;
    private _loadCurrent;
    private _updateState;
    private _emitStateChange;
    private _emit;
    private _assertInitialized;
}
/**
 * Convenience factory — creates, initialises and returns a player in one call.
 *
 * @example
 * const player = await createAudioPlayer({ gapless: true, shuffle: false });
 * await player.setQueue(tracks, 0, true);
 */
export declare function createAudioPlayer(options?: AudioPlayerOptions): Promise<AudioPlayer>;
export {};
//# sourceMappingURL=AudioPlayer.d.ts.map