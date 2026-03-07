/**
 * CD Command Executor
 * Executes .cd scripts and generates animated SVG frames
 *
 * Uses the new pipeline: VTerminal → Coalescer → SVG Emitter
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CDCommand, CDScript } from '../parser/cd-parser';
import type { GridState, Theme } from '../types';
import { createGridState, processInput } from '../pipeline/vterminal';
import { coalesce } from '../pipeline/coalescer';
import { emit, type FrameData } from '../pipeline/svg-emitter';
import { themes as pipelineThemes } from '../pipeline';
import { themes as shellfieThemes, shellfie, type shellfieOptions, type Theme as ShellfieTheme } from 'shellfie';

// ============================================================================
// Types
// ============================================================================

export interface TerminalFrame {
  timestamp: number;
  svg: string;
  state: TerminalState;
}

export interface TerminalState {
  content: string;
  cursorX: number;
  cursorY: number;
  width: number;
  height: number;
  fontSize: number;
  showCursor: boolean;
  activeCursor: boolean;
  selectionStart?: number;
  selectionEnd?: number;
}

export interface CDExecutorOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  title?: string;
  template?: 'macos' | 'windows' | 'minimal';
  theme?: Theme;
  onFrame?: (frame: TerminalFrame) => void;
  onProgress?: (current: number, total: number, description?: string) => void;
}

interface ExecutorContext {
  // Terminal grid state (using VTerminal)
  grid: GridState;

  // Line-based state for typing simulation
  lines: string[];
  currentLine: string;
  cursorX: number;
  cursorY: number;

  // Frame capture
  frames: TerminalFrame[];
  frameData: FrameData[];
  startTime: number;
  captureOverhead: number; // Accumulated time spent in frame capture (to subtract from timestamps)

  // Configuration
  width: number;
  height: number;
  fontSize: number;
  typingSpeed: number;
  title?: string;
  template: 'macos' | 'windows' | 'minimal';
  theme: Theme;
  promptPrefix: string;
  watermark?: string;
  cursorBlink: boolean;

  // Selection state
  selectionStart?: number;
  selectionEnd?: number;

  // Clipboard
  clipboard: string;

  // Screenshot tracking
  screenshotCounter: number;
  outputPath?: string;

  // Auto-sizing
  autoWidth: boolean;
  autoHeight: boolean;
  maxLineLength: number;
  maxLines: number;
  maxVisualRow: number; // Track max row after VTerminal processing (accounts for cursor positioning)

  // Scrolling
  scroll: boolean;
  scrollOffset: number;

  // Execution state
  isExecutingCommand: boolean;
  // Track if we're on a continuation line (no prompt prefix)
  isMultiLineContinuation: boolean;

  // Style overrides
  headerBackground?: string;
  footerBackground?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  padding?: number;

  // Header/Footer border config (shellfie 2.0 style)
  headerHeight?: number;
  headerBorder?: boolean;
  headerBorderColor?: string;
  headerBorderWidth?: number;
  footerHeight?: number;
  footerBorder?: boolean;
  footerBorderColor?: string;
  footerBorderWidth?: number;

  // Custom cursor config
  cursorStyle?: 'block' | 'bar' | 'underline';
  cursorColor?: string;

  // Font config
  fontFamily?: string;
  embedFont?: boolean;
  fontData?: string;

  // Line height multiplier (default 1.4)
  lineHeight: number;
  // Track if user explicitly set lineHeight (for cursor alignment)
  hasCustomLineHeight: boolean;

  // Character width ratio (charWidth = fontSize * ratio, default 0.6)
  // Adjust this if your font has different character proportions
  charWidthRatio: number;

  // Shell to use for command execution (default: user's $SHELL or /bin/sh)
  shell: string;
}

// ============================================================================
// CDExecutor Class
// ============================================================================

export class CDExecutor {
  private context: ExecutorContext;
  private options: CDExecutorOptions;

  constructor(options: CDExecutorOptions = {}) {
    this.options = options;

    const width = options.width || 800;
    const height = options.height || 600;
    const fontSize = options.fontSize || 14;

    // Calculate terminal grid dimensions
    const charWidth = fontSize * 0.6;
    const lineHeight = fontSize * 1.4;
    const padding = 16;
    const headerHeight = options.template === 'minimal' ? 0 : 40;
    const termWidth = Math.floor((width - padding * 2) / charWidth);
    const termHeight = Math.floor((height - headerHeight - padding * 2) / lineHeight);

    this.context = {
      // VTerminal grid
      grid: createGridState(termWidth, termHeight),

      // Line-based state
      lines: [''],
      currentLine: '',
      cursorX: 0,
      cursorY: 0,

      // Frames
      frames: [],
      frameData: [],
      startTime: Date.now(),
      captureOverhead: 0,

      // Configuration
      width,
      height,
      fontSize,
      typingSpeed: 50,
      title: options.title,
      template: options.template || 'minimal',
      theme: options.theme || pipelineThemes.dark,
      promptPrefix: '\x1b[95m❯\x1b[0m ',
      cursorBlink: true,

      // State
      clipboard: '',
      screenshotCounter: 0,
      autoWidth: !options.width,
      autoHeight: !options.height,
      maxLineLength: 0,
      maxLines: 0,
      maxVisualRow: 0,
      scroll: !!options.height, // Enable scroll when height is fixed (content can exceed it)
      scrollOffset: 0,
      isExecutingCommand: false,
      isMultiLineContinuation: false,

      // Line height multiplier (default 1.4)
      lineHeight: 1.4,
      hasCustomLineHeight: false,

      // Character width ratio (default 0.6)
      charWidthRatio: 0.6,

      // Shell: default to user's $SHELL, fallback to /bin/sh
      shell: process.env.SHELL || '/bin/sh',
    };
  }

  // ==========================================================================
  // Frame Capture
  // ==========================================================================

  private captureFrame(showCursor: boolean = true, activeCursor: boolean = false): void {
    const buffer = [...this.context.lines];

    // Build display line with or without prompt
    let displayLine: string;

    if (this.context.isExecutingCommand || this.context.isMultiLineContinuation) {
      displayLine = this.context.currentLine;
    } else {
      displayLine = this.context.promptPrefix + this.context.currentLine;
    }

    buffer[this.context.cursorY] = displayLine;

    // Calculate layout constants
    const charWidth = this.context.fontSize * this.context.charWidthRatio;
    const lineHeight = this.context.fontSize * this.context.lineHeight;
    const padding = this.context.padding ?? 16;
    const headerHeight = this.context.template === 'minimal' ? 0 : 40;
    const contentStartY = headerHeight + padding;
    const maxContentHeight = this.context.height - contentStartY - padding;
    const maxVisibleRows = Math.floor(maxContentHeight / lineHeight);
    const visibleCols = Math.floor((this.context.width - padding * 2) / charWidth);

    // Track max dimensions for auto-sizing
    // Track width even when scrolling (width can still be auto when height is fixed)
    if (this.context.autoWidth) {
      for (const line of buffer) {
        const lineLength = this.stripAnsi(line).length;
        if (lineLength > this.context.maxLineLength) {
          this.context.maxLineLength = lineLength;
        }
      }
    }
    // Track height only when not scrolling (scroll handles height via viewport)
    if (!this.context.scroll && this.context.autoHeight) {
      if (buffer.length > this.context.maxLines) {
        this.context.maxLines = buffer.length;
      }
    }

    // Handle scrolling
    // When scroll is enabled (or height is fixed), auto-scroll to keep cursor visible
    // When scroll is explicitly disabled, show all content without scrolling
    let visibleBuffer: string[];

    const visibleLines = this.getVisibleLineCount();

    if (this.context.scroll) {
      // Auto-scroll to keep cursor visible
      if (this.context.cursorY >= this.context.scrollOffset + visibleLines) {
        // Cursor is below visible area - scroll down
        this.context.scrollOffset = this.context.cursorY - visibleLines + 1;
      } else if (this.context.cursorY < this.context.scrollOffset) {
        // Cursor is above visible area - scroll up
        this.context.scrollOffset = this.context.cursorY;
      }

      const startLine = this.context.scrollOffset;
      const endLine = Math.min(startLine + visibleLines, buffer.length);
      visibleBuffer = buffer.slice(startLine, endLine);
    } else {
      // No scrolling - show all content
      visibleBuffer = buffer;
      this.context.scrollOffset = 0;
    }

    // Update VTerminal grid with current content
    const content = visibleBuffer.join('\n');

    // Calculate grid dimensions
    let gridWidth: number;
    let gridHeight = this.context.grid.height;

    if (this.context.autoWidth) {
      // When width is auto, expand grid to fit all content (no wrapping)
      gridWidth = this.context.grid.width;
      for (const line of visibleBuffer) {
        const lineLength = this.stripAnsi(line).length;
        gridWidth = Math.max(gridWidth, lineLength + 1);
      }
      gridHeight = Math.max(gridHeight, visibleBuffer.length + 1);
    } else {
      // When width is fixed, use visible columns so text wraps correctly
      gridWidth = visibleCols;
      if (!this.context.scroll) {
        // Expand height to fit all content plus potential wrapped lines
        let estimatedRows = 0;
        for (const line of visibleBuffer) {
          const lineLength = this.stripAnsi(line).length;
          estimatedRows += Math.ceil(lineLength / visibleCols) || 1;
        }
        gridHeight = Math.max(gridHeight, estimatedRows + 5);
      }
    }

    // Create grid and process content
    let grid = createGridState(gridWidth, gridHeight);
    grid = processInput(grid, content);

    // Determine cursor position
    // VTerminal processes all content and handles wrapping/ANSI sequences correctly.
    // For command execution: use VTerminal's cursor directly
    // For typing: we need to find the visual position of cursorX within the current line
    const shouldClampCursor = !this.context.autoHeight && this.context.scroll;

    let finalCursorX: number;
    let finalCursorY: number;

    if (this.context.isExecutingCommand) {
      // During command execution: use VTerminal's cursor position
      finalCursorY = shouldClampCursor
        ? Math.max(0, Math.min(grid.cursor.row, maxVisibleRows - 1))
        : grid.cursor.row;
      finalCursorX = grid.cursor.col;
    } else {
      // During typing: process content up to cursor position to find visual coords
      // Build content with only the text up to cursor position on the current line
      const cursorBuffer = [...this.context.lines];

      // Build the current line with prompt but only up to cursorX
      const textUpToCursor = this.context.currentLine.substring(0, this.context.cursorX);
      const displayLineUpToCursor = this.context.promptPrefix + textUpToCursor;
      cursorBuffer[this.context.cursorY] = displayLineUpToCursor;

      // Get visible portion accounting for scroll
      let cursorVisibleBuffer: string[];
      if (this.context.scroll) {
        const startLine = this.context.scrollOffset;
        const endLine = Math.min(startLine + this.getVisibleLineCount(), cursorBuffer.length);
        cursorVisibleBuffer = cursorBuffer.slice(startLine, endLine);
      } else {
        cursorVisibleBuffer = cursorBuffer;
      }

      // Process through VTerminal to get correct visual cursor position
      const cursorContent = cursorVisibleBuffer.join('\n');
      let cursorGrid = createGridState(gridWidth, gridHeight);
      cursorGrid = processInput(cursorGrid, cursorContent);

      finalCursorY = shouldClampCursor
        ? Math.max(0, Math.min(cursorGrid.cursor.row, maxVisibleRows - 1))
        : cursorGrid.cursor.row;
      finalCursorX = cursorGrid.cursor.col;
    }

    // Track max visual row for auto-height (accounts for cursor positioning in commands like neofetch)
    if (this.context.autoHeight) {
      // The cursor row after VTerminal processing represents the actual visual row
      // Add 1 for zero-indexing (row 22 means 23 rows of content)
      if (grid.cursor.row + 1 > this.context.maxVisualRow) {
        this.context.maxVisualRow = grid.cursor.row + 1;
      }
    }

    // Coalesce grid to spans
    const rows = coalesce(grid, this.context.theme);

    // Build selection object if there's an active selection
    const selection =
      this.context.selectionStart !== undefined &&
      this.context.selectionEnd !== undefined &&
      this.context.selectionStart !== this.context.selectionEnd
        ? {
            start: this.context.selectionStart + (this.context.isExecutingCommand ? 0 : this.stripAnsi(this.context.promptPrefix).length),
            end: this.context.selectionEnd + (this.context.isExecutingCommand ? 0 : this.stripAnsi(this.context.promptPrefix).length),
            row: finalCursorY,
          }
        : null;

    // Generate SVG using the new emitter
    // When showCursor is true, always render the cursor - the CSS blink animation handles visibility
    const { svg } = emit(
      rows,
      showCursor ? { row: finalCursorY, col: finalCursorX } : null,
      showCursor,
      {
        theme: this.context.theme,
        template: this.context.template,
        width: this.context.width,
        height: this.context.height,
        fontSize: this.context.fontSize,
        title: this.context.title,
        watermark: this.context.watermark,
        headerBackground: this.context.headerBackground,
        footerBackground: this.context.footerBackground,
        borderColor: this.context.borderColor,
        borderWidth: this.context.borderWidth,
        borderRadius: this.context.borderRadius,
        padding: this.context.padding,
        cursorBlink: this.context.cursorBlink,
        activeCursor,
        selection,
        // Header/Footer config (shellfie 2.0 style)
        headerHeight: this.context.headerHeight,
        headerBorder: this.context.headerBorder,
        headerBorderColor: this.context.headerBorderColor,
        headerBorderWidth: this.context.headerBorderWidth,
        footerHeight: this.context.footerHeight,
        footerBorder: this.context.footerBorder,
        footerBorderColor: this.context.footerBorderColor,
        footerBorderWidth: this.context.footerBorderWidth,
        // Cursor config
        cursorStyle: this.context.cursorStyle,
        cursorColor: this.context.cursorColor,
        // Font config
        fontFamily: this.context.fontFamily,
        embedFont: this.context.embedFont,
        fontData: this.context.fontData,
        // Line height
        lineHeight: this.context.fontSize * this.context.lineHeight,
        hasCustomLineHeight: this.context.hasCustomLineHeight,
        // Character width
        charWidth: this.context.fontSize * this.context.charWidthRatio,
      }
    );

    // Create terminal state for backward compatibility
    const state: TerminalState = {
      content,
      cursorX: finalCursorX,
      cursorY: finalCursorY,
      width: this.context.width,
      height: this.context.height,
      fontSize: this.context.fontSize,
      showCursor,
      activeCursor,
      selectionStart: this.context.selectionStart,
      selectionEnd: this.context.selectionEnd,
    };

    // Subtract accumulated capture overhead to get accurate animation timing
    const timestamp = Date.now() - this.context.startTime - this.context.captureOverhead;

    const frame: TerminalFrame = {
      timestamp,
      svg,
      state,
    };

    this.context.frames.push(frame);

    // Also store frame data for animation
    this.context.frameData.push({
      rows,
      cursor: showCursor ? { row: finalCursorY, col: finalCursorX } : null,
      cursorVisible: showCursor,
      timestamp,
      selection,
      activeCursor,
    });

    this.options.onFrame?.(frame);
  }

  private getVisibleLineCount(): number {
    const headerHeight = this.context.template === 'minimal' ? 0 : 40;
    const padding = this.context.padding ?? 16;
    const lineHeight = this.context.fontSize * this.context.lineHeight;
    const watermarkHeight = this.context.watermark ? lineHeight : 0;
    const contentHeight = this.context.height - headerHeight - padding - watermarkHeight - padding;
    return Math.floor(contentHeight / lineHeight);
  }

  private stripAnsi(str: string): string {
    // Remove SGR (color) sequences and cursor control sequences
    return str
      .replace(/\x1b\[[0-9;]*m/g, '')           // SGR (colors)
      .replace(/\x1b\[[0-9;]*[A-HJKSTfsu]/g, '') // Cursor movement (A-H, J, K, S, T, f, s, u)
      .replace(/\x1b\[\?[0-9;]*[hl]/g, '');      // Mode control (show/hide cursor, etc.)
  }

  // ==========================================================================
  // Command Execution
  // ==========================================================================

  private async executeType(text: string, speed?: number): Promise<void> {
    const delay = speed || this.context.typingSpeed;

    if (this.hasSelection()) {
      this.deleteSelection();
      this.captureFrame(true, true);
      await this.sleep(delay);
    }

    for (const char of text) {
      // Handle newline character - move to next line
      if (char === '\n') {
        // Store current line (with prompt only on first line, not continuations)
        const prefix = this.context.isMultiLineContinuation ? '' : this.context.promptPrefix;
        this.context.lines[this.context.cursorY] = prefix + this.context.currentLine;
        this.context.cursorY++;
        this.context.cursorX = 0;
        this.context.currentLine = '';
        this.context.isMultiLineContinuation = true; // Subsequent lines are continuations

        if (!this.context.lines[this.context.cursorY]) {
          this.context.lines[this.context.cursorY] = '';
        }

        await this.sleep(delay);
        const captureStart = Date.now();
        this.captureFrame(true, true);
        this.context.captureOverhead += Date.now() - captureStart;
        continue;
      }

      const before = this.context.currentLine.substring(0, this.context.cursorX);
      const after = this.context.currentLine.substring(this.context.cursorX);
      this.context.currentLine = before + char + after;
      this.context.cursorX++;

      // Sleep first, then capture frame
      await this.sleep(delay);
      const captureStart = Date.now();
      this.captureFrame(true, true);
      // Track capture overhead to subtract from future timestamps
      this.context.captureOverhead += Date.now() - captureStart;
    }

    // Capture a frame with blinking cursor immediately after typing ends
    this.captureFrame(true, false);
  }

  private async executeEnter(): Promise<void> {
    // Build command from all lines if we're in a multi-line continuation
    let command: string;
    if (this.context.isMultiLineContinuation) {
      // Collect all continuation lines into one command
      // Find the start of the multi-line input (line with prompt)
      let startLine = this.context.cursorY;
      while (startLine > 0 && !this.context.lines[startLine - 1]?.includes(this.stripAnsi(this.context.promptPrefix).trim())) {
        startLine--;
      }
      // The line before startLine should have the prompt
      if (startLine > 0) startLine--;

      // Combine all lines from startLine to current
      const allLines: string[] = [];
      for (let i = startLine; i < this.context.cursorY; i++) {
        let line = this.context.lines[i] || '';
        // Strip prompt from first line
        if (i === startLine) {
          const promptLen = this.stripAnsi(this.context.promptPrefix).length;
          const stripped = this.stripAnsi(line);
          // Find where the actual content starts after the prompt
          line = stripped.substring(promptLen);
        }
        allLines.push(line);
      }
      allLines.push(this.context.currentLine);
      command = allLines.join('\n').trim();
    } else {
      command = this.context.currentLine.trim();
    }

    // Store the final line (with or without prompt)
    const prefix = this.context.isMultiLineContinuation ? '' : this.context.promptPrefix;
    this.context.lines[this.context.cursorY] = prefix + this.context.currentLine;
    this.context.cursorY++;
    this.context.cursorX = 0;
    this.context.currentLine = '';
    this.context.isMultiLineContinuation = false; // Reset for next command

    if (!this.context.lines[this.context.cursorY]) {
      this.context.lines[this.context.cursorY] = '';
    }

    if (command) {
      this.context.isExecutingCommand = true;
      await this.sleep(100);
      this.captureFrame(false);
      await this.executeShellCommand(command);
    } else {
      await this.sleep(100);
      this.captureFrame(true);
    }
  }

  private async executeShellCommand(command: string): Promise<void> {
    return new Promise((resolve) => {
      // Use configured shell (defaults to user's $SHELL or /bin/sh)
      const child = spawn(this.context.shell, ['-c', command], {
        env: { ...process.env, FORCE_COLOR: '1', CLICOLOR_FORCE: '1' },
      });

      let output = '';
      let prevLineCount = 0;
      const outputStartLine = this.context.cursorY;

      const processOutput = (data: string) => {
        output += data;

        // Parse output and update lines
        const outputLines = output.split('\n');
        for (let i = 0; i < outputLines.length; i++) {
          this.context.lines[outputStartLine + i] = outputLines[i];
        }

        this.context.cursorY = outputStartLine + outputLines.length - 1;

        while (this.context.lines.length <= this.context.cursorY) {
          this.context.lines.push('');
        }

        // Capture frame on each new line for smooth line-by-line animation
        const currentLineCount = outputLines.length;
        if (currentLineCount > prevLineCount) {
          this.captureFrame(false);
          prevLineCount = currentLineCount;
        }
      };

      child.stdout?.on('data', (data: Buffer) => {
        processOutput(data.toString());
      });

      child.stderr?.on('data', (data: Buffer) => {
        processOutput(data.toString());
      });

      child.on('close', () => {
        // Remove trailing newline to avoid extra blank line
        const trimmedOutput = output.endsWith('\n') ? output.slice(0, -1) : output;
        const outputLines = trimmedOutput.split('\n');

        // Store output lines (with ANSI codes) for rendering
        for (let i = 0; i < outputLines.length; i++) {
          this.context.lines[outputStartLine + i] = outputLines[i];
        }

        // Position cursor after output
        this.context.cursorY = outputStartLine + outputLines.length;
        this.context.cursorX = 0;

        while (this.context.lines.length <= this.context.cursorY) {
          this.context.lines.push('');
        }

        this.context.isExecutingCommand = false;
        this.context.currentLine = '';

        setTimeout(() => {
          this.captureFrame(true);
          resolve();
        }, 100);
      });

      child.on('error', (err) => {
        this.context.lines[this.context.cursorY] = `Command failed: ${err.message}`;
        this.context.cursorY++;
        this.context.lines[this.context.cursorY] = '';

        this.context.isExecutingCommand = false;
        this.context.currentLine = '';
        this.context.cursorX = 0;

        this.captureFrame(true);
        resolve();
      });
    });
  }

  private async executeArrow(direction: 'Left' | 'Right' | 'Up' | 'Down'): Promise<void> {
    switch (direction) {
      case 'Left':
        if (this.context.cursorX > 0) this.context.cursorX--;
        break;
      case 'Right':
        if (this.context.cursorX < this.context.currentLine.length) this.context.cursorX++;
        break;
      case 'Up':
        if (this.context.cursorY > 0) {
          this.context.cursorY--;
          this.context.currentLine = this.context.lines[this.context.cursorY] || '';
          this.context.cursorX = Math.min(this.context.cursorX, this.context.currentLine.length);
        }
        break;
      case 'Down':
        if (this.context.cursorY < this.context.lines.length - 1) {
          this.context.cursorY++;
          this.context.currentLine = this.context.lines[this.context.cursorY] || '';
          this.context.cursorX = Math.min(this.context.cursorX, this.context.currentLine.length);
        }
        break;
    }

    await this.sleep(50);
    this.captureFrame(true, true);
  }

  private async executeBackspace(count: number = 1): Promise<void> {
    const delay = this.context.typingSpeed;

    if (this.hasSelection()) {
      this.deleteSelection();
      await this.sleep(delay);
      this.captureFrame(true, true);
      return;
    }

    for (let i = 0; i < count; i++) {
      if (this.context.currentLine.length > 0 && this.context.cursorX > 0) {
        const before = this.context.currentLine.substring(0, this.context.cursorX - 1);
        const after = this.context.currentLine.substring(this.context.cursorX);
        this.context.currentLine = before + after;
        this.context.cursorX--;

        await this.sleep(delay);
        this.captureFrame(true, true);
      }
    }
  }

  private async executeShortcut(
    ctrl: boolean,
    alt: boolean,
    shift: boolean,
    cmd: boolean,
    key: string
  ): Promise<void> {
    const metaKey = cmd || ctrl;

    if (shift && !alt && !metaKey) {
      if (key === 'Left' || key === 'Right') {
        await this.executeSelectionMove(key === 'Right', shift);
      }
    } else if (alt && shift && !metaKey) {
      if (key === 'Left' || key === 'Right') {
        await this.executeWordSelection(key === 'Right');
      }
    } else if (alt && !shift && !metaKey) {
      if (key === 'Left' || key === 'Right') {
        await this.executeWordMove(key === 'Right');
      }
    } else if (metaKey && !alt && !shift) {
      if (key === 'Left' || key === 'Right') {
        await this.executeLineNavigation(key === 'Right');
      } else if (key === 'Backspace') {
        await this.executeWordDelete();
      }
    }
  }

  private async executeScreenshot(path?: string): Promise<void> {
    let screenshotPath: string;
    if (path) {
      screenshotPath = path;
    } else {
      const baseName = this.context.outputPath?.replace(/\.svg$/, '') || 'screenshot';
      screenshotPath = `${baseName}_screenshot_${this.context.screenshotCounter}.svg`;
      this.context.screenshotCounter++;
    }

    // Build current terminal content
    const buffer = [...this.context.lines];
    const displayLine = this.context.isExecutingCommand
      ? this.context.currentLine
      : this.context.promptPrefix + this.context.currentLine;
    buffer[this.context.cursorY] = displayLine;
    const content = buffer.filter((line) => line !== undefined).join('\n');

    // Convert our theme to shellfie theme format
    const shellfieTheme: ShellfieTheme = {
      name: this.context.theme.name,
      background: this.context.theme.background,
      foreground: this.context.theme.foreground,
      cursor: this.context.theme.cursor ?? this.context.theme.foreground,
      selection: this.context.theme.selection ?? '#44475a',
      black: this.context.theme.black,
      red: this.context.theme.red,
      green: this.context.theme.green,
      yellow: this.context.theme.yellow,
      blue: this.context.theme.blue,
      magenta: this.context.theme.magenta,
      cyan: this.context.theme.cyan,
      white: this.context.theme.white,
      brightBlack: this.context.theme.brightBlack,
      brightRed: this.context.theme.brightRed,
      brightGreen: this.context.theme.brightGreen,
      brightYellow: this.context.theme.brightYellow,
      brightBlue: this.context.theme.brightBlue,
      brightMagenta: this.context.theme.brightMagenta,
      brightCyan: this.context.theme.brightCyan,
      brightWhite: this.context.theme.brightWhite,
    };

    // Build shellfie options
    const options: shellfieOptions = {
      template: this.context.template as 'macos' | 'windows' | 'minimal',
      title: this.context.title,
      theme: shellfieTheme,
      fontSize: this.context.fontSize,
      width: this.context.width,
      height: this.context.height,
      watermark: this.context.watermark,
      embedFont: true,
    };

    if (this.context.headerBackground) {
      options.header = { backgroundColor: this.context.headerBackground };
    }

    // Generate static SVG using shellfie
    const svg = shellfie(content, options);
    writeFileSync(resolve(screenshotPath), svg, 'utf-8');
  }

  // ==========================================================================
  // Selection Helpers
  // ==========================================================================

  private hasSelection(): boolean {
    return (
      this.context.selectionStart !== undefined &&
      this.context.selectionEnd !== undefined &&
      this.context.selectionStart !== this.context.selectionEnd
    );
  }

  private clearSelection(): void {
    this.context.selectionStart = undefined;
    this.context.selectionEnd = undefined;
  }

  private deleteSelection(): boolean {
    if (!this.hasSelection()) return false;

    const start = Math.min(this.context.selectionStart!, this.context.selectionEnd!);
    const end = Math.max(this.context.selectionStart!, this.context.selectionEnd!);

    const before = this.context.currentLine.substring(0, start);
    const after = this.context.currentLine.substring(end);

    this.context.currentLine = before + after;
    this.context.cursorX = start;
    this.clearSelection();

    return true;
  }

  private async executeSelectionMove(right: boolean, shift: boolean): Promise<void> {
    const strippedLine = this.stripAnsi(this.context.currentLine);

    if (!shift || (this.context.selectionStart === undefined && this.context.selectionEnd === undefined)) {
      this.context.selectionStart = this.context.cursorX;
      this.context.selectionEnd = this.context.cursorX;
    }

    if (right) {
      if (this.context.cursorX < strippedLine.length) this.context.cursorX++;
    } else {
      if (this.context.cursorX > 0) this.context.cursorX--;
    }

    if (shift) {
      this.context.selectionEnd = this.context.cursorX;
    } else {
      this.clearSelection();
    }

    await this.sleep(50);
    this.captureFrame(true, true);
  }

  private async executeWordMove(right: boolean): Promise<void> {
    this.clearSelection();
    const newPosition = this.findWordBoundary(right ? 'right' : 'left', this.context.cursorX, this.context.currentLine);
    this.context.cursorX = newPosition;

    await this.sleep(50);
    this.captureFrame(true, true);
  }

  private async executeWordSelection(right: boolean): Promise<void> {
    if (this.context.selectionStart === undefined) {
      this.context.selectionStart = this.context.cursorX;
      this.context.selectionEnd = this.context.cursorX;
    }

    const newPosition = this.findWordBoundary(right ? 'right' : 'left', this.context.cursorX, this.context.currentLine);
    this.context.cursorX = newPosition;
    this.context.selectionEnd = newPosition;

    await this.sleep(50);
    this.captureFrame(true, true);
  }

  private async executeLineNavigation(toEnd: boolean): Promise<void> {
    this.clearSelection();
    this.context.cursorX = toEnd ? this.context.currentLine.length : 0;

    await this.sleep(50);
    this.captureFrame(true, true);
  }

  private async executeWordDelete(): Promise<void> {
    const wordStart = this.findWordBoundary('left', this.context.cursorX, this.context.currentLine);
    const deleteCount = this.context.cursorX - wordStart;

    if (deleteCount <= 0) return;

    const before = this.context.currentLine.substring(0, wordStart);
    const after = this.context.currentLine.substring(this.context.cursorX);
    this.context.currentLine = before + after;
    this.context.cursorX = wordStart;

    await this.sleep(50);
    this.captureFrame(true, true);
  }

  private findWordBoundary(direction: 'left' | 'right', position: number, text: string): number {
    const stripped = this.stripAnsi(text);

    if (direction === 'left') {
      if (position === 0) return 0;
      let pos = position - 1;

      while (pos > 0 && /\s/.test(stripped[pos])) pos--;

      if (/\w/.test(stripped[pos])) {
        while (pos > 0 && /\w/.test(stripped[pos - 1])) pos--;
      } else if (/\S/.test(stripped[pos])) {
        while (pos > 0 && /[^\w\s]/.test(stripped[pos - 1])) pos--;
      }

      return pos;
    } else {
      if (position >= stripped.length) return stripped.length;
      let pos = position;

      while (pos < stripped.length && /\s/.test(stripped[pos])) pos++;

      if (pos < stripped.length && /\w/.test(stripped[pos])) {
        while (pos < stripped.length && /\w/.test(stripped[pos])) pos++;
      } else if (pos < stripped.length && /\S/.test(stripped[pos])) {
        while (pos < stripped.length && /[^\w\s]/.test(stripped[pos])) pos++;
      }

      return pos;
    }
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // Command Router
  // ==========================================================================

  private async executeCommand(command: CDCommand): Promise<void> {
    switch (command.type) {
      case 'Type':
        await this.executeType(command.text, command.speed);
        break;

      case 'Key':
        if (['Left', 'Right', 'Up', 'Down'].includes(command.key)) {
          const count = command.count || 1;
          for (let i = 0; i < count; i++) {
            await this.executeArrow(command.key as 'Left' | 'Right' | 'Up' | 'Down');
          }
        } else if (command.key === 'Enter') {
          await this.executeEnter();
        } else if (command.key === 'Backspace') {
          await this.executeBackspace(command.count || 1);
        } else if (command.key === 'Space') {
          await this.executeType(' '.repeat(command.count || 1));
        } else if (command.key === 'Tab') {
          await this.executeType('    '.repeat(command.count || 1));
        }
        break;

      case 'Sleep':
        await this.sleep(command.duration);
        this.captureFrame(true);
        break;

      case 'Screenshot':
        await this.executeScreenshot(command.path);
        break;

      case 'Copy':
        this.context.clipboard = command.text;
        break;

      case 'Paste':
        if (this.context.clipboard) {
          await this.executeType(this.context.clipboard);
        }
        break;

      case 'Shortcut':
        await this.executeShortcut(command.ctrl, command.alt, command.shift, command.cmd, command.key);
        break;

      default:
        // Not implemented: Hide, Show, Output, Require, Set, Source, Env, Comment, Wait
        break;
    }
  }

  // ==========================================================================
  // Main Execution
  // ==========================================================================

  async execute(script: CDScript): Promise<TerminalFrame[]> {
    // Apply settings
    for (const [key, value] of script.settings.entries()) {
      this.applySetting(key, value);
    }

    this.context.outputPath = script.output;

    // Recalculate grid dimensions after settings applied
    this.updateGridDimensions();

    // Capture initial frame
    this.captureFrame(true);

    // Execute commands (filter out non-action commands including comments)
    const actionCommands = script.commands.filter(
      (cmd: CDCommand) => !['Output', 'Require', 'Set', 'Env', 'Comment'].includes(cmd.type)
    );

    for (let i = 0; i < actionCommands.length; i++) {
      const cmd = actionCommands[i];

      // Build detailed command description
      let cmdDescription: string = cmd.type;
      if (cmd.type === 'Type') {
        // Sanitize preview: replace newlines with ↵ symbol for display
        const sanitized = cmd.text.replace(/\n/g, '↵');
        const preview = sanitized.length > 30 ? sanitized.slice(0, 30) + '...' : sanitized;
        cmdDescription = `Type \x1b[2m"${preview}"\x1b[0m`;
      } else if (cmd.type === 'Key') {
        cmdDescription = cmd.key + (cmd.count && cmd.count > 1 ? ` \x1b[2m×${cmd.count}\x1b[0m` : '');
      } else if (cmd.type === 'Sleep') {
        cmdDescription = `Sleep \x1b[2m${cmd.duration}ms\x1b[0m`;
      } else if (cmd.type === 'Screenshot') {
        cmdDescription = `Screenshot \x1b[2m${cmd.path || 'auto'}\x1b[0m`;
      } else if (cmd.type === 'Shortcut') {
        const mods = [cmd.ctrl && 'Ctrl', cmd.alt && 'Alt', cmd.shift && 'Shift', cmd.cmd && 'Cmd'].filter(Boolean);
        cmdDescription = `${mods.join('+')}+${cmd.key}`;
      } else if (cmd.type === 'Copy') {
        const preview = cmd.text.length > 20 ? cmd.text.slice(0, 20) + '...' : cmd.text;
        cmdDescription = `Copy \x1b[2m"${preview}"\x1b[0m`;
      }

      this.options.onProgress?.(i + 1, actionCommands.length, cmdDescription);
      await this.executeCommand(cmd);
    }

    // Capture final frame with cursor visible (resting state)
    this.captureFrame(true);

    // Auto-calculate dimensions and re-render if needed
    if (this.context.autoWidth || this.context.autoHeight) {
      this.recalculateDimensionsAndRerender();
    }

    return this.context.frames;
  }

  private applySetting(key: string, value: string): void {
    switch (key) {
      case 'Width':
        this.context.width = parseInt(value, 10);
        this.context.autoWidth = false;
        break;
      case 'Height':
        this.context.height = parseInt(value, 10);
        this.context.autoHeight = false;
        break;
      case 'FontSize':
        this.context.fontSize = parseInt(value, 10);
        break;
      case 'LineHeight':
        this.context.lineHeight = parseFloat(value);
        this.context.hasCustomLineHeight = true;
        break;
      case 'TypingSpeed':
        this.context.typingSpeed = parseInt(value, 10);
        break;
      case 'Title':
        this.context.title = value;
        break;
      case 'Template':
        this.context.template = value as 'macos' | 'windows' | 'minimal';
        break;
      case 'Theme':
        this.resolveTheme(value);
        break;
      case 'PromptPrefix':
        this.context.promptPrefix = this.parseEscapes(value);
        break;
      case 'Watermark':
        this.context.watermark = this.parseEscapes(value);
        break;
      case 'CursorBlink':
        this.context.cursorBlink = value.toLowerCase() !== 'false';
        break;
      case 'Scroll':
        this.context.scroll = value.toLowerCase() === 'true';
        if (this.context.scroll) this.context.autoHeight = false;
        break;
      case 'HeaderBackground':
        this.context.headerBackground = value;
        break;
      case 'FooterBackground':
        this.context.footerBackground = value;
        break;
      case 'BorderColor':
        this.context.borderColor = value;
        break;
      case 'BorderWidth':
        this.context.borderWidth = parseInt(value, 10);
        break;
      case 'BorderRadius':
        this.context.borderRadius = parseInt(value, 10);
        break;
      case 'Padding':
        this.context.padding = parseInt(value, 10);
        break;
      // Header config (shellfie 2.0 style)
      case 'HeaderHeight':
        this.context.headerHeight = parseInt(value, 10);
        break;
      case 'HeaderBorder':
        this.context.headerBorder = value.toLowerCase() === 'true';
        break;
      case 'HeaderBorderColor':
        this.context.headerBorderColor = value;
        break;
      case 'HeaderBorderWidth':
        this.context.headerBorderWidth = parseInt(value, 10);
        break;
      // Footer config (shellfie 2.0 style)
      case 'FooterHeight':
        this.context.footerHeight = parseInt(value, 10);
        break;
      case 'FooterBorder':
        this.context.footerBorder = value.toLowerCase() === 'true';
        break;
      case 'FooterBorderColor':
        this.context.footerBorderColor = value;
        break;
      case 'FooterBorderWidth':
        this.context.footerBorderWidth = parseInt(value, 10);
        break;
      // Cursor config
      case 'CursorStyle':
        const style = value.toLowerCase();
        if (style === 'block' || style === 'bar' || style === 'underline') {
          this.context.cursorStyle = style;
        }
        break;
      case 'CursorColor':
        this.context.cursorColor = value;
        break;
      // Font config
      case 'FontFamily':
        this.context.fontFamily = value;
        break;
      case 'EmbedFont':
        // Read font file and base64 encode it
        this.embedFontFromPath(value);
        break;
      // Shell config
      case 'Shell':
        this.context.shell = value;
        break;
      // Character width ratio for font tuning
      case 'CharWidthRatio':
        this.context.charWidthRatio = parseFloat(value);
        break;
    }
  }

  private embedFontFromPath(fontPath: string): void {
    try {
      const fs = require('fs');
      const path = require('path');

      // Resolve path relative to current working directory
      const resolvedPath = path.resolve(fontPath);

      if (!fs.existsSync(resolvedPath)) {
        console.warn(`Font file not found: ${resolvedPath}`);
        return;
      }

      const fontBuffer = fs.readFileSync(resolvedPath);
      this.context.fontData = fontBuffer.toString('base64');
      this.context.embedFont = true;
    } catch (err) {
      console.warn(`Failed to embed font: ${err}`);
    }
  }

  private resolveTheme(themeName: string): void {
    // Try pipeline themes first
    const pipelineTheme = pipelineThemes[themeName as keyof typeof pipelineThemes];
    if (pipelineTheme) {
      this.context.theme = pipelineTheme;
      return;
    }

    // Try shellfie themes
    let name = themeName as keyof typeof shellfieThemes;
    if (!shellfieThemes[name]) {
      // Convert kebab-case to camelCase
      const camelCase = themeName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) as keyof typeof shellfieThemes;
      if (shellfieThemes[camelCase]) {
        name = camelCase;
      }
    }

    if (shellfieThemes[name]) {
      // Convert shellfie theme to our Theme type
      const st = shellfieThemes[name];
      this.context.theme = {
        name: themeName,
        background: st.background,
        foreground: st.foreground,
        cursor: st.cursor,
        selection: st.selection,
        black: st.black,
        red: st.red,
        green: st.green,
        yellow: st.yellow,
        blue: st.blue,
        magenta: st.magenta,
        cyan: st.cyan,
        white: st.white,
        brightBlack: st.brightBlack,
        brightRed: st.brightRed,
        brightGreen: st.brightGreen,
        brightYellow: st.brightYellow,
        brightBlue: st.brightBlue,
        brightMagenta: st.brightMagenta,
        brightCyan: st.brightCyan,
        brightWhite: st.brightWhite,
      };
    }
  }

  private parseEscapes(value: string): string {
    return value
      .replace(/\\e/g, '\x1b')
      .replace(/\\x1b/g, '\x1b')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
  }

  private updateGridDimensions(): void {
    const charWidth = this.context.fontSize * this.context.charWidthRatio;
    const lineHeight = this.context.fontSize * this.context.lineHeight;
    const padding = this.context.padding ?? 16;
    const headerHeight = this.context.template === 'minimal' ? 0 : 40;
    const termWidth = Math.floor((this.context.width - padding * 2) / charWidth);
    const termHeight = Math.floor((this.context.height - headerHeight - padding * 2) / lineHeight);

    this.context.grid = createGridState(termWidth, termHeight);
  }

  private recalculateDimensionsAndRerender(): void {
    const padding = this.context.padding ?? 16;
    const headerHeight = this.context.template === 'minimal' ? 0 : 40;
    const lineHeight = this.context.fontSize * this.context.lineHeight;
    const charWidth = this.context.fontSize * this.context.charWidthRatio;

    if (this.context.autoWidth) {
      // Add 1 extra character for cursor at end of line
      this.context.width = Math.ceil(padding + (this.context.maxLineLength + 1) * charWidth + padding);
      if (this.context.width < 200) this.context.width = 200;
    }

    if (this.context.autoHeight) {
      const watermarkHeight = this.context.watermark ? lineHeight : 0;
      // Use maxVisualRow (actual rendered rows after VTerminal processing) instead of maxLines
      // This correctly handles cursor positioning commands in programs like neofetch
      const rows = this.context.maxVisualRow > 0 ? this.context.maxVisualRow : this.context.maxLines;
      // Add buffer to ensure cursor isn't visually cropped at the bottom edge
      const cursorBuffer = 8;
      this.context.height = Math.ceil(headerHeight + padding + rows * lineHeight + watermarkHeight + padding + cursorBuffer);
      if (this.context.height < 100) this.context.height = 100;
    }

    // Re-render all frames with new dimensions
    this.updateGridDimensions();

    for (let i = 0; i < this.context.frameData.length; i++) {
      const frameData = this.context.frameData[i];
      const { svg } = emit(frameData.rows, frameData.cursor, frameData.cursorVisible, {
        theme: this.context.theme,
        template: this.context.template,
        width: this.context.width,
        height: this.context.height,
        fontSize: this.context.fontSize,
        title: this.context.title,
        watermark: this.context.watermark,
        headerBackground: this.context.headerBackground,
        footerBackground: this.context.footerBackground,
        borderColor: this.context.borderColor,
        borderWidth: this.context.borderWidth,
        borderRadius: this.context.borderRadius,
        padding: this.context.padding,
        cursorBlink: this.context.cursorBlink,
        lineHeight: this.context.fontSize * this.context.lineHeight,
        hasCustomLineHeight: this.context.hasCustomLineHeight,
        charWidth: this.context.fontSize * this.context.charWidthRatio,
        cursorStyle: this.context.cursorStyle,
        cursorColor: this.context.cursorColor,
        selection: frameData.selection,
        activeCursor: frameData.activeCursor,
      });

      this.context.frames[i].svg = svg;
      this.context.frames[i].state.width = this.context.width;
      this.context.frames[i].state.height = this.context.height;
    }
  }

  getFrames(): TerminalFrame[] {
    return this.context.frames;
  }

  async cleanup(): Promise<void> {
    // Nothing to clean up
  }
}
