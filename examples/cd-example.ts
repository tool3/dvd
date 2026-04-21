import { writeFileSync } from 'node:fs';
import dvd from '../src';


(async () => {
  const result = await dvd(`
    Type "node -p \"console.log('\\x1b[32mHello world!\\x1b[0m')\" "
    Sleep 500ms
    Enter
    Sleep 500ms
  `, {
    theme: 'pandaSyntax',
    template: 'macos',
  });

  writeFileSync(`examples/svgs/result.svg`, result.svg)
})()
