"use strict";
/**
 * @module rn-audio-stream/AudioPlayer
 *
 * Core audio player class built on top of `react-native-sound-player`.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioPlayer = void 0;
exports.createAudioPlayer = createAudioPlayer;
const react_native_sound_player_1 = __importDefault(require("react-native-sound-player"));
const QueueManager_1 = require("./utils/QueueManager");
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
        this._listeners = {};
        this._soundSubscriptions = [];
        this._retryAttempts = 0;
        this._initialized = false;
        this._progressInterval = null;
        this._opts = { ...DEFAULT_OPTIONS, ...options };
        this._queue = new QueueManager_1.QueueManager(this._opts.shuffle);
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
    async init() {
        if (this._initialized)
            return;
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
        react_native_sound_player_1.default.setVolume(this._opts.volume);
        this._subscribeToSoundEvents();
        this._initialized = true;
    }
    async setQueue(tracks, startIndex = 0, autoPlay = false) {
        this._assertInitialized();
        this._queue.setQueue(tracks, startIndex);
        this._syncStateWithQueue();
        if (autoPlay) {
            await this.play();
        }
        else if (this._queue.current) {
            await this._loadCurrent(false);
        }
    }
    async addToQueue(tracks) {
        this._assertInitialized();
        this._queue.add(tracks);
        this._syncStateWithQueue();
    }
    async playNext(track) {
        this._assertInitialized();
        this._queue.insertNext(track);
        this._syncStateWithQueue();
    }
    async removeFromQueue(id) {
        this._assertInitialized();
        const wasCurrentId = this._queue.current?.id;
        const removed = this._queue.remove(id);
        if (!removed)
            return;
        if (wasCurrentId === id) {
            if (this._queue.current) {
                await this._loadCurrent(this._state.playbackState === "playing");
            }
            else {
                react_native_sound_player_1.default.stop();
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
            this._syncStateWithQueue();
        }
    }
    async clearQueue() {
        this._assertInitialized();
        react_native_sound_player_1.default.stop();
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
        if (!this._queue.current)
            return;
        if (this._state.playbackState === "paused") {
            try {
                react_native_sound_player_1.default.resume();
                this._retryAttempts = 0;
                this._updateState({ playbackState: "playing", error: null });
                this._startProgressPolling();
            }
            catch (e) {
                this._handlePlaybackError(e);
                throw e;
            }
            return;
        }
        await this._loadCurrent(true);
    }
    async pause() {
        this._assertInitialized();
        try {
            react_native_sound_player_1.default.pause();
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
            react_native_sound_player_1.default.stop();
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
        const nextTrack = this._queue.next(this._state.repeatMode);
        if (!nextTrack) {
            await this.stop();
            this._emit("queueEnd", undefined);
            return;
        }
        await this._loadCurrent(true);
    }
    async previous() {
        this._assertInitialized();
        if (this._state.repeatMode === "track" || this._state.position > 3) {
            await this.seek(0);
            return;
        }
        this._queue.previous(this._state.repeatMode);
        await this._loadCurrent(true);
    }
    async skipToIndex(index) {
        this._assertInitialized();
        this._queue.jumpTo(index);
        await this._loadCurrent(true);
    }
    async seek(position) {
        this._assertInitialized();
        if (this._state.currentTrack?.isLive)
            return;
        const clamped = Math.max(0, Math.min(position, this._state.duration || Infinity));
        try {
            react_native_sound_player_1.default.seek(clamped);
            this._updateState({ position: clamped });
        }
        catch (e) {
            this._handlePlaybackError(e);
            throw e;
        }
    }
    async setVolume(volume) {
        const clamped = Math.max(0, Math.min(1, volume));
        react_native_sound_player_1.default.setVolume(clamped);
        this._updateState({ volume: clamped });
    }
    async setRate(rate) {
        if (rate !== 1) {
            throw new Error("AudioPlayer: playback rate is not supported with react-native-sound-player.");
        }
        this._updateState({ rate: 1 });
    }
    async setRepeatMode(mode) {
        this._updateState({ repeatMode: mode });
    }
    async cycleRepeatMode() {
        const order = ["off", "track", "queue"];
        const current = order.indexOf(this._state.repeatMode);
        await this.setRepeatMode(order[(current + 1) % order.length]);
    }
    async setShuffle(enabled) {
        const currentId = this._queue.current?.id ?? null;
        this._queue.setShuffle(enabled);
        if (currentId) {
            const idx = this._queue.tracks.findIndex((t) => t.id === currentId);
            if (idx !== -1)
                this._queue.jumpTo(idx);
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
        react_native_sound_player_1.default.stop();
        this._queue.clear();
        this._listeners = {};
        this._initialized = false;
    }
    _subscribeToSoundEvents() {
        this._soundSubscriptions.push(react_native_sound_player_1.default.addEventListener("FinishedPlaying", ({ success }) => {
            if (!success)
                return;
            void this._handleTrackFinished();
        }), react_native_sound_player_1.default.addEventListener("OnSetupError", (e) => {
            this._handlePlaybackError({
                code: "SETUP_ERROR",
                message: "react-native-sound-player setup error.",
                cause: e,
            });
        }));
    }
    _startProgressPolling() {
        if (this._progressInterval)
            return;
        this._progressInterval = setInterval(async () => {
            try {
                if (this._state.playbackState !== "playing" && this._state.playbackState !== "paused") {
                    return;
                }
                const info = await react_native_sound_player_1.default.getInfo();
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
        const previous = this._state.currentTrack;
        try {
            if (autoPlay) {
                react_native_sound_player_1.default.playUrl(track.url);
                this._startProgressPolling();
            }
            else {
                react_native_sound_player_1.default.loadUrl(track.url);
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
        }
        catch (e) {
            this._handlePlaybackError(e);
            throw e;
        }
    }
    async _handleTrackFinished() {
        if (!this._queue.current)
            return;
        if (this._state.repeatMode === "track" && !this._state.currentTrack?.isLive) {
            await this._loadCurrent(true);
            return;
        }
        const next = this._queue.next(this._state.repeatMode);
        if (!next) {
            this._stopProgressPolling();
            this._updateState({ playbackState: "ended", position: 0 });
            this._emit("queueEnd", undefined);
            return;
        }
        await this._loadCurrent(true);
    }
    _handlePlaybackError(errorLike) {
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
    _toPlayerError(errorLike) {
        if (errorLike && typeof errorLike === "object" && "code" in errorLike && "message" in errorLike) {
            const asErr = errorLike;
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
}
exports.AudioPlayer = AudioPlayer;
async function createAudioPlayer(options) {
    const player = new AudioPlayer(options);
    await player.init();
    return player;
}
//# sourceMappingURL=AudioPlayer.js.map