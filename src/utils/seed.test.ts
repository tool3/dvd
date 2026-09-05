import { describe, expect, it } from 'vitest';
import { resolveSeedLines, resolveSeedText } from './seed';
import { processRawOutput } from '../pipeline/raw-output';
import { themes } from '../pipeline';
import type { SpanRow } from '../types';

const plainText = (rows: SpanRow[]): string =>
  rows.map((row) => row.map((span) => span.text).join('')).join('\n');

describe('resolveSeedLines', () => {
  it('is empty for no seed', () => {
    expect(resolveSeedLines(undefined)).toEqual([]);
    expect(resolveSeedLines('')).toEqual([]);
    expect(resolveSeedLines([])).toEqual([]);
  });

  it('splits a string on newlines', () => {
    expect(resolveSeedLines('one\ntwo')).toEqual(['one', 'two']);
  });

  it('ignores a single trailing newline', () => {
    expect(resolveSeedLines('one\n')).toEqual(['one']);
    expect(resolveSeedLines('one\n\n')).toEqual(['one', '']);
  });

  it('passes arrays through, blank lines included', () => {
    expect(resolveSeedLines(['one', '', 'two'])).toEqual(['one', '', 'two']);
  });

  it('joins back to text', () => {
    expect(resolveSeedText(['one', 'two'])).toBe('one\ntwo');
  });
});

describe('processRawOutput seeding', () => {
  const options = { theme: themes.dark, width: 400, height: 300 };

  it('prepends the seed to a single frame', () => {
    const { frameData } = processRawOutput('output', { ...options, seed: 'header' });
    expect(plainText(frameData[0].rows)).toMatch(/^header\noutput/);
  });

  it('prepends the seed to every split frame', () => {
    const { frameData } = processRawOutput('one\x1bctwo\x1bcthree', {
      ...options,
      seed: ['header', '---'],
    });
    expect(frameData).toHaveLength(3);
    for (const frame of frameData) {
      expect(plainText(frame.rows)).toMatch(/^header\n---\n/);
    }
  });

  it('leaves frames untouched without a seed', () => {
    const { frameData } = processRawOutput('output', options);
    expect(plainText(frameData[0].rows)).toMatch(/^output/);
  });
});
