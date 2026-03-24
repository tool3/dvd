//#region Imports

import type { CDCommand, CDScript } from '../parser/cd-parser';
import { createGridState } from '../pipeline/vterminal';
import { emit, type FrameData } from '../pipeline/svg-emitter';
import { themes as pipelineThemes } from '../pipeline';
import type { ExecutorContext, TerminalFrame, CDExecutorOptions } from './types';
export type { ExecutorContext };
import { sleep } from './types';
import { captureFrame } from './frame-capture';
import {
  executeType,
  executeBackspace,
  executeEnter,
  executeArrow,
  executeShortcut,
  executeScreenshot,
} from './handlers';
import { applySetting, resolveTheme } from './settings';


//#region Re-exports for backward compatibility

export type { TerminalFrame, TerminalState, CDExecutorOptions } from './types';


//#region CDExecutor Class

export class CDExecutor {
  private context: ExecutorContext;
  private options: CDExecutorOptions;

  constructor(options: CDExecutorOptions = {}) {
    this.options = options;
    this.context = createContext(options);
  }

  //#region Main Execution

  async execute(script: CDScript): Promise<TerminalFrame[]> {
    // Apply script settings first
    for (const [key, value] of script.settings.entries()) {
      applySetting(this.context, key, value);
    }

    // Apply CLI overrides (CLI args take precedence over .cd file settings)
    this.applyCliOverrides();

    this.context.outputPath = script.output;
    this.updateGridDimensions();
    captureFrame(this.context, this.options, true, false);

    const actionCommands = script.commands.filter(
      (cmd: CDCommand) => !['Output', 'Require', 'Set', 'Env', 'Comment'].includes(cmd.type)
    );

    for (let i = 0; i < actionCommands.length; i++) {
      const cmd = actionCommands[i];
      const cmdDescription = formatCommandDescription(cmd);
      this.options.onProgress?.(i + 1, actionCommands.length, cmdDescription);
      await this.executeCommand(cmd);
      // Yield to event loop between commands to allow spinner animation
      await new Promise(resolve => setImmediate(resolve));
    }

    captureFrame(this.context, this.options, true, false);

    if (this.context.autoWidth || this.context.autoHeight) {
      this.recalculateDimensionsAndRerender();
    }

    return this.getFrames();
  }


  //#region Command Router

  private async executeCommand(command: CDCommand): Promise<void> {
    switch (command.type) {
      case 'Type':
        await executeType(this.context, this.options, command.text, command.speed);
        break;

      case 'Key':
        await this.handleKeyCommand(command);
        break;

      case 'Sleep':
        // Capture frame at start of sleep with inactive cursor (allows blinking)
        captureFrame(this.context, this.options, true, false);
        await sleep(command.duration);
        captureFrame(this.context, this.options, true, false);
        break;

      case 'Screenshot':
        await executeScreenshot(this.context, command.path);
        break;

      case 'Copy':
        this.context.clipboard = command.text;
        break;

      case 'Paste':
        if (this.context.clipboard) {
          await executeType(this.context, this.options, this.context.clipboard);
        }
        break;

      case 'Shortcut': {
        const count = command.count || 1;
        for (let i = 0; i < count; i++) {
          await executeShortcut(
            this.context,
            this.options,
            command.ctrl,
            command.alt,
            command.shift,
            command.cmd,
            command.key
          );
        }
        break;
      }
    }
  }

  private async handleKeyCommand(command: CDCommand & { type: 'Key' }): Promise<void> {
    if (['Left', 'Right', 'Up', 'Down'].includes(command.key)) {
      const count = command.count || 1;
      for (let i = 0; i < count; i++) {
        await executeArrow(
          this.context,
          this.options,
          command.key as 'Left' | 'Right' | 'Up' | 'Down'
        );
      }
    } else if (command.key === 'Enter') {
      await executeEnter(this.context, this.options);
    } else if (command.key === 'Backspace') {
      await executeBackspace(this.context, this.options, command.count || 1);
    } else if (command.key === 'Space') {
      await executeType(this.context, this.options, ' '.repeat(command.count || 1));
    } else if (command.key === 'Tab') {
      await executeType(this.context, this.options, '    '.repeat(command.count || 1));
    }
  }


  //#region CLI Override Application

