//#region Imports

import { writeFileSync } from 'node:fs';
import { createAnimatedSVG, getAnimationMetadata } from '../animator/svg-animator';
import { optimizeSvg } from '../animator/svg-optimizer';
import { createSpinner } from '../utils/spinner';
import { createGridState, processInput } from '../pipeline/vterminal';
import { coalesce } from '../pipeline/coalescer';
import { emit } from '../pipeline/svg-emitter';
import { themes } from '../pipeline';
import { parseGradient } from '../executor/gradient-parser';
import type { TerminalFrame } from '../executor/cd-executor';
import type { AnimationOptions } from '../animator/svg-animator';
import type { Gradient } from '../types';


//#region Types

interface PipeArgs {
  output?: string;
  verbose?: boolean;
  loop?: boolean;
  'pause-at-end'?: number;
  'loop-pause'?: number;
  'fade-duration'?: number;
  'rewind-speed'?: number;
  'loop-style'?: 'loop' | 'reverse' | 'rewind' | 'fade';
  title?: string;
  theme?: string;
  width?: number;
  height?: number;
  fontSize?: number;
  lineHeight?: number;
  template?: string;
  padding?: number;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  fontFamily?: string;
  watermark?: string;
  cursorStyle?: string;
  cursorColor?: string;
  cursorBlink?: boolean;
  headerBackground?: string;
  headerHeight?: number;
  headerBorder?: boolean;
  headerBorderColor?: string;
  headerBorderWidth?: number;
  footerBackground?: string;
  footerHeight?: number;
  footerBorder?: boolean;
  footerBorderColor?: string;
  footerBorderWidth?: number;
  letterSpacing?: number;
  background?: string;
  backgroundPadding?: number;
  playbackSpeed?: number;
}

interface StdinResult {
  data: string;
  totalDuration: number;
}

interface RenderFrameOptions {
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  padding: number;
  borderRadius: number;
  theme: typeof themes.dark;
  title?: string;
  template: 'macos' | 'windows' | 'minimal';
  borderColor?: string;
  borderWidth?: number;
  fontFamily?: string;
  watermark?: string;
  cursorStyle?: 'block' | 'bar' | 'underline';
  cursorColor?: string;
  cursorBlink?: boolean;
  headerBackground?: string;
  headerHeight?: number;
  headerBorder?: boolean;
  headerBorderColor?: string;
  headerBorderWidth?: number;
  footerBackground?: string;
  footerHeight?: number;
  footerBorder?: boolean;
  footerBorderColor?: string;
  footerBorderWidth?: number;
  letterSpacing?: number;
  background?: string | Gradient;
  backgroundPadding?: number;
}


//#region Stdin Reader

const readStdin = async (): Promise<StdinResult> => {
  return new Promise((resolve, reject) => {
    let data = '';
    const startTime = Date.now();

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });

    const timeoutId = setTimeout(() => {
      if (data.length === 0) {
        reject(new Error('No input received from stdin (timeout after 30s)'));
      }
    }, 30000);

    process.stdin.on('end', () => {
      clearTimeout(timeoutId);
      const totalDuration = Date.now() - startTime;
      resolve({ data, totalDuration });
    });

    process.stdin.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
};


//#region Animation Detection

