/**
 * @module rn-audio-stream/cast/CastEngine
 *
 * Secondary playback engine that routes commands to Google Cast
 * RemoteMediaClient when a Cast session is active.
 */

import type { Track, PlaybackState, PlayerState, PlayerEvents } from "../types";
import type { CastDevice, CastState } from "../types/cast";

// Lazy require so jest / non-RN env doesn't crash if native module missing
function getGoogleCast(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("react-native-google-cast");
  return mod.default ?? mod.CastContext ?? mod;
}

type EmitterSub = { remove(): void };

export interface PlaybackEngine {
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(position: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  load(track: Track, position?: number, autoPlay?: boolean): Promise<void>;
}

function buildCastUrl(track: Track, headers: Record<string, string>): string {
  // Cast devices drop custom HTTP headers — bake Subsonic/auth tokens into URL query params.
  // If track.url already contains query params (Subsonic: u, s, t, v, c, id) we preserve them.
  // Otherwise append any header that looks like auth (Authorization, etc.) is NOT forwarded.
  // Caller should ensure stream URL is pre-signed with ?u=&t=&s= or token param.
  try {
    const url = new URL(track.url);
    // If headers contain extra auth not in URL, encode as query param fallback
    // (receiver can ignore unknown params; better than dropping auth entirely)
    for (const [k, v] of Object.entries(headers)) {
      const lower = k.toLowerCase();
      if (lower === "authorization" && !url.searchParams.has("authorization")) {
        // Don't leak raw header value as-is; cast will use URL directly
        // Best-effort: append as query param so Subsonic token auth still works
        url.searchParams.set("authorization", v);
      }
    }
    return url.toString();
  } catch {
    return track.url;
  }
}

function trackToMediaInfo(track: Track, headers: Record<string, string>) {
  const contentUrl = buildCastUrl(track, headers);
  const isLive = !!track.isLive;
  // Infer contentType from URL extension fallback to audio/mpeg
  const ext = contentUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    mp3: "audio/mpeg", aac: "audio/aac", flac: "audio/flac",
    ogg: "audio/ogg", opus: "audio/opus", wav: "audio/wav",
    m3u8: "application/x-mpegURL", mp4: "video/mp4",
  };
  const contentType = mimeMap[ext] ?? "audio/mpeg";
  const artwork = typeof track.artwork === "string" ? track.artwork : undefined;

  return {
    contentId: track.id,
    contentUrl,
    contentType,
    streamDuration: isLive ? undefined : track.duration,
    streamType: isLive ? "live" : "buffered",
    metadata: {
      type: "musicTrack" as const,
      title: track.title ?? track.id,
      artist: track.artist,
      albumName: track.album,
      images: artwork ? [{ url: artwork }] : undefined,
      // pass original track id for receiver customData correlation
      trackId: track.id,
    },
    customData: { trackId: track.id, ...(track.metadata ?? {}) },
  };
}

export class CastEngine implements PlaybackEngine {
  private _headers: Record<string, string>;
  private _onCastStateChange?: (s: CastState, d: CastDevice | null) => void;
  private _onSessionStart?: (d: CastDevice) => void;
  private _onSessionEnd?: (wasConnected: boolean) => void;

  private _castState: CastState = "not_connected";
  private _connectedDevice: CastDevice | null = null;
  private _client: any | null = null;
  private _session: any | null = null;

  private _subs: EmitterSub[] = [];
  private _externalListeners: Partial<{ [K in keyof PlayerEvents]: Set<(p: PlayerEvents[K]) => void> }> = {};

  // Exposed so AudioPlayer can sync unified state without tight coupling
  onPlayerState?: (patch: Partial<PlayerState>) => void;
  onProgress?: (p: { position: number; duration: number; buffered: number }) => void;
  onTrackChange?: (payload: PlayerEvents["trackChange"]) => void;
  onQueueEnd?: () => void;
  onError?: (e: { code: string; message: string }) => void;

