import { describe, expect, it } from 'vitest';
import { createGridState, processInput } from '../../pipeline/vterminal';
import { deriveOutputLines } from './shell-recorder';
import { CDExecutor } from '../cd-executor';
import type { CDScript } from '../../parser/cd-parser';
import { cellsToAnsiString, appendFrameToContext } from './shell-recorder';
import type { ExecutorContext } from '../types';
import type { FrameData } from '../../pipeline/svg-emitter';


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


//#region cellsToAnsiString SGR reset (Bug: templates.cd RUN trailing space)

describe('cellsToAnsiString resets SGR before plain-space shortcut', () => {
  /**
   * When a default-colored space follows a styled cell (e.g., the space
   * right after vitest's inverse-video " RUN " label), the ANSI emitter
   * must emit an SGR reset before the space. If it skips the reset via
   * the "plain space" shortcut, the previous SGR (bold + bg=cyan) stays
   * active in the emitted stream, and when vterminal re-parses it on
   * the final captureFrame it paints that extra space cell with the
   * inverse-video attributes — producing the "extra inverted space
   * after RUN" bug.
   */
  it('emits reset before default space that follows a styled cell', () => {
    // Build a grid by feeding the same bytes vitest emits:
    // \e[1m\e[46m RUN \e[49m\e[22m v4.1.0
    const grid = replay(80, 24, ['\x1b[1m\x1b[46m RUN \x1b[49m\x1b[22m v4.1.0']);
    const row = grid.cells[0];
    const ansi = cellsToAnsiString(row);

    // The space immediately after " RUN " (col 5) must NOT inherit the
    // bold+bg=cyan SGR. A correct emission places an SGR reset between
    // the styled " RUN " and the plain space.
    //
    // Round-trip through vterminal: parse the emitted ANSI back into a
    // fresh grid, then verify col 5 has default bg (no cyan bleed).
    const replayed = replay(80, 24, [ansi]);
    const col5 = replayed.cells[0][5];
    expect(col5.char).toBe(' ');
    expect(col5.bg.mode, 'col 5 bg must be default after round-trip').toBe('default');
    expect(col5.bold, 'col 5 bold must be false after round-trip').toBe(false);
  });

  it('still shortcuts correctly when no styling is active', () => {
    // A row that starts with a plain space and has no SGR at all
    // — the shortcut is safe here and should be taken.
    const grid = replay(80, 24, ['hello world']);
    const ansi = cellsToAnsiString(grid.cells[0]);
    // No SGR codes should be present — this is all default text.
    expect(ansi).not.toContain('\x1b[');
  });

  it('skips wide-char placeholder cells instead of emitting a real space', () => {
    // When vterminal prints a wide character (emoji, CJK), it writes a
    // spacer cell at col+1 with { char: '', width: 1 } so the cursor
    // advances correctly. The ANSI emitter must SKIP those placeholders
    // — emitting a real ' ' for them inflates the output with one extra
    // space per wide char, which re-parses into visible gaps between
    // emojis on the final captureFrame.
    const grid = replay(80, 24, ['🚀❤️😎🙈✌🏼']);

    // Sanity: grid has 5 wide-char cells + 5 placeholders (10 cols total).
    expect(grid.cells[0][0].char).toBe('🚀');
    expect(grid.cells[0][1].char).toBe('');
    expect(grid.cells[0][1].width).toBe(1);

    const ansi = cellsToAnsiString(grid.cells[0]);

    // The emitted string must NOT contain a literal space between emojis.
    // We don't need to assert the exact string — just that a round-trip
    // through vterminal preserves the tight packing.
    const replayed = replay(80, 24, [ansi]);
    // After round-trip, emoji should be at even columns with placeholders
    // at odd columns — no real space cells interleaved.
    expect(replayed.cells[0][0].char).toBe('🚀');
    expect(replayed.cells[0][1].char).toBe('');
    expect(replayed.cells[0][2].char).toBe('❤️');
    expect(replayed.cells[0][3].char).toBe('');
    expect(replayed.cells[0][4].char).toBe('😎');
    expect(replayed.cells[0][6].char).toBe('🙈');
    expect(replayed.cells[0][8].char).toBe('✌🏼');
  });

  it('preserves dim attribute on leading whitespace (flash bug)', () => {
    // Vitest emits lines like "\x1b[2m   Duration \x1b[22m 746ms" where the
    // leading whitespace has the dim attribute. The shortcut must not treat
    // a dim space as a "plain" space — that would drop the dim and render
    // those cells as full-brightness white in the round-trip, producing
    // a visible color flash between merge frames and the final captureFrame.
    const grid = replay(80, 24, ['\x1b[2m   Duration \x1b[22m 746ms']);

    // Sanity: the 3 leading cells really have dim=true in the grid.
    expect(grid.cells[0][0].dim).toBe(true);
    expect(grid.cells[0][1].dim).toBe(true);
    expect(grid.cells[0][2].dim).toBe(true);

    const ansi = cellsToAnsiString(grid.cells[0]);
    const replayed = replay(80, 24, [ansi]);

    // After round-trip, dim must be preserved on all three leading spaces.
    expect(replayed.cells[0][0].dim, 'col 0 dim preserved').toBe(true);
    expect(replayed.cells[0][1].dim, 'col 1 dim preserved').toBe(true);
    expect(replayed.cells[0][2].dim, 'col 2 dim preserved').toBe(true);
  });
});


