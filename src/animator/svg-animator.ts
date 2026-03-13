import type { TerminalFrame } from '../executor/cd-executor';

//#region Types

export type LoopStyle = 'loop' | 'reverse' | 'rewind' | 'fade';

export interface AnimationOptions {
  fps?: number;
  loop?: boolean;
  pauseAtEnd?: number;
  loopStyle?: LoopStyle;
  loopPause?: number;
  fadeDuration?: number;
  rewindSpeed?: number;
}


//#region Utilities

// Format keyTime for minimal SVG size (removes trailing zeros)
const fmtKeyTime = (t: number): string => {
  if (t === 0) return '0';
  if (t === 1) return '1';
  return t.toFixed(6).replace(/\.?0+$/, '');
};

const extractStyleBlock = (svg: string): string => {
  const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
  return styleMatch ? styleMatch[1] : '';
};

const extractDynamicContent = (svg: string, frameId: string): string => {
  const contentMatch = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!contentMatch) return '';

  let content = contentMatch[1];
  content = content.replace(/<style>[\s\S]*?<\/style>/g, '');
  content = content.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  content = content.replace(/^\s*<g clip-path="[^"]*">\s*/g, '');
  content = content.replace(/\s*<\/g>\s*$/g, '');
  content = content.replace(/<rect class="window-bg"[^>]*\/>/g, '');
  content = content.replace(/<g class="chrome">[\s\S]*?<\/g>/g, '');
  content = content.replace(/<g class="footer">[\s\S]*?<\/g>/g, '');
  // Remove text watermarks
  content = content.replace(/<text class="watermark"[^>]*>[\s\S]*?<\/text>/g, '');
  // Remove markup watermarks (g element with translate transform and font-family at end)
  content = content.replace(/<g transform="translate\([^"]+\)"[^>]*font-family[^>]*>[\s\S]*?<\/g>\s*$/g, '');
  content = content
    .replace(/id="([^"]*)"/g, `id="$1-${frameId}"`)
    .replace(/url\(#([^)]*)\)/g, `url(#$1-${frameId})`);
  content = content.replace(/^\s*[\r\n]/gm, '');

  return content.trim();
};

const extractChrome = (svg: string): string => {
  const chromeMatch = svg.match(/<g class="chrome">([\s\S]*?)<\/g>/);
  return chromeMatch ? chromeMatch[1] : '';
};

const extractFooter = (svg: string): string => {
  const footerMatch = svg.match(/<g class="footer">([\s\S]*?)<\/g>/);
  return footerMatch ? footerMatch[1] : '';
};

const extractWatermark = (svg: string): string => {
  // First try to find text-based watermark
  const textWatermarkMatch = svg.match(/<text class="watermark"[^>]*>[\s\S]*?<\/text>/);
  if (textWatermarkMatch) return textWatermarkMatch[0];

  // Look for a markup watermark (g element with transform at end of content)
  const markupWatermarkMatch = svg.match(/<g transform="translate\([^"]+\)"[^>]*font-family[^>]*>[\s\S]*?<\/g>\s*(?=<\/g>\s*<\/svg>|<\/svg>)/);
  if (!markupWatermarkMatch) return '';

  // Strip nested defs since they're hoisted to root
  return markupWatermarkMatch[0].replace(/<defs[^>]*>[\s\S]*?<\/defs>/gi, '');
};

const extractWatermarkDefs = (svg: string): string => {
  // Look for defs inside watermark content (markup watermarks may have clipPaths)
  const watermarkMatch = svg.match(/<g transform="translate\([^"]+\)"[^>]*font-family[^>]*>([\s\S]*?)<\/g>\s*(?=<\/g>\s*<\/svg>|<\/svg>)/);
  if (!watermarkMatch) return '';

  const watermarkContent = watermarkMatch[1];
  const defsMatch = watermarkContent.match(/<defs[^>]*>([\s\S]*?)<\/defs>/gi);
  if (!defsMatch) return '';

  // Return inner content of all defs
  return defsMatch.map(d => {
    const inner = d.match(/<defs[^>]*>([\s\S]*?)<\/defs>/i);
    return inner ? inner[1] : '';
  }).join('\n');
};

