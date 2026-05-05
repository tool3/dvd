/**
 * Programmatic steps: build an animation from a typed array of commands —
 * no .cd file, no parsing. Useful for building animations from runtime data
 * (test results, logs, generated content).
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/02-programmatic-steps.ts
 */

import { writeFileSync } from 'node:fs';
import dvd from '../src';

(async () => {
  const tests = [
    { name: 'parser/cd-parser',      ms: 12 },
    { name: 'pipeline/vterminal',    ms: 47 },
    { name: 'pipeline/coalescer',    ms: 8  },
    { name: 'animator/svg-animator', ms: 34 },
  ];

  const steps: Parameters<typeof dvd>[0] = [
    { type: 'Type', text: 'echo -e "\\x1b[2m$\\x1b[0m npm test"' },
    { type: 'Key', key: 'Enter' },
    { type: 'Sleep', duration: 600 },
  ];

  for (const t of tests) {
    // steps.push({
    //   type: 'Type',
    //   // text: `echo -e "\\x1b[32m  ✓\\x1b[0m ${t.name} \\x1b[2m(${t.ms}ms)\\x1b[0m"`,
    //   text: `npm run test`,
    // });
    steps.push({ type: 'Key', key: 'Enter' });
    steps.push({ type: 'Sleep', duration: 200 });
  }

  steps.push({
    type: 'Type',
    text: 'echo -e "\\x1b[1;32m  4 passed\\x1b[0m \\x1b[2m(101ms)\\x1b[0m"',
  });
  steps.push({ type: 'Key', key: 'Enter' });
  steps.push({ type: 'Sleep', duration: 1200 });

  const result = await dvd(steps, {
    theme: 'tokyoNight',
    template: 'macos',
    title: 'test runner',
  });

  writeFileSync('examples/svgs/programmatic-steps.svg', result.svg);
  console.log(`programmatic-steps.svg — ${result.metadata.frameCount} frames`);
})();
