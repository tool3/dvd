//#region Imports

import type { SpanRow, Theme, EmitterOptions, CursorPosition, Gradient } from '../../types';
import { coalesceBackgrounds, mergeVerticalBackgrounds, type RenderConfig } from '../coalescer';
import { r, fmt, escapeXml } from './utils';
import { generateStylesheet, styleToClasses, getColorClass } from './stylesheet';
import { generateChrome, generateFooter } from './chrome';
import { isTruecolor } from './utils';
import type { EmitResult } from './index';


//#region Gradient Helpers

const isGradient = (value: unknown): value is Gradient => {
  return typeof value === 'object' && value !== null && (value as Gradient).type === 'gradient';
};

const generateGradientDef = (gradient: Gradient, id: string): string => {
  const direction = gradient.direction ?? 'vertical';
  const x1 = direction === 'horizontal' ? '0%' : '0%';
  const y1 = direction === 'horizontal' ? '0%' : '0%';
  const x2 = direction === 'horizontal' ? '100%' : '0%';
  const y2 = direction === 'horizontal' ? '0%' : '100%';

  const stops = gradient.colors.map((color, i) => {
    const offset = gradient.colors.length === 1 ? 50 : (i / (gradient.colors.length - 1)) * 100;
    return `<stop offset="${offset}%" stop-color="${color}"/>`;
  }).join('');

  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`;
};


//#region Types

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

interface FrameRenderConfig {
  charWidth: number;
  lineHeight: number;
  padding: number;
  contentStartY: number;
  theme: Theme;
  fontSize: number;
  hasCustomLineHeight?: boolean;
  cursorColor?: string;
  cursorStyle?: 'block' | 'bar' | 'underline';
}


//#region Animated Emitter

export const emitAnimated = (
  frames: FrameData[],
  options: AnimatedSVGOptions,
  staticEmit: (rows: SpanRow[], cursor: CursorPosition | null, cursorVisible: boolean, options: EmitterOptions) => EmitResult
): EmitResult => {
  if (frames.length === 0) return staticEmit([], null, false, options);
  if (frames.length === 1)
    return staticEmit(frames[0].rows, frames[0].cursor, frames[0].cursorVisible, options);

  const { theme, template, width, height, fontSize } = options;
  const lineHeight = options.lineHeight ?? fontSize * 1.4;
  const charWidth = options.charWidth ?? fontSize * 0.6;
  const padding = options.padding ?? 16;
  const borderRadius = options.borderRadius ?? (template === 'minimal' ? 0 : 8);
  const headerHeight = options.headerHeight ?? (template === 'minimal' ? 0 : 40);
  const footerHeight = options.footerHeight ?? 0;
  const contentStartY = headerHeight + padding;
  const loop = options.loop ?? true;
  const pauseAtEnd = options.pauseAtEnd ?? 0;

  // Background padding (margin around terminal window)
  const bgPadding = options.backgroundPadding ?? 0;
  const totalWidth = width + bgPadding * 2;
  const totalHeight = height + bgPadding * 2;
  const hasBackground = options.background && bgPadding > 0;

  const lastFrame = frames[frames.length - 1];
  const totalDuration = lastFrame.timestamp + pauseAtEnd;
  const parts: string[] = [];

  // Extract watermark content and defs early so we can add defs to root
  const rawWatermarkContent = typeof options.watermark === 'string' ? options.watermark : options.watermark?.content;
  const isMarkup = typeof options.watermark === 'object'
    ? (options.watermark.type === 'markup' || rawWatermarkContent?.trimStart().startsWith('<'))
    : rawWatermarkContent?.trimStart().startsWith('<');

  let watermarkDefs = '';
  let watermarkContent = rawWatermarkContent;
  if (isMarkup && rawWatermarkContent) {
    const extracted = extractWatermarkDefs(rawWatermarkContent);
    watermarkDefs = extracted.defs;
    watermarkContent = extracted.content;
  }

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`
  );
  parts.push('<defs>');

  // Add gradient definition if needed
  if (hasBackground && isGradient(options.background)) {
    parts.push(generateGradientDef(options.background, 'bg-gradient'));
  }

  // Add watermark defs to root defs section
  if (watermarkDefs) {
    parts.push(watermarkDefs);
  }

  if (borderRadius > 0) {
    parts.push(
      `<clipPath id="rounded-corners">` +
        `<rect x="${bgPadding}" y="${bgPadding}" width="${width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}"/>` +
        `</clipPath>`
    );
  }

  const hasCustomLineHeight = options.lineHeight !== undefined;

  frames.forEach((frame, i) => {
    const frameContent = generateFrameContent(frame, {
      ...options,
      charWidth,
      lineHeight,
      padding,
      contentStartY,
      hasCustomLineHeight,
      fontSize,
      theme,
    });
    parts.push(`<g id="f${i}">${frameContent}</g>`);
  });

  parts.push('</defs>');
  parts.push('<style>');
  parts.push(generateStylesheet(theme, options));
  parts.push(generateAnimationKeyframes(frames, totalDuration, loop));
  parts.push('</style>');

  // Render outer background if present
  if (hasBackground) {
    const bgFill = isGradient(options.background) ? 'url(#bg-gradient)' : options.background;
    parts.push(
      `<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="${bgFill}"/>`
    );
  }

  // Start terminal window group (offset by background padding)
  if (bgPadding > 0) {
    parts.push(`<g transform="translate(${bgPadding}, ${bgPadding})">`);
  }

  if (borderRadius > 0) parts.push(`<g clip-path="url(#rounded-corners)">`);

  parts.push(
    `<rect class="window-bg" x="0" y="0" width="${width}" height="${height}" ` +
      `fill="${theme.background}" rx="${borderRadius}" ry="${borderRadius}"/>`
  );

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
  if (chrome) parts.push(`<g class="chrome">${chrome}</g>`);

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
    if (footer) parts.push(`<g class="footer">${footer}</g>`);
  }

  frames.forEach((_, i) => {
    parts.push(`<use href="#f${i}" class="frame frame-${i}"/>`);
  });

  // Use watermarkContent extracted earlier (with defs removed for markup)
  if (watermarkContent) {
    const watermarkHeight = lineHeight;
    const watermarkY = height - padding - watermarkHeight / 2;
    const watermarkX = width - padding;
    const wmFontSize = Math.round(fontSize * 0.75);
    const defaultFonts = "'SF Mono', 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'Courier New', monospace";
    const fontFamily = options.fontFamily ? `'${options.fontFamily}', monospace` : defaultFonts;

    if (isMarkup) {
      parts.push(
        `<g transform="translate(${watermarkX}, ${watermarkY})" font-family="${fontFamily}" font-size="${wmFontSize}" fill="${theme.foreground}">${watermarkContent}</g>`
      );
    } else {
      parts.push(
        `<text class="text dim" x="${watermarkX}" y="${watermarkY}" ` +
          `text-anchor="end" fill="${theme.foreground}">${escapeXml(watermarkContent)}</text>`
      );
    }
  }

  if (borderRadius > 0) parts.push('</g>');

  // Close terminal window group if we have background padding
  if (bgPadding > 0) {
    parts.push('</g>');
  }

  parts.push('</svg>');

  return { svg: parts.join('\n'), width: totalWidth, height: totalHeight };
};


