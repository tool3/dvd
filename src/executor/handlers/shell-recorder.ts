//#region Imports

import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { coalesce } from '../../pipeline/coalescer';
import type { FrameData } from '../../pipeline/svg-emitter';
import { createGridState, processInput } from '../../pipeline/vterminal';
import type { Recording } from '../../recorder';
import { createRecorder } from '../../recorder';
import type { Cell, Color, GridState, SpanRow } from '../../types';
import { captureFrame } from '../frame-capture';
import type { CDExecutorOptions, ExecutorContext } from '../types';


//#region ANSI Color Conversion

/**
 * Convert a Color to ANSI escape code parameter
 */
const colorToAnsiParam = (color: Color, isFg: boolean): string | null => {
  if (color.mode === 'default') return null;

  const base = isFg ? 38 : 48;

  if (color.mode === 'ansi16') {
    // ANSI 16 colors: 30-37 (fg) or 40-47 (bg), 90-97 (bright fg) or 100-107 (bright bg)
    const v = color.value;
    if (v < 8) return String(isFg ? 30 + v : 40 + v);
    if (v < 16) return String(isFg ? 90 + (v - 8) : 100 + (v - 8));
    return null;
  }

  if (color.mode === 'ansi256') {
    return `${base};5;${color.value}`;
  }

  if (color.mode === 'rgb') {
    const [r, g, b] = color.value;
    return `${base};2;${r};${g};${b}`;
  }

  return null;
};

/**
 * Check if two colors are equal
 */
const colorsEqual = (a: Color, b: Color): boolean => {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'default') return true;
  if (a.mode === 'ansi16' && b.mode === 'ansi16') return a.value === b.value;
  if (a.mode === 'ansi256' && b.mode === 'ansi256') return a.value === b.value;
  if (a.mode === 'rgb' && b.mode === 'rgb') {
    return a.value[0] === b.value[0] && a.value[1] === b.value[1] && a.value[2] === b.value[2];
  }
  return false;
};

/**
 * Convert grid row cells to an ANSI-colored string
 */
const cellsToAnsiString = (cells: Cell[]): string => {
  let result = '';
  let currentFg: Color = { mode: 'default' };
  let currentBg: Color = { mode: 'default' };
  let currentBold = false;
  let currentDim = false;
  let currentItalic = false;
  let currentUnderline = false;

  for (const cell of cells) {
    if (!cell.char || cell.char === ' ' && cell.fg.mode === 'default' && cell.bg.mode === 'default') {
      // Plain space with default colors - just add it
      result += cell.char || ' ';
      continue;
    }

    // Check if we need to change attributes
    const needsFgChange = !colorsEqual(cell.fg, currentFg);
    const needsBgChange = !colorsEqual(cell.bg, currentBg);
    const needsBoldChange = cell.bold !== currentBold;
    const needsDimChange = cell.dim !== currentDim;
    const needsItalicChange = cell.italic !== currentItalic;
    const needsUnderlineChange = cell.underline !== currentUnderline;

    if (needsFgChange || needsBgChange || needsBoldChange || needsDimChange || needsItalicChange || needsUnderlineChange) {
      const params: string[] = [];

      // Reset if going from styled to less styled
      if ((!cell.bold && currentBold) || (!cell.dim && currentDim) ||
          (!cell.italic && currentItalic) || (!cell.underline && currentUnderline) ||
          (cell.fg.mode === 'default' && currentFg.mode !== 'default') ||
          (cell.bg.mode === 'default' && currentBg.mode !== 'default')) {
        params.push('0');
        currentFg = { mode: 'default' };
        currentBg = { mode: 'default' };
        currentBold = false;
        currentDim = false;
        currentItalic = false;
        currentUnderline = false;
      }

      // Add attributes
      if (cell.bold && !currentBold) params.push('1');
      if (cell.dim && !currentDim) params.push('2');
      if (cell.italic && !currentItalic) params.push('3');
      if (cell.underline && !currentUnderline) params.push('4');

      // Add colors
      if (!colorsEqual(cell.fg, currentFg)) {
        const fgParam = colorToAnsiParam(cell.fg, true);
        if (fgParam) params.push(fgParam);
      }
      if (!colorsEqual(cell.bg, currentBg)) {
        const bgParam = colorToAnsiParam(cell.bg, false);
        if (bgParam) params.push(bgParam);
      }

      if (params.length > 0) {
        result += `\x1b[${params.join(';')}m`;
      }

      currentFg = cell.fg;
      currentBg = cell.bg;
      currentBold = cell.bold;
      currentDim = cell.dim;
      currentItalic = cell.italic;
      currentUnderline = cell.underline;
    }

    result += cell.char;
  }

  // Reset at end if we have any styling
  if (currentFg.mode !== 'default' || currentBg.mode !== 'default' ||
      currentBold || currentDim || currentItalic || currentUnderline) {
    result += '\x1b[0m';
  }

  return result;
};


