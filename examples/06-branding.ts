/**
 * Branded output: gradient background, watermark, custom border — for
 * docs sites and marketing pages where the SVG is the hero asset.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/06-branding.ts
 */

import { writeFileSync } from 'node:fs';
import dvd from '../src';

(async () => {
  const result = await dvd(`
    Type "echo -e '\\x1b[1;35m  dvdrw\\x1b[0m \\x1b[2m·\\x1b[0m animated svg terminal recordings'"
    Sleep 300ms
    Enter
    Sleep 200ms
    Type "echo -e '  \\x1b[2m──────────────────────────────────\\x1b[0m'"
    Enter
    Type "echo -e '  \\x1b[32m●\\x1b[0m programmatic api'"
    Enter
    Type "echo -e '  \\x1b[32m●\\x1b[0m raw stdout capture'"
    Enter
    Type "echo -e '  \\x1b[32m●\\x1b[0m no ffmpeg, no browser'"
    Enter
    Sleep 1500ms
  `, {
    theme: 'tokyoNight',
    template: 'macos',
    title: 'dvdrw',
    background: 'gradient(#7c5fff, #ff6ec7:diagonal)',
    backgroundPadding: 48,
    borderRadius: 12,
    fontSize: 15,
    watermark: 'made with dvd',
  });

  writeFileSync('examples/svgs/branding.svg', result.svg);
  console.log(`branding.svg — ${result.metadata.frameCount} frames`);
})();