//#region Monotonic frame timestamps across shell execution (Bug: templates Enter flash)

describe('shell-recorder produces monotonic frame timestamps', () => {
  /**
   * The pre-Enter captureFrame runs in the main ctx.startTime/captureOverhead
   * timebase; shell-recorder merge frames are computed from commandStartTime +
   * recording-event-ts. Because captureOverhead is updated AFTER the pre-Enter
   * captureFrame returns, commandStartTime can land BEFORE the pre-Enter
   * frame's timestamp, producing out-of-order entries in ctx.frameData.
   * When the filmstrip/SMIL animator normalizes timestamps to keyTimes, the
   * pre-Enter frame plays AFTER the first merge frame — the shell output
   * momentarily disappears. That's the flash.
   *
   * Invariant to protect: timestamps in ctx.frameData must be
   * non-decreasing from one entry to the next.
   */
  it('clamps merge-frame timestamps to stay strictly greater than the last frame', () => {
    // Unit-level check: when shell-recorder's merge frame carries an
    // out-of-order timestamp (because commandStartTime drifted before
    // the pre-Enter captureFrame's timestamp), appendFrameToContext
    // must clamp it upward.
    const ctx = {
      frameData: [],
      frames: [],
      lastFrameTimestamp: 5161, // simulated pre-Enter timestamp from templates.cd
      maxLineLength: 0,
      maxVisualRow: 0,
      autoWidth: false,
      autoHeight: false,
      width: 800,
      height: 600,
      fontSize: 14,
    } as unknown as ExecutorContext;

    const incoming: FrameData = {
      rows: [],
      cursor: { row: 16, col: 0 },
      cursorVisible: false,
      timestamp: 5138, // BEFORE lastFrameTimestamp — non-monotonic
      activeCursor: false,
    };

    appendFrameToContext(ctx, {} as never, incoming);

    const stored = ctx.frameData[0];
    expect(stored.timestamp, 'timestamp clamped past lastFrameTimestamp').toBeGreaterThan(5161);
    expect(ctx.lastFrameTimestamp, 'context advanced to clamped value').toBeGreaterThan(5161);
  });

  it('keeps frame timestamps non-decreasing across Enter -> shell -> next prompt', async () => {
    // Reproduce the templates.cd flash: a long-running shell command followed
    // by a second shell command. The long command inflates ctx.captureOverhead
    // enough that the second Enter's pre-capture frame ends up with a larger
    // timestamp than the subsequent merge frames.
    const script: CDScript = {
      commands: [
        // A command that takes a noticeable time so captureOverhead grows.
        { type: 'Type', text: 'sleep 0.3 && printf "a\\nb\\nc\\nd\\n"' },
        { type: 'Key', key: 'Enter' },
        { type: 'Sleep', duration: 100 },
        // Second command — the Enter here is where the flash appeared.
        { type: 'Type', text: 'echo tail' },
        { type: 'Key', key: 'Enter' },
      ],
      settings: new Map<string, string>([['TypingSpeed', '1']]),
      requirements: [],
    };

    const exec = new CDExecutor({});
    await exec.execute(script);
    const frameData = exec['context'].frameData;

    let prev = -Infinity;
    for (let i = 0; i < frameData.length; i++) {
      const ts = frameData[i].timestamp;
      expect(
        ts,
        `frame ${i} timestamp (${ts}) must not precede frame ${i - 1} (${prev})`
      ).toBeGreaterThanOrEqual(prev);
      prev = ts;
    }
  }, 20_000);
});


