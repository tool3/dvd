import type { Recording, CastEvent, FrameGenerationOptions } from './types';
import type { GridState, Theme } from '../types';
import type { FrameData } from '../pipeline/svg-emitter';
import { createGridState, processInput } from '../pipeline/vterminal';
import { coalesce } from '../pipeline/coalescer';


//#region Event Coalescing

/**
 * Check if a string ends with an incomplete ANSI escape sequence.
 * This detects sequences like "\x1b[38;2;134" that are missing the final command letter.
 */
const endsWithIncompleteSequence = (data: string): boolean => {
  // Look for ESC that starts a sequence but doesn't have a terminator
  const lastEsc = data.lastIndexOf('\x1b');
  if (lastEsc === -1) return false;

  const afterEsc = data.slice(lastEsc);

  // Check for CSI sequence (ESC [) without final byte (0x40-0x7E)
  if (afterEsc.startsWith('\x1b[')) {
    const csiContent = afterEsc.slice(2);
    // CSI sequences end with a letter (A-Z, a-z, @, etc.)
    // If we only have digits, semicolons, or nothing, it's incomplete
    if (csiContent.length === 0) return true;
    const lastChar = csiContent.charCodeAt(csiContent.length - 1);
    // Final bytes are in range 0x40-0x7E (@ through ~)
    return lastChar < 0x40 || lastChar > 0x7e;
  }

  // Check for bare ESC at the end
  if (afterEsc === '\x1b') return true;

  // Check for OSC sequence (ESC ]) without terminator (BEL or ST)
  if (afterEsc.startsWith('\x1b]')) {
    return !afterEsc.includes('\x07') && !afterEsc.includes('\x1b\\');
  }

  return false;
};

/**
 * Coalesce events that happen within a very short time window OR that have
 * split ANSI sequences. Cast files often split output at arbitrary byte
 * boundaries, causing escape sequences to span multiple events.
 */
const coalesceEvents = (events: CastEvent[], threshold: number = 0.005): CastEvent[] => {
  if (events.length === 0) return [];

  const result: CastEvent[] = [];
  let currentTimestamp = events[0][0];
  let currentType = events[0][1];
  let currentData = events[0][2];
  let lastEventTimestamp = events[0][0]; // Track the actual last event's timestamp

  for (let i = 1; i < events.length; i++) {
    const [timestamp, eventType, data] = events[i];

    // Calculate time since the LAST event (not since the first event in the group)
    const timeSinceLastEvent = timestamp - lastEventTimestamp;

    // Coalesce if:
    // 1. Same type AND within time threshold from the last event, OR
    // 2. Same type AND previous data ends with incomplete escape sequence AND
    //    the gap is small (< 10ms) - incomplete sequences shouldn't span long gaps
    const withinThreshold = timeSinceLastEvent < threshold;
    const hasIncompleteSequence = endsWithIncompleteSequence(currentData) && timeSinceLastEvent < 0.010;

    if (eventType === currentType && (withinThreshold || hasIncompleteSequence)) {
      currentData += data;
      lastEventTimestamp = timestamp;
    } else {
      result.push([currentTimestamp, currentType, currentData]);
      currentTimestamp = timestamp;
      currentType = eventType;
      currentData = data;
      lastEventTimestamp = timestamp;
    }
  }

  // Push the last accumulated event
  result.push([currentTimestamp, currentType, currentData]);

  return result;
};


//#region Frame Generation

/**
 * Replays a recording through vterminal and generates frames for animation.
 * This is the core component that bridges the recording system with the existing
 * SVG rendering pipeline.
 */
export class RecordingPlayer {
  private recording: Recording;
  private theme: Theme;
  private grid: GridState;
  private currentEventIndex: number = 0;
  private currentTime: number = 0;

  constructor(recording: Recording, theme: Theme) {
    this.recording = recording;
    this.theme = theme;
    this.grid = createGridState(recording.header.width, recording.header.height);
  }

  /**
   * Generate all frames from the recording for SVG animation.
   * This replays events through vterminal and captures state at each output event.
   *
   * Cursor visibility and position are taken directly from the terminal emulator,
   * which properly handles escape sequences like \x1b[?25l (hide) and \x1b[?25h (show).
   */
  generateFrames(options: FrameGenerationOptions = {}): FrameData[] {
    const {
      minFrameInterval = 16, // ~60fps max
      maxFrameInterval = 2000, // Cap long pauses at 2s
    } = options;

    // Reset state for fresh replay
    this.reset();

    const frames: FrameData[] = [];
    // Coalesce events to prevent split ANSI sequences
    const events = coalesceEvents(this.recording.events);
    let lastFrameTime = -minFrameInterval;

    // Capture initial frame
    frames.push(this.captureFrame(0));
    lastFrameTime = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const [timestamp, eventType, data] = event;

      // Apply the event to the terminal
      if (eventType === 'o') {
        this.grid = processInput(this.grid, data);
      }
      // 'i' (input) events don't affect grid state in replay

      // Capture frames at regular intervals
      const timeSinceLastFrame = timestamp - lastFrameTime;
      const shouldCapture =
        eventType === 'o' &&
        timeSinceLastFrame >= minFrameInterval / 1000;

      if (shouldCapture) {
        // Cap the timestamp delta to maxFrameInterval
        const cappedTimestamp =
          timeSinceLastFrame > maxFrameInterval / 1000
            ? lastFrameTime + maxFrameInterval / 1000
            : timestamp;

        // Cursor visibility and position come directly from the terminal emulator
        frames.push(this.captureFrame(cappedTimestamp));
        lastFrameTime = cappedTimestamp;
      }

      this.currentTime = timestamp;
      this.currentEventIndex = i + 1;
    }

