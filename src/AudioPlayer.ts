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

export class AudioPlayer {
  private _opts: Required<AudioPlayerOptions>;
  private _queue: QueueManager;
  private _state: PlayerState;
  private _listeners: Partial<{
    [K in keyof PlayerEvents]: Set<EventListener<PlayerEvents[K]>>;
  }> = {};
  private _soundSubscriptions: Array<{ remove(): void }> = [];
  private _retryAttempts = 0;
  private _initialized = false;
  private _progressInterval: ReturnType<typeof setInterval> | null = null;
  private _isReplacingQueue = false;

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

  async init(): Promise<void> {
    if (this._initialized) return;

    try {
      await TrackPlayer.setupPlayer({
        autoHandleInterruptions: true,
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
    this._queue.setQueue(tracks, startIndex);
    this._syncStateWithQueue();
    if (this._queue.current) {
      await this._loadCurrent(autoPlay);
    }
  }

  async addToQueue(tracks: Track[]): Promise<void> {
    this._assertInitialized();
    this._queue.add(tracks);
    await TrackPlayer.add(tracks.map((track) => this._toNativeTrack(track)));
    this._syncStateWithQueue();
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
    if (!this._queue.current) return;

    await TrackPlayer.play();
    this._retryAttempts = 0;
    this._updateState({ playbackState: "playing", error: null });
    this._startProgressPolling();
  }

  async pause(): Promise<void> {
    this._assertInitialized();
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
    const clamped = Math.max(
      0,
      Math.min(position, this._state.duration || Infinity),
    );
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

    return {
      id: track.id,
      url: track.url,
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
): Promise<AudioPlayer> {
  const player = new AudioPlayer(options);
  await player.init();
  return player;
}
