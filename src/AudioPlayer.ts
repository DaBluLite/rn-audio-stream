/**
 * @module rn-audio-stream/AudioPlayer
 *
 * Core audio player class built on top of `react-native-track-player`.
 */

import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode as NativeRepeatMode,
  State as NativeState,
  type AddTrack as NativeTrack,
  type PlaybackState as NativePlaybackState,
} from "react-native-track-player";

import { QueueManager } from "./utils/QueueManager";
import type {
  Track,
  PlaybackState,
  PlayerState,
  RepeatMode,
  PlayerError,
  PlayerEvents,
  AudioPlayerOptions,
} from "./types";
import type { CastDevice, CastState, AudioPlayerOptionsWithCast } from "./types/cast";
import { CastEngine } from "./cast/CastEngine";
import { CacheManager } from "./cache";

const DEFAULT_OPTIONS: Required<AudioPlayerOptions> = {
  volume: 1.0,
  rate: 1.0,
  repeatMode: "off",
  shuffle: false,
  gapless: false,
  gaplessPreloadSeconds: 10,
  retryCount: 3,
  retryDelayMs: 1500,
  userAgent: "",
  headers: {},
  onRemoteControl: () => {},
};

type EventListener<T> = (payload: T) => void;
type UnsubscribeFn = () => void;

export type AudioPlayerCacheOpts = Partial<import("./cache").CacheConfig & import("./cache").PrefetchConfig & { enabled: boolean }>;
export interface AudioPlayerOptionsWithCache extends AudioPlayerOptions {
  streamUrlProvider?: (id: string) => string;
  cache?: AudioPlayerCacheOpts;
}
export class AudioPlayer {
  private _opts: Required<AudioPlayerOptions>;
  private _queue: QueueManager;
  private _cacheMgr: CacheManager | null = null;
  private _streamUrlProvider?: (id: string) => string;
  private _state: PlayerState;
  private _listeners: Partial<{
    [K in keyof PlayerEvents]: Set<EventListener<PlayerEvents[K]>>;
  }> = {};
  private _soundSubscriptions: Array<{ remove(): void }> = [];
  private _retryAttempts = 0;
  private _initialized = false;
  private _progressInterval: ReturnType<typeof setInterval> | null = null;
  private _isReplacingQueue = false;
  // Cast engine (secondary playback engine)
  private _castEngine: CastEngine | null = null;
  private _useCast = false;
  private _castOpts: AudioPlayerOptionsWithCast | null = null;

