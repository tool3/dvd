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
    Type@40ms "import dvd from 'dvdrw' \\"
    Enter
    Sleep 200ms
    Type@40ms "const { svg } = await dvd(steps, {"
    Enter
    Type@40ms "  theme: 'tokyoNight',"
    Enter
    Type@40ms "  background: 'gradient(#7c5fff, #ff6ec7)',"
    Enter
    Type@40ms "})"
    Enter
    Sleep 1200ms
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
