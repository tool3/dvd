# dvd

Create beautiful animated SVGs from terminal recordings. No ffmpeg, no browser, no heavy dependencies — just pure SVG output.

## Install

```bash
npm install dvd
```

## Quick Start

```typescript
import dvd from 'dvd';

const result = await dvd(`
  Type "echo hello world"
  Enter
  Sleep 500ms
`, { theme: 'dracula', template: 'macos' });

// result.svg — animated SVG string ready to write or serve
```

## Usage

The `dvd()` function takes two arguments: **input** and **options**.

```typescript
const result = await dvd(input, options);
```

### Input types

#### CD script string

The most common input — a `.cd` script as a string:

```typescript
import dvd from 'dvd';

const result = await dvd(`
  Type "npm install dvd"
  Enter
  Sleep 2000ms
  Type "echo done!"
  Enter
  Sleep 1000ms
`, {
  theme: 'tokyoNight',
  template: 'macos',
  title: 'Installation',
  fontSize: 16,
});

writeFileSync('install.svg', result.svg);
```

#### Programmatic steps

Build animations in code without .cd files:

```typescript
import dvd from 'dvd';

const result = await dvd([
  { type: 'Type', text: 'npm install dvd' },
  { type: 'Key', key: 'Enter' },
  { type: 'Sleep', duration: 2000 },
  { type: 'Type', text: 'echo "done!"' },
  { type: 'Key', key: 'Enter' },
  { type: 'Sleep', duration: 1000 },
], {
  theme: 'tokyoNight',
  template: 'macos',
});

writeFileSync('install.svg', result.svg);
```

#### Raw terminal output

Feed raw terminal output (with ANSI escape codes) directly. DVD auto-detects animation patterns like cursor resets, terminal resets, and clear-line sequences, splits into frames, and renders:

```typescript
import dvd from 'dvd';

// Output captured from a command like: node spinner.js 2>&1
const rawOutput = '\x1b[2K\x1b[0GLoading...\x1b[2K\x1b[0GLoading......\x1b[2K\x1b[0GDone!';

const result = await dvd({ raw: rawOutput }, {
  theme: 'dracula',
  template: 'macos',
  title: 'Spinner',
});

writeFileSync('spinner.svg', result.svg);
```

If you know how long the original output took, pass `totalDuration` for accurate frame timing:

```typescript
const result = await dvd({ raw: rawOutput, totalDuration: 3000 }, options);
```

#### Pre-parsed script

If you've already parsed a CDScript object:

```typescript
import dvd, { parseCDScript } from 'dvd';

const script = parseCDScript(readFileSync('demo.cd', 'utf-8'));
const result = await dvd({ script }, { theme: 'nord' });
```

### SMIL mode (smooth mobile playback)

The default filmstrip renderer produces smaller files with row deduplication. For buttery smooth 60/120fps playback on mobile Safari/Chrome, use SMIL mode:

```typescript
const result = await dvd(`
  Type "hello"
  Enter
`, { smil: true });
```

### Styling options

```typescript
const result = await dvd(steps, {
  // Window chrome
  theme: 'catppuccinMocha',
  template: 'macos',       // 'macos' | 'windows' | 'minimal'
  title: 'My Terminal',

  // Dimensions
  width: 800,
  height: 400,
  fontSize: 14,
  padding: 16,

  // Borders
  borderRadius: 8,
  borderColor: '#444',

  // Background
  background: 'gradient(#d2a8ff, cyan:horizontal)',
  backgroundPadding: 20,

  // Cursor
  cursorStyle: 'block',     // 'block' | 'bar' | 'underline'
  cursorBlink: true,

  // Watermark
  watermark: 'made with dvd',
});
```

### Animation options

