/**
 * Raw ANSI output: feed bytes captured from any command directly to dvd.
 * Animation frames are auto-detected from cursor / terminal-reset / clear-line
 * escape sequences — no scripting needed.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/03-raw-output.ts
 */

import { writeFileSync } from 'node:fs';
import dvd from '../src';

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const buildSpinnerFrames = (label: string, frames: number): string => {
  let out = '';
  for (let i = 0; i < frames; i++) {
    const glyph = SPIN[i % SPIN.length];
    // \r = carriage return, \x1b[2K = clear entire line
    out += `\x1b[2K\r\x1b[36m${glyph}\x1b[0m ${label}`;
  }
  out += `\x1b[2K\r\x1b[32m✓\x1b[0m ${label} — done\n`;
  return out;
};

(async () => {
  const raw = buildSpinnerFrames('compiling sources', 24);

  const result = await dvd(
    { raw, totalDuration: 2400 },
    {
      theme: 'catppuccinMocha',
      template: 'macos',
      title: 'spinner capture',
      pauseAtEnd: 1200,
    },
  );

  writeFileSync('examples/svgs/raw-output.svg', result.svg);
  console.log(`raw-output.svg — ${result.metadata.frameCount} frames`);
})();
