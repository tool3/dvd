//#region SVG Optimization Utilities

export const r = (n: number): number => Math.round(n * 10) / 10;

export const rx = (n: number): number => Math.round(n);

export const fmt = (n: number): string => {
  const rounded = r(n);
  return rounded === Math.floor(rounded) ? String(Math.floor(rounded)) : String(rounded);
};


//#region Text Utilities

export const stripAnsi = (text: string): string =>
  text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*[A-HJKSTfsu]/g, '')
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '');

export const escapeXml = (text: string): string =>
  stripAnsi(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');


//#region Color Utilities

export const isTruecolor = (color: string | null): boolean =>
  color !== null && color.startsWith('rgb(');


//#region Text Positioning Utilities

// Minimum padding above/below character glyphs (as fraction of fontSize)
// This ensures cursor always visually "wraps" the text with some breathing room
const MIN_CURSOR_PADDING_RATIO = 0.1;

// Font ascender compensation - fonts have internal ascender space above glyphs
// that makes text appear lower than the Y coordinate. This pushes text down
// to visually center it within the cursor.
const ASCENDER_COMPENSATION_RATIO = 0.12;

/**
 * Calculate the effective cursor height ensuring minimum visual padding.
 * Adds minimum padding above and below the text.
 */
export const getEffectiveLineHeight = (lineHeight: number, fontSize: number): number => {
  const minPadding = fontSize * MIN_CURSOR_PADDING_RATIO;
  const minCursorHeight = fontSize + 2 * minPadding;
  return Math.max(lineHeight, minCursorHeight);
};

/**
 * Calculate the text Y offset to visually center text within the cursor.
 * Accounts for font ascender space that makes glyphs appear lower than Y coordinate.
 */
export const getTextOffsetY = (lineHeight: number, fontSize: number): number => {
  const effectiveCursorHeight = getEffectiveLineHeight(lineHeight, fontSize);
  // Center the text (em-box) within the cursor
  const centerOffset = (effectiveCursorHeight - fontSize) / 2;
  // Subtract ascender compensation to push text up (since glyphs appear lower)
  const ascenderCompensation = fontSize * ASCENDER_COMPENSATION_RATIO;
  return centerOffset - ascenderCompensation;
};

/**
 * Calculate the cursor Y offset when cursor extends beyond the row.
 */
export const getCursorYOffset = (lineHeight: number, fontSize: number): number => {
  const effectiveCursorHeight = getEffectiveLineHeight(lineHeight, fontSize);
  // Cursor extends above row by this amount (negative when cursor > lineHeight)
  return (lineHeight - effectiveCursorHeight) / 2;
};


//#region Watermark Utilities

export const extractWatermarkDefs = (content: string): { defs: string; content: string } => {
  const defsRegex = /<defs[^>]*>([\s\S]*?)<\/defs>/gi;
  const matches: string[] = [];
  let cleanContent = content;

  let match;
  while ((match = defsRegex.exec(content)) !== null) {
    matches.push(match[1]); // Inner content of <defs>
  }

  if (matches.length > 0) {
    cleanContent = content.replace(defsRegex, '');
  }

  return {
    defs: matches.join('\n'),
    content: cleanContent
  };
};

