//#region Imports

import type { ExecutorContext, TerminalFrame, TerminalState, CDExecutorOptions } from './types';
import { stripAnsi } from './types';
import { createGridState, processInput } from '../pipeline/vterminal';
import { coalesce } from '../pipeline/coalescer';
import { emit } from '../pipeline/svg-emitter';


//#region Grapheme Helpers

/**
 * Segment a string into grapheme clusters.
 */
const segmentGraphemes = (str: string): string[] => {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return [...segmenter.segment(str)].map((s) => s.segment);
  }
  return [...str];
};

/**
 * Get substring by grapheme position (not UTF-16 code units).
 */
const substringByGrapheme = (str: string, start: number, end?: number): string => {
  const graphemes = segmentGraphemes(str);
  return graphemes.slice(start, end).join('');
};


//#region Visible Line Count

export const getVisibleLineCount = (ctx: ExecutorContext): number => {
  const headerHeight = ctx.template === 'minimal' ? 0 : 40;
  const padding = ctx.padding ?? 16;
  const lineHeight = ctx.fontSize * ctx.lineHeight;
  const watermarkHeight = ctx.watermark ? lineHeight : 0;
  const contentHeight = ctx.height - headerHeight - padding - watermarkHeight - padding;
  return Math.floor(contentHeight / lineHeight);
};


//#region Frame Capture

