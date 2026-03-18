import type { TerminalFrame } from '../executor/cd-executor';

//#region Types

export type LoopStyle = 'loop' | 'reverse' | 'rewind' | 'fade';

interface TextSpan {
  x: string;
  y: string;
  classes: string;
  fill?: string;
  content: string;
}

interface BackgroundPath {
  d: string;  // Path data
  fill: string;
  shapeRendering?: string;
}

interface CursorInfo {
  element: string;  // The cursor SVG element (path or rect)
  x: number;
  y: number;
  isActive: boolean;
}

interface SelectionInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

interface FrameTextData {
  spans: TextSpan[];
  bgPaths: BackgroundPath[];
  cursor: CursorInfo | null;
  selection: SelectionInfo | null;
}

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
  // Remove outer background rect (solid color or gradient, with optional border radius)
  content = content.replace(/<rect x="0" y="0" width="\d+" height="\d+" fill="[^"]*"(?: rx="\d+" ry="\d+")?\/>/g, '');
  // Count how many wrapper groups we need to remove (translate group and/or clip-path group)
  let closingTagsToRemove = 0;
  if (/<g transform="translate\(\d+, \d+\)">/.test(content)) {
    content = content.replace(/<g transform="translate\(\d+, \d+\)">/g, '');
    closingTagsToRemove++;
  }
  if (/<g clip-path="[^"]*">/.test(content)) {
    content = content.replace(/<g clip-path="[^"]*">/g, '');
    closingTagsToRemove++;
  }
  // Remove exactly the number of closing </g> tags we need from the end
  for (let i = 0; i < closingTagsToRemove; i++) {
    content = content.replace(/\s*<\/g>\s*$/, '');
  }
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

const extractGradientDefs = (svg: string): string => {
  const defsMatch = svg.match(/<defs>([\s\S]*?)<\/defs>/);
  if (!defsMatch) return '';

  const defsContent = defsMatch[1];
  const gradientMatch = defsContent.match(/<linearGradient[^>]*id="bg-gradient"[^>]*>[\s\S]*?<\/linearGradient>/);
  return gradientMatch ? gradientMatch[0] : '';
};

const extractBackgroundPadding = (svg: string): number => {
  // Look for a translate transform on a group that wraps the terminal content
  const translateMatch = svg.match(/<g transform="translate\((\d+), \d+\)">/);
  return translateMatch ? parseInt(translateMatch[1], 10) : 0;
};

const extractOuterBackground = (svg: string): { fill: string; isGradient: boolean; borderRadius: number } | null => {
  // Look for a rect that fills the entire outer area (before the terminal window group)
  // This rect appears after defs but before the translate group
  // Match with optional rx/ry attributes for border radius
  const bgMatch = svg.match(/<rect x="0" y="0" width="\d+" height="\d+" fill="([^"]+)"(?: rx="(\d+)" ry="\d+")?\/>/);
  if (bgMatch) {
    const fill = bgMatch[1];
    const borderRadius = bgMatch[2] ? parseInt(bgMatch[2], 10) : 0;
    return { fill, isGradient: fill.startsWith('url(#'), borderRadius };
  }
  return null;
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


//#region Frame Text/Cursor Extraction

