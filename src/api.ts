//#region Imports

import { parseCD } from './parser/cd-parser';
import type { CDCommand, CDScript } from './parser/cd-parser';
import { CDExecutor } from './executor/cd-executor';
import type { CDExecutorOptions, TerminalFrame } from './executor/types';
import {
  createAnimatedSVG,
  createFilmstripSVG,
  getAnimationMetadata,
} from './animator/svg-animator';
import type { AnimationOptions } from './animator/svg-animator';
import { optimizeSvg } from './animator/svg-optimizer';
import { parseCastFile } from './recorder/cast-parser';
import { generateFramesFromRecording } from './recorder/recording-player';
import type { FrameData } from './pipeline/svg-emitter';


//#region Types

export interface DVDOptions extends CDExecutorOptions {
  // Input (pick one)
  steps?: CDCommand[];
  script?: CDScript;
  cdScript?: string;
  castContent?: string;

  // Animation
  fps?: number;
  loop?: boolean;
  loopStyle?: 'loop' | 'reverse' | 'rewind' | 'fade';
  loopPause?: number;
  pauseAtEnd?: number;
  fadeDuration?: number;
  rewindSpeed?: number;

  // Rendering method
  smil?: boolean;        // true = SMIL per-frame (smooth mobile, larger); false = filmstrip (default)

  // Output
  optimize?: boolean;
  customGlyphs?: boolean;
}

export interface DVDResult {
  svg: string;
  frames: TerminalFrame[];
  frameData: FrameData[];
  metadata: { duration: number; frameCount: number; fps: number };
}


//#region API

export const dvd = async (options: DVDOptions): Promise<DVDResult> => {
  // Determine input and build script
  const script = resolveScript(options);

  // Extract executor options (everything except input/animation/output controls)
  const {
    steps: _, script: _s, cdScript: _c, castContent: _cc,
    fps, loop, loopStyle, loopPause, pauseAtEnd, fadeDuration, rewindSpeed,
    smil, optimize, customGlyphs,
    ...executorOptions
  } = options;

  const executor = new CDExecutor(executorOptions);
  const frames = await executor.execute(script);

  // Resolve animation options — script settings as defaults, explicit options override
  const animationOptions: AnimationOptions = {
    fps,
    loop: loop !== false,
    pauseAtEnd: pauseAtEnd ?? 1000,
    loopStyle: loopStyle || executor.getLoopStyle(),
    loopPause: loopPause ?? executor.getLoopPause(),
    fadeDuration: fadeDuration ?? executor.getFadeDuration(),
    rewindSpeed: rewindSpeed ?? executor.getRewindSpeed(),
  };

  let svg: string;

  if (smil) {
    // SMIL: full per-frame SVGs with visibility toggling (smooth 60/120fps on mobile)
    svg = await createAnimatedSVG(frames, animationOptions);
  } else {
    // Filmstrip: row deduplication, smaller files (default)
    const ctx = executor.getContext();
    const frameData = executor.getFrameData();
    svg = createFilmstripSVG({
      frameData,
      theme: ctx.theme,
      width: ctx.width,
      height: ctx.height,
      fontSize: ctx.fontSize,
      template: ctx.template,
      title: ctx.title,
      watermark: typeof ctx.watermark === 'string' ? ctx.watermark : ctx.watermark?.content,
      lineHeight: ctx.fontSize * ctx.lineHeight,
      charWidth: ctx.fontSize * ctx.charWidthRatio,
      padding: ctx.padding,
      borderRadius: ctx.borderRadius,
      borderColor: ctx.borderColor,
      borderWidth: ctx.borderWidth,
      headerHeight: ctx.headerHeight,
      headerBackground: ctx.headerBackground,
      headerBorder: ctx.headerBorder,
      headerBorderColor: ctx.headerBorderColor,
      headerBorderWidth: ctx.headerBorderWidth,
      footerHeight: ctx.footerHeight,
      footerBackground: ctx.footerBackground,
      footerBorder: ctx.footerBorder,
      footerBorderColor: ctx.footerBorderColor,
      footerBorderWidth: ctx.footerBorderWidth,
      cursorStyle: ctx.cursorStyle,
      cursorColor: ctx.cursorColor,
      cursorBlink: ctx.cursorBlink,
      fontFamily: ctx.fontFamily,
      letterSpacing: ctx.letterSpacing,
      embedFont: ctx.embedFont,
      fontData: ctx.fontData,
      background: ctx.background,
      backgroundPadding: ctx.backgroundPadding,
      backgroundRadius: ctx.backgroundRadius,
      customGlyphs: customGlyphs ?? true,
    }, animationOptions);
  }

  if (optimize !== false) {
    svg = optimizeSvg(svg);
  }

  const metadata = getAnimationMetadata(frames);
  const frameData = executor.getFrameData();

  await executor.cleanup();

  return { svg, frames, frameData, metadata };
};


//#region Input Resolution

const resolveScript = (options: DVDOptions): CDScript => {
  if (options.script) {
    return options.script;
  }

  if (options.cdScript) {
    return parseCD(options.cdScript);
  }

  if (options.steps) {
    return {
      commands: options.steps,
      settings: new Map(),
      requirements: [],
    };
  }

  if (options.castContent) {
    // Convert cast to a script with a single "replay" — the executor doesn't
    // handle cast directly, so we generate frames via the recording player
    // and wrap them. For now, throw — cast support is a future enhancement
    // that needs its own path (generateFramesFromRecording → filmstrip/SMIL).
    throw new Error('Cast content input is not yet supported via dvd(). Use parseCastFile() and generateFramesFromRecording() directly.');
  }

  throw new Error('No input provided. Pass one of: steps, script, cdScript, or castContent.');
};
