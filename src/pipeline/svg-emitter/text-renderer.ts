//#region Imports

import type { SpanRow, Theme } from '../../types';
import { r, rx, fmt, escapeXml, forceTextPresentation, isTruecolor, getTextOffsetY, getCursorYOffset } from './utils';
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


//#region Span → tspan helpers

// Build the per-span class string for a <tspan> child. The parent <text> owns
// the `.text` class (which carries font-family / font-size / baseline), so we
// strip it here to keep the output compact.
const buildTspanClassAttr = (classes: string[]): string => {
  const filtered = classes.filter((c) => c !== 'text');
  return filtered.length > 0 ? ` class="${filtered.join(' ')}"` : '';
};


//#region Text Layer Rendering

// Single <text> per row, with one <tspan> per styled span. Doing it this way
// makes the entire row share one `dominant-baseline: text-before-edge`
// computation — otherwise mobile browsers (notably iOS Safari) measure the
// glyph-union bbox separately for each `<text>` element, so bold spans sit at
// a slightly different visual baseline than the regular spans on the same row
// and the line appears to "jump" during animation. Desktop browsers hide this;
// mobile exposes it.
//
// Rows that contain custom glyphs (box-drawing, braille, media controls, …)
// emit the glyphs as sibling SVG shapes positioned absolutely. Plain-text
// portions of those rows still go inside the shared <text> so they retain the
// row-wide baseline.
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
    if (row.length === 0) return;

    // All spans in a row share the same row index → same Y.
    const rowIndex = row[0].row;
    const cellY = contentStartY + rowIndex * lineHeight;
    const cursorY = r(cellY + cursorYOffset);
    const textY = r(cursorY + textOffsetY);

    const tspans: string[] = [];
    const glyphSvgs: string[] = [];

    row.forEach((span) => {
      const baseX = rx(padding + span.col * charWidth);
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

      const classAttr = buildTspanClassAttr(classes);

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
            glyphSvgs.push(result.svg);
          } else {
            tspans.push(
              `<tspan x="${fmt(charX)}"${classAttr}${fillAttr}>${escapeXml(forceTextPresentation(char))}</tspan>`
            );
          }
        });
      } else {
        tspans.push(
          `<tspan x="${fmt(baseX)}"${classAttr}${fillAttr}>${escapeXml(forceTextPresentation(rawText))}</tspan>`
        );
      }
    });

    if (tspans.length > 0) {
      parts.push(
        `<text class="text" y="${fmt(textY)}">${tspans.join('')}</text>`
      );
    }

    // Custom glyphs are absolutely positioned siblings — they don't share the
    // row's baseline, they fill their cell box on their own.
    for (const glyphSvg of glyphSvgs) {
      parts.push(glyphSvg);
    }
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
    if (row.length === 0) return;

    const rowIndex = row[0].row;
    const cellY = contentStartY + rowIndex * lineHeight;
    const cursorY = cellY + cursorYOffset;
    const y = r(cursorY + textOffsetY);

    const tspans: string[] = [];

    row.forEach((span) => {
      const x = rx(padding + span.col * charWidth);
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

      const classAttr = buildTspanClassAttr(classes);
      tspans.push(
        `<tspan x="${fmt(x)}"${classAttr}${fillAttr}>${escapeXml(forceTextPresentation(rawText))}</tspan>`
      );
    });

    if (tspans.length > 0) {
      parts.push(`<text class="text" y="${fmt(y)}">${tspans.join('')}</text>`);
    }
  });

  parts.push('</g>');
  return parts.join('\n');
};
