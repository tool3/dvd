//#region Imports

import type { EmitterOptions } from '../types';
import type { FrameData } from '../pipeline/svg-emitter';
import { emit } from '../pipeline/svg-emitter';


//#region Overview

/**
 * Turn a rendered animation into the frame sequence a video encoder wants.
 *
 * The animated SVG we normally emit is SMIL — stacked frame layers toggled
 * with `<animate attributeName="visibility">`. Nothing outside a browser
 * engine executes SMIL, so it is a dead end for video: ffmpeg has no SVG
 * decoder unless it was built against librsvg, and resvg/librsvg/canvas all
 * render a static document. Converting the finished SVG is the wrong move.
 *
 * Going back to `FrameData[]` is the right one. Each entry already holds
 * exactly one screen's worth of coalesced, themed spans, and `emit()`
 * renders one of those to a standalone static SVG that any rasterizer can
 * handle. All that's missing between the two is resampling — and that's
 * what lives here.
 *
 * This module stays pure and browser-safe on purpose. Rasterizing and
 * encoding are irreducibly platform-specific (WebCodecs in a browser,
 * resvg + ffmpeg in Node), so they belong to the consumers. What must NOT
 * be duplicated per platform is the timing arithmetic below: get the
 * resampling, loop expansion or dimension rounding even slightly different
 * in two places and the CLI's video, the web app's video and the SVG all
 * quietly stop agreeing with each other.
 */


//#region Types

export interface VideoPlanOptions {
  /** Emitter options — the same object shape the animated emitters take. */
  emitter: EmitterOptions;
  /** Constant output frame rate. Default 30. */
  fps?: number;
  /** How many times the animation plays. Default 1. */
  loops?: number;
  /** Hold the final frame this long (ms) at the end of every pass. */
  pauseAtEnd?: number;
}

export interface VideoFrame {
  /** Position in the output sequence. */
  index: number;
  /** Presentation time in the output video, in milliseconds. */
  timestampMs: number;
  /** Which `FrameData` entry this output frame shows. */
  sourceIndex: number;
  /**
   * True when this frame shows the same source frame as the one before it.
   * Encoders can reuse the previous raster instead of re-rendering — with
   * 50ms-per-character typing resampled to 30fps, most frames repeat.
   */
  repeatsPrevious: boolean;
  /** Standalone static SVG for this frame. */
  svg: string;
}

export interface VideoPlan {
  /**
   * Encoder canvas width — `frameWidth` rounded up to even.
   * Differs from `frameWidth` by at most 1px; see `frameWidth`.
   */
  width: number;
  /** Encoder canvas height — `frameHeight` rounded up to even. */
  height: number;
  /**
   * Intrinsic width of each rasterized frame: the emitted SVG's own
   * `width` attribute, measured rather than assumed.
   *
   * This is NOT `emitter.width`. The emitter treats that as the terminal
   * window's size and then grows the canvas around it — background padding
   * on all four sides, plus any overflow from a watermark wider than the
   * window. A 700x300 request with `backgroundPadding: "100 50"` emits an
   * 800x500 SVG. Scaling that into a 700x300 video is how you get a
   * squashed picture, so consumers must rasterize at this size and pad
   * (never scale) to reach `width`/`height`.
   */
  frameWidth: number;
  /** Intrinsic height of each rasterized frame. */
  frameHeight: number;
  fps: number;
  frameCount: number;
  durationMs: number;
  /** Source frame index shown at each output frame. */
  timeline: number[];
  /** Render one output frame to a static SVG. */
  render(index: number): string;
  /** Lazily walk the whole sequence in order. */
  frames(): Generator<VideoFrame>;
}


//#region Constants

const DEFAULT_FPS = 30;

/**
 * H.264 in yuv420p subsamples chroma 2×2, so odd pixel dimensions are
 * rejected outright by libx264 (and by WebCodecs' AVC encoder). Auto-fit
 * sizing happily produces odd numbers, so round up here — once, centrally —
 * rather than leaving every consumer to discover it via encoder errors.
 */
const toEven = (n: number): number => {
  const rounded = Math.max(2, Math.ceil(n));
  return rounded % 2 === 0 ? rounded : rounded + 1;
};

/**
 * Read the true canvas size off an emitted SVG's root element.
 *
 * Attribute order isn't guaranteed and values may be fractional, so this
 * scans the root tag for each attribute independently and falls back to the
 * viewBox before giving up.
 */
const measureSvg = (
  svg: string,
): { width: number; height: number } | null => {
  const root = svg.slice(0, svg.indexOf('>') + 1);
  const num = (attr: string): number | null => {
    const match = root.match(new RegExp(`[\\s"']${attr}\\s*=\\s*["']([\\d.]+)`));
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const width = num('width');
  const height = num('height');
  if (width !== null && height !== null) return { width, height };

  const viewBox = root.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/);
  if (viewBox) {
    const w = Number.parseFloat(viewBox[1]);
    const h = Number.parseFloat(viewBox[2]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h };
    }
  }
  return null;
};


