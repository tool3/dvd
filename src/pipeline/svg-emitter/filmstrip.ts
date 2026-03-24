//#region Imports

import type { SpanRow, Theme, EmitterOptions, Gradient } from '../../types';
import type { WatermarkConfig } from '../../types';
import { fmt, escapeXml, extractWatermarkDefs, getEffectiveLineHeight, getTextOffsetY, getCursorYOffset } from './utils';
import type { EmitResult } from './index';
import type { FrameData } from './animated';
import { containsCustomGlyphs, isCustomGlyph, renderCustomGlyph, type GlyphContext } from '../customGlyphs';
import { getCharWidth } from '../../utils/wcwidth';


//#region Types

export interface FilmstripOptions extends EmitterOptions {
  fps?: number;
  loop?: boolean;
  pauseAtEnd?: number;
  loopPause?: number;
  loopStyle?: 'loop' | 'reverse' | 'rewind' | 'fade';
  fadeDuration?: number;
  rewindSpeed?: number;
  // When true, render block elements (▀▄█) as geometric shapes for seamless display
  // When false (default), render as text for smaller file size with anti-aliasing
  customGlyphs?: boolean;
  // When true (default), render cursor in animation frames based on frame state
  // When false, never render cursor (matches svg-term behavior)
  showCursor?: boolean;
}

interface SymbolRegistry {
  // Map from row content hash to symbol ID (numeric)
  rowSymbols: Map<string, number>;
  // Map from color to single-letter class name
  colorClasses: Map<string, string>;
  // Symbol definitions
  symbolDefs: string[];
  nextSymbolId: number;
  nextColorId: number;
}


//#region Color Class Generation

// Use single letters for color classes (matching svg-term style)
const COLOR_CLASS_CHARS = 'cdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const getColorClassName = (index: number): string => {
  if (index < COLOR_CLASS_CHARS.length) {
    return COLOR_CLASS_CHARS[index];
  }
  return `c${index}`;
};


//#region Registry Management

const createRegistry = (): SymbolRegistry => ({
  rowSymbols: new Map(),
  colorClasses: new Map(),
  symbolDefs: [],
  nextSymbolId: 1,
  nextColorId: 0,
});

const getOrCreateColorClass = (registry: SymbolRegistry, color: string): string => {
  const existing = registry.colorClasses.get(color);
  if (existing) return existing;

  const name = getColorClassName(registry.nextColorId++);
  registry.colorClasses.set(color, name);
  return name;
};


//#region Gradient Helpers

const isGradient = (value: unknown): value is Gradient => {
  return typeof value === 'object' && value !== null && (value as Gradient).type === 'gradient';
};

const getGradientCoords = (direction: 'horizontal' | 'vertical' | 'diagonal'): { x1: string; y1: string; x2: string; y2: string } => {
  switch (direction) {
    case 'horizontal':
      return { x1: '0%', y1: '0%', x2: '100%', y2: '0%' };
    case 'diagonal':
      return { x1: '0%', y1: '0%', x2: '100%', y2: '100%' };
    case 'vertical':
    default:
      return { x1: '0%', y1: '0%', x2: '0%', y2: '100%' };
  }
};

