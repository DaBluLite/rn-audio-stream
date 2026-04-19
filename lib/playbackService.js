"use strict";
/**
 * @file playbackService.ts
 *
 * React Native Track Player requires a "playback service" — a module registered
 * once at app start that keeps the native audio session alive when the app is
 * in the background.
 *
 * **You must create this file in your own app** and register it before creating
 * any `AudioPlayer` instances.
 *
 * ## Setup
 *
 * 1. Copy this file into your project, e.g. `src/playbackService.ts`.
 * 2. In your `index.js` (or `App.tsx` entry point) call:
 *
 * ```ts
 * import TrackPlayer from "react-native-track-player";
 * TrackPlayer.registerPlaybackService(() => require("./playbackService"));
 * ```
 *
 * That's it — `rn-audio-stream` will handle the rest.
 *
 * ## Why is this a separate file?
 *
 * RNTP requires the service module to be `require()`-able *before* the React
 * tree mounts, so it cannot live inside a component or hook. The module runs
 * in a headless JS task on Android when the app is backgrounded.
 *
 * ## Customisation
 *
 * If you pass `onRemoteControl` to `AudioPlayerOptions` you are already
 * handling remote events in your own code — you don't need to modify this
 * file. This service's job is only to keep the event loop alive.
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
const react_native_track_player_1 = __importStar(require("react-native-track-player"));
module.exports = async function () {
    // Keep the service alive. Individual event handling is done inside
    // AudioPlayer._subscribeToRNTPEvents().
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePause, () => react_native_track_player_1.default.pause());
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePlay, () => react_native_track_player_1.default.play());
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteStop, () => react_native_track_player_1.default.stop());
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteNext, () => react_native_track_player_1.default.skipToNext());
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePrevious, () => react_native_track_player_1.default.skipToPrevious());
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteSeek, (e) => react_native_track_player_1.default.seekTo(e.position));
    // Handle audio focus loss (phone call, other app, etc.)
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteDuck, async (e) => {
        if (e.permanent) {
            await react_native_track_player_1.default.stop();
        }
        else if (e.paused) {
            await react_native_track_player_1.default.pause();
        }
        else {
            await react_native_track_player_1.default.play();
        }
    });
};
//# sourceMappingURL=playbackService.js.map