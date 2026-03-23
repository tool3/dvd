//#region Number Formatting

const roundNumber = (num: string): string => {
  const n = parseFloat(num);
  if (Number.isInteger(n)) return n.toString();
  return parseFloat(n.toFixed(2)).toString();
};

const fmtNum = (n: number): string => {
  if (Number.isInteger(n)) return n.toString();
  return parseFloat(n.toFixed(1)).toString();
};


//#region Rect to Path Conversion

const rectToPath = (rect: string): string => {
  const x = parseFloat(rect.match(/x="([^"]+)"/)?.[1] || '0');
  const y = parseFloat(rect.match(/y="([^"]+)"/)?.[1] || '0');
  const w = parseFloat(rect.match(/width="([^"]+)"/)?.[1] || '0');
  const h = parseFloat(rect.match(/height="([^"]+)"/)?.[1] || '0');

  if (rect.includes('width="100%"') || rect.includes('rx="') || rect.includes('ry="')) {
    return rect;
  }

  const fill = rect.match(/fill="([^"]+)"/)?.[0] || '';
  const fillOpacity = rect.match(/fill-opacity="([^"]+)"/)?.[0] || '';
  const opacity = rect.match(/opacity="([^"]+)"/)?.[0] || '';
  const cls = rect.match(/class="([^"]+)"/)?.[0] || '';
  const shapeRendering = rect.match(/shape-rendering="([^"]+)"/)?.[0] || '';

  const d = `M${fmtNum(x)} ${fmtNum(y)}h${fmtNum(w)}v${fmtNum(h)}H${fmtNum(x)}z`;

  const attrs = [fill, fillOpacity, opacity, cls, shapeRendering].filter(Boolean).join(' ');
  return `<path d="${d}" ${attrs}/>`;
};


//#region SVG Optimizer

export const optimizeSvg = (svg: string): string => {
  let result = svg;

  // Remove XML comments
  result = result.replace(/<!--[\s\S]*?-->/g, '');

  // Convert rects to paths
  result = result.replace(/<rect\s+([^>]*?)\s*\/>/g, (match) => {
    return rectToPath(match);
  });

  // Reduce numeric precision in attributes
  result = result.replace(/(\s(?:x|y|width|height|rx|ry|cx|cy|r|x1|x2|y1|y2)=")(\d+\.\d+)(")/g,
    (_, pre, num, post) => pre + roundNumber(num) + post
  );

  // Reduce precision in fill-opacity
  result = result.replace(/(fill-opacity=")(\d+\.\d+)(")/g,
    (_, pre, num, post) => pre + roundNumber(num) + post
  );

  // Reduce precision in keyTimes
  result = result.replace(/(keyTimes=")([^"]+)(")/g, (_, pre, times, post) => {
    const optimized = times.split(';').map((t: string) => {
      const n = parseFloat(t);
      if (n === 0) return '0';
      if (n === 1) return '1';
      return parseFloat(n.toFixed(4)).toString();
    }).join(';');
    return pre + optimized + post;
  });

  // Reduce precision in dur
  result = result.replace(/(dur=")(\d+\.\d+)(s")/g,
    (_, pre, num, post) => pre + roundNumber(num) + post
  );

  // Shorten hex colors in color attributes only (not in text content)
  result = result.replace(/((?:fill|stroke|color|stop-color)=")#([0-9a-fA-F])\2([0-9a-fA-F])\3([0-9a-fA-F])\4(")/g, '$1#$2$3$4$5');

  // Remove empty class attributes
  result = result.replace(/\s+class=""/g, '');

  // Don't remove visibility="visible" — SMIL <animate attributeName="visibility">
  // needs the initial visibility attribute to be present for correct animation.

  // Remove shape-rendering="auto"
  result = result.replace(/\s+shape-rendering="auto"/g, '');

  // Remove fill-opacity="1"
  result = result.replace(/\s+fill-opacity="1"/g, '');

  // Remove opacity="1"
  result = result.replace(/\s+opacity="1"/g, '');

  // Remove unnecessary whitespace between tags, but preserve text content
  // Only remove whitespace between closing > and opening < (not </text> content)
  // This preserves spaces that are part of text element content
  result = result.replace(/>(\s+)<([a-zA-Z])/g, '><$2');

  // Collapse multiple spaces/newlines
  result = result.replace(/\n\s*\n/g, '\n');

  return result;
};

