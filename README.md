# rn-audio-stream

A well-typed React Native audio player module with first-class support for:

- **HTTP/HTTPS audio streaming** — MP3, AAC, FLAC, OGG, Opus, HLS, and more
- **Navidrome / OpenSubsonic** API compatibility out of the box
- **Live / internet-radio streams** (no seek, infinite duration)
- **Queue playback** from remote URLs and local assets
- **Shuffle** — Fisher-Yates algorithm that keeps the current track playing
- **Repeat modes** — off / single track / entire queue
- **Automatic retry** on transient stream failures
- **Typed React hooks** for painless UI integration

---

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Navidrome / Subsonic integration](#navidrome--subsonic-integration)
- [Live radio streams](#live-radio-streams)
- [Gapless playback](#gapless-playback)
- [Shuffle](#shuffle)
- [Repeat modes](#repeat-modes)
- [React hooks](#react-hooks)
- [API reference](#api-reference)
- [TypeScript types](#typescript-types)

---

## Installation

```bash
# 1. Install this module
npm install git+https://git.dablulite.dev/DaBluLite/rn-audio-stream.git

# 2. Install the required native peer dependency
npm install react-native-sound-player

# 3. iOS — link the native CocoaPods pod
cd ios && pod install

# 4. Android — auto-linked, no extra steps.
```

> **React Native version**: requires ≥ 0.73. Uses the New Architecture (Fabric / JSI) where available.

---

## Quick start

### 1. Create a player

```ts
import { createAudioPlayer } from "rn-audio-stream";

// Somewhere outside your component tree (Context, store, module-level singleton…)
const player = await createAudioPlayer({
  shuffle: false,
  repeatMode: "queue",
  volume: 1.0,
});
```

### 2. Load tracks and play

```ts
await player.setQueue([
  {
    id: "1",
    url: "https://my.navidrome/rest/stream?id=1&...",
    title: "Song A",
    artist: "Artist",
    duration: 210,
    artwork: "https://my.navidrome/rest/getCoverArt?id=1",
  },
  {
    id: "2",
    url: "https://my.navidrome/rest/stream?id=2&...",
    title: "Song B",
    artist: "Artist",
    duration: 195,
  },
], 0, /* autoPlay */ true);
```

### 3. Use hooks in your components

```tsx
import { useAudioPlayer, useProgress, usePlaybackControls } from "rn-audio-stream";
import { usePlayer } from "./PlayerContext"; // your Context wrapper

function NowPlaying() {
  const player = usePlayer();
  const { currentTrack, playbackState } = useAudioPlayer(player);
  const { position, duration } = useProgress(player);
  const { togglePlayPause, next, previous, seek } = usePlaybackControls(player);

  return (
    <View>
      <Text>{currentTrack?.title ?? "Nothing playing"}</Text>
      <Text>{playbackState}</Text>
      <Slider
        value={position}
        maximumValue={duration || 1}
        onSlidingComplete={seek}
      />
      <Button title="⏮" onPress={previous} />
      <Button title={playbackState === "playing" ? "⏸" : "▶"} onPress={togglePlayPause} />
      <Button title="⏭" onPress={next} />
    </View>
  );
}
```

---

## Navidrome / Subsonic integration

The `Track.url` field accepts any direct audio URL. For Navidrome, use the
`/rest/stream` endpoint:

```ts
const NAVIDROME_BASE = "https://my.navidrome.example.com";
const AUTH = "u=admin&p=password&v=1.16.1&c=MyApp&f=json";

function navidromeTrack(song: NavidromeSong): Track {
  return {
    id: song.id,
    url: `${NAVIDROME_BASE}/rest/stream?id=${song.id}&${AUTH}`,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    artwork: `${NAVIDROME_BASE}/rest/getCoverArt?id=${song.coverArt}&${AUTH}`,
    metadata: { bitRate: song.bitRate, genre: song.genre },
  };
}

// Fetch an album and play it
const response = await fetch(`${NAVIDROME_BASE}/rest/getAlbum?id=${albumId}&${AUTH}`);
const { album } = await response.json();
const tracks = album.song.map(navidromeTrack);

await player.setQueue(tracks, 0, true);
```

### Using custom headers instead of URL params

If you prefer token-based auth (OpenSubsonic extension), pass headers at the
player level so every request automatically includes them:

```ts
const player = await createAudioPlayer({
  headers: {
    "X-Nd-Authorization": `Bearer ${token}`,
  },
});
```

---

## Live radio streams

Mark any track as a live stream with `isLive: true`. The player will:

- Disable seek (calling `seek()` is a no-op)
- Report `position = 0` and `duration = Infinity`
- Ignore repeat-track mode

```ts
const radioStation: Track = {
  id: "soma-groovesalad",
  url: "https://ice2.somafm.com/groovesalad-256-mp3",
  title: "SomaFM — Groove Salad",
  artwork: "https://somafm.com/img3/groovesalad-400.jpg",
  isLive: true,
};

await player.setQueue([radioStation], 0, true);
```

---

## Gapless playback

Gapless pre-buffering is **not available** with `react-native-sound-player`.

Passing `gapless: true` will throw during `player.init()`.

---

## Shuffle

```ts
// Enable on create
const player = await createAudioPlayer({ shuffle: true });

// Toggle at runtime — keeps the current track playing
await player.setShuffle();          // toggle
await player.setShuffle(true);      // explicit on
await player.setShuffle(false);     // explicit off
```

When shuffle is toggled **on** the queue is immediately reordered with
Fisher-Yates, with the currently playing track anchored at position 0.

When toggled **off** the original order is restored and the current track's
index is re-synced.

### In a component

```tsx
const { shuffle, setShuffle } = useRepeatShuffle(player);

<Pressable onPress={() => setShuffle()}>
  <ShuffleIcon active={shuffle} />
</Pressable>
```

---

## Repeat modes

| Mode        | Behaviour                                      |
|-------------|------------------------------------------------|
| `"off"`     | Stop after the last track. (default)           |
| `"track"`   | Loop the current track indefinitely.           |
| `"queue"`   | Loop the whole queue from the start.           |

```ts
await player.setRepeatMode("queue");

// Or cycle: off → track → queue → off
await player.cycleRepeatMode();
```

### In a component

```tsx
const { repeatMode, cycleRepeatMode } = useRepeatShuffle(player);

<Pressable onPress={cycleRepeatMode}>
  <RepeatIcon mode={repeatMode} />
</Pressable>
```

---

## React hooks

All hooks accept an `AudioPlayer` instance (typically provided via React Context).

| Hook | Returns | Re-renders on |
|------|---------|---------------|
| `useAudioPlayer(player)` | Full `PlayerState` | Any state change |
| `useProgress(player)` | `{ position, duration, buffered }` | Progress tick (~1 s) |
| `useQueue(player)` | Queue array + helpers | Queue changes |
| `usePlaybackControls(player)` | Stable callback refs | Never |
| `useRepeatShuffle(player)` | Repeat / shuffle state + setters | Mode changes |
| `usePlaybackState(player)` | `PlaybackState` string | State changes |
| `useNowPlaying(player)` | `Track \| null` | Track changes only |

**Tip**: use `useProgress` for seek bars and `useNowPlaying` for artwork /
title to minimise re-renders. Only use `useAudioPlayer` when you genuinely
need the full state.

---

## API reference

### `AudioPlayer`

#### Constructor

```ts
new AudioPlayer(options?: AudioPlayerOptions)
```

#### Methods

| Method | Description |
|--------|-------------|
| `init()` | **Required first call.** Sets up SoundPlayer bindings. |
| `setQueue(tracks, startIndex?, autoPlay?)` | Replace queue and optionally start playing. |
| `addToQueue(tracks)` | Append tracks to the queue. |
| `playNext(track)` | Insert a track immediately after the current one. |
| `removeFromQueue(id)` | Remove a track by its `id`. |
| `clearQueue()` | Stop and empty the queue. |
| `play()` | Start / resume playback. |
| `pause()` | Pause playback. |
| `stop()` | Stop and reset position to 0. |
| `togglePlayPause()` | Toggle play/pause. |
| `next()` | Skip to next track (respects repeat mode). |
| `previous()` | Skip to previous track (or seek to 0 if > 3 s in). |
| `skipToIndex(index)` | Jump to a queue index and play. |
| `seek(position)` | Seek to absolute position in seconds. |
| `setVolume(volume)` | Set volume `[0, 1]`. |
| `setRate(rate)` | Set playback rate `[0.25, 4.0]`. |
| `setRepeatMode(mode)` | Set repeat mode: `"off"`, `"track"`, `"queue"`. |
| `cycleRepeatMode()` | Cycle: off → track → queue → off. |
| `setShuffle(enabled?)` | Enable / disable / toggle shuffle. |
| `on(event, listener)` | Subscribe to an event; returns unsubscribe fn. |
| `once(event, listener)` | Subscribe once; auto-removes after first fire. |
| `destroy()` | Tear down and release all native resources. |

#### `state` property

Returns a read-only `PlayerState` snapshot. See [TypeScript types](#typescript-types).

---

## TypeScript types

```ts
import type {
  Track,            // A single audio track
  PlayerState,      // Full state snapshot
  PlaybackState,    // "idle" | "loading" | "buffering" | "playing" | "paused" | "stopped" | "ended" | "error"
  RepeatMode,       // "off" | "track" | "queue"
  PlayerError,      // { code, message, track?, cause? }
  PlayerEvents,     // Event → payload map
  AudioPlayerOptions,
  RemoteControlAction,
} from "rn-audio-stream";
```

---

## License

MIT