export const captureFrame = (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  showCursor: boolean = true,
  activeCursor: boolean = false
): void => {
  const buffer = [...ctx.lines];

  const displayLine = ctx.isExecutingCommand || ctx.isMultiLineContinuation
    ? ctx.currentLine
    : ctx.promptPrefix + ctx.currentLine;

  buffer[ctx.cursorY] = displayLine;

  const charWidth = ctx.fontSize * ctx.charWidthRatio;
  const lineHeight = ctx.fontSize * ctx.lineHeight;
  const padding = ctx.padding ?? 16;
  const headerHeight = ctx.template === 'minimal' ? 0 : 40;
  const contentStartY = headerHeight + padding;
  const maxContentHeight = ctx.height - contentStartY - padding;
  const maxVisibleRows = Math.floor(maxContentHeight / lineHeight);
  const visibleCols = Math.floor((ctx.width - padding * 2) / charWidth);

  if (ctx.autoWidth) {
    for (const line of buffer) {
      // Trim trailing whitespace for auto-width calculation
      // Shell output often includes padding to terminal width
      const lineLength = stripAnsi(line).trimEnd().length;
      if (lineLength > ctx.maxLineLength) {
        ctx.maxLineLength = lineLength;
      }
    }
  }

  if (!ctx.scroll && ctx.autoHeight) {
    if (buffer.length > ctx.maxLines) {
      ctx.maxLines = buffer.length;
    }
  }

  let visibleBuffer: string[];
  const visibleLines = getVisibleLineCount(ctx);

  if (ctx.scroll) {
    if (ctx.cursorY >= ctx.scrollOffset + visibleLines) {
      ctx.scrollOffset = ctx.cursorY - visibleLines + 1;
    } else if (ctx.cursorY < ctx.scrollOffset) {
      ctx.scrollOffset = ctx.cursorY;
    }

    const startLine = ctx.scrollOffset;
    const endLine = Math.min(startLine + visibleLines, buffer.length);
    visibleBuffer = buffer.slice(startLine, endLine);
  } else {
    visibleBuffer = buffer;
    ctx.scrollOffset = 0;
  }

  const content = visibleBuffer.join('\n');

  let gridWidth: number;
  let gridHeight = ctx.grid.height;

  if (ctx.autoWidth) {
    // Start from 0 and find max line length - don't use ctx.grid.width as minimum
    // because that would include the default terminal width padding
    gridWidth = 0;
    for (const line of visibleBuffer) {
      const lineLength = stripAnsi(line).length;
      gridWidth = Math.max(gridWidth, lineLength + 1);
    }
    gridHeight = Math.max(gridHeight, visibleBuffer.length + 1);
  } else {
    gridWidth = visibleCols;
    if (!ctx.scroll) {
      let estimatedRows = 0;
      for (const line of visibleBuffer) {
        const lineLength = stripAnsi(line).length;
        estimatedRows += Math.ceil(lineLength / visibleCols) || 1;
      }
      gridHeight = Math.max(gridHeight, estimatedRows + 5);
    }
  }

  let grid = createGridState(gridWidth, gridHeight);
  grid = processInput(grid, content);

  const shouldClampCursor = !ctx.autoHeight && ctx.scroll;

  let finalCursorX: number;
  let finalCursorY: number;

  if (ctx.isExecutingCommand) {
    finalCursorY = shouldClampCursor
      ? Math.max(0, Math.min(grid.cursor.row, maxVisibleRows - 1))
      : grid.cursor.row;
    finalCursorX = grid.cursor.col;
  } else {
    const cursorBuffer = [...ctx.lines];
    const textUpToCursor = substringByGrapheme(ctx.currentLine, 0, ctx.cursorX);
    const displayLineUpToCursor = ctx.promptPrefix + textUpToCursor;
    cursorBuffer[ctx.cursorY] = displayLineUpToCursor;

    let cursorVisibleBuffer: string[];
    if (ctx.scroll) {
      const startLine = ctx.scrollOffset;
      const endLine = Math.min(startLine + getVisibleLineCount(ctx), cursorBuffer.length);
      cursorVisibleBuffer = cursorBuffer.slice(startLine, endLine);
    } else {
      cursorVisibleBuffer = cursorBuffer;
    }

    const cursorContent = cursorVisibleBuffer.join('\n');
    let cursorGrid = createGridState(gridWidth, gridHeight);
    cursorGrid = processInput(cursorGrid, cursorContent);

    finalCursorY = shouldClampCursor
      ? Math.max(0, Math.min(cursorGrid.cursor.row, maxVisibleRows - 1))
      : cursorGrid.cursor.row;
    finalCursorX = cursorGrid.cursor.col;
  }

  if (ctx.autoHeight) {
    if (grid.cursor.row + 1 > ctx.maxVisualRow) {
      ctx.maxVisualRow = grid.cursor.row + 1;
    }
  }

  const rows = coalesce(grid, ctx.theme);

  const selection =
    ctx.selectionStart !== undefined &&
    ctx.selectionEnd !== undefined &&
    ctx.selectionStart !== ctx.selectionEnd
      ? {
          start: ctx.selectionStart + (ctx.isExecutingCommand ? 0 : stripAnsi(ctx.promptPrefix).length),
          end: ctx.selectionEnd + (ctx.isExecutingCommand ? 0 : stripAnsi(ctx.promptPrefix).length),
          row: finalCursorY,
        }
      : null;

  const { svg } = emit(
    rows,
    showCursor ? { row: finalCursorY, col: finalCursorX } : null,
    showCursor,
    {
      theme: ctx.theme,
      template: ctx.template,
      width: ctx.width,
      height: ctx.height,
      fontSize: ctx.fontSize,
      title: ctx.title,
      watermark: ctx.watermark,
      headerBackground: ctx.headerBackground,
      footerBackground: ctx.footerBackground,
      borderColor: ctx.borderColor,
      borderWidth: ctx.borderWidth,
      borderRadius: ctx.borderRadius,
      padding: ctx.padding,
      cursorBlink: ctx.cursorBlink,
      activeCursor,
      selection,
      headerHeight: ctx.headerHeight,
      headerBorder: ctx.headerBorder,
      headerBorderColor: ctx.headerBorderColor,
      headerBorderWidth: ctx.headerBorderWidth,
      footerHeight: ctx.footerHeight,
      footerBorder: ctx.footerBorder,
      footerBorderColor: ctx.footerBorderColor,
      footerBorderWidth: ctx.footerBorderWidth,
      cursorStyle: ctx.cursorStyle,
      cursorColor: ctx.cursorColor,
      fontFamily: ctx.fontFamily,
      embedFont: ctx.embedFont,
      fontData: ctx.fontData,
      lineHeight: ctx.fontSize * ctx.lineHeight,
      hasCustomLineHeight: ctx.hasCustomLineHeight,
      charWidth: ctx.fontSize * ctx.charWidthRatio,
      letterSpacing: ctx.letterSpacing,
      background: ctx.background,
      backgroundPadding: ctx.backgroundPadding,
      backgroundRadius: ctx.backgroundRadius,
    }
  );

  const state: TerminalState = {
    content,
    cursorX: finalCursorX,
    cursorY: finalCursorY,
    width: ctx.width,
    height: ctx.height,
    fontSize: ctx.fontSize,
    showCursor,
    activeCursor,
    selectionStart: ctx.selectionStart,
    selectionEnd: ctx.selectionEnd,
  };

  // Calculate timestamp, ensuring it's always >= the last frame's timestamp
  // This prevents out-of-order frames due to captureOverhead adjustments
  let timestamp = Date.now() - ctx.startTime - ctx.captureOverhead;
  if (timestamp <= ctx.lastFrameTimestamp) {
    timestamp = ctx.lastFrameTimestamp + 1; // Ensure at least 1ms after previous frame
  }
  ctx.lastFrameTimestamp = timestamp;

  const frame: TerminalFrame = {
    timestamp,
    svg,
    state,
  };

  ctx.frames.push(frame);

  ctx.frameData.push({
    rows,
    cursor: showCursor ? { row: finalCursorY, col: finalCursorX } : null,
    cursorVisible: showCursor,
    timestamp,
    selection,
    activeCursor,
  });

  options.onFrame?.(frame);
};

