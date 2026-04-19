/**
 * Minimal mock of react-native-track-player for unit tests.
 * Only QueueManager is tested in isolation, so this mock only needs to
 * satisfy TypeScript imports — no actual playback logic needed.
 */

export enum State {
  None      = "none",
  Ready     = "ready",
  Buffering = "buffering",
  Playing   = "playing",
  Paused    = "paused",
  Stopped   = "stopped",
  Ended     = "ended",
  Error     = "error",
}

export enum Event {
  PlaybackState              = "playback-state",
  PlaybackError              = "playback-error",
  PlaybackQueueEnded         = "playback-queue-ended",
  PlaybackActiveTrackChanged = "playback-active-track-changed",
  RemotePlay                 = "remote-play",
  RemotePause                = "remote-pause",
  RemoteStop                 = "remote-stop",
  RemoteNext                 = "remote-next",
  RemotePrevious             = "remote-previous",
  RemoteSeek                 = "remote-seek",
  RemoteDuck                 = "remote-duck",
}

export enum Capability {
  Play         = "play",
  Pause        = "pause",
  Stop         = "stop",
  SkipToNext   = "skip-to-next",
  SkipToPrevious = "skip-to-previous",
  SeekTo       = "seek-to",
  SetRating    = "set-rating",
}

export enum RepeatMode {
  Off   = 0,
  Track = 1,
  Queue = 2,
}

const TrackPlayer = {
  setupPlayer:       jest.fn().mockResolvedValue(undefined),
  updateOptions:     jest.fn().mockResolvedValue(undefined),
  setVolume:         jest.fn().mockResolvedValue(undefined),
  setRate:           jest.fn().mockResolvedValue(undefined),
  setRepeatMode:     jest.fn().mockResolvedValue(undefined),
  add:               jest.fn().mockResolvedValue(undefined),
  remove:            jest.fn().mockResolvedValue(undefined),
  skip:              jest.fn().mockResolvedValue(undefined),
  skipToNext:        jest.fn().mockResolvedValue(undefined),
  skipToPrevious:    jest.fn().mockResolvedValue(undefined),
  play:              jest.fn().mockResolvedValue(undefined),
  pause:             jest.fn().mockResolvedValue(undefined),
  stop:              jest.fn().mockResolvedValue(undefined),
  reset:             jest.fn().mockResolvedValue(undefined),
  seekTo:            jest.fn().mockResolvedValue(undefined),
  getQueue:          jest.fn().mockResolvedValue([]),
  getActiveTrackIndex: jest.fn().mockResolvedValue(0),
  getProgress:       jest.fn().mockResolvedValue({ position: 0, duration: 0, buffered: 0 }),
  addEventListener:  jest.fn().mockReturnValue({ remove: jest.fn() }),
  registerPlaybackService: jest.fn(),
};

export default TrackPlayer;
