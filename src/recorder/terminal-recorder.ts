import type { CastEvent, CastHeader, Recording, DVDCastExtensions } from './types';

//#region Terminal Recorder

/**
 * Records terminal I/O as timestamped events (asciinema cast format)
 */
export class TerminalRecorder {
  private events: CastEvent[] = [];
  private startTime: number = 0;
  private header: CastHeader;
  private isRecording: boolean = false;

  constructor() {
    // Default header - will be overwritten by setHeader
    this.header = {
      version: 2,
      width: 80,
      height: 24,
    };
  }

  /**
   * Start recording
   */
  start(): void {
    this.startTime = Date.now();
    this.events = [];
    this.isRecording = true;
  }

  /**
   * Stop recording
   */
  stop(): void {
    this.isRecording = false;
    // Update duration in header
    if (this.events.length > 0) {
      this.header.duration = this.events[this.events.length - 1][0];
    }
  }

  /**
   * Set the recording header with terminal dimensions and DVD settings
   */
  setHeader(header: Partial<CastHeader>): void {
    this.header = {
      ...this.header,
      ...header,
      version: 2,
    };
  }

  /**
   * Set DVD-specific extensions in the header
   */
  setDVDExtensions(extensions: DVDCastExtensions): void {
    this.header.dvd = extensions;
  }

  /**
   * Record output data (from shell command, etc.)
   */
  recordOutput(data: string): void {
    if (!this.isRecording || !data) return;
    this.events.push([this.getTimestamp(), 'o', data]);
  }

  /**
   * Record input data (user typing)
   */
  recordInput(data: string): void {
    if (!this.isRecording || !data) return;
    this.events.push([this.getTimestamp(), 'i', data]);
  }

  /**
   * Record a batch of input characters with timing
   * Used for Type command simulation
   */
  recordTyping(text: string, intervalMs: number): void {
    if (!this.isRecording) return;

    const baseTimestamp = this.getTimestamp();
    for (let i = 0; i < text.length; i++) {
      const timestamp = baseTimestamp + (i * intervalMs) / 1000;
      this.events.push([timestamp, 'i', text[i]]);
    }
  }

  /**
   * Record output with explicit timestamp (for replay scenarios)
   */
  recordOutputAt(timestamp: number, data: string): void {
    if (!data) return;
    this.events.push([timestamp, 'o', data]);
  }

  /**
   * Record input with explicit timestamp
   */
  recordInputAt(timestamp: number, data: string): void {
    if (!data) return;
    this.events.push([timestamp, 'i', data]);
  }

  /**
   * Add a pause (no-op event to mark time passing)
   * Useful for Sleep commands
   */
  recordPause(durationMs: number): void {
    // Just advance time - the next event will have the new timestamp
    // No actual event is recorded for pauses
  }

  /**
   * Get current timestamp in seconds since recording started
   */
  getTimestamp(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Get the elapsed time in milliseconds since recording started
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get the complete recording
   */
  getRecording(): Recording {
    return {
      header: { ...this.header },
      events: [...this.events],
    };
  }

  /**
   * Get recorded events (for debugging)
   */
  getEvents(): CastEvent[] {
    return [...this.events];
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Check if currently recording
   */
  isActive(): boolean {
    return this.isRecording;
  }

  /**
   * Clear all recorded events (for reuse)
   */
  clear(): void {
    this.events = [];
    this.startTime = 0;
    this.isRecording = false;
  }
}


//#region Factory

/**
 * Create a new terminal recorder
 */
export const createRecorder = (): TerminalRecorder => {
  return new TerminalRecorder();
};
