//#region Imports

import type { Theme } from '../types';
import type { FrameData } from './svg-emitter';
import { createGridState, processInput } from './vterminal';
import { coalesce } from './coalescer';


//#region Types

export type AnimationType = 'terminal-reset' | 'cursor-up' | 'cursor-restore' | 'clear-line' | 'none';

export interface RawOutputResult {
  frameData: FrameData[];
  width: number;
  height: number;
}

export interface RawOutputOptions {
  theme: Theme;
  width?: number;
  height?: number;
  fontSize?: number;
  lineHeight?: number;
  padding?: number;
  headerHeight?: number;
  letterSpacing?: number;
  watermark?: string;
  playbackSpeed?: number;
  /** Total duration of the piped input in ms (used for frame timing) */
  totalDuration?: number;
}


//#region Animation Detection

export const detectAnimationType = (content: string): AnimationType => {
  if (content.includes('\x1bc')) {
    return 'terminal-reset';
  }
  if (/\x1b\[\d+A/.test(content)) {
    return 'cursor-up';
  }
  if (content.includes('\x1b8') || content.includes('\x1b[?25l')) {
    return 'cursor-restore';
  }
  if (content.includes('\x1b[2K\x1b[0G') || content.includes('\x1b[2K')) {
    return 'clear-line';
  }
  return 'none';
};


//#region Frame Splitting

export const splitIntoFrames = (content: string, animationType: AnimationType): string[] => {
  if (animationType === 'terminal-reset') {
    return content.split('\x1bc').filter(frame => frame.trim());
  }

  if (animationType === 'cursor-up') {
    const frames: string[] = [];
    const parts = content.split(/\x1b\[\d+A/);

    for (const part of parts) {
      if (part.trim()) {
        // Strip leading newline — artifact of previous frame's trailing newline
        // and cursor-up repositioning
        const cleaned = part.startsWith('\n') ? part.slice(1) : part;
        frames.push(cleaned);
      }
    }

    return frames.length > 0 ? frames : [content];
  }

  if (animationType === 'cursor-restore') {
    return content.split('\x1b8').filter(frame => frame.trim());
  }

  if (animationType === 'clear-line') {
    return content.split(/\x1b\[2K\x1b\[0G|\x1b\[2K/).filter(frame => frame.trim());
  }

  return [content];
};


//#region Dimension Auto-Detection

export const detectDimensions = (
  frameContents: string[],
  animationType: AnimationType,
  options: {
    fontSize: number;
    lineHeight: number;
    padding: number;
    headerHeight: number;
    letterSpacing: number;
    watermarkLineHeight: number;
  },
): { width: number; height: number } => {
  const { fontSize, lineHeight, padding, headerHeight, letterSpacing, watermarkLineHeight } = options;
  const charWidth = fontSize * 0.6;
  const effectiveCharWidth = charWidth + letterSpacing;
  const lineHeightPx = fontSize * lineHeight;

  let maxLineLength = 40;
  let maxLineCount = 10;

  // For cursor-up, frames overlay — only check the first frame
  const framesToCheck = animationType === 'cursor-up' && frameContents.length > 1
    ? [frameContents[0]]
    : frameContents;

  for (const frame of framesToCheck) {
    // Plain text analysis (strip SGR sequences only)
    const plainText = frame.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = plainText.split('\n');
    const nonEmptyLines = lines.filter(l => l.length > 0);
    const plainTextMaxLength = nonEmptyLines.length > 0 ? Math.max(...nonEmptyLines.map(l => l.length)) : 0;
    const plainTextLineCount = nonEmptyLines.length;

    const estimatedCols = Math.min(Math.max(plainTextMaxLength, 80), 500);
    const estimatedRows = Math.min(Math.max(lines.length, 24), 200);

    // Process through grid to find actual content bounds (including colored backgrounds)
    const grid = createGridState(estimatedCols, estimatedRows);
    const processed = processInput(grid, frame);

    let maxRow = 0;
    let maxCol = 0;

    for (let row = 0; row < processed.cells.length; row++) {
      let rowHasContent = false;
      for (let col = 0; col < processed.cells[row].length; col++) {
        const cell = processed.cells[row][col];
        const hasNonDefaultBg = cell.bg && cell.bg.mode !== 'default';
        if (cell.char !== ' ' || hasNonDefaultBg) {
          maxRow = Math.max(maxRow, row);
          maxCol = Math.max(maxCol, col);
          rowHasContent = true;
        }
      }
      if (!rowHasContent && maxRow > 0 && row > maxRow + 10) {
        break;
      }
    }

    maxLineCount = Math.max(maxLineCount, maxRow + 1, plainTextLineCount);
    maxLineLength = Math.max(maxLineLength, maxCol + 1, plainTextMaxLength);
  }

  const width = Math.ceil(maxLineLength * effectiveCharWidth + padding * 2);
  const height = Math.ceil((maxLineCount + 2) * lineHeightPx + headerHeight + padding * 2 + watermarkLineHeight);

  return { width, height };
};


//#region Process Raw Output

/**
 * Process raw terminal output (with ANSI escape codes) into frame data
 * ready for SVG rendering. Handles animation detection, frame splitting,
 * and dimension auto-detection.
 */
export const processRawOutput = (
  rawOutput: string,
  options: RawOutputOptions,
): RawOutputResult => {
  const fontSize = options.fontSize ?? 14;
  const lineHeight = options.lineHeight ?? 1.4;
  const padding = options.padding ?? 16;
  const headerHeight = options.headerHeight ?? 40;
  const letterSpacing = options.letterSpacing ?? 0;
  const lineHeightPx = fontSize * lineHeight;
  const watermarkLineHeight = options.watermark ? lineHeightPx : 0;
  const speed = options.playbackSpeed ?? 1;

  const animationType = detectAnimationType(rawOutput);
  const frameContents = splitIntoFrames(rawOutput, animationType);

  if (frameContents.length === 0) {
    throw new Error('No frames detected in raw output');
  }

  // Resolve dimensions
  let width = options.width;
  let height = options.height;

  if (!width || !height) {
    const detected = detectDimensions(frameContents, animationType, {
      fontSize,
      lineHeight,
      padding,
      headerHeight,
      letterSpacing,
      watermarkLineHeight,
    });
    if (!width) width = detected.width;
    if (!height) height = detected.height;
  }

  // Calculate grid dimensions
  const charWidth = fontSize * 0.6;
  const gridWidth = Math.floor((width - padding * 2) / charWidth);
  const gridHeight = Math.floor((height - headerHeight - padding * 2 - watermarkLineHeight) / lineHeightPx);

  // Calculate frame timing
  let frameDuration: number;
  const totalDuration = options.totalDuration ?? 0;
  if (totalDuration > 100 && frameContents.length > 1) {
    frameDuration = totalDuration / (frameContents.length - 1);
  } else {
    frameDuration = 1000 / 30;
  }

  // Generate frame data
  const frameData: FrameData[] = frameContents.map((content, i) => {
    let timestamp = i * frameDuration;
    if (speed !== 1 && speed > 0) {
      timestamp = Math.round(timestamp / speed);
    }

    let grid = createGridState(gridWidth, gridHeight);
    grid = processInput(grid, content);
    const rows = coalesce(grid, options.theme);

    return {
      rows,
      cursor: { row: grid.cursor.row, col: grid.cursor.col },
      cursorVisible: false,
      timestamp,
      activeCursor: false,
    };
  });

  return { frameData, width, height };
};
