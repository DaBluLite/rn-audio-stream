/**
 * @module rn-audio-stream/types
 *
 * Core type definitions for the audio player.
 */
/**
 * Represents a single playable audio track.
 *
 * Compatible with the OpenSubsonic / Navidrome REST API response shape,
 * but all fields except `id` and `url` are optional so you can use any
 * back-end (plain HTTP files, HLS live streams, etc.).
 *
 * @example
 * // Navidrome track
 * const track: Track = {
 *   id: "abc123",
 *   url: "https://my.navidrome/rest/stream?id=abc123&v=1.16.1&c=MyApp&f=json",
 *   title: "Bohemian Rhapsody",
 *   artist: "Queen",
 *   album: "A Night at the Opera",
 *   duration: 354,
 *   artwork: "https://my.navidrome/rest/getCoverArt?id=abc123",
 * };
 *
 * @example
 * // Live internet-radio stream
 * const live: Track = {
 *   id: "radio-1",
 *   url: "https://stream.example.com/128kbps",
 *   title: "Example Radio",
 *   isLive: true,
 * };
 */
export interface Track {
    /** Unique identifier used internally for queue management. */
    id: string;
    /**
     * Direct audio URL.
     * Supports HTTP/HTTPS MP3, AAC, FLAC, OGG, Opus, HLS (.m3u8), etc.
     * For live streams, set `isLive: true` so the player skips duration
     * calculations and disables seek.
     */
    url: string;
    /** Human-readable track title. Shown in the lock-screen / notification. */
    title?: string;
    /** Primary artist name. */
    artist?: string;
    /** Album name. */
    album?: string;
    /**
     * Track duration in **seconds**.
     * If omitted the player will attempt to derive it from the stream metadata.
     * For live streams this value is meaningless and ignored.
     */
    duration?: number;
    /**
     * URL (or `require()` path) for album / station artwork.
     * Passed directly to React Native's `Image` source prop.
     */
    artwork?: string | number;
    /**
     * Mark this track as a live / continuous stream.
     * When `true`:
     *  - Seek is disabled.
     *  - Progress tracking reports `position = 0` and `duration = Infinity`.
     *  - Gapless pre-buffering is skipped.
     *  - Repeat-one has no effect (stream never "ends").
     */
    isLive?: boolean;
    /**
     * Arbitrary extra data your app wants to attach to a track
     * (e.g. Navidrome `songId`, genre, bit-rate, etc.).
     */
    metadata?: Record<string, unknown>;
}
/**
 * All possible states the player can be in.
 *
 * ```
 * Idle ──► Loading ──► Buffering ──► Playing ──► Paused
 *                            │                       │
 *                            └──────► Error ◄────────┘
 *                                       │
 *                                     Idle
 * ```
 */
export type PlaybackState = "idle" | "loading" | "buffering" | "playing" | "paused" | "stopped" | "ended" | "error";
/**
 * Controls what happens when the current track (or queue) ends.
 *
 * | Value        | Behaviour                                      |
 * |--------------|------------------------------------------------|
 * | `"off"`      | Stop after the last track in the queue.        |
 * | `"track"`    | Loop the current track indefinitely.           |
 * | `"queue"`    | Loop the whole queue from the beginning.       |
 */
export type RepeatMode = "off" | "track" | "queue";
/**
 * A complete, read-only snapshot of the player at any given moment.
 * Returned by `useAudioPlayer()` and emitted by `AudioPlayer` events.
 */
