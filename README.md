# DVD

<p align="center">
  <img alt="Demo" src="examples/svgs/dvd.svg" width="500">
</p>
<p align="center">to</p>
<p align="center">
  <img alt="Demo" src="examples/svgs/figlet.svg" width="500">
</p>

<p align="center">
  <strong>Create animated SVG terminal recordings from simple scripts</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#commands">Commands</a> •
  <a href="#settings">Settings</a> •
  <a href="#examples">Examples</a>
</p>

---

DVD generates animated SVG terminal recordings from declarative scripts. Write what you want to happen, run `dvd`, and get a beautiful, scalable animation.

```
Output demo.svg

Set Theme dracula
Set Template macos
Set Title "My Demo"

Type "echo 'Hello, World!'"
Enter
Sleep 2s
```

**No ffmpeg. No browser. No dependencies. Just SVG.**

## Installation

```bash
npm install -g dvd-cli
```

## Quick Start

```bash
# Create a new script
dvd new demo

# Edit it to your liking, then render
dvd demo.cd
```

Your animated SVG is ready to embed anywhere:

```markdown
![Demo](demo.svg)
```

## Commands

### Type

Type text with realistic timing. Control speed with `@<ms>ms` suffix.

```
Type "echo 'Hello World'"
Type@100ms "Slow typing..."
Type@10ms "Speed typing!"
```

<img src="examples/svgs/slow-typing-test.svg" width="600">

### Enter

Execute the current command.

```
Type "neofetch"
Enter
```

<img src="examples/svgs/neofetch-autoheight.svg" width="600">

### Sleep

Pause the recording.

```
Sleep 500ms
Sleep 2s
```

### Backspace

Delete characters. Supports a count parameter.

```
Type "Hello Wrold"
Backspace 4
Type "orld!"
```

<img src="examples/svgs/backspace.svg" width="600">

### Arrow Keys

Navigate with arrow keys. Supports a count parameter.

```
Left          # Move cursor left
Right         # Move cursor right
Left 5        # Move cursor left 5 times
Right 10      # Move cursor right 10 times
```

### Keyboard Shortcuts

Full keyboard navigation with selection support. All shortcuts support a count parameter.

```
Shift+Left           # Select character left
Shift+Right          # Select character right
Shift+Left 5         # Select 5 characters left
Alt+Left             # Move word left
Alt+Right            # Move word right
Alt+Shift+Left       # Select word left
Alt+Shift+Right      # Select word right
Cmd+Left             # Move to line start
Cmd+Right            # Move to line end
Cmd+Backspace        # Delete word
```

<img src="examples/svgs/word-selection-test.svg" width="600">

<img src="examples/svgs/keyboard-navigation-demo.svg" width="600">

### Screenshot

Capture a static frame at any point.

```
Type "npm test"
Enter
Screenshot test-results.svg
```

## Settings

### Output

Set the output file path.

```
Output demo.svg
```

### Theme

Set the color theme.

```
Set Theme dracula
```

**Available themes (37):** `a11yDark`, `base16Dark`, `base16Light`, `blackboard`, `catppuccinMocha`, `cobalt`, `dark`, `dracula`, `draculaPro`, `duotoneDark`, `githubDark`, `githubLight`, `gruvboxDark`, `gruvboxLight`, `hopscotch`, `lucario`, `material`, `monokai`, `night3024`, `nord`, `oceanicNext`, `oneDark`, `oneLight`, `pandaSyntax`, `paraisoDark`, `seti`, `shadesOfPurple`, `solarizedDark`, `solarizedLight`, `synthwave84`, `terminal`, `tokyoNight`, `twilight`, `verminal`, `vscode`, `yeti`, `zenburn`

<img src="examples/svgs/nord-theme.svg" width="600">

<img src="examples/svgs/theme-test.svg" width="600">

### Template

Set the window chrome style.

```
Set Template macos     # macOS traffic lights
Set Template windows   # Windows-style buttons
Set Template minimal   # No decorations (default)
```

<table>
<tr>
<td><strong>macOS</strong></td>
<td><strong>Windows</strong></td>
</tr>
<tr>
<td><img src="examples/svgs/macos-style.svg" width="400"></td>
<td><img src="examples/svgs/windows-style.svg" width="400"></td>
</tr>
</table>

### Dimensions

Set terminal size. Omit for auto-sizing based on content.

```
Set Width 800
Set Height 600
```

### Font

Set font family or embed a custom font for guaranteed rendering.

```
# System font (viewer must have it)
Set FontFamily "Fira Code"

# Embedded font (always works)
Set EmbedFont path/to/font.woff2
```

