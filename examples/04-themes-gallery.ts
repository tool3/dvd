/**
 * Theme gallery: render the same script against a curated set of built-in
 * themes. Useful when you need to pick a theme for branding.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/04-themes-gallery.ts
 */

import { writeFileSync } from 'node:fs';
import dvd from '../src';

const SCRIPT = `
  Type "git log --oneline -3"
  Sleep 300ms
  Enter
  Sleep 400ms
  Type "ddabf1d \\x1b[33m1.0.5\\x1b[0m"
  Enter
  Type "160a232 \\x1b[36mdocs\\x1b[0m: license"
  Enter
  Type "27c843d \\x1b[33m1.0.4\\x1b[0m"
  Enter
  Sleep 1000ms
`;

const THEMES = [
  'dracula',
  'tokyoNight',
  'catppuccinMocha',
  'nord',
  'gruvboxDark',
  'monokai',
  'oneDark',
  'synthwave84',
] as const;

(async () => {
  for (const theme of THEMES) {
    const result = await dvd(SCRIPT, {
      theme,
      template: 'macos',
      title: theme,
    });
    writeFileSync(`examples/svgs/themes/${theme}.svg`, result.svg);
    console.log(`themes/${theme}.svg`);
  }
})();
