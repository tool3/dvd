//#region Imports

import type { AnimationOptions } from './animator/svg-animator';
import {
  createAnimatedSVG,
  createFilmstripSVG,
  getAnimationMetadata,
} from './animator/svg-animator';
import { optimizeSvg } from './animator/svg-optimizer';
import { CDExecutor } from './executor/cd-executor';
import type { TerminalFrame } from './executor/types';
import type { CDCommand, CDScript } from './parser/cd-parser';
import { parseCD } from './parser/cd-parser';
import type { FrameData } from './pipeline/svg-emitter';
import { emit } from './pipeline/svg-emitter';
import { processRawOutput } from './pipeline/raw-output';
import { themes } from './pipeline';
import type { Theme } from './types';


//#region Types

/** Raw terminal output with ANSI escape codes */
export interface RawInput {
  raw: string;
  /** Total duration of the captured output in ms (used for frame timing) */
  totalDuration?: number;
}

/** Pre-parsed CDScript object */
export interface ScriptInput {
  script: CDScript;
}

/**
 * Input to dvd().
 * - `string` — cd script text
 * - `CDCommand[]` — programmatic steps
 * - `{ raw: string }` — raw terminal output with ANSI escape codes
 * - `{ script: CDScript }` — pre-parsed cd script
 */
export type DVDInput = string | CDCommand[] | RawInput | ScriptInput;

export interface DVDOptions {
  // Appearance
  width?: number;
  height?: number;
  fontSize?: number;
  lineHeight?: number;
  title?: string;
  template?: 'macos' | 'windows' | 'minimal';
  theme?: Theme | string;
  padding?: number;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  fontFamily?: string;
  watermark?: string;
  letterSpacing?: number;

  // Cursor
  cursorStyle?: string;
  cursorColor?: string;
  cursorBlink?: boolean;

  // Header / footer
  headerBackground?: string;
  headerHeight?: number;
  headerBorder?: boolean;
  headerBorderColor?: string;
  headerBorderWidth?: number;
  footerBackground?: string;
  footerHeight?: number;
  footerBorder?: boolean;
  footerBorderColor?: string;
  footerBorderWidth?: number;

  // Background
  background?: string;
  backgroundPadding?: number;
  backgroundRadius?: number;

  // Animation
  fps?: number;
  loop?: boolean;
  loopStyle?: 'loop' | 'reverse' | 'rewind' | 'fade';
  loopPause?: number;
  pauseAtEnd?: number;
  fadeDuration?: number;
  rewindSpeed?: number;
  playbackSpeed?: number;

  // Rendering method
  smil?: boolean;

  // Output
  optimize?: boolean;
  customGlyphs?: boolean;

  // Callbacks
  onFrame?: (frame: TerminalFrame) => void;
  onProgress?: (current: number, total: number, description?: string) => void;
}

export interface DVDResult {
  svg: string;
  frames: TerminalFrame[];
  frameData: FrameData[];
  metadata: { duration: number; frameCount: number; fps: number };
}


//#region Input Classification

const isRawInput = (input: DVDInput): input is RawInput =>
  typeof input === 'object' && !Array.isArray(input) && 'raw' in input;

const isScriptInput = (input: DVDInput): input is ScriptInput =>
  typeof input === 'object' && !Array.isArray(input) && 'script' in input;


//#region Theme Resolution

const resolveThemeOption = (theme?: Theme | string): Theme => {
  if (!theme) return themes.dark;
  if (typeof theme === 'object') return theme;
  return (themes as Record<string, Theme>)[theme] ?? themes.dark;
};


//#region API

const dvd = async (input: DVDInput, options: DVDOptions = {}): Promise<DVDResult> => {
  if (isRawInput(input)) {
    return dvdFromRawOutput(input, options);
  }
  return dvdFromScript(input, options);
};


//#region Raw Output Path

