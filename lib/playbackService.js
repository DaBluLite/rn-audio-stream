"use strict";
/**
 * @file playbackService.ts
 *
 * Headless playback service for `react-native-track-player`.
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
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePlay, () => {
        void react_native_track_player_1.default.play();
    });
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePause, () => {
        void react_native_track_player_1.default.pause();
    });
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteStop, () => {
        void react_native_track_player_1.default.stop();
    });
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteSeek, ({ position }) => {
        void react_native_track_player_1.default.seekTo(position);
    });
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemoteNext, () => {
        void react_native_track_player_1.default.skipToNext().catch((error) => {
            console.warn("[playbackService] Remote next failed:", error);
        });
    });
    react_native_track_player_1.default.addEventListener(react_native_track_player_1.Event.RemotePrevious, () => {
        void react_native_track_player_1.default.skipToPrevious().catch((error) => {
            console.warn("[playbackService] Remote previous failed:", error);
        });
    });
};
//# sourceMappingURL=playbackService.js.map