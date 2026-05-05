/**
 * Convenience runner: regenerate every SVG used by the README.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/10-render-all.ts
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const here = __dirname;
const files = readdirSync(here)
  .filter((f) => /^\d{2}-/.test(f) && f.endsWith('.ts') && !f.startsWith('10-'))
  .sort();

console.log(`Rendering ${files.length} examples...\n`);

for (const f of files) {
  console.log(`▶ ${f}`);
  const r = spawnSync('npx', ['ts-node', '-P', 'tsconfig.dev.json', join(here, f)], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`  failed: ${f}`);
    process.exit(r.status ?? 1);
  }
  console.log('');
}
console.log('done.');
