import type {
  Cell,
  GridState,
  CellAttributes,
  VTerminalCommand,
} from '../types';
import {
  DEFAULT_CELL,
  DEFAULT_ATTRIBUTES,
  createCell,
} from '../types';
import { getCharWidth } from '../utils/wcwidth';

const MAX_SCROLLBACK = 1000;
const TAB_WIDTH = 8;

//#region State Creation

export const createGridState = (width: number, height: number): GridState => {
  const cells: Cell[][] = Array.from({ length: height }, () => createEmptyRow(width));
  return {
    cells,
    cursor: { row: 0, col: 0 },
    width,
    height,
    scrollback: [],
    attributes: { ...DEFAULT_ATTRIBUTES },
    savedCursor: null,
    autoWrap: true,
    wrapPending: false,
    cursorVisible: true,
  };
};


//#region Core State Machine

export const applyCommand = (state: GridState, command: VTerminalCommand): GridState => {
  switch (command.type) {
    case 'print':
      return handlePrint(state, command.char, command.width);
    case 'newline':
      return handleNewline(state);
    case 'carriageReturn':
      return handleCarriageReturn(state);
    case 'tab':
      return handleTab(state);
    case 'backspace':
      return handleBackspace(state);
    case 'bell':
      return state;
    case 'cursorUp':
      return handleCursorUp(state, command.count);
    case 'cursorDown':
      return handleCursorDown(state, command.count);
    case 'cursorForward':
      return handleCursorForward(state, command.count);
    case 'cursorBack':
      return handleCursorBack(state, command.count);
    case 'cursorPosition':
      return handleCursorPosition(state, command.row, command.col);
    case 'cursorColumn':
      return handleCursorColumn(state, command.col);
    case 'cursorNextLine':
      return handleCursorNextLine(state, command.count);
    case 'cursorPrevLine':
      return handleCursorPrevLine(state, command.count);
    case 'saveCursor':
      return handleSaveCursor(state);
    case 'restoreCursor':
      return handleRestoreCursor(state);
    case 'eraseInDisplay':
      return handleEraseInDisplay(state, command.mode);
    case 'eraseInLine':
      return handleEraseInLine(state, command.mode);
    case 'sgr':
      return handleSGR(state, command.params);
    case 'scrollUp':
      return handleScrollUp(state, command.count);
    case 'scrollDown':
      return handleScrollDown(state, command.count);
    case 'setAutoWrap':
      return { ...state, autoWrap: command.enabled };
    case 'setCursorVisible':
      return { ...state, cursorVisible: command.visible };
    case 'resetTerminal':
      // ESC c (RIS) — Reset to Initial State: clear screen, reset cursor, reset attributes
      return createGridState(state.width, state.height);
    case 'noop':
      return state;
    default:
      return state;
  }
};

export const applyCommands = (state: GridState, commands: VTerminalCommand[]): GridState =>
  commands.reduce(applyCommand, state);

export const processInput = (state: GridState, input: string): GridState =>
  applyCommands(state, parseInput(input));


//#region Helper Functions

const createEmptyRow = (width: number): Cell[] =>
  Array.from({ length: width }, () => ({ ...DEFAULT_CELL }));

const cloneRow = (row: readonly Cell[]): Cell[] =>
  row.map((cell) => ({ ...cell }));

const cloneCells = (cells: readonly (readonly Cell[])[]): Cell[][] =>
  cells.map(cloneRow);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));


//#region Print Handler

const handlePrint = (state: GridState, char: string, width: 1 | 2): GridState => {
  const baseState = state.wrapPending && state.autoWrap
    ? handleNewline({ ...state, wrapPending: false })
    : state;

  const { cursor, cells, attributes, width: termWidth, height } = baseState;

  if (cursor.row < 0 || cursor.row >= height) {
    return baseState;
  }

  // If wide char doesn't fit at end of line, wrap first
  const stateAfterWideCharWrap = width === 2 && cursor.col === termWidth - 1 && baseState.autoWrap
    ? (() => {
        const spacerCells = cloneCells(cells);
        spacerCells[cursor.row][cursor.col] = { ...DEFAULT_CELL };
        return handleNewline({ ...baseState, cells: spacerCells, wrapPending: false });
      })()
    : baseState;

  const newCells = cloneCells(stateAfterWideCharWrap.cells);
  const row = stateAfterWideCharWrap.cursor.row;
  const col = stateAfterWideCharWrap.cursor.col;

  newCells[row][col] = createCell(char, width, attributes);

  // For wide characters, write spacer in next cell
  if (width === 2 && col + 1 < termWidth) {
    newCells[row][col + 1] = { ...DEFAULT_CELL, char: '', width: 1 };
  }

  const newCol = col + width;
  const atEdge = newCol >= termWidth;
  const finalCol = atEdge ? termWidth - 1 : newCol;
  const wrapPending = atEdge && stateAfterWideCharWrap.autoWrap;

  return {
    ...stateAfterWideCharWrap,
    cells: newCells,
    cursor: { row, col: finalCol },
    wrapPending,
  };
};


