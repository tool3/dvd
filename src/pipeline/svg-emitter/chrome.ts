//#region Imports

import type { Theme } from '../../types';
import { escapeXml } from './utils';


//#region Chrome Config Types

export interface ChromeConfig {
  template: 'macos' | 'windows' | 'minimal';
  width: number;
  height: number;
  headerHeight: number;
  padding: number;
  borderRadius: number;
  title?: string;
  theme: Theme;
  headerBackground?: string;
  headerBorder?: boolean;
  headerBorderColor?: string;
  headerBorderWidth?: number;
}

export interface FooterConfig {
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


//#region Chrome Generation

export const generateChrome = (config: ChromeConfig): string => {
  const {
    template,
    width,
    headerHeight,
    padding,
    borderRadius,
    title,
    theme,
    headerBackground,
  } = config;

  if (template === 'minimal') return '';

  const parts: string[] = [];
  const headerBg = headerBackground ?? theme.background;

  parts.push(
    `<rect class="header-bg" x="0" y="0" width="${width}" height="${headerHeight}" ` +
      `fill="${headerBg}" rx="${borderRadius}" ry="${borderRadius}"/>`
  );
  parts.push(
    `<rect x="0" y="${headerHeight - borderRadius}" width="${width}" height="${borderRadius}" fill="${headerBg}"/>`
  );

  if (template === 'macos') {
    parts.push(...generateMacOSButtons(headerHeight, padding));
  } else if (template === 'windows') {
    parts.push(...generateWindowsButtons(width, headerHeight, theme));
  }

  if (title) {
    const titleX = width / 2;
    const titleY = headerHeight / 2;
    parts.push(
      `<text class="text fg" x="${titleX}" y="${titleY}" text-anchor="middle" style="dominant-baseline: central">${escapeXml(title)}</text>`
    );
  }

  if (config.headerBorder) {
    const hBorderColor = config.headerBorderColor ?? theme.foreground;
    const hBorderWidth = config.headerBorderWidth ?? 1;
    parts.push(
      `<line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" ` +
        `stroke="${hBorderColor}" stroke-width="${hBorderWidth}"/>`
    );
  }

  return parts.join('\n');
};


//#region Platform Buttons

const generateMacOSButtons = (headerHeight: number, padding: number): string[] => {
  const buttonY = headerHeight / 2;
  const buttonRadius = 6;
  const buttonSpacing = 20;
  const buttonStartX = padding + buttonRadius;

  return [
    `<circle cx="${buttonStartX}" cy="${buttonY}" r="${buttonRadius}" fill="#ff5f56"/>`,
    `<circle cx="${buttonStartX + buttonSpacing}" cy="${buttonY}" r="${buttonRadius}" fill="#ffbd2e"/>`,
    `<circle cx="${buttonStartX + buttonSpacing * 2}" cy="${buttonY}" r="${buttonRadius}" fill="#27c93f"/>`,
  ];
};

const generateWindowsButtons = (
  width: number,
  headerHeight: number,
  theme: Theme
): string[] => {
  const buttonWidth = 46;
  const buttonHeight = headerHeight;
  const closeX = width - buttonWidth;
  const maxX = closeX - buttonWidth;
  const minX = maxX - buttonWidth;
  const iconColor = theme.foreground;
  const iconY = headerHeight / 2;

  return [
    `<rect x="${minX}" y="0" width="${buttonWidth}" height="${buttonHeight}" fill="transparent"/>`,
    `<rect x="${maxX}" y="0" width="${buttonWidth}" height="${buttonHeight}" fill="transparent"/>`,
    `<rect x="${closeX}" y="0" width="${buttonWidth}" height="${buttonHeight}" fill="transparent"/>`,
    `<line x1="${minX + 18}" y1="${iconY}" x2="${minX + 28}" y2="${iconY}" stroke="${iconColor}" stroke-width="1"/>`,
    `<rect x="${maxX + 18}" y="${iconY - 5}" width="10" height="10" stroke="${iconColor}" stroke-width="1" fill="none"/>`,
    `<line x1="${closeX + 18}" y1="${iconY - 5}" x2="${closeX + 28}" y2="${iconY + 5}" stroke="${iconColor}" stroke-width="1"/>`,
    `<line x1="${closeX + 28}" y1="${iconY - 5}" x2="${closeX + 18}" y2="${iconY + 5}" stroke="${iconColor}" stroke-width="1"/>`,
  ];
};


//#region Footer Generation

export const generateFooter = (config: FooterConfig): string => {
  const { width, height, footerHeight, borderRadius, theme, footerBackground } = config;

  if (footerHeight <= 0) return '';

  const parts: string[] = [];
  const footerY = height - footerHeight;
  const footerBg = footerBackground ?? theme.background;

  parts.push(
    `<rect class="footer-bg" x="0" y="${footerY}" width="${width}" height="${footerHeight}" ` +
      `fill="${footerBg}" rx="${borderRadius}" ry="${borderRadius}"/>`
  );
  parts.push(
    `<rect x="0" y="${footerY}" width="${width}" height="${borderRadius}" fill="${footerBg}"/>`
  );

  if (config.footerBorder) {
    const fBorderColor = config.footerBorderColor ?? theme.foreground;
    const fBorderWidth = config.footerBorderWidth ?? 1;
    parts.push(
      `<line x1="0" y1="${footerY}" x2="${width}" y2="${footerY}" ` +
        `stroke="${fBorderColor}" stroke-width="${fBorderWidth}"/>`
    );
  }

  return parts.join('\n');
};

