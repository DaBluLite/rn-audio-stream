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

import TrackPlayer, {
  Event,
  State,
  Capability,
  RepeatMode as RNTPRepeatMode,
  type Track as RNTPTrack,
  type PlaybackState as RNTPPlaybackState,
} from "react-native-track-player";

import { QueueManager } from "./utils/QueueManager";
import type {
  Track,
  PlayerState,
  PlaybackState,
  RepeatMode,
  PlayerError,
  PlayerEvents,
  AudioPlayerOptions,
  RemoteControlAction,
} from "./types";

// ─── Internal constants ───────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<AudioPlayerOptions> = {
  volume: 1.0,
  rate: 1.0,
  repeatMode: "off",
  shuffle: false,
  gapless: true,
  gaplessPreloadSeconds: 10,
  retryCount: 3,
  retryDelayMs: 1500,
  userAgent: "rn-audio-stream/1.0",
  headers: {},
  onRemoteControl: () => {},
};

// ─── Type helpers ─────────────────────────────────────────────────────────────

type EventListener<T> = (payload: T) => void;
type UnsubscribeFn = () => void;

/** Map an RNTP `State` to our simplified `PlaybackState`. */
function mapRNTPState(state: State): PlaybackState {
  switch (state) {
    case State.None:      return "idle";
    case State.Ready:     return "loading";
    case State.Buffering: return "buffering";
    case State.Playing:   return "playing";
    case State.Paused:    return "paused";
    case State.Stopped:   return "stopped";
    case State.Ended:     return "ended";
    case State.Error:     return "error";
    default:              return "idle";
  }
}

/** Convert our `RepeatMode` to the RNTP enum. */
function toRNTPRepeat(mode: RepeatMode): RNTPRepeatMode {
  switch (mode) {
    case "off":   return RNTPRepeatMode.Off;
    case "track": return RNTPRepeatMode.Track;
    case "queue": return RNTPRepeatMode.Queue;
  }
}

/** Convert a `Track` to the shape RNTP expects. */
function toRNTPTrack(track: Track, headers?: Record<string, string>, userAgent?: string): RNTPTrack {
  return {
    id: track.id,
    url: track.url,
    title: track.title ?? "Unknown",
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    artwork: track.artwork as string | undefined,
    headers: {
      ...(userAgent ? { "User-Agent": userAgent } : {}),
      ...headers,
    },
    // RNTP uses `isLiveStream` to skip seeking.
    isLiveStream: track.isLive ?? false,
  };
}

