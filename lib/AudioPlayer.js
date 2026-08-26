"use strict";
/**
 * @module rn-audio-stream/AudioPlayer
 *
 * Core audio player class built on top of `react-native-track-player`.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioPlayer = void 0;
exports.createAudioPlayer = createAudioPlayer;
const react_native_track_player_1 = __importStar(require("react-native-track-player"));
const QueueManager_1 = require("./utils/QueueManager");
const CastEngine_1 = require("./cast/CastEngine");
const cache_1 = require("./cache");
const DEFAULT_OPTIONS = {
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
    onRemoteControl: () => { },
};
class AudioPlayer {
    constructor(options = {}) {
        this._cacheMgr = null;
        this._listeners = {};
        this._soundSubscriptions = [];
        this._retryAttempts = 0;
        this._initialized = false;
        this._progressInterval = null;
        this._isReplacingQueue = false;
        // Cast engine (secondary playback engine)
        this._castEngine = null;
        this._useCast = false;
        this._castOpts = null;
        this._opts = { ...DEFAULT_OPTIONS, ...options };
        this._queue = new QueueManager_1.QueueManager(this._opts.shuffle);
        this._streamUrlProvider = options.streamUrlProvider;
        const cOpts = options.cache;
        if (cOpts?.enabled !== false) {
            this._cacheMgr = new cache_1.CacheManager(cOpts ?? {});
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
    enableCast(opts = {}) {
        this._castOpts = opts;
        if (this._castEngine)
            this._castEngine.destroy();
        this._castEngine = new CastEngine_1.CastEngine({
            headers: opts.headers ?? this._opts.headers,
            onCastStateChange: (s, d) => { opts.onCastStateChange?.(s, d); this._onCastStateChange(s, d); },
            onSessionStart: opts.onCastSessionStart,
            onSessionEnd: opts.onCastSessionEnd,
            onSessionError: opts.onCastSessionError,
        });
        // Bridge Cast media updates -> unified PlayerState/progress events
        this._castEngine.onPlayerState = (patch) => this._updateState(patch);
        this._castEngine.onProgress = (p) => {
            this._updateState(p);
            this._emit("progress", p);
        };
        this._castEngine.onQueueEnd = () => this._emit("queueEnd", undefined);
        this._castEngine.onError = (e) => {
            const err = { code: e.code, message: e.message, track: this._queue.current ?? undefined };
            this._updateState({ playbackState: "error", error: err });
            this._emit("error", err);
        };
        return this._castEngine;
    }
    get castEngine() { return this._castEngine; }
    get isCasting() { return this._useCast; }
    get castState() { return this._castEngine?.castState ?? null; }
    // ---- Cast discovery / session passthrough (Requirement #2) ----
    async castStartDiscovery() { if (!this._castEngine)
        throw new Error("Call enableCast() first"); await this._castEngine.startDiscovery(); }
    async castStopDiscovery() { await this._castEngine?.stopDiscovery(); }
    async castGetDevices() { if (!this._castEngine)
        throw new Error("Call enableCast() first"); return this._castEngine.getDevices(); }
    castOnDevicesUpdated(cb) { if (!this._castEngine)
        throw new Error("Call enableCast() first"); return this._castEngine.onDevicesUpdated(cb); }
    async castStartSession(deviceId) { if (!this._castEngine)
        throw new Error("Call enableCast() first"); return this._castEngine.startSession(deviceId); }
    async castEndSession(stopCasting = false) { await this._castEngine?.endSession(stopCasting); }
    async _onCastStateChange(state, device) {
        if (state === "connected" && device) {
            // Handoff: pause local, transfer current track+position to Cast (Requirement #1 & #2)
            await this._handoffToCast();
        }
        else if (state === "not_connected" && this._useCast) {
            await this._handoffToLocal();
        }
    }
    async _handoffToCast() {
        const track = this._queue.current;
        const pos = this._state.position;
        try {
            await react_native_track_player_1.default.pause();
        }
        catch { }
        this._stopProgressPolling();
        this._useCast = true;
        if (track && this._castEngine) {
            // Use queue load so receiver has full queue for next/prev
            if (this._queue.tracks.length > 1) {
                await this._castEngine.loadQueue(this._queue.tracks, this._queue.currentIndex, pos).catch(() => this._castEngine.load(track, pos, true));
            }
            else {
                await this._castEngine.load(track, pos, true);
            }
        }
        this._updateState({ playbackState: "buffering" });
    }
    async _handoffToLocal() {
        this._useCast = false;
        const track = this._queue.current;
        if (track) {
            // Restore local queue at same index, seek to last known Cast position
            const pos = this._state.position;
            await this._replaceNativeQueue(this._queue.currentIndex).catch(() => { });
            if (pos > 0)
                await react_native_track_player_1.default.seekTo(pos).catch(() => { });
        }
        this._updateState({ playbackState: "paused" });
    }
    get cache() {
        const m = this._cacheMgr;
        if (!m)
            return undefined;
        return {
            getCachedUrl: (id) => m.getCachedUrl(id),
            prefetch: (ids) => m.prefetchIds(ids, (id) => this._streamUrlProvider?.(id) ?? this._queue.tracks.find(t => t.id === id)?.url ?? ""),
            clear: () => m.clear(),
            getStats: () => m.getStats(),
            getCacheHealthReport: () => m.getCacheHealthReport(),
            removeTrack: (id) => m.removeTrack(id),
        };
    }
    _resolveTrackUrl(track) {
        const cached = this._cacheMgr?.getCachedUrlSync(track.id);
        if (cached)
            return cached;
        if (track.url)
            return track.url;
        if (this._streamUrlProvider)
            return this._streamUrlProvider(track.id);
        return track.url;
    }
    _maybePrefetchAround(index) {
        if (!this._cacheMgr)
            return;
        const ids = this._queue.tracks.slice(index, index + 1 + this._cacheMgr.prefetch.prefetchCount).map(t => t.id);
        // current + next N, fire-and-forget
        for (const t of this._queue.tracks.slice(index, index + 1 + this._cacheMgr.prefetch.prefetchCount)) {
            const url = t.url || this._streamUrlProvider?.(t.id) || "";
            if (url)
                void this._cacheMgr.streamAndCacheChunked(t.id, url);
        }
    }
    async init(icon) {
        if (this._initialized)
            return;
        await this._cacheMgr?.init();
        try {
            await react_native_track_player_1.default.setupPlayer({
                autoHandleInterruptions: true,
            });
            icon && await react_native_track_player_1.default.updateOptions({
                icon,
            });
        }
        catch (e) {
            if (!this._isAlreadySetupError(e)) {
                throw e;
            }
        }
        await react_native_track_player_1.default.updateOptions({
            capabilities: [
                react_native_track_player_1.Capability.Play,
                react_native_track_player_1.Capability.Pause,
                react_native_track_player_1.Capability.Stop,
                react_native_track_player_1.Capability.SeekTo,
                react_native_track_player_1.Capability.SkipToNext,
                react_native_track_player_1.Capability.SkipToPrevious,
            ],
            compactCapabilities: [
                react_native_track_player_1.Capability.Play,
                react_native_track_player_1.Capability.Pause,
                react_native_track_player_1.Capability.SkipToNext,
                react_native_track_player_1.Capability.SkipToPrevious,
            ],
            notificationCapabilities: [
                react_native_track_player_1.Capability.Play,
                react_native_track_player_1.Capability.Pause,
                react_native_track_player_1.Capability.Stop,
                react_native_track_player_1.Capability.SeekTo,
                react_native_track_player_1.Capability.SkipToNext,
                react_native_track_player_1.Capability.SkipToPrevious,
            ],
            progressUpdateEventInterval: 1,
            android: {
                appKilledPlaybackBehavior: react_native_track_player_1.AppKilledPlaybackBehavior.ContinuePlayback,
            },
        });
        await react_native_track_player_1.default.setVolume(this._opts.volume);
        await react_native_track_player_1.default.setRate(this._opts.rate);
        await react_native_track_player_1.default.setRepeatMode(this._toNativeRepeatMode(this._opts.repeatMode));
        this._subscribeToSoundEvents();
        this._initialized = true;
    }
    async setQueue(tracks, startIndex = 0, autoPlay = false) {
        this._assertInitialized();
        // offline: filter to cached only
        let effective = tracks;
        if (this._cacheMgr?.isOffline) {
            effective = tracks.filter(t => !!this._cacheMgr.getCachedUrlSync(t.id));
            if (effective.length === 0)
                throw new Error("Offline: no cached tracks");
            startIndex = Math.min(startIndex, effective.length - 1);
        }
        this._queue.setQueue(effective, startIndex);
        this._syncStateWithQueue();
        if (this._queue.current) {
            await this._loadCurrent(autoPlay);
        }
        this._maybePrefetchAround(this._queue.currentIndex);
    }
    async addToQueue(tracks) {
        this._assertInitialized();
        this._queue.add(tracks);
        await react_native_track_player_1.default.add(tracks.map((track) => this._toNativeTrack({ ...track, url: this._resolveTrackUrl(track) })));
        this._syncStateWithQueue();
        // prefetch added tracks
        for (const t of tracks) {
            const u = t.url || this._streamUrlProvider?.(t.id) || "";
            if (u)
                void this._cacheMgr?.streamAndCacheChunked(t.id, u);
        }
    }
    async playNext(track) {
        this._assertInitialized();
        const insertAt = this._queue.currentIndex + 1;
        this._queue.insertNext(track);
        await react_native_track_player_1.default.add(this._toNativeTrack(track), insertAt);
        this._syncStateWithQueue();
    }
    async removeFromQueue(id) {
        this._assertInitialized();
        const removeIndex = this._queue.tracks.findIndex((track) => track.id === id);
        if (removeIndex === -1)
            return;
        const wasCurrentId = this._queue.current?.id;
        const removed = this._queue.remove(id);
        if (!removed)
            return;
        if (wasCurrentId === id) {
            if (this._queue.current) {
                await react_native_track_player_1.default.remove(removeIndex);
            }
            else {
                await react_native_track_player_1.default.reset();
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
        }
        else {
            await react_native_track_player_1.default.remove(removeIndex);
            this._syncStateWithQueue();
        }
    }
    async clearQueue() {
        this._assertInitialized();
        await react_native_track_player_1.default.reset();
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
    async play() {
        this._assertInitialized();
        if (this._useCast && this._castEngine?.isCasting)
            return this._castEngine.play();
        if (!this._queue.current)
            return;
        await react_native_track_player_1.default.play();
        this._retryAttempts = 0;
        this._updateState({ playbackState: "playing", error: null });
        this._startProgressPolling();
    }
    async pause() {
        this._assertInitialized();
        if (this._useCast && this._castEngine?.isCasting) {
            await this._castEngine.pause();
            this._updateState({ playbackState: "paused" });
            return;
        }
        try {
            await react_native_track_player_1.default.pause();
            this._updateState({ playbackState: "paused" });
            this._stopProgressPolling();
        }
        catch (e) {
            this._handlePlaybackError(e);
            throw e;
        }
    }
    async togglePlayPause() {
        if (this._state.playbackState === "playing") {
            await this.pause();
        }
        else {
            await this.play();
        }
    }
    async stop() {
        this._assertInitialized();
        try {
            await react_native_track_player_1.default.stop();
            this._stopProgressPolling();
            this._updateState({ playbackState: "stopped", position: 0, buffered: 0 });
        }
        catch (e) {
            this._handlePlaybackError(e);
            throw e;
        }
    }
    async next() {
        this._assertInitialized();
        if (this._state.repeatMode === "track") {
            await this.seek(0);
            return;
        }
        try {
            await react_native_track_player_1.default.skipToNext();
            await react_native_track_player_1.default.play();
        }
        catch (e) {
            if (this._state.repeatMode === "off") {
                this._updateState({ playbackState: "ended", position: 0 });
                this._emit("queueEnd", undefined);
                return;
            }
            this._handlePlaybackError(e);
            throw e;
        }
    }
    async previous() {
        this._assertInitialized();
        if (this._state.repeatMode === "track" || this._state.position > 3) {
            await this.seek(0);
            return;
        }
        try {
            await react_native_track_player_1.default.skipToPrevious();
            await react_native_track_player_1.default.play();
        }
        catch (e) {
            await this.seek(0);
        }
    }
    async skipToIndex(index) {
        this._assertInitialized();
        this._queue.jumpTo(index);
        await react_native_track_player_1.default.skip(index);
        await react_native_track_player_1.default.play();
    }
    async seek(position) {
        this._assertInitialized();
        if (this._state.currentTrack?.isLive)
            return;
        const clamped = Math.max(0, Math.min(position, this._state.duration || Infinity));
        if (this._useCast && this._castEngine?.isCasting) {
            await this._castEngine.seek(clamped);
            this._updateState({ position: clamped });
            return;
        }
        try {
            await react_native_track_player_1.default.seekTo(clamped);
            this._updateState({ position: clamped });
        }
        catch (e) {
            this._handlePlaybackError(e);
            throw e;
        }
    }
    async setVolume(volume) {
        const clamped = Math.max(0, Math.min(1, volume));
        if (this._useCast && this._castEngine?.isCasting)
            await this._castEngine.setVolume(clamped).catch(() => { });
        await react_native_track_player_1.default.setVolume(clamped);
        this._updateState({ volume: clamped });
    }
    async setRate(rate) {
        const clamped = Math.max(0.25, Math.min(4, rate));
        await react_native_track_player_1.default.setRate(clamped);
        this._updateState({ rate: clamped });
    }
    async setRepeatMode(mode) {
        await react_native_track_player_1.default.setRepeatMode(this._toNativeRepeatMode(mode));
        this._updateState({ repeatMode: mode });
    }
    async cycleRepeatMode() {
        const order = ["off", "track", "queue"];
        const current = order.indexOf(this._state.repeatMode);
        await this.setRepeatMode(order[(current + 1) % order.length]);
    }
    async setShuffle(enabled) {
        const wasPlaying = this._state.playbackState === "playing";
        const currentId = this._queue.current?.id ?? null;
        this._queue.setShuffle(enabled);
        if (currentId) {
            const idx = this._queue.tracks.findIndex((t) => t.id === currentId);
            if (idx !== -1)
                this._queue.jumpTo(idx);
        }
        await this._replaceNativeQueue(this._queue.currentIndex);
        if (wasPlaying) {
            await react_native_track_player_1.default.play();
        }
        this._updateState({
            shuffle: this._queue.shuffle,
            queue: this._queue.tracks,
            currentTrack: this._queue.current,
            currentIndex: this._queue.currentIndex,
        });
    }
    get state() {
        return this._state;
    }
    on(event, listener) {
        if (!this._listeners[event]) {
            this._listeners[event] = new Set();
        }
        this._listeners[event].add(listener);
        return () => {
            this._listeners[event]?.delete(listener);
        };
    }
    once(event, listener) {
        const off = this.on(event, (payload) => {
            off();
            listener(payload);
        });
        return off;
    }
    async destroy() {
        this._stopProgressPolling();
        for (const sub of this._soundSubscriptions)
            sub.remove();
        this._soundSubscriptions = [];
        this._castEngine?.destroy();
        this._castEngine = null;
        this._useCast = false;
        await react_native_track_player_1.default.stop();
        this._queue.clear();
        this._listeners = {};
        this._initialized = false;
    }
    _subscribeToSoundEvents() {
        this._soundSubscriptions.push(react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.PlaybackActiveTrackChanged, (event) => {
            if (this._isReplacingQueue)
                return;
            if (typeof event.index === "number") {
                try {
                    this._queue.jumpTo(event.index);
                }
                catch (e) {
                    console.warn("[AudioPlayer] Received out-of-range active track index:", event.index, e);
                }
            }
            const previous = this._state.currentTrack;
            const current = typeof event.index === "number"
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
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.PlaybackState, (event) => {
            const playbackState = this._mapNativeState(event.state);
            this._updateState({ playbackState });
            if (playbackState === "playing" || playbackState === "paused") {
                this._startProgressPolling();
            }
            else {
                this._stopProgressPolling();
            }
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.PlaybackQueueEnded, ({ position }) => {
            this._stopProgressPolling();
            this._updateState({ playbackState: "ended", position });
            this._emit("queueEnd", undefined);
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.PlaybackError, (event) => {
            this._handlePlaybackError(event);
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePlay, () => {
            this._opts.onRemoteControl({ type: "play" });
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePause, () => {
            this._opts.onRemoteControl({ type: "pause" });
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteStop, () => {
            this._opts.onRemoteControl({ type: "stop" });
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteNext, () => {
            this._opts.onRemoteControl({ type: "next" });
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePrevious, () => {
            this._opts.onRemoteControl({ type: "previous" });
        }), react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteSeek, ({ position }) => {
            this._opts.onRemoteControl({ type: "seek", position });
        }));
    }
    _startProgressPolling() {
        if (this._progressInterval)
            return;
        this._progressInterval = setInterval(async () => {
            try {
                if (this._state.playbackState !== "playing" &&
                    this._state.playbackState !== "paused") {
                    return;
                }
                const info = await react_native_track_player_1.default.getProgress();
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
            }
            catch (e) {
                console.warn("[AudioPlayer] Failed to read playback info:", e);
            }
        }, 1000);
    }
    _stopProgressPolling() {
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = null;
        }
    }
    _syncStateWithQueue() {
        this._updateState({
            queue: this._queue.tracks,
            currentTrack: this._queue.current,
            currentIndex: this._queue.currentIndex,
        });
    }
    async _loadCurrent(autoPlay) {
        const track = this._queue.current;
        if (!track)
            return;
        const targetIndex = this._queue.currentIndex;
        const previous = this._state.currentTrack;
        try {
            await this._replaceNativeQueue(targetIndex);
            if (autoPlay)
                await react_native_track_player_1.default.play();
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
        }
        catch (e) {
            this._handlePlaybackError(e);
            throw e;
        }
    }
    _handlePlaybackError(errorLike) {
        const err = this._toPlayerError(errorLike);
        if (this._retryAttempts < this._opts.retryCount && this._queue.current) {
            this._retryAttempts++;
            setTimeout(() => {
                void react_native_track_player_1.default.retry().catch((retryError) => {
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
    _toPlayerError(errorLike) {
        if (errorLike &&
            typeof errorLike === "object" &&
            "code" in errorLike &&
            "message" in errorLike) {
            const asErr = errorLike;
            return {
                code: typeof asErr.code === "string" ? asErr.code : "PLAYBACK_ERROR",
                message: typeof asErr.message === "string"
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
    _updateState(patch) {
        this._state = { ...this._state, ...patch };
        this._emitStateChange();
    }
    _emitStateChange() {
        this._emit("stateChange", this._state);
    }
    _emit(event, payload) {
        const set = this._listeners[event];
        if (!set)
            return;
        for (const listener of set) {
            try {
                listener(payload);
            }
            catch (e) {
                console.warn("[AudioPlayer] Event listener threw:", e);
            }
        }
    }
    _assertInitialized() {
        if (!this._initialized) {
            throw new Error("AudioPlayer: call `await player.init()` before using the player.");
        }
    }
    async _getActiveTrackId() {
        try {
            const index = await react_native_track_player_1.default.getActiveTrackIndex();
            if (index == null || index < 0)
                return null;
            const queue = await react_native_track_player_1.default.getQueue();
            const track = queue[index];
            return track ? String(track.id) : null;
        }
        catch (e) {
            return null;
        }
    }
    async _replaceNativeQueue(targetIndex) {
        const nativeQueue = this._queue.tracks.map((track) => this._toNativeTrack(track));
        this._isReplacingQueue = true;
        try {
            await react_native_track_player_1.default.setPlayWhenReady(false);
            if (nativeQueue.length === 0) {
                await react_native_track_player_1.default.reset();
                return;
            }
            const newCurrentId = this._queue.current?.id;
            const keepCurrent = newCurrentId != null &&
                (await this._getActiveTrackId()) === newCurrentId;
            if (keepCurrent && targetIndex >= 0 && targetIndex < nativeQueue.length) {
                const existing = await react_native_track_player_1.default.getQueue();
                const activeIndex = await react_native_track_player_1.default.getActiveTrackIndex();
                if (activeIndex != null &&
                    activeIndex >= 0 &&
                    activeIndex < existing.length) {
                    const toRemove = existing
                        .map((_, i) => i)
                        .filter((i) => i !== activeIndex)
                        .sort((a, b) => b - a);
                    if (toRemove.length > 0) {
                        await react_native_track_player_1.default.remove(toRemove);
                    }
                    const before = nativeQueue.slice(0, targetIndex);
                    const after = nativeQueue.slice(targetIndex + 1);
                    if (before.length > 0) {
                        await react_native_track_player_1.default.add(before, 0);
                    }
                    if (after.length > 0) {
                        await react_native_track_player_1.default.add(after);
                    }
                    await react_native_track_player_1.default.setRepeatMode(this._toNativeRepeatMode(this._state.repeatMode));
                    return;
                }
            }
            await react_native_track_player_1.default.setQueue(nativeQueue);
            if (targetIndex >= 0) {
                await react_native_track_player_1.default.skip(targetIndex);
            }
            await react_native_track_player_1.default.setRepeatMode(this._toNativeRepeatMode(this._state.repeatMode));
        }
        finally {
            this._isReplacingQueue = false;
        }
    }
    _toNativeTrack(track) {
        const headers = Object.keys(this._opts.headers).length > 0
            ? this._opts.headers
            : undefined;
        const artwork = typeof track.artwork === "string" ? track.artwork : undefined;
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
    _toNativeRepeatMode(mode) {
        switch (mode) {
            case "track":
                return react_native_track_player_1.RepeatMode.Track;
            case "queue":
                return react_native_track_player_1.RepeatMode.Queue;
            case "off":
            default:
                return react_native_track_player_1.RepeatMode.Off;
        }
    }
    _mapNativeState(state) {
        switch (state) {
            case react_native_track_player_1.State.Loading:
                return "loading";
            case react_native_track_player_1.State.Buffering:
                return "buffering";
            case react_native_track_player_1.State.Playing:
                return "playing";
            case react_native_track_player_1.State.Paused:
                return "paused";
            case react_native_track_player_1.State.Stopped:
            case react_native_track_player_1.State.Ready:
                return "stopped";
            case react_native_track_player_1.State.Ended:
                return "ended";
            case react_native_track_player_1.State.Error:
                return "error";
            case react_native_track_player_1.State.None:
            default:
                return "idle";
        }
    }
    _isAlreadySetupError(errorLike) {
        if (!errorLike || typeof errorLike !== "object")
            return false;
        const maybeError = errorLike;
        const code = typeof maybeError.code === "string" ? maybeError.code : "";
        const message = typeof maybeError.message === "string" ? maybeError.message : "";
        return (code === "player_already_initialized" ||
            message.toLowerCase().includes("already initialized"));
    }
}
exports.AudioPlayer = AudioPlayer;
async function createAudioPlayer(options, icon) {
    const player = new AudioPlayer(options);
    await player.init(icon);
    return player;
}
//# sourceMappingURL=AudioPlayer.js.map