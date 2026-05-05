/**
 * Progress callback: stream rendering progress to your build pipeline.
 * dvd is fully async and reports each step — wire it into a logger,
 * a CI annotation, or a TUI like ora/listr.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/07-progress.ts
 */

import { writeFileSync } from 'node:fs';
import dvd from '../src';

(async () => {
  const result = await dvd(`
    Type "echo render with progress"
    Enter
    Sleep 600ms
  `, {
    theme: 'nord',
    template: 'macos',
    title: 'progress demo',
    onProgress: (current, total, description) => {
      const pct = Math.round((current / total) * 100);
      const bar = '█'.repeat(Math.floor(pct / 5)).padEnd(20, '░');
      process.stdout.write(`\r[${bar}] ${pct}% ${description ?? ''}`.padEnd(80));
    },
  });

  process.stdout.write('\n');
  writeFileSync('examples/svgs/progress.svg', result.svg);
  console.log(`progress.svg — ${result.metadata.frameCount} frames in ${result.metadata.duration}ms`);
})();
