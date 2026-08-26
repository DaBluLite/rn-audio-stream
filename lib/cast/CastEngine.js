"use strict";
/**
 * @module rn-audio-stream/cast/CastEngine
 *
 * Secondary playback engine that routes commands to Google Cast
 * RemoteMediaClient when a Cast session is active.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CastEngine = void 0;
// Lazy require so jest / non-RN env doesn't crash if native module missing
function getGoogleCast() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-google-cast");
    return mod.default ?? mod.CastContext ?? mod;
}
function buildCastUrl(track, headers) {
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
    }
    catch {
        return track.url;
    }
}
function trackToMediaInfo(track, headers) {
    const contentUrl = buildCastUrl(track, headers);
    const isLive = !!track.isLive;
    // Infer contentType from URL extension fallback to audio/mpeg
    const ext = contentUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    const mimeMap = {
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
            type: "musicTrack",
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
class CastEngine {
    constructor(opts = {}) {
        this._castState = "not_connected";
        this._connectedDevice = null;
        this._client = null;
        this._session = null;
        this._subs = [];
        this._externalListeners = {};
        this._mediaSubs = [];
        this._headers = opts.headers ?? {};
        this._onCastStateChange = opts.onCastStateChange;
        this._onSessionStart = opts.onSessionStart;
        this._onSessionEnd = opts.onSessionEnd;
        this._bindSessionEvents(opts.onSessionError);
    }
    // ---- Discovery & Session Management (Core Requirement #2) ----
    async startDiscovery() {
        const GC = getGoogleCast();
        await GC.getDiscoveryManager().startDiscovery();
    }
    async stopDiscovery() {
        const GC = getGoogleCast();
        await GC.getDiscoveryManager().stopDiscovery();
    }
    async getDevices() {
        const GC = getGoogleCast();
        const devices = await GC.getDiscoveryManager().getDevices();
        return devices.map(CastEngine.mapDevice);
    }
    onDevicesUpdated(listener) {
        const GC = getGoogleCast();
        return GC.getDiscoveryManager().onDevicesUpdated((devices) => listener(devices.map(CastEngine.mapDevice)));
    }
    async startSession(deviceId) {
        const GC = getGoogleCast();
        return GC.getSessionManager().startSession(deviceId);
    }
    async endSession(stopCasting = false) {
        const GC = getGoogleCast();
        await GC.getSessionManager().endCurrentSession(stopCasting);
    }
    get castState() { return this._castState; }
    get connectedDevice() { return this._connectedDevice; }
    get isCasting() { return this._castState === "connected" && !!this._client; }
    get client() { return this._client; }
    // ---- PlaybackEngine (routes to RemoteMediaClient) ----
    async load(track, position = 0, autoPlay = true) {
        if (!this._client)
            throw new Error("CastEngine: no active RemoteMediaClient");
        const mediaInfo = trackToMediaInfo(track, this._headers);
        await this._client.loadMedia({
            mediaInfo,
            autoplay: autoPlay,
            startTime: position,
            playbackRate: 1,
        });
    }
    /** Load full queue via queueData — preferred for gapless queue on receiver */
    async loadQueue(tracks, startIndex, position = 0) {
        if (!this._client)
            throw new Error("CastEngine: no active RemoteMediaClient");
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
    async play() { if (this._client)
        await this._client.play(); }
    async pause() { if (this._client)
        await this._client.pause(); }
    async stop() { if (this._client)
        await this._client.stop(); }
    async seek(position) { if (this._client)
        await this._client.seek({ position }); }
    async setVolume(volume) { if (this._client)
        await this._client.setStreamVolume(volume); }
    async setMuted(muted) { if (this._client)
        await this._client.setStreamMuted(muted); }
    // ---- Event mapping (Core Requirement #4) ----
    _bindSessionEvents(onError) {
        const GC = getGoogleCast();
        const sm = GC.getSessionManager();
        this._subs.push(GC.onCastStateChanged((state) => {
            const mapped = CastEngine.mapCastState(state);
            this._castState = mapped;
            this._onCastStateChange?.(mapped, this._connectedDevice);
        }), sm.onSessionStarted(async (session) => {
            this._session = session;
            this._client = session.client ?? session.getClient?.() ?? new (getGoogleCast().RemoteMediaClient ?? class {
            })();
            // Resolve actual RemoteMediaClient from native module if needed
            try {
                const dev = await session.getCastDevice();
                this._connectedDevice = dev ? CastEngine.mapDevice(dev) : null;
            }
            catch {
                this._connectedDevice = null;
            }
            this._castState = "connected";
            this._attachMediaListeners();
            this._onCastStateChange?.("connected", this._connectedDevice);
            if (this._connectedDevice)
                this._onSessionStart?.(this._connectedDevice);
        }), sm.onSessionEnded((_s, error) => {
            const wasConnected = this._castState === "connected";
            this._detachMediaListeners();
            this._client = null;
            this._session = null;
            this._connectedDevice = null;
            this._castState = "not_connected";
            this._onCastStateChange?.("not_connected", null);
            this._onSessionEnd?.(wasConnected);
            if (error)
                onError?.(new Error(error));
        }), sm.onSessionStartFailed((_s, error) => {
            onError?.(new Error(error));
        }));
    }
    _attachMediaListeners() {
        if (!this._client)
            return;
        // MEDIA_STATUS_UPDATED -> stateChange / trackChange / queueEnd / error
        this._mediaSubs.push(this._client.onMediaStatusUpdated((status) => {
            if (!status)
                return;
            const ps = CastEngine.mapPlayerState(status.playerState);
            this.onPlayerState?.({
                playbackState: ps,
                position: status.streamPosition ?? 0,
                duration: status.mediaInfo?.streamDuration ?? status.streamPosition ?? 0,
                buffered: 0,
                error: ps === "error" ? { code: "CAST_ERROR", message: status.idleReason ?? "Cast error" } : null,
            });
            if (status.idleReason === "FINISHED")
                this.onQueueEnd?.();
            // trackChange derived from mediaInfo.contentId change is handled by AudioPlayer queue sync
        }));
        // MEDIA_PROGRESS_UPDATED -> progress (1s interval)
        if (this._client.onMediaProgressUpdated) {
            this._mediaSubs.push(this._client.onMediaProgressUpdated((position, duration) => {
                this.onProgress?.({ position, duration, buffered: 0 });
                // also keep PlayerState.position in sync
                this.onPlayerState?.({ position, duration });
            }, 1));
        }
    }
    _detachMediaListeners() {
        this._mediaSubs.forEach(s => s.remove());
        this._mediaSubs = [];
    }
    // ---- Unified event emitter passthrough (so hooks stay agnostic) ----
    on(event, listener) {
        if (!this._externalListeners[event])
            this._externalListeners[event] = new Set();
        this._externalListeners[event].add(listener);
        return () => this._externalListeners[event]?.delete(listener);
    }
    destroy() {
        this._detachMediaListeners();
        this._subs.forEach(s => s.remove());
        this._subs = [];
    }
    // ---- Mappers ----
    static mapDevice(d) {
        return {
            id: d.deviceId ?? d.id,
            name: d.friendlyName ?? d.name,
            modelName: d.modelName,
            ipAddress: d.ipAddress,
            capabilities: d.capabilities,
            isConnected: true,
        };
    }
    static mapCastState(s) {
        switch (s) {
            case "connected": return "connected";
            case "connecting": return "connecting";
            case "noDevicesAvailable": return "no_devices_available";
            default: return "not_connected";
        }
    }
    static mapPlayerState(s) {
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
exports.CastEngine = CastEngine;
//# sourceMappingURL=CastEngine.js.map