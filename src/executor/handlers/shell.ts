//#region Imports

import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { ExecutorContext, CDExecutorOptions } from '../types';
import { sleep, stripAnsi } from '../types';
import { captureFrame } from '../frame-capture';


//#region Enter Handler

export const executeEnter = async (
  ctx: ExecutorContext,
  options: CDExecutorOptions
): Promise<void> => {
  const command = ctx.isMultiLineContinuation
    ? buildMultiLineCommand(ctx)
    : ctx.currentLine.trim();

  const prefix = ctx.isMultiLineContinuation ? '' : ctx.promptPrefix;
  ctx.lines[ctx.cursorY] = prefix + ctx.currentLine;
  ctx.cursorY++;
  ctx.cursorX = 0;
  ctx.currentLine = '';
  ctx.isMultiLineContinuation = false;
  ctx.selectionStart = undefined;
  ctx.selectionEnd = undefined;

  if (!ctx.lines[ctx.cursorY]) {
    ctx.lines[ctx.cursorY] = '';
  }

  if (command) {
    // Handle 'clear' command specially - reset terminal state like a real terminal
    if (command === 'clear') {
      await executeClearCommand(ctx, options);
      return;
    }

    ctx.isExecutingCommand = true;
    await sleep(100);
    const captureStart = Date.now();
    captureFrame(ctx, options, false, false);
    ctx.captureOverhead += Date.now() - captureStart;
    await executeShellCommand(ctx, options, command);
  } else {
    await sleep(100);
    captureFrame(ctx, options, true, false);
  }
};


//#region Clear Command Handler

const executeClearCommand = async (
  ctx: ExecutorContext,
  options: CDExecutorOptions
): Promise<void> => {
  // Clear all lines and reset cursor to first row (like real terminal)
  ctx.lines = [''];
  ctx.cursorY = 0;
  ctx.cursorX = 0;
  ctx.currentLine = '';
  ctx.scrollOffset = 0;
  ctx.isExecutingCommand = false;

  await sleep(100);
  captureFrame(ctx, options, true, false);
};


//#region Multi-Line Command Builder

const buildMultiLineCommand = (ctx: ExecutorContext): string => {
  let startLine = ctx.cursorY;

  while (
    startLine > 0 &&
    !ctx.lines[startLine - 1]?.includes(stripAnsi(ctx.promptPrefix).trim())
  ) {
    startLine--;
  }

  if (startLine > 0) startLine--;

  const allLines: string[] = [];
  for (let i = startLine; i < ctx.cursorY; i++) {
    let line = ctx.lines[i] || '';
    if (i === startLine) {
      const promptLen = stripAnsi(ctx.promptPrefix).length;
      const stripped = stripAnsi(line);
      line = stripped.substring(promptLen);
    }
    allLines.push(line);
  }
  allLines.push(ctx.currentLine);

  return allLines.join('\n').trim();
};


//#region Shell Command Execution

