//#region Exports

export type {
  CastEvent,
  CastEventType,
  CastHeader,
  DVDCastExtensions,
  Recording,
  FrameGenerationOptions,
  CursorState,
  SelectionState,
} from './types';

export { TerminalRecorder, createRecorder } from './terminal-recorder';

export {
  RecordingPlayer,
  createPlayer,
  generateFramesFromRecording,
  optimizeFrames,
} from './recording-player';

export { parseCastFile, serializeCastFile } from './cast-parser';
