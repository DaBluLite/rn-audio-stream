/**
 * @module rn-audio-stream/AudioPlayer
 *
 * Core audio player class built on top of `react-native-sound-player`.
 */

import SoundPlayer from "react-native-sound-player";

import { QueueManager } from "./utils/QueueManager";
import type {
  Track,
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
  private _listeners: Partial<{ [K in keyof PlayerEvents]: Set<EventListener<PlayerEvents[K]>> }> = {};
  private _soundSubscriptions: Array<{ remove(): void }> = [];
  private _retryAttempts = 0;
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

  async init(): Promise<void> {
    if (this._initialized) return;

    if (this._opts.rate !== 1) {
      throw new Error("AudioPlayer: react-native-sound-player does not support playback rate changes.");
    }
    if (Object.keys(this._opts.headers).length > 0) {
      throw new Error("AudioPlayer: react-native-sound-player does not support per-request headers.");
    }
    if (this._opts.userAgent) {
      throw new Error("AudioPlayer: react-native-sound-player does not support custom User-Agent.");
    }
    if (this._opts.gapless) {
      throw new Error("AudioPlayer: gapless playback is not supported with react-native-sound-player.");
    }

    SoundPlayer.setVolume(this._opts.volume);
    this._subscribeToSoundEvents();
    this._initialized = true;
  }

  async setQueue(tracks: Track[], startIndex = 0, autoPlay = false): Promise<void> {
    this._assertInitialized();
    this._queue.setQueue(tracks, startIndex);
    this._syncStateWithQueue();
    if (autoPlay) {
      await this.play();
    } else if (this._queue.current) {
      await this._loadCurrent(false);
    }
  }

  async addToQueue(tracks: Track[]): Promise<void> {
    this._assertInitialized();
    this._queue.add(tracks);
    this._syncStateWithQueue();
  }

  async playNext(track: Track): Promise<void> {
    this._assertInitialized();
    this._queue.insertNext(track);
    this._syncStateWithQueue();
  }

  async removeFromQueue(id: string): Promise<void> {
    this._assertInitialized();
    const wasCurrentId = this._queue.current?.id;
    const removed = this._queue.remove(id);
    if (!removed) return;

    if (wasCurrentId === id) {
      if (this._queue.current) {
        await this._loadCurrent(this._state.playbackState === "playing");
      } else {
        SoundPlayer.stop();
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
      this._syncStateWithQueue();
    }
  }

  async clearQueue(): Promise<void> {
    this._assertInitialized();
    SoundPlayer.stop();
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

    if (this._state.playbackState === "paused") {
      try {
        SoundPlayer.resume();
        this._retryAttempts = 0;
        this._updateState({ playbackState: "playing", error: null });
        this._startProgressPolling();
      } catch (e) {
        this._handlePlaybackError(e);
        throw e;
      }
      return;
    }

    await this._loadCurrent(true);
  }

  async pause(): Promise<void> {
    this._assertInitialized();
    try {
      SoundPlayer.pause();
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
      SoundPlayer.stop();
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

    const nextTrack = this._queue.next(this._state.repeatMode);
    if (!nextTrack) {
      await this.stop();
      this._emit("queueEnd", undefined as void);
      return;
    }

    await this._loadCurrent(true);
  }

  async previous(): Promise<void> {
    this._assertInitialized();

    if (this._state.repeatMode === "track" || this._state.position > 3) {
      await this.seek(0);
      return;
    }

    this._queue.previous(this._state.repeatMode);
    await this._loadCurrent(true);
  }

  async skipToIndex(index: number): Promise<void> {
    this._assertInitialized();
    this._queue.jumpTo(index);
    await this._loadCurrent(true);
  }

  async seek(position: number): Promise<void> {
    this._assertInitialized();
    if (this._state.currentTrack?.isLive) return;
    const clamped = Math.max(0, Math.min(position, this._state.duration || Infinity));
    try {
      SoundPlayer.seek(clamped);
      this._updateState({ position: clamped });
    } catch (e) {
      this._handlePlaybackError(e);
      throw e;
    }
  }

  async setVolume(volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, volume));
    SoundPlayer.setVolume(clamped);
    this._updateState({ volume: clamped });
  }

  async setRate(rate: number): Promise<void> {
    if (rate !== 1) {
      throw new Error("AudioPlayer: playback rate is not supported with react-native-sound-player.");
    }
    this._updateState({ rate: 1 });
  }

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    this._updateState({ repeatMode: mode });
  }

  async cycleRepeatMode(): Promise<void> {
    const order: RepeatMode[] = ["off", "track", "queue"];
    const current = order.indexOf(this._state.repeatMode);
    await this.setRepeatMode(order[(current + 1) % order.length]);
  }

  async setShuffle(enabled?: boolean): Promise<void> {
    const currentId = this._queue.current?.id ?? null;
    this._queue.setShuffle(enabled);
    if (currentId) {
      const idx = this._queue.tracks.findIndex((t) => t.id === currentId);
      if (idx !== -1) this._queue.jumpTo(idx);
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

  async destroy(): Promise<void> {
    this._stopProgressPolling();
    for (const sub of this._soundSubscriptions) sub.remove();
    this._soundSubscriptions = [];
    SoundPlayer.stop();
    this._queue.clear();
    this._listeners = {};
    this._initialized = false;
  }

  private _subscribeToSoundEvents(): void {
    this._soundSubscriptions.push(
      SoundPlayer.addEventListener("FinishedPlaying", ({ success }) => {
        if (!success) return;
        void this._handleTrackFinished();
      }),
      SoundPlayer.addEventListener("OnSetupError", (e) => {
        this._handlePlaybackError({
          code: "SETUP_ERROR",
          message: "react-native-sound-player setup error.",
          cause: e,
        });
      })
    );
  }

  private _startProgressPolling(): void {
    if (this._progressInterval) return;
    this._progressInterval = setInterval(async () => {
      try {
        if (this._state.playbackState !== "playing" && this._state.playbackState !== "paused") {
          return;
        }
        const info = await SoundPlayer.getInfo();
        const duration = this._state.currentTrack?.isLive
          ? Infinity
          : (info.duration || this._state.currentTrack?.duration || 0);
        const position = this._state.currentTrack?.isLive ? 0 : info.currentTime;

        this._updateState({
          position,
          duration,
          buffered: 0,
        });
        this._emit("progress", {
          position,
          duration,
          buffered: 0,
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

    const previous = this._state.currentTrack;
    try {
      if (autoPlay) {
        SoundPlayer.playUrl(track.url);
        this._startProgressPolling();
      } else {
        SoundPlayer.loadUrl(track.url);
      }
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

  private async _handleTrackFinished(): Promise<void> {
    if (!this._queue.current) return;

    if (this._state.repeatMode === "track" && !this._state.currentTrack?.isLive) {
      await this._loadCurrent(true);
      return;
    }

    const next = this._queue.next(this._state.repeatMode);
    if (!next) {
      this._stopProgressPolling();
      this._updateState({ playbackState: "ended", position: 0 });
      this._emit("queueEnd", undefined as void);
      return;
    }

    await this._loadCurrent(true);
  }

  private _handlePlaybackError(errorLike: unknown): void {
    const err = this._toPlayerError(errorLike);
    if (this._retryAttempts < this._opts.retryCount && this._queue.current) {
      this._retryAttempts++;
      setTimeout(() => {
        void this.play().catch((retryError) => {
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
    if (errorLike && typeof errorLike === "object" && "code" in errorLike && "message" in errorLike) {
      const asErr = errorLike as { code?: unknown; message?: unknown };
      return {
        code: typeof asErr.code === "string" ? asErr.code : "PLAYBACK_ERROR",
        message: typeof asErr.message === "string" ? asErr.message : "Unknown playback error",
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

export async function createAudioPlayer(options?: AudioPlayerOptions): Promise<AudioPlayer> {
  const player = new AudioPlayer(options);
  await player.init();
  return player;
}