export const executeShellCommand = async (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  command: string
): Promise<void> => {
  return new Promise((resolve) => {
    const child = spawn(ctx.shell, ['-c', command], {
      env: { ...process.env, FORCE_COLOR: '1', CLICOLOR_FORCE: '1' },
      cwd: ctx.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin?.end();

    const outputStartLine = ctx.cursorY;
    const animationState = createAnimationState(ctx, outputStartLine);

    const processOutput = createOutputProcessor(ctx, options, animationState);

    // Use StringDecoder to handle multi-byte UTF-8 characters (like emojis)
    // that may be split across Buffer chunks
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    child.stdout?.on('data', (data: Buffer) => processOutput(stdoutDecoder.write(data)));
    child.stderr?.on('data', (data: Buffer) => processOutput(stderrDecoder.write(data)));

    child.on('close', async () => {
      await finalizeOutput(ctx, options, animationState, resolve);
    });

    child.on('error', (err) => {
      handleCommandError(ctx, options, err, resolve);
    });
  });
};


//#region Animation State

interface AnimationState {
  output: string;
  prevLineCount: number;
  outputStartLine: number;
  isAnimatedOutput: boolean;
  animationType: 'none' | 'cursor-restore' | 'terminal-reset';
  animationBuffer: string;
  finalizedLines: string[];
  currentAnimatingLine: string;
  animationFrameCount: number;
  frameArrivalTimes: number[];
  animationStartTime: number;
  deferredFrames: string[];
}

const createAnimationState = (
  ctx: ExecutorContext,
  outputStartLine: number
): AnimationState => ({
  output: '',
  prevLineCount: 0,
  outputStartLine,
  isAnimatedOutput: false,
  animationType: 'none',
  animationBuffer: '',
  finalizedLines: [],
  currentAnimatingLine: '',
  animationFrameCount: 0,
  frameArrivalTimes: [],
  animationStartTime: Date.now() - ctx.startTime - ctx.captureOverhead,
  deferredFrames: [],
});


//#region Output Processor

const createOutputProcessor = (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  state: AnimationState
) => {
  return (dataStr: string): void => {
    if (!state.isAnimatedOutput) {
      if (dataStr.includes('\x1bc')) {
        state.isAnimatedOutput = true;
        state.animationType = 'terminal-reset';
      } else if (dataStr.includes('\x1b8') || dataStr.includes('\x1b[?25l')) {
        state.isAnimatedOutput = true;
        state.animationType = 'cursor-restore';
      }
    }

    if (state.isAnimatedOutput) {
      if (state.animationType === 'terminal-reset') {
        processTerminalResetAnimation(state, dataStr);
      } else {
        processCursorRestoreAnimation(ctx, options, state, dataStr);
      }
    } else {
      processLineByLineOutput(ctx, options, state, dataStr);
    }
  };
};


//#region Line-by-Line Output

const processLineByLineOutput = (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  state: AnimationState,
  data: string
): void => {
  state.output += data;

  const outputLines = state.output.split('\n');
  for (let i = 0; i < outputLines.length; i++) {
    ctx.lines[state.outputStartLine + i] = outputLines[i];
  }

  ctx.cursorY = state.outputStartLine + outputLines.length - 1;

  while (ctx.lines.length <= ctx.cursorY) {
    ctx.lines.push('');
  }

  const currentLineCount = outputLines.length;
  if (currentLineCount > state.prevLineCount) {
    captureFrame(ctx, options, false, false);
    state.prevLineCount = currentLineCount;
  }
};


//#region Terminal Reset Animation

const processTerminalResetAnimation = (
  state: AnimationState,
  dataStr: string
): void => {
  state.animationBuffer += dataStr;

  if (state.animationBuffer.includes('\x1bc')) {
    const parts = state.animationBuffer.split('\x1bc');
    state.animationBuffer = parts.pop() || '';

    const now = Date.now();
    for (const frame of parts) {
      if (frame.trim()) {
        state.deferredFrames.push(frame);
        state.frameArrivalTimes.push(now);
      }
    }
  }
};


//#region Cursor Restore Animation

const processCursorRestoreAnimation = (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  state: AnimationState,
  dataStr: string
): void => {
  state.animationBuffer += dataStr;

  const segments = state.animationBuffer.split('\x1b8');

  for (let i = 0; i < segments.length - 1; i++) {
    processAnimationFrame(ctx, options, state, segments[i]);
  }

  state.animationBuffer = segments[segments.length - 1];
};

const processAnimationFrame = (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  state: AnimationState,
  frameContent: string
): void => {
  if (!frameContent || !frameContent.match(/[a-zA-Z0-9]/)) return;

  const hasNewline = frameContent.includes('\n');

  if (hasNewline) {
    const parts = frameContent.split('\n');
    state.currentAnimatingLine = parts[0];
    state.finalizedLines.push(state.currentAnimatingLine);

    for (let j = 1; j < parts.length - 1; j++) {
      // Preserve empty lines to maintain correct row positioning
      state.finalizedLines.push(parts[j]);
    }

    state.currentAnimatingLine = parts[parts.length - 1];
  } else {
    state.currentAnimatingLine = frameContent;
  }

  for (let j = 0; j < state.finalizedLines.length; j++) {
    ctx.lines[state.outputStartLine + j] = state.finalizedLines[j];
  }

  const currentLineIndex = state.outputStartLine + state.finalizedLines.length;
  if (state.currentAnimatingLine) {
    ctx.lines[currentLineIndex] = state.currentAnimatingLine;
  }

  const totalLines = state.finalizedLines.length + (state.currentAnimatingLine ? 1 : 0);
  while (ctx.lines.length <= state.outputStartLine + totalLines) {
    ctx.lines.push('');
  }

  ctx.cursorY = state.outputStartLine + totalLines;
  ctx.cursorX = 0;

  const syntheticTimestamp =
    state.animationStartTime + state.animationFrameCount * ctx.animationSpeed;

  const originalStartTime = ctx.startTime;
  const originalOverhead = ctx.captureOverhead;
  ctx.startTime = Date.now() - syntheticTimestamp;
  ctx.captureOverhead = 0;

  captureFrame(ctx, options, false, false);

  ctx.startTime = originalStartTime;
  ctx.captureOverhead = originalOverhead;

  state.animationFrameCount++;
};


//#region Output Finalization

const finalizeOutput = async (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  state: AnimationState,
  resolve: () => void
): Promise<void> => {
  if (state.isAnimatedOutput) {
    if (state.animationType === 'terminal-reset') {
      finalizeTerminalResetAnimation(ctx, options, state);
    } else {
      finalizeCursorRestoreAnimation(ctx, options, state);
    }

    const totalLines =
      state.finalizedLines.length + (state.currentAnimatingLine ? 1 : 0);
    ctx.cursorY = state.outputStartLine + totalLines;
    ctx.cursorX = 0;

    while (ctx.lines.length <= ctx.cursorY) {
      ctx.lines.push('');
    }
  } else {
    finalizeLineByLineOutput(ctx, state);
  }

  ctx.isExecutingCommand = false;
  ctx.currentLine = '';

  setTimeout(() => {
    const captureStart = Date.now();
    captureFrame(ctx, options, true, false);
    ctx.captureOverhead += Date.now() - captureStart;
    resolve();
  }, 100);
};

const finalizeTerminalResetAnimation = (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  state: AnimationState
): void => {
  if (state.animationBuffer && state.animationBuffer.trim()) {
    state.deferredFrames.push(state.animationBuffer);
    state.frameArrivalTimes.push(Date.now());
  }

  let detectedSpeed = ctx.animationSpeed;
  if (state.frameArrivalTimes.length >= 2) {
    const firstTime = state.frameArrivalTimes[0];
    const lastTime = state.frameArrivalTimes[state.frameArrivalTimes.length - 1];
    const totalRealDuration = lastTime - firstTime;
    const frameCount = state.deferredFrames.length;

    if (totalRealDuration > 0 && frameCount > 1) {
      detectedSpeed = Math.max(10, Math.round(totalRealDuration / (frameCount - 1)));
    }
  }

  for (let i = 0; i < state.deferredFrames.length; i++) {
    const frame = state.deferredFrames[i];
    state.finalizedLines = [];

    const lines = frame.split('\n');
    for (const line of lines) {
      // Preserve empty lines to maintain correct row positioning
      state.finalizedLines.push(line);
    }

    for (let j = 0; j < state.finalizedLines.length; j++) {
      ctx.lines[state.outputStartLine + j] = state.finalizedLines[j];
    }

    const totalLines = state.finalizedLines.length;
    for (let j = totalLines; j < ctx.lines.length - state.outputStartLine; j++) {
      ctx.lines[state.outputStartLine + j] = '';
    }

    ctx.cursorY = state.outputStartLine + totalLines;
    ctx.cursorX = 0;

    const syntheticTimestamp = state.animationStartTime + i * detectedSpeed;
    const originalStartTime = ctx.startTime;
    const originalOverhead = ctx.captureOverhead;
    ctx.startTime = Date.now() - syntheticTimestamp;
    ctx.captureOverhead = 0;

    captureFrame(ctx, options, false, false);

    ctx.startTime = originalStartTime;
    ctx.captureOverhead = originalOverhead;
  }

  const lastAnimationTimestamp =
    state.animationStartTime + (state.deferredFrames.length - 1) * detectedSpeed;
  ctx.captureOverhead =
    Date.now() - ctx.startTime - lastAnimationTimestamp - 100;

  state.animationFrameCount = state.deferredFrames.length;
};

const finalizeCursorRestoreAnimation = (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  state: AnimationState
): void => {
  if (state.animationBuffer && state.animationBuffer.trim()) {
    processAnimationFrame(ctx, options, state, state.animationBuffer);
  }
};

const finalizeLineByLineOutput = (
  ctx: ExecutorContext,
  state: AnimationState
): void => {
  const trimmedOutput = state.output.endsWith('\n')
    ? state.output.slice(0, -1)
    : state.output;
  const outputLines = trimmedOutput.split('\n');

  for (let i = 0; i < outputLines.length; i++) {
    ctx.lines[state.outputStartLine + i] = outputLines[i];
  }

  ctx.cursorY = state.outputStartLine + outputLines.length;
  ctx.cursorX = 0;

  while (ctx.lines.length <= ctx.cursorY) {
    ctx.lines.push('');
  }
};


//#region Error Handler

const handleCommandError = (
  ctx: ExecutorContext,
  options: CDExecutorOptions,
  err: Error,
  resolve: () => void
): void => {
  ctx.lines[ctx.cursorY] = `Command failed: ${err.message}`;
  ctx.cursorY++;
  ctx.lines[ctx.cursorY] = '';

  ctx.isExecutingCommand = false;
  ctx.currentLine = '';
  ctx.cursorX = 0;

  captureFrame(ctx, options, true, false);
  resolve();
};

