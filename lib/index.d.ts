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
export { AudioPlayer, createAudioPlayer } from "./AudioPlayer";
export { useAudioPlayer, useProgress, useQueue, usePlaybackControls, useRepeatShuffle, usePlaybackState, useNowPlaying, } from "./hooks";
export { CastEngine } from "./cast/CastEngine";
export type { CastDevice, CastState, AudioPlayerOptionsWithCast } from "./types/cast";
export type { Track, PlayerState, PlaybackState, RepeatMode, PlayerError, PlayerEvents, AudioPlayerOptions, RemoteControlAction, } from "./types";
//# sourceMappingURL=index.d.ts.map