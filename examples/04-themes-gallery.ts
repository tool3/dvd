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
  Type "echo -e '\\x1b[2m$\\x1b[0m git log --oneline -3'"
  Sleep 200ms
  Enter
  Sleep 400ms
  Type "echo -e '\\x1b[33mddabf1d\\x1b[0m \\x1b[1m1.0.5\\x1b[0m \\x1b[2m(2 days ago)\\x1b[0m'"
  Enter
  Type "echo -e '\\x1b[33m160a232\\x1b[0m \\x1b[36mdocs\\x1b[0m: license \\x1b[2m(3 days ago)\\x1b[0m'"
  Enter
  Type "echo -e '\\x1b[33m27c843d\\x1b[0m \\x1b[1m1.0.4\\x1b[0m \\x1b[2m(4 days ago)\\x1b[0m'"
  Enter
  Sleep 1200ms
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
