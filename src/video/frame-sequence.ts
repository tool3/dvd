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

/**
 * Output quality tier.
 *
 * The dominant lever is `scale` — supersampling. Terminal output is thin
 * high-contrast glyph edges, which is the worst case for a block-based
 * codec at 1:1; rendering the vector larger and letting the player
 * downscale is what makes a video read as crisply as the SVG it came from.
 * Frame rate is the second lever. Bitrate matters least, because flat
 * colour compresses almost for free.
 */
export type VideoQuality = 'low' | 'medium' | 'high';

export interface VideoQualityPreset {
  /** Supersampling factor applied to the rasterized frame size. */
  scale: number;
  /** Constant-rate factor for x264/VP9. Lower is better quality. */
  crf: number;
  /** Bits per pixel, used to size a WebCodecs bitrate. */
  bitsPerPixel: number;
  /**
   * Output frame rate, or `'auto'` to derive it from how fast the
   * recording actually moves (see `autoFps`).
   */
  fps: number | 'auto';
}

export const VIDEO_QUALITY: Record<VideoQuality, VideoQualityPreset> = {
  /** Half the detail budget — for quick previews and chat attachments. */
  low: { scale: 1, crf: 30, bitsPerPixel: 1.5, fps: 15 },
  /** The long-standing default. 1:1 with the SVG's own pixel size. */
  medium: { scale: 1, crf: 18, bitsPerPixel: 4, fps: 30 },
  /**
   * 3x supersampled, near-lossless, and running at whatever frame rate the
   * recording can actually fill — the tier that should be
   * indistinguishable from the SVG even when zoomed.
   *
   * 3x rather than 2x on purpose: 2x merely matches a retina display at
   * 100%, whereas this tier exists for people who will scale the video up
   * (slides, full-screen, a big README hero). Nine times the pixels at up
   * to twice the frame rate, so encode time and file size grow
   * accordingly — still small in absolute terms because flat terminal
   * colour compresses so well.
   */
  high: { scale: 3, crf: 14, bitsPerPixel: 12, fps: 'auto' },
};

/**
 * Standard output rates `'auto'` chooses between.
 *
 * Snapping to one of these rather than emitting the raw measured rate: a
 * source whose frames land 33ms apart implies 31fps, which is a peculiar
 * number to hand a player or an editor.
 *
 * 120 and 240 are reachable but rarely chosen, because most frame sources
 * are already capped at one frame per 16ms (`minFrameInterval` in the
 * recording player, and the shell-animation resampler). What does get past
 * that is a fast `TypingSpeed` or a `playbackSpeed` above 1, both of which
 * compress timestamps arbitrarily — and there the higher rates earn their
 * keep. Measured, on 60 source frames:
 *
 *   gap    30fps      60fps      120fps     240fps
 *   50ms   all kept   all kept   all kept   all kept
 *   33ms   all kept   all kept   all kept   all kept
 *   16ms   30 of 60   58 of 60   all kept   all kept
 *    8ms   16 of 60   30 of 60   58 of 60   all kept
 *    4ms    9 of 60   16 of 60   30 of 60   58 of 60
 */
const AUTO_FPS_STEPS = [30, 60, 120, 240] as const;

/**
 * The frame rate the `'auto'` tier picks for a recording.
 *
 * Frames arrive at irregular times, and resampling onto a constant grid
 * keeps only the most recent frame at each tick — so any two source frames
 * closer together than one tick collapse into one, and the faster of the
 * two is simply lost. This finds the tightest gap, works out the rate that
 * would preserve it, and snaps to the *nearest* standard rate.
 *
 * Nearest rather than next-above, which is worth being precise about: a
 * 33ms recording needs 31fps, and 30fps turns out to keep every single
 * frame — the grid drifts by only 0.33ms per tick, far less than one frame
 * — while rounding up to 60 measurably cost ~28% more bytes to show the
 * exact same content twice. Rounding up buys nothing on the low side, and
 * on the high side the steps are close enough together that the nearest is
 * never more than a couple of frames from lossless.
 *
 * Bounded at both ends. The floor keeps `'auto'` from dropping *below*
 * medium on a slow recording (typing at 50ms/char only needs 20fps), and
 * the ceiling absorbs pathological 1ms gaps — the executor nudges
 * colliding timestamps by a millisecond to keep them monotonic, which
 * taken literally would imply 1000fps.
 */
