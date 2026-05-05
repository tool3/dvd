/**
 * Loop styles: each animation can restart, reverse, rewind, or fade.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/05-loop-styles.ts
 */

import { writeFileSync } from 'node:fs';
import dvd, { type DVDOptions } from '../src';

const SCRIPT = `
  Type "echo -e '\\x1b[2m$\\x1b[0m deploy'"
  Sleep 200ms
  Enter
  Sleep 300ms
  Type "echo -e '\\x1b[36m→\\x1b[0m building     \\x1b[32mok\\x1b[0m'"
  Enter
  Sleep 200ms
  Type "echo -e '\\x1b[36m→\\x1b[0m testing      \\x1b[32mok\\x1b[0m'"
  Enter
  Sleep 200ms
  Type "echo -e '\\x1b[36m→\\x1b[0m publishing   \\x1b[32mok\\x1b[0m'"
  Enter
  Sleep 800ms
`;

const STYLES: { name: string; opts: DVDOptions }[] = [
  { name: 'loop',    opts: { loopStyle: 'loop',    loopPause: 600 } },
  { name: 'reverse', opts: { loopStyle: 'reverse', loopPause: 400 } },
  { name: 'rewind',  opts: { loopStyle: 'rewind',  rewindSpeed: 6 } },
  { name: 'fade',    opts: { loopStyle: 'fade',    fadeDuration: 1200 } },
];

(async () => {
  for (const { name, opts } of STYLES) {
    const result = await dvd(SCRIPT, {
      theme: 'draculaPro',
      template: 'macos',
      title: `loopStyle: ${name}`,
      ...opts,
    });
    writeFileSync(`examples/svgs/loop-styles/${name}.svg`, result.svg);
    console.log(`loop-styles/${name}.svg`);
  }
})();
