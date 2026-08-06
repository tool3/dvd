import { describe, expect, it } from 'vitest';
import { planVideo } from './frame-sequence';
import { coalesce } from '../pipeline/coalescer';
import { createGridState, processInput } from '../pipeline/vterminal';
import { themes } from '../pipeline';
import type { FrameData } from '../pipeline/svg-emitter';
import type { EmitterOptions } from '../types';

const emitter = (over: Partial<EmitterOptions> = {}): EmitterOptions => ({
  theme: themes.dark,
  template: 'macos',
  width: 400,
  height: 200,
  fontSize: 14,
  ...over,
});

/** Build a frame whose text is `label`, stamped at `timestamp`. */
const frameAt = (timestamp: number, label: string): FrameData => {
  const grid = processInput(createGridState(40, 8), label);
  return {
    rows: coalesce(grid, themes.dark),
    cursor: { row: grid.cursor.row, col: grid.cursor.col },
    cursorVisible: false,
    timestamp,
  };
};

describe('planVideo', () => {
  it('rejects an empty animation', () => {
    expect(() => planVideo([], { emitter: emitter() })).toThrow(/No frames/);
  });

  it('rounds odd dimensions up to even for yuv420p', () => {
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 401, height: 199 }),
    });
    expect(plan.width).toBe(402);
    expect(plan.height).toBe(200);
  });

  it('leaves even dimensions alone', () => {
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 400, height: 200 }),
    });
    expect(plan.width).toBe(400);
    expect(plan.height).toBe(200);
  });

  it('holds each source frame until the next one is due', () => {
    // Frames at 0ms and 100ms, sampled at 10fps (one frame per 100ms).
    const plan = planVideo([frameAt(0, 'a'), frameAt(100, 'b')], {
      emitter: emitter(),
      fps: 10,
    });
    expect(plan.timeline).toEqual([0, 1]);
  });

  it('always reaches the final source frame', () => {
    // The regression this guards: a bare ceil() stops sampling at 966ms for
    // a 1000ms animation at 30fps, so the finished state never shows.
    const frames = [frameAt(0, 'start'), frameAt(1000, 'done')];
    const plan = planVideo(frames, { emitter: emitter(), fps: 30 });
    expect(plan.timeline[plan.timeline.length - 1]).toBe(1);
    expect(plan.frameCount).toBe(31);
  });

  it('resamples irregular timestamps onto a constant grid', () => {
    // Mimics real output: fast typing, a long sleep, then a burst.
    const frames = [
      frameAt(0, 'a'),
      frameAt(50, 'b'),
      frameAt(100, 'c'),
      frameAt(1000, 'd'),
      frameAt(1033, 'e'),
    ];
    const plan = planVideo(frames, { emitter: emitter(), fps: 30 });

    // Every step is forward-only and never skips past a frame's own slot.
    for (let i = 1; i < plan.timeline.length; i++) {
      expect(plan.timeline[i]).toBeGreaterThanOrEqual(plan.timeline[i - 1]);
    }
    // The 900ms of dead air between 'c' and 'd' holds frame index 2.
    const atHalfSecond = plan.timeline[Math.round(0.5 * 30)];
    expect(atHalfSecond).toBe(2);
    expect(plan.timeline[plan.timeline.length - 1]).toBe(4);
  });

  it('never emits a timeline shorter than one frame', () => {
    const plan = planVideo([frameAt(0, 'only')], { emitter: emitter(), fps: 30 });
    expect(plan.frameCount).toBeGreaterThanOrEqual(1);
    expect(plan.timeline).toEqual([0]);
  });

  it('holds the last frame for pauseAtEnd', () => {
    const plan = planVideo([frameAt(0, 'a'), frameAt(100, 'b')], {
      emitter: emitter(),
      fps: 10,
      pauseAtEnd: 500,
    });
    // 600ms at 10fps → 6 intervals + the endpoint frame.
    expect(plan.frameCount).toBe(7);
    expect(plan.timeline.slice(1).every((i) => i === 1)).toBe(true);
  });

  it('repeats the whole pass for each loop', () => {
    const once = planVideo([frameAt(0, 'a'), frameAt(100, 'b')], {
      emitter: emitter(),
      fps: 10,
    });
    const thrice = planVideo([frameAt(0, 'a'), frameAt(100, 'b')], {
      emitter: emitter(),
      fps: 10,
      loops: 3,
    });
    expect(thrice.frameCount).toBe(once.frameCount * 3);
    expect(thrice.timeline).toEqual([...once.timeline, ...once.timeline, ...once.timeline]);
  });

  it('reports duration consistent with frame count and fps', () => {
    const plan = planVideo([frameAt(0, 'a'), frameAt(1000, 'b')], {
      emitter: emitter(),
      fps: 25,
    });
    expect(plan.durationMs).toBeCloseTo((plan.frameCount / 25) * 1000, 5);
  });

  it('renders standalone SVG per frame with the even-rounded canvas', () => {
    const plan = planVideo([frameAt(0, 'hello'), frameAt(100, 'world')], {
      emitter: emitter({ width: 401, height: 199 }),
      fps: 10,
    });
    const first = plan.render(0);
    expect(first).toMatch(/^<svg/);
    expect(first).toContain('width="402"');
    expect(first).toContain('height="200"');
    expect(first).toContain('hello');
    expect(plan.render(1)).toContain('world');
  });

  it('flags repeated frames so encoders can reuse the raster', () => {
    // 2fps over a 1000ms animation whose only other frame lands at 900ms.
    const plan = planVideo([frameAt(0, 'a'), frameAt(900, 'b')], {
      emitter: emitter(),
      fps: 2,
    });
    const frames = [...plan.frames()];
    expect(frames[0].repeatsPrevious).toBe(false);
    expect(frames[1].repeatsPrevious).toBe(true); // still 'a' at 500ms
    expect(frames[2].repeatsPrevious).toBe(false); // 'b' at 1000ms
  });

  it('generates frames lazily in order with correct timestamps', () => {
    const plan = planVideo([frameAt(0, 'a'), frameAt(100, 'b')], {
      emitter: emitter(),
      fps: 10,
    });
    const frames = [...plan.frames()];
    expect(frames.map((f) => f.index)).toEqual([0, 1]);
    expect(frames.map((f) => f.timestampMs)).toEqual([0, 100]);
  });

  it('throws for an out-of-range frame index', () => {
    const plan = planVideo([frameAt(0, 'a')], { emitter: emitter() });
    expect(() => plan.render(99)).toThrow(/out of range/);
  });

  it('disables cursor blink so still frames do not freeze mid-phase', () => {
    // Blink is a CSS @keyframes animation in the emitted stylesheet. A
    // rasterizer samples one instant, so leaving it on means the cursor
    // shows up or vanishes depending on which phase got sampled.
    const withCursor: FrameData = { ...frameAt(0, 'a'), cursorVisible: true };
    const plan = planVideo([withCursor], {
      emitter: emitter({ cursorBlink: true }),
    });
    const svg = plan.render(0);
    expect(svg).toContain('class="cursor"');
    expect(svg).not.toContain('@keyframes blink');
    expect(svg).toContain('.cursor { opacity: 1; }');
  });
});
