/**
 * Quick start: render a cd-script string into an animated SVG.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/01-quick-start.ts
 */

import { writeFileSync } from 'node:fs';
import dvd from '../src';

(async () => {
  const result = await dvd(`
    Type "npm install dvdrw"
    Sleep 400ms
    Enter
    Sleep 800ms
    Type "node -p \\"require('dvdrw').themes.dracula.name\\""
    Sleep 300ms
    Enter
    Sleep 600ms
  `, {
    theme: 'dracula',
    template: 'macos',
    title: 'quick-start',
  });

  writeFileSync('examples/svgs/quick-start.svg', result.svg);
  console.log(`quick-start.svg — ${result.metadata.frameCount} frames, ${result.metadata.duration}ms`);
})();