  constructor(options: AudioPlayerOptionsWithCache = {}) {
    this._opts = { ...DEFAULT_OPTIONS, ...options } as Required<AudioPlayerOptions>;
    this._queue = new QueueManager(this._opts.shuffle);
    this._streamUrlProvider = (options as AudioPlayerOptionsWithCache).streamUrlProvider;
    const cOpts = (options as AudioPlayerOptionsWithCache).cache;
    if (cOpts?.enabled !== false) {
      this._cacheMgr = new CacheManager(cOpts ?? {});
    }

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

  /** Attach Cast engine. Call before or after init(). Enables discovery/session APIs. */
  enableCast(opts: AudioPlayerOptionsWithCast = {}): CastEngine {
    this._castOpts = opts;
    if (this._castEngine) this._castEngine.destroy();
    this._castEngine = new CastEngine({
      headers: (opts.headers as Record<string, string>) ?? (this._opts.headers as Record<string, string>),
      onCastStateChange: (s, d) => { opts.onCastStateChange?.(s, d); this._onCastStateChange(s, d); },
      onSessionStart: opts.onCastSessionStart,
      onSessionEnd: opts.onCastSessionEnd,
      onSessionError: opts.onCastSessionError,
    });
    // Bridge Cast media updates -> unified PlayerState/progress events
    this._castEngine.onPlayerState = (patch) => this._updateState(patch as Partial<PlayerState>);
    this._castEngine.onProgress = (p) => {
      this._updateState(p as Partial<PlayerState>);
      this._emit("progress", p);
    };
    this._castEngine.onQueueEnd = () => this._emit("queueEnd", undefined as void);
    this._castEngine.onError = (e) => {
      const err: PlayerError = { code: e.code, message: e.message, track: this._queue.current ?? undefined };
      this._updateState({ playbackState: "error", error: err });
      this._emit("error", err);
    };
    return this._castEngine;
  }

  get castEngine(): CastEngine | null { return this._castEngine; }
  get isCasting(): boolean { return this._useCast; }
  get castState(): CastState | null { return this._castEngine?.castState ?? null; }

  // ---- Cast discovery / session passthrough (Requirement #2) ----
  async castStartDiscovery(): Promise<void> { if (!this._castEngine) throw new Error("Call enableCast() first"); await this._castEngine.startDiscovery(); }
  async castStopDiscovery(): Promise<void> { await this._castEngine?.stopDiscovery(); }
  async castGetDevices(): Promise<CastDevice[]> { if (!this._castEngine) throw new Error("Call enableCast() first"); return this._castEngine.getDevices(); }
  castOnDevicesUpdated(cb: (d: CastDevice[]) => void) { if (!this._castEngine) throw new Error("Call enableCast() first"); return this._castEngine.onDevicesUpdated(cb); }
  async castStartSession(deviceId: string): Promise<boolean> { if (!this._castEngine) throw new Error("Call enableCast() first"); return this._castEngine.startSession(deviceId); }
  async castEndSession(stopCasting = false): Promise<void> { await this._castEngine?.endSession(stopCasting); }

  private async _onCastStateChange(state: CastState, device: CastDevice | null): Promise<void> {
    if (state === "connected" && device) {
      // Handoff: pause local, transfer current track+position to Cast (Requirement #1 & #2)
      await this._handoffToCast();
    } else if (state === "not_connected" && this._useCast) {
      await this._handoffToLocal();
    }
  }

  private async _handoffToCast(): Promise<void> {
    const track = this._queue.current;
    const pos = this._state.position;
    try { await TrackPlayer.pause(); } catch {}
    this._stopProgressPolling();
    this._useCast = true;
    if (track && this._castEngine) {
      // Use queue load so receiver has full queue for next/prev
      if (this._queue.tracks.length > 1) {
        await this._castEngine.loadQueue(this._queue.tracks, this._queue.currentIndex, pos).catch(() => this._castEngine!.load(track, pos, true));
      } else {
        await this._castEngine.load(track, pos, true);
      }
    }
    this._updateState({ playbackState: "buffering" });
  }

  private async _handoffToLocal(): Promise<void> {
    this._useCast = false;
    const track = this._queue.current;
    if (track) {
      // Restore local queue at same index, seek to last known Cast position
      const pos = this._state.position;
      await this._replaceNativeQueue(this._queue.currentIndex).catch(() => {});
      if (pos > 0) await TrackPlayer.seekTo(pos).catch(() => {});
    }
    this._updateState({ playbackState: "paused" });
  }

  get cache() {
    const m = this._cacheMgr;
    if (!m) return undefined;
    return {
      getCachedUrl: (id: string) => m.getCachedUrl(id),
      prefetch: (ids: string[]) => m.prefetchIds(ids, (id)=> this._streamUrlProvider?.(id) ?? this._queue.tracks.find(t=>t.id===id)?.url ?? ""),
      clear: () => m.clear(),
      getStats: () => m.getStats(),
      getCacheHealthReport: () => m.getCacheHealthReport(),
      removeTrack: (id: string) => m.removeTrack(id),
    };
  }

  private _resolveTrackUrl(track: Track): string {
    const cached = this._cacheMgr?.getCachedUrlSync(track.id);
    if (cached) return cached;
    if (track.url) return track.url;
    if (this._streamUrlProvider) return this._streamUrlProvider(track.id);
    return track.url;
  }
  private _maybePrefetchAround(index: number) {
    if (!this._cacheMgr) return;
    const ids = this._queue.tracks.slice(index, index + 1 + this._cacheMgr.prefetch.prefetchCount).map(t=>t.id);
    // current + next N, fire-and-forget
    for (const t of this._queue.tracks.slice(index, index + 1 + this._cacheMgr.prefetch.prefetchCount)) {
      const url = t.url || this._streamUrlProvider?.(t.id) || "";
      if (url) void this._cacheMgr.streamAndCacheChunked(t.id, url);
    }
  }

  async init(icon?: number): Promise<void> {
    if (this._initialized) return;
    await this._cacheMgr?.init();

    try {
      await TrackPlayer.setupPlayer({
        autoHandleInterruptions: true,
      });
      icon && await TrackPlayer.updateOptions({
        icon,
      });
    } catch (e) {
      if (!this._isAlreadySetupError(e)) {
        throw e;
      }
    }

    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SeekTo,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SeekTo,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      progressUpdateEventInterval: 1,
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
    });
    await TrackPlayer.setVolume(this._opts.volume);
    await TrackPlayer.setRate(this._opts.rate);
    await TrackPlayer.setRepeatMode(
      this._toNativeRepeatMode(this._opts.repeatMode),
    );