//#region Cursor Movement Handlers

const handleCursorUp = (state: GridState, count: number): GridState => ({
  ...state,
  cursor: { row: Math.max(0, state.cursor.row - count), col: state.cursor.col },
  wrapPending: false,
});

const handleCursorDown = (state: GridState, count: number): GridState => ({
  ...state,
  cursor: { row: Math.min(state.height - 1, state.cursor.row + count), col: state.cursor.col },
  wrapPending: false,
});

const handleCursorForward = (state: GridState, count: number): GridState => ({
  ...state,
  cursor: { row: state.cursor.row, col: Math.min(state.width - 1, state.cursor.col + count) },
  wrapPending: false,
});

const handleCursorBack = (state: GridState, count: number): GridState => ({
  ...state,
  cursor: { row: state.cursor.row, col: Math.max(0, state.cursor.col - count) },
  wrapPending: false,
});

const handleCursorPosition = (state: GridState, row: number, col: number): GridState => ({
  ...state,
  cursor: { row: clamp(row, 0, state.height - 1), col: clamp(col, 0, state.width - 1) },
  wrapPending: false,
});

const handleCursorColumn = (state: GridState, col: number): GridState => ({
  ...state,
  cursor: { row: state.cursor.row, col: clamp(col, 0, state.width - 1) },
  wrapPending: false,
});

const handleCursorNextLine = (state: GridState, count: number): GridState => ({
  ...state,
  cursor: { row: Math.min(state.height - 1, state.cursor.row + count), col: 0 },
  wrapPending: false,
});

const handleCursorPrevLine = (state: GridState, count: number): GridState => ({
  ...state,
  cursor: { row: Math.max(0, state.cursor.row - count), col: 0 },
  wrapPending: false,
});

const handleCarriageReturn = (state: GridState): GridState => ({
  ...state,
  cursor: { row: state.cursor.row, col: 0 },
  wrapPending: false,
});

const handleNewline = (state: GridState): GridState => {
  const newRow = state.cursor.row + 1;
  return newRow >= state.height
    ? scrollContentUp(state, 1)
    : { ...state, cursor: { row: newRow, col: 0 }, wrapPending: false };
};

const handleTab = (state: GridState): GridState => {
  const nextTabStop = Math.floor(state.cursor.col / TAB_WIDTH + 1) * TAB_WIDTH;
  return {
    ...state,
    cursor: { row: state.cursor.row, col: Math.min(nextTabStop, state.width - 1) },
    wrapPending: false,
  };
};

const handleBackspace = (state: GridState): GridState => ({
  ...state,
  cursor: { row: state.cursor.row, col: Math.max(0, state.cursor.col - 1) },
  wrapPending: false,
});


//#region Cursor Save/Restore

const handleSaveCursor = (state: GridState): GridState => ({
  ...state,
  savedCursor: {
    position: { ...state.cursor },
    attributes: { ...state.attributes },
  },
});

const handleRestoreCursor = (state: GridState): GridState =>
  state.savedCursor
    ? { ...state, cursor: { ...state.savedCursor.position }, attributes: { ...state.savedCursor.attributes } }
    : state;


//#region Erase Operations

