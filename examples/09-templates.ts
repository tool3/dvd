/**
 * Window templates: macos / windows / minimal chrome.
 *
 * Run:
 *   npx ts-node -P tsconfig.dev.json examples/09-templates.ts
 */

import { writeFileSync } from 'node:fs';
import dvd from '../src';

const SCRIPT = `
  Type "echo 'hello'"
  Sleep 200ms
  Enter
  Sleep 1000ms
`;

(async () => {
  for (const template of ['macos', 'windows', 'minimal'] as const) {
    const result = await dvd(SCRIPT, {
      theme: 'oneDark',
      template,
      title: template,
    });
    writeFileSync(`examples/svgs/templates/${template}.svg`, result.svg);
    console.log(`templates/${template}.svg`);
  }
})();
