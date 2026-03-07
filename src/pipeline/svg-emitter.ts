/**
 * SVG Emitter - Generates optimized SVG output
 *
 * Key optimizations:
 * - CSS classes instead of inline styles
 * - Background rect coalescing
 * - Embedded monospace font
 * - Minimal markup
 */

import type { SpanRow, Span, CellStyle, Theme, EmitterOptions, CursorPosition } from '../types';
import { coalesceBackgrounds, mergeVerticalBackgrounds, type BgRect, type RenderConfig } from './coalescer';

// ============================================================================
// SVG Optimization Utilities
// ============================================================================

/**
 * Round coordinate to 1 decimal place for smaller SVG output
 * Converts numbers like 37.599999999999994 to 37.6
 */
function r(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Round X coordinate to integer for better text alignment
 * Sub-pixel positioning can cause inconsistent character spacing in browsers
 */
function rx(n: number): number {
  return Math.round(n);
}

/**
 * Format a number for SVG output - removes unnecessary decimal places
 * 37.0 -> "37", 37.6 -> "37.6", 37.65 -> "37.7"
 */
function fmt(n: number): string {
  const rounded = r(n);
  return rounded === Math.floor(rounded) ? String(Math.floor(rounded)) : String(rounded);
}

// ============================================================================
// CSS Class Generation
// ============================================================================

/**
 * Generate CSS class names for a span style
 */
export function styleToClasses(style: CellStyle): string[] {
  const classes: string[] = [];

  if (style.bold) classes.push('bold');
  if (style.italic) classes.push('italic');
  if (style.underline) classes.push('uline');
  if (style.dim) classes.push('dim');
  if (style.strikethrough) classes.push('strike');

  return classes;
}

/**
 * Check if a color is a truecolor (rgb) that needs inline style
 */
function isTruecolor(color: string | null): boolean {
  return color !== null && color.startsWith('rgb(');
}

/**
 * Generate the CSS stylesheet for the SVG
 * @param usedColors Optional set of color class names actually used (e.g., 'fg', 'f0', 'b5')
 *                   If provided, only generates CSS for those colors
 */
export function generateStylesheet(theme: Theme, options: EmitterOptions, usedColors?: Set<string>): string {
  const fontSize = options.fontSize;
  const lineHeight = options.lineHeight ?? fontSize * 1.4;

  const lines: string[] = [];

  // Font face (if embedded)
  if (options.embedFont && options.fontData) {
    lines.push(`@font-face {
  font-family: 'DVDMono';
  src: url(data:font/woff2;base64,${options.fontData}) format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}`);
  }

  // Base text styles
  // Priority: embedded font > custom fontFamily > default system fonts
  const defaultFonts = "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace";
  let fontFamily: string;
  if (options.embedFont && options.fontData) {
    fontFamily = "'DVDMono', monospace";
  } else if (options.fontFamily) {
    fontFamily = `'${options.fontFamily}', monospace`;
  } else {
    fontFamily = defaultFonts;
  }
  lines.push(`.text {
  font-family: ${fontFamily};
  font-size: ${fontSize}px;
  dominant-baseline: text-before-edge;
  text-rendering: geometricPrecision;
  white-space: pre;
}`);

  // Style modifiers
  lines.push('.bold { font-weight: bold; }');
  lines.push('.italic { font-style: italic; }');
  lines.push('.uline { text-decoration: underline; }');
  lines.push('.strike { text-decoration: line-through; }');
  lines.push('.dim { opacity: 0.5; }');

  // Foreground colors (ANSI 16)
  const fgColors = [
    theme.black,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.magenta,
    theme.cyan,
    theme.white,
    theme.brightBlack,
    theme.brightRed,
    theme.brightGreen,
    theme.brightYellow,
    theme.brightBlue,
    theme.brightMagenta,
    theme.brightCyan,
    theme.brightWhite,
  ];

  // Only generate color classes that are actually used (or all if usedColors not provided)
  const shouldInclude = (cls: string) => !usedColors || usedColors.has(cls);

  if (shouldInclude('fg')) {
    lines.push(`.fg { fill: ${theme.foreground}; }`);
  }
  fgColors.forEach((color, i) => {
    if (shouldInclude(`f${i}`)) {
      lines.push(`.f${i} { fill: ${color}; }`);
    }
  });

  // Background colors (ANSI 16)
  if (shouldInclude('bg')) {
    lines.push(`.bg { fill: ${theme.background}; }`);
  }
  fgColors.forEach((color, i) => {
    if (shouldInclude(`b${i}`)) {
      lines.push(`.b${i} { fill: ${color}; }`);
    }
  });

  // Cursor styles
  const cursorBlink = options.cursorBlink !== false; // Default to true
  if (cursorBlink) {
    lines.push(`.cursor { animation: blink 1s step-end infinite; }`);
    lines.push(`@keyframes blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}`);
  } else {
    lines.push(`.cursor { opacity: 1; }`);
  }
  lines.push(`.cursor-active { opacity: 1; }`);

  return lines.join('\n');
}

// ============================================================================
// Chrome Generation (Title Bar, Controls)
// ============================================================================

interface ChromeConfig {
  template: 'macos' | 'windows' | 'minimal';
  width: number;
  height: number;
  headerHeight: number;
  padding: number;
  borderRadius: number;
  title?: string;
  theme: Theme;
  headerBackground?: string;
  // Header/Footer border config (shellfie 2.0 style)
  headerBorder?: boolean;
  headerBorderColor?: string;
  headerBorderWidth?: number;
  footerBackground?: string;
  footerHeight?: number;
  footerBorder?: boolean;
  footerBorderColor?: string;
  footerBorderWidth?: number;
}

function generateChrome(config: ChromeConfig): string {
  const { template, width, headerHeight, padding, borderRadius, title, theme, headerBackground } = config;

  const parts: string[] = [];

  if (template === 'minimal') {
    // No chrome for minimal template
    return '';
  }

  const headerBg = headerBackground ?? theme.background;

  // Header background
  parts.push(
    `<rect class="header-bg" x="0" y="0" width="${width}" height="${headerHeight}" ` +
    `fill="${headerBg}" rx="${borderRadius}" ry="${borderRadius}"/>`
  );

  // Bottom corners of header should be square (covered by content area)
  parts.push(`<rect x="0" y="${headerHeight - borderRadius}" width="${width}" height="${borderRadius}" fill="${headerBg}"/>`);

  if (template === 'macos') {
    // Traffic lights
    const buttonY = headerHeight / 2;
    const buttonRadius = 6;
    const buttonSpacing = 20;
    const buttonStartX = padding + buttonRadius;

    parts.push(`<circle cx="${buttonStartX}" cy="${buttonY}" r="${buttonRadius}" fill="#ff5f56"/>`);
    parts.push(`<circle cx="${buttonStartX + buttonSpacing}" cy="${buttonY}" r="${buttonRadius}" fill="#ffbd2e"/>`);
    parts.push(`<circle cx="${buttonStartX + buttonSpacing * 2}" cy="${buttonY}" r="${buttonRadius}" fill="#27c93f"/>`);
  } else if (template === 'windows') {
    // Windows controls (minimize, maximize, close)
    const buttonWidth = 46;
    const buttonHeight = headerHeight;
    const closeX = width - buttonWidth;
    const maxX = closeX - buttonWidth;
    const minX = maxX - buttonWidth;

    // Hover areas (invisible)
    parts.push(`<rect x="${minX}" y="0" width="${buttonWidth}" height="${buttonHeight}" fill="transparent"/>`);
    parts.push(`<rect x="${maxX}" y="0" width="${buttonWidth}" height="${buttonHeight}" fill="transparent"/>`);
    parts.push(`<rect x="${closeX}" y="0" width="${buttonWidth}" height="${buttonHeight}" fill="transparent"/>`);

    // Icons
    const iconColor = theme.foreground;
    const iconY = headerHeight / 2;

    // Minimize (line)
    parts.push(`<line x1="${minX + 18}" y1="${iconY}" x2="${minX + 28}" y2="${iconY}" stroke="${iconColor}" stroke-width="1"/>`);

    // Maximize (square)
    parts.push(
      `<rect x="${maxX + 18}" y="${iconY - 5}" width="10" height="10" ` + `stroke="${iconColor}" stroke-width="1" fill="none"/>`
    );

    // Close (X)
    parts.push(`<line x1="${closeX + 18}" y1="${iconY - 5}" x2="${closeX + 28}" y2="${iconY + 5}" stroke="${iconColor}" stroke-width="1"/>`);
    parts.push(`<line x1="${closeX + 28}" y1="${iconY - 5}" x2="${closeX + 18}" y2="${iconY + 5}" stroke="${iconColor}" stroke-width="1"/>`);
  }

  // Title text
  if (title) {
    const titleX = width / 2;
    const titleY = headerHeight / 2;
    // Use style attribute to override .text class's dominant-baseline
    parts.push(
      `<text class="text fg" x="${titleX}" y="${titleY}" text-anchor="middle" style="dominant-baseline: central">${escapeXml(title)}</text>`
    );
  }

  // Header border (line below header)
  if (config.headerBorder) {
    const hBorderColor = config.headerBorderColor ?? theme.foreground;
    const hBorderWidth = config.headerBorderWidth ?? 1;
    parts.push(
      `<line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" ` +
      `stroke="${hBorderColor}" stroke-width="${hBorderWidth}"/>`
    );
  }

  return parts.join('\n');
}

interface FooterConfig {
  width: number;
  height: number;
  footerHeight: number;
  borderRadius: number;
  theme: Theme;
  footerBackground?: string;
  footerBorder?: boolean;
  footerBorderColor?: string;
  footerBorderWidth?: number;
}

function generateFooter(config: FooterConfig): string {
  const { width, height, footerHeight, borderRadius, theme, footerBackground } = config;

  if (footerHeight <= 0) {
    return '';
  }

  const parts: string[] = [];
  const footerY = height - footerHeight;
  const footerBg = footerBackground ?? theme.background;

  // Footer background with rounded bottom corners
  parts.push(
    `<rect class="footer-bg" x="0" y="${footerY}" width="${width}" height="${footerHeight}" ` +
    `fill="${footerBg}" rx="${borderRadius}" ry="${borderRadius}"/>`
  );

  // Top corners of footer should be square
  parts.push(`<rect x="0" y="${footerY}" width="${width}" height="${borderRadius}" fill="${footerBg}"/>`);

  // Footer border (line above footer)
  if (config.footerBorder) {
    const fBorderColor = config.footerBorderColor ?? theme.foreground;
    const fBorderWidth = config.footerBorderWidth ?? 1;
    parts.push(
      `<line x1="0" y1="${footerY}" x2="${width}" y2="${footerY}" ` +
      `stroke="${fBorderColor}" stroke-width="${fBorderWidth}"/>`
    );
  }

  return parts.join('\n');
}

// ============================================================================
// Main Emitter
// ============================================================================

export interface EmitResult {
  svg: string;
  width: number;
  height: number;
}

/**
 * Emit SVG from coalesced span rows
 */
export function emit(
  rows: SpanRow[],
  cursor: CursorPosition | null,
  cursorVisible: boolean,
  options: EmitterOptions
): EmitResult {
  const { theme, template, width, height, fontSize, title, watermark } = options;
  const lineHeight = options.lineHeight ?? fontSize * 1.4;
  const charWidth = options.charWidth ?? fontSize * 0.6;
  const padding = options.padding ?? 16;
  const borderRadius = options.borderRadius ?? 8;
  const borderWidth = options.borderWidth ?? 0;
  const borderColor = options.borderColor ?? theme.foreground;

  // Calculate header height based on template or custom setting
  const headerHeight = options.headerHeight ?? (template === 'minimal' ? 0 : 40);
  const footerHeight = options.footerHeight ?? 0;
  const watermarkHeight = watermark ? lineHeight : 0;
  const contentStartY = headerHeight + padding;

  const parts: string[] = [];

  // SVG header
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);

  // Stylesheet
  parts.push('<style>');
  parts.push(generateStylesheet(theme, options));
  parts.push('</style>');

  // Clip path for rounded corners (makes corners truly transparent)
  if (borderRadius > 0) {
    parts.push('<defs>');
    parts.push(
      `<clipPath id="rounded-corners">` +
      `<rect x="0" y="0" width="${width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}"/>` +
      `</clipPath>`
    );
    parts.push('</defs>');
    parts.push(`<g clip-path="url(#rounded-corners)">`);
  }

  // Background
  parts.push(
    `<rect class="window-bg" x="0" y="0" width="${width}" height="${height}" ` +
    `fill="${theme.background}" rx="${borderRadius}" ry="${borderRadius}"/>`
  );

  // Border (if specified)
  if (borderWidth > 0) {
    parts.push(
      `<rect x="${borderWidth / 2}" y="${borderWidth / 2}" ` +
      `width="${width - borderWidth}" height="${height - borderWidth}" ` +
      `fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" ` +
      `rx="${borderRadius}" ry="${borderRadius}"/>`
    );
  }

  // Chrome (title bar)
  const chrome = generateChrome({
    template,
    width,
    height,
    headerHeight,
    padding,
    borderRadius,
    title,
    theme,
    headerBackground: options.headerBackground,
    headerBorder: options.headerBorder,
    headerBorderColor: options.headerBorderColor,
    headerBorderWidth: options.headerBorderWidth,
  });
  if (chrome) {
    parts.push(`<g class="chrome">${chrome}</g>`);
  }

  // Footer
  if (footerHeight > 0 || options.footerBackground) {
    const footer = generateFooter({
      width,
      height,
      footerHeight: footerHeight || 40,
      borderRadius,
      theme,
      footerBackground: options.footerBackground,
      footerBorder: options.footerBorder,
      footerBorderColor: options.footerBorderColor,
      footerBorderWidth: options.footerBorderWidth,
    });
    if (footer) {
      parts.push(`<g class="footer">${footer}</g>`);
    }
  }

  // Background rectangles layer
  const renderConfig: RenderConfig = {
    charWidth,
    lineHeight,
    padding,
    headerHeight: contentStartY,
  };

  const bgRects = coalesceBackgrounds(rows, renderConfig);
  const mergedBgRects = mergeVerticalBackgrounds(bgRects);

  if (mergedBgRects.length > 0) {
    parts.push('<g class="bg-layer">');
    for (const rect of mergedBgRects) {
      parts.push(`<rect x="${fmt(rect.x)}" y="${fmt(rect.y)}" width="${fmt(rect.width)}" height="${fmt(rect.height)}" fill="${rect.color}"/>`);
    }
    parts.push('</g>');
  }

  // Text layer
  // Use rx() for x-coordinates to round to half-pixels for better text alignment
  parts.push('<g class="text-layer">');
  for (const row of rows) {
    for (const span of row) {
      const x = rx(padding + span.col * charWidth);
      const y = r(contentStartY + span.row * lineHeight);

      const classes = ['text', ...styleToClasses(span.style)];

      // Foreground color - use class if it's a theme color, inline if truecolor
      let fillAttr = '';
      if (span.style.fg) {
        if (isTruecolor(span.style.fg)) {
          fillAttr = ` fill="${span.style.fg}"`;
        } else {
          // Check if it matches a theme color
          const colorClass = getColorClass(span.style.fg, theme);
          if (colorClass) {
            classes.push(colorClass);
          } else {
            fillAttr = ` fill="${span.style.fg}"`;
          }
        }
      } else {
        classes.push('fg');
      }

      const classAttr = classes.join(' ');
      // Trim trailing whitespace unless there's a background color that needs to extend
      const rawText = span.style.bg ? span.text : span.text.trimEnd();
      if (!rawText) continue; // Skip empty text spans
      const text = escapeXml(rawText);

      parts.push(`<text class="${classAttr}" x="${fmt(x)}" y="${fmt(y)}"${fillAttr}>${text}</text>`);
    }
  }
  parts.push('</g>');

  // Selection layer
  if (options.selection) {
    const { start, end, row } = options.selection;
    const selStart = Math.min(start, end);
    const selEnd = Math.max(start, end);
    const selectionX = r(padding + selStart * charWidth);
    const selectionY = r(contentStartY + row * lineHeight);
    const selectionWidth = r((selEnd - selStart) * charWidth);
    const selectionColor = theme.selection ?? '#44475a';

    parts.push('<g class="selection-layer">');
    parts.push(
      `<rect x="${fmt(selectionX)}" y="${fmt(selectionY)}" ` +
      `width="${fmt(selectionWidth)}" height="${fmt(lineHeight)}" fill="${selectionColor}" opacity="0.5"/>`
    );
    parts.push('</g>');
  }

  // Cursor layer
  if (cursor && cursorVisible) {
    const cursorX = r(padding + cursor.col * charWidth);
    const rowY = r(contentStartY + cursor.row * lineHeight);

    // When custom lineHeight is provided, adjust cursor to align with text center
    // Cursor height = fontSize, positioned so cursor's middle aligns with text's middle
    const hasCustomLineHeight = options.hasCustomLineHeight ?? false;
    const cursorHeight = r(hasCustomLineHeight ? fontSize : lineHeight);
    // With text-before-edge baseline, the visible text center is approximately at 60% of fontSize
    // cursorCenter = cursorY + cursorHeight/2, textCenter = rowY + fontSize * 0.6
    // So cursorY = textCenter - cursorHeight/2 = rowY + fontSize*0.6 - cursorHeight/2
    const cursorYOffset = hasCustomLineHeight ? (fontSize * 0.65) - (cursorHeight / 2) : 0;
    const cursorY = r(rowY + cursorYOffset);

    const cursorColor = options.cursorColor ?? theme.cursor ?? theme.foreground;
    // Use cursor-active class when actively typing (no blink)
    const cursorClass = options.activeCursor ? 'cursor-active' : 'cursor';
    const cursorStyle = options.cursorStyle ?? 'block';

    parts.push('<g class="cursor-layer">');
    if (cursorStyle === 'block') {
      parts.push(
        `<rect class="${cursorClass}" x="${fmt(cursorX)}" y="${fmt(cursorY)}" ` +
        `width="${fmt(charWidth)}" height="${fmt(cursorHeight)}" fill="${cursorColor}"/>`
      );
    } else if (cursorStyle === 'bar') {
      // Vertical bar cursor (2px wide)
      parts.push(
        `<rect class="${cursorClass}" x="${fmt(cursorX)}" y="${fmt(cursorY)}" ` +
        `width="2" height="${fmt(cursorHeight)}" fill="${cursorColor}"/>`
      );
    } else if (cursorStyle === 'underline') {
      // Underline cursor (2px tall at bottom of cell)
      const underlineY = r(cursorY + cursorHeight - 2);
      parts.push(
        `<rect class="${cursorClass}" x="${fmt(cursorX)}" y="${fmt(underlineY)}" ` +
        `width="${fmt(charWidth)}" height="2" fill="${cursorColor}"/>`
      );
    }
    parts.push('</g>');
  }

  // Watermark
  if (watermark) {
    const watermarkY = height - padding - watermarkHeight / 2;
    const watermarkX = width - padding;

    if (options.footerBackground) {
      parts.push(
        `<rect x="0" y="${height - watermarkHeight - padding}" width="${width}" ` +
        `height="${watermarkHeight + padding}" fill="${options.footerBackground}"/>`
      );
    }

    parts.push(
      `<text class="text dim" x="${watermarkX}" y="${watermarkY}" ` +
      `text-anchor="end" fill="${theme.foreground}">${escapeXml(watermark)}</text>`
    );
  }

  // Close clip group if we opened one
  if (borderRadius > 0) {
    parts.push('</g>');
  }

  // Close SVG
  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    width,
    height,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get color class name if the color matches a theme color
 * @param isBackground If true, returns background class (b0-b15), otherwise foreground (f0-f15)
 */
function getColorClass(color: string, theme: Theme, isBackground = false): string | null {
  const prefix = isBackground ? 'b' : 'f';
  const colorMap: Record<string, string> = {
    [theme.black]: `${prefix}0`,
    [theme.red]: `${prefix}1`,
    [theme.green]: `${prefix}2`,
    [theme.yellow]: `${prefix}3`,
    [theme.blue]: `${prefix}4`,
    [theme.magenta]: `${prefix}5`,
    [theme.cyan]: `${prefix}6`,
    [theme.white]: `${prefix}7`,
    [theme.brightBlack]: `${prefix}8`,
    [theme.brightRed]: `${prefix}9`,
    [theme.brightGreen]: `${prefix}10`,
    [theme.brightYellow]: `${prefix}11`,
    [theme.brightBlue]: `${prefix}12`,
    [theme.brightMagenta]: `${prefix}13`,
    [theme.brightCyan]: `${prefix}14`,
    [theme.brightWhite]: `${prefix}15`,
  };

  // Add foreground/background special case
  if (!isBackground && color === theme.foreground) {
    return 'fg';
  }
  if (isBackground && color === theme.background) {
    return 'bg';
  }

  return colorMap[color] ?? null;
}

/**
 * Strip ANSI escape sequences from text
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')           // SGR (colors)
    .replace(/\x1b\[[0-9;]*[A-HJKSTfsu]/g, '') // Cursor movement
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '');      // Mode control
}

/**
 * Escape XML special characters and strip ANSI codes
 */
function escapeXml(text: string): string {
  return stripAnsi(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// Frame Animation Support
// ============================================================================

export interface AnimatedSVGOptions extends EmitterOptions {
  fps?: number;
  loop?: boolean;
  pauseAtEnd?: number;
}

export interface FrameData {
  rows: SpanRow[];
  cursor: CursorPosition | null;
  cursorVisible: boolean;
  timestamp: number;
  selection?: { start: number; end: number; row: number } | null;
  activeCursor?: boolean;
}

/**
 * Emit animated SVG from multiple frames
 */
export function emitAnimated(frames: FrameData[], options: AnimatedSVGOptions): EmitResult {
  if (frames.length === 0) {
    return emit([], null, false, options);
  }

  if (frames.length === 1) {
    return emit(frames[0].rows, frames[0].cursor, frames[0].cursorVisible, options);
  }

  const { theme, template, width, height, fontSize } = options;
  const lineHeight = options.lineHeight ?? fontSize * 1.4;
  const charWidth = options.charWidth ?? fontSize * 0.6;
  const padding = options.padding ?? 16;
  const borderRadius = options.borderRadius ?? (template === 'minimal' ? 0 : 8);
  const headerHeight = options.headerHeight ?? (template === 'minimal' ? 0 : 40);
  const footerHeight = options.footerHeight ?? 0;
  const contentStartY = headerHeight + padding;
  const fps = options.fps ?? 10;
  const loop = options.loop ?? true;
  const pauseAtEnd = options.pauseAtEnd ?? 0;

  // Calculate total duration
  const lastFrame = frames[frames.length - 1];
  const totalDuration = lastFrame.timestamp + pauseAtEnd;

  const parts: string[] = [];

  // SVG header
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);

  // Defs for reusable content and clip path
  parts.push('<defs>');

  // Clip path for rounded corners (makes corners truly transparent)
  if (borderRadius > 0) {
    parts.push(
      `<clipPath id="rounded-corners">` +
      `<rect x="0" y="0" width="${width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}"/>` +
      `</clipPath>`
    );
  }

  // Track if custom lineHeight was provided for cursor alignment
  const hasCustomLineHeight = options.lineHeight !== undefined;

  // Generate each frame as a group in defs
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const frameContent = generateFrameContent(frame, {
      ...options,
      charWidth,
      lineHeight,
      padding,
      contentStartY,
      hasCustomLineHeight,
    });
    parts.push(`<g id="f${i}">${frameContent}</g>`);
  }

  parts.push('</defs>');

  // Stylesheet with animation keyframes
  parts.push('<style>');
  parts.push(generateStylesheet(theme, options));
  parts.push(generateAnimationKeyframes(frames, totalDuration, loop));
  parts.push('</style>');

  // Wrap all content in clip group for rounded corners
  if (borderRadius > 0) {
    parts.push(`<g clip-path="url(#rounded-corners)">`);
  }

  // Static background
  parts.push(
    `<rect class="window-bg" x="0" y="0" width="${width}" height="${height}" ` +
    `fill="${theme.background}" rx="${borderRadius}" ry="${borderRadius}"/>`
  );

  // Chrome (static)
  const chrome = generateChrome({
    template,
    width,
    height,
    headerHeight,
    padding,
    borderRadius,
    title: options.title,
    theme,
    headerBackground: options.headerBackground,
    headerBorder: options.headerBorder,
    headerBorderColor: options.headerBorderColor,
    headerBorderWidth: options.headerBorderWidth,
  });
  if (chrome) {
    parts.push(`<g class="chrome">${chrome}</g>`);
  }

  // Footer (static)
  if (footerHeight > 0 || options.footerBackground) {
    const footer = generateFooter({
      width,
      height,
      footerHeight: footerHeight || 40,
      borderRadius,
      theme,
      footerBackground: options.footerBackground,
      footerBorder: options.footerBorder,
      footerBorderColor: options.footerBorderColor,
      footerBorderWidth: options.footerBorderWidth,
    });
    if (footer) {
      parts.push(`<g class="footer">${footer}</g>`);
    }
  }

  // Animated frame references
  for (let i = 0; i < frames.length; i++) {
    parts.push(`<use href="#f${i}" class="frame frame-${i}"/>`);
  }

  // Watermark (static)
  if (options.watermark) {
    const watermarkHeight = lineHeight;
    const watermarkY = height - padding - watermarkHeight / 2;
    const watermarkX = width - padding;

    parts.push(
      `<text class="text dim" x="${watermarkX}" y="${watermarkY}" ` +
      `text-anchor="end" fill="${theme.foreground}">${escapeXml(options.watermark)}</text>`
    );
  }

  // Close clip group if we opened one
  if (borderRadius > 0) {
    parts.push('</g>');
  }

  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    width,
    height,
  };
}

