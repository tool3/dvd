//#region Imports

import type { SpanRow, Theme } from '../../types';
import { r, rx, fmt, escapeXml, isTruecolor, getTextOffsetY, getCursorYOffset } from './utils';
import { styleToClasses, getColorClass, getColorFromClass } from './stylesheet';
import { containsCustomGlyphs, renderCustomGlyph, type GlyphContext } from '../customGlyphs';


//#region Text Renderer Config

export interface TextRendererConfig {
  charWidth: number;
  lineHeight: number;
  padding: number;
  contentStartY: number;
  fontSize: number;
  theme: Theme;
}


//#region Text Layer Rendering

export const renderTextLayer = (rows: SpanRow[], config: TextRendererConfig): string => {
  const { charWidth, lineHeight, padding, contentStartY, fontSize, theme } = config;

  const parts: string[] = [];
  parts.push('<g class="text-layer">');

  const glyphLineWidth = Math.max(1, fontSize * 0.08);
  const glyphHeavyLineWidth = glyphLineWidth * 2;

  // Cursor Y offset - cursor may extend above/below the cell
  const cursorYOffset = getCursorYOffset(lineHeight, fontSize);
  // Text offset from cursor top to center text within cursor
  const textOffsetY = getTextOffsetY(lineHeight, fontSize);

  rows.forEach((row) => {
    row.forEach((span) => {
      const baseX = rx(padding + span.col * charWidth);
      // Cell Y is top of line cell
      const cellY = contentStartY + span.row * lineHeight;
      // Cursor Y position (may extend above cell)
      const cursorY = r(cellY + cursorYOffset);
      // Text Y = cursor Y + text offset within cursor
      const textY = r(cursorY + textOffsetY);
      const classes = ['text', ...styleToClasses(span.style)];

      let fillAttr = '';
      let color = theme.foreground;

      if (span.style.fg) {
        if (isTruecolor(span.style.fg)) {
          fillAttr = ` fill="${span.style.fg}"`;
          color = span.style.fg;
        } else {
          const colorClass = getColorClass(span.style.fg, theme);
          if (colorClass) {
            classes.push(colorClass);
            color = getColorFromClass(colorClass, theme) || theme.foreground;
          } else {
            fillAttr = ` fill="${span.style.fg}"`;
            color = span.style.fg;
          }
        }
      } else {
        classes.push('fg');
      }

      const rawText = span.style.bg ? span.text : span.text.trimEnd();
      if (!rawText) return;

      if (containsCustomGlyphs(rawText)) {
        [...rawText].forEach((char, charOffset) => {
          // Use absolute column position to ensure consistent alignment across spans
          const absoluteCol = span.col + charOffset;
          const charX = padding + absoluteCol * charWidth;
          // Use cellY for glyphs so they fill the entire cell
          const glyphCtx: GlyphContext = {
            cellWidth: charWidth,
            cellHeight: lineHeight,
            x: charX,
            y: cellY,
            color,
            backgroundColor: theme.background,
            lineWidth: glyphLineWidth,
            heavyLineWidth: glyphHeavyLineWidth,
          };
          const result = renderCustomGlyph(char, glyphCtx);
          if (result.handled) {
            parts.push(result.svg);
          } else {
            // Use textY for regular characters
            parts.push(
              `<text class="${classes.join(' ')}" x="${fmt(charX)}" y="${fmt(textY)}"${fillAttr}>${escapeXml(char)}</text>`
            );
          }
        });
      } else {
        // Use textY for regular text
        parts.push(
          `<text class="${classes.join(' ')}" x="${fmt(baseX)}" y="${fmt(textY)}"${fillAttr}>${escapeXml(rawText)}</text>`
        );
      }
    });
  });

  parts.push('</g>');
  return parts.join('\n');
};


//#region Simple Text Layer (for animation frames)

export const renderSimpleTextLayer = (
  rows: SpanRow[],
  config: TextRendererConfig
): string => {
  const { charWidth, lineHeight, padding, contentStartY, fontSize, theme } = config;

  const parts: string[] = [];
  parts.push('<g class="text-layer">');

  // Cursor Y offset - cursor may extend above/below the cell
  const cursorYOffset = getCursorYOffset(lineHeight, fontSize);
  // Text offset from cursor top to center text within cursor
  const textOffsetY = getTextOffsetY(lineHeight, fontSize);

  rows.forEach((row) => {
    row.forEach((span) => {
      const x = rx(padding + span.col * charWidth);
      // Cell Y is top of line cell
      const cellY = contentStartY + span.row * lineHeight;
      // Cursor Y position (may extend above cell)
      const cursorY = cellY + cursorYOffset;
      // Text Y = cursor Y + text offset within cursor
      const y = r(cursorY + textOffsetY);
      const classes = ['text', ...styleToClasses(span.style)];
      let fillAttr = '';

      if (span.style.fg) {
        if (isTruecolor(span.style.fg)) {
          fillAttr = ` fill="${span.style.fg}"`;
        } else {
          const colorClass = getColorClass(span.style.fg, theme);
          if (colorClass) classes.push(colorClass);
          else fillAttr = ` fill="${span.style.fg}"`;
        }
      } else {
        classes.push('fg');
      }

      const rawText = span.style.bg ? span.text : span.text.trimEnd();
      if (!rawText) return;

      parts.push(
        `<text class="${classes.join(' ')}" x="${fmt(x)}" y="${fmt(y)}"${fillAttr}>${escapeXml(rawText)}</text>`
      );
    });
  });

  parts.push('</g>');
  return parts.join('\n');
};

