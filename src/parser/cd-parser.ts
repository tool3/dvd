//#region Types

const BACKTICK_NEWLINE = '\x00BTNL\x00';

export type CDCommand =
  | { type: 'Output'; path: string }
  | { type: 'Require'; program: string }
  | { type: 'Set'; setting: string; value: string }
  | { type: 'Type'; text: string; speed?: number; prefix?: string }
  | { type: 'Key'; key: 'Left' | 'Right' | 'Up' | 'Down' | 'Backspace' | 'Enter' | 'Tab' | 'Space'; count?: number }
  | { type: 'Shortcut'; ctrl: boolean; alt: boolean; shift: boolean; cmd: boolean; key: string; count?: number }
  | { type: 'Sleep'; duration: number }
  | { type: 'Wait'; condition?: 'Screen' | 'Line'; pattern?: RegExp }
  | { type: 'Hide' }
  | { type: 'Show' }
  | { type: 'Screenshot'; path?: string }
  | { type: 'Copy'; text: string }
  | { type: 'Paste' }
  | { type: 'Source'; file: string }
  | { type: 'Env'; key: string; value: string }
  | { type: 'Comment' };

export interface CDScript {
  commands: CDCommand[];
  settings: Map<string, string>;
  output?: string;
  requirements: string[];
}

export class CDParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number
  ) {
    super(`Parse error at line ${line}, column ${column}: ${message}`);
    this.name = 'CDParseError';
  }
}


//#region Parsing Utilities

export const parseDuration = (duration: string): number => {
  const match = duration.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  const value = parseFloat(match[1]);
  const unit = match[2];
  return unit === 's' ? value * 1000 : value;
};

export const parseRegex = (pattern: string): RegExp => {
  const match = pattern.match(/^\/(.+?)\/([gimsuvy]*)$/);
  if (!match) throw new Error(`Invalid regex pattern: ${pattern}`);
  return new RegExp(match[1], match[2]);
};

export const parseQuotedString = (str: string): string => {
  // Backtick strings: literal, no escape processing
  if (str.startsWith('`') && str.endsWith('`')) {
    return str.slice(1, -1).replace(new RegExp(BACKTICK_NEWLINE, 'g'), '\n');
  }

  if (!str.startsWith('"') || !str.endsWith('"')) {
    throw new Error(`Expected quoted string, got: ${str}`);
  }

  const content = str.slice(1, -1);
  const BACKSLASH_PLACEHOLDER = '\x00BACKSLASH\x00';

  return content
    .replace(/\\\\/g, BACKSLASH_PLACEHOLDER)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\');
};


//#region Tokenizer

export const tokenizeLine = (line: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let inDoubleQuotes = false;
  let inBackticks = false;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inBackticks) {
      current += char;
      escaped = true;
      continue;
    }

    if (char === '"' && !inBackticks) {
      inDoubleQuotes = !inDoubleQuotes;
      current += char;
      continue;
    }

    if (char === '`' && !inDoubleQuotes) {
      inBackticks = !inBackticks;
      current += char;
      continue;
    }

    if (!inDoubleQuotes && !inBackticks && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
};


//#region Command Parser

