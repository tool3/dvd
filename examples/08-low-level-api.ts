/**
 * Low-level API: skip the executor entirely. Drive the vterminal grid
 * yourself, coalesce into rows, and emit an SVG. Use this when you want
 * to render arbitrary terminal state — not from a script — into a single
 * static SVG (for dashboards, CI annotations, status badges).
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/08-low-level-api.ts
 */

import { writeFileSync } from 'node:fs';
import { coalesce, createGridState, emit, processInput, themes } from '../src';

const banner = [
  '\x1b[1;38;5;213m  dvdrw\x1b[0m \x1b[2m· terminal recordings as svg\x1b[0m',
  '',
  '\x1b[2m  ───────────────────────────────────\x1b[0m',
  '  \x1b[32m●\x1b[0m  no ffmpeg, no browser, no shells',
  '  \x1b[32m●\x1b[0m  scales infinitely (it is xml)',
  '  \x1b[32m●\x1b[0m  drops into any markdown renderer',
  '\x1b[2m  ───────────────────────────────────\x1b[0m',
].join('\r\n');

(async () => {
  const cols = 44;
  const rows = 9;
  const fontSize = 16;
  const theme = themes.draculaPro;

  let state = createGridState(cols, rows);
  state = processInput(state, banner);

  const spans = coalesce(state, theme);

  const { svg } = emit(spans, state.cursor, false, {
    theme,
    template: 'minimal',
    width: Math.round(cols * fontSize * 0.6) + 32,
    height: Math.round(rows * fontSize * 1.4) + 32,
    fontSize,
    lineHeight: fontSize * 1.4,
    charWidth: fontSize * 0.6,
    padding: 16,
    borderRadius: 10,
  });

  writeFileSync('examples/svgs/low-level-api.svg', svg);
  console.log('low-level-api.svg');
})();
