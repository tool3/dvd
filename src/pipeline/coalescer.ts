import type { Cell, GridState, Color, CellStyle, Span, SpanRow, Theme } from '../types';
import { stylesEqual } from '../types';
import { getStringWidth } from '../utils/wcwidth';

//#region Color Resolution

const ansi256ToHex = (index: number): string => {
  // Standard colors (0-15) - resolve via theme
  if (index < 16) return `ansi${index}`;

  // Color cube (16-231): 6x6x6 RGB
  if (index < 232) {
    const i = index - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const toValue = (n: number) => (n === 0 ? 0 : 55 + n * 40);
    const rVal = toValue(r);
    const gVal = toValue(g);
    const bVal = toValue(b);
    return `#${rVal.toString(16).padStart(2, '0')}${gVal.toString(16).padStart(2, '0')}${bVal.toString(16).padStart(2, '0')}`;
  }

  // Grayscale (232-255): 24 shades
  const gray = 8 + (index - 232) * 10;
  return `#${gray.toString(16).padStart(2, '0')}${gray.toString(16).padStart(2, '0')}${gray.toString(16).padStart(2, '0')}`;
};

const ANSI16_KEYS: (keyof Theme)[] = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

export const resolveColor = (color: Color, theme: Theme, isBackground: boolean): string | null => {
  switch (color.mode) {
    case 'default':
      return isBackground ? null : theme.foreground;

    case 'ansi16': {
      const key = ANSI16_KEYS[color.value];
      return key ? (theme[key] as string) : null;
    }

    case 'ansi256': {
      const hex = ansi256ToHex(color.value);
      if (hex.startsWith('ansi')) {
        const index = parseInt(hex.slice(4), 10);
        const key = ANSI16_KEYS[index];
        return key ? (theme[key] as string) : null;
      }
      return hex;
    }

    case 'rgb':
      return `rgb(${color.value[0]},${color.value[1]},${color.value[2]})`;

    default:
      return null;
  }
};

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [255, 255, 255];
};

export const cellToStyle = (cell: Cell, theme: Theme): CellStyle => {
  let fg: Color = cell.fg;
  let bg: Color = cell.bg;

  if (cell.inverse) {
    fg = cell.bg;
    bg = cell.fg;
    if (fg.mode === 'default') fg = { mode: 'rgb', value: hexToRgb(theme.background) };
    if (bg.mode === 'default') bg = { mode: 'rgb', value: hexToRgb(theme.foreground) };
  }

  return {
    fg: resolveColor(fg, theme, false),
    bg: resolveColor(bg, theme, true),
    bold: cell.bold,
    italic: cell.italic,
    underline: cell.underline,
    dim: cell.dim,
    strikethrough: cell.strikethrough,
  };
};


//#region Coalescing Algorithm

/**
 * Determine if a span has visible (non-whitespace) content.
 */
const hasVisibleContent = (span: Span): boolean => {
  return span.text.trim().length > 0 || !!span.style.bg;
};

export const coalesce = (grid: GridState, theme: Theme): SpanRow[] => {
  const result: SpanRow[] = [];

  for (let row = 0; row < grid.cells.length; row++) {
    const cells = grid.cells[row];

    if (cells.length === 0) {
      result.push([]);
      continue;
    }

    // First pass: create all spans (including whitespace)
    const allSpans: Span[] = [];
    let currentSpan: Span | null = null;

    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];

      // Skip empty placeholder cells (from wide characters)
      if (cell.char === '' && cell.width === 1) continue;

      const style = cellToStyle(cell, theme);

      if (currentSpan && stylesEqual(currentSpan.style, style)) {
        currentSpan.text += cell.char;
        currentSpan.width = getStringWidth(currentSpan.text);
      } else {
        if (currentSpan) {
          allSpans.push(currentSpan);
        }
        currentSpan = {
          text: cell.char,
          style,
          col,
          row,
          width: getStringWidth(cell.char)
        };
      }
    }

    if (currentSpan) {
      allSpans.push(currentSpan);
    }

    // Find the last span with visible content
    let lastVisibleIndex = -1;
    for (let i = allSpans.length - 1; i >= 0; i--) {
      if (hasVisibleContent(allSpans[i])) {
        lastVisibleIndex = i;
        break;
      }
    }

    // Keep all spans up to and including the last visible span
    // This preserves whitespace BEFORE visible content (like spaces after prompt)
    // but drops trailing whitespace-only spans
    const spans: Span[] = [];
    for (let i = 0; i <= lastVisibleIndex; i++) {
      if (allSpans[i].text.length > 0) {
        // For the last visible span, always trim trailing whitespace
        // This matches real terminal behavior where backgrounds don't extend beyond content
        if (i === lastVisibleIndex) {
          const trimmed = allSpans[i].text.trimEnd();
          if (trimmed.length > 0) {
            spans.push({
              ...allSpans[i],
              text: trimmed,
              width: getStringWidth(trimmed)
            });
          }
        } else {
          spans.push(allSpans[i]);
        }
      }
    }
    result.push(spans);
  }

  return result;
};


//#region Background Rect Optimization

export interface BgRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface RenderConfig {
  charWidth: number;
  lineHeight: number;
  padding: number;
  headerHeight: number;
}

export const coalesceBackgrounds = (rows: SpanRow[], config: RenderConfig): BgRect[] => {
  const rects: BgRect[] = [];
  const { charWidth, lineHeight, padding, headerHeight } = config;

  for (const row of rows) {
    if (row.length === 0) continue;

    let currentRect: BgRect | null = null;

    for (const span of row) {
      if (!span.style.bg) {
        if (currentRect) {
          rects.push(currentRect);
          currentRect = null;
        }
        continue;
      }

      const x = padding + span.col * charWidth;
      const y = headerHeight + span.row * lineHeight;
      const width = span.width * charWidth;

      if (
        currentRect &&
        currentRect.color === span.style.bg &&
        currentRect.y === y &&
        Math.abs(currentRect.x + currentRect.width - x) < 0.01
      ) {
        currentRect.width += width;
      } else {
        if (currentRect) rects.push(currentRect);
        currentRect = { x, y, width, height: lineHeight, color: span.style.bg };
      }
    }

    if (currentRect) {
      rects.push(currentRect);
    }
  }

  return rects;
};

export const mergeVerticalBackgrounds = (rects: BgRect[]): BgRect[] => {
  if (rects.length === 0) return [];

  const sorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y || a.color.localeCompare(b.color));
  const merged: BgRect[] = [];
  let current: BgRect | null = null;

  for (const rect of sorted) {
    if (
      current &&
      current.color === rect.color &&
      current.x === rect.x &&
      current.width === rect.width &&
      Math.abs(current.y + current.height - rect.y) < 0.01
    ) {
      current.height += rect.height;
    } else {
      if (current) merged.push(current);
      current = { ...rect };
    }
  }

  if (current) merged.push(current);
  return merged;
};


//#region Statistics

export const getCoalesceStats = (grid: GridState, rows: SpanRow[]): {
  cellCount: number;
  spanCount: number;
  reduction: number;
} => {
  const cellCount = grid.cells.reduce((sum, row) => sum + row.length, 0);
  const spanCount = rows.reduce((sum, row) => sum + row.length, 0);
  const reduction = cellCount > 0 ? Math.round((1 - spanCount / cellCount) * 100) : 0;
  return { cellCount, spanCount, reduction };
};

