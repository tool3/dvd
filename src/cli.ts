#!/usr/bin/env node

//#region Imports

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { renderCommand } from './commands/render';
import { pipeCommand } from './commands/pipe';
import { newCommand } from './commands/new';
import { themesCommand } from './commands/themes';
import { validateCommand } from './commands/validate';


//#region CLI Parser

const createParser = () =>
  yargs(hideBin(process.argv))
    .scriptName('dvd')
    .usage('$0 [options] <file>')
    .usage('')
    .usage('Create animated SVG terminal recordings from .cd scripts')
    .positional('file', {
      type: 'string',
      describe: '.cd script file to render',
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      describe: 'Output SVG file path',
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      describe: 'Verbose output',
      default: false,
    })
    .option('loop', {
      alias: 'l',
      type: 'boolean',
      describe: 'Loop animation',
      default: true,
    })
    .option('loop-style', {
      alias: 'L',
      type: 'string',
      choices: ['loop', 'reverse', 'rewind', 'fade'],
      describe: 'Animation loop style',
      default: 'loop',
    })
    .option('rewind-speed', {
      type: 'number',
      describe: 'Speed multiplier for rewind loop style',
      default: 5,
    })
    .option('pause-at-end', {
      alias: 'p',
      type: 'number',
      describe: 'Pause duration at end (ms)',
      default: 1000,
    })
    .option('loop-pause', {
      type: 'number',
      describe: 'Pause duration before loop restarts (ms)',
      default: 0,
    })
    .option('fade-duration', {
      type: 'number',
      describe: 'Fade duration for fade loop style (ms)',
      default: 1500,
    })
    .option('fps', {
      alias: 'f',
      type: 'number',
      describe: 'Frames per second',
    })
    .option('width', {
      alias: 'W',
      type: 'number',
      describe: 'Output width in pixels (auto-detected if not specified)',
    })
    .option('height', {
      alias: 'H',
      type: 'number',
      describe: 'Output height in pixels (auto-detected if not specified)',
    })
    .option('title', {
      type: 'string',
      alias: 't',
      describe: 'Window title text',
    })
    .option('theme', {
      alias: 'T',
      type: 'string',
      choices: ['dark', 'dracula', 'nord', 'monokai', 'oneDark', 'catppuccinMocha', 'tokyoNight'],
      describe: 'Color theme',
      default: 'dark',
    })
    .option('font-size', {
      type: 'number',
      describe: 'Font size in pixels',
      default: 14,
    })
    .option('line-height', {
      type: 'number',
      describe: 'Line height multiplier',
      default: 1.4,
    })
    .option('template', {
      type: 'string',
      choices: ['macos', 'windows', 'minimal'],
      describe: 'Window template style',
      default: 'macos',
    })
    .option('padding', {
      type: 'number',
      describe: 'Content padding in pixels',
      default: 16,
    })
    .option('border-radius', {
      type: 'number',
      describe: 'Window border radius in pixels',
      default: 8,
    })
    .option('border-color', {
      type: 'string',
      describe: 'Border color (hex)',
    })
    .option('border-width', {
      type: 'number',
      describe: 'Border width in pixels',
    })
    .option('font-family', {
      type: 'string',
      describe: 'Custom font family name',
    })
    .option('watermark', {
      type: 'string',
      describe: 'Watermark text',
    })
    .option('cursor-style', {
      type: 'string',
      choices: ['block', 'bar', 'underline'],
      describe: 'Cursor style',
      default: 'block',
    })
    .option('cursor-color', {
      type: 'string',
      describe: 'Cursor color (hex)',
    })
    .option('cursor-blink', {
      type: 'boolean',
      describe: 'Enable cursor blinking',
      default: true,
    })
    .option('header-background', {
      type: 'string',
      describe: 'Header background color (hex)',
    })
    .option('header-height', {
      type: 'number',
      describe: 'Header height in pixels',
    })
    .option('header-border', {
      type: 'boolean',
      describe: 'Show header border',
    })
    .option('header-border-color', {
      type: 'string',
      describe: 'Header border color (hex)',
    })
    .option('header-border-width', {
      type: 'number',
      describe: 'Header border width in pixels',
    })
    .option('footer-background', {
      type: 'string',
      describe: 'Footer background color (hex)',
    })
    .option('footer-height', {
      type: 'number',
      describe: 'Footer height in pixels',
    })
    .option('footer-border', {
      type: 'boolean',
      describe: 'Show footer border',
    })
    .option('footer-border-color', {
      type: 'string',
      describe: 'Footer border color (hex)',
    })
    .option('footer-border-width', {
      type: 'number',
      describe: 'Footer border width in pixels',
    })
    .command(
      'new [name]',
      'Create a new .cd script from template',
      (yargs) =>
        yargs
          .positional('name', {
            type: 'string',
            describe: 'Name for new script',
            default: 'demo',
          })
          .option('template', {
            alias: 't',
            type: 'string',
            choices: ['basic', 'showcase', 'keyboard'],
            describe: 'Template to use',
            default: 'basic',
          }),
      async (args) => {
        try {
          await newCommand(args as any);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    )
    .command(
      'themes',
      'List available themes',
      {},
      () => {
        try {
          themesCommand();
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    )
    .command(
      'validate <file>',
      'Validate a .cd script',
      (yargs) =>
        yargs.positional('file', {
          type: 'string',
          describe: '.cd script file to validate',
          demandOption: true,
        }),
      async (args) => {
        try {
          await validateCommand(args as any);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    )
    .example('$0 demo.cd', 'Render demo.cd to demo.svg')
    .example('$0 script.cd -o output.svg', 'Render with custom output')
    .example('command | $0 -o output.svg', 'Read from stdin (auto-detected)')
    .example('$0 new my-demo --template showcase', 'Create new script from template')
    .example('$0 themes', 'List available themes')
    .example('$0 validate script.cd', 'Validate a script')
    .demandCommand(0)
    .help()
    .alias('help', 'h')
    .version()
    .alias('version', 'V')
    .wrap(Math.min(100, process.stdout.columns || 80))
    .showHelpOnFail(true);


//#region Main Entry

const run = async (): Promise<void> => {
  const parser = createParser();
  const argv = await parser.parse();

  const subcommands = ['new', 'themes', 'validate'];
  const ranSubcommand = subcommands.some((cmd) => argv._.includes(cmd));

  if (ranSubcommand) {
    return;
  }

  const file = argv._[0] as string | undefined;

  const isPiped = !process.stdin.isTTY;

  if (file === '-' || (isPiped && !file)) {
    try {
      await pipeCommand({
        output: argv.output,
        verbose: argv.verbose,
        loop: argv.loop,
        'pause-at-end': argv['pause-at-end'],
        'loop-pause': argv['loop-pause'],
        'fade-duration': argv['fade-duration'],
        'rewind-speed': argv['rewind-speed'],
        'loop-style': argv['loop-style'] as 'loop' | 'reverse' | 'rewind' | 'fade',
        width: argv.width,
        height: argv.height,
        title: argv.title,
        theme: argv.theme,
        fontSize: argv['font-size'],
        lineHeight: argv['line-height'],
        template: argv.template as string,
        padding: argv.padding,
        borderRadius: argv['border-radius'],
        borderColor: argv['border-color'],
        borderWidth: argv['border-width'],
        fontFamily: argv['font-family'],
        watermark: argv.watermark,
        cursorStyle: argv['cursor-style'],
        cursorColor: argv['cursor-color'],
        cursorBlink: argv['cursor-blink'],
        headerBackground: argv['header-background'],
        headerHeight: argv['header-height'],
        headerBorder: argv['header-border'],
        headerBorderColor: argv['header-border-color'],
        headerBorderWidth: argv['header-border-width'],
        footerBackground: argv['footer-background'],
        footerHeight: argv['footer-height'],
        footerBorder: argv['footer-border'],
        footerBorderColor: argv['footer-border-color'],
        footerBorderWidth: argv['footer-border-width'],
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    return;
  }

  if (!file) {
    parser.showHelp();
    process.exit(0);
  }

  try {
    await renderCommand({
      file,
      output: argv.output,
      verbose: argv.verbose,
      loop: argv.loop,
      'pause-at-end': argv['pause-at-end'],
      'loop-pause': argv['loop-pause'],
      'fade-duration': argv['fade-duration'],
      'rewind-speed': argv['rewind-speed'],
      fps: argv.fps,
      'loop-style': argv['loop-style'] as 'loop' | 'reverse' | 'rewind' | 'fade',
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
};

run();

