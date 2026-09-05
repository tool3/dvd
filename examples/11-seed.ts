/**
 * Seeded terminal: pre-fill the screen with context that was never typed,
 * then record only the part that matters.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/11-seed.ts
 */

import { writeFileSync } from 'node:fs';
import dvd from '../src';

(async () => {
  const result = await dvd(`
    Type "npm run deploy"
    Sleep 400ms
    Enter
    Sleep 1200ms
  `, {
    seed: [
      '\x1b[95m❯\x1b[0m git commit -m "fix: seed the terminal"',
      '\x1b[2m[master 6ec6b89] fix: seed the terminal\x1b[0m',
      '\x1b[2m 3 files changed, 41 insertions(+)\x1b[0m',
      '',
      '\x1b[95m❯\x1b[0m npm test',
      '\x1b[32m  ✓\x1b[0m 56 passing \x1b[2m(1.7s)\x1b[0m',
      '',
    ],
    theme: 'catppuccinMocha',
    template: 'macos',
    title: 'seeded session',
    fontSize: 15,
  });

  writeFileSync('examples/svgs/seed.svg', result.svg);
  console.log(`seed.svg — ${result.metadata.frameCount} frames`);
})();