interface FrameRenderConfig {
  charWidth: number;
  lineHeight: number;
  padding: number;
  contentStartY: number;
  theme: Theme;
  hasCustomLineHeight?: boolean;
}

function generateFrameContent(frame: FrameData, config: EmitterOptions & FrameRenderConfig): string {
  const { rows, cursor, cursorVisible, selection, activeCursor } = frame;
  const { charWidth, lineHeight, padding, contentStartY, theme } = config;
  const fontSize = config.fontSize ?? 16;

  const parts: string[] = [];

  // Background rectangles
  const renderConfig: RenderConfig = {
    charWidth,
    lineHeight,
    padding,
    headerHeight: contentStartY,
  };

  const bgRects = coalesceBackgrounds(rows, renderConfig);
  const mergedBgRects = mergeVerticalBackgrounds(bgRects);

  if (mergedBgRects.length > 0) {
    parts.push('<g class="bg-layer">');
    for (const rect of mergedBgRects) {
      parts.push(`<rect x="${fmt(rect.x)}" y="${fmt(rect.y)}" width="${fmt(rect.width)}" height="${fmt(rect.height)}" fill="${rect.color}"/>`);
    }
    parts.push('</g>');
  }

  // Selection layer (render before text so text appears on top)
  if (selection) {
    const { start, end, row } = selection;
    const selStart = Math.min(start, end);
    const selEnd = Math.max(start, end);
    const selectionX = r(padding + selStart * charWidth);
    const selectionY = r(contentStartY + row * lineHeight);
    const selectionWidth = r((selEnd - selStart) * charWidth);
    const selectionColor = theme.selection ?? '#44475a';

    parts.push('<g class="selection-layer">');
    parts.push(
      `<rect x="${fmt(selectionX)}" y="${fmt(selectionY)}" ` +
      `width="${fmt(selectionWidth)}" height="${fmt(lineHeight)}" fill="${selectionColor}" opacity="0.5"/>`
    );
    parts.push('</g>');
  }

  // Text layer
  // Use rx() for x-coordinates to round to half-pixels for better text alignment
  parts.push('<g class="text-layer">');
  for (const row of rows) {
    for (const span of row) {
      const x = rx(padding + span.col * charWidth);
      const y = r(contentStartY + span.row * lineHeight);

      const classes = ['text', ...styleToClasses(span.style)];
      let fillAttr = '';

      if (span.style.fg) {
        if (isTruecolor(span.style.fg)) {
          fillAttr = ` fill="${span.style.fg}"`;
        } else {
          const colorClass = getColorClass(span.style.fg, theme);
          if (colorClass) {
            classes.push(colorClass);
          } else {
            fillAttr = ` fill="${span.style.fg}"`;
          }
        }
      } else {
        classes.push('fg');
      }

      // Trim trailing whitespace unless there's a background color that needs to extend
      const rawText = span.style.bg ? span.text : span.text.trimEnd();
      if (!rawText) continue; // Skip empty text spans

      parts.push(`<text class="${classes.join(' ')}" x="${fmt(x)}" y="${fmt(y)}"${fillAttr}>${escapeXml(rawText)}</text>`);
    }
  }
  parts.push('</g>');

  // Cursor
  if (cursor && cursorVisible) {
    const cursorX = r(padding + cursor.col * charWidth);
    const rowY = r(contentStartY + cursor.row * lineHeight);

    // When custom lineHeight is provided, adjust cursor to align with text center
    // Cursor height = fontSize, positioned so cursor's middle aligns with text's middle
    const hasCustomLineHeight = config.hasCustomLineHeight ?? false;
    const cursorHeight = r(hasCustomLineHeight ? fontSize : lineHeight);
    // With text-before-edge baseline, the visible text center is approximately at 60% of fontSize
    // cursorCenter = cursorY + cursorHeight/2, textCenter = rowY + fontSize * 0.6
    // So cursorY = textCenter - cursorHeight/2 = rowY + fontSize*0.6 - cursorHeight/2
    const cursorYOffset = hasCustomLineHeight ? (fontSize * 0.85) - (cursorHeight / 2) : 0;
    const cursorY = r(rowY + cursorYOffset);

    const cursorColor = config.cursorColor ?? theme.cursor ?? theme.foreground;
    const cursorStyle = config.cursorStyle ?? 'block';
    // Use cursor-active class when actively typing (no blink)
    const cursorClass = activeCursor ? 'cursor-active' : 'cursor';

    if (cursorStyle === 'block') {
      parts.push(
        `<rect class="${cursorClass}" x="${fmt(cursorX)}" y="${fmt(cursorY)}" ` +
        `width="${fmt(charWidth)}" height="${fmt(cursorHeight)}" fill="${cursorColor}"/>`
      );
    } else if (cursorStyle === 'bar') {
      // Vertical bar cursor (2px wide)
      parts.push(
        `<rect class="${cursorClass}" x="${fmt(cursorX)}" y="${fmt(cursorY)}" ` +
        `width="2" height="${fmt(cursorHeight)}" fill="${cursorColor}"/>`
      );
    } else if (cursorStyle === 'underline') {
      // Underline cursor (2px tall at bottom of cell)
      const underlineY = r(cursorY + cursorHeight - 2);
      parts.push(
        `<rect class="${cursorClass}" x="${fmt(cursorX)}" y="${fmt(underlineY)}" ` +
        `width="${fmt(charWidth)}" height="2" fill="${cursorColor}"/>`
      );
    }
  }

  return parts.join('\n');
}

function generateAnimationKeyframes(frames: FrameData[], totalDuration: number, loop: boolean): string {
  const lines: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const nextFrame = frames[i + 1];

    const startPercent = (frame.timestamp / totalDuration) * 100;
    const endPercent = nextFrame ? (nextFrame.timestamp / totalDuration) * 100 : 100;

    lines.push(`.frame-${i} {
  animation: frame-${i}-anim ${totalDuration}ms step-end ${loop ? 'infinite' : 'forwards'};
}

@keyframes frame-${i}-anim {
  0%, ${startPercent.toFixed(2)}% { opacity: 0; }
  ${startPercent.toFixed(2)}%, ${endPercent.toFixed(2)}% { opacity: 1; }
  ${endPercent.toFixed(2)}%, 100% { opacity: 0; }
}`);
  }

  return lines.join('\n');
}
