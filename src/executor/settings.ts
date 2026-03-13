//#region Imports

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExecutorContext, WatermarkConfig } from './types';
import { parseEscapes } from './types';
import { themes as pipelineThemes } from '../pipeline';
import { themes as shellfieThemes } from 'shellfie';


//#region Setting Application

export const applySetting = (ctx: ExecutorContext, key: string, value: string): void => {
  const handlers: Record<string, () => void> = {
    Width: () => {
      ctx.width = parseInt(value, 10);
      ctx.autoWidth = false;
    },
    Height: () => {
      ctx.height = parseInt(value, 10);
      ctx.autoHeight = false;
    },
    FontSize: () => {
      ctx.fontSize = parseInt(value, 10);
    },
    LineHeight: () => {
      ctx.lineHeight = parseFloat(value);
      ctx.hasCustomLineHeight = true;
    },
    TypingSpeed: () => {
      ctx.typingSpeed = parseInt(value, 10);
    },
    Title: () => {
      ctx.title = value;
    },
    Template: () => {
      ctx.template = value as 'macos' | 'windows' | 'minimal';
    },
    Theme: () => {
      resolveTheme(ctx, value);
    },
    PromptPrefix: () => {
      ctx.promptPrefix = parseEscapes(value);
    },
    Watermark: () => {
      setWatermarkContent(ctx, parseEscapes(value));
    },
    WaterMark: () => {
      setWatermarkContent(ctx, parseEscapes(value));
    },
    WatermarkStyle: () => {
      setWatermarkStyleString(ctx, value);
    },
    CursorBlink: () => {
      ctx.cursorBlink = value.toLowerCase() !== 'false';
    },
    Scroll: () => {
      ctx.scroll = value.toLowerCase() === 'true';
      if (ctx.scroll) ctx.autoHeight = false;
    },
    HeaderBackground: () => {
      ctx.headerBackground = value;
    },
    FooterBackground: () => {
      ctx.footerBackground = value;
    },
    BorderColor: () => {
      ctx.borderColor = value;
    },
    BorderWidth: () => {
      ctx.borderWidth = parseInt(value, 10);
    },
    BorderRadius: () => {
      ctx.borderRadius = parseInt(value, 10);
    },
    Padding: () => {
      ctx.padding = parseInt(value, 10);
    },
    HeaderHeight: () => {
      ctx.headerHeight = parseInt(value, 10);
    },
    HeaderBorder: () => {
      ctx.headerBorder = value.toLowerCase() === 'true';
    },
    HeaderBorderColor: () => {
      ctx.headerBorderColor = value;
    },
    HeaderBorderWidth: () => {
      ctx.headerBorderWidth = parseInt(value, 10);
    },
    FooterHeight: () => {
      ctx.footerHeight = parseInt(value, 10);
    },
    FooterBorder: () => {
      ctx.footerBorder = value.toLowerCase() === 'true';
    },
    FooterBorderColor: () => {
      ctx.footerBorderColor = value;
    },
    FooterBorderWidth: () => {
      ctx.footerBorderWidth = parseInt(value, 10);
    },
    CursorStyle: () => {
      const style = value.toLowerCase();
      if (style === 'block' || style === 'bar' || style === 'underline') {
        ctx.cursorStyle = style;
      }
    },
    CursorColor: () => {
      ctx.cursorColor = value;
    },
    FontFamily: () => {
      ctx.fontFamily = value;
    },
    EmbedFont: () => {
      embedFontFromPath(ctx, value);
    },
    Shell: () => {
      ctx.shell = value;
    },
    CharWidthRatio: () => {
      ctx.charWidthRatio = parseFloat(value);
    },
    AnimationSpeed: () => {
      ctx.animationSpeed = parseInt(value, 10);
    },
    LoopStyle: () => {
      const style = value.toLowerCase();
      if (style === 'loop' || style === 'reverse' || style === 'rewind' || style === 'fade') {
        ctx.loopStyle = style;
      }
    },
    LoopPause: () => {
      ctx.loopPause = parseInt(value, 10);
    },
    FadeDuration: () => {
      ctx.fadeDuration = parseInt(value, 10);
    },
    RewindSpeed: () => {
      ctx.rewindSpeed = parseFloat(value);
    },
  };

  const handler = handlers[key];
  if (handler) handler();
};


//#region Theme Resolution

export const resolveTheme = (ctx: ExecutorContext, themeName: string): void => {
  const pipelineTheme = pipelineThemes[themeName as keyof typeof pipelineThemes];
  if (pipelineTheme) {
    ctx.theme = pipelineTheme;
    return;
  }

  let name = themeName as keyof typeof shellfieThemes;
  if (!shellfieThemes[name]) {
    const camelCase = themeName.replace(/-([a-z])/g, (_, letter) =>
      letter.toUpperCase()
    ) as keyof typeof shellfieThemes;
    if (shellfieThemes[camelCase]) {
      name = camelCase;
    }
  }

  if (shellfieThemes[name]) {
    const st = shellfieThemes[name];
    ctx.theme = {
      name: themeName,
      background: st.background,
      foreground: st.foreground,
      cursor: st.cursor,
      selection: st.selection,
      black: st.black,
      red: st.red,
      green: st.green,
      yellow: st.yellow,
      blue: st.blue,
      magenta: st.magenta,
      cyan: st.cyan,
      white: st.white,
      brightBlack: st.brightBlack,
      brightRed: st.brightRed,
      brightGreen: st.brightGreen,
      brightYellow: st.brightYellow,
      brightBlue: st.brightBlue,
      brightMagenta: st.brightMagenta,
      brightCyan: st.brightCyan,
      brightWhite: st.brightWhite,
    };
  }
};


//#region Font Embedding

export const embedFontFromPath = (ctx: ExecutorContext, fontPath: string): void => {
  try {
    const resolvedPath = resolve(fontPath);

    if (!existsSync(resolvedPath)) {
      console.warn(`Font file not found: ${resolvedPath}`);
      return;
    }

    const fontBuffer = readFileSync(resolvedPath);
    ctx.fontData = fontBuffer.toString('base64');
    ctx.embedFont = true;
  } catch (err) {
    console.warn(`Failed to embed font: ${err}`);
  }
};


//#region Watermark Helpers

const ensureWatermarkConfig = (ctx: ExecutorContext): WatermarkConfig => {
  if (typeof ctx.watermark === 'string') {
    ctx.watermark = { content: ctx.watermark };
  } else if (!ctx.watermark) {
    ctx.watermark = { content: '' };
  }
  return ctx.watermark;
};

const setWatermarkContent = (ctx: ExecutorContext, content: string): void => {
  if (typeof ctx.watermark === 'string' || !ctx.watermark) {
    ctx.watermark = { content };
  } else {
    ctx.watermark.content = content;
  }
};

const setWatermarkStyleString = (ctx: ExecutorContext, styleStr: string): void => {
  const config = ensureWatermarkConfig(ctx);
  if (!config.style) {
    config.style = {};
  }

  // Parse CSS-like style string: "opacity: 0.5; padding: 10"
  const pairs = styleStr.split(';').map(s => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const [key, value] = pair.split(':').map(s => s.trim());
    if (key && value) {
      const numValue = parseFloat(value);
      config.style[key] = isNaN(numValue) ? value : numValue;
    }
  }
};

