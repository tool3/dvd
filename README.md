# dvd

Create beautiful animated SVGs from terminal recordings.

Browser-compatible core library for terminal -> SVG rendering.

## Install

```bash
npm install dvd
```

## Usage

```typescript
import { parseCastFile, RecordingPlayer, createFilmstripSVG, themes } from 'dvd';

// Parse a .cast file
const recording = parseCastFile(castFileContent);

// Generate frames
const player = new RecordingPlayer(recording, themes.dark);
const frames = player.generateFrames();

// Create animated SVG
const svg = createFilmstripSVG({ frameData: frames, theme: themes.dark, width: 800, height: 600, fontSize: 14 });
```
