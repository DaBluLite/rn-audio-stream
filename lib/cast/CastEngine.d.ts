/**
 * @module rn-audio-stream/cast/CastEngine
 *
 * Secondary playback engine that routes commands to Google Cast
 * RemoteMediaClient when a Cast session is active.
 */
import type { Track, PlaybackState, PlayerState, PlayerEvents } from "../types";
import type { CastDevice, CastState } from "../types/cast";
type EmitterSub = {
    remove(): void;
};
export interface PlaybackEngine {
    play(): Promise<void>;
    pause(): Promise<void>;
    stop(): Promise<void>;
    seek(position: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    load(track: Track, position?: number, autoPlay?: boolean): Promise<void>;
}
export declare class CastEngine implements PlaybackEngine {
    private _headers;
    private _onCastStateChange?;
    private _onSessionStart?;
    private _onSessionEnd?;
    private _castState;
    private _connectedDevice;
    private _client;
    private _session;
    private _subs;
    private _externalListeners;
    onPlayerState?: (patch: Partial<PlayerState>) => void;
    onProgress?: (p: {
        position: number;
        duration: number;
        buffered: number;
    }) => void;
    onTrackChange?: (payload: PlayerEvents["trackChange"]) => void;
    onQueueEnd?: () => void;
    onError?: (e: {
        code: string;
        message: string;
    }) => void;
    constructor(opts?: {
        headers?: Record<string, string>;
        onCastStateChange?: (s: CastState, d: CastDevice | null) => void;
        onSessionStart?: (d: CastDevice) => void;
        onSessionEnd?: (wasConnected: boolean) => void;
        onSessionError?: (e: Error) => void;
    });
    startDiscovery(): Promise<void>;
    stopDiscovery(): Promise<void>;
    getDevices(): Promise<CastDevice[]>;
    onDevicesUpdated(listener: (devices: CastDevice[]) => void): EmitterSub;
    startSession(deviceId: string): Promise<boolean>;
    endSession(stopCasting?: boolean): Promise<void>;
    get castState(): CastState;
    get connectedDevice(): CastDevice | null;
    get isCasting(): boolean;
    get client(): any | null;
    load(track: Track, position?: number, autoPlay?: boolean): Promise<void>;
    /** Load full queue via queueData — preferred for gapless queue on receiver */
    loadQueue(tracks: Track[], startIndex: number, position?: number): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    stop(): Promise<void>;
    seek(position: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    setMuted(muted: boolean): Promise<void>;
    private _bindSessionEvents;
    private _mediaSubs;
    private _attachMediaListeners;
    private _detachMediaListeners;
    on<K extends keyof PlayerEvents>(event: K, listener: (p: PlayerEvents[K]) => void): () => void;
    destroy(): void;
    static mapDevice(d: any): CastDevice;
    static mapCastState(s: string): CastState;
    static mapPlayerState(s: string | null | undefined): PlaybackState;
}
export {};
//# sourceMappingURL=CastEngine.d.ts.map