const parseFrameTextData = (frameContent: string): FrameTextData => {
  const spans: TextSpan[] = [];
  const bgPaths: BackgroundPath[] = [];
  let cursor: CursorInfo | null = null;

  // Extract text elements: <text class="..." x="..." y="..."[ fill="..."]>content</text>
  const textRegex = /<text class="([^"]*)" x="([^"]*)" y="([^"]*)"(?: fill="([^"]*)")?[^>]*>([^<]*)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(frameContent)) !== null) {
    spans.push({
      classes: match[1],
      x: match[2],
      y: match[3],
      fill: match[4] || undefined,
      content: match[5],
    });
  }

  // Extract background path elements (colored cell backgrounds from lolcat, etc.)
  // Pattern: <path d="..." fill="..." shape-rendering="crispEdges"/>
  const pathRegex = /<path d="([^"]*)" fill="([^"]*)" shape-rendering="crispEdges"\s*\/>/g;
  while ((match = pathRegex.exec(frameContent)) !== null) {
    bgPaths.push({
      d: match[1],
      fill: match[2],
      shapeRendering: 'crispEdges',
    });
  }

  // Extract cursor: <g class="cursor[-active]">...<path d="M{x} {y}..." .../> or <rect x="..." y="..." .../>
  const cursorGroupRegex = /<g class="(cursor|cursor-active)"[^>]*>([\s\S]*?)<\/g>/;
  const cursorMatch = frameContent.match(cursorGroupRegex);
  if (cursorMatch) {
    const isActive = cursorMatch[1] === 'cursor-active';
    const cursorContent = cursorMatch[2];

    // Try path first (block cursor): <path d="M{x} {y}h{w}v{h}H{x}z" .../>
    // Extract width and height from the path to rebuild with all-relative coordinates
    const pathMatch = cursorContent.match(/<path d="M([0-9.]+) ([0-9.]+)h([0-9.]+)v([0-9.]+)H[0-9.]+z" fill="([^"]*)"\s*\/>/);
    if (pathMatch) {
      const width = pathMatch[3];
      const height = pathMatch[4];
      cursor = {
        // Use all-relative path commands so translate transform works correctly
        element: `<path d="M0 0h${width}v${height}h-${width}z" fill="${pathMatch[5]}"/>`,
        x: parseFloat(pathMatch[1]),
        y: parseFloat(pathMatch[2]),
        isActive,
      };
    } else {
      // Try rect (bar/underline cursor): <rect x="..." y="..." width="..." height="..." fill="..."/>
      const rectMatch = cursorContent.match(/<rect x="([0-9.]+)" y="([0-9.]+)" width="([^"]*)" height="([^"]*)" fill="([^"]*)"\s*\/>/);
      if (rectMatch) {
        cursor = {
          element: `<rect x="0" y="0" width="${rectMatch[3]}" height="${rectMatch[4]}" fill="${rectMatch[5]}"/>`,
          x: parseFloat(rectMatch[1]),
          y: parseFloat(rectMatch[2]),
          isActive,
        };
      }
    }
  }

  // Extract selection: <g class="selection-layer"><path d="M{x} {y}h{w}v{h}H{x}z" fill="..." opacity="0.5"/></g>
  let selection: SelectionInfo | null = null;
  const selectionMatch = frameContent.match(/<g class="selection-layer"><path d="M([0-9.]+) ([0-9.]+)h([0-9.]+)v([0-9.]+)H[0-9.]+z" fill="([^"]*)" opacity="[^"]*"\s*\/>/);
  if (selectionMatch) {
    selection = {
      x: parseFloat(selectionMatch[1]),
      y: parseFloat(selectionMatch[2]),
      width: parseFloat(selectionMatch[3]),
      height: parseFloat(selectionMatch[4]),
      fill: selectionMatch[5],
    };
  }

  return { spans, bgPaths, cursor, selection };
};

const spanKey = (span: TextSpan): string => {
  return `${span.x}|${span.y}|${span.classes}|${span.fill || ''}|${span.content}`;
};

