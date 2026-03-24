//#region Imports

import type { GridState, Theme, SpanRow, Gradient } from '../types';
import type { FrameData } from '../pipeline/svg-emitter';
import type { WatermarkConfig, WatermarkStyle } from 'shellfie';

export type { WatermarkConfig, WatermarkStyle };


//#region Terminal State Types

export interface TerminalFrame {
  timestamp: number;
  svg: string;
  state: TerminalState;
}

export interface TerminalState {
  content: string;
  cursorX: number;
  cursorY: number;
  width: number;
  height: number;
  fontSize: number;
  showCursor: boolean;
  activeCursor: boolean;
  selectionStart?: number;
  selectionEnd?: number;
}


//#region Executor Options

export interface CDExecutorOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  lineHeight?: number;
  title?: string;
  template?: 'macos' | 'windows' | 'minimal';
  theme?: Theme | string;
  playbackSpeed?: number;
  padding?: number;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  fontFamily?: string;
  watermark?: string;
  cursorStyle?: string;
  cursorColor?: string;
  cursorBlink?: boolean;
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
  letterSpacing?: number;
  background?: string;
  backgroundPadding?: number;
  backgroundRadius?: number;
  onFrame?: (frame: TerminalFrame) => void;
  onProgress?: (current: number, total: number, description?: string) => void;
}


//#region Executor Context

export interface ExecutorContext {
  grid: GridState;

  lines: string[];
  currentLine: string;
  cursorX: number;
  cursorY: number;

  frames: TerminalFrame[];
  frameData: FrameData[];
  startTime: number;
  captureOverhead: number;
  lastFrameTimestamp: number;

  width: number;
  height: number;
  fontSize: number;
  typingSpeed: number;
  title?: string;
  template: 'macos' | 'windows' | 'minimal';
  theme: Theme;
  promptPrefix: string;
  watermark?: string | WatermarkConfig;
  cursorBlink: boolean;

  selectionStart?: number;
  selectionEnd?: number;

  clipboard: string;

  screenshotCounter: number;
  outputPath?: string;

  autoWidth: boolean;
  autoHeight: boolean;
  maxLineLength: number;
  maxLines: number;
  maxVisualRow: number;

  scroll: boolean;
  scrollOffset: number;

  isExecutingCommand: boolean;
  isMultiLineContinuation: boolean;

  headerBackground?: string;
  footerBackground?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  padding?: number;

  headerHeight?: number;
  headerBorder?: boolean;
  headerBorderColor?: string;
  headerBorderWidth?: number;
  footerHeight?: number;
  footerBorder?: boolean;
  footerBorderColor?: string;
  footerBorderWidth?: number;

  cursorStyle?: 'block' | 'bar' | 'underline';
  cursorColor?: string;

  fontFamily?: string;
  embedFont?: boolean;
  fontData?: string;

  lineHeight: number;
  hasCustomLineHeight: boolean;

  charWidthRatio: number;
  letterSpacing: number;

  shell: string;
  workingDirectory?: string;

  animationSpeed: number;

  loopStyle: 'loop' | 'reverse' | 'rewind' | 'fade';
  loopPause: number;
  fadeDuration: number;
  rewindSpeed: number;

  background?: string | Gradient;
  backgroundPadding: number;
  backgroundRadius: number;

  playbackSpeed: number;
}


//#region Utility Functions

export const stripAnsi = (str: string): string =>
  str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*[A-HJKSTfsu]/g, '')
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '');

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const parseEscapes = (value: string): string =>
  expandEnvVars(
    value
      .replace(/\\e/g, '\x1b')
      .replace(/\\x1b/g, '\x1b')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
  );

/**
 * Expand environment variables in a string.
 * Supports $VAR and ${VAR} syntax.
 */
export const expandEnvVars = (value: string): string =>
  value
    // Handle ${VAR} syntax first (with braces)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, varName) =>
      process.env[varName] ?? ''
    )
    // Handle $VAR syntax (without braces)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, varName) =>
      process.env[varName] ?? ''
    );

