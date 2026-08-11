import { describe, expect, it } from 'vitest';
import { planVideo, autoFps, VIDEO_QUALITY } from './frame-sequence';
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

/** The emitted SVG's own canvas size, ceiled the way the plan does. */
const svgSize = (svg: string): { width: number; height: number } => {
  const root = svg.slice(0, svg.indexOf('>') + 1);
  const w = root.match(/\swidth="([\d.]+)"/);
  const h = root.match(/\sheight="([\d.]+)"/);
  if (!w || !h) throw new Error(`no size on root element: ${root.slice(0, 120)}`);
  return {
    width: Math.ceil(Number.parseFloat(w[1])),
    height: Math.ceil(Number.parseFloat(h[1])),
  };
};

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
    expect(plan.frameWidth).toBe(401);
    expect(plan.frameHeight).toBe(199);
    expect(plan.width).toBe(402);
    expect(plan.height).toBe(200);
  });

  it('leaves even dimensions alone', () => {
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 400, height: 200 }),
    });
    expect(plan.width).toBe(400);
    expect(plan.height).toBe(200);
    expect(plan.frameWidth).toBe(400);
    expect(plan.frameHeight).toBe(200);
  });

  it('measures the real canvas when background padding grows it', () => {
    // Regression: the emitter treats `width`/`height` as the terminal
    // window and pads the canvas around it. Using the requested size as
    // the video size scaled an 800x500 frame into 700x300 — a squashed
    // picture, which is exactly what shipped.
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({
        width: 700,
        height: 300,
        background: '#ff0000',
        backgroundPadding: '100 50',
      }),
    });
    expect(plan.frameWidth).toBe(800);
    expect(plan.frameHeight).toBe(500);
    expect(plan.width).toBe(800);
    expect(plan.height).toBe(500);

    const svg = plan.render(0);
    expect(svg).toContain('width="800"');
    expect(svg).toContain('height="500"');
  });

  it('measures the real canvas when a watermark overflows it', () => {
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({
        width: 200,
        height: 120,
        watermark: 'a watermark considerably wider than the window itself',
      }),
    });
    expect(svgSize(plan.render(0))).toEqual({
      width: plan.frameWidth,
      height: plan.frameHeight,
    });
    expect(plan.frameWidth).toBeGreaterThan(200);
  });

  it('always reports a frame size the emitted SVG actually has', () => {
    for (const extra of [
      {},
      { background: '#123456', backgroundPadding: 24 },
      { background: '#123456', backgroundPadding: '10 20 30 40' },
      { template: 'minimal' as const },
      { watermark: 'dvdrw' },
      // Fractional height: the watermark row is fontSize * lineHeight.
      { watermark: 'dvdrw', lineHeight: 19.6 },
    ]) {
      const plan = planVideo([frameAt(0, 'hello')], {
        emitter: emitter({ width: 500, height: 250, ...extra }),
      });
      expect(svgSize(plan.render(0))).toEqual({
        width: plan.frameWidth,
        height: plan.frameHeight,
      });
      expect(plan.width % 2).toBe(0);
      expect(plan.height % 2).toBe(0);
      // Pad-only: the canvas never crops the frame, and never scales it
      // by more than the sub-pixel needed to reach an even edge.
      expect(plan.width - plan.frameWidth).toBeGreaterThanOrEqual(0);
      expect(plan.width - plan.frameWidth).toBeLessThanOrEqual(1);
      expect(plan.height - plan.frameHeight).toBeGreaterThanOrEqual(0);
      expect(plan.height - plan.frameHeight).toBeLessThanOrEqual(1);
    }
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
    // The SVG keeps its own odd size; the even canvas is the encoder's.
    expect(first).toContain('width="401"');
    expect(first).toContain('height="199"');
    expect(plan.width).toBe(402);
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

  it('defaults to medium, matching the previous 1:1 behaviour', () => {
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 400, height: 200 }),
    });
    expect(plan.quality).toBe('medium');
    expect(plan.encoding.scale).toBe(1);
    expect(plan.frameWidth).toBe(400);
    expect(plan.frameHeight).toBe(200);
  });

  it('supersamples the frame for high quality', () => {
    const base = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 400, height: 200 }),
      quality: 'medium',
    });
    const high = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 400, height: 200 }),
      quality: 'high',
    });

    const factor = VIDEO_QUALITY.high.scale;
    expect(factor).toBeGreaterThan(1);
    expect(high.frameWidth).toBe(base.frameWidth * factor);
    expect(high.frameHeight).toBe(base.frameHeight * factor);
    expect(svgSize(high.render(0))).toEqual({
      width: 400 * factor,
      height: 200 * factor,
    });
    // Vector scaling, not a bigger bitmap: the viewBox is untouched so the
    // geometry still spans the original coordinate space.
    expect(high.render(0)).toContain('viewBox="0 0 400 200"');
    expect(high.encoding.crf).toBeLessThan(base.encoding.crf);
  });

  it('keeps low quality at 1:1 but cheaper to encode', () => {
    const low = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 400, height: 200 }),
      quality: 'low',
    });
    expect(low.frameWidth).toBe(400);
    expect(low.encoding.crf).toBeGreaterThan(VIDEO_QUALITY.medium.crf);
    expect(low.encoding.bitsPerPixel).toBeLessThan(VIDEO_QUALITY.medium.bitsPerPixel);
  });

  it('scales a padded canvas by its real size, not the requested one', () => {
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({
        width: 700,
        height: 300,
        background: '#ff0000',
        backgroundPadding: '100 50',
      }),
      quality: 'high',
    });
    // Real canvas is 800x500; high scales THAT, not the 700x300 request.
    const factor = VIDEO_QUALITY.high.scale;
    expect(plan.frameWidth).toBe(800 * factor);
    expect(plan.frameHeight).toBe(500 * factor);
    expect(svgSize(plan.render(0))).toEqual({
      width: 800 * factor,
      height: 500 * factor,
    });
  });

  it('honours an explicit scale over the tier', () => {
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 400, height: 200 }),
      quality: 'low',
      scale: 3,
    });
    expect(plan.frameWidth).toBe(1200);
    expect(plan.frameHeight).toBe(600);
  });

  it('keeps scaled dimensions even for the encoder', () => {
    const plan = planVideo([frameAt(0, 'a')], {
      emitter: emitter({ width: 401, height: 199 }),
      quality: 'high',
    });
    const factor = VIDEO_QUALITY.high.scale;
    expect(plan.frameWidth).toBe(Math.ceil(401 * factor));
    expect(plan.frameHeight).toBe(Math.ceil(199 * factor));
    expect(plan.width % 2).toBe(0);
    expect(plan.height % 2).toBe(0);
  });

  describe('frame rate per tier', () => {
    // 33ms apart — a ~30fps source animation, like chartscii's redraws.
    const brisk = Array.from({ length: 20 }, (_, i) => frameAt(i * 33, `f${i}`));
    // 50ms apart — plain typing, which needs only 20fps to represent.
    const slow = Array.from({ length: 20 }, (_, i) => frameAt(i * 50, `f${i}`));
    // 8ms apart — faster than any tier should bother chasing.
    const frantic = Array.from({ length: 20 }, (_, i) => frameAt(i * 8, `f${i}`));

    it('uses the tier rate for low and medium', () => {
      expect(planVideo(brisk, { emitter: emitter(), quality: 'low' }).fps).toBe(15);
      expect(planVideo(brisk, { emitter: emitter(), quality: 'medium' }).fps).toBe(30);
    });

    it('defaults to 30 when no tier is given', () => {
      expect(planVideo(brisk, { emitter: emitter() }).fps).toBe(30);
    });

    it('snaps to the nearest standard rate, not the next one up', () => {
      // 33ms gaps imply ~30.3fps, and 30 keeps every frame — the grid
      // drifts 0.33ms per tick, nowhere near a whole frame. Rounding up to
      // 60 would double the frame count to show identical content.
      expect(autoFps(brisk)).toBe(30);
      expect(planVideo(brisk, { emitter: emitter(), quality: 'high' }).fps).toBe(30);

      const briskPlan = planVideo(brisk, { emitter: emitter(), quality: 'high' });
      expect(new Set(briskPlan.timeline).size).toBe(brisk.length);
    });

    it('reaches 120 and 240 when the source is genuinely that fast', () => {
      // Sub-16ms gaps come from a fast TypingSpeed or playbackSpeed > 1.
      // At 8ms, 60fps would throw away half the frames.
      const fast = Array.from({ length: 40 }, (_, i) => frameAt(i * 8, `f${i}`));
      expect(autoFps(fast)).toBe(120);

      const faster = Array.from({ length: 40 }, (_, i) => frameAt(i * 4, `f${i}`));
      expect(autoFps(faster)).toBe(240);

      // And the higher rate really does preserve more of the recording.
      const at60 = planVideo(fast, { emitter: emitter(), fps: 60 });
      const auto = planVideo(fast, { emitter: emitter(), quality: 'high' });
      expect(new Set(auto.timeline).size).toBeGreaterThan(
        new Set(at60.timeline).size,
      );
    });

    it('never drops high below the medium default', () => {
      // 50ms gaps only need 20fps, but high must not be worse than medium.
      expect(autoFps(slow)).toBe(30);
      expect(planVideo(slow, { emitter: emitter(), quality: 'high' }).fps).toBe(30);
    });

    it('caps at the fastest standard rate', () => {
      // 8ms gaps -> 125fps -> nearest step is 120.
      expect(planVideo(frantic, { emitter: emitter(), quality: 'high' }).fps).toBe(120);
      // A genuinely sub-4ms recording tops out rather than running away.
      const absurd = Array.from({ length: 40 }, (_, i) => frameAt(i, `f${i}`));
      expect(autoFps(absurd)).toBe(240);
    });

    it('ignores a stray 1ms nudge in an otherwise normal recording', () => {
      // The executor bumps colliding timestamps 1ms apart to keep them
      // ordered. Two such pairs must not drag a 33ms recording to 240fps
      // and octuple its frame count for identical content.
      const nudged = brisk.map((f, i) => ({ ...f, timestamp: f.timestamp }));
      nudged.splice(5, 0, { ...brisk[5], timestamp: brisk[5].timestamp + 1 });
      nudged.splice(20, 0, { ...brisk[19], timestamp: brisk[19].timestamp + 1 });
      nudged.sort((a, b) => a.timestamp - b.timestamp);

      expect(autoFps(nudged)).toBe(30);
      expect(planVideo(nudged, { emitter: emitter(), quality: 'high' }).fps).toBe(30);
    });

    it('falls back to the floor for a single frame', () => {
      expect(autoFps([frameAt(0, 'only')])).toBe(30);
    });

    it('lets an explicit fps override every tier', () => {
      for (const quality of ['low', 'medium', 'high'] as const) {
        expect(
          planVideo(brisk, { emitter: emitter(), quality, fps: 24 }).fps,
        ).toBe(24);
      }
    });

    it('samples more finely at a higher rate', () => {
      const low = planVideo(brisk, { emitter: emitter(), quality: 'low' });
      const high = planVideo(brisk, { emitter: emitter(), quality: 'high' });
      const animationMs = brisk[brisk.length - 1].timestamp;

      // Same wall-clock animation, so a higher rate means more frames…
      expect(high.frameCount).toBeGreaterThan(low.frameCount);

      // …covering the same span. Each tier overshoots by at most one of its
      // own frame periods (the endpoint frame that guarantees the final
      // source frame is shown), which is why the two durations differ.
      for (const plan of [low, high]) {
        const framePeriod = 1000 / plan.fps;
        expect(plan.durationMs).toBeGreaterThanOrEqual(animationMs);
        expect(plan.durationMs).toBeLessThan(animationMs + 2 * framePeriod);
      }

      // And low genuinely drops source frames the high tier keeps.
      expect(new Set(high.timeline).size).toBeGreaterThan(
        new Set(low.timeline).size,
      );
    });
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
