/**
 * Minimal mock of react-native-sound-player for unit tests.
 */

type Callback = (payload: any) => void;

const listeners = new Map<string, Set<Callback>>();

function addEventListener(eventName: string, callback: Callback) {
  if (!listeners.has(eventName)) listeners.set(eventName, new Set());
  listeners.get(eventName)!.add(callback);
  return {
    remove: jest.fn(() => {
      listeners.get(eventName)?.delete(callback);
    }),
  };
}

const SoundPlayer = {
  playSoundFile: jest.fn(),
  playSoundFileWithDelay: jest.fn(),
  loadSoundFile: jest.fn(),
  playUrl: jest.fn(),
  loadUrl: jest.fn(),
  playAsset: jest.fn(),
  loadAsset: jest.fn(),
  onFinishedPlaying: jest.fn(),
  onFinishedLoading: jest.fn(),
  addEventListener: jest.fn(addEventListener),
  play: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  stop: jest.fn(),
  seek: jest.fn(),
  setVolume: jest.fn(),
  setSpeaker: jest.fn(),
  setMixAudio: jest.fn(),
  setNumberOfLoops: jest.fn(),
  getInfo: jest.fn().mockResolvedValue({ currentTime: 0, duration: 0 }),
  unmount: jest.fn(),
};

export default SoundPlayer;