//#region Frame Content Generation

const generateFrameContent = (
  frame: FrameData,
  config: EmitterOptions & FrameRenderConfig
): string => {
  const { rows, cursor, cursorVisible, selection, activeCursor } = frame;
  const { charWidth, lineHeight, padding, contentStartY, theme } = config;
  const fontSize = config.fontSize ?? 14;
  const parts: string[] = [];

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
    mergedBgRects.forEach((rect) => {
      parts.push(
        `<rect x="${fmt(rect.x)}" y="${fmt(rect.y)}" width="${fmt(rect.width)}" height="${fmt(rect.height)}" fill="${rect.color}"/>`
      );
    });
    parts.push('</g>');
  }

  if (selection) {
    const { start, end, row } = selection;
    const selStart = Math.min(start, end);
    const selEnd = Math.max(start, end);
    const selectionX = r(padding + selStart * charWidth);
    // When custom lineHeight is provided, offset selection to align with capital letters
    const glyphOffset = config.hasCustomLineHeight ? fontSize * 0.18 : 0;
    const selectionY = r(contentStartY + row * lineHeight + glyphOffset);
    const selectionWidth = r((selEnd - selStart) * charWidth);
    const selectionColor = theme.selection ?? '#44475a';

    parts.push('<g class="selection-layer">');
    parts.push(
      `<rect x="${fmt(selectionX)}" y="${fmt(selectionY)}" ` +
        `width="${fmt(selectionWidth)}" height="${fmt(lineHeight)}" fill="${selectionColor}" opacity="0.5"/>`
    );
    parts.push('</g>');
  }

  parts.push('<g class="text-layer">');
  rows.forEach((row) => {
    row.forEach((span) => {
      const x = Math.round(padding + span.col * charWidth);
      const y = r(contentStartY + span.row * lineHeight);
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

      const escaped = rawText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

      parts.push(
        `<text class="${classes.join(' ')}" x="${fmt(x)}" y="${fmt(y)}"${fillAttr}>${escaped}</text>`
      );
    });
  });
  parts.push('</g>');

  if (cursor && cursorVisible) {
    const cursorX = r(padding + cursor.col * charWidth);
    // Text baseline Y (same as text-layer rendering)
    const textY = r(contentStartY + cursor.row * lineHeight);
    // When custom lineHeight is provided, offset cursor to align with capital letters
    const glyphOffset = config.hasCustomLineHeight ? fontSize * 0.18 : 0;
    const cursorY = r(contentStartY + cursor.row * lineHeight + glyphOffset);
    // Cursor height matches lineHeight to align with text selection
    const cursorHeight = r(lineHeight);
    const cursorColor = config.cursorColor ?? theme.cursor ?? theme.foreground;
    const cursorStyle = config.cursorStyle ?? 'block';
    const cursorClass = activeCursor ? 'cursor-active' : 'cursor';

    if (cursorStyle === 'block') {
      // Find character under cursor for block cursor inversion
      let charUnderCursor: string | undefined;
      const cursorRow = rows[cursor.row];
      if (cursorRow) {
        for (const span of cursorRow) {
          const spanEnd = span.col + span.text.length;
          if (cursor.col >= span.col && cursor.col < spanEnd) {
            charUnderCursor = span.text[cursor.col - span.col];
            break;
          }
        }
      }

      // Wrap cursor rect and inverted character in a group so they blink together
      parts.push(`<g class="${cursorClass}">`);
      parts.push(
        `<rect x="${fmt(cursorX)}" y="${fmt(cursorY)}" ` +
          `width="${fmt(charWidth)}" height="${fmt(cursorHeight)}" fill="${cursorColor}"/>`
      );
      // Render inverted character on top of block cursor (same position as text layer)
      if (charUnderCursor && charUnderCursor.trim()) {
        const defaultFonts = "'SF Mono', 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'Courier New', monospace";
        const font = config.fontFamily ? `'${config.fontFamily}', monospace` : defaultFonts;
        parts.push(
          `<text x="${fmt(cursorX)}" y="${fmt(textY)}" fill="${theme.background}" ` +
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
  }

  return parts.join('\n');
};


//#region Watermark Defs Extraction

const extractWatermarkDefs = (content: string): { defs: string; content: string } => {
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


//#region Animation Keyframes

const generateAnimationKeyframes = (
  frames: FrameData[],
  totalDuration: number,
  loop: boolean
): string => {
  const lines: string[] = [];

  frames.forEach((frame, i) => {
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
  });

  return lines.join('\n');
};

