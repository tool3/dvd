// Core types
export type { Theme, GridState, Cell, Color, CellAttributes, SpanRow, EmitterOptions, Gradient, WatermarkConfig, WatermarkStyle, VTerminalCommand } from './types';

// Terminal emulation
export { createGridState, processInput, applyCommand, applyCommands, parseInput } from './pipeline/vterminal';

// Text processing
export { coalesce } from './pipeline/coalescer';

// SVG emission
export { emit, emitAnimated, emitFilmstripAnimated } from './pipeline/svg-emitter';
export type { FrameData, EmitResult, FilmstripOptions } from './pipeline/svg-emitter';

// Animation
export { createAnimatedSVG, createFilmstripSVG } from './animator/svg-animator';
export type { AnimationOptions, FilmstripAnimationContext } from './animator/svg-animator';

// SVG optimization
export { optimizeSvg } from './animator/svg-optimizer';

// Recording & playback
export { parseCastFile } from './recorder/cast-parser';
export { RecordingPlayer, generateFramesFromRecording, optimizeFrames } from './recorder/recording-player';
export type { Recording, CastEvent, CastHeader, FrameGenerationOptions } from './recorder/types';

// CD script parsing
export { parseCD as parseCDScript, CDParseError } from './parser/cd-parser';
export type { CDCommand, CDScript } from './parser/cd-parser';

// Themes
export { themes } from './pipeline';

// Utilities
export { getCharWidth } from './utils/wcwidth';

// Raw output processing
export { processRawOutput, detectAnimationType, splitIntoFrames } from './pipeline/raw-output';
export type { AnimationType, RawOutputResult, RawOutputOptions } from './pipeline/raw-output';

// Video frame sequencing (rasterize + encode is the consumer's job)
export { planVideo } from './video/frame-sequence';
export type { VideoPlan, VideoPlanOptions, VideoFrame } from './video/frame-sequence';

// High-level API
import dvd from './api';
export type { DVDInput, DVDOptions, DVDResult, RawInput, ScriptInput } from './api';

// Executor
export { CDExecutor } from './executor/cd-executor';
export type { CDExecutorOptions, ExecutorContext, TerminalFrame, TerminalState } from './executor/types';


export default dvd;