//#region Shell Command Execution with Recording

/**
 * Execute a shell command and record all output for proper frame generation.
 * This approach separates capture (recording) from rendering (replay).
 */
export const executeShellCommandWithRecording = async (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  command: string
): Promise<void> => {
  return new Promise((resolve) => {
    const recorder = createRecorder();
    const outputStartLine = ctx.cursorY;
    const commandStartTime = Date.now() - ctx.startTime - ctx.captureOverhead;

    // Calculate terminal dimensions
    const charWidth = ctx.fontSize * ctx.charWidthRatio;
    const lineHeight = ctx.fontSize * ctx.lineHeight;
    const padding = ctx.padding ?? 16;
    const headerHeight = ctx.template === 'minimal' ? 0 : 40;
    const termWidth = Math.floor((ctx.width - padding * 2) / charWidth);
    const termHeight = Math.floor((ctx.height - headerHeight - padding * 2) / lineHeight);

    // Set up recording header with terminal dimensions
    recorder.setHeader({
      width: termWidth,
      height: termHeight,
      timestamp: Math.floor(Date.now() / 1000),
    });

    recorder.start();

    const child = spawn(ctx.shell, ['-c', command], {
      env: { ...process.env, FORCE_COLOR: '1', CLICOLOR_FORCE: '1' },
      cwd: ctx.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin?.end();

    // Use StringDecoder to handle multi-byte UTF-8 characters
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    // Record all output
    child.stdout?.on('data', (data: Buffer) => {
      const str = stdoutDecoder.write(data);
      recorder.recordOutput(str);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const str = stderrDecoder.write(data);
      recorder.recordOutput(str);
    });

    child.on('close', async () => {
      // Flush any remaining decoder content
      const stdoutRemainder = stdoutDecoder.end();
      const stderrRemainder = stderrDecoder.end();
      if (stdoutRemainder) recorder.recordOutput(stdoutRemainder);
      if (stderrRemainder) recorder.recordOutput(stderrRemainder);

      recorder.stop();

      const recording = recorder.getRecording();

      // Generate frames from the recording
      const recordingFrames = generateRecordingFrames(
        recording,
        ctx,
        commandStartTime,
        outputStartLine
      );

      // Append frames to context
      for (const frameData of recordingFrames) {
        appendFrameToContext(ctx, options, frameData);
      }

      // Update context state based on final terminal state
      updateContextFromRecording(ctx, recording, outputStartLine);

      ctx.isExecutingCommand = false;
      ctx.currentLine = '';

      // Small delay then capture final frame with cursor
      setTimeout(() => {
        const captureStart = Date.now();
        captureFrame(ctx, options, true, false);
        ctx.captureOverhead += Date.now() - captureStart;
        resolve();
      }, 100);
    });

    child.on('error', (err) => {
      recorder.stop();
      ctx.lines[ctx.cursorY] = `Command failed: ${err.message}`;
      ctx.cursorY++;
      ctx.lines[ctx.cursorY] = '';

      ctx.isExecutingCommand = false;
      ctx.currentLine = '';
      ctx.cursorX = 0;

      captureFrame(ctx, options, true, false);
      resolve();
    });
  });
};


//#region Frame Generation from Recording

/**
 * Offset all row indices in SpanRows by a given amount
 */
const offsetRows = (rows: SpanRow[], offset: number): SpanRow[] => {
  return rows.map(row =>
    row.map(span => ({
      ...span,
      row: span.row + offset,
    }))
  );
};

/**
 * Merge pre-command rows with recording output rows.
 * Pre-command rows are kept at their original positions (rows 0 to outputStartLine-1).
 * Recording output rows are offset to start at outputStartLine.
 */
const mergeRows = (preCommandRows: SpanRow[], recordingRows: SpanRow[], outputStartLine: number): SpanRow[] => {
  // Start with pre-command rows (the command line prompt and any content before it)
  const result: SpanRow[] = [...preCommandRows.slice(0, outputStartLine)];

  // Add offset recording rows
  const offsetRecordingRows = offsetRows(recordingRows, outputStartLine);
  for (const row of offsetRecordingRows) {
    // Ensure result array is large enough
    const maxRowIndex = row.reduce((max, span) => Math.max(max, span.row), 0);
    while (result.length <= maxRowIndex) {
      result.push([]);
    }
    // Merge spans into the appropriate row
    for (const span of row) {
      result[span.row] = result[span.row] || [];
      result[span.row].push(span);
    }
  }

  return result;
};

/**
 * Apply scroll viewport clipping to rows.
 * When scroll is enabled and content exceeds the visible area, only return
 * rows that fit in the viewport, offset so they render at the correct Y positions.
 */
const applyScrollClip = (
  rows: SpanRow[],
  cursorRow: number,
  ctx: ExecutorContext
): { clippedRows: SpanRow[]; adjustedCursorRow: number } => {
  if (!ctx.scroll) {
    return { clippedRows: rows, adjustedCursorRow: cursorRow };
  }

  const charWidth = ctx.fontSize * ctx.charWidthRatio;
  const lineHeightPx = ctx.fontSize * ctx.lineHeight;
  const headerHeight = ctx.template === 'minimal' ? 0 : (ctx.headerHeight ?? 40);
  const padding = ctx.padding ?? 16;
  const visibleLines = Math.floor((ctx.height - headerHeight - padding * 2) / lineHeightPx);

  // Find the highest row index with content
  let maxRow = 0;
  for (const row of rows) {
    for (const span of row) {
      maxRow = Math.max(maxRow, span.row);
    }
  }

  // Calculate scroll offset — show the bottom of content when it overflows
  let scrollOffset = 0;
  if (cursorRow >= visibleLines) {
    scrollOffset = cursorRow - visibleLines + 1;
  }

  // Filter and re-index rows to viewport
  const clippedRows: SpanRow[] = [];
  for (const row of rows) {
    if (row.length === 0) continue;
    const rowIdx = row[0].row;
    if (rowIdx >= scrollOffset && rowIdx < scrollOffset + visibleLines) {
      const newRow = rowIdx - scrollOffset;
      clippedRows.push(row.map(span => ({ ...span, row: newRow })));
    }
  }

  return {
    clippedRows,
    adjustedCursorRow: Math.max(0, cursorRow - scrollOffset),
  };
};

/**
 * Check if output contains animation escape sequences (like lolcat uses).
 * Lolcat and similar tools use terminal reset (\x1bc) or cursor restore (\x1b8)
 * to create animation effects.
 */
const isAnimatedOutput = (events: Recording['events']): boolean => {
  const allOutput = events
    .filter(([, eventType]) => eventType === 'o')
    .map(([, , data]) => data)
    .join('');

  return allOutput.includes('\x1bc') || allOutput.includes('\x1b8') || allOutput.includes('\x1b[?25l');
};

/**
 * Generate frames from a recording by replaying through vterminal.
 *
 * For normal commands (echo, ls, etc.), we capture a single frame with the final output.
 * For animated commands (lolcat, etc.), we capture frames at each terminal reset.
 */
const generateRecordingFrames = (
  recording: Recording,
  ctx: ExecutorContext,
  baseTimestamp: number,
  outputStartLine: number
): FrameData[] => {
  const frames: FrameData[] = [];
  const events = recording.events;

  if (events.length === 0) return frames;

  // Get the last frame's rows to preserve pre-command terminal content
  const lastFrameData = ctx.frameData.length > 0 ? ctx.frameData[ctx.frameData.length - 1] : null;
  const preCommandRows: SpanRow[] = lastFrameData ? lastFrameData.rows : [];

  const outputEvents = events.filter(([, eventType]) => eventType === 'o');
  if (outputEvents.length === 0) return frames;

  // Check if this is animated output
  if (isAnimatedOutput(events)) {
    return generateAnimatedFrames(recording, ctx, baseTimestamp, outputStartLine, preCommandRows);
  }

  // Non-animated: replay output incrementally, capturing a frame each time the
  // line count changes (matching master's inline line-by-line capture behavior).
  // This prevents a jarring "jump" where all output appears in a single frame.
  let grid = createGridState(recording.header.width, recording.header.height);
  let prevLineCount = 0;

  for (const [timestamp, , data] of outputEvents) {
    grid = processInput(grid, data);

    // Count lines with content
    let currentLineCount = 0;
    for (let r = 0; r < grid.cells.length; r++) {
      const hasContent = grid.cells[r].some(cell => cell.char !== ' ' || (cell.bg && cell.bg.mode !== 'default'));
      if (hasContent) currentLineCount = r + 1;
    }

    // Capture frame when a new line appears (like master's processLineByLineOutput)
    if (currentLineCount > prevLineCount) {
      const recordingRows = coalesce(grid, ctx.theme);
      const mergedRows = mergeRows(preCommandRows, recordingRows, outputStartLine);
      const cursorRow = grid.cursor.row + outputStartLine;
      const { clippedRows, adjustedCursorRow } = applyScrollClip(mergedRows, cursorRow, ctx);

      frames.push({
        rows: clippedRows,
        cursor: { row: adjustedCursorRow, col: grid.cursor.col },
        cursorVisible: false,
        timestamp: baseTimestamp + timestamp * 1000,
        activeCursor: false,
      });
      prevLineCount = currentLineCount;
    }
  }

  // Always capture final frame with complete output
  if (frames.length === 0 || prevLineCount > 0) {
    const finalTimestamp = outputEvents[outputEvents.length - 1][0];
    const recordingRows = coalesce(grid, ctx.theme);
    const mergedRows = mergeRows(preCommandRows, recordingRows, outputStartLine);
    const cursorRow = grid.cursor.row + outputStartLine;
    const { clippedRows, adjustedCursorRow } = applyScrollClip(mergedRows, cursorRow, ctx);

    frames.push({
      rows: clippedRows,
      cursor: { row: adjustedCursorRow, col: grid.cursor.col },
      cursorVisible: false,
      timestamp: baseTimestamp + finalTimestamp * 1000,
      activeCursor: false,
    });
  }

  return frames;
};

/**
 * Generate frames for animated output (lolcat, etc.).
 *
 * For terminal reset (\x1bc): each frame clears and redraws (independent frames)
 * For cursor restore (\x1b8): process incrementally, capturing a frame after each restore
 *
 * The key insight is that vterminal properly handles \x1b7 (save) and \x1b8 (restore),
 * so we just need to feed input incrementally and capture at the right moments.
 */
const generateAnimatedFrames = (
  recording: Recording,
  ctx: ExecutorContext,
  baseTimestamp: number,
  outputStartLine: number,
  preCommandRows: SpanRow[]
): FrameData[] => {
  const frames: FrameData[] = [];
  const outputEvents = recording.events.filter(([, eventType]) => eventType === 'o');

  if (outputEvents.length === 0) return frames;

  // Collect all output first
  const allOutput = outputEvents.map(([, , data]) => data).join('');

  // Determine animation type
  const usesTerminalReset = allOutput.includes('\x1bc');
  const usesCursorRestore = allOutput.includes('\x1b8');

  if (usesTerminalReset) {
    // Terminal reset clears screen - each frame is independent
    const animationFrames = allOutput.split('\x1bc').filter(f => f.trim());
    if (animationFrames.length === 0) return frames;

    const firstTimestamp = outputEvents[0][0];
    const lastTimestamp = outputEvents[outputEvents.length - 1][0];
    const totalDuration = (lastTimestamp - firstTimestamp) * 1000;
    const frameInterval = animationFrames.length > 1
      ? totalDuration / (animationFrames.length - 1)
      : ctx.animationSpeed;

    for (let i = 0; i < animationFrames.length; i++) {
      let grid = createGridState(recording.header.width, recording.header.height);
      grid = processInput(grid, animationFrames[i]);

      const recordingRows = coalesce(grid, ctx.theme);
      const mergedRows = mergeRows(preCommandRows, recordingRows, outputStartLine);
      const cursorRow = grid.cursor.row + outputStartLine;
      const { clippedRows, adjustedCursorRow } = applyScrollClip(mergedRows, cursorRow, ctx);
      const frameTimestamp = baseTimestamp + firstTimestamp * 1000 + i * frameInterval;

      frames.push({
        rows: clippedRows,
        cursor: { row: adjustedCursorRow, col: grid.cursor.col },
        cursorVisible: false,
        timestamp: frameTimestamp,
        activeCursor: false,
      });
    }
  } else if (usesCursorRestore) {
    // Cursor restore animation (lolcat style)
    // Process the entire output through vterminal, capturing frames after each \x1b8 + content
    //
    // Lolcat pattern:
    // \x1b[?25l  - hide cursor
    // \x1b7      - save cursor
    // <content> - first frame
    // \x1b8<content> - second frame (restore then draw)
    // \x1b8<content> - third frame
    // ... etc

    // Split by \x1b7 (cursor save) to separate "lines" of animation
    // Each line has multiple \x1b8 frames
    const cursorSaveSegments = allOutput.split('\x1b7');

    // Detect animation speed from the actual output timing
    const restoreTimestamps: number[] = [];
    let outputSoFar = '';
    for (const [timestamp, eventType, data] of outputEvents) {
      if (eventType === 'o') {
        const prevLength = outputSoFar.length;
        outputSoFar += data;
        let searchStart = Math.max(0, prevLength - 2);
        let idx = outputSoFar.indexOf('\x1b8', searchStart);
        while (idx !== -1 && idx >= prevLength - 2) {
          restoreTimestamps.push(timestamp);
          idx = outputSoFar.indexOf('\x1b8', idx + 2);
        }
      }
    }

    // Use fixed animationSpeed for frame interval (matches master's behavior).
    // Cursor-restore animations (lolcat) output all frames nearly instantly in
    // the recording, but should play back at a readable speed.
    const frameInterval = ctx.animationSpeed;

    const firstTimestamp = outputEvents[0][0];
    let grid = createGridState(recording.header.width, recording.header.height);
    let frameIndex = 0;

    for (const cursorSaveSegment of cursorSaveSegments) {
      if (!cursorSaveSegment) continue;

      // Split this segment by cursor restore
      const restoreSegments = cursorSaveSegment.split('\x1b8');

      for (let i = 0; i < restoreSegments.length; i++) {
        const segment = restoreSegments[i];
        if (!segment) continue;

        // For the first segment after a cursor save, process the save first
        if (i === 0) {
          // This is the initial content or content after cursor save
          // Process without restore
          grid = processInput(grid, segment);
        } else {
          // This segment comes after a cursor restore
          // First restore cursor, then process content
          grid = processInput(grid, '\x1b8' + segment);
        }

        // Only capture frame if this segment has visible content (not just control sequences)
        const hasVisibleContent = segment.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[\?[0-9;]*[hl]/g, '').trim().length > 0;
        if (hasVisibleContent) {
          const recordingRows = coalesce(grid, ctx.theme);
          const mergedRows = mergeRows(preCommandRows, recordingRows, outputStartLine);
          const cursorRow = grid.cursor.row + outputStartLine;
          const { clippedRows, adjustedCursorRow } = applyScrollClip(mergedRows, cursorRow, ctx);
          const frameTimestamp = baseTimestamp + firstTimestamp * 1000 + frameIndex * frameInterval;

          frames.push({
            rows: clippedRows,
            cursor: { row: adjustedCursorRow, col: grid.cursor.col },
            cursorVisible: false,
            timestamp: frameTimestamp,
            activeCursor: false,
          });
          frameIndex++;
        }
      }

      // After processing all restore segments for this line, process the cursor save
      // to prepare for the next line
      grid = processInput(grid, '\x1b7');
    }
  } else {
    // Non-animated - just process everything and capture single frame
    let grid = createGridState(recording.header.width, recording.header.height);
    grid = processInput(grid, allOutput);

    const recordingRows = coalesce(grid, ctx.theme);
    const mergedRows = mergeRows(preCommandRows, recordingRows, outputStartLine);
    const cursorRow = grid.cursor.row + outputStartLine;
    const { clippedRows, adjustedCursorRow } = applyScrollClip(mergedRows, cursorRow, ctx);
    const lastTimestamp = outputEvents[outputEvents.length - 1][0];

    frames.push({
      rows: clippedRows,
      cursor: { row: adjustedCursorRow, col: grid.cursor.col },
      cursorVisible: false,
      timestamp: baseTimestamp + lastTimestamp * 1000,
      activeCursor: false,
    });
  }

  return frames;
};


//#region Context Updates

/**
 * Append a FrameData to the context's frames array
 */
const appendFrameToContext = (
  ctx: ExecutorContext,
  _options: CDExecutorOptions,
  frameData: FrameData
): void => {
  // Store frameData for later SVG generation (during re-render)
  ctx.frameData.push(frameData);

  // For now, generate a placeholder frame (will be properly rendered later)
  // This is needed for the frames array to match frameData
  ctx.frames.push({
    timestamp: frameData.timestamp,
    svg: '', // Will be filled during final render
    state: {
      content: '',
      cursorX: frameData.cursor?.col ?? 0,
      cursorY: frameData.cursor?.row ?? 0,
      width: ctx.width,
      height: ctx.height,
      fontSize: ctx.fontSize,
      showCursor: frameData.cursorVisible,
      activeCursor: frameData.activeCursor ?? false,
    },
  });

  // Update auto-dimension tracking
  if (ctx.autoWidth) {
    for (const row of frameData.rows) {
      for (const span of row) {
        // Trim trailing whitespace for auto-width calculation
        // Shell output often includes padding to terminal width
        const lineLength = span.col + span.text.trimEnd().length;
        if (lineLength > ctx.maxLineLength) {
          ctx.maxLineLength = lineLength;
        }
      }
    }
  }

  if (ctx.autoHeight) {
    const maxSpanRow = frameData.rows.reduce(
      (max, row) => Math.max(max, ...row.map((span) => span.row)),
      0
    );
    // Fold in cursor row so trailing blank rows (where the cursor rests
    // after a command that ends with a newline) contribute to canvas height.
    const maxRow = Math.max(maxSpanRow, frameData.cursor?.row ?? 0);
    if (maxRow + 1 > ctx.maxVisualRow) {
      ctx.maxVisualRow = maxRow + 1;
    }
  }
};

/**
 * Derive the set of ANSI-preserved lines and the end-of-output row index
 * from a replayed terminal grid.
 *
 * The end row is the max of (grid cursor row, last-non-empty row + 1). The
 * cursor is the real resting position after the command, so it naturally
 * includes trailing blank lines emitted by the program (e.g., neofetch's
 * trailing newline). We still fall back to last-content if some full-screen
 * app repositioned the cursor above its drawn output.
 */
export const deriveOutputLines = (grid: GridState): { lines: string[]; endRow: number } => {
  const lines: string[] = [];
  for (let row = 0; row < grid.cells.length; row++) {
    const line = cellsToAnsiString(grid.cells[row]);
    lines.push(line.trimEnd());
  }

  let lastContentLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].length > 0) {
      lastContentLine = i;
      break;
    }
  }

  const endRow = Math.max(grid.cursor.row, lastContentLine + 1);
  return { lines, endRow };
};