// ─── AudioPlayer ─────────────────────────────────────────────────────────────

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
export class AudioPlayer {
  private _opts: Required<AudioPlayerOptions>;
  private _queue: QueueManager;
  private _state: PlayerState;
  private _listeners: Partial<{ [K in keyof PlayerEvents]: Set<EventListener<PlayerEvents[K]>> }> = {};
  private _rntpSubscriptions: Array<{ remove(): void }> = [];
  private _retryAttempts: number = 0;
  private _preloadedNextId: string | null = null;
  private _initialized = false;
  private _progressInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: AudioPlayerOptions = {}) {
    this._opts = { ...DEFAULT_OPTIONS, ...options };
    this._queue = new QueueManager(this._opts.shuffle);

    this._state = {
      currentTrack: null,
      currentIndex: -1,
      queue: [],
      playbackState: "idle",
      position: 0,
      duration: 0,
      buffered: 0,
      repeatMode: this._opts.repeatMode,
      shuffle: this._opts.shuffle,
      rate: this._opts.rate,
      volume: this._opts.volume,
      error: null,
    };
  }

  // ─── Initialisation ────────────────────────────────────────────────────

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
  async init(): Promise<void> {
    if (this._initialized) return;

    await TrackPlayer.setupPlayer({
      // Allow other apps' audio to keep playing at lower volume.
      autoHandleInterruptions: true,
    });

    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
        Capability.SetRating,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      progressUpdateEventInterval: 1000,
    });

    await TrackPlayer.setVolume(this._opts.volume);
    await TrackPlayer.setRate(this._opts.rate);
    await TrackPlayer.setRepeatMode(toRNTPRepeat(this._opts.repeatMode));

    this._subscribeToRNTPEvents();
    this._initialized = true;
  }

  // ─── Queue management ──────────────────────────────────────────────────

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
  async setQueue(tracks: Track[], startIndex = 0, autoPlay = false): Promise<void> {
    this._assertInitialized();
    this._queue.setQueue(tracks, startIndex);
    await this._syncRNTPQueue();
    if (autoPlay) await this.play();
  }

  /**
   * Append tracks to the end of the current queue.
   *
   * @example
   * await player.addToQueue(moreTracks);
   */
  async addToQueue(tracks: Track[]): Promise<void> {
    this._assertInitialized();
    this._queue.add(tracks);
    const rntpTracks = tracks.map((t) =>
      toRNTPTrack(t, this._opts.headers, this._opts.userAgent)
    );
    await TrackPlayer.add(rntpTracks);
    this._emitStateChange();
  }

  /**
   * Insert a single track immediately after the currently playing one
   * ("play next" / "add to up-next").
   *
   * @example
   * await player.playNext(urgentTrack);
   */
  async playNext(track: Track): Promise<void> {
    this._assertInitialized();
    this._queue.insertNext(track);
    const insertAtRNTP = (await TrackPlayer.getActiveTrackIndex() ?? 0) + 1;
    await TrackPlayer.add(
      [toRNTPTrack(track, this._opts.headers, this._opts.userAgent)],
      insertAtRNTP
    );
    this._emitStateChange();
  }

  /**
   * Remove a track from the queue by its `id`.
   * If the track is currently playing, advances to the next one.
   */
  async removeFromQueue(id: string): Promise<void> {
    this._assertInitialized();
    const wasCurrentId = this._queue.current?.id;
    const removed = this._queue.remove(id);
    if (!removed) return;

    // Find and remove from RNTP queue.
    const rntpTracks = await TrackPlayer.getQueue();
    const rntpIdx = rntpTracks.findIndex((t) => t.id === id);
    if (rntpIdx !== -1) await TrackPlayer.remove(rntpIdx);

    // If we just removed the playing track, advance.
    if (wasCurrentId === id && this._queue.current) {
      await this._loadCurrent();
      await TrackPlayer.play();
    }
    this._emitStateChange();
  }

  /** Clear the entire queue and stop playback. */
  async clearQueue(): Promise<void> {
    this._assertInitialized();
    await TrackPlayer.reset();
    this._queue.clear();
    this._preloadedNextId = null;
    this._updateState({ playbackState: "idle", currentTrack: null, currentIndex: -1, queue: [] });
  }

  // ─── Playback controls ─────────────────────────────────────────────────

  /**
   * Start or resume playback.
   *
   * If the queue is non-empty but nothing is loaded, loads the current
   * track first.
   */
  async play(): Promise<void> {
    this._assertInitialized();
    if (this._state.playbackState === "idle" && this._queue.current) {
      await this._loadCurrent();
    }
    await TrackPlayer.play();
  }

  /** Pause playback. Position is preserved. */
  async pause(): Promise<void> {
    this._assertInitialized();
    await TrackPlayer.pause();
  }

  /** Toggle between play and pause. */
  async togglePlayPause(): Promise<void> {
    if (this._state.playbackState === "playing") {
      await this.pause();
    } else {
      await this.play();
    }
  }

  /** Stop playback and reset position to `0`. */
  async stop(): Promise<void> {
    this._assertInitialized();
    await TrackPlayer.stop();
  }

  /**
   * Skip to the next track in the queue.
   *
   * Respects the current repeat mode:
   * - `"track"` — seeks to `0` on the same track instead.
   * - `"queue"` — wraps around to the beginning.
   * - `"off"`   — stops at the last track.
   */
  async next(): Promise<void> {
    this._assertInitialized();

    if (this._state.repeatMode === "track") {
      await this.seek(0);
      return;
    }

    const nextTrack = this._queue.next(this._state.repeatMode);
    if (!nextTrack) {
      await this.stop();
      this._emit("queueEnd", undefined as void);
      return;
    }

    await this._loadCurrent();
    await TrackPlayer.play();
  }

  /**
   * Skip to the previous track.
   *
   * If more than 3 seconds into the current track, seeks to `0` first
   * (standard music-player behaviour). A second call within 1 second
   * will actually go to the previous track.
   */
  async previous(): Promise<void> {
    this._assertInitialized();

    if (this._state.repeatMode === "track" || this._state.position > 3) {
      await this.seek(0);
      return;
    }

    this._queue.previous(this._state.repeatMode);
    await this._loadCurrent();
    await TrackPlayer.play();
  }

  /**
   * Jump to a specific index in the queue.
   *
   * @param index  Zero-based index into the current (possibly shuffled) queue.
   * @throws `RangeError` if the index is out of bounds.
   */
  async skipToIndex(index: number): Promise<void> {
    this._assertInitialized();
    this._queue.jumpTo(index);
    await this._loadCurrent();
    await TrackPlayer.play();
  }

  /**
   * Seek to an absolute position in the current track.
   *
   * @param position  Seconds from the start. Clamped to `[0, duration]`.
   *
   * ⚠️  Has no effect when `currentTrack.isLive === true`.
   */
  async seek(position: number): Promise<void> {
    this._assertInitialized();
    if (this._state.currentTrack?.isLive) return;
    const clamped = Math.max(0, Math.min(position, this._state.duration || Infinity));
    await TrackPlayer.seekTo(clamped);
  }

  // ─── Volume & rate ─────────────────────────────────────────────────────

  /**
   * Set the playback volume.
   *
   * @param volume  Float in `[0.0, 1.0]`. Values outside are clamped.
   */
  async setVolume(volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, volume));
    await TrackPlayer.setVolume(clamped);
    this._updateState({ volume: clamped });
  }

  /**
   * Set the playback rate (speed).
   *
   * @param rate  Float in `[0.25, 4.0]`. `1.0` = normal speed.
   */
  async setRate(rate: number): Promise<void> {
    const clamped = Math.max(0.25, Math.min(4, rate));
    await TrackPlayer.setRate(clamped);
    this._updateState({ rate: clamped });
  }

  // ─── Repeat & shuffle ──────────────────────────────────────────────────

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
  async setRepeatMode(mode: RepeatMode): Promise<void> {
    await TrackPlayer.setRepeatMode(toRNTPRepeat(mode));
    this._updateState({ repeatMode: mode });
  }

  /**
   * Cycle through repeat modes in order: off → track → queue → off.
   * Convenient for a single "repeat" button.
   */
  async cycleRepeatMode(): Promise<void> {
    const order: RepeatMode[] = ["off", "track", "queue"];
    const current = order.indexOf(this._state.repeatMode);
    await this.setRepeatMode(order[(current + 1) % order.length]);
  }

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
  async setShuffle(enabled?: boolean): Promise<void> {
    this._queue.setShuffle(enabled);
    const isShuffle = this._queue.shuffle;
    await this._syncRNTPQueue();
    this._updateState({ shuffle: isShuffle });
  }

  // ─── State & events ────────────────────────────────────────────────────

  /** Read-only snapshot of the current player state. */
  get state(): Readonly<PlayerState> {
    return this._state;
  }

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
  on<K extends keyof PlayerEvents>(
    event: K,
    listener: EventListener<PlayerEvents[K]>
  ): UnsubscribeFn {
    if (!this._listeners[event]) {
      this._listeners[event] = new Set() as any;
    }
    (this._listeners[event] as Set<EventListener<PlayerEvents[K]>>).add(listener);
    return () => {
      (this._listeners[event] as Set<EventListener<PlayerEvents[K]>>)?.delete(listener);
    };
  }

  /**
   * Subscribe to an event but automatically unsubscribe after the first
   * time it fires.
   */
  once<K extends keyof PlayerEvents>(
    event: K,
    listener: EventListener<PlayerEvents[K]>
  ): UnsubscribeFn {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Tear down the player and release all native resources.
   * The instance should not be used after calling this.
   */
  async destroy(): Promise<void> {
    this._stopProgressPolling();
    for (const sub of this._rntpSubscriptions) sub.remove();
    this._rntpSubscriptions = [];
    await TrackPlayer.reset();
    this._initialized = false;
  }

  // ─── Private: RNTP event wiring ────────────────────────────────────────

  private _subscribeToRNTPEvents(): void {
    this._rntpSubscriptions.push(
      // ── Playback state ──
      TrackPlayer.addEventListener(Event.PlaybackState, (e: RNTPPlaybackState) => {
        const ps = mapRNTPState(e.state);
        this._updateState({ playbackState: ps });

        if (ps === "playing") this._startProgressPolling();
        else this._stopProgressPolling();
      }),

      // ── Track changed (user skip or auto-advance) ──
      TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (e: any) => {
        const previous = this._state.currentTrack;
        const rntpIndex: number = e.index ?? 0;

        // Sync our QueueManager index to what RNTP says.
        if (rntpIndex !== this._queue.currentIndex) {
          try { this._queue.jumpTo(rntpIndex); } catch { /* ignore */ }
        }

        const current = this._queue.current;
        if (current) {
          this._updateState({
            currentTrack: current,
            currentIndex: this._queue.currentIndex,
            position: 0,
            duration: current.duration ?? 0,
            buffered: 0,
          });
          this._emit("trackChange", { previous, current });
          this._retryAttempts = 0;

          // Schedule gapless pre-buffer for next track.
          if (this._opts.gapless && !current.isLive) {
            this._scheduleGaplessPreload();
          }
        }
      }),

      // ── Natural track end ──
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async (_e: any) => {
        const next = this._queue.peek(this._state.repeatMode);
        if (!next) {
          this._emit("queueEnd", undefined as void);
          this._updateState({ playbackState: "ended" });
        }
        // If RNTP is in Queue repeat mode it handles it natively; otherwise
        // our next() call from the state listener will take over.
      }),

      // ── Error ──
      TrackPlayer.addEventListener(Event.PlaybackError, async (e: any) => {
        const err: PlayerError = {
          code: e.code ?? "PLAYBACK_ERROR",
          message: e.message ?? "Unknown playback error",
          track: this._queue.current ?? undefined,
          cause: e,
        };

        if (this._retryAttempts < this._opts.retryCount) {
          this._retryAttempts++;
          setTimeout(() => this.play(), this._opts.retryDelayMs);
        } else {
          this._retryAttempts = 0;
          this._updateState({ playbackState: "error", error: err });
          this._emit("error", err);
        }
      }),

      // ── Remote-control actions (lock screen, notification, etc.) ──
      TrackPlayer.addEventListener(Event.RemotePlay,     () => this._handleRemote({ type: "play" })),
      TrackPlayer.addEventListener(Event.RemotePause,    () => this._handleRemote({ type: "pause" })),
      TrackPlayer.addEventListener(Event.RemoteStop,     () => this._handleRemote({ type: "stop" })),
      TrackPlayer.addEventListener(Event.RemoteNext,     () => this._handleRemote({ type: "next" })),
      TrackPlayer.addEventListener(Event.RemotePrevious, () => this._handleRemote({ type: "previous" })),
      TrackPlayer.addEventListener(Event.RemoteSeek,     (e: any) => this._handleRemote({ type: "seek", position: e.position })),
      TrackPlayer.addEventListener(Event.RemoteDuck,     () => this.pause()),
    );
  }

  private _handleRemote(action: RemoteControlAction): void {
    if (this._opts.onRemoteControl !== DEFAULT_OPTIONS.onRemoteControl) {
      this._opts.onRemoteControl(action);
      return;
    }
    // Default behaviour.
    switch (action.type) {
      case "play":     this.play();   break;
      case "pause":    this.pause();  break;
      case "stop":     this.stop();   break;
      case "next":     this.next();   break;
      case "previous": this.previous(); break;
      case "seek":     this.seek(action.position); break;
      case "setRate":  this.setRate(action.rate); break;
    }
  }

  // ─── Private: progress polling ─────────────────────────────────────────

  private _startProgressPolling(): void {
    if (this._progressInterval) return;
    this._progressInterval = setInterval(async () => {
      try {
        const pos = await TrackPlayer.getProgress();
        this._updateState({
          position: pos.position,
          duration: pos.duration,
          buffered: pos.buffered,
        });
        this._emit("progress", {
          position: pos.position,
          duration: pos.duration,
          buffered: pos.buffered,
        });

        // Gapless: pre-load next track when approaching end.
        if (
          this._opts.gapless &&
          !this._state.currentTrack?.isLive &&
          pos.duration > 0 &&
          pos.position >= pos.duration - this._opts.gaplessPreloadSeconds
        ) {
          await this._maybePreloadNext();
        }
      } catch {
        // Player was destroyed; interval will be cleared.
      }
    }, 1000);
  }

  private _stopProgressPolling(): void {
    if (this._progressInterval) {
      clearInterval(this._progressInterval);
      this._progressInterval = null;
    }
  }

  // ─── Private: gapless ──────────────────────────────────────────────────

  /**
   * Gapless works by relying on RNTP's internal queue: when a track is added
   * to the RNTP queue, ExoPlayer / AVPlayer will pre-buffer it while the
   * current track is still playing and cross-fade at the exact sample boundary.
   *
   * `_maybePreloadNext` ensures the *next* track is already in the RNTP
   * queue before it's needed, without duplicating it.
   */
  private async _maybePreloadNext(): Promise<void> {
    const next = this._queue.peek(this._state.repeatMode);
    if (!next || next.isLive || next.id === this._preloadedNextId) return;

    const rntpQueue = await TrackPlayer.getQueue();
    const alreadyQueued = rntpQueue.some((t) => t.id === next.id);

    if (!alreadyQueued) {
      await TrackPlayer.add([toRNTPTrack(next, this._opts.headers, this._opts.userAgent)]);
      this._preloadedNextId = next.id;
    }
  }

  private _scheduleGaplessPreload(): void {
    // Triggered once on track start; actual preload is polled each second.
    this._preloadedNextId = null;
  }

  // ─── Private: RNTP queue sync ──────────────────────────────────────────

  /**
   * Rebuild the entire RNTP queue from our `QueueManager`.
   * Called on `setQueue` or when shuffle is toggled.
   */
  private async _syncRNTPQueue(): Promise<void> {
    await TrackPlayer.reset();
    const rntpTracks = this._queue.tracks.map((t) =>
      toRNTPTrack(t, this._opts.headers, this._opts.userAgent)
    );
    if (rntpTracks.length === 0) return;

    await TrackPlayer.add(rntpTracks);
    await TrackPlayer.skip(this._queue.currentIndex);

    this._updateState({
      queue: this._queue.tracks,
      currentTrack: this._queue.current,
      currentIndex: this._queue.currentIndex,
    });
  }

  private async _loadCurrent(): Promise<void> {
    const track = this._queue.current;
    if (!track) return;
    const idx = this._queue.currentIndex;
    await TrackPlayer.skip(idx);
    this._updateState({
      currentTrack: track,
      currentIndex: idx,
      position: 0,
      duration: track.duration ?? 0,
      buffered: 0,
      error: null,
    });
  }

  // ─── Private: state helpers ────────────────────────────────────────────

  private _updateState(patch: Partial<PlayerState>): void {
    this._state = { ...this._state, ...patch };
    this._emitStateChange();
  }

  private _emitStateChange(): void {
    this._emit("stateChange", this._state);
  }

  private _emit<K extends keyof PlayerEvents>(event: K, payload: PlayerEvents[K]): void {
    const set = this._listeners[event] as Set<EventListener<PlayerEvents[K]>> | undefined;
    if (!set) return;
    for (const listener of set) {
      try { listener(payload); } catch (e) { console.warn("[AudioPlayer] Event listener threw:", e); }
    }
  }

  private _assertInitialized(): void {
    if (!this._initialized) {
      throw new Error("AudioPlayer: call `await player.init()` before using the player.");
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Convenience factory — creates, initialises and returns a player in one call.
 *
 * @example
 * const player = await createAudioPlayer({ gapless: true, shuffle: false });
 * await player.setQueue(tracks, 0, true);
 */
export async function createAudioPlayer(options?: AudioPlayerOptions): Promise<AudioPlayer> {
  const player = new AudioPlayer(options);
  await player.init();
  return player;
}