<img src="examples/svgs/embed-font-test.svg" width="600">

### Title

Set the window title (shown with macos/windows templates).

```
Set Title "My Terminal"
```

### Cursor

Customize cursor appearance.

```
Set CursorStyle block      # block, bar, underline
Set CursorColor #ffffff
Set CursorBlink true
```

<img src="examples/svgs/cursor-style-test.svg" width="600">

<img src="examples/svgs/underline-cursor-test.svg" width="600">

### Typing Speed

Control default typing speed in milliseconds per character.

```
Set TypingSpeed 50
```

### Prompt

Customize the shell prompt. Supports ANSI escape codes.

```
Set PromptPrefix "$ "
Set PromptPrefix "❯ "
Set PromptPrefix "\x1b[95m❯\x1b[0m "    # Colored prompt
```

<img src="examples/svgs/custom-prompt.svg" width="600">

### Border

Style the window border.

```
Set BorderRadius 8
Set BorderWidth 2
Set BorderColor #ff0000
```

<img src="examples/svgs/border-test.svg" width="600">

### Header & Footer

Customize header and footer sections.

```
Set HeaderHeight 40
Set HeaderBackground #333333
Set HeaderBorder true

Set FooterHeight 30
Set FooterBackground #333333
Set FooterBorder true
```

<img src="examples/svgs/header-footer-test.svg" width="600">

### Watermark

Add a watermark in the corner with optional styling.

```
Set Watermark "Made with DVD"
Set WatermarkStyle "opacity: 0.5; padding: 10"
```

For SVG markup watermarks (e.g., clickable links), use backticks for multiline content:

```
Set Watermark `<a href="https://github.com">
  <text text-anchor="end">GitHub</text>
</a>`
```

## CLI Options

```bash
# Render a script
dvd script.cd
dvd script.cd -o output.svg
dvd script.cd --verbose

# Animation options
dvd script.cd --no-loop
dvd script.cd --pause-at-end 2000

# Create new script
dvd new myproject
dvd new myproject --template showcase

# Utilities
dvd themes              # List available themes
dvd validate script.cd  # Validate without rendering
```

## Examples

### Demo

A simple hello world animation.

<img src="examples/svgs/demo.svg" width="600">

### ANSI Colors

Full ANSI color support with 256 colors and truecolor.

<img src="examples/svgs/ansi-colors.svg" width="600">

### ASCII Art with Figlet

<img src="examples/svgs/figlet.svg" width="600">

### Charts with Chartscii

<img src="examples/svgs/chartscii.svg" width="600">

### Rainbow Animation

Commands with animated output are automatically captured frame-by-frame.

<img src="examples/svgs/rainbow-lolcat.svg" width="600">

### Git Log

<img src="examples/svgs/git-log.svg" width="600">

### System Info

<img src="examples/svgs/neofetch-theme-cursor.svg" width="600">

### Emoji Support

Full emoji support including skin tones and ZWJ sequences.

<img src="examples/svgs/emoji-test.svg" width="600">

### Text Selection

Interactive text selection and editing.

<img src="examples/svgs/selection-test.svg" width="600">

### Word Navigation

<img src="examples/svgs/word-navigation-test.svg" width="600">

### Multiple Font Sizes

<img src="examples/svgs/font-sizes.svg" width="600">

### Color Tables

<img src="examples/svgs/colors-table.svg" width="600">

### Directory Listing

<img src="examples/svgs/ls-colors.svg" width="600">

See the [examples/](examples/) directory for all scripts and outputs.

## Why DVD?

| | DVD | VHS | asciinema |
|---|:---:|:---:|:---:|
| **Output** | SVG | GIF/MP4 | asciicast |
| **Dependencies** | None | ffmpeg, ttyd | Player embed |
| **File size** | Small | Large | Small |
| **Scalable** | ✓ | ✗ | ✓ |
| **GitHub README** | Perfect | Works | Embed only |
| **Editable** | ✓ (XML) | ✗ | ✓ (JSON) |
| **Offline** | ✓ | ✓ | ✗ |
| **Print quality** | ✓ | ✗ | ✗ |

## Related Projects

- [VHS](https://github.com/charmbracelet/vhs) - GIF/MP4 terminal recordings
- [shellfie](https://github.com/tool3/shellfie) - shellfie in code
- [shellfie-cli](https://github.com/tool3/shellfie-cli) - shellfie in commandl line
- [shellfied](https://github.com/tool3/shellfied) - shellfie in the web

## License

MIT