export const parseCommand = (line: string, lineNumber: number): CDCommand => {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) return { type: 'Comment' };

  const tokens = tokenizeLine(trimmed);
  if (tokens.length === 0) return { type: 'Comment' };

  const command = tokens[0];

  try {
    if (command === 'Output') {
      if (tokens.length < 2) throw new Error('Output command requires a path');
      return { type: 'Output', path: tokens[1] };
    }

    if (command === 'Require') {
      if (tokens.length < 2) throw new Error('Require command requires a program name');
      return { type: 'Require', program: tokens[1] };
    }

    if (command === 'Set') {
      if (tokens.length < 3) throw new Error('Set command requires a setting name and value');
      const rawValue = tokens.slice(2).join(' ');
      const isQuoted = (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
                       (rawValue.startsWith('`') && rawValue.endsWith('`'));
      const value = isQuoted ? parseQuotedString(rawValue) : rawValue;
      return { type: 'Set', setting: tokens[1], value };
    }

    if (command === 'Type' || command.startsWith('Type@')) {
      let speed: number | undefined;
      if (command.includes('@')) {
        const speedStr = command.split('@')[1];
        speed = parseDuration(speedStr);
      }
      if (tokens.length < 2) throw new Error('Type command requires text to type');
      const text = parseQuotedString(tokens.slice(1).join(' '));
      return { type: 'Type', text, speed };
    }

    if (['Left', 'Right', 'Up', 'Down'].includes(command)) {
      const count = tokens.length > 1 ? parseInt(tokens[1], 10) : undefined;
      return { type: 'Key', key: command as 'Left' | 'Right' | 'Up' | 'Down', count };
    }

    if (['Backspace', 'Enter', 'Tab', 'Space'].includes(command)) {
      const count = tokens.length > 1 ? parseInt(tokens[1], 10) : undefined;
      return { type: 'Key', key: command as 'Backspace' | 'Enter' | 'Tab' | 'Space', count };
    }

    if (command.startsWith('Ctrl') || command.startsWith('Alt') || command.startsWith('Shift') || command.startsWith('Cmd')) {
      const parts = command.split('+');
      const ctrl = parts.includes('Ctrl');
      const alt = parts.includes('Alt');
      const shift = parts.includes('Shift');
      const cmd = parts.includes('Cmd');
      const key = parts[parts.length - 1];

      if (!key || key === 'Ctrl' || key === 'Alt' || key === 'Shift' || key === 'Cmd') {
        throw new Error('Shortcut command requires a key');
      }

      const count = tokens.length > 1 ? parseInt(tokens[1], 10) : undefined;
      return { type: 'Shortcut', ctrl, alt, shift, cmd, key, count };
    }

    if (command === 'Sleep') {
      if (tokens.length < 2) throw new Error('Sleep command requires a duration');
      return { type: 'Sleep', duration: parseDuration(tokens[1]) };
    }

    if (command === 'Wait' || command === 'WaitScreen' || command === 'WaitLine') {
      let condition: 'Screen' | 'Line' | undefined;
      const patternToken = tokens[1];

      if (command === 'WaitScreen') condition = 'Screen';
      else if (command === 'WaitLine') condition = 'Line';

      const pattern = patternToken ? parseRegex(patternToken) : undefined;
      return { type: 'Wait', condition, pattern };
    }

    if (command === 'Hide') return { type: 'Hide' };
    if (command === 'Show') return { type: 'Show' };

    if (command === 'Screenshot') {
      const path = tokens[1];
      return { type: 'Screenshot', path };
    }

    if (command === 'Copy') {
      if (tokens.length < 2) throw new Error('Copy command requires text to copy');
      const text = parseQuotedString(tokens.slice(1).join(' '));
      return { type: 'Copy', text };
    }

    if (command === 'Paste') return { type: 'Paste' };

    if (command === 'Source') {
      if (tokens.length < 2) throw new Error('Source command requires a file path');
      return { type: 'Source', file: tokens[1] };
    }

    if (command === 'Env') {
      if (tokens.length < 3) throw new Error('Env command requires a key and value');
      return { type: 'Env', key: tokens[1], value: tokens.slice(2).join(' ') };
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (err) {
    throw new CDParseError(
      err instanceof Error ? err.message : String(err),
      lineNumber,
      0
    );
  }
};


//#region Preprocessor

const preprocessMultilineBackticks = (content: string): string => {
  const result: string[] = [];
  const lines = content.split('\n');
  let inBacktickBlock = false;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBacktickBlock) {
      const backtickCount = (line.match(/`/g) || []).length;
      if (backtickCount === 1) {
        inBacktickBlock = true;
        blockLines = [line];
      } else {
        result.push(line);
      }
    } else {
      blockLines.push(line);
      const backtickCount = (line.match(/`/g) || []).length;
      if (backtickCount >= 1) {
        result.push(blockLines.join(BACKTICK_NEWLINE));
        inBacktickBlock = false;
        blockLines = [];
      }
    }
  }

  if (inBacktickBlock) result.push(...blockLines);

  return result.join('\n');
};


//#region Main Parser

export const parseCD = (content: string): CDScript => {
  const processedContent = preprocessMultilineBackticks(content);
  const lines = processedContent.split('\n');
  const commands: CDCommand[] = [];
  const settings = new Map<string, string>();
  const requirements: string[] = [];
  let output: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const command = parseCommand(lines[i], i + 1);

    if (command.type === 'Comment') continue;

    if (command.type === 'Output') output = command.path;
    else if (command.type === 'Require') requirements.push(command.program);
    else if (command.type === 'Set') settings.set(command.setting, command.value);

    commands.push(command);
  }

  return { commands, settings, output, requirements };
};