//#region Plan Construction

/**
 * Resample an animation onto a constant frame rate and hand back a lazily
 * rendered frame sequence.
 *
 * Source timestamps are deliberately irregular — 50ms per typed character,
 * whatever a `Sleep` command asked for, ~33ms for a shell animation's
 * frames. Video needs a fixed grid, so each output frame shows the most
 * recent source frame at or before its presentation time. That's a
 * step/hold resample, which loses nothing here: the SVG animation is
 * itself `calcMode="discrete"`, so there was never anything to interpolate.
 */
export const planVideo = (
  frameData: FrameData[],
  options: VideoPlanOptions,
): VideoPlan => {
  if (frameData.length === 0) {
    throw new Error('No frames to encode');
  }

  const fps = options.fps && options.fps > 0 ? options.fps : DEFAULT_FPS;
  const loops = Math.max(1, Math.floor(options.loops ?? 1));
  const pauseAtEnd = Math.max(0, options.pauseAtEnd ?? 0);

  // A blinking cursor is a SMIL animation inside the emitted SVG. In a
  // still frame it can't blink — it would just freeze in whichever phase
  // the rasterizer happens to sample. Off is the honest rendering.
  //
  // Dimensions are deliberately NOT overridden here: `emitter.width` is
  // the terminal window, not the canvas, and forcing it even would shift
  // the layout by a pixel. The real canvas size is measured below.
  const emitter: EmitterOptions = {
    ...options.emitter,
    cursorBlink: false,
  };

  const frameMs = 1000 / fps;
  const startTs = frameData[0].timestamp;
  const animationMs = frameData[frameData.length - 1].timestamp - startTs;
  const passMs = Math.max(0, animationMs) + pauseAtEnd;

  // `+ 1` so the grid actually reaches the final source frame. With a bare
  // ceil, a 1000ms animation at 30fps stops sampling at 966ms and the last
  // frame — the finished chart, the completed output, the thing the whole
  // animation was building toward — never appears in the video.
  const passFrames = Math.ceil(passMs / frameMs) + 1;

  const pass: number[] = [];
  let source = 0;
  for (let i = 0; i < passFrames; i++) {
    const t = i * frameMs;
    while (
      source + 1 < frameData.length &&
      frameData[source + 1].timestamp - startTs <= t
    ) {
      source++;
    }
    pass.push(source);
  }

  const timeline: number[] = [];
  for (let loop = 0; loop < loops; loop++) {
    timeline.push(...pass);
  }

  const renderSource = (sourceIndex: number): string => {
    const frame = frameData[sourceIndex];
    const { svg } = emit(
      frame.rows,
      frame.cursorVisible ? frame.cursor : null,
      frame.cursorVisible,
      {
        ...emitter,
        selection: frame.selection ?? null,
        activeCursor: frame.activeCursor ?? false,
      },
    );
    return svg;
  };

  // Measure the canvas from a real emitted frame rather than trusting the
  // requested size. Cached, so this probe is not extra work — it's the
  // first frame everybody renders anyway.
  const probeSvg = renderSource(timeline[0]);
  const measured = measureSvg(probeSvg);
  if (!measured) {
    throw new Error('Could not determine the emitted frame size for video encoding.');
  }
  const frameWidth = Math.round(measured.width);
  const frameHeight = Math.round(measured.height);

  const render = (index: number): string => {
    const sourceIndex = timeline[index];
    if (sourceIndex === undefined) {
      throw new Error(
        `Frame ${index} is out of range (sequence has ${timeline.length} frames)`,
      );
    }
    return sourceIndex === timeline[0] ? probeSvg : renderSource(sourceIndex);
  };

  function* frames(): Generator<VideoFrame> {
    let lastSvg = '';
    for (let i = 0; i < timeline.length; i++) {
      const repeatsPrevious = i > 0 && timeline[i] === timeline[i - 1];
      // Only pay for `emit()` when the content actually changed. Typing at
      // 50ms/char resampled to 30fps repeats most frames, so this is the
      // difference between one emit per frame and one per visible change.
      if (!repeatsPrevious) lastSvg = render(i);
      yield {
        index: i,
        timestampMs: i * frameMs,
        sourceIndex: timeline[i],
        repeatsPrevious,
        svg: lastSvg,
      };
    }
  }

  return {
    // Pad, never scale: the ≤1px of slack between the frame and an even
    // canvas is invisible, whereas resampling every frame by a fractional
    // factor would soften all the text.
    width: toEven(frameWidth),
    height: toEven(frameHeight),
    frameWidth,
    frameHeight,
    fps,
    frameCount: timeline.length,
    durationMs: timeline.length * frameMs,
    timeline,
    render,
    frames,
  };
};