const generateGradientDef = (gradient: Gradient, id: string): string => {
  const direction = gradient.direction ?? 'vertical';
  const { x1, y1, x2, y2 } = getGradientCoords(direction);
  const colors = gradient.reverse ? [...gradient.colors].reverse() : gradient.colors;
  const stops = colors.map((color, i) => {
    const offset = colors.length === 1 ? 50 : (i / (colors.length - 1)) * 100;
    return `<stop offset="${offset}%" stop-color="${color}"/>`;
  }).join('');
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`;
};


//#region Frame Analysis

interface UniqueFrame {
  frame: FrameData;
  frameIndex: number;  // Position in the virtual filmstrip
  timestamp: number;
}

// Group frames by content, keeping only unique visual states
const analyzeFrames = (frames: FrameData[]): UniqueFrame[] => {
  if (frames.length === 0) return [];

  const result: UniqueFrame[] = [];
  let lastContentHash = '';

  for (let i = 0; i < frames.length; i++) {
    const hash = hashFrameContent(frames[i]);
    if (hash !== lastContentHash) {
      result.push({
        frame: frames[i],
        frameIndex: result.length,
        timestamp: frames[i].timestamp,
      });
      lastContentHash = hash;
    }
  }

  return result;
};

// Generate a style hash string from style flags
const hashStyleFlags = (style: { bold: boolean; italic: boolean; underline: boolean; dim: boolean; strikethrough: boolean }): string => {
  let flags = '';
  if (style.bold) flags += 'b';
  if (style.italic) flags += 'i';
  if (style.underline) flags += 'u';
  if (style.dim) flags += 'd';
  if (style.strikethrough) flags += 's';
  return flags;
};

// Generate CSS class names for text styles (bold, italic, etc.)
const getTextStyleClasses = (style: { bold: boolean; italic: boolean; underline: boolean; dim: boolean; strikethrough: boolean }): string[] => {
  const classes: string[] = [];
  if (style.bold) classes.push('bold');
  if (style.italic) classes.push('italic');
  if (style.underline) classes.push('uline');
  if (style.dim) classes.push('dim');
  if (style.strikethrough) classes.push('strike');
  return classes;
};

const hashFrameContent = (frame: FrameData): string => {
  // Include activeCursor in hash to distinguish typing (solid cursor) from idle (blinking cursor) frames
  const cursorStr = frame.cursor ? `${frame.cursor.row},${frame.cursor.col},${frame.cursorVisible},${frame.activeCursor}` : 'null';
  const rowsStr = frame.rows.map(row =>
    row.map(span => `${span.col}:${span.text}:${span.style.fg || ''}:${span.style.bg || ''}:${hashStyleFlags(span.style)}`).join('|')
  ).join('\n');
  return `${cursorStr}::${rowsStr}`;
};


//#region Row Symbol Generation

// Generate a hash for a row's visual content
const hashRowContent = (row: SpanRow): string => {
  return row.map(span =>
    `${span.col}:${span.text}:${span.style.fg || ''}:${span.style.bg || ''}:${hashStyleFlags(span.style)}`
  ).join('|');
};

// Register a row symbol, returns symbol ID
const registerRowSymbol = (
  registry: SymbolRegistry,
  row: SpanRow,
  rowIndex: number,
  config: {
    charWidth: number;
    lineHeight: number;
    padding: number;
    contentStartY: number;
    fontSize: number;
    theme: Theme;
    customGlyphs: boolean;
    letterSpacing: number;
  }
): number | null => {
  // Skip rows that only contain whitespace with no background color
  // Rows with visible text or background color are kept
  const hasContent = row.some(span => {
    // Keep if there's visible text
    if (span.text.trim().length > 0) return true;
    // Keep if there's a background color (visible highlight)
    if (span.style.bg) return true;
    return false;
  });
  if (!hasContent) return null;

  const hash = `row:${rowIndex}:${hashRowContent(row)}`;
  const existing = registry.rowSymbols.get(hash);
  if (existing !== undefined) return existing;

  const id = registry.nextSymbolId++;
  registry.rowSymbols.set(hash, id);

  // Generate symbol content - all text elements for this row
  const { charWidth, lineHeight, padding, contentStartY, fontSize, theme, customGlyphs, letterSpacing } = config;
  // Cell Y position - top of the line cell
  const cellY = contentStartY + rowIndex * lineHeight;
  // Cursor Y position - may extend above/below the cell
  const cursorYOffset = getCursorYOffset(lineHeight, fontSize);
  const cursorY = cellY + cursorYOffset;
  // Text Y position - centered within the cursor
  const textOffsetY = getTextOffsetY(lineHeight, fontSize);
  const textY = cursorY + textOffsetY;

  // Glyph rendering config
  const glyphLineWidth = Math.max(1, fontSize * 0.08);
  const glyphHeavyLineWidth = glyphLineWidth * 2;

  const textParts: string[] = [];

  // First pass: render background rects for spans with bg color
  // Use inline fill= (not CSS classes) for zero CSS resolution overhead on SMIL frame switches
  row.forEach((span) => {
    if (!span.style.bg) return;
    const bgX = fmt(padding + span.col * charWidth);
    const bgWidth = fmt(span.width * charWidth);
    textParts.push(
      `<rect x="${bgX}" y="${fmt(cellY)}" width="${bgWidth}" height="${fmt(lineHeight)}" fill="${span.style.bg}"/>`
    );
  });

  // Second pass: render text
  // All colors are inline fill= attributes (matching master's approach for mobile perf).
  // CSS classes are used ONLY for text styling (bold, italic, etc.) — never for colors.
  row.forEach((span) => {
    const rawText = span.text;
    if (!rawText) return;

    // Determine color — always inline, never a CSS class
    let color = theme.foreground;
    if (span.style.fg) {
      color = span.style.fg;
    }

    // Build class list: always "text" (carries font/rendering), plus style classes
    const classes: string[] = ['text'];
    classes.push(...getTextStyleClasses(span.style));
    const classAttr = ` class="${classes.join(' ')}"`;


    // Use custom glyph rendering when enabled and text contains special chars
    if (customGlyphs && containsCustomGlyphs(rawText)) {
      // Render character by character for custom glyphs
      let colOffset = 0;
      [...rawText].forEach((char) => {
        const codePoint = char.codePointAt(0);
        const absoluteCol = span.col + colOffset;
        const charX = padding + absoluteCol * charWidth;
        const charDisplayWidth = getCharWidth(char);

        // Render custom glyphs (box-drawing, block elements, etc.)
        if (codePoint !== undefined && isCustomGlyph(codePoint)) {
          const glyphCtx: GlyphContext = {
            cellWidth: charWidth,
            cellHeight: lineHeight,
            x: charX,
            y: cellY,
            color,
            backgroundColor: theme.background,
            lineWidth: glyphLineWidth,
            heavyLineWidth: glyphHeavyLineWidth,
            colorClass: '', // No CSS class — colors are inline
          };
          const result = renderCustomGlyph(char, glyphCtx);
          if (result.handled) {
            textParts.push(result.svg);
            colOffset += charDisplayWidth;
            return;
          }
        }
        // Fall back to text — inline fill, optional style class
        textParts.push(
          `<text x="${fmt(charX)}" y="${fmt(textY)}" fill="${color}"${classAttr}>${escapeXml(char)}</text>`
        );

        colOffset += charDisplayWidth;
      });
    } else {
      // No custom glyphs - render as single text element with inline fill
      const x = fmt(padding + span.col * charWidth);
      const safeText = escapeXml(rawText);
      textParts.push(`<text x="${x}" y="${fmt(textY)}" fill="${color}"${classAttr}>${safeText}</text>`);
    }
  });

  registry.symbolDefs.push(`<symbol id="${id}">${textParts.join('')}</symbol>`);
  return id;
};


//#region Filmstrip Emitter

export const emitFilmstrip = (
  frames: FrameData[],
  options: FilmstripOptions,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _staticEmit: unknown
): EmitResult => {
  if (frames.length === 0) {
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', width: 0, height: 0 };
  }

  // Analyze frames to find unique visual states
  const uniqueFrames = analyzeFrames(frames);

  const { theme, template, width, height, fontSize } = options;
  const lineHeight = options.lineHeight ?? fontSize * 1.4;
  const charWidth = options.charWidth ?? fontSize * 0.6;
  const padding = options.padding ?? 16;
  // Default border radius to 8 for a polished look, unless explicitly set to 0
  const borderRadius = options.borderRadius ?? 8;
  const headerHeight = options.headerHeight ?? (template === 'minimal' ? 0 : 40);
  const contentStartY = headerHeight + padding;
  const loop = options.loop ?? true;
  const pauseAtEnd = options.pauseAtEnd ?? 0;
  const loopPause = options.loopPause ?? 0;
  const loopStyle = options.loopStyle ?? 'loop';
  const fadeDuration = options.fadeDuration ?? 1500;
  const rewindSpeed = options.rewindSpeed ?? 5;

  // Background padding
  const bgPadding = options.backgroundPadding ?? 0;
  const bgRadius = options.backgroundRadius ?? 12;
  const totalWidth = width + bgPadding * 2;
  const totalHeight = height + bgPadding * 2;
  const hasBackground = !!(options.background && bgPadding > 0);

  const lastFrame = frames[frames.length - 1];
  const forwardDuration = lastFrame.timestamp + pauseAtEnd;

  // Calculate total duration based on loop style
  let totalDuration: number;
  if (loopStyle === 'reverse') {
    // Forward + reverse at same speed + optional loop pause
    totalDuration = forwardDuration + lastFrame.timestamp + loopPause;
  } else if (loopStyle === 'rewind') {
    // Forward + fast rewind + optional loop pause
    totalDuration = forwardDuration + (lastFrame.timestamp / rewindSpeed) + loopPause;
  } else if (loopStyle === 'fade') {
    // Forward + fade duration + optional loop pause
    totalDuration = forwardDuration + fadeDuration + loopPause;
  } else {
    // Simple loop
    totalDuration = forwardDuration + loopPause;
  }

  // Create symbol registry
  const registry = createRegistry();

  // Register all unique row symbols across all frames
  const frameRowSymbols: Map<number, Map<number, number>> = new Map(); // frameIndex -> rowIndex -> symbolId

  const customGlyphs = options.customGlyphs ?? true;
  const showCursor = options.showCursor ?? true;

  const symbolConfig = {
    charWidth,
    lineHeight,
    padding,
    contentStartY,
    fontSize,
    theme,
    customGlyphs,
    letterSpacing: options.letterSpacing ?? 0,
  };

  uniqueFrames.forEach(({ frame, frameIndex }) => {
    const rowSymbolMap = new Map<number, number>();
    frame.rows.forEach((row) => {
      if (row.length === 0) return;
      const rowIdx = row[0].row;
      const symbolId = registerRowSymbol(registry, row, rowIdx, symbolConfig);
      if (symbolId !== null) {
        rowSymbolMap.set(rowIdx, symbolId);
      }
    });
    frameRowSymbols.set(frameIndex, rowSymbolMap);
  });

  // Extract watermark content and defs early so we can add defs to root
  const rawWatermarkContent = typeof options.watermark === 'string' ? options.watermark : (options.watermark as WatermarkConfig)?.content;
  const isWatermarkMarkup = typeof options.watermark === 'object'
    ? ((options.watermark as WatermarkConfig).type === 'markup' || rawWatermarkContent?.trimStart().startsWith('<'))
    : rawWatermarkContent?.trimStart().startsWith('<');

  let watermarkDefs = '';
  let watermarkContent = rawWatermarkContent;
  if (isWatermarkMarkup && rawWatermarkContent) {
    const extracted = extractWatermarkDefs(rawWatermarkContent);
    watermarkDefs = extracted.defs;
    watermarkContent = extracted.content;
  }

  // Build SVG
  const parts: string[] = [];

  // Outer SVG
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);

  // Defs: symbols for row dedup + gradients + watermark defs
  // Symbols use inline colors (no CSS classes) so there's zero CSS resolution on frame switches.
  // The <use> refs are lightweight DOM lookups; CSS cascade was the real perf bottleneck.
  parts.push('<defs>');
  if (hasBackground && isGradient(options.background)) {
    parts.push(generateGradientDef(options.background, 'bg-gradient'));
  }
  if (watermarkDefs) {
    parts.push(watermarkDefs);
  }
  registry.symbolDefs.forEach(def => parts.push(def));
  parts.push('</defs>');

  // Style section — only color classes, font, cursor. Frame switching uses SMIL, not CSS.
  // SMIL <animate attributeName="visibility" calcMode="discrete"> is handled natively by the
  // SVG renderer, while CSS @keyframes go through a heavier animation pipeline. On mobile Safari,
  // SMIL animations are dramatically faster because the SVG engine pre-computes the discrete
  // visibility schedule and only paints the active frame.
  parts.push('<style>');
  parts.push(generateColorStyles(registry, theme, hasBackground, options.background));

  // Font embedding
  if (options.embedFont && options.fontData) {
    parts.push(`@font-face{font-family:'DVDMono';src:url(data:font/woff2;base64,${options.fontData}) format('woff2');font-weight:400;font-style:normal;font-display:block}`);
  }

  // Font styling (matching master's emit() for consistent rendering)
  const defaultFonts = "'SF Mono','Monaco','Menlo','Consolas',monospace";
  const fontFamily = options.embedFont && options.fontData
    ? "'DVDMono',monospace"
    : options.fontFamily ? `'${options.fontFamily}',monospace` : defaultFonts;
  const letterSpacingStyle = options.letterSpacing ? `letter-spacing:${options.letterSpacing}px;` : '';
  parts.push(`.text{font-family:${fontFamily};font-size:${fontSize}px;dominant-baseline:text-before-edge;text-rendering:geometricPrecision;white-space:pre;${letterSpacingStyle}}`);

  // Color classes for foreground (matching master's stylesheet)
  parts.push(`.fg{fill:${theme.foreground}}`);

  // Text style classes
  parts.push('.bold{font-weight:700}.italic{font-style:italic}.uline{text-decoration:underline}.strike{text-decoration:line-through}.dim{opacity:0.5}');

  // Cursor blink animation (matching master — no mix-blend-mode)
  const cursorBlink = options.cursorBlink !== false;
  if (cursorBlink) {
    parts.push(`.cursor{animation:blink 1s step-end infinite}`);
    parts.push(`@keyframes blink{0%,50%{opacity:1}50.01%,100%{opacity:0}}`);
  } else {
    parts.push(`.cursor{opacity:1}`);
  }
  parts.push(`.cursor-active{opacity:1}`);
  parts.push('</style>');

  // Outer background (if padding)
  if (hasBackground) {
    const bgFill = isGradient(options.background) ? 'url(#bg-gradient)' : options.background;
    parts.push(`<rect width="${totalWidth}" height="${totalHeight}" rx="${bgRadius}" fill="${bgFill}"/>`);
  }

  // Terminal window group - offset by bgPadding
  parts.push(`<g transform="translate(${bgPadding},${bgPadding})">`);

  // Terminal background
  parts.push(`<rect width="${width}" height="${height}" rx="${borderRadius}" fill="${theme.background}"/>`);

  // Window border
  const borderWidth = options.borderWidth ?? 0;
  const borderColor = options.borderColor ?? theme.foreground;
  if (borderWidth > 0) {
    parts.push(
      `<rect x="${borderWidth / 2}" y="${borderWidth / 2}" ` +
        `width="${width - borderWidth}" height="${height - borderWidth}" ` +
        `fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" ` +
        `rx="${borderRadius}" ry="${borderRadius}"/>`
    );
  }

  // Window chrome (header)
  if (template !== 'minimal' && headerHeight > 0) {
    // Header background
    const headerBg = options.headerBackground || theme.background;
    parts.push(`<rect width="${width}" height="${headerHeight}" rx="${borderRadius}" fill="${headerBg}"/>`);
    // Bottom part of header (cover rounded corners)
    parts.push(`<rect y="${headerHeight - borderRadius}" width="${width}" height="${borderRadius}" fill="${headerBg}"/>`);

    // Window buttons (macOS style)
    if (template === 'macos') {
      const buttonY = headerHeight / 2;
      const buttonR = 6;
      const buttonSpacing = 20;
      const buttonStartX = 16;
      parts.push(`<circle cx="${buttonStartX}" cy="${buttonY}" r="${buttonR}" fill="#ff5f56"/>`);
      parts.push(`<circle cx="${buttonStartX + buttonSpacing}" cy="${buttonY}" r="${buttonR}" fill="#ffbd2e"/>`);
      parts.push(`<circle cx="${buttonStartX + buttonSpacing * 2}" cy="${buttonY}" r="${buttonR}" fill="#27c93f"/>`);
    }

    // Title (matching master: class="text fg" with dominant-baseline: central)
    if (options.title) {
      parts.push(`<text class="text fg" x="${width / 2}" y="${headerHeight / 2}" text-anchor="middle" style="dominant-baseline: central">${escapeXml(options.title)}</text>`);
    }

    // Header border (only if explicitly enabled)
    if (options.headerBorder === true) {
      const borderColor = options.headerBorderColor || 'rgba(255,255,255,0.1)';
      const borderW = options.headerBorderWidth || 1;
      parts.push(`<line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="${borderColor}" stroke-width="${borderW}"/>`);
    }
  }

  // Content area - clip to avoid overflow
  parts.push(`<clipPath id="content-clip"><rect x="0" y="${headerHeight}" width="${width}" height="${height - headerHeight}"/></clipPath>`);
  parts.push(`<g clip-path="url(#content-clip)">`);

  // SMIL-based animation: each frame at same position, only one visible at a time.
  // Uses SMIL <animate attributeName="visibility" calcMode="discrete"> which is handled
  // natively by the SVG renderer. On mobile Safari, SMIL is dramatically faster than CSS
  // @keyframes because the SVG engine pre-computes the discrete visibility schedule and
  // only paints the active frame — no CSS style resolution overhead per animation tick.
  const animDurationS = (totalDuration / 1000).toFixed(3);
  const smilRepeat = loop ? 'indefinite' : '1';

  // Pre-compute SMIL keyTimes and values for each frame
  const smilAnimations = generateSMILAnimations(uniqueFrames, {
    loopStyle,
    forwardDuration,
    totalDuration,
    fadeDuration,
    rewindSpeed,
    loopPause,
  });

  // Generate frame content - all frames at position (0,0), SMIL-controlled visibility
  uniqueFrames.forEach(({ frame, frameIndex }) => {
    const rowSymbolMap = frameRowSymbols.get(frameIndex) || new Map();
    const isFirst = frameIndex === 0;
    const initialVis = isFirst ? 'visible' : 'hidden';

    parts.push(`<g visibility="${initialVis}">`);

    // Row content via symbol references — deduplicates identical rows across frames
    rowSymbolMap.forEach((symbolId) => {
      parts.push(`<use xlink:href="#${symbolId}"/>`);
    });

    // Selection (render before cursor so cursor appears on top)
    if (frame.selection) {
      const { start, end, row } = frame.selection;
      const selStart = Math.min(start, end);
      const selEnd = Math.max(start, end);
      const selectionX = padding + selStart * charWidth;
      const selectionY = contentStartY + row * lineHeight;
      const selectionWidth = (selEnd - selStart) * charWidth;
      const selectionColor = theme.selection ?? '#44475a';
      parts.push(
        `<rect x="${fmt(selectionX)}" y="${fmt(selectionY)}" width="${fmt(selectionWidth)}" height="${fmt(lineHeight)}" fill="${selectionColor}" opacity="0.5"/>`
      );
    }

    // Cursor (only render if showCursor option is enabled)
    if (showCursor && frame.cursor && frame.cursorVisible) {
      const effectiveCharWidth = charWidth + (options.letterSpacing ?? 0);
      const cursorX = padding + frame.cursor.col * effectiveCharWidth;
      // Use effective cursor height to ensure minimum visual padding
      const effectiveCursorHeight = getEffectiveLineHeight(lineHeight, fontSize);
      // Center the cursor vertically on the row (may extend above/below)
      const cursorYOffset = getCursorYOffset(lineHeight, fontSize);
      const cursorY = contentStartY + frame.cursor.row * lineHeight + cursorYOffset;
      const cursorColor = options.cursorColor ?? theme.cursor ?? theme.foreground;
      const cursorStyleType = options.cursorStyle ?? 'block';
      // Use cursor-active class when typing (solid), cursor class when idle (blinking)
      // Always apply the class for mix-blend-mode styling, even when blink is disabled
      const cursorClassName = frame.activeCursor ? 'cursor-active' : 'cursor';
      const cursorClass = ` class="${cursorClassName}"`;

      if (cursorStyleType === 'block') {
        // Use cursor color from theme (with mix-blend-mode for inversion effect)
        parts.push(`<rect${cursorClass} x="${fmt(cursorX)}" y="${fmt(cursorY)}" width="${fmt(charWidth)}" height="${fmt(effectiveCursorHeight)}" fill="${cursorColor}"/>`);
      } else if (cursorStyleType === 'bar') {
        parts.push(`<rect${cursorClass} x="${fmt(cursorX)}" y="${fmt(cursorY)}" width="2" height="${fmt(effectiveCursorHeight)}" fill="${cursorColor}"/>`);
      } else {
        // underline
        const underlineY = cursorY + effectiveCursorHeight - 2;
        parts.push(`<rect${cursorClass} x="${fmt(cursorX)}" y="${fmt(underlineY)}" width="${fmt(charWidth)}" height="2" fill="${cursorColor}"/>`);
      }
    }

    // SMIL animation for this frame's visibility
    const smil = smilAnimations[frameIndex];
    if (smil) {
      parts.push(`<animate attributeName="visibility" values="${smil.values}" keyTimes="${smil.keyTimes}" dur="${animDurationS}s" repeatCount="${smilRepeat}" calcMode="discrete" fill="freeze"/>`);
    }

    // Fade overlay for fade loop style (only on last frame)
    if (loopStyle === 'fade' && frameIndex === uniqueFrames.length - 1) {
      const fadeStartNorm = forwardDuration / totalDuration;
      const fadeEndNorm = (forwardDuration + fadeDuration) / totalDuration;
      const fadeKeyTimes = `0;${fmtKeyTime(fadeStartNorm)};${fmtKeyTime(fadeEndNorm)};1`;
      const fadeValues = '1;1;0;0';
      parts.push(`<animate attributeName="opacity" values="${fadeValues}" keyTimes="${fadeKeyTimes}" dur="${animDurationS}s" repeatCount="${smilRepeat}" fill="freeze"/>`);
    }

    parts.push('</g>');
  });

  parts.push('</g>'); // content clip group

  // Footer (matching master's generateFooter)
  const footerHeight = options.footerHeight ?? 0;
  if (footerHeight > 0) {
    const footerY = height - footerHeight;
    const footerBg = options.footerBackground ?? theme.background;
    parts.push(`<rect x="0" y="${footerY}" width="${width}" height="${footerHeight}" fill="${footerBg}" rx="${borderRadius}" ry="${borderRadius}"/>`);
    parts.push(`<rect x="0" y="${footerY}" width="${width}" height="${borderRadius}" fill="${footerBg}"/>`);
    if (options.footerBorder) {
      const fBorderColor = options.footerBorderColor ?? theme.foreground;
      const fBorderWidth = options.footerBorderWidth ?? 1;
      parts.push(`<line x1="0" y1="${footerY}" x2="${width}" y2="${footerY}" stroke="${fBorderColor}" stroke-width="${fBorderWidth}"/>`);
    }
  }

  // Watermark (rendered outside clip so it's always visible, matching master's emit())
  if (watermarkContent) {
    const watermarkHeight = lineHeight;
    const watermarkY = height - padding - watermarkHeight / 2;
    const watermarkX = width - padding;
    const wmFontSize = Math.round(fontSize * 0.75);
    const wmDefaultFonts = "'SF Mono','Monaco','Menlo','Ubuntu Mono','Consolas','Courier New',monospace";
    const wmFontFamily = options.fontFamily ? `'${options.fontFamily}',monospace` : wmDefaultFonts;

    if (isWatermarkMarkup) {
      // Scale markup watermarks relative to a reference width (matching master)
      const referenceWidth = 320;
      const scale = Math.min(1, width / referenceWidth);
      const scaleTransform = scale < 1 ? ` scale(${scale.toFixed(3)})` : '';
      parts.push(
        `<g transform="translate(${watermarkX}, ${watermarkY})${scaleTransform}" font-family="${wmFontFamily}" font-size="${wmFontSize}" fill="${theme.foreground}">${watermarkContent}</g>`
      );
    } else {
      parts.push(
        `<text class="text dim" x="${watermarkX}" y="${watermarkY}" ` +
          `text-anchor="end" fill="${theme.foreground}">${escapeXml(watermarkContent)}</text>`
      );
    }
  }

  parts.push('</g>'); // terminal window group
  parts.push('</svg>');

  return { svg: parts.join(''), width: totalWidth, height: totalHeight };
};


