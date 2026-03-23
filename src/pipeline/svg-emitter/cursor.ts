//#region Imports

import type { Theme, CursorPosition, EmitterOptions } from '../../types';
import { r, fmt, escapeXml, getEffectiveLineHeight, getTextOffsetY, getCursorYOffset } from './utils';


//#region Cursor Config

export interface CursorConfig {
  cursor: CursorPosition;
  charWidth: number;
  lineHeight: number;
  padding: number;
  contentStartY: number;
  fontSize: number;
  cursorColor: string;
  cursorStyle: 'block' | 'bar' | 'underline';
  activeCursor: boolean;
  charUnderCursor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  letterSpacing?: number;
}


//#region Cursor Rendering

export const renderCursor = (config: CursorConfig): string => {
  const {
    cursor,
    charWidth,
    lineHeight,
    padding,
    contentStartY,
    fontSize,
    cursorColor,
    cursorStyle,
    activeCursor,
    charUnderCursor,
    backgroundColor,
    fontFamily,
    letterSpacing = 0,
  } = config;

  // Account for letter-spacing: each character takes charWidth + letterSpacing
  const effectiveCharWidth = charWidth + letterSpacing;
  const cursorX = r(padding + cursor.col * effectiveCharWidth);
  // Cell Y is top of line cell
  const cellY = contentStartY + cursor.row * lineHeight;
  // Use effective cursor height to ensure minimum visual padding
  const effectiveCursorHeight = getEffectiveLineHeight(lineHeight, fontSize);
  // Center cursor vertically on the row (may extend above/below)
  const cursorYOffset = getCursorYOffset(lineHeight, fontSize);
  const cursorY = r(cellY + cursorYOffset);
  const cursorHeight = r(effectiveCursorHeight);
  // Text offset from cursor top to center text within cursor
  const textOffsetY = getTextOffsetY(lineHeight, fontSize);
  // Text Y = cursor Y + text offset within cursor
  const textY = r(cursorY + textOffsetY);
  const cursorClass = activeCursor ? 'cursor-active' : 'cursor';

  const parts: string[] = [];
  parts.push('<g class="cursor-layer">');

  if (cursorStyle === 'block') {
    // Wrap cursor rect and inverted character in a group so they blink together
    parts.push(`<g class="${cursorClass}">`);
    parts.push(
      `<rect x="${fmt(cursorX)}" y="${fmt(cursorY)}" ` +
        `width="${fmt(charWidth)}" height="${fmt(cursorHeight)}" fill="${cursorColor}"/>`
    );
    // Render inverted character on top of block cursor (same position as text layer)
    if (charUnderCursor && charUnderCursor.trim() && backgroundColor) {
      const defaultFonts = "'SF Mono', 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'Courier New', monospace";
      const font = fontFamily ? `'${fontFamily}', monospace` : defaultFonts;
      parts.push(
        `<text x="${fmt(cursorX)}" y="${fmt(textY)}" fill="${backgroundColor}" ` +
          `font-family="${font}" font-size="${fontSize}" dominant-baseline="text-before-edge">${escapeXml(charUnderCursor)}</text>`
      );
    }
    parts.push('</g>');
  } else if (cursorStyle === 'bar') {
    parts.push(`<g class="${cursorClass}">`);
    parts.push(
      `<rect x="${fmt(cursorX)}" y="${fmt(cursorY)}" ` +
        `width="2" height="${fmt(cursorHeight)}" fill="${cursorColor}"/>`
    );
    parts.push('</g>');
  } else if (cursorStyle === 'underline') {
    const underlineY = r(cursorY + cursorHeight - 2);
    parts.push(`<g class="${cursorClass}">`);
    parts.push(
      `<rect x="${fmt(cursorX)}" y="${fmt(underlineY)}" ` +
        `width="${fmt(charWidth)}" height="2" fill="${cursorColor}"/>`
    );
    parts.push('</g>');
  }

  parts.push('</g>');
  return parts.join('\n');
};


//#region Selection Rendering

export interface SelectionConfig {
  start: number;
  end: number;
  row: number;
  charWidth: number;
  lineHeight: number;
  padding: number;
  contentStartY: number;
  selectionColor: string;
}

export const renderSelection = (config: SelectionConfig): string => {
  const {
    start,
    end,
    row,
    charWidth,
    lineHeight,
    padding,
    contentStartY,
    selectionColor,
  } = config;

  const selStart = Math.min(start, end);
  const selEnd = Math.max(start, end);
  const selectionX = r(padding + selStart * charWidth);
  // Selection covers the entire cell (same as cursor)
  const selectionY = r(contentStartY + row * lineHeight);
  const selectionWidth = r((selEnd - selStart) * charWidth);

  const parts: string[] = [];
  parts.push('<g class="selection-layer">');
  parts.push(
    `<rect x="${fmt(selectionX)}" y="${fmt(selectionY)}" ` +
      `width="${fmt(selectionWidth)}" height="${fmt(lineHeight)}" fill="${selectionColor}" opacity="0.5"/>`
  );
  parts.push('</g>');

  return parts.join('\n');
};

