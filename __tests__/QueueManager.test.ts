/**
 * Unit tests for QueueManager.
 * Run with: npx jest __tests__/QueueManager.test.ts
 */

import { QueueManager } from "../src/utils/QueueManager";
import type { Track } from "../src/types";

function makeTracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `track-${i}`,
    url: `https://example.com/${i}.mp3`,
    title: `Track ${i}`,
  }));
}

describe("QueueManager — basic navigation", () => {
  it("initialises with correct index", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(5), 2);
    expect(q.currentIndex).toBe(2);
    expect(q.current?.id).toBe("track-2");
  });

  it("next() advances index", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(3));
    q.next("off");
    expect(q.currentIndex).toBe(1);
  });

  it("next() returns null at end with repeat=off", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(2));
    q.next("off"); // index 1
    const result = q.next("off"); // past end
    expect(result).toBeNull();
  });

  it("next() wraps with repeat=queue", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(3));
    q.jumpTo(2);
    const track = q.next("queue");
    expect(track?.id).toBe("track-0");
  });

  it("next() stays with repeat=track", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(3), 1);
    const before = q.current;
    const after = q.next("track");
    expect(after?.id).toBe(before?.id);
  });

  it("previous() seeks to start when position > 3 is handled by caller", () => {
    // QueueManager itself just moves index; position guard is in AudioPlayer.
    const q = new QueueManager();
    q.setQueue(makeTracks(5), 3);
    q.previous("off");
    expect(q.currentIndex).toBe(2);
  });
});

describe("QueueManager — add / remove", () => {
  it("add() appends tracks", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(2));
    q.add([{ id: "extra", url: "x.mp3" }]);
    expect(q.tracks).toHaveLength(3);
  });

  it("insertNext() puts track after current", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(3), 0);
    q.insertNext({ id: "inserted", url: "ins.mp3" });
    expect(q.tracks[1].id).toBe("inserted");
  });

  it("remove() removes a track", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(5), 2);
    q.remove("track-1");
    expect(q.tracks.find((t) => t.id === "track-1")).toBeUndefined();
  });

  it("remove() adjusts index when track before current is removed", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(5), 3);
    q.remove("track-1");
    expect(q.currentIndex).toBe(2); // was 3, shifted back by 1
    expect(q.current?.id).toBe("track-3");
  });
});

describe("QueueManager — shuffle", () => {
  it("setShuffle(true) keeps current track at index 0", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(10), 4);
    const currentId = q.current?.id;
    q.setShuffle(true);
    expect(q.current?.id).toBe(currentId);
    expect(q.currentIndex).toBe(0);
  });

  it("setShuffle(false) restores original order", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(10), 4);
    q.setShuffle(true);
    q.setShuffle(false);
    expect(q.currentIndex).toBe(4);
    expect(q.tracks.map((t) => t.id)).toEqual(makeTracks(10).map((t) => t.id));
  });

  it("shuffle toggle is idempotent", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(5), 2);
    q.setShuffle(true);
    q.setShuffle(true); // no-op
    expect(q.shuffle).toBe(true);
    q.setShuffle(false);
    q.setShuffle(false); // no-op
    expect(q.shuffle).toBe(false);
  });
});

describe("QueueManager — peek", () => {
  it("peek returns next track without advancing", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(3), 0);
    const peeked = q.peek("off");
    expect(peeked?.id).toBe("track-1");
    expect(q.currentIndex).toBe(0); // unchanged
  });

  it("peek returns null at end with repeat=off", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(2), 1);
    expect(q.peek("off")).toBeNull();
  });

  it("peek wraps with repeat=queue", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(3), 2);
    expect(q.peek("queue")?.id).toBe("track-0");
  });
});

describe("QueueManager — edge cases", () => {
  it("empty queue returns null current and index -1", () => {
    const q = new QueueManager();
    expect(q.current).toBeNull();
    expect(q.currentIndex).toBe(-1);
  });

  it("clear() resets everything", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(5), 2);
    q.clear();
    expect(q.tracks).toHaveLength(0);
    expect(q.current).toBeNull();
    expect(q.currentIndex).toBe(-1);
  });

  it("jumpTo() throws on out-of-bounds", () => {
    const q = new QueueManager();
    q.setQueue(makeTracks(3));
    expect(() => q.jumpTo(99)).toThrow(RangeError);
  });
});