const getSVGDimensions = (svg: string): { width: number; height: number } => {
  const widthMatch = svg.match(/width="(\d+)"/);
  const heightMatch = svg.match(/height="(\d+)"/);
  return {
    width: widthMatch ? parseInt(widthMatch[1], 10) : 800,
    height: heightMatch ? parseInt(heightMatch[1], 10) : 600,
  };
};

const getBackgroundColor = (svg: string): string => {
  const bgMatch = svg.match(/class="window-bg"[^>]*fill="([^"]*)"/);
  return bgMatch ? bgMatch[1] : '#282a36';
};

const getBorderRadius = (svg: string): number => {
  const rxMatch = svg.match(/class="window-bg"[^>]*rx="(\d+)"/);
  return rxMatch ? parseInt(rxMatch[1], 10) : 0;
};

const getHeaderHeight = (svg: string): number => {
  const headerMatch = svg.match(/class="header-bg"[^>]*height="(\d+)"/);
  return headerMatch ? parseInt(headerMatch[1], 10) : 0;
};

const getFooterHeight = (svg: string): number => {
  const footerMatch = svg.match(/class="footer-bg"[^>]*height="(\d+)"/);
  return footerMatch ? parseInt(footerMatch[1], 10) : 0;
};


//#region Frame Deduplication

const deduplicateFrames = (frames: TerminalFrame[]): TerminalFrame[] => {
  if (frames.length <= 1) return frames;

  const result: TerminalFrame[] = [];
  let lastContent = '';

  for (let i = 0; i < frames.length; i++) {
    const content = extractDynamicContent(frames[i].svg, 'check');
    if (content !== lastContent || i === frames.length - 1) {
      result.push(frames[i]);
      lastContent = content;
    }
  }

  return result;
};


//#region Animation Generation