const detectAnimationType = (content: string): 'terminal-reset' | 'cursor-up' | 'cursor-restore' | 'clear-line' | 'none' => {
  if (content.includes('\x1bc')) {
    return 'terminal-reset';
  }
  if (/\x1b\[\d+A/.test(content)) {
    return 'cursor-up';
  }
  if (content.includes('\x1b8') || content.includes('\x1b[?25l')) {
    return 'cursor-restore';
  }
  // Clear line + cursor to column 0 (used by spinners)
  if (content.includes('\x1b[2K\x1b[0G') || content.includes('\x1b[2K')) {
    return 'clear-line';
  }
  return 'none';
};

const splitIntoFrames = (content: string, animationType: 'terminal-reset' | 'cursor-up' | 'cursor-restore' | 'clear-line' | 'none'): string[] => {
  if (animationType === 'terminal-reset') {
    return content.split('\x1bc').filter(frame => frame.trim());
  }

  if (animationType === 'cursor-up') {
    const frames: string[] = [];
    const parts = content.split(/\x1b\[\d+A/);

    for (const part of parts) {
      if (part.trim()) {
        frames.push(part);
      }
    }
    return frames;
  }

  if (animationType === 'cursor-restore') {
    return content.split('\x1b8').filter(frame => frame.trim());
  }

  if (animationType === 'clear-line') {
    // Split on clear-line sequences, filter empty frames
    return content.split(/\x1b\[2K\x1b\[0G|\x1b\[2K/).filter(frame => frame.trim());
  }

  return [content];
};


//#region Frame Rendering

const renderFrame = (content: string, options: RenderFrameOptions): string => {
  const charWidth = options.fontSize * 0.6;
  const lineHeightPx = options.fontSize * options.lineHeight;
  const headerHeight = options.headerHeight ?? 40;
  // Reserve space for watermark so terminal content doesn't overlap
  const watermarkHeight = options.watermark ? lineHeightPx : 0;
  const gridWidth = Math.floor((options.width - options.padding * 2) / charWidth);
  const gridHeight = Math.floor((options.height - headerHeight - options.padding * 2 - watermarkHeight) / lineHeightPx);

  let grid = createGridState(gridWidth, gridHeight);
  grid = processInput(grid, content);

  const rows = coalesce(grid, options.theme);

  const { svg } = emit(rows, null, false, {
    theme: options.theme,
    template: options.template,
    width: options.width,
    height: options.height,
    fontSize: options.fontSize,
    title: options.title,
    lineHeight: lineHeightPx,
    charWidth: charWidth,
    padding: options.padding,
    borderRadius: options.borderRadius,
    borderColor: options.borderColor,
    borderWidth: options.borderWidth,
    fontFamily: options.fontFamily,
    watermark: options.watermark,
    cursorStyle: options.cursorStyle,
    cursorColor: options.cursorColor,
    cursorBlink: options.cursorBlink,
    headerBackground: options.headerBackground,
    headerHeight: options.headerHeight,
    headerBorder: options.headerBorder,
    headerBorderColor: options.headerBorderColor,
    headerBorderWidth: options.headerBorderWidth,
    footerBackground: options.footerBackground,
    footerHeight: options.footerHeight,
    footerBorder: options.footerBorder,
    footerBorderColor: options.footerBorderColor,
    footerBorderWidth: options.footerBorderWidth,
    letterSpacing: options.letterSpacing,
    background: options.background,
    backgroundPadding: options.backgroundPadding,
  });

  return svg;
};


//#region Pipe Command

export const pipeCommand = async (args: PipeArgs): Promise<void> => {
  const spinner = createSpinner('Reading from stdin');

  if (!args.verbose) {
    spinner.start();
  }

  try {
    if (args.verbose) {
      console.log('Reading from stdin...');
    }

    const { data: input, totalDuration } = await readStdin();

    if (!input.trim()) {
      throw new Error('No input received from stdin');
    }

    if (args.verbose) {
      console.log(`Received ${input.length} bytes in ${totalDuration}ms`);
    }

    const animationType = detectAnimationType(input);

    if (args.verbose) {
      console.log(`Animation type: ${animationType}`);
    }

    const frameContents = splitIntoFrames(input, animationType);

    if (args.verbose) {
      console.log(`Split into ${frameContents.length} frames`);
    }

    if (frameContents.length === 0) {
      throw new Error('No frames detected in input');
    }

    const fontSize = args.fontSize || 14;
    const lineHeight = args.lineHeight || 1.4;
    const padding = args.padding || 16;
    const borderRadius = args.borderRadius || 8;
    const theme = args.theme ? (themes as unknown as Record<string, typeof themes.dark>)[args.theme] || themes.dark : themes.dark;
    const title = args.title;
    const template = (args.template || 'macos') as 'macos' | 'windows' | 'minimal';
    const cursorStyle = (args.cursorStyle || 'block') as 'block' | 'bar' | 'underline';

    const renderOptions: Omit<RenderFrameOptions, 'width' | 'height'> = {
      fontSize,
      lineHeight,
      padding,
      borderRadius,
      theme,
      title,
      template,
      borderColor: args.borderColor,
      borderWidth: args.borderWidth,
      fontFamily: args.fontFamily,
      watermark: args.watermark,
      cursorStyle,
      cursorColor: args.cursorColor,
      cursorBlink: args.cursorBlink,
      headerBackground: args.headerBackground,
      headerHeight: args.headerHeight,
      headerBorder: args.headerBorder,
      headerBorderColor: args.headerBorderColor,
      headerBorderWidth: args.headerBorderWidth,
      footerBackground: args.footerBackground,
      footerHeight: args.footerHeight,
      footerBorder: args.footerBorder,
      footerBorderColor: args.footerBorderColor,
      footerBorderWidth: args.footerBorderWidth,
      letterSpacing: args.letterSpacing,
      background: args.background ? parseGradient(args.background) : undefined,
      backgroundPadding: args.backgroundPadding,
    };

    let width = args.width;
    let height = args.height;

    if (!width || !height) {
      // Check ALL frames for max dimensions, not just the first one
      let maxLineLength = 40;
      let maxLineCount = 10;

      for (const frame of frameContents) {
        const plainText = frame.replace(/\x1b\[[0-9;]*m/g, '');
        const allLines = plainText.split('\n');
        // For max line length, filter empty lines
        const nonEmptyLines = allLines.filter(l => l.length > 0);

        for (const line of nonEmptyLines) {
          if (line.length > maxLineLength) {
            maxLineLength = line.length;
          }
        }
        // For row count, count ALL lines (including empty) to preserve vertical spacing
        // But trim trailing empty lines that might be artifacts
        let lineCount = allLines.length;
        while (lineCount > 0 && allLines[lineCount - 1].length === 0) {
          lineCount--;
        }
        if (lineCount > maxLineCount) {
          maxLineCount = lineCount;
        }
      }

      const charWidth = fontSize * 0.6;
      const letterSpacingPx = args.letterSpacing ?? 0;
      const effectiveCharWidth = charWidth + letterSpacingPx;
      const lineHeightPx = fontSize * lineHeight;
      const headerHeight = 40;
      // Add extra space for watermark if present
      const watermarkHeight = args.watermark ? lineHeightPx : 0;

      if (!width) {
        width = Math.ceil(maxLineLength * effectiveCharWidth + padding * 2);
      }
      if (!height) {
        height = Math.ceil(maxLineCount * lineHeightPx + headerHeight + padding * 2 + watermarkHeight);
      }

      if (args.verbose) {
        console.log(`Auto-detected dimensions: ${width}x${height} (${maxLineLength} cols x ${maxLineCount} rows)`);
      }
    }

    let frameDuration: number;
    if (totalDuration > 100 && frameContents.length > 1) {
      frameDuration = totalDuration / (frameContents.length - 1);
      if (args.verbose) {
        const detectedFps = 1000 / frameDuration;
        console.log(`Detected ${detectedFps.toFixed(1)} fps from stream timing`);
      }
    } else {
      frameDuration = 1000 / 30;
    }

    if (!args.verbose) {
      spinner.update(`Rendering ${frameContents.length} frames`);
    }

    const frames: TerminalFrame[] = frameContents.map((content, i) => {
      const svg = renderFrame(content, { ...renderOptions, width, height });
      return {
        timestamp: i * frameDuration,
        svg,
        state: {
          content,
          cursorX: 0,
          cursorY: 0,
          width,
          height,
          fontSize,
          showCursor: false,
          activeCursor: false,
        },
      };
    });

    if (args.verbose) {
      console.log(`Rendered ${frames.length} frames`);
    }

    // Apply playback speed to frame timestamps
    const speed = args.playbackSpeed ?? 1;
    if (speed !== 1 && speed > 0) {
      for (const frame of frames) {
        frame.timestamp = Math.round(frame.timestamp / speed);
      }
    }

    if (!args.verbose) {
      spinner.update('Generating animated SVG');
    }

    const animationOptions: AnimationOptions = {
      loop: args.loop !== false,
      pauseAtEnd: args['pause-at-end'] || 1000,
      loopStyle: args['loop-style'] || 'loop',
      loopPause: args['loop-pause'] ?? 0,
      fadeDuration: args['fade-duration'] ?? 1500,
      rewindSpeed: args['rewind-speed'] ?? 5,
    };

    let svg = await createAnimatedSVG(frames, animationOptions);

    if (!args.verbose) {
      spinner.update('Optimizing SVG');
    }

    const originalSize = Buffer.byteLength(svg, 'utf-8');
    svg = optimizeSvg(svg);
    const optimizedSize = Buffer.byteLength(svg, 'utf-8');

    if (args.verbose) {
      const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
      console.log(`Optimized: ${(originalSize / 1024).toFixed(0)}KB → ${(optimizedSize / 1024).toFixed(0)}KB (${savings}% reduction)`);
    }

    const outputPath = args.output || 'output.svg';

    writeFileSync(outputPath, svg, 'utf-8');

    const metadata = getAnimationMetadata(frames);
    const sizeKB = (Buffer.byteLength(svg, 'utf-8') / 1024).toFixed(2);

    // ANSI color codes
    const green = '\x1b[32m';
    const white = '\x1b[37m';
    const lightBlue = '\x1b[94m';
    const lightPink = '\x1b[95m';
    const lightOrange = '\x1b[38;5;215m';
    const limeGreen = '\x1b[92m';
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';

    const durationStr = (metadata.duration / 1000).toFixed(2) + 's';

    if (args.verbose) {
      console.log(`\n${green}✓${reset} ${white}Created${reset} ${lightBlue}${outputPath}${reset}`);
      console.log(`  ${dim}├─${reset} ${lightPink}${metadata.frameCount}${reset}${dim} frames${reset}`);
      console.log(`  ${dim}├─${reset} ${lightOrange}${durationStr}${reset}${dim} duration${reset}`);
      console.log(`  ${dim}└─${reset} ${limeGreen}${sizeKB}KB${reset}${dim} optimized${reset}`);
    } else {
      spinner.successMultiline([
        `${green}✓${reset} ${white}Created${reset} ${lightBlue}${outputPath}${reset}`,
        `  ${dim}├─${reset} ${lightPink}${metadata.frameCount}${reset}${dim} frames${reset}`,
        `  ${dim}├─${reset} ${lightOrange}${durationStr}${reset}${dim} duration${reset}`,
        `  ${dim}└─${reset} ${limeGreen}${sizeKB}KB${reset}${dim} optimized${reset}`,
      ]);
    }

    process.exit(0);
  } catch (err) {
    if (!args.verbose) {
      spinner.fail('Failed to process stdin');
    }
    throw err;
  }
};

