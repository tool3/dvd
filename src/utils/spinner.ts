/**
 * Minimal spinner implementation with zero dependencies.
 * Shows a spinning animation while processing.
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL = 80;

export interface Spinner {
  start(): void;
  stop(): void;
  update(text: string): void;
  success(message: string): void;
  fail(message: string): void;
}

export function createSpinner(text: string): Spinner {
  let frameIndex = 0;
  let intervalId: NodeJS.Timeout | null = null;
  let currentText = text;

  const clearLine = (): void => {
    if (process.stdout.isTTY) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    }
  };

  const render = (): void => {
    clearLine();
    const frame = SPINNER_FRAMES[frameIndex];
    let output = `${frame} ${currentText}`;

    // Truncate to terminal width to prevent line wrapping issues
    const cols = process.stdout.columns || 80;
    if (output.length > cols - 1) {
      // Strip ANSI codes for length calculation, then truncate
      const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
      if (stripped.length > cols - 1) {
        // Find where to cut in the original string
        let visibleLen = 0;
        let cutIndex = 0;
        for (let i = 0; i < output.length && visibleLen < cols - 4; i++) {
          if (output[i] === '\x1b') {
            // Skip ANSI sequence
            const match = output.slice(i).match(/^\x1b\[[0-9;]*m/);
            if (match) {
              cutIndex = i + match[0].length;
              i += match[0].length - 1;
              continue;
            }
          }
          visibleLen++;
          cutIndex = i + 1;
        }
        output = output.slice(0, cutIndex) + '...\x1b[0m';
      }
    }

    process.stdout.write(output);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  return {
    start(): void {
      if (!process.stdout.isTTY) {
        // Non-TTY: just print the message once
        console.log(`... ${currentText}`);
        return;
      }
      render();
      intervalId = setInterval(render, FRAME_INTERVAL);
    },

    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      clearLine();
    },

    update(text: string): void {
      currentText = text;
      if (process.stdout.isTTY) {
        render();
      }
    },

    success(message: string): void {
      this.stop();
      console.log(`\x1b[32m✓ ${message}\x1b[0m`);
    },

    fail(message: string): void {
      this.stop();
      console.log(`\x1b[31m✗ ${message}\x1b[0m`);
    },
  };
}
