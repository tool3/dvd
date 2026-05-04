export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

// CSS shorthand: 1 → all; 2 → v,h; 3 → t,h,b; 4 → t,r,b,l
export const normalizePadding = (value: number | string | undefined): Padding => {
  if (value === undefined || value === null) return ZERO_PADDING;
  if (typeof value === 'number') {
    return { top: value, right: value, bottom: value, left: value };
  }
  const parts = value.trim().split(/\s+/).map((p) => {
    const n = parseFloat(p);
    return Number.isFinite(n) ? n : 0;
  });
  switch (parts.length) {
    case 1: return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
    case 2: return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
    case 3: return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
    default: return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
};

export const paddingHasAny = (p: Padding): boolean =>
  p.top > 0 || p.right > 0 || p.bottom > 0 || p.left > 0;
