//#region Gradient Parser

import type { Gradient } from '../types';

/**
 * Parse a gradient string like "gradient(red, blue)" or "gradient(red, blue:vertical)"
 * Returns a Gradient object or the original string if not a gradient.
 */
export const parseGradient = (value: string): Gradient | string => {
  if (!value.startsWith('gradient(')) {
    return value;
  }

  const match = value.match(/^gradient\(([^)]+)\)$/);
  if (!match) {
    return value;
  }

  const content = match[1];
  const parts = content.split(':');
  const colorsPart = parts[0];
  const options = parts.slice(1);

  const colors = colorsPart.split(',').map(c => c.trim()).filter(c => c.length > 0);

  if (colors.length === 0) {
    return value;
  }

  const gradient: Gradient = {
    type: 'gradient',
    colors
  };

  for (const opt of options) {
    const trimmed = opt.trim().toLowerCase();
    if (trimmed === 'horizontal' || trimmed === 'vertical') {
      gradient.direction = trimmed;
    }
  }

  return gradient;
};

/**
 * Check if a value is a Gradient object.
 */
export const isGradient = (value: unknown): value is Gradient => {
  return typeof value === 'object' && value !== null && (value as Gradient).type === 'gradient';
};
