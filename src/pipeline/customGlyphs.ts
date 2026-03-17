//#region Types

export interface GlyphContext {
  cellWidth: number;
  cellHeight: number;
  x: number;
  y: number;
  color: string;
  backgroundColor: string;
  lineWidth: number;
  heavyLineWidth: number;
}

// Round to 2 decimal places to avoid floating-point imprecision in SVG output
const r = (n: number): number => Math.round(n * 100) / 100;

export interface GlyphResult {
  svg: string;
  handled: boolean;
}

interface BoxSegments {
  up: number;
  down: number;
  left: number;
  right: number;
}


//#region Color Blending

const parseColor = (color: string): [number, number, number] => {
  // Handle hex colors (#RGB, #RRGGBB)
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  // Handle rgb(r, g, b) format
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }
  // Default to black if parsing fails
  return [0, 0, 0];
};

const blendColors = (fg: string, bg: string, opacity: number): string => {
  const [fgR, fgG, fgB] = parseColor(fg);
  const [bgR, bgG, bgB] = parseColor(bg);
  const r = Math.round(fgR * opacity + bgR * (1 - opacity));
  const g = Math.round(fgG * opacity + bgG * (1 - opacity));
  const b = Math.round(fgB * opacity + bgB * (1 - opacity));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};


//#region Detection

export const isCustomGlyph = (codePoint: number): boolean =>
  (codePoint >= 0x2500 && codePoint <= 0x257f) ||
  (codePoint >= 0x2580 && codePoint <= 0x259f) ||
  codePoint === 0x25a0 ||
  (codePoint >= 0x2800 && codePoint <= 0x28ff) ||
  (codePoint >= 0x1fb00 && codePoint <= 0x1fbff);

export const containsCustomGlyphs = (text: string): boolean => {
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && isCustomGlyph(codePoint)) return true;
  }
  return false;
};


//#region Main Renderer

export const renderCustomGlyph = (char: string, ctx: GlyphContext): GlyphResult => {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return { svg: '', handled: false };

  if (codePoint >= 0x2500 && codePoint <= 0x257f) return renderBoxDrawing(codePoint, ctx);
  if (codePoint >= 0x2580 && codePoint <= 0x259f) return renderBlockElement(codePoint, ctx);

  // Black Square (U+25A0) - cell-width square, vertically centered
  if (codePoint === 0x25a0) {
    const { cellWidth, cellHeight, x, y, color } = ctx;
    const size = cellWidth;
    const squareY = y + (cellHeight - size) / 2;
    return {
      svg: `<rect x="${x}" y="${squareY}" width="${size}" height="${size}" fill="${color}" shape-rendering="crispEdges"/>`,
      handled: true,
    };
  }

  if (codePoint >= 0x2800 && codePoint <= 0x28ff) return renderBraille(codePoint, ctx);
  if (codePoint >= 0x1fb00 && codePoint <= 0x1fbff) return renderLegacyComputing(codePoint, ctx);

  return { svg: '', handled: false };
};


//#region Box Drawing (U+2500-U+257F)

