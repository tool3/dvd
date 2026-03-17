//#region Imports

import type { WatermarkConfig } from 'shellfie';


//#region Color Types

export type Color =
  | { mode: 'default' }
  | { mode: 'ansi16'; value: number }
  | { mode: 'ansi256'; value: number }
  | { mode: 'rgb'; value: [number, number, number] };

export const DEFAULT_FG: Color = { mode: 'default' };
export const DEFAULT_BG: Color = { mode: 'default' };


//#region Cell Types

export interface CellAttributes {
  fg: Color;
  bg: Color;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

export const DEFAULT_ATTRIBUTES: Readonly<CellAttributes> = Object.freeze({
  fg: DEFAULT_FG,
  bg: DEFAULT_BG,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strikethrough: false,
});

export interface Cell {
  char: string;
  width: 1 | 2;
  fg: Color;
  bg: Color;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

export const DEFAULT_CELL: Readonly<Cell> = Object.freeze({
  char: ' ',
  width: 1,
  fg: DEFAULT_FG,
  bg: DEFAULT_BG,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strikethrough: false,
});


//#region Cursor & Grid State

export interface CursorPosition {
  row: number;
  col: number;
}

export interface SavedCursorState {
  position: CursorPosition;
  attributes: CellAttributes;
}

export interface GridState {
  cells: Cell[][];
  cursor: CursorPosition;
  width: number;
  height: number;
  scrollback: Cell[][];
  attributes: CellAttributes;
  savedCursor: SavedCursorState | null;
  autoWrap: boolean;
  wrapPending: boolean;
}


//#region VTerminal Command Types

export type VTerminalCommand =
  | { type: 'print'; char: string; width: 1 | 2 }
  | { type: 'newline' }
  | { type: 'carriageReturn' }
  | { type: 'tab' }
  | { type: 'backspace' }
  | { type: 'bell' }
  | { type: 'cursorUp'; count: number }
  | { type: 'cursorDown'; count: number }
  | { type: 'cursorForward'; count: number }
  | { type: 'cursorBack'; count: number }
  | { type: 'cursorPosition'; row: number; col: number }
  | { type: 'cursorColumn'; col: number }
  | { type: 'cursorNextLine'; count: number }
  | { type: 'cursorPrevLine'; count: number }
  | { type: 'saveCursor' }
  | { type: 'restoreCursor' }
  | { type: 'eraseInDisplay'; mode: 0 | 1 | 2 | 3 }
  | { type: 'eraseInLine'; mode: 0 | 1 | 2 }
  | { type: 'sgr'; params: number[] }
  | { type: 'scrollUp'; count: number }
  | { type: 'scrollDown'; count: number }
  | { type: 'setAutoWrap'; enabled: boolean }
  | { type: 'noop' };


//#region Span Types (Coalescer output)

export interface CellStyle {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  strikethrough: boolean;
}

export interface Span {
  text: string;
  style: CellStyle;
  col: number;
  row: number;
}

export type SpanRow = Span[];


//#region Frame Types

export interface Frame {
  timestamp: number;
  grid: GridState;
  cursorVisible: boolean;
  cursorActive: boolean;
}


//#region Theme Types

export interface Theme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  selection?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}


//#region Gradient Type

export interface Gradient {
  type: 'gradient';
  colors: string[];
  direction?: 'horizontal' | 'vertical';
}


//#region Emitter Options

export interface EmitterOptions {
  theme: Theme;
  template: 'macos' | 'windows' | 'minimal';
  width: number;
  height: number;
  fontSize: number;
  lineHeight?: number;
  charWidth?: number;
  letterSpacing?: number;
  padding?: number;
  title?: string;
  watermark?: string | WatermarkConfig;
  embedFont?: boolean;
  fontData?: string;
  fontFamily?: string;
  headerBackground?: string;
  footerBackground?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  cursorBlink?: boolean;
  activeCursor?: boolean;
  selection?: { start: number; end: number; row: number } | null;
  headerHeight?: number;
  headerBorder?: boolean;
  headerBorderColor?: string;
  headerBorderWidth?: number;
  footerHeight?: number;
  footerBorder?: boolean;
  footerBorderColor?: string;
  footerBorderWidth?: number;
  cursorStyle?: 'block' | 'bar' | 'underline';
  cursorColor?: string;
  hasCustomLineHeight?: boolean;
  background?: string | Gradient;
  backgroundPadding?: number;
}


//#region Helper Functions

export const createCell = (char: string, width: 1 | 2, attrs: CellAttributes): Cell => ({
  char,
  width,
  fg: attrs.fg,
  bg: attrs.bg,
  bold: attrs.bold,
  dim: attrs.dim,
  italic: attrs.italic,
  underline: attrs.underline,
  inverse: attrs.inverse,
  strikethrough: attrs.strikethrough,
});

export const colorsEqual = (a: Color, b: Color): boolean => {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'default') return true;
  if (a.mode === 'rgb' && b.mode === 'rgb') {
    return a.value[0] === b.value[0] && a.value[1] === b.value[1] && a.value[2] === b.value[2];
  }
  if ((a.mode === 'ansi16' || a.mode === 'ansi256') && (b.mode === 'ansi16' || b.mode === 'ansi256')) {
    return (a as { value: number }).value === (b as { value: number }).value;
  }
  return false;
};

export const stylesEqual = (a: CellStyle, b: CellStyle): boolean =>
  a.fg === b.fg &&
  a.bg === b.bg &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.dim === b.dim &&
  a.strikethrough === b.strikethrough;

export const attributesEqual = (a: CellAttributes, b: CellAttributes): boolean =>
  colorsEqual(a.fg, b.fg) &&
  colorsEqual(a.bg, b.bg) &&
  a.bold === b.bold &&
  a.dim === b.dim &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.inverse === b.inverse &&
  a.strikethrough === b.strikethrough;