const dvdFromRawOutput = async (input: RawInput, options: DVDOptions): Promise<DVDResult> => {
  const {
    fps, loop, loopStyle, loopPause, pauseAtEnd, fadeDuration, rewindSpeed,
    smil, optimize, customGlyphs,
  } = options;

  const fontSize = options.fontSize ?? 14;
  const lineHeight = options.lineHeight ?? 1.4;
  const padding = options.padding ?? 16;
  const theme = resolveThemeOption(options.theme);
  const template = options.template ?? 'macos';
  const charWidthRatio = 0.6;

  const { frameData, width, height } = processRawOutput(input.raw, {
    theme,
    width: options.width,
    height: options.height,
    fontSize,
    lineHeight,
    padding,
    headerHeight: options.headerHeight,
    letterSpacing: options.letterSpacing,
    watermark: options.watermark,
    playbackSpeed: options.playbackSpeed,
    totalDuration: input.totalDuration,
  });

  const animationOptions: AnimationOptions = {
    fps,
    loop: loop !== false,
    pauseAtEnd: pauseAtEnd ?? 1000,
    loopStyle: loopStyle || 'loop',
    loopPause: loopPause ?? 0,
    fadeDuration: fadeDuration ?? 1500,
    rewindSpeed: rewindSpeed ?? 5,
  };

  let svg: string;

  if (smil) {
    const frames: TerminalFrame[] = frameData.map((fd) => {
      const { svg: frameSvg } = emit(fd.rows, fd.cursor, fd.cursorVisible, {
        theme,
        template,
        width,
        height,
        fontSize,
        title: options.title,
        lineHeight: fontSize * lineHeight,
        charWidth: fontSize * charWidthRatio,
        padding,
        borderRadius: options.borderRadius,
        borderColor: options.borderColor,
        borderWidth: options.borderWidth,
        fontFamily: options.fontFamily,
        letterSpacing: options.letterSpacing,
        watermark: options.watermark,
        cursorStyle: (options.cursorStyle as 'block' | 'bar' | 'underline') ?? 'block',
        cursorColor: options.cursorColor,
        cursorBlink: options.cursorBlink,
        headerBackground: options.headerBackground,
        headerHeight: options.headerHeight,
        headerBorder: options.headerBorder,
        headerBorderColor: options.headerBorderColor,
        headerBorderWidth: options.headerBorderWidth,
        footerBackground: options.footerBackground,
        footerHeight: options.footerHeight,
        footerBorder: options.footerBorder,
        footerBorderColor: options.footerBorderColor,
        footerBorderWidth: options.footerBorderWidth,
        background: options.background,
        backgroundPadding: options.backgroundPadding,
        backgroundRadius: options.backgroundRadius,
      });

      return {
        timestamp: fd.timestamp,
        svg: frameSvg,
        state: {
          content: '',
          cursorX: fd.cursor?.col ?? 0,
          cursorY: fd.cursor?.row ?? 0,
          width,
          height,
          fontSize,
          showCursor: false,
          activeCursor: false,
        },
      };
    });

    svg = await createAnimatedSVG(frames, animationOptions);
  } else {
    svg = createFilmstripSVG({
      frameData,
      theme,
      width,
      height,
      fontSize,
      template,
      title: options.title,
      watermark: options.watermark,
      lineHeight: fontSize * lineHeight,
      charWidth: fontSize * charWidthRatio,
      padding,
      borderRadius: options.borderRadius,
      borderColor: options.borderColor,
      borderWidth: options.borderWidth,
      headerHeight: options.headerHeight,
      headerBackground: options.headerBackground,
      headerBorder: options.headerBorder,
      headerBorderColor: options.headerBorderColor,
      headerBorderWidth: options.headerBorderWidth,
      footerHeight: options.footerHeight,
      footerBackground: options.footerBackground,
      footerBorder: options.footerBorder,
      footerBorderColor: options.footerBorderColor,
      footerBorderWidth: options.footerBorderWidth,
      cursorStyle: options.cursorStyle as 'block' | 'bar' | 'underline',
      cursorColor: options.cursorColor,
      cursorBlink: options.cursorBlink,
      fontFamily: options.fontFamily,
      letterSpacing: options.letterSpacing,
      background: options.background,
      backgroundPadding: options.backgroundPadding,
      backgroundRadius: options.backgroundRadius,
      customGlyphs: customGlyphs ?? true,
    }, animationOptions);
  }

  if (optimize !== false) {
    svg = optimizeSvg(svg);
  }

  const frames: TerminalFrame[] = frameData.map((fd) => ({
    timestamp: fd.timestamp,
    svg: '',
    state: {
      content: '',
      cursorX: fd.cursor?.col ?? 0,
      cursorY: fd.cursor?.row ?? 0,
      width,
      height,
      fontSize,
      showCursor: false,
      activeCursor: false,
    },
  }));

  const metadata = getAnimationMetadata(frames);
  return { svg, frames, frameData, metadata };
};


