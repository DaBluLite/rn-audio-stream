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
export {};
//# sourceMappingURL=playbackService.d.ts.map