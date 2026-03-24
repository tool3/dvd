import { writeFileSync } from 'node:fs';
import { dvd } from '../src';


(async () => {
  const result = await dvd({
    cdScript: `
    Type "node -p \"console.log('\\x1b[32mHello world!\\x1b[0m')\" "
    Enter
    Sleep 500ms
  `,
    theme: 'dracula',
    template: 'macos',
  });

  writeFileSync(`examples/svgs/result.svg`, result.svg)
})()
