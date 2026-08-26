"use strict";
/**
 * rn-audio-stream
 *
 * A well-typed React Native audio player module that supports:
 *  - HTTP/HTTPS audio streaming (MP3, AAC, FLAC, OGG, HLS, etc.)
 *  - Navidrome / OpenSubsonic API compatibility
 *  - Live / internet-radio streams
 *  - Gapless playback
 *  - Shuffle (Fisher-Yates, preserves current track)
 *  - Repeat modes: off / track / queue
 *  - Automatic retry on stream failure
 *  - Typed React hooks for easy UI integration
 *
 * @packageDocumentation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CastEngine = exports.useNowPlaying = exports.usePlaybackState = exports.useRepeatShuffle = exports.usePlaybackControls = exports.useQueue = exports.useProgress = exports.useAudioPlayer = exports.createAudioPlayer = exports.AudioPlayer = void 0;
// ── Core class & factory ──────────────────────────────────────────────────────
var AudioPlayer_1 = require("./AudioPlayer");
Object.defineProperty(exports, "AudioPlayer", { enumerable: true, get: function () { return AudioPlayer_1.AudioPlayer; } });
Object.defineProperty(exports, "createAudioPlayer", { enumerable: true, get: function () { return AudioPlayer_1.createAudioPlayer; } });
// ── React hooks ───────────────────────────────────────────────────────────────
var hooks_1 = require("./hooks");
Object.defineProperty(exports, "useAudioPlayer", { enumerable: true, get: function () { return hooks_1.useAudioPlayer; } });
Object.defineProperty(exports, "useProgress", { enumerable: true, get: function () { return hooks_1.useProgress; } });
Object.defineProperty(exports, "useQueue", { enumerable: true, get: function () { return hooks_1.useQueue; } });
Object.defineProperty(exports, "usePlaybackControls", { enumerable: true, get: function () { return hooks_1.usePlaybackControls; } });
Object.defineProperty(exports, "useRepeatShuffle", { enumerable: true, get: function () { return hooks_1.useRepeatShuffle; } });
Object.defineProperty(exports, "usePlaybackState", { enumerable: true, get: function () { return hooks_1.usePlaybackState; } });
Object.defineProperty(exports, "useNowPlaying", { enumerable: true, get: function () { return hooks_1.useNowPlaying; } });
var CastEngine_1 = require("./cast/CastEngine");
Object.defineProperty(exports, "CastEngine", { enumerable: true, get: function () { return CastEngine_1.CastEngine; } });
//# sourceMappingURL=index.js.map