//#region Script Path

const resolveScript = (input: DVDInput): CDScript => {
  if (typeof input === 'string') {
    return parseCD(input);
  }

  if (Array.isArray(input)) {
    return {
      commands: input,
      settings: new Map(),
      requirements: [],
    };
  }

  if (isScriptInput(input)) {
    return input.script;
  }

  throw new Error('No input provided. Pass a cd script string, steps array, { raw } object, or { script } object.');
};

const dvdFromScript = async (input: DVDInput, options: DVDOptions): Promise<DVDResult> => {
  const script = resolveScript(input);

  const {
    fps, loop, loopStyle, loopPause, pauseAtEnd, fadeDuration, rewindSpeed,
    smil, optimize, customGlyphs,
    ...executorOptions
  } = options;

  const executor = new CDExecutor(executorOptions);
  const frames = await executor.execute(script);

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
    const ctx = executor.getContext();
    const frameData = executor.getFrameData();
    for (let i = 0; i < frames.length; i++) {
      if (!frames[i].svg && i < frameData.length) {
        const { svg: frameSvg } = emit(frameData[i].rows, frameData[i].cursor, frameData[i].cursorVisible, {
          theme: ctx.theme,
          template: ctx.template,
          width: ctx.width,
          height: ctx.height,
          fontSize: ctx.fontSize,
          title: ctx.title,
          lineHeight: ctx.fontSize * ctx.lineHeight,
          charWidth: ctx.fontSize * ctx.charWidthRatio,
          padding: ctx.padding,
          borderRadius: ctx.borderRadius,
          borderColor: ctx.borderColor,
          borderWidth: ctx.borderWidth,
          fontFamily: ctx.fontFamily,
          letterSpacing: ctx.letterSpacing,
          embedFont: ctx.embedFont,
          fontData: ctx.fontData,
          watermark: typeof ctx.watermark === 'string' ? ctx.watermark : ctx.watermark?.content,
          headerBackground: ctx.headerBackground,
          headerHeight: ctx.headerHeight,
          headerBorder: ctx.headerBorder,
          headerBorderColor: ctx.headerBorderColor,
          headerBorderWidth: ctx.headerBorderWidth,
          footerBackground: ctx.footerBackground,
          footerHeight: ctx.footerHeight,
          footerBorder: ctx.footerBorder,
          footerBorderColor: ctx.footerBorderColor,
          footerBorderWidth: ctx.footerBorderWidth,
          background: ctx.background,
          backgroundPadding: ctx.backgroundPadding,
          backgroundRadius: ctx.backgroundRadius,
          cursorStyle: ctx.cursorStyle as 'block' | 'bar' | 'underline',
          cursorColor: ctx.cursorColor,
          cursorBlink: ctx.cursorBlink,
        });
        frames[i].svg = frameSvg;
      }
    }
    svg = await createAnimatedSVG(frames, animationOptions);
  } else {
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


export default dvd;