export const createAnimatedSVG = async (
  frames: TerminalFrame[],
  options: AnimationOptions = {}
): Promise<string> => {
  if (frames.length === 0) throw new Error('No frames to animate');

  const loopStyle = options.loopStyle || 'loop';

  const animationFrames = deduplicateFrames(frames);
  const { width, height } = getSVGDimensions(animationFrames[0].svg);
  const bgColor = getBackgroundColor(animationFrames[0].svg);
  const borderRadius = getBorderRadius(animationFrames[0].svg);
  const headerHeight = getHeaderHeight(animationFrames[0].svg);
  const footerHeight = getFooterHeight(animationFrames[0].svg);

  const lastFrameTimestamp = frames[frames.length - 1].timestamp;
  const pauseAtEnd = options.pauseAtEnd ?? 1000;

  const frameDuration = frames.length > 1
    ? frames[1].timestamp - frames[0].timestamp
    : lastFrameTimestamp;

  const seamlessLoop = pauseAtEnd <= 0;
  const loopPause = options.loopPause ?? 0;
  const fadeDuration = options.fadeDuration ?? 1500;
  const rewindSpeed = options.rewindSpeed ?? 5;

  // Calculate total duration based on loop style
  let animationDurationMs: number;
  const forwardDuration = seamlessLoop
    ? lastFrameTimestamp + frameDuration
    : lastFrameTimestamp + pauseAtEnd;

  if (loopStyle === 'reverse') {
    // Forward + reverse at same speed + optional loop pause
    animationDurationMs = forwardDuration + lastFrameTimestamp + loopPause;
  } else if (loopStyle === 'rewind') {
    // Forward + fast rewind (reverse / rewindSpeed) + optional loop pause
    animationDurationMs = forwardDuration + (lastFrameTimestamp / rewindSpeed) + loopPause;
  } else if (loopStyle === 'fade') {
    // Forward + fade duration + optional loop pause
    animationDurationMs = forwardDuration + fadeDuration + loopPause;
  } else {
    animationDurationMs = forwardDuration + loopPause;
  }

  const animationDurationS = (animationDurationMs / 1000).toFixed(2);
  const repeatCount = options.loop !== false ? 'indefinite' : '1';

  const baseStyles = extractStyleBlock(animationFrames[0].svg);
  const chrome = extractChrome(animationFrames[0].svg);
  const footer = extractFooter(animationFrames[0].svg);
  const watermark = extractWatermark(animationFrames[0].svg);
  const watermarkDefs = extractWatermarkDefs(animationFrames[0].svg);

  const frameAnimations: string[] = [];

  // Generate frame animations based on loop style
  if (loopStyle === 'reverse' || loopStyle === 'rewind') {
    // Reverse/Rewind: play forward normally, then play the same frames in reverse order
    // Rewind uses faster speed (rewindSpeed multiplier)
    const forwardEndTime = forwardDuration / animationDurationMs;

    // Calculate reverse timestamps - mirror the forward timestamps
    // If forward is [0, t1, t2, ..., tn], reverse should play [tn, ..., t2, t1, 0]
    // For rewind, the reverse pass takes lastFrameTimestamp / rewindSpeed ms
    const reverseDurationMs = loopStyle === 'rewind'
      ? lastFrameTimestamp / rewindSpeed
      : lastFrameTimestamp;
    const reverseStartTime = forwardEndTime;
    const reverseEndTime = (forwardDuration + reverseDurationMs) / animationDurationMs;
    const reverseDurationNormalized = reverseEndTime - reverseStartTime;

    for (let i = 0; i < animationFrames.length; i++) {
      const frameContent = extractDynamicContent(animationFrames[i].svg, `f${i}`);
      const times: number[] = [];
      const values: string[] = [];

      // Forward pass: frame i is visible from its timestamp until frame i+1's timestamp
      const forwardStart = animationFrames[i].timestamp / animationDurationMs;
      const forwardEnd = i < animationFrames.length - 1
        ? animationFrames[i + 1].timestamp / animationDurationMs
        : forwardEndTime;

      // Reverse pass: mirror the forward timing
      // Frame i in reverse starts when we'd reach frame i going backwards
      // and ends when we'd reach frame i-1
      const reverseFrameStart = lastFrameTimestamp - (i < animationFrames.length - 1 ? animationFrames[i + 1].timestamp : lastFrameTimestamp);
      const reverseFrameEnd = lastFrameTimestamp - animationFrames[i].timestamp;

      const reverseStart = reverseStartTime + (reverseFrameStart / lastFrameTimestamp) * reverseDurationNormalized;
      const reverseEnd = reverseStartTime + (reverseFrameEnd / lastFrameTimestamp) * reverseDurationNormalized;

      // Build timeline
      if (i === 0) {
        // First frame: visible at start, hidden when frame 1 shows, visible again when reverse reaches frame 0, stays visible through loopPause
        times.push(0);
        values.push('visible');
        if (animationFrames.length > 1) {
          times.push(forwardEnd);
          values.push('hidden');
        }
        // Frame 0 appears when reverse playhead reaches it (reverseStart), stays visible until loop restarts
        times.push(reverseStart);
        values.push('visible');
        times.push(1);
        values.push('visible');
      } else if (i === animationFrames.length - 1) {
        // Last frame: hidden at start, visible at its forward time, stays visible through pauseAtEnd, then hidden when reverse moves past it
        times.push(0);
        values.push('hidden');
        times.push(forwardStart);
        values.push('visible');
        // Stay visible until the reverse pass moves past this frame (reverseEnd)
        times.push(reverseEnd);
        values.push('hidden');
        times.push(1);
        values.push('hidden');
      } else {
        // Middle frames: hidden, visible during forward, hidden, visible during reverse, hidden
        times.push(0);
        values.push('hidden');
        times.push(forwardStart);
        values.push('visible');
        times.push(forwardEnd);
        values.push('hidden');
        times.push(reverseStart);
        values.push('visible');
        times.push(reverseEnd);
        values.push('hidden');
        times.push(1);
        values.push('hidden');
      }

      // Dedupe consecutive same-value entries
      const dedupedTimes: number[] = [times[0]];
      const dedupedValues: string[] = [values[0]];
      for (let j = 1; j < times.length; j++) {
        if (times[j] !== dedupedTimes[dedupedTimes.length - 1] ||
            values[j] !== dedupedValues[dedupedValues.length - 1]) {
          dedupedTimes.push(times[j]);
          dedupedValues.push(values[j]);
        }
      }

      const keyTimesStr = dedupedTimes.map(fmtKeyTime).join(';');
      const valuesStr = dedupedValues.join(';');
      const initialVisibility = i === 0 ? 'visible' : 'hidden';

      frameAnimations.push(`
  <g id="frame-${i}" visibility="${initialVisibility}">
    ${frameContent}
    <animate attributeName="visibility" values="${valuesStr}" keyTimes="${keyTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/>
  </g>`);
    }
  } else if (loopStyle === 'fade') {
    // For fade, show frames normally, then fade to black and stay black until loop restarts
    const forwardEndTime = forwardDuration / animationDurationMs;
    const fadeOutEnd = (forwardDuration + fadeDuration) / animationDurationMs;

    // Regular frame animations (same as loop style)
    const keyTimes: number[] = animationFrames.map(f => f.timestamp / animationDurationMs);

    for (let i = 0; i < animationFrames.length; i++) {
      const frameContent = extractDynamicContent(animationFrames[i].svg, `f${i}`);
      const times: number[] = [];
      const values: string[] = [];

      if (i === 0) {
        // First frame: visible at start, hidden when next frame shows, stays hidden until loop restarts
        times.push(0);
        values.push('visible');
        if (animationFrames.length > 1) {
          times.push(keyTimes[1]);
          values.push('hidden');
        }
        times.push(1);
        values.push('hidden');
      } else if (i === animationFrames.length - 1) {
        // Last frame: hidden at start, visible at its time, stays visible (fades to black on top)
        times.push(0);
        values.push('hidden');
        times.push(keyTimes[i]);
        values.push('visible');
        times.push(1);
        values.push('visible');
      } else {
        // Middle frames: hidden, visible during their time, then hidden
        times.push(0);
        values.push('hidden');
        times.push(keyTimes[i]);
        values.push('visible');
        times.push(keyTimes[i + 1]);
        values.push('hidden');
        times.push(1);
        values.push('hidden');
      }

      // Dedupe
      const dedupedTimes: number[] = [times[0]];
      const dedupedValues: string[] = [values[0]];
      for (let j = 1; j < times.length; j++) {
        if (times[j] !== dedupedTimes[dedupedTimes.length - 1] ||
            values[j] !== dedupedValues[dedupedValues.length - 1]) {
          dedupedTimes.push(times[j]);
          dedupedValues.push(values[j]);
        }
      }

      const keyTimesStr = dedupedTimes.map(fmtKeyTime).join(';');
      const valuesStr = dedupedValues.join(';');
      const initialVisibility = i === 0 ? 'visible' : 'hidden';

      frameAnimations.push(`
  <g id="frame-${i}" visibility="${initialVisibility}">
    ${frameContent}
    <animate attributeName="visibility" values="${valuesStr}" keyTimes="${keyTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/>
  </g>`);
    }

    // Add fade overlay - fades to black and stays black until loop restarts
    const fadeOverlayTimes = `0;${fmtKeyTime(forwardEndTime)};${fmtKeyTime(fadeOutEnd)};1`;
    const fadeOverlayOpacity = '0;0;1;1';

    // Only fade the content area, not header/footer
    const fadeY = headerHeight;
    const fadeHeight = height - headerHeight - footerHeight;

    frameAnimations.push(`
  <rect id="fade-overlay" x="0" y="${fadeY}" width="${width}" height="${fadeHeight}" fill="${bgColor}" opacity="0">
    <animate attributeName="opacity" values="${fadeOverlayOpacity}" keyTimes="${fadeOverlayTimes}" dur="${animationDurationS}s" repeatCount="${repeatCount}" fill="freeze"/>
  </rect>`);
  } else {
    // Default loop style
    const keyTimes: number[] = animationFrames.map(f => f.timestamp / animationDurationMs);

    for (let i = 0; i < animationFrames.length; i++) {
      const frameContent = extractDynamicContent(animationFrames[i].svg, `f${i}`);
      const times: number[] = [];
      const values: string[] = [];

      if (i === 0) {
        times.push(0);
        values.push('visible');
        if (animationFrames.length > 1) {
          times.push(keyTimes[1]);
          values.push('hidden');
        }
        times.push(1);
        values.push('hidden');
      } else if (i === animationFrames.length - 1) {
        times.push(0);
        values.push('hidden');
        times.push(keyTimes[i]);
        values.push('visible');
        times.push(1);
        values.push('visible');
      } else {
        times.push(0);
        values.push('hidden');
        times.push(keyTimes[i]);
        values.push('visible');
        times.push(keyTimes[i + 1]);
        values.push('hidden');
        times.push(1);
        values.push('hidden');
      }

      // Dedupe: only skip if BOTH time and value are the same as previous
      const dedupedTimes: number[] = [times[0]];
      const dedupedValues: string[] = [values[0]];
      for (let j = 1; j < times.length; j++) {
        const sameTime = times[j] === dedupedTimes[dedupedTimes.length - 1];
        const sameValue = values[j] === dedupedValues[dedupedValues.length - 1];
        if (!sameTime || !sameValue) {
          dedupedTimes.push(times[j]);
          dedupedValues.push(values[j]);
        }
      }

      const keyTimesStr = dedupedTimes.map(fmtKeyTime).join(';');
      const valuesStr = dedupedValues.join(';');
      const initialVisibility = i === 0 ? 'visible' : 'hidden';

      frameAnimations.push(`
  <g id="frame-${i}" visibility="${initialVisibility}">
    ${frameContent}
    <animate attributeName="visibility" values="${valuesStr}" keyTimes="${keyTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/>
  </g>`);
    }
  }

  const defsContent: string[] = [];
  if (borderRadius > 0) {
    defsContent.push(`<clipPath id="rounded-corners"><rect x="0" y="0" width="${width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}"/></clipPath>`);
  }
  if (watermarkDefs) {
    defsContent.push(watermarkDefs);
  }
  const clipPathDef = defsContent.length > 0 ? `<defs>${defsContent.join('\n')}</defs>` : '';
  const clipStart = borderRadius > 0 ? `<g clip-path="url(#rounded-corners)">` : '';
  const clipEnd = borderRadius > 0 ? '</g>' : '';
  const bgRx = borderRadius > 0 ? ` rx="${borderRadius}" ry="${borderRadius}"` : '';
  const chromeSection = chrome ? `<g class="chrome">${chrome}</g>` : '';
  const footerSection = footer ? `<g class="footer">${footer}</g>` : '';

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${clipPathDef}
  <style>
    ${baseStyles}
  </style>

  ${clipStart}
  <!-- Static background (never animated) -->
  <rect width="100%" height="100%" fill="${bgColor}"${bgRx} />

  <!-- Static chrome (title bar) -->
  ${chromeSection}

  <!-- Animated frames (only dynamic content) -->
  ${frameAnimations.join('\n')}

  <!-- Static footer -->
  ${footerSection}
  ${watermark}
  ${clipEnd}
</svg>`;
};


//#region Metadata

export const extractStaticElements = (frames: TerminalFrame[]): {
  width: number;
  height: number;
  bgColor: string;
  borderRadius: number;
  styles: string;
  chrome: string;
  footer: string;
  watermark: string;
} => {
  const firstFrame = frames[0].svg;
  return {
    ...getSVGDimensions(firstFrame),
    bgColor: getBackgroundColor(firstFrame),
    borderRadius: getBorderRadius(firstFrame),
    styles: extractStyleBlock(firstFrame),
    chrome: extractChrome(firstFrame),
    footer: extractFooter(firstFrame),
    watermark: extractWatermark(firstFrame),
  };
};

export const getAnimationMetadata = (frames: TerminalFrame[]): {
  duration: number;
  frameCount: number;
  fps: number;
} => {
  const duration = frames.length > 0 ? frames[frames.length - 1].timestamp : 0;
  const frameCount = frames.length;
  const fps = frameCount > 1 ? frameCount / (duration / 1000) : 0;
  return { duration, frameCount, fps: Math.round(fps * 10) / 10 };
};