const handleEraseInDisplay = (state: GridState, mode: 0 | 1 | 2 | 3): GridState => {
  const newCells = cloneCells(state.cells);
  const { cursor, width, height, attributes } = state;
  const blankCell: Cell = { ...DEFAULT_CELL, bg: attributes.bg };

  const eraseCell = (r: number, c: number) => { newCells[r][c] = { ...blankCell }; };
  const eraseRow = (r: number, startCol: number, endCol: number) => {
    for (let c = startCol; c < endCol; c++) eraseCell(r, c);
  };

  switch (mode) {
    case 0: // Erase from cursor to end
      eraseRow(cursor.row, cursor.col, width);
      for (let r = cursor.row + 1; r < height; r++) eraseRow(r, 0, width);
      break;
    case 1: // Erase from start to cursor
      eraseRow(cursor.row, 0, cursor.col + 1);
      for (let r = 0; r < cursor.row; r++) eraseRow(r, 0, width);
      break;
    case 2: // Erase entire screen
      for (let r = 0; r < height; r++) eraseRow(r, 0, width);
      break;
    case 3: // Erase entire screen AND scrollback
      for (let r = 0; r < height; r++) eraseRow(r, 0, width);
      return { ...state, cells: newCells, scrollback: [] };
  }

  return { ...state, cells: newCells };
};

const handleEraseInLine = (state: GridState, mode: 0 | 1 | 2): GridState => {
  const newCells = cloneCells(state.cells);
  const { cursor, width, attributes } = state;
  const row = cursor.row;
  const blankCell: Cell = { ...DEFAULT_CELL, bg: attributes.bg };

  const eraseRange = (start: number, end: number) => {
    for (let col = start; col < end; col++) newCells[row][col] = { ...blankCell };
  };

  switch (mode) {
    case 0: eraseRange(cursor.col, width); break;
    case 1: eraseRange(0, cursor.col + 1); break;
    case 2: eraseRange(0, width); break;
  }

  return { ...state, cells: newCells };
};


//#region Scroll Operations

const scrollContentUp = (state: GridState, count: number): GridState => {
  const newCells = cloneCells(state.cells);
  const newScrollback = [...state.scrollback];

  for (let i = 0; i < count; i++) {
    if (newCells.length > 0) newScrollback.push([...newCells[0]]);
    while (newScrollback.length > MAX_SCROLLBACK) newScrollback.shift();
    for (let row = 0; row < state.height - 1; row++) newCells[row] = newCells[row + 1];
    newCells[state.height - 1] = createEmptyRow(state.width);
  }

  return {
    ...state,
    cells: newCells,
    scrollback: newScrollback,
    cursor: { row: state.height - 1, col: 0 },
    wrapPending: false,
  };
};

const handleScrollUp = (state: GridState, count: number): GridState => {
  const newCells = cloneCells(state.cells);
  const newScrollback = [...state.scrollback];

  for (let i = 0; i < count; i++) {
    newScrollback.push([...newCells[0]]);
    while (newScrollback.length > MAX_SCROLLBACK) newScrollback.shift();
    for (let row = 0; row < state.height - 1; row++) newCells[row] = newCells[row + 1];
    newCells[state.height - 1] = createEmptyRow(state.width);
  }

  return { ...state, cells: newCells, scrollback: newScrollback };
};

const handleScrollDown = (state: GridState, count: number): GridState => {
  const newCells = cloneCells(state.cells);

  for (let i = 0; i < count; i++) {
    for (let row = state.height - 1; row > 0; row--) newCells[row] = newCells[row - 1];
    newCells[0] = createEmptyRow(state.width);
  }

  return { ...state, cells: newCells };
};


//#region SGR (Select Graphic Rendition)

const handleSGR = (state: GridState, params: number[]): GridState => {
  const newAttrs: CellAttributes = { ...state.attributes };

  let i = 0;
  while (i < params.length) {
    const code = params[i];

    switch (code) {
      case 0: Object.assign(newAttrs, DEFAULT_ATTRIBUTES); break;
      case 1: newAttrs.bold = true; break;
      case 2: newAttrs.dim = true; break;
      case 3: newAttrs.italic = true; break;
      case 4: newAttrs.underline = true; break;
      case 7: newAttrs.inverse = true; break;
      case 9: newAttrs.strikethrough = true; break;
      case 22: newAttrs.bold = false; newAttrs.dim = false; break;
      case 23: newAttrs.italic = false; break;
      case 24: newAttrs.underline = false; break;
      case 27: newAttrs.inverse = false; break;
      case 29: newAttrs.strikethrough = false; break;

      // Standard foreground (30-37)
      case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
        newAttrs.fg = { mode: 'ansi16', value: code - 30 };
        break;

      // Extended foreground (38)
      case 38:
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          newAttrs.fg = { mode: 'ansi256', value: params[i + 2] };
          i += 2;
        } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
          newAttrs.fg = { mode: 'rgb', value: [params[i + 2], params[i + 3], params[i + 4]] };
          i += 4;
        }
        break;

      case 39: newAttrs.fg = { mode: 'default' }; break;

      // Standard background (40-47)
      case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
        newAttrs.bg = { mode: 'ansi16', value: code - 40 };
        break;

      // Extended background (48)
      case 48:
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          newAttrs.bg = { mode: 'ansi256', value: params[i + 2] };
          i += 2;
        } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
          newAttrs.bg = { mode: 'rgb', value: [params[i + 2], params[i + 3], params[i + 4]] };
          i += 4;
        }
        break;

      case 49: newAttrs.bg = { mode: 'default' }; break;

      // Bright foreground (90-97)
      case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97:
        newAttrs.fg = { mode: 'ansi16', value: code - 90 + 8 };
        break;

      // Bright background (100-107)
      case 100: case 101: case 102: case 103: case 104: case 105: case 106: case 107:
        newAttrs.bg = { mode: 'ansi16', value: code - 100 + 8 };
        break;
    }

    i++;
  }

  return { ...state, attributes: newAttrs };
};


