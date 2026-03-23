//#region Imports

import type { CellStyle, Theme, EmitterOptions } from '../../types';


//#region CSS Class Generation

export const styleToClasses = (style: CellStyle): string[] => {
  const classes: string[] = [];
  if (style.bold) classes.push('bold');
  if (style.italic) classes.push('italic');
  if (style.underline) classes.push('uline');
  if (style.dim) classes.push('dim');
  if (style.strikethrough) classes.push('strike');
  return classes;
};


//#region Stylesheet Generation

export const generateStylesheet = (
  theme: Theme,
  options: EmitterOptions,
  usedColors?: Set<string>
): string => {
  const fontSize = options.fontSize;
  const lines: string[] = [];

  if (options.embedFont && options.fontData) {
    lines.push(`@font-face {
  font-family: 'DVDMono';
  src: url(data:font/woff2;base64,${options.fontData}) format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}`);
  }

  const defaultFonts = "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace";
  const fontFamily =
    options.embedFont && options.fontData
      ? "'DVDMono', monospace"
      : options.fontFamily
        ? `'${options.fontFamily}', monospace`
        : defaultFonts;

  const letterSpacingStyle = options.letterSpacing ? `\n  letter-spacing: ${options.letterSpacing}px;` : '';

  lines.push(`.text {
  font-family: ${fontFamily};
  font-size: ${fontSize}px;
  dominant-baseline: text-before-edge;
  text-rendering: geometricPrecision;
  white-space: pre;${letterSpacingStyle}
}`);

  lines.push('.bold { font-weight: bold; }');
  lines.push('.italic { font-style: italic; }');
  lines.push('.uline { text-decoration: underline; }');
  lines.push('.strike { text-decoration: line-through; }');
  lines.push('.dim { opacity: 0.5; }');

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

  const shouldInclude = (cls: string) => !usedColors || usedColors.has(cls);

  if (shouldInclude('fg')) lines.push(`.fg { fill: ${theme.foreground}; }`);
  fgColors.forEach((color, i) => {
    if (shouldInclude(`f${i}`)) lines.push(`.f${i} { fill: ${color}; }`);
  });

  if (shouldInclude('bg')) lines.push(`.bg { fill: ${theme.background}; }`);
  fgColors.forEach((color, i) => {
    if (shouldInclude(`b${i}`)) lines.push(`.b${i} { fill: ${color}; }`);
  });

  const cursorBlink = options.cursorBlink !== false;
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
};


//#region Color Class Mapping

export const getColorClass = (
  color: string,
  theme: Theme,
  isBackground = false
): string | null => {
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

  if (!isBackground && color === theme.foreground) return 'fg';
  if (isBackground && color === theme.background) return 'bg';
  return colorMap[color] ?? null;
};

export const getColorFromClass = (className: string, theme: Theme): string | null => {
  const classToColor: Record<string, string> = {
    fg: theme.foreground,
    f0: theme.black,
    f1: theme.red,
    f2: theme.green,
    f3: theme.yellow,
    f4: theme.blue,
    f5: theme.magenta,
    f6: theme.cyan,
    f7: theme.white,
    f8: theme.brightBlack,
    f9: theme.brightRed,
    f10: theme.brightGreen,
    f11: theme.brightYellow,
    f12: theme.brightBlue,
    f13: theme.brightMagenta,
    f14: theme.brightCyan,
    f15: theme.brightWhite,
  };
  return classToColor[className] ?? null;
};

