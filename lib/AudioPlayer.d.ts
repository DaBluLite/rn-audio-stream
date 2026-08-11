/**
 * @module rn-audio-stream/AudioPlayer
 *
 * Core audio player class built on top of `react-native-track-player`.
 */
import type { Track, PlayerState, RepeatMode, PlayerEvents, AudioPlayerOptions } from "./types";
type EventListener<T> = (payload: T) => void;
type UnsubscribeFn = () => void;
export declare class AudioPlayer {
    private _opts;
    private _queue;
    private _state;
    private _listeners;
    private _soundSubscriptions;
    private _retryAttempts;
    private _initialized;
    private _progressInterval;
    private _isReplacingQueue;
    constructor(options?: AudioPlayerOptions);
    init(icon?: number): Promise<void>;
    setQueue(tracks: Track[], startIndex?: number, autoPlay?: boolean): Promise<void>;
    addToQueue(tracks: Track[]): Promise<void>;
    playNext(track: Track): Promise<void>;
    removeFromQueue(id: string): Promise<void>;
    clearQueue(): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    togglePlayPause(): Promise<void>;
    stop(): Promise<void>;
    next(): Promise<void>;
    previous(): Promise<void>;
    skipToIndex(index: number): Promise<void>;
    seek(position: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    setRate(rate: number): Promise<void>;
    setRepeatMode(mode: RepeatMode): Promise<void>;
    cycleRepeatMode(): Promise<void>;
    setShuffle(enabled?: boolean): Promise<void>;
    get state(): Readonly<PlayerState>;
    on<K extends keyof PlayerEvents>(event: K, listener: EventListener<PlayerEvents[K]>): UnsubscribeFn;
    once<K extends keyof PlayerEvents>(event: K, listener: EventListener<PlayerEvents[K]>): UnsubscribeFn;
    destroy(): Promise<void>;
    private _subscribeToSoundEvents;
    private _startProgressPolling;
    private _stopProgressPolling;
    private _syncStateWithQueue;
    private _loadCurrent;
    private _handlePlaybackError;
    private _toPlayerError;
    private _updateState;
    private _emitStateChange;
    private _emit;
    private _assertInitialized;
    _getActiveTrackId(): Promise<string | null>;
    private _replaceNativeQueue;
    private _toNativeTrack;
    private _toNativeRepeatMode;
    private _mapNativeState;
    private _isAlreadySetupError;
}
export declare function createAudioPlayer(options?: AudioPlayerOptions, icon?: number): Promise<AudioPlayer>;
export {};
//# sourceMappingURL=AudioPlayer.d.ts.map