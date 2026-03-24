//#region Imports

import type { ExecutorContext, CDExecutorOptions } from '../types';
import { sleep, stripAnsi } from '../types';
import { captureFrame } from '../frame-capture';
import { getCharWidth } from '../../utils/wcwidth';


//#region String Index Helpers

/**
 * Convert a grapheme position to a string index.
 * This handles multi-byte characters like emojis correctly.
 */
const graphemeToIndex = (str: string, position: number): number => {
  const graphemes = segmentGraphemes(str);
  let index = 0;
  for (let i = 0; i < position && i < graphemes.length; i++) {
    index += graphemes[i].length;
  }
  return index;
};

/**
 * Get the number of graphemes in a string (not UTF-16 code units).
 */
const graphemeLength = (str: string): number => [...segmentGraphemes(str)].length;

/**
 * Segment a string into grapheme clusters.
 * This handles emoji sequences like ❤️ (heart + variation selector) as single units.
 */
const segmentGraphemes = (str: string): string[] => {
  // Use Intl.Segmenter if available (Node 16+)
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return [...segmenter.segment(str)].map((s) => s.segment);
  }
  // Fallback: basic code point iteration (won't handle all grapheme clusters)
  return [...str];
};


//#region Selection Helpers

export const hasSelection = (ctx: ExecutorContext): boolean =>
  ctx.selectionStart !== undefined &&
  ctx.selectionEnd !== undefined &&
  ctx.selectionStart !== ctx.selectionEnd;

export const clearSelection = (ctx: ExecutorContext): void => {
  ctx.selectionStart = undefined;
  ctx.selectionEnd = undefined;
};

export const deleteSelection = (ctx: ExecutorContext): boolean => {
  if (!hasSelection(ctx)) return false;

  const start = Math.min(ctx.selectionStart!, ctx.selectionEnd!);
  const end = Math.max(ctx.selectionStart!, ctx.selectionEnd!);

  const startIndex = graphemeToIndex(ctx.currentLine, start);
  const endIndex = graphemeToIndex(ctx.currentLine, end);

  const before = ctx.currentLine.substring(0, startIndex);
  const after = ctx.currentLine.substring(endIndex);

  ctx.currentLine = before + after;
  ctx.cursorX = start;
  clearSelection(ctx);

  return true;
};


//#region Type Handler

export const executeType = async (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  text: string,
  speed?: number
): Promise<void> => {
  const delay = speed || ctx.typingSpeed;

  if (hasSelection(ctx)) {
    deleteSelection(ctx);
    captureFrame(ctx, options, true, true);
    await sleep(delay);
  }

  const graphemes = segmentGraphemes(text);
  for (let i = 0; i < graphemes.length; i++) {
    const char = graphemes[i];
    if (char === '\n') {
      const prefix = ctx.isMultiLineContinuation ? '' : ctx.promptPrefix;
      ctx.lines[ctx.cursorY] = prefix + ctx.currentLine;
      ctx.cursorY++;
      ctx.cursorX = 0;
      ctx.currentLine = '';
      ctx.isMultiLineContinuation = true;

      if (!ctx.lines[ctx.cursorY]) {
        ctx.lines[ctx.cursorY] = '';
      }

      await sleep(delay);
      const captureStart = Date.now();
      captureFrame(ctx, options, true, true);
      ctx.captureOverhead += Date.now() - captureStart;
      continue;
    }

    const cursorIndex = graphemeToIndex(ctx.currentLine, ctx.cursorX);
    const before = ctx.currentLine.substring(0, cursorIndex);
    const after = ctx.currentLine.substring(cursorIndex);
    ctx.currentLine = before + char + after;
    // Increment cursor by character width (emoji are 2-wide)
    ctx.cursorX += getCharWidth(char);

    await sleep(delay);
    const captureStart = Date.now();
    captureFrame(ctx, options, true, true);
    ctx.captureOverhead += Date.now() - captureStart;

    // Yield to event loop every 10 characters to allow spinner animation
    if (i % 10 === 9) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
};


//#region Backspace Handler

export const executeBackspace = async (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  count: number = 1
): Promise<void> => {
  const delay = ctx.typingSpeed;

  if (hasSelection(ctx)) {
    deleteSelection(ctx);
    await sleep(delay);
    captureFrame(ctx, options, true, true);
    return;
  }

  for (let i = 0; i < count; i++) {
    if (graphemeLength(ctx.currentLine) > 0 && ctx.cursorX > 0) {
      const beforeIndex = graphemeToIndex(ctx.currentLine, ctx.cursorX - 1);
      const afterIndex = graphemeToIndex(ctx.currentLine, ctx.cursorX);
      const before = ctx.currentLine.substring(0, beforeIndex);
      const after = ctx.currentLine.substring(afterIndex);
      ctx.currentLine = before + after;
      ctx.cursorX--;

      await sleep(delay);
      captureFrame(ctx, options, true, true);
    }
  }
};