  /**
   * Apply CLI options that should override .cd file settings.
   * Called after script settings are applied, so CLI takes precedence.
   */
  private applyCliOverrides(): void {
    const opts = this.options;

    // Dimension overrides
    if (opts.width !== undefined) {
      this.context.width = opts.width;
      this.context.autoWidth = false;
    }
    if (opts.height !== undefined) {
      this.context.height = opts.height;
      this.context.autoHeight = false;
    }
    if (opts.fontSize !== undefined) this.context.fontSize = opts.fontSize;
    if (opts.lineHeight !== undefined) {
      this.context.lineHeight = Math.max(1, opts.lineHeight);
      this.context.hasCustomLineHeight = true;
    }

    // Appearance overrides
    if (opts.title !== undefined) this.context.title = opts.title;
    if (opts.template !== undefined) this.context.template = opts.template;
    if (opts.theme !== undefined) {
      if (typeof opts.theme === 'string') {
        resolveTheme(this.context, opts.theme);
      } else {
        this.context.theme = opts.theme;
      }
    }

    // Border and padding overrides
    if (opts.padding !== undefined) this.context.padding = opts.padding;
    if (opts.borderRadius !== undefined) this.context.borderRadius = opts.borderRadius;
    if (opts.borderColor !== undefined) this.context.borderColor = opts.borderColor;
    if (opts.borderWidth !== undefined) this.context.borderWidth = opts.borderWidth;

    // Font overrides
    if (opts.fontFamily !== undefined) this.context.fontFamily = opts.fontFamily;
    if (opts.letterSpacing !== undefined) this.context.letterSpacing = opts.letterSpacing;

    // Cursor overrides
    if (opts.cursorStyle !== undefined) {
      const style = opts.cursorStyle.toLowerCase();
      if (style === 'block' || style === 'bar' || style === 'underline') {
        this.context.cursorStyle = style;
      }
    }
    if (opts.cursorColor !== undefined) this.context.cursorColor = opts.cursorColor;
    if (opts.cursorBlink !== undefined) this.context.cursorBlink = opts.cursorBlink;

    // Header overrides
    if (opts.headerBackground !== undefined) this.context.headerBackground = opts.headerBackground;
    if (opts.headerHeight !== undefined) this.context.headerHeight = opts.headerHeight;
    if (opts.headerBorder !== undefined) this.context.headerBorder = opts.headerBorder;
    if (opts.headerBorderColor !== undefined) this.context.headerBorderColor = opts.headerBorderColor;
    if (opts.headerBorderWidth !== undefined) this.context.headerBorderWidth = opts.headerBorderWidth;

    // Footer overrides
    if (opts.footerBackground !== undefined) this.context.footerBackground = opts.footerBackground;
    if (opts.footerHeight !== undefined) this.context.footerHeight = opts.footerHeight;
    if (opts.footerBorder !== undefined) this.context.footerBorder = opts.footerBorder;
    if (opts.footerBorderColor !== undefined) this.context.footerBorderColor = opts.footerBorderColor;
    if (opts.footerBorderWidth !== undefined) this.context.footerBorderWidth = opts.footerBorderWidth;

    // Background overrides
    if (opts.background !== undefined) this.context.background = opts.background;
    if (opts.backgroundPadding !== undefined) this.context.backgroundPadding = opts.backgroundPadding;
    if (opts.backgroundRadius !== undefined) this.context.backgroundRadius = opts.backgroundRadius;

    // Watermark override
    if (opts.watermark !== undefined) this.context.watermark = opts.watermark;

    // Playback speed override
    if (opts.playbackSpeed !== undefined) this.context.playbackSpeed = opts.playbackSpeed;
  }


  //#region Dimension Management

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
    // Account for letter-spacing in width calculation
    const effectiveCharWidth = charWidth + this.context.letterSpacing;

    if (this.context.autoWidth) {
      this.context.width = Math.ceil(
        padding + (this.context.maxLineLength + 1) * effectiveCharWidth + padding
      );
      if (this.context.width < 200) this.context.width = 200;
    }

    if (this.context.autoHeight) {
      const watermarkHeight = this.context.watermark ? lineHeight : 0;
      const rows =
        this.context.maxVisualRow > 0 ? this.context.maxVisualRow : this.context.maxLines;
      // Calculate cursor buffer to ensure full cursor is visible when on last row
      // The cursor can extend beyond the row by (effectiveCursorHeight - lineHeight) / 2
      const minCursorPadding = this.context.fontSize * 0.1;
      const effectiveCursorHeight = Math.max(lineHeight, this.context.fontSize + 2 * minCursorPadding);
      const cursorExtension = Math.max(0, (effectiveCursorHeight - lineHeight) / 2);
      const cursorBuffer = Math.ceil(cursorExtension + 4); // +4px for visual breathing room
      this.context.height = Math.ceil(
        headerHeight + padding + rows * lineHeight + watermarkHeight + padding + cursorBuffer
      );
    }

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
        embedFont: this.context.embedFont,
        fontData: this.context.fontData,
        fontFamily: this.context.fontFamily,
        letterSpacing: this.context.letterSpacing,
        background: this.context.background,
        backgroundPadding: this.context.backgroundPadding,
        backgroundRadius: this.context.backgroundRadius,
      });

      this.context.frames[i].svg = svg;
      this.context.frames[i].state.width = this.context.width;
      this.context.frames[i].state.height = this.context.height;
    }
  }


  //#region Public Methods

  getFrames(): TerminalFrame[] {
    // Apply playback speed to timestamps
    const speed = this.context.playbackSpeed;
    if (speed !== 1 && speed > 0) {
      return this.context.frames.map(frame => ({
        ...frame,
        timestamp: Math.round(frame.timestamp / speed),
      }));
    }
    return this.context.frames;
  }

  getLoopStyle(): 'loop' | 'reverse' | 'rewind' | 'fade' {
    return this.context.loopStyle;
  }

  getLoopPause(): number {
    return this.context.loopPause;
  }

  getFadeDuration(): number {
    return this.context.fadeDuration;
  }

  getRewindSpeed(): number {
    return this.context.rewindSpeed;
  }

  getFrameData(): FrameData[] {
    // Apply playback speed to timestamps
    const speed = this.context.playbackSpeed;
    if (speed !== 1 && speed > 0) {
      return this.context.frameData.map(frame => ({
        ...frame,
        timestamp: Math.round(frame.timestamp / speed),
      }));
    }
    return this.context.frameData;
  }

  getContext(): ExecutorContext {
    return this.context;
  }

  async cleanup(): Promise<void> {
    // Nothing to clean up
  }

}