export const autoFps = (frameData: FrameData[]): number => {
  const gaps: number[] = [];
  for (let i = 1; i < frameData.length; i++) {
    const delta = frameData[i].timestamp - frameData[i - 1].timestamp;
    if (delta > 0) gaps.push(delta);
  }
  if (gaps.length === 0) return AUTO_FPS_STEPS[0];

  // The 10th-percentile gap, not the smallest one. A single outlier must
  // not set the frame rate for the whole video: the executor nudges
  // colliding timestamps 1ms apart to keep them ordered, and one such pair
  // in an otherwise 33ms recording would otherwise imply 1000fps and
  // multiply the frame count eightfold to show identical content. A
  // percentile ignores a handful of artifacts while still reacting to a
  // source that is genuinely fast throughout.
  gaps.sort((a, b) => a - b);
  const tightest = gaps[Math.floor(gaps.length * 0.1)];

  const needed = 1000 / tightest;
  let best: number = AUTO_FPS_STEPS[0];
  for (const step of AUTO_FPS_STEPS) {
    if (Math.abs(step - needed) < Math.abs(best - needed)) best = step;
  }
  return best;
};

export const resolveQuality = (
  quality: VideoQuality = 'medium',
): VideoQualityPreset => VIDEO_QUALITY[quality] ?? VIDEO_QUALITY.medium;

export interface VideoPlanOptions {
  /** Emitter options — the same object shape the animated emitters take. */
  emitter: EmitterOptions;
  /** Constant output frame rate. Overrides the quality tier's own rate. */
  fps?: number;
  /** How many times the animation plays. Default 1. */
  loops?: number;
  /** Hold the final frame this long (ms) at the end of every pass. */
  pauseAtEnd?: number;
  /** Quality tier. Default `medium`. */
  quality?: VideoQuality;
  /** Explicit supersampling factor, overriding the tier's `scale`. */
  scale?: number;
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
  /** Quality tier this plan was built for. */
  quality: VideoQuality;
  /** Encoder settings for the tier — `crf` for ffmpeg, `bitsPerPixel` for
   *  WebCodecs. `scale` is already baked into the frame dimensions. */
  encoding: VideoQualityPreset;
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
 * Resize an emitted frame by rewriting its root `width`/`height`.
 *
 * Supersampling happens here, in the markup, rather than in each consumer's
 * rasterizer. The emitter always writes a `viewBox`, so enlarging the
 * intrinsic size re-renders the vector at that size — real extra detail,
 * not an upscaled bitmap — and every downstream stage keeps working
 * unchanged because it already measures the frame it is handed.
 */
const resizeSvgRoot = (
  svg: string,
  width: number,
  height: number,
  natural: { width: number; height: number },
): string => {
  const end = svg.indexOf('>');
  if (end === -1) return svg;
  let root = svg.slice(0, end + 1);

  // Without a viewBox, changing width/height would crop instead of scale.
  if (!/[\s"']viewBox\s*=/.test(root)) {
    root = root.replace(
      /^<svg/,
      `<svg viewBox="0 0 ${natural.width} ${natural.height}"`,
    );
  }

  const setAttr = (source: string, attr: string, value: number): string => {
    const pattern = new RegExp(`([\\s"']${attr}\\s*=\\s*["'])[\\d.]+(["'])`);
    return pattern.test(source)
      ? source.replace(pattern, `$1${value}$2`)
      : source.replace(/^<svg/, `<svg ${attr}="${value}"`);
  };

  root = setAttr(root, 'width', width);
  root = setAttr(root, 'height', height);
  return root + svg.slice(end + 1);
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

  const quality = options.quality ?? 'medium';
  const preset = resolveQuality(quality);

  // Explicit fps wins; otherwise the tier decides, and `'auto'` asks the
  // recording itself how fast it actually moves.
  const fps =
    options.fps && options.fps > 0
      ? options.fps
      : preset.fps === 'auto'
        ? autoFps(frameData)
        : preset.fps || DEFAULT_FPS;

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
  const rawProbe = renderSource(timeline[0]);
  const measured = measureSvg(rawProbe);
  if (!measured) {
    throw new Error('Could not determine the emitted frame size for video encoding.');
  }

  const scale =
    options.scale && options.scale > 0 ? options.scale : preset.scale;

  // Ceil, not round: the emitter can produce fractional sizes (a watermark
  // adds `fontSize * lineHeight`, e.g. 19.6px), and rounding down would
  // clip the last row of pixels off every frame.
  const frameWidth = Math.ceil(measured.width * scale);
  const frameHeight = Math.ceil(measured.height * scale);

  const sized = (svg: string): string =>
    scale === 1 && frameWidth === measured.width && frameHeight === measured.height
      ? svg
      : resizeSvgRoot(svg, frameWidth, frameHeight, measured);

  const probeSvg = sized(rawProbe);

  const render = (index: number): string => {
    const sourceIndex = timeline[index];
    if (sourceIndex === undefined) {
      throw new Error(
        `Frame ${index} is out of range (sequence has ${timeline.length} frames)`,
      );
    }
    return sourceIndex === timeline[0]
      ? probeSvg
      : sized(renderSource(sourceIndex));
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
    quality,
    encoding: preset,
    fps,
    frameCount: timeline.length,
    durationMs: timeline.length * frameMs,
    timeline,
    render,
    frames,
  };
};