  constructor(opts: {
    headers?: Record<string, string>;
    onCastStateChange?: (s: CastState, d: CastDevice | null) => void;
    onSessionStart?: (d: CastDevice) => void;
    onSessionEnd?: (wasConnected: boolean) => void;
    onSessionError?: (e: Error) => void;
  } = {}) {
    this._headers = opts.headers ?? {};
    this._onCastStateChange = opts.onCastStateChange;
    this._onSessionStart = opts.onSessionStart;
    this._onSessionEnd = opts.onSessionEnd;
    this._bindSessionEvents(opts.onSessionError);
  }

  // ---- Discovery & Session Management (Core Requirement #2) ----
  async startDiscovery(): Promise<void> {
    const GC = getGoogleCast();
    await GC.getDiscoveryManager().startDiscovery();
  }

  async stopDiscovery(): Promise<void> {
    const GC = getGoogleCast();
    await GC.getDiscoveryManager().stopDiscovery();
  }

  async getDevices(): Promise<CastDevice[]> {
    const GC = getGoogleCast();
    const devices: any[] = await GC.getDiscoveryManager().getDevices();
    return devices.map(CastEngine.mapDevice);
  }

  onDevicesUpdated(listener: (devices: CastDevice[]) => void): EmitterSub {
    const GC = getGoogleCast();
    return GC.getDiscoveryManager().onDevicesUpdated((devices: any[]) =>
      listener(devices.map(CastEngine.mapDevice)),
    );
  }

  async startSession(deviceId: string): Promise<boolean> {
    const GC = getGoogleCast();
    return GC.getSessionManager().startSession(deviceId);
  }

  async endSession(stopCasting = false): Promise<void> {
    const GC = getGoogleCast();
    await GC.getSessionManager().endCurrentSession(stopCasting);
  }

  get castState(): CastState { return this._castState; }
  get connectedDevice(): CastDevice | null { return this._connectedDevice; }
  get isCasting(): boolean { return this._castState === "connected" && !!this._client; }
  get client(): any | null { return this._client; }

  // ---- PlaybackEngine (routes to RemoteMediaClient) ----
  async load(track: Track, position = 0, autoPlay = true): Promise<void> {
    if (!this._client) throw new Error("CastEngine: no active RemoteMediaClient");
    const mediaInfo = trackToMediaInfo(track, this._headers);
    await this._client.loadMedia({
      mediaInfo,
      autoplay: autoPlay,
      startTime: position,
      playbackRate: 1,
    });
  }

  /** Load full queue via queueData — preferred for gapless queue on receiver */
  async loadQueue(tracks: Track[], startIndex: number, position = 0): Promise<void> {
    if (!this._client) throw new Error("CastEngine: no active RemoteMediaClient");
    const items = tracks.map((t, i) => ({
      media: trackToMediaInfo(t, this._headers),
      autoplay: true,
      startTime: i === startIndex ? position : 0,
      preloadTime: 10,
    }));
    await this._client.loadMedia({
      queueData: {
        name: "rn-audio-stream queue",
        items,
        startIndex,
        repeatMode: "REPEAT_OFF",
      },
      autoplay: true,
      startTime: position,
    });
  }

  async play(): Promise<void> { if (this._client) await this._client.play(); }
  async pause(): Promise<void> { if (this._client) await this._client.pause(); }
  async stop(): Promise<void> { if (this._client) await this._client.stop(); }
  async seek(position: number): Promise<void> { if (this._client) await this._client.seek({ position }); }
  async setVolume(volume: number): Promise<void> { if (this._client) await this._client.setStreamVolume(volume); }
  async setMuted(muted: boolean): Promise<void> { if (this._client) await this._client.setStreamMuted(muted); }