    // Capture final frame
    if (events.length > 0) {
      const finalTimestamp = events[events.length - 1][0];
      if (finalTimestamp > lastFrameTime) {
        frames.push(this.captureFrame(finalTimestamp));
      }
    }

    return frames;
  }

  /**
   * Capture current terminal state as a FrameData object.
   * Cursor state comes directly from the terminal emulator.
   */
  private captureFrame(timestamp: number): FrameData {
    const rows = coalesce(this.grid, this.theme);
    const cursor = this.grid.cursor;

    return {
      rows,
      cursor: { row: cursor.row, col: cursor.col },
      cursorVisible: this.grid.cursorVisible,
      timestamp: timestamp * 1000, // Convert to milliseconds for animation
    };
  }

  /**
   * Reset the player to initial state for re-replay
   */
  reset(): void {
    this.grid = createGridState(this.recording.header.width, this.recording.header.height);
    this.currentEventIndex = 0;
    this.currentTime = 0;
  }

  /**
   * Get the recording duration in seconds
   */
  getDuration(): number {
    const events = this.recording.events;
    if (events.length === 0) return 0;
    return events[events.length - 1][0];
  }

  /**
   * Get the total number of events
   */
  getEventCount(): number {
    return this.recording.events.length;
  }

  /**
   * Get recording header info
   */
  getHeader(): Recording['header'] {
    return this.recording.header;
  }
}


//#region Frame Optimization

/**
 * Optimize frames by removing duplicates and merging similar frames.
 * This reduces the total number of frames in the animation.
 */
export const optimizeFrames = (frames: FrameData[]): FrameData[] => {
  if (frames.length <= 1) return frames;

  const optimized: FrameData[] = [frames[0]];

  for (let i = 1; i < frames.length; i++) {
    const current = frames[i];
    const previous = optimized[optimized.length - 1];

    // Check if content changed
    if (!framesEqual(current, previous)) {
      optimized.push(current);
    } else {
      // Content identical - just update timestamp of previous frame
      // This effectively extends the duration of the previous frame
    }
  }

  return optimized;
};

/**
 * Compare two frames for content equality (ignoring timestamp)
 */
const framesEqual = (a: FrameData, b: FrameData): boolean => {
  // Quick checks first
  if (a.cursorVisible !== b.cursorVisible) return false;
  if (a.cursor?.row !== b.cursor?.row || a.cursor?.col !== b.cursor?.col) return false;
  if (a.rows.length !== b.rows.length) return false;

  // Deep comparison of rows
  for (let i = 0; i < a.rows.length; i++) {
    const rowA = a.rows[i];
    const rowB = b.rows[i];
    if (rowA.length !== rowB.length) return false;

    for (let j = 0; j < rowA.length; j++) {
      const spanA = rowA[j];
      const spanB = rowB[j];
      if (
        spanA.text !== spanB.text ||
        spanA.col !== spanB.col ||
        spanA.row !== spanB.row ||
        spanA.style.fg !== spanB.style.fg ||
        spanA.style.bg !== spanB.style.bg ||
        spanA.style.bold !== spanB.style.bold ||
        spanA.style.italic !== spanB.style.italic ||
        spanA.style.underline !== spanB.style.underline ||
        spanA.style.dim !== spanB.style.dim ||
        spanA.style.strikethrough !== spanB.style.strikethrough
      ) {
        return false;
      }
    }
  }

  return true;
};


//#region Factory Functions

/**
 * Create a RecordingPlayer from a Recording object
 */
export const createPlayer = (recording: Recording, theme: Theme): RecordingPlayer => {
  return new RecordingPlayer(recording, theme);
};

/**
 * Generate frames directly from a recording (convenience function)
 */
export const generateFramesFromRecording = (
  recording: Recording,
  theme: Theme,
  options?: FrameGenerationOptions
): FrameData[] => {
  const player = createPlayer(recording, theme);
  const frames = player.generateFrames(options);
  return optimizeFrames(frames);
};