//#region ANSI Parser

const CONTROL_CHARS: Record<string, VTerminalCommand['type']> = {
  '\x07': 'bell',
  '\x08': 'backspace',
  '\x09': 'tab',
  '\x0a': 'newline',
  '\x0b': 'newline',
  '\x0c': 'newline',
  '\x0d': 'carriageReturn',
};

export const parseInput = (input: string): VTerminalCommand[] => {
  const commands: VTerminalCommand[] = [];
  let i = 0;

  while (i < input.length) {
    const code = input.charCodeAt(i);

    if (input[i] === '\x1b') {
      const result = parseEscapeSequence(input, i);
      if (result) {
        commands.push(result.command);
        i = result.endIndex;
        continue;
      }
    }

    if (code < 0x20) {
      const cmdType = CONTROL_CHARS[input[i]];
      if (cmdType) commands.push({ type: cmdType } as VTerminalCommand);
      i++;
      continue;
    }

    // Handle surrogate pairs for characters outside BMP (emojis, etc.)
    let char: string;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const lowCode = input.charCodeAt(i + 1);
      if (lowCode >= 0xdc00 && lowCode <= 0xdfff) {
        char = input.slice(i, i + 2);
        i += 2;
      } else {
        char = input[i];
        i++;
      }
    } else {
      char = input[i];
      i++;
    }

    // Consume any following variation selectors, zero-width joiners, or skin tone modifiers
    // to keep grapheme clusters together (e.g., ❤️ = ❤ + U+FE0F, ✌🏼 = ✌ + 🏼)
    while (i < input.length) {
      const nextCode = input.charCodeAt(i);

      // Variation Selectors (U+FE00-U+FE0F)
      if (nextCode >= 0xfe00 && nextCode <= 0xfe0f) {
        char += input[i];
        i++;
        continue;
      }

      // Zero Width Joiner (U+200D)
      if (nextCode === 0x200d) {
        char += input[i];
        i++;
        // After ZWJ, consume the next character (including surrogate pairs)
        if (i < input.length) {
          const zwjNextCode = input.charCodeAt(i);
          if (zwjNextCode >= 0xd800 && zwjNextCode <= 0xdbff && i + 1 < input.length) {
            const lowCode = input.charCodeAt(i + 1);
            if (lowCode >= 0xdc00 && lowCode <= 0xdfff) {
              char += input.slice(i, i + 2);
              i += 2;
            } else {
              char += input[i];
              i++;
            }
          } else {
            char += input[i];
            i++;
          }
        }
        continue;
      }

      // Skin tone modifiers (U+1F3FB-U+1F3FF) - these are surrogate pairs starting with 0xD83C
      if (nextCode === 0xd83c && i + 1 < input.length) {
        const lowCode = input.charCodeAt(i + 1);
        // Check if it's a skin tone modifier (0xDFFB-0xDFFF)
        if (lowCode >= 0xdffb && lowCode <= 0xdfff) {
          char += input.slice(i, i + 2);
          i += 2;
          continue;
        }
      }

      break;
    }

    const width = getCharWidth(char);
    if (width > 0) commands.push({ type: 'print', char, width: width as 1 | 2 });
  }

  return commands;
};