  // ---- Event mapping (Core Requirement #4) ----
  private _bindSessionEvents(onError?: (e: Error) => void): void {
    const GC = getGoogleCast();
    const sm = GC.getSessionManager();

    this._subs.push(
      GC.onCastStateChanged((state: string) => {
        const mapped = CastEngine.mapCastState(state);
        this._castState = mapped;
        this._onCastStateChange?.(mapped, this._connectedDevice);
      }),
      sm.onSessionStarted(async (session: any) => {
        this._session = session;
        this._client = session.client ?? session.getClient?.() ?? new (getGoogleCast().RemoteMediaClient ?? class {})();
        // Resolve actual RemoteMediaClient from native module if needed
        try {
          const dev = await session.getCastDevice();
          this._connectedDevice = dev ? CastEngine.mapDevice(dev) : null;
        } catch { this._connectedDevice = null; }
        this._castState = "connected";
        this._attachMediaListeners();
        this._onCastStateChange?.("connected", this._connectedDevice);
        if (this._connectedDevice) this._onSessionStart?.(this._connectedDevice);
      }),
      sm.onSessionEnded((_s: any, error?: string) => {
        const wasConnected = this._castState === "connected";
        this._detachMediaListeners();
        this._client = null; this._session = null; this._connectedDevice = null;
        this._castState = "not_connected";
        this._onCastStateChange?.("not_connected", null);
        this._onSessionEnd?.(wasConnected);
        if (error) onError?.(new Error(error));
      }),
      sm.onSessionStartFailed((_s: any, error: string) => {
        onError?.(new Error(error));
      }),
    );
  }

  private _mediaSubs: EmitterSub[] = [];

  private _attachMediaListeners(): void {
    if (!this._client) return;
    // MEDIA_STATUS_UPDATED -> stateChange / trackChange / queueEnd / error
    this._mediaSubs.push(
      this._client.onMediaStatusUpdated((status: any | null) => {
        if (!status) return;
        const ps = CastEngine.mapPlayerState(status.playerState);
        this.onPlayerState?.({
          playbackState: ps,
          position: status.streamPosition ?? 0,
          duration: status.mediaInfo?.streamDuration ?? status.streamPosition ?? 0,
          buffered: 0,
          error: ps === "error" ? { code: "CAST_ERROR", message: status.idleReason ?? "Cast error" } as any : null,
        });
        if (status.idleReason === "FINISHED") this.onQueueEnd?.();
        // trackChange derived from mediaInfo.contentId change is handled by AudioPlayer queue sync
      }),
    );
    // MEDIA_PROGRESS_UPDATED -> progress (1s interval)
    if (this._client.onMediaProgressUpdated) {
      this._mediaSubs.push(
        this._client.onMediaProgressUpdated(
          (position: number, duration: number) => {
            this.onProgress?.({ position, duration, buffered: 0 });
            // also keep PlayerState.position in sync
            this.onPlayerState?.({ position, duration });
          },
          1,
        ),
      );
    }
  }

  private _detachMediaListeners(): void {
    this._mediaSubs.forEach(s => s.remove());
    this._mediaSubs = [];
  }

  // ---- Unified event emitter passthrough (so hooks stay agnostic) ----
  on<K extends keyof PlayerEvents>(event: K, listener: (p: PlayerEvents[K]) => void): () => void {
    if (!this._externalListeners[event]) this._externalListeners[event] = new Set() as any;
    (this._externalListeners[event] as Set<any>).add(listener);
    return () => (this._externalListeners[event] as Set<any>)?.delete(listener);
  }

  destroy(): void {
    this._detachMediaListeners();
    this._subs.forEach(s => s.remove());
    this._subs = [];
  }

  // ---- Mappers ----
  static mapDevice(d: any): CastDevice {
    return {
      id: d.deviceId ?? d.id,
      name: d.friendlyName ?? d.name,
      modelName: d.modelName,
      ipAddress: d.ipAddress,
      capabilities: d.capabilities,
      isConnected: true,
    };
  }

  static mapCastState(s: string): CastState {
    switch (s) {
      case "connected": return "connected";
      case "connecting": return "connecting";
      case "noDevicesAvailable": return "no_devices_available";
      default: return "not_connected";
    }
  }

  static mapPlayerState(s: string | null | undefined): PlaybackState {
    switch (s) {
      case "PLAYING": return "playing";
      case "PAUSED": return "paused";
      case "BUFFERING": return "buffering";
      case "LOADING": return "loading";
      case "IDLE": return "idle";
      default: return "idle";
    }
  }
}