/**
 * Update context lines based on final recording state
 */
const updateContextFromRecording = (
  ctx: ExecutorContext,
  recording: Recording,
  outputStartLine: number
): void => {
  // Replay all output to get final terminal state
  let grid = createGridState(recording.header.width, recording.header.height);

  for (const event of recording.events) {
    const [, eventType, data] = event;
    if (eventType === 'o') {
      grid = processInput(grid, data);
    }
  }

  const { lines, endRow } = deriveOutputLines(grid);

  // Write rows [0, endRow) into ctx.lines, preserving any trailing blank
  // rows that are part of the command's output (cursor sits at endRow).
  for (let i = 0; i < endRow; i++) {
    ctx.lines[outputStartLine + i] = lines[i] || '';
  }

  ctx.cursorY = outputStartLine + endRow;
  ctx.cursorX = 0;

  // Ensure lines array extends to cursor position
  while (ctx.lines.length <= ctx.cursorY) {
    ctx.lines.push('');
  }

  // Update scroll offset so next captureFrame renders the correct viewport
  if (ctx.scroll) {
    const lineHeightPx = ctx.fontSize * ctx.lineHeight;
    const headerHeight = ctx.template === 'minimal' ? 0 : (ctx.headerHeight ?? 40);
    const padding = ctx.padding ?? 16;
    const visibleLines = Math.floor((ctx.height - headerHeight - padding * 2) / lineHeightPx);
    if (ctx.cursorY >= visibleLines) {
      ctx.scrollOffset = ctx.cursorY - visibleLines + 1;
    }
  }

  // Update maxLines for auto-height
  if (ctx.autoHeight && ctx.lines.length > ctx.maxLines) {
    ctx.maxLines = ctx.lines.length;
  }
};