// Segment types: 0=none, 1=light, 2=heavy, 3=double
const BOX_MAP: { [key: number]: [number, number, number, number] } = {
  0x2500: [0, 0, 1, 1], 0x2501: [0, 0, 2, 2], 0x2502: [1, 1, 0, 0], 0x2503: [2, 2, 0, 0],
  0x2504: [0, 0, 1, 1], 0x2505: [0, 0, 2, 2], 0x2506: [1, 1, 0, 0], 0x2507: [2, 2, 0, 0],
  0x2508: [0, 0, 1, 1], 0x2509: [0, 0, 2, 2], 0x250a: [1, 1, 0, 0], 0x250b: [2, 2, 0, 0],
  0x250c: [0, 1, 0, 1], 0x250d: [0, 1, 0, 2], 0x250e: [0, 2, 0, 1], 0x250f: [0, 2, 0, 2],
  0x2510: [0, 1, 1, 0], 0x2511: [0, 1, 2, 0], 0x2512: [0, 2, 1, 0], 0x2513: [0, 2, 2, 0],
  0x2514: [1, 0, 0, 1], 0x2515: [1, 0, 0, 2], 0x2516: [2, 0, 0, 1], 0x2517: [2, 0, 0, 2],
  0x2518: [1, 0, 1, 0], 0x2519: [1, 0, 2, 0], 0x251a: [2, 0, 1, 0], 0x251b: [2, 0, 2, 0],
  0x251c: [1, 1, 0, 1], 0x251d: [1, 1, 0, 2], 0x251e: [2, 1, 0, 1], 0x251f: [1, 2, 0, 1],
  0x2520: [2, 2, 0, 1], 0x2521: [2, 1, 0, 2], 0x2522: [1, 2, 0, 2], 0x2523: [2, 2, 0, 2],
  0x2524: [1, 1, 1, 0], 0x2525: [1, 1, 2, 0], 0x2526: [2, 1, 1, 0], 0x2527: [1, 2, 1, 0],
  0x2528: [2, 2, 1, 0], 0x2529: [2, 1, 2, 0], 0x252a: [1, 2, 2, 0], 0x252b: [2, 2, 2, 0],
  0x252c: [0, 1, 1, 1], 0x252d: [0, 1, 2, 1], 0x252e: [0, 1, 1, 2], 0x252f: [0, 1, 2, 2],
  0x2530: [0, 2, 1, 1], 0x2531: [0, 2, 2, 1], 0x2532: [0, 2, 1, 2], 0x2533: [0, 2, 2, 2],
  0x2534: [1, 0, 1, 1], 0x2535: [1, 0, 2, 1], 0x2536: [1, 0, 1, 2], 0x2537: [1, 0, 2, 2],
  0x2538: [2, 0, 1, 1], 0x2539: [2, 0, 2, 1], 0x253a: [2, 0, 1, 2], 0x253b: [2, 0, 2, 2],
  0x253c: [1, 1, 1, 1], 0x253d: [1, 1, 2, 1], 0x253e: [1, 1, 1, 2], 0x253f: [1, 1, 2, 2],
  0x2540: [2, 1, 1, 1], 0x2541: [1, 2, 1, 1], 0x2542: [2, 2, 1, 1], 0x2543: [2, 1, 2, 1],
  0x2544: [2, 1, 1, 2], 0x2545: [1, 2, 2, 1], 0x2546: [1, 2, 1, 2], 0x2547: [2, 1, 2, 2],
  0x2548: [1, 2, 2, 2], 0x2549: [2, 2, 2, 1], 0x254a: [2, 2, 1, 2], 0x254b: [2, 2, 2, 2],
  0x254c: [0, 0, 1, 1], 0x254d: [0, 0, 2, 2], 0x254e: [1, 1, 0, 0], 0x254f: [2, 2, 0, 0],
  0x2550: [0, 0, 3, 3], 0x2551: [3, 3, 0, 0], 0x2552: [0, 1, 0, 3], 0x2553: [0, 3, 0, 1],
  0x2554: [0, 3, 0, 3], 0x2555: [0, 1, 3, 0], 0x2556: [0, 3, 1, 0], 0x2557: [0, 3, 3, 0],
  0x2558: [1, 0, 0, 3], 0x2559: [3, 0, 0, 1], 0x255a: [3, 0, 0, 3], 0x255b: [1, 0, 3, 0],
  0x255c: [3, 0, 1, 0], 0x255d: [3, 0, 3, 0], 0x255e: [1, 1, 0, 3], 0x255f: [3, 3, 0, 1],
  0x2560: [3, 3, 0, 3], 0x2561: [1, 1, 3, 0], 0x2562: [3, 3, 1, 0], 0x2563: [3, 3, 3, 0],
  0x2564: [0, 1, 3, 3], 0x2565: [0, 3, 1, 1], 0x2566: [0, 3, 3, 3], 0x2567: [1, 0, 3, 3],
  0x2568: [3, 0, 1, 1], 0x2569: [3, 0, 3, 3], 0x256a: [1, 1, 3, 3], 0x256b: [3, 3, 1, 1],
  0x256c: [3, 3, 3, 3], 0x256d: [0, 1, 0, 1], 0x256e: [0, 1, 1, 0], 0x256f: [1, 0, 1, 0],
  0x2570: [1, 0, 0, 1], 0x2574: [0, 0, 1, 0], 0x2575: [1, 0, 0, 0], 0x2576: [0, 0, 0, 1],
  0x2577: [0, 1, 0, 0], 0x2578: [0, 0, 2, 0], 0x2579: [2, 0, 0, 0], 0x257a: [0, 0, 0, 2],
  0x257b: [0, 2, 0, 0], 0x257c: [0, 0, 1, 2], 0x257d: [1, 2, 0, 0], 0x257e: [0, 0, 2, 1],
  0x257f: [2, 1, 0, 0],
};