    this._subscribeToSoundEvents();
    this._initialized = true;
  }

  async setQueue(
    tracks: Track[],
    startIndex = 0,
    autoPlay = false,
  ): Promise<void> {
    this._assertInitialized();
    // offline: filter to cached only
    let effective = tracks;
    if (this._cacheMgr?.isOffline) {
      effective = tracks.filter(t => !!this._cacheMgr!.getCachedUrlSync(t.id));
      if (effective.length===0) throw new Error("Offline: no cached tracks");
      startIndex = Math.min(startIndex, effective.length-1);
    }
    this._queue.setQueue(effective, startIndex);
    this._syncStateWithQueue();
    if (this._queue.current) {
      await this._loadCurrent(autoPlay);
    }
    this._maybePrefetchAround(this._queue.currentIndex);
  }

  async addToQueue(tracks: Track[]): Promise<void> {
    this._assertInitialized();
    this._queue.add(tracks);
    await TrackPlayer.add(tracks.map((track) => this._toNativeTrack({ ...track, url: this._resolveTrackUrl(track) })));
    this._syncStateWithQueue();
    // prefetch added tracks
    for(const t of tracks){ const u=t.url||this._streamUrlProvider?.(t.id)||""; if(u) void this._cacheMgr?.streamAndCacheChunked(t.id,u); }
  }

  async playNext(track: Track): Promise<void> {
    this._assertInitialized();
    const insertAt = this._queue.currentIndex + 1;
    this._queue.insertNext(track);
    await TrackPlayer.add(this._toNativeTrack(track), insertAt);
    this._syncStateWithQueue();
  }

  async removeFromQueue(id: string): Promise<void> {
    this._assertInitialized();
    const removeIndex = this._queue.tracks.findIndex(
      (track) => track.id === id,
    );
    if (removeIndex === -1) return;

    const wasCurrentId = this._queue.current?.id;
    const removed = this._queue.remove(id);
    if (!removed) return;

    if (wasCurrentId === id) {
      if (this._queue.current) {
        await TrackPlayer.remove(removeIndex);
      } else {
        await TrackPlayer.reset();
        this._updateState({
          playbackState: "idle",
          position: 0,
          duration: 0,
          buffered: 0,
          currentTrack: null,
          currentIndex: -1,
          queue: [],
        });
      }
    } else {
      await TrackPlayer.remove(removeIndex);
      this._syncStateWithQueue();
    }
  }

  async clearQueue(): Promise<void> {
    this._assertInitialized();
    await TrackPlayer.reset();
    this._stopProgressPolling();
    this._queue.clear();
    this._updateState({
      playbackState: "idle",
      currentTrack: null,
      currentIndex: -1,
      queue: [],
      position: 0,
      duration: 0,
      buffered: 0,
      error: null,
    });
  }

  async play(): Promise<void> {
    this._assertInitialized();
    if (this._useCast && this._castEngine?.isCasting) return this._castEngine.play();
    if (!this._queue.current) return;
    await TrackPlayer.play();
    this._retryAttempts = 0;
    this._updateState({ playbackState: "playing", error: null });
    this._startProgressPolling();
  }

  async pause(): Promise<void> {
    this._assertInitialized();
    if (this._useCast && this._castEngine?.isCasting) { await this._castEngine.pause(); this._updateState({ playbackState: "paused" }); return; }
    try {
      await TrackPlayer.pause();
      this._updateState({ playbackState: "paused" });
      this._stopProgressPolling();
    } catch (e) {
      this._handlePlaybackError(e);
      throw e;
    }
  }

  async togglePlayPause(): Promise<void> {
    if (this._state.playbackState === "playing") {
      await this.pause();
    } else {
      await this.play();
    }
  }

  async stop(): Promise<void> {
    this._assertInitialized();
    try {
      await TrackPlayer.stop();
      this._stopProgressPolling();
      this._updateState({ playbackState: "stopped", position: 0, buffered: 0 });
    } catch (e) {
      this._handlePlaybackError(e);
      throw e;
    }
  }

  async next(): Promise<void> {
    this._assertInitialized();

    if (this._state.repeatMode === "track") {
      await this.seek(0);
      return;
    }

    try {
      await TrackPlayer.skipToNext();
      await TrackPlayer.play();
    } catch (e) {
      if (this._state.repeatMode === "off") {
        this._updateState({ playbackState: "ended", position: 0 });
        this._emit("queueEnd", undefined as void);
        return;
      }
      this._handlePlaybackError(e);
      throw e;
    }
  }

  async previous(): Promise<void> {
    this._assertInitialized();

    if (this._state.repeatMode === "track" || this._state.position > 3) {
      await this.seek(0);
      return;
    }

    try {
      await TrackPlayer.skipToPrevious();
      await TrackPlayer.play();
    } catch (e) {
      await this.seek(0);
    }
  }

  async skipToIndex(index: number): Promise<void> {
    this._assertInitialized();
    this._queue.jumpTo(index);
    await TrackPlayer.skip(index);
    await TrackPlayer.play();
  }

  async seek(position: number): Promise<void> {
    this._assertInitialized();
    if (this._state.currentTrack?.isLive) return;
    const clamped = Math.max(0, Math.min(position, this._state.duration || Infinity));
    if (this._useCast && this._castEngine?.isCasting) { await this._castEngine.seek(clamped); this._updateState({ position: clamped }); return; }
    try {
      await TrackPlayer.seekTo(clamped);
      this._updateState({ position: clamped });
    } catch (e) {
      this._handlePlaybackError(e);
      throw e;
    }
  }

  async setVolume(volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, volume));
    if (this._useCast && this._castEngine?.isCasting) await this._castEngine.setVolume(clamped).catch(() => {});
    await TrackPlayer.setVolume(clamped);
    this._updateState({ volume: clamped });
  }

  async setRate(rate: number): Promise<void> {
    const clamped = Math.max(0.25, Math.min(4, rate));
    await TrackPlayer.setRate(clamped);
    this._updateState({ rate: clamped });
  }

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    await TrackPlayer.setRepeatMode(this._toNativeRepeatMode(mode));
    this._updateState({ repeatMode: mode });
  }

  async cycleRepeatMode(): Promise<void> {
    const order: RepeatMode[] = ["off", "track", "queue"];
    const current = order.indexOf(this._state.repeatMode);
    await this.setRepeatMode(order[(current + 1) % order.length]);
  }

  async setShuffle(enabled?: boolean): Promise<void> {
    const wasPlaying = this._state.playbackState === "playing";

    const currentId = this._queue.current?.id ?? null;
    this._queue.setShuffle(enabled);
    if (currentId) {
      const idx = this._queue.tracks.findIndex((t) => t.id === currentId);
      if (idx !== -1) this._queue.jumpTo(idx);
    }

    await this._replaceNativeQueue(this._queue.currentIndex);
    if (wasPlaying) {
      await TrackPlayer.play();
    }

    this._updateState({
      shuffle: this._queue.shuffle,
      queue: this._queue.tracks,
      currentTrack: this._queue.current,
      currentIndex: this._queue.currentIndex,
    });
  }

  get state(): Readonly<PlayerState> {
    return this._state;
  }

  on<K extends keyof PlayerEvents>(
    event: K,
    listener: EventListener<PlayerEvents[K]>,
  ): UnsubscribeFn {
    if (!this._listeners[event]) {
      this._listeners[event] = new Set() as any;
    }
    (this._listeners[event] as Set<EventListener<PlayerEvents[K]>>).add(
      listener,
    );
    return () => {
      (this._listeners[event] as Set<EventListener<PlayerEvents[K]>>)?.delete(
        listener,
      );
    };
  }

  once<K extends keyof PlayerEvents>(
    event: K,
    listener: EventListener<PlayerEvents[K]>,
  ): UnsubscribeFn {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  async destroy(): Promise<void> {
    this._stopProgressPolling();
    for (const sub of this._soundSubscriptions) sub.remove();
    this._soundSubscriptions = [];
    this._castEngine?.destroy();
    this._castEngine = null; this._useCast = false;
    await TrackPlayer.stop();
    this._queue.clear();
    this._listeners = {};
    this._initialized = false;
  }

  private _subscribeToSoundEvents(): void {
    this._soundSubscriptions.push(
      TrackPlayer.addEventListener(
        Event.PlaybackActiveTrackChanged,
        (event) => {
          if (this._isReplacingQueue) return;

          if (typeof event.index === "number") {
            try {
              this._queue.jumpTo(event.index);
            } catch (e) {
              console.warn(
                "[AudioPlayer] Received out-of-range active track index:",
                event.index,
                e,
              );
            }
          }

          const previous = this._state.currentTrack;
          const current =
            typeof event.index === "number"
              ? (this._queue.tracks[event.index] ?? null)
              : null;

          this._updateState({
            currentTrack: current,
            currentIndex: typeof event.index === "number" ? event.index : -1,
            position: 0,
            duration: current?.isLive ? Infinity : (current?.duration ?? 0),
          });

          if (!previous || previous.id !== current?.id) {
            if (current) {
              this._emit("trackChange", { previous, current });
            }
          }
        },
      ),
      TrackPlayer.addEventListener(
        Event.PlaybackState,
        (event: NativePlaybackState) => {
          const playbackState = this._mapNativeState(event.state);
          this._updateState({ playbackState });
          if (playbackState === "playing" || playbackState === "paused") {
            this._startProgressPolling();
          } else {
            this._stopProgressPolling();
          }
        },
      ),
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, ({ position }) => {
        this._stopProgressPolling();
        this._updateState({ playbackState: "ended", position });
        this._emit("queueEnd", undefined as void);
      }),
      TrackPlayer.addEventListener(Event.PlaybackError, (event) => {
        this._handlePlaybackError(event);
      }),
      TrackPlayer.addEventListener(Event.RemotePlay, () => {
        this._opts.onRemoteControl({ type: "play" });
      }),
      TrackPlayer.addEventListener(Event.RemotePause, () => {
        this._opts.onRemoteControl({ type: "pause" });
      }),
      TrackPlayer.addEventListener(Event.RemoteStop, () => {
        this._opts.onRemoteControl({ type: "stop" });
      }),
      TrackPlayer.addEventListener(Event.RemoteNext, () => {
        this._opts.onRemoteControl({ type: "next" });
      }),
      TrackPlayer.addEventListener(Event.RemotePrevious, () => {
        this._opts.onRemoteControl({ type: "previous" });
      }),
      TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => {
        this._opts.onRemoteControl({ type: "seek", position });
      }),
    );
  }

  private _startProgressPolling(): void {
    if (this._progressInterval) return;
    this._progressInterval = setInterval(async () => {
      try {
        if (
          this._state.playbackState !== "playing" &&
          this._state.playbackState !== "paused"
        ) {
          return;
        }
        const info = await TrackPlayer.getProgress();
        const duration = this._state.currentTrack?.isLive
          ? Infinity
          : info.duration || this._state.currentTrack?.duration || 0;
        const position = this._state.currentTrack?.isLive ? 0 : info.position;

        this._updateState({
          position,
          duration,
          buffered: info.buffered ?? 0,
        });
        this._emit("progress", {
          position,
          duration,
          buffered: info.buffered ?? 0,
        });
      } catch (e) {
        console.warn("[AudioPlayer] Failed to read playback info:", e);
      }
    }, 1000);
  }

  private _stopProgressPolling(): void {
    if (this._progressInterval) {
      clearInterval(this._progressInterval);
      this._progressInterval = null;
    }
  }

  private _syncStateWithQueue(): void {
    this._updateState({
      queue: this._queue.tracks,
      currentTrack: this._queue.current,
      currentIndex: this._queue.currentIndex,
    });
  }

  private async _loadCurrent(autoPlay: boolean): Promise<void> {
    const track = this._queue.current;
    if (!track) return;
    const targetIndex = this._queue.currentIndex;

    const previous = this._state.currentTrack;
    try {
      await this._replaceNativeQueue(targetIndex);
      if (autoPlay) await TrackPlayer.play();

      this._retryAttempts = 0;
      this._updateState({
        queue: this._queue.tracks,
        currentTrack: track,
        currentIndex: this._queue.currentIndex,
        playbackState: autoPlay ? "playing" : "stopped",
        position: 0,
        duration: track.duration ?? 0,
        buffered: 0,
        error: null,
      });
      if (!previous || previous.id !== track.id) {
        this._emit("trackChange", { previous, current: track });
      }
    } catch (e) {
      this._handlePlaybackError(e);
      throw e;
    }
  }

  private _handlePlaybackError(errorLike: unknown): void {
    const err = this._toPlayerError(errorLike);
    if (this._retryAttempts < this._opts.retryCount && this._queue.current) {
      this._retryAttempts++;
      setTimeout(() => {
        void TrackPlayer.retry().catch((retryError) => {
          const retryErr = this._toPlayerError(retryError);
          this._updateState({ playbackState: "error", error: retryErr });
          this._emit("error", retryErr);
        });
      }, this._opts.retryDelayMs);
      return;
    }
    this._retryAttempts = 0;
    this._updateState({ playbackState: "error", error: err });
    this._emit("error", err);
  }

  private _toPlayerError(errorLike: unknown): PlayerError {
    if (
      errorLike &&
      typeof errorLike === "object" &&
      "code" in errorLike &&
      "message" in errorLike
    ) {
      const asErr = errorLike as { code?: unknown; message?: unknown };
      return {
        code: typeof asErr.code === "string" ? asErr.code : "PLAYBACK_ERROR",
        message:
          typeof asErr.message === "string"
            ? asErr.message
            : "Unknown playback error",
        track: this._queue.current ?? undefined,
        cause: errorLike,
      };
    }
    if (errorLike instanceof Error) {
      return {
        code: "PLAYBACK_ERROR",
        message: errorLike.message,
        track: this._queue.current ?? undefined,
        cause: errorLike,
      };
    }
    return {
      code: "PLAYBACK_ERROR",
      message: "Unknown playback error",
      track: this._queue.current ?? undefined,
      cause: errorLike,
    };
  }

  private _updateState(patch: Partial<PlayerState>): void {
    this._state = { ...this._state, ...patch };
    this._emitStateChange();
  }

  private _emitStateChange(): void {
    this._emit("stateChange", this._state);
  }

  private _emit<K extends keyof PlayerEvents>(
    event: K,
    payload: PlayerEvents[K],
  ): void {
    const set = this._listeners[event] as
      Set<EventListener<PlayerEvents[K]>> | undefined;
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (e) {
        console.warn("[AudioPlayer] Event listener threw:", e);
      }
    }
  }

  private _assertInitialized(): void {
    if (!this._initialized) {
      throw new Error(
        "AudioPlayer: call `await player.init()` before using the player.",
      );
    }
  }

  async _getActiveTrackId() {
    try {
      const index = await TrackPlayer.getActiveTrackIndex();
      if (index == null || index < 0) return null;
      const queue = await TrackPlayer.getQueue();
      const track = queue[index];
      return track ? String(track.id) : null;
    } catch (e) {
      return null;
    }
  }

  private async _replaceNativeQueue(targetIndex: number): Promise<void> {
    const nativeQueue = this._queue.tracks.map((track) =>
      this._toNativeTrack(track),
    );
    this._isReplacingQueue = true;
    try {
      await TrackPlayer.setPlayWhenReady(false);
      if (nativeQueue.length === 0) {
        await TrackPlayer.reset();
        return;
      }

      const newCurrentId = this._queue.current?.id;
      const keepCurrent =
        newCurrentId != null &&
        (await this._getActiveTrackId()) === newCurrentId;
      if (keepCurrent && targetIndex >= 0 && targetIndex < nativeQueue.length) {
        const existing = await TrackPlayer.getQueue();
        const activeIndex = await TrackPlayer.getActiveTrackIndex();
        if (
          activeIndex != null &&
          activeIndex >= 0 &&
          activeIndex < existing.length
        ) {
          const toRemove = existing
            .map((_, i) => i)
            .filter((i) => i !== activeIndex)
            .sort((a, b) => b - a);
          if (toRemove.length > 0) {
            await TrackPlayer.remove(toRemove);
          }
          const before = nativeQueue.slice(0, targetIndex);
          const after = nativeQueue.slice(targetIndex + 1);
          if (before.length > 0) {
            await TrackPlayer.add(before, 0);
          }
          if (after.length > 0) {
            await TrackPlayer.add(after);
          }
          await TrackPlayer.setRepeatMode(
            this._toNativeRepeatMode(this._state.repeatMode),
          );
          return;
        }
      }

      await TrackPlayer.setQueue(nativeQueue);
      if (targetIndex >= 0) {
        await TrackPlayer.skip(targetIndex);
      }
      await TrackPlayer.setRepeatMode(
        this._toNativeRepeatMode(this._state.repeatMode),
      );
    } finally {
      this._isReplacingQueue = false;
    }
  }

  private _toNativeTrack(track: Track): NativeTrack {
    const headers =
      Object.keys(this._opts.headers).length > 0
        ? this._opts.headers
        : undefined;
    const artwork =
      typeof track.artwork === "string" ? track.artwork : undefined;
    const url = this._resolveTrackUrl(track);

    return {
      id: track.id,
      url,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork,
      duration: track.duration,
      isLiveStream: track.isLive,
      userAgent: this._opts.userAgent || undefined,
      headers,
    };
  }

  private _toNativeRepeatMode(mode: RepeatMode): NativeRepeatMode {
    switch (mode) {
      case "track":
        return NativeRepeatMode.Track;
      case "queue":
        return NativeRepeatMode.Queue;
      case "off":
      default:
        return NativeRepeatMode.Off;
    }
  }

  private _mapNativeState(state: NativeState): PlaybackState {
    switch (state) {
      case NativeState.Loading:
        return "loading";
      case NativeState.Buffering:
        return "buffering";
      case NativeState.Playing:
        return "playing";
      case NativeState.Paused:
        return "paused";
      case NativeState.Stopped:
      case NativeState.Ready:
        return "stopped";
      case NativeState.Ended:
        return "ended";
      case NativeState.Error:
        return "error";
      case NativeState.None:
      default:
        return "idle";
    }
  }

  private _isAlreadySetupError(errorLike: unknown): boolean {
    if (!errorLike || typeof errorLike !== "object") return false;
    const maybeError = errorLike as { code?: unknown; message?: unknown };
    const code = typeof maybeError.code === "string" ? maybeError.code : "";
    const message =
      typeof maybeError.message === "string" ? maybeError.message : "";

    return (
      code === "player_already_initialized" ||
      message.toLowerCase().includes("already initialized")
    );
  }
}

export async function createAudioPlayer(
  options?: AudioPlayerOptions,
  icon?: number,
): Promise<AudioPlayer> {
  const player = new AudioPlayer(options);
  await player.init(icon);
  return player;
}
