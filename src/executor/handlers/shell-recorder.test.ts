import { describe, expect, it } from 'vitest';
import { createGridState, processInput } from '../../pipeline/vterminal';
import { deriveOutputLines } from './shell-recorder';


//#region Helpers

const replay = (width: number, height: number, chunks: string[]) => {
  let grid = createGridState(width, height);
  for (const chunk of chunks) {
    grid = processInput(grid, chunk);
  }
  return grid;
};


//#region deriveOutputLines

describe('deriveOutputLines', () => {
  it('returns endRow at cursor for simple single-line output', () => {
    // `echo hi` → "hi\n" leaves the cursor on row 1
    const grid = replay(80, 24, ['hi\r\n']);
    const { lines, endRow } = deriveOutputLines(grid);
    expect(endRow).toBe(1);
    expect(lines[0]).toBe('hi');
  });

  it('preserves a single trailing blank line when cursor is past content', () => {
    // Program output ends with a second newline: "hi\n\n"
    // Cursor rests on row 2; row 1 is blank but is part of the output.
    const grid = replay(80, 24, ['hi\r\n\r\n']);
    const { lines, endRow } = deriveOutputLines(grid);
    expect(endRow).toBe(2);
    expect(lines[0]).toBe('hi');
    expect(lines[1]).toBe('');
  });

  it('preserves multiple trailing blank lines (neofetch-style)', () => {
    // Simulate a command that emits content then several blank lines.
    const grid = replay(80, 24, ['line1\r\nline2\r\n\r\n\r\n']);
    const { endRow } = deriveOutputLines(grid);
    // Cursor should be at row 4 (after content rows 0,1 + blank rows 2,3)
    expect(endRow).toBe(4);
  });

  it('returns endRow=0 for empty output', () => {
    const grid = replay(80, 24, []);
    const { endRow } = deriveOutputLines(grid);
    expect(endRow).toBe(0);
  });

  it('uses last-content fallback when cursor is repositioned above content', () => {
    // Write content on rows 0..2, then move cursor back to home (0,0).
    // Some TUIs do this on redraw — we must not shrink the visible range.
    const grid = replay(80, 24, ['line1\r\nline2\r\nline3\r\n', '\x1b[H']);
    const { lines, endRow } = deriveOutputLines(grid);
    // Cursor is at row 0, but last content is on row 2 → endRow = 3
    expect(endRow).toBe(3);
    expect(lines[0]).toBe('line1');
    expect(lines[1]).toBe('line2');
    expect(lines[2]).toBe('line3');
  });

  it('handles content followed by blank followed by more content', () => {
    // "a\n\nb\n" → row 0 "a", row 1 "", row 2 "b", cursor row 3
    const grid = replay(80, 24, ['a\r\n\r\nb\r\n']);
    const { lines, endRow } = deriveOutputLines(grid);
    expect(endRow).toBe(3);
    expect(lines[0]).toBe('a');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('b');
  });

  it('trims trailing whitespace within a row but keeps the row itself', () => {
    // "hi   \n" — row 0 has content "hi" padded with spaces
    const grid = replay(80, 24, ['hi   \r\n']);
    const { lines, endRow } = deriveOutputLines(grid);
    expect(endRow).toBe(1);
    expect(lines[0]).toBe('hi'); // trimEnd applied inside derive
  });
});
