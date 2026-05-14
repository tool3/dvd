//#region Imports

import type { SpanRow, CursorPosition, EmitterOptions, Gradient } from '../../types';
import { coalesceBackgrounds, mergeVerticalBackgrounds, type RenderConfig } from '../coalescer';
import { fmt, escapeXml } from './utils';
import { normalizePadding, paddingHasAny } from '../../utils/padding';
import { generateStylesheet } from './stylesheet';
import { generateChrome, generateFooter } from './chrome';
import { renderCursor, renderSelection } from './cursor';
import { renderTextLayer } from './text-renderer';
import { emitAnimated as emitAnimatedImpl, type FrameData, type AnimatedSVGOptions } from './animated';
import { emitFilmstrip, type FilmstripOptions } from './filmstrip';


//#region Gradient Helpers

const isGradient = (value: unknown): value is Gradient => {
  return typeof value === 'object' && value !== null && (value as Gradient).type === 'gradient';
};

interface GradientOptions {
  // Outer padding around the terminal window — used to keep the gradient
  // centered on the terminal area rather than the whole canvas.
  padStart?: number;
  padEnd?: number;
  totalWidth?: number;
  totalHeight?: number;
}

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

const generateGradientDef = (gradient: Gradient, id: string, options?: GradientOptions): string => {
  const direction = gradient.direction ?? 'vertical';
  const { x1, y1, x2, y2 } = getGradientCoords(direction);

  // Calculate offset adjustment to center gradient on terminal window (excluding padding)
  const padStart = options?.padStart ?? 0;
  const padEnd = options?.padEnd ?? 0;
  const totalSize = direction === 'horizontal'
    ? (options?.totalWidth ?? 0)
    : (options?.totalHeight ?? 0);

  const startPercent = totalSize > 0 ? (padStart / totalSize) * 100 : 0;
  const endPercent = totalSize > 0 ? 100 - (padEnd / totalSize) * 100 : 100;
  const rangePercent = endPercent - startPercent;

  // Apply reverse if specified
  const colors = gradient.reverse ? [...gradient.colors].reverse() : gradient.colors;

  const stops = colors.map((color, i) => {
    const baseOffset = colors.length === 1 ? 50 : (i / (colors.length - 1)) * 100;
    const adjustedOffset = startPercent + (baseOffset / 100) * rangePercent;
    return `<stop offset="${adjustedOffset.toFixed(2)}%" stop-color="${color}"/>`;
  }).join('');

  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`;
};


//#region Re-exports

export { styleToClasses, generateStylesheet, getColorClass, getColorFromClass } from './stylesheet';
export type { FrameData, AnimatedSVGOptions } from './animated';
export type { FilmstripOptions } from './filmstrip';


//#region Types

export interface EmitResult {
  svg: string;
  width: number;
  height: number;
}


//#region Main Emitter

export const emit = (
  rows: SpanRow[],
  cursor: CursorPosition | null,
  cursorVisible: boolean,
  options: EmitterOptions
): EmitResult => {
  const { theme, template, width: rawWidth, height: rawHeight, fontSize, title, watermark } = options;
  const lineHeight = options.lineHeight ?? fontSize * 1.4;
  const charWidth = options.charWidth ?? fontSize * 0.6;
  const padding = options.padding ?? 16;
  const borderRadius = options.borderRadius ?? 8;
  const borderWidth = options.borderWidth ?? 0;
  const borderColor = options.borderColor ?? theme.foreground;
  const headerHeight = options.headerHeight ?? (template === 'minimal' ? 0 : 40);
  const footerHeight = options.footerHeight ?? 0;
  const watermarkContent = typeof watermark === 'string' ? watermark : watermark?.content;
  const isWatermarkMarkup = typeof watermark === 'object'
    ? (watermark.type === 'markup' || watermarkContent?.trimStart().startsWith('<'))
    : watermarkContent?.trimStart().startsWith('<');
  const watermarkHeight = watermarkContent ? lineHeight : 0;
  const wmFontSize = watermarkContent ? Math.round(fontSize * 0.75) : 0;
  const wmContentWidth = (watermarkContent && !isWatermarkMarkup)
    ? Math.ceil(watermarkContent.length * wmFontSize * 0.6)
    : (watermarkContent && isWatermarkMarkup ? Math.min(rawWidth, 320) : 0);
  const contentStartY = headerHeight + padding;

  // Grow the terminal window to ensure the watermark always fits inside it
  const wmExtraBottom = watermarkContent ? watermarkHeight + padding : 0;
  const wmExtraRight = watermarkContent
    ? Math.max(0, wmContentWidth + padding * 2 - rawWidth)
    : 0;
  const width = rawWidth + wmExtraRight;
  const height = rawHeight + wmExtraBottom;

  // Background padding (margin around terminal window) — supports CSS-like shorthand
  const bgPad = normalizePadding(options.backgroundPadding);
  const bgRadius = options.backgroundRadius ?? 12;
  const totalWidth = width + bgPad.left + bgPad.right;
  const totalHeight = height + bgPad.top + bgPad.bottom;
  const hasBackground = !!options.background && paddingHasAny(bgPad);

  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`
  );
  parts.push('<style>');
  parts.push(generateStylesheet(theme, options));
  parts.push('</style>');

  // Add gradient definition if needed
  // Note: clipPath rect is at (0,0) because it's applied AFTER the translate transform
  if (hasBackground && isGradient(options.background)) {
    parts.push('<defs>');
    const direction = (options.background as Gradient).direction ?? 'vertical';
    parts.push(generateGradientDef(options.background, 'bg-gradient', {
      padStart: direction === 'horizontal' ? bgPad.left : bgPad.top,
      padEnd: direction === 'horizontal' ? bgPad.right : bgPad.bottom,
      totalWidth,
      totalHeight,
    }));
    if (borderRadius > 0) {
      parts.push(
        `<clipPath id="rounded-corners">` +
          `<rect x="0" y="0" width="${width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}"/>` +
          `</clipPath>`
      );
    }
    parts.push('</defs>');
  } else if (borderRadius > 0) {
    parts.push('<defs>');
    parts.push(
      `<clipPath id="rounded-corners">` +
        `<rect x="0" y="0" width="${width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}"/>` +
        `</clipPath>`
    );
    parts.push('</defs>');
  }

  // Render outer background if present
  if (hasBackground) {
    const bgFill = isGradient(options.background) ? 'url(#bg-gradient)' : options.background;
    parts.push(
      `<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="${bgFill}" rx="${bgRadius}" ry="${bgRadius}"/>`
    );
  }

  // Start terminal window group (offset by background padding)
  const hasBgOffset = paddingHasAny(bgPad);
  if (hasBgOffset) {
    parts.push(`<g transform="translate(${bgPad.left}, ${bgPad.top})">`);
  }

  if (borderRadius > 0) {
    parts.push(`<g clip-path="url(#rounded-corners)">`);
  }

  parts.push(
    `<rect class="window-bg" x="0" y="0" width="${width}" height="${height}" ` +
      `fill="${theme.background}" rx="${borderRadius}" ry="${borderRadius}"/>`
  );

  if (borderWidth > 0) {
    parts.push(
      `<rect x="${borderWidth / 2}" y="${borderWidth / 2}" ` +
        `width="${width - borderWidth}" height="${height - borderWidth}" ` +
        `fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" ` +
        `rx="${borderRadius}" ry="${borderRadius}"/>`
    );
  }

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

  parts.push(
    renderTextLayer(rows, {
      charWidth,
      lineHeight,
      padding,
      contentStartY,
      fontSize,
      theme,
    })
  );

  if (options.selection) {
    parts.push(
      renderSelection({
        ...options.selection,
        charWidth,
        lineHeight,
        padding,
        contentStartY,
        selectionColor: theme.selection ?? '#44475a',
      })
    );
  }

  if (cursor && cursorVisible) {
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
    parts.push(
      renderCursor({
        cursor,
        charWidth,
        lineHeight,
        padding,
        contentStartY,
        fontSize,
        cursorColor: options.cursorColor ?? theme.cursor ?? theme.foreground,
        cursorStyle: options.cursorStyle ?? 'block',
        activeCursor: options.activeCursor ?? false,
        charUnderCursor,
        backgroundColor: theme.background,
        fontFamily: options.fontFamily,
        letterSpacing: options.letterSpacing,
      })
    );
  }

  // Render watermark inside the terminal window (in the reserved bottom strip)
  if (watermarkContent) {
    const defaultFonts = "ui-monospace, SFMono-Regular, monospace";
    const fontFamily = options.fontFamily ? `'${options.fontFamily}', monospace` : defaultFonts;
    const watermarkX = width - padding;
    const watermarkY = rawHeight + padding / 2;

    if (options.footerBackground) {
      parts.push(
        `<rect x="0" y="${rawHeight}" width="${width}" ` +
          `height="${wmExtraBottom}" fill="${options.footerBackground}"/>`
      );
    }

    if (isWatermarkMarkup) {
      const referenceWidth = 320;
      const scale = Math.min(1, width / referenceWidth);
      const scaleTransform = scale < 1 ? ` scale(${scale.toFixed(3)})` : '';
      parts.push(
        `<g transform="translate(${watermarkX}, ${watermarkY})${scaleTransform}" font-family="${fontFamily}" font-size="${wmFontSize}" fill="${theme.foreground}">${watermarkContent}</g>`
      );
    } else {
      parts.push(
        `<text class="text dim" x="${watermarkX}" y="${watermarkY}" font-size="${wmFontSize}" ` +
          `text-anchor="end" fill="${theme.foreground}">${escapeXml(watermarkContent)}</text>`
      );
    }
  }

  if (borderRadius > 0) parts.push('</g>');

  // Close terminal window group if we have background padding
  if (hasBgOffset) {
    parts.push('</g>');
  }

  parts.push('</svg>');

  return { svg: parts.join('\n'), width: totalWidth, height: totalHeight };
};


//#region Animated Emitter

export const emitAnimated = (
  frames: FrameData[],
  options: AnimatedSVGOptions
): EmitResult => {
  return emitAnimatedImpl(frames, options, emit);
};


//#region Filmstrip Emitter (svg-term style)

export const emitFilmstripAnimated = (
  frames: FrameData[],
  options: FilmstripOptions
): EmitResult => {
  return emitFilmstrip(frames, options, emit);
};