//#region SMIL Animation Generation

interface KeyframeOptions {
  loopStyle: 'loop' | 'reverse' | 'rewind' | 'fade';
  forwardDuration: number;
  totalDuration: number;
  fadeDuration: number;
  rewindSpeed: number;
  loopPause: number;
}

interface SMILAnimation {
  values: string;    // e.g. "hidden;visible;hidden"
  keyTimes: string;  // e.g. "0;0.1;0.2"
}

// Format SMIL keyTime value (0-1 range, minimal precision)
const fmtKeyTime = (t: number): string => {
  if (t <= 0) return '0';
  if (t >= 1) return '1';
  return parseFloat(t.toFixed(6)).toString();
};

// Generate SMIL animation data for each frame.
// Uses <animate attributeName="visibility" calcMode="discrete"> which is the fastest
// SVG animation method on mobile — handled natively by the SVG renderer with zero
// CSS overhead. The discrete calcMode means instant switching with no interpolation.
const generateSMILAnimations = (
  uniqueFrames: UniqueFrame[],
  options: KeyframeOptions
): SMILAnimation[] => {
  if (uniqueFrames.length === 0) return [];

  const { loopStyle, forwardDuration, totalDuration, fadeDuration, loopPause } = options;
  const result: SMILAnimation[] = [];

  if (loopStyle === 'reverse' || loopStyle === 'rewind') {
    const lastTimestamp = uniqueFrames[uniqueFrames.length - 1].timestamp;
    const speedMultiplier = loopStyle === 'rewind' ? options.rewindSpeed : 1;

    for (let i = 0; i < uniqueFrames.length; i++) {
      const times: number[] = [];
      const values: string[] = [];

      const forwardStart = uniqueFrames[i].timestamp / totalDuration;
      const forwardEnd = i < uniqueFrames.length - 1
        ? uniqueFrames[i + 1].timestamp / totalDuration
        : forwardDuration / totalDuration;

      const reverseFrameStart = i < uniqueFrames.length - 1
        ? (lastTimestamp - uniqueFrames[i + 1].timestamp) / speedMultiplier
        : 0;
      const reverseFrameEnd = (lastTimestamp - uniqueFrames[i].timestamp) / speedMultiplier;
      const reverseStart = (forwardDuration + reverseFrameStart) / totalDuration;
      const reverseEnd = (forwardDuration + reverseFrameEnd) / totalDuration;

      if (i === 0) {
        times.push(0); values.push('visible');
        if (uniqueFrames.length > 1) { times.push(forwardEnd); values.push('hidden'); }
        times.push(reverseStart); values.push('visible');
        times.push(1); values.push('visible');
      } else if (i === uniqueFrames.length - 1) {
        times.push(0); values.push('hidden');
        times.push(forwardStart); values.push('visible');
        times.push(reverseEnd); values.push('hidden');
        times.push(1); values.push('hidden');
      } else {
        times.push(0); values.push('hidden');
        times.push(forwardStart); values.push('visible');
        times.push(forwardEnd); values.push('hidden');
        times.push(reverseStart); values.push('visible');
        times.push(reverseEnd); values.push('hidden');
        times.push(1); values.push('hidden');
      }

      result.push({
        values: values.join(';'),
        keyTimes: times.map(fmtKeyTime).join(';'),
      });
    }
  } else if (loopStyle === 'fade') {
    const fadeStartNorm = forwardDuration / totalDuration;

    for (let i = 0; i < uniqueFrames.length; i++) {
      const times: number[] = [];
      const values: string[] = [];
      const start = uniqueFrames[i].timestamp / totalDuration;
      const end = i < uniqueFrames.length - 1
        ? uniqueFrames[i + 1].timestamp / totalDuration
        : fadeStartNorm;

      if (i === 0) {
        times.push(0); values.push('visible');
        if (uniqueFrames.length > 1) { times.push(end); values.push('hidden'); }
        times.push(1); values.push('hidden');
      } else if (i === uniqueFrames.length - 1) {
        times.push(0); values.push('hidden');
        times.push(start); values.push('visible');
        times.push(1); values.push('visible');
      } else {
        times.push(0); values.push('hidden');
        times.push(start); values.push('visible');
        times.push(end); values.push('hidden');
        times.push(1); values.push('hidden');
      }

      result.push({
        values: values.join(';'),
        keyTimes: times.map(fmtKeyTime).join(';'),
      });
    }
  } else {
    // Simple loop
    for (let i = 0; i < uniqueFrames.length; i++) {
      const times: number[] = [];
      const values: string[] = [];
      const start = uniqueFrames[i].timestamp / totalDuration;
      const end = i < uniqueFrames.length - 1
        ? uniqueFrames[i + 1].timestamp / totalDuration
        : 1;

      if (i === 0) {
        times.push(0); values.push('visible');
        if (uniqueFrames.length > 1) { times.push(end); values.push('hidden'); }
        times.push(1); values.push('hidden');
      } else if (i === uniqueFrames.length - 1) {
        times.push(0); values.push('hidden');
        times.push(start); values.push('visible');
        times.push(1); values.push('visible');
      } else {
        times.push(0); values.push('hidden');
        times.push(start); values.push('visible');
        times.push(end); values.push('hidden');
        times.push(1); values.push('hidden');
      }

      result.push({
        values: values.join(';'),
        keyTimes: times.map(fmtKeyTime).join(';'),
      });
    }
  }

  return result;
};


//#region Color Styles Generation

const generateColorStyles = (
  _registry: SymbolRegistry,
  _theme: Theme,
  _hasBackground: boolean,
  _background?: string | Gradient
): string => {
  // No CSS color classes — all colors are inline fill/stroke attributes.
  // This eliminates CSS style resolution on SMIL frame switches, which is the
  // key difference between our approach and master's smooth mobile performance.
  // Master: inline fill="rgb(...)" + tiny CSS for font styling = smooth 60fps
  // CSS classes: browser must resolve hundreds of color classes per frame switch = jank
  return '';
};
