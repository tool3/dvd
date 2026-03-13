//#region Imports

import type { CDCommand, CDScript } from '../parser/cd-parser';
import { createGridState } from '../pipeline/vterminal';
import { emit } from '../pipeline/svg-emitter';
import { themes as pipelineThemes } from '../pipeline';
import type { ExecutorContext, TerminalFrame, CDExecutorOptions } from './types';
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
import { applySetting } from './settings';


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
    for (const [key, value] of script.settings.entries()) {
      applySetting(this.context, key, value);
    }

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
    }

    captureFrame(this.context, this.options, true, false);

    if (this.context.autoWidth || this.context.autoHeight) {
      this.recalculateDimensionsAndRerender();
    }

    return this.context.frames;
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

    if (this.context.autoWidth) {
      this.context.width = Math.ceil(
        padding + (this.context.maxLineLength + 1) * charWidth + padding
      );
      if (this.context.width < 200) this.context.width = 200;
    }

    if (this.context.autoHeight) {
      const watermarkHeight = this.context.watermark ? lineHeight : 0;
      const rows =
        this.context.maxVisualRow > 0 ? this.context.maxVisualRow : this.context.maxLines;
      const cursorBuffer = 8;
      this.context.height = Math.ceil(
        headerHeight + padding + rows * lineHeight + watermarkHeight + padding + cursorBuffer
      );
      if (this.context.height < 100) this.context.height = 100;
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
      });

      this.context.frames[i].svg = svg;
      this.context.frames[i].state.width = this.context.width;
      this.context.frames[i].state.height = this.context.height;
    }
  }


  //#region Public Methods

  getFrames(): TerminalFrame[] {
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

    width,
    height,
    fontSize,
    typingSpeed: 50,
    title: options.title,
    template: options.template || 'minimal',
    theme: options.theme || pipelineThemes.dark,
    promptPrefix: '\x1b[95m❯\x1b[0m ',
    cursorBlink: true,

    clipboard: '',
    screenshotCounter: 0,
    autoWidth: !options.width,
    autoHeight: !options.height,
    maxLineLength: 0,
    maxLines: 0,
    maxVisualRow: 0,
    scroll: !!options.height,
    scrollOffset: 0,
    isExecutingCommand: false,
    isMultiLineContinuation: false,

    lineHeight: 1.4,
    hasCustomLineHeight: false,

    charWidthRatio: 0.6,

    shell: process.env.SHELL || '/bin/sh',

    animationSpeed: 50,

    loopStyle: 'loop',
    loopPause: 0,
    fadeDuration: 1500,
    rewindSpeed: 5,
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