export interface PlayerState {
    /** The track that is currently loaded (or about to be loaded). */
    currentTrack: Track | null;
    /** Index of `currentTrack` within `queue`. `-1` if `queue` is empty. */
    currentIndex: number;
    /** The full ordered queue. Reflects shuffle reordering when active. */
    queue: Track[];
    /** Current playback lifecycle state. */
    playbackState: PlaybackState;
    /**
     * Playback position in **seconds**.
     * Updated at most once per second. `0` when idle or for live streams.
     */
    position: number;
    /**
     * Total track duration in **seconds**.
     * `Infinity` for live streams; `0` when unknown.
     */
    duration: number;
    /**
     * Buffered duration ahead of `position`, in **seconds**.
     * Useful for showing a buffer-progress bar.
     */
    buffered: number;
    /** Current repeat mode. */
    repeatMode: RepeatMode;
    /** Whether shuffle is active. */
    shuffle: boolean;
    /** Current playback rate. `1.0` = normal speed. Range: `0.25` – `4.0`. */
    rate: number;
    /** Current volume. Range `0.0` – `1.0`. */
    volume: number;
    /**
     * Set when `playbackState === "error"`.
     * Contains a human-readable message and optionally the underlying cause.
     */
    error: PlayerError | null;
}
/** Structured error emitted by the player. */
export interface PlayerError {
    /** Short machine-readable code, e.g. `"NETWORK_ERROR"`, `"DECODE_ERROR"`. */
    code: string;
    /** Human-readable description. */
    message: string;
    /** The track that caused the error, if applicable. */
    track?: Track;
    /** Original underlying error object. */
    cause?: unknown;
}
/** Map of event names → their payload types. */
export interface PlayerEvents {
    /** Fired whenever any field of `PlayerState` changes. */
    stateChange: PlayerState;
    /** Fired when playback transitions to a new track. */
    trackChange: {
        previous: Track | null;
        current: Track;
    };
    /** Fired roughly once per second while playing. */
    progress: {
        position: number;
        duration: number;
        buffered: number;
    };
    /** Fired when the player naturally reaches the end of the queue. */
    queueEnd: void;
    /** Fired on unrecoverable playback error. */
    error: PlayerError;
}
/**
 * Options passed to `AudioPlayer` constructor or `createAudioPlayer()`.
 */
export interface AudioPlayerOptions {
    /**
     * Initial volume. Default `1.0`.
     */
    volume?: number;
    /**
     * Initial playback rate. Default `1.0`.
     */
    rate?: number;
    /**
     * Initial repeat mode. Default `"off"`.
     */
    repeatMode?: RepeatMode;
    /**
     * Initial shuffle state. Default `false`.
     */
    shuffle?: boolean;
    /**
     * Gapless playback toggle.
     *
     * Not supported when using `react-native-sound-player`.
     * Passing `true` causes `AudioPlayer.init()` to throw.
     *
     * Default: `false`.
     */
    gapless?: boolean;
    /**
     * How many seconds before track-end to begin pre-buffering the next track.
     * Only relevant when `gapless: true`.
     *
     * Not used with `react-native-sound-player`.
     *
     * Lower values use less memory; higher values give more buffer headroom
     * on slow connections.
     *
     * Default: `10` seconds.
     */
    gaplessPreloadSeconds?: number;
    /**
     * Number of times to retry a failed stream before emitting an error.
     * Default: `3`.
     */
    retryCount?: number;
    /**
     * Delay in milliseconds between retry attempts.
     * Default: `1500`.
     */
    retryDelayMs?: number;
    /**
     * User-agent string sent with stream requests.
     * Useful to identify your app to Navidrome / icecast servers.
     *
     * Not supported when using `react-native-sound-player`.
     */
    userAgent?: string;
    /**
     * Extra HTTP headers attached to every stream request.
     * E.g. `{ Authorization: "Bearer <token>" }` for authenticated endpoints.
     *
     * Not supported when using `react-native-sound-player`.
     */
    headers?: Record<string, string>;
    /**
     * Called when the system media controls (lock screen, notification,
     * CarPlay, Android Auto) request a specific action.
     * If omitted the player handles all actions automatically.
     *
     * Not currently emitted when using `react-native-sound-player`.
     */
    onRemoteControl?: (action: RemoteControlAction) => void;
}
/**
 * Actions that can be triggered by the OS media controls.
 * Your app receives these via `AudioPlayerOptions.onRemoteControl`.
 */
export type RemoteControlAction = {
    type: "play";
} | {
    type: "pause";
} | {
    type: "stop";
} | {
    type: "next";
} | {
    type: "previous";
} | {
    type: "seek";
    position: number;
} | {
    type: "setRate";
    rate: number;
};
//# sourceMappingURL=index.d.ts.map