const getBoxSegments = (codePoint: number): BoxSegments | null => {
  const segments = BOX_MAP[codePoint];
  if (!segments) return null;
  return { up: segments[0], down: segments[1], left: segments[2], right: segments[3] };
};

const renderBoxDrawing = (codePoint: number, ctx: GlyphContext): GlyphResult => {
  if (codePoint >= 0x2571 && codePoint <= 0x2573) return renderDiagonalLine(codePoint, ctx);

  const segments = getBoxSegments(codePoint);
  if (!segments) return { svg: '', handled: false };

  const { cellWidth, cellHeight, x, y, color, lineWidth, heavyLineWidth } = ctx;
  const centerX = r(x + cellWidth / 2);
  const centerY = r(y + cellHeight / 2);
  const cellBottom = r(y + cellHeight);
  const cellRight = r(x + cellWidth);

  const getWidth = (type: number): number =>
    type === 0 ? 0 : type === 1 ? lineWidth : type === 2 ? heavyLineWidth : lineWidth;

  const doubleOffset = r(lineWidth * 1.5);
  const hasDoubleUp = segments.up === 3;
  const hasDoubleDown = segments.down === 3;
  const hasDoubleLeft = segments.left === 3;
  const hasDoubleRight = segments.right === 3;

  if ((hasDoubleUp || hasDoubleDown) && (hasDoubleLeft || hasDoubleRight)) {
    return renderDoubleLineCorner(segments, ctx, doubleOffset);
  }

  const paths: string[] = [];

  if (segments.up > 0) {
    if (segments.up === 3) {
      paths.push(
        `<line x1="${r(centerX - doubleOffset)}" y1="${r(y)}" x2="${r(centerX - doubleOffset)}" y2="${centerY}" stroke="${color}" stroke-width="${lineWidth}"/>`,
        `<line x1="${r(centerX + doubleOffset)}" y1="${r(y)}" x2="${r(centerX + doubleOffset)}" y2="${centerY}" stroke="${color}" stroke-width="${lineWidth}"/>`
      );
    } else {
      const w = getWidth(segments.up);
      // If there are double horizontal lines, stop the single vertical at the inner edge
      const endY = (hasDoubleLeft || hasDoubleRight) ? r(centerY - doubleOffset) : centerY;
      paths.push(`<line x1="${centerX}" y1="${r(y)}" x2="${centerX}" y2="${endY}" stroke="${color}" stroke-width="${w}"/>`);
    }
  }

  if (segments.down > 0) {
    if (segments.down === 3) {
      paths.push(
        `<line x1="${r(centerX - doubleOffset)}" y1="${centerY}" x2="${r(centerX - doubleOffset)}" y2="${cellBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
        `<line x1="${r(centerX + doubleOffset)}" y1="${centerY}" x2="${r(centerX + doubleOffset)}" y2="${cellBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`
      );
    } else {
      const w = getWidth(segments.down);
      // If there are double horizontal lines, start the single vertical from the inner edge
      const startY = (hasDoubleLeft || hasDoubleRight) ? r(centerY + doubleOffset) : centerY;
      paths.push(`<line x1="${centerX}" y1="${startY}" x2="${centerX}" y2="${cellBottom}" stroke="${color}" stroke-width="${w}"/>`);
    }
  }

  if (segments.left > 0) {
    if (segments.left === 3) {
      paths.push(
        `<line x1="${r(x)}" y1="${r(centerY - doubleOffset)}" x2="${centerX}" y2="${r(centerY - doubleOffset)}" stroke="${color}" stroke-width="${lineWidth}"/>`,
        `<line x1="${r(x)}" y1="${r(centerY + doubleOffset)}" x2="${centerX}" y2="${r(centerY + doubleOffset)}" stroke="${color}" stroke-width="${lineWidth}"/>`
      );
    } else {
      const w = getWidth(segments.left);
      // If there are double vertical lines, stop the single horizontal at the inner edge
      const endX = (hasDoubleUp || hasDoubleDown) ? r(centerX - doubleOffset) : centerX;
      paths.push(`<line x1="${r(x)}" y1="${centerY}" x2="${endX}" y2="${centerY}" stroke="${color}" stroke-width="${w}"/>`);
    }
  }

  if (segments.right > 0) {
    if (segments.right === 3) {
      paths.push(
        `<line x1="${centerX}" y1="${r(centerY - doubleOffset)}" x2="${cellRight}" y2="${r(centerY - doubleOffset)}" stroke="${color}" stroke-width="${lineWidth}"/>`,
        `<line x1="${centerX}" y1="${r(centerY + doubleOffset)}" x2="${cellRight}" y2="${r(centerY + doubleOffset)}" stroke="${color}" stroke-width="${lineWidth}"/>`
      );
    } else {
      const w = getWidth(segments.right);
      // If there are double vertical lines, start the single horizontal from the inner edge
      const startX = (hasDoubleUp || hasDoubleDown) ? r(centerX + doubleOffset) : centerX;
      paths.push(`<line x1="${startX}" y1="${centerY}" x2="${cellRight}" y2="${centerY}" stroke="${color}" stroke-width="${w}"/>`);
    }
  }

  // Wrap in group with crispEdges for pixel-perfect rendering
  return { svg: `<g shape-rendering="crispEdges">${paths.join('')}</g>`, handled: true };
};