```typescript
const result = await dvd(script, {
  // Loop behavior
  loop: true,
  loopStyle: 'fade',        // 'loop' | 'reverse' | 'rewind' | 'fade'
  pauseAtEnd: 2000,          // ms to hold on last frame
  loopPause: 500,            // ms pause before loop restarts

  // Fade / rewind specific
  fadeDuration: 1500,        // ms for fade transition
  rewindSpeed: 5,            // multiplier for rewind speed

  // Speed
  playbackSpeed: 2,          // 2x playback

  // Output
  optimize: true,            // SVGO optimization (default: true)
  customGlyphs: true,        // render box-drawing as geometric shapes (default: true)
});
```

### Progress tracking

```typescript
const result = await dvd(script, {
  onProgress: (current, total, description) => {
    console.log(`[${current}/${total}] ${description}`);
  },
});
```

### Working with the result

```typescript
const result = await dvd(script);

result.svg;                    // animated SVG string
result.metadata.frameCount;    // number of frames
result.metadata.duration;      // total duration in ms
result.metadata.fps;           // effective fps
result.frames;                 // TerminalFrame[] (pre-rendered SVGs)
result.frameData;              // FrameData[] (raw row data)
```

## Low-Level API

For advanced use cases, the individual building blocks are exported:

### Terminal emulation

```typescript
import { createGridState, processInput, coalesce, themes } from 'dvd';

const grid = createGridState(80, 24);
const processed = processInput(grid, '\x1b[31mHello\x1b[0m World');
const rows = coalesce(processed, themes.dark);
```

### SVG emission

```typescript
import { emit, emitFilmstripAnimated } from 'dvd';

// Single frame
const { svg } = emit(rows, cursor, cursorVisible, options);

// Animated filmstrip
const { svg } = emitFilmstripAnimated(frameDataArray, options);
```

### Raw output processing

```typescript
import { processRawOutput, detectAnimationType, splitIntoFrames, themes } from 'dvd';

// Detect animation pattern
const animationType = detectAnimationType(rawOutput); // 'terminal-reset' | 'cursor-up' | ...

// Split into frame strings
const frameStrings = splitIntoFrames(rawOutput, animationType);

// Or process end-to-end into frame data ready for rendering
const { frameData, width, height } = processRawOutput(rawOutput, {
  theme: themes.dracula,
});
```

### Cast file rendering

```typescript
import { parseCastFile, generateFramesFromRecording, createFilmstripSVG, themes } from 'dvd';

const recording = parseCastFile(castContent);
const frames = generateFramesFromRecording(recording, {
  theme: themes.dracula,
  width: 800,
  height: 400,
  fontSize: 14,
});

const svg = createFilmstripSVG({
  frameData: frames,
  theme: themes.dracula,
  width: 800,
  height: 400,
  fontSize: 14,
}, { loop: true, pauseAtEnd: 1000 });
```

### Executor (script execution)

```typescript
import { CDExecutor, parseCDScript } from 'dvd';

const script = parseCDScript(`
  Type "hello"
  Enter
`);

const executor = new CDExecutor({ theme: 'nord', template: 'minimal' });
const frames = await executor.execute(script);
```

## Available Steps

| Step | Description | Example |
|------|-------------|---------|
| `Type` | Type text with optional speed | `{ type: 'Type', text: 'hello', speed: 100 }` |
| `Key` | Press a key | `{ type: 'Key', key: 'Enter' }` |
| `Sleep` | Pause in ms | `{ type: 'Sleep', duration: 1000 }` |
| `Shortcut` | Key combination | `{ type: 'Shortcut', ctrl: true, key: 'c' }` |
| `Screenshot` | Capture frame to file | `{ type: 'Screenshot', path: 'out.svg' }` |
| `Copy` | Set clipboard | `{ type: 'Copy', text: 'hello' }` |
| `Paste` | Paste clipboard | `{ type: 'Paste' }` |
| `Set` | Change a setting | `{ type: 'Set', setting: 'Theme', value: 'dracula' }` |
| `Env` | Set environment variable | `{ type: 'Env', key: 'NODE_ENV', value: 'prod' }` |

Keys: `Enter`, `Backspace`, `Tab`, `Space`, `Left`, `Right`, `Up`, `Down`

## License

MIT
