//#region Cast Format Types (Asciinema v2 compatible)

/**
 * Cast event types:
 * - 'o': Output (data written to terminal)
 * - 'i': Input (user typing)
 */
export type CastEventType = 'o' | 'i';

/**
 * A single cast event: [timestamp, type, data]
 * Timestamp is in seconds (float)
 */
export type CastEvent = [number, CastEventType, string];

/**
 * DVD-specific extensions to the cast header
 */
export interface DVDCastExtensions {
  version: 1;
  theme: string;
  template: string;
  fontSize: number;
  fontFamily?: string;
  lineHeight: number;
  charWidthRatio: number;
  title?: string;
  width: number;
  height: number;
  padding?: number;
  cursorStyle: string;
  cursorBlink: boolean;
  cursorColor?: string;
  promptPrefix: string;
  background?: string;
  backgroundPadding?: number;
  backgroundRadius?: number;
  watermark?: string;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  headerBackground?: string;
  headerHeight?: number;
  footerBackground?: string;
  footerHeight?: number;
  loopStyle?: string;
  loopPause?: number;
  fadeDuration?: number;
  rewindSpeed?: number;
  pauseAtEnd?: number;
}

/**
 * Cast file header (asciinema v2 format with DVD extensions)
 */
export interface CastHeader {
  version: 2;
  width: number;
  height: number;
  timestamp?: number;
  duration?: number;
  title?: string;
  env?: {
    SHELL?: string;
    TERM?: string;
  };
  // DVD-specific extensions
  dvd?: DVDCastExtensions;
}

/**
 * A complete recording (header + events)
 */
export interface Recording {
  header: CastHeader;
  events: CastEvent[];
}


//#region Frame Generation Types

/**
 * Options for frame generation from recording
 */
export interface FrameGenerationOptions {
  /** Minimum interval between frames in ms */
  minFrameInterval?: number;
  /** Maximum interval between frames in ms (for long pauses) */
  maxFrameInterval?: number;
  /** Whether to capture a frame after each output event */
  captureEveryOutput?: boolean;
}

/**
 * Cursor state for frame capture
 */
export interface CursorState {
  visible: boolean;
  active: boolean;
  row: number;
  col: number;
}

/**
 * Selection state for frame capture
 */
export interface SelectionState {
  start: number;
  end: number;
  row: number;
}