//#region Wrapped-typed-line preservation (Bug: ansi-colors line-wrap jump)

describe('shell-recorder preserves wrapped typed command across Enter', () => {
  /**
   * When a Type command produces text that visually wraps across multiple
   * rows, pressing Enter used to cause a single-frame visual jump: shell
   * output would briefly appear on the wrap row (clobbering the second
   * visual row of the typed command), then "correct itself" one row down
   * on the final capture.
   *
   * The fix separates visualOutputStartLine (used by mergeRows to position
   * shell output in the rendered layout) from the logical outputStartLine
   * (used to write ctx.lines, which is re-wrapped by vterminal on the
   * final captureFrame). This test pins the fix: every merge frame during
   * shell output must place its cursor BELOW the wrap continuation, not on it.
   */
  it('preserves wrapped typed content in every frame from Enter through final capture', async () => {
    // Use a narrow width so a short Type command is forced to wrap.
    const script: CDScript = {
      commands: [
        { type: 'Type', text: "echo 'hello world from a long typed line'" },
        { type: 'Key', key: 'Enter' },
      ],
      settings: new Map<string, string>([
        ['Width', '200'],
        ['FontSize', '14'],
        ['TypingSpeed', '1'],
      ]),
      requirements: [],
    };

    const exec = new CDExecutor({ width: 200, fontSize: 14 });
    await exec.execute(script);
    const frameData = exec['context'].frameData;

    // Concat all span text for each row of a frame; returns an array of
    // per-row strings (sparse rows become '').
    const frameRowText = (idx: number): string[] => {
      const rows = frameData[idx].rows;
      const out: string[] = [];
      for (const row of rows) {
        if (row.length === 0) {
          out.push('');
          continue;
        }
        const text = row.map((s) => s.text).join('');
        const rowIdx = row[0].row;
        while (out.length < rowIdx) out.push('');
        out[rowIdx] = text;
      }
      return out;
    };

    // Find the index right before Enter fires. Enter triggers executeEnter,
    // whose FIRST action is an internal captureFrame with showCursor=false.
    // That's the canonical "pre-Enter" frame — its frameData.cursor is null.
    let preEnterIdx = -1;
    for (let i = 0; i < frameData.length; i++) {
      if (frameData[i].cursor === null) {
        preEnterIdx = i;
        break;
      }
    }
    expect(preEnterIdx, 'pre-Enter frame (cursor=null) should exist').toBeGreaterThanOrEqual(0);

    const preEnterRows = frameRowText(preEnterIdx);
    // The typed line must have wrapped: at least rows 0 and 1 have content.
    expect(preEnterRows[0]?.length ?? 0, 'row 0 has typed content').toBeGreaterThan(0);
    expect(preEnterRows[1]?.length ?? 0, 'row 1 has wrap continuation').toBeGreaterThan(0);

    // Every frame AFTER pre-Enter (including merge frames during shell
    // output and the final capture) must preserve rows 0 and 1 of the
    // typed content. If the bug were present, some merge frame would have
    // row 1 cleared (shell output would overwrite it), which is what the
    // user observed as the "jump and reappear".
    for (let i = preEnterIdx + 1; i < frameData.length; i++) {
      const rows = frameRowText(i);
      expect(
        rows[0] ?? '',
        `frame ${i}: row 0 typed content must be preserved`
      ).toBe(preEnterRows[0]);
      expect(
        rows[1] ?? '',
        `frame ${i}: row 1 wrap continuation must be preserved`
      ).toBe(preEnterRows[1]);
    }
  }, 15_000);
});
