//#region Cast File Parser

import type { Recording, CastHeader, CastEvent, CastEventType } from './types';

/**
 * Parse an asciinema cast file (NDJSON format).
 * Supports v1, v2, and v3 formats.
 *
 * Format:
 * - Line 1: JSON header object with version, width/height (v1/v2) or term.cols/rows (v3)
 * - Lines 2+: JSON arrays [timestamp, event_type, data]
 *
 * Note: v3 uses relative (delta) timestamps while v1/v2 use absolute timestamps.
 * This parser normalizes v3 timestamps to absolute for consistent processing.
 */
export const parseCastFile = (content: string): Recording => {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('Cast file is empty');
  }

  // Parse header (first line) and get original version for timestamp handling
  let header: CastHeader;
  let originalVersion: number;
  try {
    const rawHeader = JSON.parse(lines[0]);
    originalVersion = typeof rawHeader.version === 'number' ? rawHeader.version : 2;
    header = validateHeader(rawHeader);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid cast file: header is not valid JSON`);
    }
    throw err;
  }

  // Parse events (remaining lines)
  // v3 uses relative timestamps (delta from previous event)
  // v1/v2 use absolute timestamps
  const events: CastEvent[] = [];
  let cumulativeTime = 0;

  for (let i = 1; i < lines.length; i++) {
    try {
      const rawEvent = JSON.parse(lines[i]);
      const event = validateEvent(rawEvent, i + 1);
      // validateEvent returns null for event types we don't handle
      if (event !== null) {
        if (originalVersion === 3) {
          // v3: convert relative timestamp to absolute
          cumulativeTime += event[0];
          events.push([cumulativeTime, event[1], event[2]]);
        } else {
          // v1/v2: timestamps are already absolute
          events.push(event);
        }
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Invalid cast file: line ${i + 1} is not valid JSON`);
      }
      throw err;
    }
  }

  return { header, events };
};

/**
 * Validate and normalize the cast header
 * Supports v1, v2, and v3 formats
 */
const validateHeader = (raw: unknown): CastHeader => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid cast file: header must be an object');
  }

  const obj = raw as Record<string, unknown>;

  // Version check
  const version = obj.version;
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new Error(`Unsupported cast version: ${version}. Only v1, v2, and v3 are supported.`);
  }

  // Extract dimensions based on version
  let width: number;
  let height: number;

  if (version === 3) {
    // v3 uses term.cols and term.rows
    const term = obj.term as Record<string, unknown> | undefined;
    if (!term || typeof term !== 'object') {
      throw new Error('Invalid cast file: v3 header must have a term object');
    }
    if (typeof term.cols !== 'number' || term.cols <= 0) {
      throw new Error('Invalid cast file: header.term.cols must be a positive number');
    }
    if (typeof term.rows !== 'number' || term.rows <= 0) {
      throw new Error('Invalid cast file: header.term.rows must be a positive number');
    }
    width = Math.floor(term.cols);
    height = Math.floor(term.rows);
  } else {
    // v1/v2 use width and height
    if (typeof obj.width !== 'number' || obj.width <= 0) {
      throw new Error('Invalid cast file: header.width must be a positive number');
    }
    if (typeof obj.height !== 'number' || obj.height <= 0) {
      throw new Error('Invalid cast file: header.height must be a positive number');
    }
    width = Math.floor(obj.width);
    height = Math.floor(obj.height);
  }

  return {
    version: 2, // Normalize to v2 internally
    width,
    height,
    timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : undefined,
    duration: typeof obj.duration === 'number' ? obj.duration : undefined,
    title: typeof obj.title === 'string' ? obj.title : undefined,
    env:
      typeof obj.env === 'object' && obj.env !== null
        ? {
            SHELL: typeof (obj.env as Record<string, unknown>).SHELL === 'string' ? (obj.env as Record<string, unknown>).SHELL as string : undefined,
            TERM: typeof (obj.env as Record<string, unknown>).TERM === 'string' ? (obj.env as Record<string, unknown>).TERM as string : undefined,
          }
        : undefined,
  };
};

/**
 * Validate and normalize a cast event.
 * Returns null for event types we don't handle (like 'x' for exit code, 'r' for resize in v3).
 */
const validateEvent = (raw: unknown, lineNum: number): CastEvent | null => {
  if (!Array.isArray(raw)) {
    throw new Error(`Invalid cast file: line ${lineNum} must be an array`);
  }

  if (raw.length < 2) {
    throw new Error(`Invalid cast file: line ${lineNum} must have at least 2 elements [timestamp, type, ...]`);
  }

  const [timestamp, eventType, data] = raw;

  if (typeof timestamp !== 'number' || timestamp < 0) {
    throw new Error(`Invalid cast file: line ${lineNum} has invalid timestamp`);
  }

  // Skip event types we don't handle (v3 has 'x' for exit code, 'r' for resize, etc.)
  if (eventType !== 'o' && eventType !== 'i') {
    return null;
  }

  if (typeof data !== 'string') {
    throw new Error(`Invalid cast file: line ${lineNum} has invalid data (expected string)`);
  }

  return [timestamp, eventType as CastEventType, data];
};

/**
 * Serialize a Recording to cast file format (NDJSON)
 */
export const serializeCastFile = (recording: Recording): string => {
  const lines: string[] = [];

  // Header
  lines.push(JSON.stringify(recording.header));

  // Events
  for (const event of recording.events) {
    lines.push(JSON.stringify(event));
  }

  return lines.join('\n') + '\n';
};