const renderDoubleLineCorner = (segments: BoxSegments, ctx: GlyphContext, doubleOffset: number): GlyphResult => {
  const { cellWidth, cellHeight, x, y, color, lineWidth } = ctx;
  const rx = r(x);
  const ry = r(y);
  const rBottom = r(y + cellHeight);
  const rRight = r(x + cellWidth);
  const centerX = r(x + cellWidth / 2);
  const centerY = r(y + cellHeight / 2);
  const paths: string[] = [];

  const hasUp = segments.up === 3;
  const hasDown = segments.down === 3;
  const hasLeft = segments.left === 3;
  const hasRight = segments.right === 3;

  const outerLeft = r(centerX - doubleOffset);
  const outerRight = r(centerX + doubleOffset);
  const outerTop = r(centerY - doubleOffset);
  const outerBottom = r(centerY + doubleOffset);

  // Corner cases - use path elements for proper L-shaped corners
  if (hasUp && hasRight && !hasDown && !hasLeft) {
    // ╚ - bottom-left corner
    paths.push(
      `<path d="M ${outerLeft} ${ry} L ${outerLeft} ${outerBottom} L ${rRight} ${outerBottom}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<path d="M ${outerRight} ${ry} L ${outerRight} ${outerTop} L ${rRight} ${outerTop}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else if (hasDown && hasRight && !hasUp && !hasLeft) {
    // ╔ - top-left corner
    paths.push(
      `<path d="M ${outerLeft} ${rBottom} L ${outerLeft} ${outerTop} L ${rRight} ${outerTop}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<path d="M ${outerRight} ${rBottom} L ${outerRight} ${outerBottom} L ${rRight} ${outerBottom}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else if (hasDown && hasLeft && !hasUp && !hasRight) {
    // ╗ - top-right corner
    paths.push(
      `<path d="M ${outerRight} ${rBottom} L ${outerRight} ${outerTop} L ${rx} ${outerTop}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<path d="M ${outerLeft} ${rBottom} L ${outerLeft} ${outerBottom} L ${rx} ${outerBottom}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else if (hasUp && hasLeft && !hasDown && !hasRight) {
    // ╝ - bottom-right corner
    paths.push(
      `<path d="M ${outerRight} ${ry} L ${outerRight} ${outerBottom} L ${rx} ${outerBottom}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<path d="M ${outerLeft} ${ry} L ${outerLeft} ${outerTop} L ${rx} ${outerTop}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else if (hasUp && hasDown && hasRight && !hasLeft) {
    // ╠ - left T-junction
    paths.push(
      `<line x1="${outerLeft}" y1="${ry}" x2="${outerLeft}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${ry}" x2="${outerRight}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerBottom}" x2="${outerRight}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerTop}" x2="${rRight}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerBottom}" x2="${rRight}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else if (hasUp && hasDown && hasLeft && !hasRight) {
    // ╣ - right T-junction
    paths.push(
      `<line x1="${outerRight}" y1="${ry}" x2="${outerRight}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerLeft}" y1="${ry}" x2="${outerLeft}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerLeft}" y1="${outerBottom}" x2="${outerLeft}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${rx}" y1="${outerTop}" x2="${outerLeft}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${rx}" y1="${outerBottom}" x2="${outerLeft}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else if (hasDown && hasLeft && hasRight && !hasUp) {
    // ╦ - top T-junction
    paths.push(
      `<line x1="${rx}" y1="${outerTop}" x2="${rRight}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${rx}" y1="${outerBottom}" x2="${outerLeft}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerBottom}" x2="${rRight}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerLeft}" y1="${outerBottom}" x2="${outerLeft}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerBottom}" x2="${outerRight}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else if (hasUp && hasLeft && hasRight && !hasDown) {
    // ╩ - bottom T-junction
    paths.push(
      `<line x1="${rx}" y1="${outerBottom}" x2="${rRight}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${rx}" y1="${outerTop}" x2="${outerLeft}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerTop}" x2="${rRight}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerLeft}" y1="${ry}" x2="${outerLeft}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${ry}" x2="${outerRight}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else if (hasUp && hasDown && hasLeft && hasRight) {
    // ╬ - cross
    paths.push(
      `<line x1="${outerLeft}" y1="${ry}" x2="${outerLeft}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerLeft}" y1="${outerBottom}" x2="${outerLeft}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${ry}" x2="${outerRight}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerBottom}" x2="${outerRight}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${rx}" y1="${outerTop}" x2="${outerLeft}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerTop}" x2="${rRight}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${rx}" y1="${outerBottom}" x2="${outerLeft}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
      `<line x1="${outerRight}" y1="${outerBottom}" x2="${rRight}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`
    );
  } else {
    // Fallback for other combinations
    if (hasUp) {
      paths.push(
        `<line x1="${outerLeft}" y1="${ry}" x2="${outerLeft}" y2="${centerY}" stroke="${color}" stroke-width="${lineWidth}"/>`,
        `<line x1="${outerRight}" y1="${ry}" x2="${outerRight}" y2="${centerY}" stroke="${color}" stroke-width="${lineWidth}"/>`
      );
    }
    if (hasDown) {
      paths.push(
        `<line x1="${outerLeft}" y1="${centerY}" x2="${outerLeft}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`,
        `<line x1="${outerRight}" y1="${centerY}" x2="${outerRight}" y2="${rBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`
      );
    }
    if (hasLeft) {
      paths.push(
        `<line x1="${rx}" y1="${outerTop}" x2="${centerX}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
        `<line x1="${rx}" y1="${outerBottom}" x2="${centerX}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`
      );
    }
    if (hasRight) {
      paths.push(
        `<line x1="${centerX}" y1="${outerTop}" x2="${rRight}" y2="${outerTop}" stroke="${color}" stroke-width="${lineWidth}"/>`,
        `<line x1="${centerX}" y1="${outerBottom}" x2="${rRight}" y2="${outerBottom}" stroke="${color}" stroke-width="${lineWidth}"/>`
      );
    }
  }

  // Wrap in group with crispEdges for pixel-perfect rendering
  return { svg: `<g shape-rendering="crispEdges">${paths.join('')}</g>`, handled: true };
};

const renderDiagonalLine = (codePoint: number, ctx: GlyphContext): GlyphResult => {
  const { cellWidth, cellHeight, x, y, color, lineWidth } = ctx;
  const paths: string[] = [];

  if (codePoint === 0x2571 || codePoint === 0x2573) {
    paths.push(`<line x1="${r(x)}" y1="${r(y + cellHeight)}" x2="${r(x + cellWidth)}" y2="${r(y)}" stroke="${color}" stroke-width="${lineWidth}"/>`);
  }
  if (codePoint === 0x2572 || codePoint === 0x2573) {
    paths.push(`<line x1="${r(x)}" y1="${r(y)}" x2="${r(x + cellWidth)}" y2="${r(y + cellHeight)}" stroke="${color}" stroke-width="${lineWidth}"/>`);
  }

  return { svg: paths.join(''), handled: true };
};


//#region Block Elements (U+2580-U+259F)

const renderBlockElement = (codePoint: number, ctx: GlyphContext): GlyphResult => {
  const { cellWidth, cellHeight, x, y, color, backgroundColor } = ctx;
  const crisp = ' shape-rendering="crispEdges"';
  // 1px overlap prevents sub-pixel gaps between adjacent blocks in gradient mode
  const overlap = 1;
  let svg = '';

  switch (codePoint) {
    case 0x2580: svg = `<rect x="${x}" y="${y}" width="${cellWidth + overlap}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`; break;
    case 0x2581: svg = `<rect x="${x}" y="${y + cellHeight * 7 / 8}" width="${cellWidth + overlap}" height="${cellHeight / 8 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2582: svg = `<rect x="${x}" y="${y + cellHeight * 3 / 4}" width="${cellWidth + overlap}" height="${cellHeight / 4 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2583: svg = `<rect x="${x}" y="${y + cellHeight * 5 / 8}" width="${cellWidth + overlap}" height="${cellHeight * 3 / 8 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2584: svg = `<rect x="${x}" y="${y + cellHeight / 2}" width="${cellWidth + overlap}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2585: svg = `<rect x="${x}" y="${y + cellHeight * 3 / 8}" width="${cellWidth + overlap}" height="${cellHeight * 5 / 8 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2586: svg = `<rect x="${x}" y="${y + cellHeight / 4}" width="${cellWidth + overlap}" height="${cellHeight * 3 / 4 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2587: svg = `<rect x="${x}" y="${y + cellHeight / 8}" width="${cellWidth + overlap}" height="${cellHeight * 7 / 8 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2588: svg = `<rect x="${x}" y="${y}" width="${cellWidth + overlap}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2589: svg = `<rect x="${x}" y="${y}" width="${cellWidth * 7 / 8}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x258a: svg = `<rect x="${x}" y="${y}" width="${cellWidth * 3 / 4}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x258b: svg = `<rect x="${x}" y="${y}" width="${cellWidth * 5 / 8}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x258c: svg = `<rect x="${x}" y="${y}" width="${cellWidth / 2}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x258d: svg = `<rect x="${x}" y="${y}" width="${cellWidth * 3 / 8}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x258e: svg = `<rect x="${x}" y="${y}" width="${cellWidth / 4}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x258f: svg = `<rect x="${x}" y="${y}" width="${cellWidth / 8}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2590: svg = `<rect x="${x + cellWidth / 2}" y="${y}" width="${cellWidth / 2 + overlap}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    // Shade characters - pre-blend to avoid subpixel seams on high-DPI displays
    case 0x2591: svg = `<rect x="${x}" y="${y}" width="${cellWidth + overlap}" height="${cellHeight + overlap}" fill="${blendColors(color, backgroundColor, 0.25)}"${crisp}/>`; break;
    case 0x2592: svg = `<rect x="${x}" y="${y}" width="${cellWidth + overlap}" height="${cellHeight + overlap}" fill="${blendColors(color, backgroundColor, 0.5)}"${crisp}/>`; break;
    case 0x2593: svg = `<rect x="${x}" y="${y}" width="${cellWidth + overlap}" height="${cellHeight + overlap}" fill="${blendColors(color, backgroundColor, 0.75)}"${crisp}/>`; break;
    case 0x2594: svg = `<rect x="${x}" y="${y}" width="${cellWidth + overlap}" height="${cellHeight / 8}" fill="${color}"${crisp}/>`; break;
    case 0x2595: svg = `<rect x="${x + cellWidth * 7 / 8}" y="${y}" width="${cellWidth / 8 + overlap}" height="${cellHeight + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2596: svg = `<rect x="${x}" y="${y + cellHeight / 2}" width="${cellWidth / 2}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2597: svg = `<rect x="${x + cellWidth / 2}" y="${y + cellHeight / 2}" width="${cellWidth / 2 + overlap}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`; break;
    case 0x2598: svg = `<rect x="${x}" y="${y}" width="${cellWidth / 2}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`; break;
    case 0x2599: svg = [
      `<rect x="${x}" y="${y}" width="${cellWidth / 2}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`,
      `<rect x="${x}" y="${y + cellHeight / 2}" width="${cellWidth + overlap}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`,
    ].join(''); break;
    case 0x259a: svg = [
      `<rect x="${x}" y="${y}" width="${cellWidth / 2}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`,
      `<rect x="${x + cellWidth / 2}" y="${y + cellHeight / 2}" width="${cellWidth / 2 + overlap}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`,
    ].join(''); break;
    case 0x259b: svg = [
      `<rect x="${x}" y="${y}" width="${cellWidth + overlap}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`,
      `<rect x="${x}" y="${y + cellHeight / 2}" width="${cellWidth / 2}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`,
    ].join(''); break;
    case 0x259c: svg = [
      `<rect x="${x}" y="${y}" width="${cellWidth + overlap}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`,
      `<rect x="${x + cellWidth / 2}" y="${y + cellHeight / 2}" width="${cellWidth / 2 + overlap}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`,
    ].join(''); break;
    case 0x259d: svg = `<rect x="${x + cellWidth / 2}" y="${y}" width="${cellWidth / 2 + overlap}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`; break;
    case 0x259e: svg = [
      `<rect x="${x + cellWidth / 2}" y="${y}" width="${cellWidth / 2 + overlap}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`,
      `<rect x="${x}" y="${y + cellHeight / 2}" width="${cellWidth / 2}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`,
    ].join(''); break;
    case 0x259f: svg = [
      `<rect x="${x + cellWidth / 2}" y="${y}" width="${cellWidth / 2 + overlap}" height="${cellHeight / 2}" fill="${color}"${crisp}/>`,
      `<rect x="${x}" y="${y + cellHeight / 2}" width="${cellWidth + overlap}" height="${cellHeight / 2 + overlap}" fill="${color}"${crisp}/>`,
    ].join(''); break;
    default: return { svg: '', handled: false };
  }

  return { svg, handled: true };
};


//#region Braille Patterns (U+2800-U+28FF)

const renderBraille = (codePoint: number, ctx: GlyphContext): GlyphResult => {
  const { cellWidth, cellHeight, x, y, color } = ctx;
  const pattern = codePoint - 0x2800;
  const dotRadius = Math.min(cellWidth, cellHeight) * 0.1;

  const leftX = x + cellWidth * 0.3;
  const rightX = x + cellWidth * 0.7;
  const rows = [y + cellHeight * 0.15, y + cellHeight * 0.35, y + cellHeight * 0.55, y + cellHeight * 0.85];

  const dots: string[] = [];
  const dotPositions: [number, number][] = [
    [leftX, rows[0]], [leftX, rows[1]], [leftX, rows[2]],
    [rightX, rows[0]], [rightX, rows[1]], [rightX, rows[2]],
    [leftX, rows[3]], [rightX, rows[3]],
  ];

  for (let i = 0; i < 8; i++) {
    if (pattern & (1 << i)) {
      const [dx, dy] = dotPositions[i];
      dots.push(`<circle cx="${dx}" cy="${dy}" r="${dotRadius}" fill="${color}"/>`);
    }
  }

  return { svg: dots.join(''), handled: true };
};


//#region Legacy Computing (U+1FB00-U+1FBFF)

const renderLegacyComputing = (codePoint: number, ctx: GlyphContext): GlyphResult => {
  const { cellWidth, cellHeight, x, y, color } = ctx;

  // Sextant characters (2x3 grid)
  if (codePoint >= 0x1fb00 && codePoint <= 0x1fb3b) {
    const sw = cellWidth / 2;
    const sh = cellHeight / 3;
    const offset = codePoint - 0x1fb00;

    const positions: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]];
    const rects: string[] = [];
    let bits = offset + 1;
    if (bits >= 63) bits++;

    for (let i = 0; i < 6; i++) {
      if (bits & (1 << i)) {
        const [col, row] = positions[i];
        rects.push(`<rect x="${x + col * sw}" y="${y + row * sh}" width="${sw}" height="${sh}" fill="${color}"/>`);
      }
    }

    return { svg: rects.join(''), handled: true };
  }

  // Fallback for other legacy computing characters
  return {
    svg: `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${color}" fill-opacity="0.5"/>`,
    handled: true,
  };
};

