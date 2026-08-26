/**
 * @module rn-audio-stream/types/cast
 *
 * Google Cast integration types.
 */

import type { Track, PlaybackState, RepeatMode, PlayerError, PlayerEvents, AudioPlayerOptions } from "./index";

/**
 * Cast device information.
 */
export interface CastDevice {
  /** Unique device identifier. */
  id: string;
  /** Human-readable device name. */
  name: string;
  /** Device model name (e.g., "Chromecast", "Chromecast Ultra", "Google Nest Hub"). */
  modelName?: string;
  /** Device IP address. */
  ipAddress?: string;
  /** Device capabilities. */
  capabilities?: string[];
  /** Whether the device is currently connected. */
  isConnected?: boolean;
}

/**
 * Current Cast connection state.
 */
export type CastState =
  | "not_connected"    // No session, not connecting
  | "connecting"       // Attempting to establish session
  | "connected"        // Session active
  | "disconnecting"    // Ending session
  | "no_devices_available";

/**
 * Media metadata for Cast receiver (compatible with MediaMetadata.MusicTrack).
 */
export interface CastMediaMetadata {
  /** Track title. */
  title?: string;
  /** Artist name. */
  artist?: string;
  /** Album name. */
  albumName?: string;
  /** Album artist. */
  albumArtist?: string;
  /** Composer. */
  composer?: string;
  /** Track number. */
  trackNumber?: number;
  /** Total tracks in album. */
  totalTracks?: number;
  /** Disc number. */
  discNumber?: number;
  /** Total discs. */
  totalDiscs?: number;
  /** Release date. */
  releaseDate?: string;
  /** Genre. */
  genre?: string;
  /** Artwork images. */
  images?: Array<{ url: string; width?: number; height?: number }>;
  /** Custom metadata. */
  [key: string]: unknown;
}

/**
 * Media load request for Cast.
 */
export interface CastLoadRequest {
  /** Media information to load. */
  mediaInfo: {
    /** Content ID (track ID). */
    contentId?: string;
    /** Content MIME type. */
    contentType?: string;
    /** Stream URL. */
    contentUrl: string;
    /** Stream duration in seconds (undefined for live). */
    streamDuration?: number;
    /** Stream type: "buffered" | "live" | "none". */
    streamType?: "buffered" | "live" | "none";
    /** Media metadata. */
    metadata?: CastMediaMetadata;
    /** Custom data passed to receiver. */
    customData?: Record<string, unknown>;
  };
  /** Whether to autoplay. */
  autoplay?: boolean;
  /** Initial playback position in seconds. */
  playPosition?: number;
  /** Custom data. */
  customData?: Record<string, unknown>;
}

/**
 * Media status from Cast receiver.
 */
export interface CastMediaStatus {
  /** Current playback state. */
  playerState: "IDLE" | "PLAYING" | "PAUSED" | "BUFFERING" | "LOADING";
  /** Current playback position in seconds. */
  streamPosition: number;
  /** Media duration in seconds. */
  mediaDuration: number;
  /** Buffered position in seconds. */
  bufferedPosition?: number;
  /** Current volume (0-1). */
  volumeLevel?: number;
  /** Whether muted. */
  isMuted?: boolean;
  /** Current repeat mode. */
  repeatMode?: "OFF" | "ALL" | "SINGLE" | "ALL_AND_SHUFFLE";
  /** Current queue items. */
  queueItems?: CastQueueItem[];
  /** Current item index in queue. */
  currentItemIndex?: number;
  /** Preloaded item index. */
  preloadedItemIndex?: number;
  /** Loading item index. */
  loadingItemIndex?: number;
  /** Custom data. */
  customData?: Record<string, unknown>;
}

/**
 * Queue item for Cast.
 */
export interface CastQueueItem {
  /** Item ID. */
  itemId: number;
  /** Media info. */
  media: {
    contentId?: string;
    contentUrl: string;
    contentType?: string;
    streamDuration?: number;
    streamType?: "buffered" | "live" | "none";
    metadata?: CastMediaMetadata;
  };
  /** Autoplay this item. */
  autoplay?: boolean;
  /** Start position. */
  startTime?: number;
  /** Custom data. */
  customData?: Record<string, unknown>;
}

/**
 * Extended AudioPlayer options with Cast support.
 */
export interface AudioPlayerOptionsWithCast extends Omit<AudioPlayerOptions, "headers"> {
  /** Google Cast receiver application ID. Defaults to default media receiver. */
  castAppId?: string;
  /** Custom headers for stream requests (merged with track-level headers). */
  headers?: Record<string, string>;
  /** Callback when Cast state changes. */
  onCastStateChange?: (state: CastState, device: CastDevice | null) => void;
  /** Callback when Cast devices list updates. */
  onCastDevicesChange?: (devices: CastDevice[]) => void;
  /** Callback when Cast session starts. */
  onCastSessionStart?: (device: CastDevice) => void;
  /** Callback when Cast session ends. */
  onCastSessionEnd?: (wasConnected: boolean) => void;
  /** Callback when Cast session fails to start. */
  onCastSessionError?: (error: Error) => void;
}

/** Re-export base types for convenience. */
export type {
  Track,
  PlaybackState,
  RepeatMode,
  PlayerError,
  PlayerEvents,
  AudioPlayerOptions,
} from "./index";