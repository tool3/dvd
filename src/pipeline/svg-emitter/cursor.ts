//#region Imports

import type { Theme, CursorPosition, EmitterOptions } from '../../types';
import { r, fmt, escapeXml } from './utils';


//#region Cursor Config

export interface CursorConfig {
  cursor: CursorPosition;
  charWidth: number;
  lineHeight: number;
  padding: number;
  contentStartY: number;
  fontSize: number;
  hasCustomLineHeight: boolean;
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
    hasCustomLineHeight,
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
  // Text baseline Y (same as text-layer rendering)
  const textY = r(contentStartY + cursor.row * lineHeight);
  // When custom lineHeight is provided, offset cursor to align with capital letters
  // Capital letters start ~18% below the top of the em-box (ascender space)
  const glyphOffset = hasCustomLineHeight ? fontSize * 0.18 : 0;
  const cursorY = r(contentStartY + cursor.row * lineHeight + glyphOffset);
  // Cursor height matches lineHeight to align with text selection
  const cursorHeight = r(lineHeight);
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
  fontSize?: number;
  hasCustomLineHeight?: boolean;
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
    fontSize = 14,
    hasCustomLineHeight = false,
  } = config;

  const selStart = Math.min(start, end);
  const selEnd = Math.max(start, end);
  const selectionX = r(padding + selStart * charWidth);
  // When custom lineHeight is provided, offset selection to align with capital letters
  const glyphOffset = hasCustomLineHeight ? fontSize * 0.18 : 0;
  const selectionY = r(contentStartY + row * lineHeight + glyphOffset);
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