const bgPathKey = (path: BackgroundPath): string => {
  return `path|${path.d}|${path.fill}`;
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


//#region Optimized Delta Animation

interface SpanVisibility {
  span: TextSpan;
  firstFrame: number;  // Frame index where span first appears
  lastFrame: number;   // Frame index where span last appears (-1 = until end)
}

interface PathVisibility {
  path: BackgroundPath;
  firstFrame: number;
  lastFrame: number;
}

interface CursorKeyframe {
  frameIndex: number;
  x: number;
  y: number;
  isActive: boolean;
}

const generateOptimizedFrameContent = (
  animationFrames: TerminalFrame[],
  animationDurationMs: number,
  animationDurationS: string,
  repeatCount: string,
  loopStyle: LoopStyle,
  forwardDuration: number,
  lastFrameTimestamp: number,
  rewindSpeed: number,
  loopPause: number,
): { content: string; cursorContent: string; selectionContent: string } => {
  // Parse all frames to extract text spans and cursor positions
  const frameDataList: FrameTextData[] = [];
  for (let i = 0; i < animationFrames.length; i++) {
    const frameContent = extractDynamicContent(animationFrames[i].svg, `f${i}`);
    frameDataList.push(parseFrameTextData(frameContent));
  }

  // Build span visibility map - track when each unique span appears/disappears
  const spanVisibilityMap = new Map<string, SpanVisibility>();
  const frameSpanSets: Set<string>[] = [];

  for (let frameIdx = 0; frameIdx < frameDataList.length; frameIdx++) {
    const frameSpans = new Set<string>();
    for (const span of frameDataList[frameIdx].spans) {
      const key = spanKey(span);
      frameSpans.add(key);

      if (!spanVisibilityMap.has(key)) {
        spanVisibilityMap.set(key, {
          span,
          firstFrame: frameIdx,
          lastFrame: frameIdx,
        });
      } else {
        spanVisibilityMap.get(key)!.lastFrame = frameIdx;
      }
    }
    frameSpanSets.push(frameSpans);
  }

  // Build path visibility map - track when each unique background path appears/disappears
  const pathVisibilityMap = new Map<string, PathVisibility>();

  for (let frameIdx = 0; frameIdx < frameDataList.length; frameIdx++) {
    for (const path of frameDataList[frameIdx].bgPaths) {
      const key = bgPathKey(path);

      if (!pathVisibilityMap.has(key)) {
        pathVisibilityMap.set(key, {
          path,
          firstFrame: frameIdx,
          lastFrame: frameIdx,
        });
      } else {
        pathVisibilityMap.get(key)!.lastFrame = frameIdx;
      }
    }
  }

  // Generate optimized background paths with visibility animations
  const bgParts: string[] = [];
  const sortedPaths = Array.from(pathVisibilityMap.values()).sort((a, b) => {
    // Sort by first appearance
    return a.firstFrame - b.firstFrame;
  });

  if (sortedPaths.length > 0) {
    bgParts.push('<g class="bg-layer">');

    for (const { path, firstFrame, lastFrame } of sortedPaths) {
      const alwaysVisible = firstFrame === 0 && lastFrame === frameDataList.length - 1;

      if (alwaysVisible && loopStyle === 'loop') {
        bgParts.push(
          `<path d="${path.d}" fill="${path.fill}" shape-rendering="crispEdges"><animate attributeName="visibility" values="visible" keyTimes="0" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/></path>`
        );
      } else {
        // Simple loop timing for paths
        const startTime = animationFrames[firstFrame].timestamp / animationDurationMs;
        const endTime = lastFrame < frameDataList.length - 1
          ? animationFrames[lastFrame + 1].timestamp / animationDurationMs
          : 1;

        const times: number[] = [];
        const values: string[] = [];

        if (firstFrame === 0) {
          times.push(0);
          values.push('visible');
          if (lastFrame < frameDataList.length - 1) {
            times.push(endTime);
            values.push('hidden');
            times.push(1);
            values.push('hidden');
          }
        } else {
          times.push(0);
          values.push('hidden');
          times.push(startTime);
          values.push('visible');
          if (lastFrame < frameDataList.length - 1) {
            times.push(endTime);
            values.push('hidden');
          }
          times.push(1);
          values.push(lastFrame === frameDataList.length - 1 ? 'visible' : 'hidden');
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
        const initialVisibility = firstFrame === 0 ? 'visible' : 'hidden';

        bgParts.push(
          `<path d="${path.d}" fill="${path.fill}" shape-rendering="crispEdges" visibility="${initialVisibility}"><animate attributeName="visibility" values="${valuesStr}" keyTimes="${keyTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/></path>`
        );
      }
    }

    bgParts.push('</g>');
  }

  // Generate optimized text content with visibility animations
  const textParts: string[] = [];
  const sortedSpans = Array.from(spanVisibilityMap.values()).sort((a, b) => {
    // Sort by first appearance, then by y, then by x
    if (a.firstFrame !== b.firstFrame) return a.firstFrame - b.firstFrame;
    const ay = parseFloat(a.span.y), by = parseFloat(b.span.y);
    if (ay !== by) return ay - by;
    return parseFloat(a.span.x) - parseFloat(b.span.x);
  });

  textParts.push('<g class="text-layer">');

  for (let spanIdx = 0; spanIdx < sortedSpans.length; spanIdx++) {
    const { span, firstFrame, lastFrame } = sortedSpans[spanIdx];
    const fillAttr = span.fill ? ` fill="${span.fill}"` : '';

    // Check if span is visible for the entire animation
    const alwaysVisible = firstFrame === 0 && lastFrame === frameDataList.length - 1;

    if (alwaysVisible && loopStyle === 'loop') {
      // Static span - always visible, but still add animation for timing/repeatCount consistency
      // This ensures tests and tooling can detect the animation properties even for static content
      textParts.push(
        `<text class="${span.classes}" x="${span.x}" y="${span.y}"${fillAttr}>${span.content}<animate attributeName="visibility" values="visible" keyTimes="0" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/></text>`
      );
    } else {
      // Need visibility animation
      const times: number[] = [];
      const values: string[] = [];

      if (loopStyle === 'reverse' || loopStyle === 'rewind') {
        const forwardEndTime = forwardDuration / animationDurationMs;
        const reverseDurationMs = loopStyle === 'rewind'
          ? lastFrameTimestamp / rewindSpeed
          : lastFrameTimestamp;
        const reverseStartTime = forwardEndTime;
        const reverseEndTime = (forwardDuration + reverseDurationMs) / animationDurationMs;
        const reverseDurationNormalized = reverseEndTime - reverseStartTime;

        // Forward pass timing
        const forwardStart = animationFrames[firstFrame].timestamp / animationDurationMs;
        const forwardEnd = lastFrame < frameDataList.length - 1
          ? animationFrames[lastFrame + 1].timestamp / animationDurationMs
          : forwardEndTime;

        // Reverse pass: span appears in reverse when playhead is between its lastFrame and firstFrame
        const reverseFrameStart = lastFrameTimestamp - (lastFrame < frameDataList.length - 1 ? animationFrames[lastFrame + 1].timestamp : lastFrameTimestamp);
        const reverseFrameEnd = lastFrameTimestamp - animationFrames[firstFrame].timestamp;
        const reverseStart = reverseStartTime + (reverseFrameStart / lastFrameTimestamp) * reverseDurationNormalized;
        const reverseEnd = reverseStartTime + (reverseFrameEnd / lastFrameTimestamp) * reverseDurationNormalized;

        if (firstFrame === 0) {
          times.push(0);
          values.push('visible');
          if (lastFrame < frameDataList.length - 1) {
            times.push(forwardEnd);
            values.push('hidden');
          }
          times.push(reverseStart);
          values.push('visible');
          times.push(1);
          values.push('visible');
        } else if (lastFrame === frameDataList.length - 1) {
          times.push(0);
          values.push('hidden');
          times.push(forwardStart);
          values.push('visible');
          times.push(reverseEnd);
          values.push('hidden');
          times.push(1);
          values.push('hidden');
        } else {
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
      } else {
        // Simple loop or fade style
        const startTime = animationFrames[firstFrame].timestamp / animationDurationMs;
        const endTime = lastFrame < frameDataList.length - 1
          ? animationFrames[lastFrame + 1].timestamp / animationDurationMs
          : 1;

        if (firstFrame === 0) {
          times.push(0);
          values.push('visible');
          if (lastFrame < frameDataList.length - 1) {
            times.push(endTime);
            values.push('hidden');
            times.push(1);
            values.push('hidden');
          }
        } else {
          times.push(0);
          values.push('hidden');
          times.push(startTime);
          values.push('visible');
          if (lastFrame < frameDataList.length - 1) {
            times.push(endTime);
            values.push('hidden');
          }
          times.push(1);
          values.push(lastFrame === frameDataList.length - 1 ? 'visible' : 'hidden');
        }
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
      const initialVisibility = firstFrame === 0 ? 'visible' : 'hidden';

      textParts.push(
        `<text class="${span.classes}" x="${span.x}" y="${span.y}"${fillAttr} visibility="${initialVisibility}">${span.content}<animate attributeName="visibility" values="${valuesStr}" keyTimes="${keyTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/></text>`
      );
    }
  }

  textParts.push('</g>');

  // Generate cursor animation
  let cursorContent = '';
  const cursorKeyframes: CursorKeyframe[] = [];

  for (let i = 0; i < frameDataList.length; i++) {
    const cursor = frameDataList[i].cursor;
    if (cursor) {
      cursorKeyframes.push({
        frameIndex: i,
        x: cursor.x,
        y: cursor.y,
        isActive: cursor.isActive,
      });
    }
  }

  if (cursorKeyframes.length > 0) {
    // Get cursor template from first frame that has one
    const firstCursor = frameDataList.find(fd => fd.cursor)?.cursor;
    if (firstCursor) {
      // Check if all cursors have the same active state
      const allSameActive = cursorKeyframes.every(kf => kf.isActive === cursorKeyframes[0].isActive);
      const cursorClass = allSameActive
        ? (cursorKeyframes[0].isActive ? 'cursor-active' : 'cursor')
        : 'cursor'; // Default to blinking if mixed

      // Build position animation keyframes
      const xValues: string[] = [];
      const yValues: string[] = [];
      const keyTimes: string[] = [];

      if (loopStyle === 'reverse' || loopStyle === 'rewind') {
        const forwardEndTime = forwardDuration / animationDurationMs;
        const reverseDurationMs = loopStyle === 'rewind'
          ? lastFrameTimestamp / rewindSpeed
          : lastFrameTimestamp;
        const reverseStartTime = forwardEndTime;
        const reverseEndTime = (forwardDuration + reverseDurationMs) / animationDurationMs;
        const reverseDurationNormalized = reverseEndTime - reverseStartTime;

        // Forward pass
        for (let i = 0; i < cursorKeyframes.length; i++) {
          const kf = cursorKeyframes[i];
          const time = animationFrames[kf.frameIndex].timestamp / animationDurationMs;
          keyTimes.push(fmtKeyTime(time));
          xValues.push(kf.x.toString());
          yValues.push(kf.y.toString());
        }

        // Hold at end during pause
        if (forwardEndTime > keyTimes[keyTimes.length - 1].length) {
          const lastKf = cursorKeyframes[cursorKeyframes.length - 1];
          keyTimes.push(fmtKeyTime(forwardEndTime - 0.0001));
          xValues.push(lastKf.x.toString());
          yValues.push(lastKf.y.toString());
        }

        // Reverse pass (play keyframes in reverse order)
        for (let i = cursorKeyframes.length - 1; i >= 0; i--) {
          const kf = cursorKeyframes[i];
          const reverseOffset = lastFrameTimestamp - animationFrames[kf.frameIndex].timestamp;
          const time = reverseStartTime + (reverseOffset / lastFrameTimestamp) * reverseDurationNormalized;
          keyTimes.push(fmtKeyTime(time));
          xValues.push(kf.x.toString());
          yValues.push(kf.y.toString());
        }

        // Hold at start during loop pause
        if (loopPause > 0) {
          const firstKf = cursorKeyframes[0];
          keyTimes.push(fmtKeyTime(reverseEndTime));
          xValues.push(firstKf.x.toString());
          yValues.push(firstKf.y.toString());
        }
      } else {
        // Simple loop style
        for (let i = 0; i < cursorKeyframes.length; i++) {
          const kf = cursorKeyframes[i];
          const time = animationFrames[kf.frameIndex].timestamp / animationDurationMs;
          keyTimes.push(fmtKeyTime(time));
          xValues.push(kf.x.toString());
          yValues.push(kf.y.toString());
        }

        // Hold last position until loop restarts
        const lastKf = cursorKeyframes[cursorKeyframes.length - 1];
        if (parseFloat(keyTimes[keyTimes.length - 1]) < 1) {
          keyTimes.push('1');
          xValues.push(lastKf.x.toString());
          yValues.push(lastKf.y.toString());
        }
      }

      const keyTimesStr = keyTimes.join(';');
      const xValuesStr = xValues.join(';');
      const yValuesStr = yValues.join(';');

      // Use transform animation for cursor position
      cursorContent = `
  <g class="cursor-layer">
    <g class="${cursorClass}">
      <g>
        ${firstCursor.element}
        <animateTransform attributeName="transform" type="translate" values="${xValues.map((x, i) => `${x} ${yValues[i]}`).join(';')}" keyTimes="${keyTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/>
      </g>
    </g>
  </g>`;
    }
  }

  // Generate selection animation
  let selectionContent = '';
  interface SelectionKeyframe {
    frameIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
  }
  const selectionKeyframes: SelectionKeyframe[] = [];

  for (let i = 0; i < frameDataList.length; i++) {
    const selection = frameDataList[i].selection;
    if (selection) {
      selectionKeyframes.push({
        frameIndex: i,
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height,
        fill: selection.fill,
      });
    }
  }

  if (selectionKeyframes.length > 0) {
    const firstSelection = selectionKeyframes[0];
    // Selection needs both position AND size animation
    // Since selections can have different widths, we animate both transform and width
    const keyTimes: string[] = [];
    const translateValues: string[] = [];
    const widthValues: string[] = [];
    const visibilityValues: string[] = [];
    const visibilityTimes: string[] = [];

    // Find first and last frame with selection
    const firstSelFrame = selectionKeyframes[0].frameIndex;
    const lastSelFrame = selectionKeyframes[selectionKeyframes.length - 1].frameIndex;

    // Build keyframes for simple loop style
    if (loopStyle === 'loop') {
      // Add visibility: hidden before first selection appears
      if (firstSelFrame > 0) {
        visibilityTimes.push('0');
        visibilityValues.push('hidden');
        const appearTime = animationFrames[firstSelFrame].timestamp / animationDurationMs;
        visibilityTimes.push(fmtKeyTime(appearTime));
        visibilityValues.push('visible');
      } else {
        visibilityTimes.push('0');
        visibilityValues.push('visible');
      }

      for (let i = 0; i < selectionKeyframes.length; i++) {
        const kf = selectionKeyframes[i];
        const time = animationFrames[kf.frameIndex].timestamp / animationDurationMs;
        keyTimes.push(fmtKeyTime(time));
        translateValues.push(`${kf.x} ${kf.y}`);
        widthValues.push(kf.width.toString());
      }

      // Hold last selection until end
      const lastKf = selectionKeyframes[selectionKeyframes.length - 1];
      if (parseFloat(keyTimes[keyTimes.length - 1]) < 1) {
        keyTimes.push('1');
        translateValues.push(`${lastKf.x} ${lastKf.y}`);
        widthValues.push(lastKf.width.toString());
      }

      // Selection stays visible until end (or add hidden at end for loop reset)
      visibilityTimes.push('1');
      visibilityValues.push('visible');
    }

    const keyTimesStr = keyTimes.join(';');
    const translateValuesStr = translateValues.join(';');
    const widthValuesStr = widthValues.join(';');
    const visTimesStr = visibilityTimes.join(';');
    const visValuesStr = visibilityValues.join(';');
    const initialVisibility = firstSelFrame === 0 ? 'visible' : 'hidden';

    // Use a rect at origin with transform for position, and animate width
    selectionContent = `
  <g class="selection-layer" visibility="${initialVisibility}">
    <g>
      <rect x="0" y="0" width="${firstSelection.width}" height="${firstSelection.height}" fill="${firstSelection.fill}" opacity="0.5">
        <animate attributeName="width" values="${widthValuesStr}" keyTimes="${keyTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/>
      </rect>
      <animateTransform attributeName="transform" type="translate" values="${translateValuesStr}" keyTimes="${keyTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/>
    </g>
    <animate attributeName="visibility" values="${visValuesStr}" keyTimes="${visTimesStr}" dur="${animationDurationS}s" repeatCount="${repeatCount}" calcMode="discrete" fill="freeze"/>
  </g>`;
  }

  // Combine background paths and text content
  const content = [...bgParts, ...textParts].join('\n');
  return { content, cursorContent, selectionContent };
};


//#region Animation Generation

export const createAnimatedSVG = async (
  frames: TerminalFrame[],
  options: AnimationOptions = {}
): Promise<string> => {
  if (frames.length === 0) throw new Error('No frames to animate');

  const loopStyle = options.loopStyle || 'loop';

  const animationFrames = deduplicateFrames(frames);
  const { width: totalWidth, height: totalHeight } = getSVGDimensions(animationFrames[0].svg);
  const bgPadding = extractBackgroundPadding(animationFrames[0].svg);
  const outerBackground = extractOuterBackground(animationFrames[0].svg);
  const gradientDef = extractGradientDefs(animationFrames[0].svg);

  // Calculate terminal window dimensions (without background padding)
  const width = totalWidth - bgPadding * 2;
  const height = totalHeight - bgPadding * 2;

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

  let frameAnimations: string[] = [];
  let optimizedCursor = '';
  let optimizedSelection = '';

  // Try optimized delta encoding for loop style (significant size reduction)
  // Fall back to frame-based approach for reverse/rewind/fade which have more complex timing
  const useOptimized = loopStyle === 'loop' && animationFrames.length > 1;

  if (useOptimized) {
    const { content, cursorContent, selectionContent } = generateOptimizedFrameContent(
      animationFrames,
      animationDurationMs,
      animationDurationS,
      repeatCount,
      loopStyle,
      forwardDuration,
      lastFrameTimestamp,
      rewindSpeed,
      loopPause,
    );
    frameAnimations = [content];
    optimizedCursor = cursorContent;
    optimizedSelection = selectionContent;
  } else if (loopStyle === 'reverse' || loopStyle === 'rewind') {
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
  if (gradientDef) {
    defsContent.push(gradientDef);
  }
  if (borderRadius > 0) {
    // clipPath rect at (0,0) because it's applied AFTER the translate transform
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

  // Build outer background rect if present
  const outerBgRx = outerBackground?.borderRadius ? ` rx="${outerBackground.borderRadius}" ry="${outerBackground.borderRadius}"` : '';
  const outerBgRect = outerBackground
    ? `<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="${outerBackground.fill}"${outerBgRx}/>`
    : '';

  // Wrap terminal content in translate group if there's background padding
  const translateStart = bgPadding > 0 ? `<g transform="translate(${bgPadding}, ${bgPadding})">` : '';
  const translateEnd = bgPadding > 0 ? '</g>' : '';

  return `<svg width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
  ${clipPathDef}
  <style>
    ${baseStyles}
  </style>

  ${outerBgRect}
  ${translateStart}
  ${clipStart}
  <!-- Static background (never animated) -->
  <rect width="${width}" height="${height}" fill="${bgColor}"${bgRx} />

  <!-- Static chrome (title bar) -->
  ${chromeSection}

  <!-- Animated frames (only dynamic content) -->
  ${frameAnimations.join('\n')}
  ${optimizedSelection}
  ${optimizedCursor}

  <!-- Static footer -->
  ${footerSection}
  ${watermark}
  ${clipEnd}
  ${translateEnd}
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