//#region Context Factory

const createContext = (options: CDExecutorOptions): ExecutorContext => {
  const width = options.width || 800;
  const height = options.height || 600;
  const fontSize = options.fontSize || 14;

  const charWidth = fontSize * 0.6;
  const lineHeight = fontSize * 1.4;
  const padding = 16;
  const headerHeight = options.template === 'minimal' ? 0 : 40;
  const termWidth = Math.floor((width - padding * 2) / charWidth);
  const termHeight = Math.floor((height - headerHeight - padding * 2) / lineHeight);

  return {
    grid: createGridState(termWidth, termHeight),

    lines: [''],
    currentLine: '',
    cursorX: 0,
    cursorY: 0,

    frames: [],
    frameData: [],
    startTime: Date.now(),
    captureOverhead: 0,
    lastFrameTimestamp: 0,

    width,
    height,
    fontSize,
    typingSpeed: 50,
    title: options.title,
    template: options.template || 'minimal',
    // Theme will be resolved in applyCliOverrides if passed as string
    theme: typeof options.theme === 'object' ? options.theme : pipelineThemes.dark,
    promptPrefix: '\x1b[95m❯ \x1b[0m',
    cursorBlink: true,

    clipboard: '',
    screenshotCounter: 0,
    autoWidth: !options.width,
    autoHeight: !options.height,
    maxLineLength: 0,
    maxLines: 0,
    maxVisualRow: 0,
    scroll: !!options.height, // Enable scroll only when height is fixed (not auto)
    scrollOffset: 0,
    isExecutingCommand: false,
    isMultiLineContinuation: false,

    lineHeight: 1.4,
    hasCustomLineHeight: false,

    charWidthRatio: 0.6,
    letterSpacing: 0,

    shell: process.env.SHELL || '/bin/sh',

    animationSpeed: 50,

    loopStyle: 'loop',
    loopPause: 0,
    fadeDuration: 1500,
    rewindSpeed: 5,

    backgroundPadding: 0,
    backgroundRadius: 12,

    playbackSpeed: options.playbackSpeed ?? 1,
  };
};


//#region Command Description Formatter

const formatCommandDescription = (cmd: CDCommand): string => {
  switch (cmd.type) {
    case 'Type': {
      const sanitized = cmd.text.replace(/\n/g, '↵');
      const preview = sanitized.length > 30 ? sanitized.slice(0, 30) + '...' : sanitized;
      return `Type \x1b[2m"${preview}"\x1b[0m`;
    }
    case 'Key':
      return cmd.key + (cmd.count && cmd.count > 1 ? ` \x1b[2m×${cmd.count}\x1b[0m` : '');
    case 'Sleep':
      return `Sleep \x1b[2m${cmd.duration}ms\x1b[0m`;
    case 'Screenshot':
      return `Screenshot \x1b[2m${cmd.path || 'auto'}\x1b[0m`;
    case 'Shortcut': {
      const mods = [
        cmd.ctrl && 'Ctrl',
        cmd.alt && 'Alt',
        cmd.shift && 'Shift',
        cmd.cmd && 'Cmd',
      ].filter(Boolean);
      return `${mods.join('+')}+${cmd.key}` + (cmd.count && cmd.count > 1 ? ` \x1b[2m×${cmd.count}\x1b[0m` : '');
    }
    case 'Copy': {
      const preview = cmd.text.length > 20 ? cmd.text.slice(0, 20) + '...' : cmd.text;
      return `Copy \x1b[2m"${preview}"\x1b[0m`;
    }
    default:
      return cmd.type;
  }
};

