<p align="center">
  <img src="examples/svgs/low-level-api.svg" alt="dvdrw — animated SVGs from terminal recordings" />
</p>

<p align="center">
  <strong>Generate animated SVG terminal recordings from code.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dvdrw"><img src="https://img.shields.io/npm/v/dvdrw" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dvdrw"><img src="https://img.shields.io/npm/dm/dvdrw" alt="npm downloads"></a>
  <a href="https://github.com/tool3/dvd/blob/master/LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-orange" alt="license"></a>
  <a href="https://github.com/tool3/dvd-cli"><img src="https://img.shields.io/badge/cli-dvd--cli-7c5fff" alt="cli"></a>
</p>

`dvdrw` is the Node library behind [`dvd-cli`](https://github.com/tool3/dvd-cli) — call it from your own code, your build pipeline, or your service. Output is a single self-contained animated SVG. No ffmpeg, no headless browser, no shelling out.

```bash
npm install dvdrw
```

```typescript
import dvd from 'dvdrw';

const { svg } = await dvd(`
  Type "echo hello world"
  Enter
  Sleep 800ms
`, { theme: 'dracula', template: 'macos' });
```

<p align="center">
  <img src="https://github.com/tool3/dvd/blob/master/examples/svgs/quick-start.svg" alt="quick start" />
</p>

---

## Contents

**Guide**

- [Why the library?](#why-the-library)
- [Inputs](#inputs) — [script string](#1-cd-script-string) · [steps](#2-programmatic-steps) · [raw output](#3-raw-terminal-output) · [pre-parsed](#4-pre-parsed-script)
- [Seeding the terminal](#seeding-the-terminal)
- [Themes](#themes) · [Templates](#templates) · [Loop styles](#loop-styles)
- [Branded output](#branded-output)
- [Progress tracking](#progress-tracking)
- [Low-level API](#low-level-api)
- [Video frame sequencing](#video-frame-sequencing)
- [Rendering modes](#rendering-modes-filmstrip-vs-smil)

**Reference**

- [Options](#options-reference)
- [Result](#result-reference)
- [Steps](#steps-reference)
- [Script settings](#script-settings-reference)

**Meta**

- [Examples](#examples) · [Comparison](#comparison) · [Related](#related)

---

## Why the library?

The CLI is great when you have a `.cd` script in a file. The library is for everything else:

- **Programmatic content** — render the output of a real test run, a real deploy, or a real benchmark, with frames built from runtime data.
- **Raw stdout capture** — feed any ANSI byte stream straight in (`{ raw }`). Spinners, progress bars, `chartscii`, `lolcat`, anything that animates on the terminal.
- **Build-pipeline integration** — fully `async`, optional `onProgress` callback, no temp files, no subprocesses by default.
- **Embeddable** — drop into a docs generator, a service, an Electron app, a serverless function. The output is a string.
- **Composable** — the parser, terminal emulator, coalescer, emitter and animator are all exported and usable independently.

If you want a single command on the CLI that takes a `.cd` file and writes a `.svg`, use [`dvd-cli`](https://github.com/tool3/dvd-cli). If you want to call into the engine, you're in the right place.

---

## Inputs

`dvd(input, options)` accepts four input shapes. Pick whichever matches the data you already have.

| Input | Shape | Use when |
|---|---|---|
| [Script string](#1-cd-script-string) | `string` | You're writing the demo by hand |
| [Steps](#2-programmatic-steps) | `CDCommand[]` | The content is computed at runtime |
| [Raw output](#3-raw-terminal-output) | `{ raw, totalDuration? }` | You already captured stdout |
| [Pre-parsed](#4-pre-parsed-script) | `{ script }` | You parsed and transformed a script yourself |

### 1. CD script string

The fastest path. Same syntax as `dvd-cli`, just inlined.

```typescript
const { svg } = await dvd(`
  Type "npm install dvdrw"
  Sleep 400ms
  Enter
  Sleep 800ms
`, { theme: 'dracula', template: 'macos', title: 'quick-start' });
```

`Type` + `Enter` runs the line through a real shell and records its actual output. `Set` lines inside the script are applied as settings — see [script settings](#script-settings-reference).

### 2. Programmatic steps

When the content of your animation is computed at runtime — a generated test report, a stream of deploy events, a templated demo — skip the script and pass an array.

```typescript
// Each Type+Enter is sent through a real shell, so wrap any styled output
// in `echo -e "..."` rather than typing raw ANSI as a command.
const steps = [
  { type: 'Type', text: 'echo -e "\\x1b[2m$\\x1b[0m npm test"' },
  { type: 'Key', key: 'Enter' },
  { type: 'Sleep', duration: 600 },
  ...tests.flatMap((t) => [
    { type: 'Type', text: `echo -e "\\x1b[32m  ✓\\x1b[0m ${t.name} \\x1b[2m(${t.ms}ms)\\x1b[0m"` },
    { type: 'Key', key: 'Enter' },
    { type: 'Sleep', duration: 200 },
  ]),
];

const { svg } = await dvd(steps, { theme: 'tokyoNight', template: 'macos', title: 'test runner' });
```

<p align="center">
  <img src="https://github.com/tool3/dvd/blob/master/examples/svgs/programmatic-steps.svg" alt="programmatic test runner output" />
</p>

> Settings are **not** read from a steps array — a `{ type: 'Set', ... }` entry is ignored. Pass them as the second argument to `dvd()` instead.

> Full source: [`examples/02-programmatic-steps.ts`](examples/02-programmatic-steps.ts)

### 3. Raw terminal output

Capture stdout from any command and hand the bytes over. dvd auto-detects the animation pattern (terminal reset, cursor restore, cursor up, clear line) and splits into frames automatically.

```typescript
import dvd from 'dvdrw';
import { spawnSync } from 'node:child_process';

const r = spawnSync('myscript.sh', { encoding: 'buffer' });
const raw = r.stdout.toString('binary');

const { svg } = await dvd({ raw, totalDuration: 2400 }, {
  theme: 'catppuccinMocha',
  template: 'macos',
  title: 'spinner capture',
});
```

`totalDuration` is the wall-clock time the capture took, in ms. Without it, frames are spaced at a flat 30fps.

<p align="center">
  <img src="https://github.com/tool3/dvd/blob/master/examples/svgs/raw-output.svg" alt="captured spinner output" />
</p>

> Full source: [`examples/03-raw-output.ts`](examples/03-raw-output.ts)

### 4. Pre-parsed script

If you've already parsed a CD script (e.g., for validation or transformation), pass the AST directly:

```typescript
import dvd, { parseCDScript } from 'dvdrw';

const script = parseCDScript(scriptText);
// ...mutate, validate, splice frames...
const { svg } = await dvd({ script }, { theme: 'nord' });
```

---

## Seeding the terminal

`seed` pre-fills the screen with text that was never typed and never executed. Every frame starts with it already on screen, and the prompt begins on the line below.

Use it to give a recording context it would otherwise waste time earning — earlier commands in the session, a banner, a fake `motd`, a chart the demo is about to update.

```typescript
const { svg } = await dvd(`
  Type "npm run deploy"
  Sleep 400ms
  Enter
  Sleep 1200ms
`, {
  seed: [
    '\x1b[95m❯\x1b[0m npm test',
    '\x1b[32m  ✓\x1b[0m 56 passing \x1b[2m(1.7s)\x1b[0m',
    '',
  ],
  theme: 'catppuccinMocha',
  template: 'macos',
});
```

<p align="center">
  <img src="https://github.com/tool3/dvd/blob/master/examples/svgs/seed.svg" alt="seeded terminal session" />
</p>

The seed is **content, not chrome** — it goes through the same terminal emulator as everything else:

- **ANSI works.** Colors, bold, dim, background fills — anything the emulator understands.
- **Auto-sizing accounts for it.** A wide or tall seed grows the SVG, same as recorded output.
- **`clear` wipes it.** A `clear` in the script resets the screen exactly like a real terminal, seed included.
- **It is not a prompt.** Seed lines are printed verbatim, with no prompt prefix. Include your own `❯` if you want the seed to look like past commands.

Accepted as a string or an array of lines — the array form avoids escaping and makes blank lines explicit:

```typescript
seed: 'line one\nline two'     // a single trailing \n is ignored
seed: ['line one', 'line two'] // same result
```

All three input shapes support it. With `{ raw }`, the seed is prepended to **every** detected frame, so it stays on screen while the capture animates underneath it.

From a script, use `Set Seed` — backticks span multiple lines:

```
Set Seed `❯ git status
On branch master
nothing to commit, working tree clean`

Type "npm run deploy"
Enter
```

`Set Seed` runs the value through the same escape handling as `Set PromptPrefix`: `\e` / `\x1b`, `\n`, `\t` and `$VAR` are expanded. The `seed` option, being a real JS string, is taken literally.

> Full source: [`examples/11-seed.ts`](examples/11-seed.ts)

---

## Themes

37 built-in themes, all exported from `themes`. Pass by name or as a full `Theme` object.

```typescript
await dvd(script, { theme: 'tokyoNight' });
```

<table>
<tr>
  <td align="center"><strong>dracula</strong><br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/themes/dracula.svg" alt="dracula" /></td>
  <td align="center"><strong>tokyoNight</strong><br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/themes/tokyoNight.svg" alt="tokyoNight" /></td>
</tr>
<tr>
  <td align="center"><strong>catppuccinMocha</strong><br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/themes/catppuccinMocha.svg" alt="catppuccinMocha" /></td>
  <td align="center"><strong>nord</strong><br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/themes/nord.svg" alt="nord" /></td>
</tr>
<tr>
  <td align="center"><strong>gruvboxDark</strong><br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/themes/gruvboxDark.svg" alt="gruvboxDark" /></td>
  <td align="center"><strong>monokai</strong><br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/themes/monokai.svg" alt="monokai" /></td>
</tr>
<tr>
  <td align="center"><strong>oneDark</strong><br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/themes/oneDark.svg" alt="oneDark" /></td>
  <td align="center"><strong>synthwave84</strong><br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/themes/synthwave84.svg" alt="synthwave84" /></td>
</tr>
</table>

The full list: `a11yDark`, `base16Dark`, `base16Light`, `blackboard`, `catppuccinMocha`, `cobalt`, `dark`, `dracula`, `draculaPro`, `duotoneDark`, `githubDark`, `githubLight`, `gruvboxDark`, `gruvboxLight`, `hopscotch`, `lucario`, `material`, `monokai`, `night3024`, `nord`, `oceanicNext`, `oneDark`, `oneLight`, `pandaSyntax`, `paraisoDark`, `seti`, `shadesOfPurple`, `solarizedDark`, `solarizedLight`, `synthwave84`, `terminal`, `tokyoNight`, `twilight`, `verminal`, `vscode`, `yeti`, `zenburn`.

For custom palettes, pass a `Theme` object directly:

```typescript
import dvd, { type Theme } from 'dvdrw';

const retroGreen: Theme = {
  name: 'retro',
  background: '#0a0a0a',
  foreground: '#00ff00',
  cursor: '#00ff00',
  // ...the 16 ANSI colors
};

await dvd(script, { theme: retroGreen });
```

> Source: [`examples/04-themes-gallery.ts`](examples/04-themes-gallery.ts)

---

## Templates

Window chrome — `macos` / `windows` / `minimal`.

<table>
<tr>
  <td align="center"><strong>macos</strong></td>
  <td align="center"><strong>windows</strong></td>
  <td align="center"><strong>minimal</strong></td>
</tr>
<tr>
  <td><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/templates/macos.svg" alt="macos template" /></td>
  <td><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/templates/windows.svg" alt="windows template" /></td>
  <td><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/templates/minimal.svg" alt="minimal template" /></td>
</tr>
</table>

> Source: [`examples/09-templates.ts`](examples/09-templates.ts)

---

## Loop styles

Animations loop by default. Choose how the loop behaves at the boundary:

```typescript
await dvd(script, {
  loopStyle: 'reverse',  // 'loop' | 'reverse' | 'rewind' | 'fade'
  loopPause: 600,
  rewindSpeed: 6,        // for 'rewind'
  fadeDuration: 1200,    // for 'fade'
});
```

<table>
<tr>
  <td align="center"><strong>loop</strong> — restart from frame 0<br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/loop-styles/loop.svg" alt="loop style: loop" /></td>
  <td align="center"><strong>reverse</strong> — play forward then back<br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/loop-styles/reverse.svg" alt="loop style: reverse" /></td>
</tr>
<tr>
  <td align="center"><strong>rewind</strong> — fast reverse like rewinding tape<br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/loop-styles/rewind.svg" alt="loop style: rewind" /></td>
  <td align="center"><strong>fade</strong> — fade to black, fade back in<br><img src="https://github.com/tool3/dvd/blob/master/examples/svgs/loop-styles/fade.svg" alt="loop style: fade" /></td>
</tr>
</table>

> Source: [`examples/05-loop-styles.ts`](examples/05-loop-styles.ts)

---

## Branded output

Gradient backgrounds, watermarks, custom borders — for docs sites and landing pages where the SVG carries product weight.

```typescript
const { svg } = await dvd(script, {
  theme: 'tokyoNight',
  template: 'macos',
  background: 'gradient(#7c5fff, #ff6ec7:diagonal)',
  backgroundPadding: 48,
  borderRadius: 12,
  watermark: 'made with dvd',
});
```

Backgrounds accept solid colors (`#1a1a2e`) or gradients in the form `gradient(<color>, <color>[:vertical|horizontal|diagonal])` with as many stops as you need.

<p align="center">
  <img src="https://github.com/tool3/dvd/blob/master/examples/svgs/branding.svg" alt="branded output" />
</p>

> Source: [`examples/06-branding.ts`](examples/06-branding.ts)

---

## Progress tracking

Wire dvd into your build pipeline or TUI. The `onProgress` callback fires for every step the executor runs.

```typescript
await dvd(script, {
  onProgress: (current, total, description) => {
    const pct = Math.round((current / total) * 100);
    process.stdout.write(`\r[${pct}%] ${description ?? ''}`);
  },
});
```

The returned result also carries metadata — frame count, total duration, effective FPS — for logging and CI annotations:

```typescript
const result = await dvd(script);
console.log(result.metadata); // { duration: 2118, frameCount: 33, fps: 15.6 }
```

> Source: [`examples/07-progress.ts`](examples/07-progress.ts)

---

## Low-level API

Skip the executor when you want to render arbitrary terminal state directly — for static badges, dashboards, CI annotations, or content that doesn't fit the script model.

```typescript
import { coalesce, createGridState, emit, processInput, themes } from 'dvdrw';

const fontSize = 16;
const theme = themes.draculaPro;

let state = createGridState(44, 9);
state = processInput(state, '\x1b[1;38;5;213m  dvdrw\x1b[0m · terminal recordings as svg');

const spans = coalesce(state, theme);

const { svg } = emit(spans, state.cursor, false, {
  theme,
  template: 'minimal',
  width: 460,
  height: 240,
  fontSize,
  lineHeight: fontSize * 1.4,
  charWidth: fontSize * 0.6,
  padding: 16,
});
```

<p align="center">
  <img src="https://github.com/tool3/dvd/blob/master/examples/svgs/low-level-api.svg" alt="low-level API output" />
</p>

The exposed building blocks:

| Module | Symbols |
|---|---|
| Terminal emulator | `createGridState`, `processInput`, `applyCommand`, `applyCommands`, `parseInput` |
| Text processing | `coalesce` |
| Emission | `emit`, `emitAnimated`, `emitFilmstripAnimated` |
| Animation | `createAnimatedSVG`, `createFilmstripSVG`, `optimizeSvg` |
| Raw output | `processRawOutput`, `detectAnimationType`, `splitIntoFrames` |
| Cast files | `parseCastFile`, `RecordingPlayer`, `generateFramesFromRecording`, `optimizeFrames` |
| Script parsing | `parseCDScript`, `CDParseError` |
| Executor | `CDExecutor` |
| Frame sequencing | `planVideo`, `resolveQuality`, `autoFps`, `VIDEO_QUALITY` |
| Seeding | `resolveSeedLines`, `resolveSeedText` |
| Misc | `themes`, `getCharWidth` |

> Source: [`examples/08-low-level-api.ts`](examples/08-low-level-api.ts)

---

## Video frame sequencing

`dvdrw` emits SVG and only SVG. It does not rasterize and it does not encode — no ffmpeg, no canvas, no browser.

What it does give you is `planVideo()`: a constant-rate frame plan built from the same `emitter` options the animation used, so every still renders identically to the animation it came from. Rasterizing and encoding that plan is your job.

```typescript
import dvd, { planVideo } from 'dvdrw';

const { frameData, emitter } = await dvd(script);
const plan = planVideo(frameData, { emitter, quality: 'high' });

for (const frame of plan.frames()) {
  // frame.svg — a standalone static SVG for this instant
  // frame.index, frame.timestampMs, frame.sourceIndex
  // frame.repeatsPrevious — true when the raster is identical to the last one
}
```

`plan.frames()` is a lazy generator; `plan.render(index)` gives you one frame on its own. Quality tiers are `low` / `medium` / `high` (`VIDEO_QUALITY` holds their `scale`, `crf`, `bitsPerPixel` and `fps`), and `fps: 'auto'` on the `high` tier asks the recording how fast it actually moves.

Rasterize at `plan.frameWidth` × `plan.frameHeight` — the SVG's own intrinsic size, which is larger than `emitter.width`/`height` whenever background padding or a wide watermark grows the canvas. Then **pad** (never scale) to reach the even-numbered `plan.width` × `plan.height` the encoder wants.

---

## Rendering modes: filmstrip vs SMIL

Two animation engines are available. The default (filmstrip) is what you almost always want.

| | **Filmstrip** (default) | **SMIL** (`smil: true`) |
|---|---|---|
| Engine | CSS `@keyframes` over a deduped row pool | Native SVG `<animate>` per frame |
| File size | Smaller — scales with *unique rows*, not total frames | Larger — scales with total frames |
| Best for | README embeds, docs, long recordings, mostly-static content | Short animations, high-FPS smoothness on iOS Safari / 120Hz |

```typescript
await dvd(script, { smil: true });
```

---

## Options reference

Every option is optional.

### Content

| Option | Type | Default | |
|---|---|---|---|
| `seed` | `string \| string[]` | — | Text pre-filled on screen before anything runs — see [Seeding](#seeding-the-terminal) |
| `title` | `string` | — | Window title text |
| `watermark` | `string` | — | Text or SVG markup pinned under the content |

### Window chrome

| Option | Type | Default | |
|---|---|---|---|
| `theme` | `Theme \| string` | `dark` | Name or full `Theme` object |
| `template` | `'macos' \| 'windows' \| 'minimal'` | `minimal`, or `macos` for `{ raw }` input | Window chrome |
| `borderRadius` | `number` | `8` | |
| `borderColor` | `string` | — | |
| `borderWidth` | `number` | — | |

### Dimensions

| Option | Type | Default | |
|---|---|---|---|
| `width` / `height` | `number` | auto | Omit to size from content (including the seed) |
| `fontSize` | `number` | `14` | |
| `lineHeight` | `number` | `1.4` | Multiplier, minimum `1` |
| `letterSpacing` | `number` | `0` | |
| `fontFamily` | `string` | system mono stack | |
| `padding` | `number` | `16` | Inside the terminal window |

### Background (outside the window)

| Option | Type | Default | |
|---|---|---|---|
| `background` | `string \| Gradient` | — | `'#hex'` or `'gradient(#a, #b[:horizontal\|vertical\|diagonal])'` |
| `backgroundPadding` | `number \| string` | `0` | CSS-style shorthand: `48`, `'40 64'`, `'10 20 30 40'` |
| `backgroundRadius` | `number` | `12` | |

### Header / footer

| Option | Type | |
|---|---|---|
| `headerHeight`, `headerBackground` | `number`, `string` | Header bar |
| `headerBorder`, `headerBorderColor`, `headerBorderWidth` | `boolean`, `string`, `number` | Header rule |
| `footerHeight`, `footerBackground` | `number`, `string` | Footer bar |
| `footerBorder`, `footerBorderColor`, `footerBorderWidth` | `boolean`, `string`, `number` | Footer rule |

### Cursor

| Option | Type | Default | |
|---|---|---|---|
| `cursorStyle` | `'block' \| 'bar' \| 'underline'` | `block` | |
| `cursorColor` | `string` | theme cursor | |
| `cursorBlink` | `boolean` | `true` | |

### Animation

| Option | Type | Default | |
|---|---|---|---|
| `loop` | `boolean` | `true` | |
| `loopStyle` | `'loop' \| 'reverse' \| 'rewind' \| 'fade'` | `loop` | |
| `loopPause` | `number` | `0` | ms between cycles |
| `pauseAtEnd` | `number` | `1000` | ms held on the last frame |
| `fadeDuration` | `number` | `1500` | ms, `fade` style only |
| `rewindSpeed` | `number` | `5` | multiplier, `rewind` style only |
| `playbackSpeed` | `number` | `1` | `2` = 2×, `0.5` = half speed |
| `fps` | `number` | — | Reserved. Frame timing comes from recorded timestamps; this is accepted but not yet applied |

### Renderer

| Option | Type | Default | |
|---|---|---|---|
| `smil` | `boolean` | `false` | `false` = filmstrip, `true` = SMIL |
| `optimize` | `boolean` | `true` | SVGO post-pass |
| `customGlyphs` | `boolean` | `true` | Box-drawing characters as geometric shapes |

### Callbacks

| Option | Signature |
|---|---|
| `onFrame` | `(frame: TerminalFrame) => void` |
| `onProgress` | `(current: number, total: number, description?: string) => void` |

---

## Result reference

```typescript
const result = await dvd(input, options);
```

| Field | Type | |
|---|---|---|
| `result.svg` | `string` | The animated SVG |
| `result.metadata.duration` | `number` | Total ms |
| `result.metadata.frameCount` | `number` | Number of frames |
| `result.metadata.fps` | `number` | Effective fps, derived from frame timestamps |
| `result.frames` | `TerminalFrame[]` | Per-frame SVG + terminal state |
| `result.frameData` | `FrameData[]` | Raw row spans — the input to a custom emitter |
| `result.emitter` | `EmitterOptions` | Fully resolved render options: auto-detected size, resolved theme, defaulted font metrics. Feed this back into `emit()` or `planVideo()` to re-render single frames identically |

---

## Steps reference

When using the programmatic-steps input, each entry conforms to one of these shapes:

| Type | Fields | Example |
|---|---|---|
| `Type` | `text`, optional `speed` (ms/char) | `{ type: 'Type', text: 'hello', speed: 50 }` |
| `Key` | `key`, optional `count` | `{ type: 'Key', key: 'Enter' }` |
| `Sleep` | `duration` (ms) | `{ type: 'Sleep', duration: 1000 }` |
| `Shortcut` | `key` + `ctrl` / `alt` / `shift` / `cmd` flags, optional `count` | `{ type: 'Shortcut', ctrl: true, key: 'c' }` |
| `Screenshot` | `path` | `{ type: 'Screenshot', path: 'frame.svg' }` |
| `Copy` / `Paste` | `text` (Copy only) | `{ type: 'Copy', text: 'hi' }` |

Keys: `Enter`, `Backspace`, `Tab`, `Space`, `Left`, `Right`, `Up`, `Down`.

The parser also accepts `Set`, `Env`, `Output`, `Require`, `Wait`, `Hide`, `Show` and `Source`, but the executor does not act on them — `Set` only takes effect through a script string or a pre-parsed script, and the rest are currently inert.

---

## Script settings reference

Settings usable as `Set <Name> <value>` inside a CD script string. Anything not listed is ignored.

| Group | Settings |
|---|---|
| Content | `Seed`, `Title`, `Watermark`, `WatermarkStyle`, `PromptPrefix` |
| Size | `Width`, `Height`, `FontSize`, `LineHeight`, `LetterSpacing`, `CharWidthRatio`, `Padding`, `Scroll` |
| Font | `FontFamily`, `EmbedFont` (path to a font file, inlined as base64) |
| Chrome | `Template`, `Theme`, `BorderColor`, `BorderWidth`, `BorderRadius` |
| Header | `HeaderHeight`, `HeaderBackground`, `HeaderBorder`, `HeaderBorderColor`, `HeaderBorderWidth` |
| Footer | `FooterHeight`, `FooterBackground`, `FooterBorder`, `FooterBorderColor`, `FooterBorderWidth` |
| Cursor | `CursorStyle`, `CursorColor`, `CursorBlink` |
| Background | `Background`, `BackgroundPadding`, `BackgroundRadius` |
| Timing | `TypingSpeed`, `AnimationSpeed`, `PlaybackSpeed`, `LoopStyle`, `LoopPause`, `FadeDuration`, `RewindSpeed` |
| Shell | `Shell`, `WorkingDirectory` (`$PWD` or an absolute path) |

Values can be bare, `"double quoted"` (with `\n`, `\t`, `\"` escapes) or `` `backticked` `` (literal, may span lines). Options passed to `dvd()` override the script's own `Set` lines.

---

## Examples

All runnable. Each writes its SVG into `examples/svgs/`.

```bash
npx ts-node -P tsconfig.dev.json examples/01-quick-start.ts
npx ts-node -P tsconfig.dev.json examples/02-programmatic-steps.ts
npx ts-node -P tsconfig.dev.json examples/03-raw-output.ts
npx ts-node -P tsconfig.dev.json examples/04-themes-gallery.ts
npx ts-node -P tsconfig.dev.json examples/05-loop-styles.ts
npx ts-node -P tsconfig.dev.json examples/06-branding.ts
npx ts-node -P tsconfig.dev.json examples/07-progress.ts
npx ts-node -P tsconfig.dev.json examples/08-low-level-api.ts
npx ts-node -P tsconfig.dev.json examples/09-templates.ts
npx ts-node -P tsconfig.dev.json examples/11-seed.ts

# or render them all in one go:
npx ts-node -P tsconfig.dev.json examples/10-render-all.ts
```

---

## Comparison

|                   |     dvdrw      |     VHS      |  asciinema   |
| ----------------- | :------------: | :----------: | :----------: |
| Output            |      SVG       |   GIF / MP4  |   asciicast  |
| Native API        | TypeScript lib |     CLI      | JSON + player |
| Dependencies      |      none      | ffmpeg, ttyd | player embed |
| Scalable          |      yes       |      no      |     yes      |
| GitHub README     |    perfect     |    works     | embed only   |
| Editable          |   yes (XML)    |      no      | yes (JSON)   |
| Offline           |      yes       |     yes      |      no      |
| Loop styles       |    4 modes     |    basic     |    basic     |
| Programmatic      |      yes       |   limited    |     yes      |

---

## Related

- [`dvd-cli`](https://github.com/tool3/dvd-cli) — the CLI front-end (`.cd` scripts, pipe mode, `rec` / `render` sub-commands)
- [`shellfie`](https://github.com/tool3/shellfie) — terminal screenshots in code
- [`shellfie-cli`](https://github.com/tool3/shellfie-cli) — terminal screenshots CLI
- [`shellfied`](https://github.com/tool3/shellfied) — terminal screenshots web service

---

## License

MIT