interface ParseResult {
  command: VTerminalCommand;
  endIndex: number;
}

const parseEscapeSequence = (input: string, start: number): ParseResult | null => {
  if (start + 1 >= input.length) return null;

  const next = input[start + 1];

  if (next === '[') return parseCSI(input, start + 2);
  if (next === 'c') return { command: { type: 'resetTerminal' }, endIndex: start + 2 }; // RIS - Reset to Initial State
  if (next === '7') return { command: { type: 'saveCursor' }, endIndex: start + 2 };
  if (next === '8') return { command: { type: 'restoreCursor' }, endIndex: start + 2 };

  // Keypad modes (DECKPAM / DECKPNM)
  if (next === '=') return { command: { type: 'noop' }, endIndex: start + 2 }; // Application Keypad Mode
  if (next === '>') return { command: { type: 'noop' }, endIndex: start + 2 }; // Normal Keypad Mode

  // DEC private mode sequences without CSI (ESC followed by other chars)
  // These are single-character escape sequences that should be ignored
  if (next === '(' || next === ')' || next === '*' || next === '+') {
    // Character set designation (e.g., ESC ( B for ASCII)
    if (start + 2 < input.length) {
      return { command: { type: 'noop' }, endIndex: start + 3 };
    }
    return { command: { type: 'noop' }, endIndex: start + 2 };
  }

  if (next === ']') {
    let j = start + 2;
    while (j < input.length) {
      if (input[j] === '\x07') return { command: { type: 'noop' }, endIndex: j + 1 };
      if (input[j] === '\x1b' && input[j + 1] === '\\') return { command: { type: 'noop' }, endIndex: j + 2 };
      j++;
    }
    return { command: { type: 'noop' }, endIndex: input.length };
  }

  return null;
};

const parseCSI = (input: string, start: number): ParseResult | null => {
  let params = '';
  let intermediate = '';
  let i = start;

  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code >= 0x30 && code <= 0x3f) { params += input[i]; i++; }
    else break;
  }

  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code >= 0x20 && code <= 0x2f) { intermediate += input[i]; i++; }
    else break;
  }

  if (i >= input.length) return null;

  const finalCode = input.charCodeAt(i);
  if (finalCode < 0x40 || finalCode > 0x7e) return null;

  return { command: interpretCSI(params, intermediate, input[i]), endIndex: i + 1 };
};

const interpretCSI = (params: string, _intermediate: string, final: string): VTerminalCommand => {
  const isPrivate = params.startsWith('?');
  const cleanParams = isPrivate ? params.slice(1) : params;
  const paramList = cleanParams ? cleanParams.split(';').map((p) => (p === '' ? 0 : parseInt(p, 10))) : [];
  const p1 = paramList[0] || 1;
  const p2 = paramList[1] || 1;

  switch (final) {
    case 'A': return { type: 'cursorUp', count: p1 };
    case 'B': return { type: 'cursorDown', count: p1 };
    case 'C': return { type: 'cursorForward', count: p1 };
    case 'D': return { type: 'cursorBack', count: p1 };
    case 'E': return { type: 'cursorNextLine', count: p1 };
    case 'F': return { type: 'cursorPrevLine', count: p1 };
    case 'G': return { type: 'cursorColumn', col: p1 - 1 };
    case 'H':
    case 'f': return { type: 'cursorPosition', row: p1 - 1, col: p2 - 1 };
    case 'J': return { type: 'eraseInDisplay', mode: (paramList[0] || 0) as 0 | 1 | 2 | 3 };
    case 'K': return { type: 'eraseInLine', mode: (paramList[0] || 0) as 0 | 1 | 2 };
    case 'S': return { type: 'scrollUp', count: p1 };
    case 'T': return { type: 'scrollDown', count: p1 };
    case 'm': return { type: 'sgr', params: paramList.length ? paramList : [0] };
    case 's': return { type: 'saveCursor' };
    case 'u': return { type: 'restoreCursor' };
    case 'h':
    case 'l':
      if (isPrivate) {
        // DEC Private Mode Set/Reset
        if (paramList[0] === 7) return { type: 'setAutoWrap', enabled: final === 'h' };
        if (paramList[0] === 25) return { type: 'setCursorVisible', visible: final === 'h' };
      }
      return { type: 'noop' };
    default: return { type: 'noop' };
  }
};


//#region Exports

export { MAX_SCROLLBACK, TAB_WIDTH };

