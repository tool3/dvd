//#region Fullwidth Ranges

const FULLWIDTH_RANGES: [number, number][] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x231a, 0x231b], // Watch, Hourglass
  [0x2329, 0x232a], // Angle brackets
  [0x23e9, 0x23f3], // Various symbols
  [0x23f8, 0x23fa], // Playback symbols
  [0x25fd, 0x25fe], // Squares
  [0x2614, 0x2615], // Umbrella, Hot beverage
  [0x2648, 0x2653], // Zodiac
  [0x267f, 0x267f], // Wheelchair
  [0x2693, 0x2693], // Anchor
  [0x26a1, 0x26a1], // High voltage
  [0x26aa, 0x26ab], // Circles
  [0x26bd, 0x26be], // Soccer, Baseball
  [0x26c4, 0x26c5], // Snowman, Sun
  [0x26ce, 0x26ce], // Ophiuchus
  [0x26d4, 0x26d4], // No entry
  [0x26ea, 0x26ea], // Church
  [0x26f2, 0x26f3], // Fountain, Golf
  [0x26f5, 0x26f5], // Sailboat
  [0x26fa, 0x26fa], // Tent
  [0x26fd, 0x26fd], // Fuel pump
  [0x2702, 0x2702], // Scissors
  [0x2705, 0x2705], // Check mark
  [0x2708, 0x270d], // Various symbols
  [0x270f, 0x270f], // Pencil
  [0x2712, 0x2712], // Black nib
  [0x2714, 0x2714], // Check mark
  [0x2716, 0x2716], // X mark
  [0x271d, 0x271d], // Latin cross
  [0x2721, 0x2721], // Star of David
  [0x2728, 0x2728], // Sparkles
  [0x2733, 0x2734], // Eight spoked asterisk
  [0x2744, 0x2744], // Snowflake
  [0x2747, 0x2747], // Sparkle
  [0x274c, 0x274c], // Cross mark
  [0x274e, 0x274e], // Cross mark
  [0x2753, 0x2755], // Question marks
  [0x2757, 0x2757], // Exclamation
  [0x2763, 0x2764], // Heart exclamation, heart
  [0x2795, 0x2797], // Plus, minus, division
  [0x27a1, 0x27a1], // Right arrow
  [0x27b0, 0x27b0], // Curly loop
  [0x27bf, 0x27bf], // Double curly loop
  [0x2934, 0x2935], // Arrows
  [0x2b05, 0x2b07], // Arrows
  [0x2b1b, 0x2b1c], // Squares
  [0x2b50, 0x2b50], // Star
  [0x2b55, 0x2b55], // Circle
  [0x2e80, 0x2e99], // CJK Radicals
  [0x2e9b, 0x2ef3], // CJK Radicals
  [0x2f00, 0x2fd5], // Kangxi Radicals
  [0x2ff0, 0x2ffb], // Ideographic Description
  [0x3000, 0x303e], // CJK Symbols
  [0x3041, 0x3096], // Hiragana
  [0x3099, 0x30ff], // Katakana
  [0x3105, 0x312f], // Bopomofo
  [0x3131, 0x318e], // Hangul Compatibility
  [0x3190, 0x31e3], // Kanbun, Bopomofo Extended
  [0x31f0, 0x321e], // Katakana Phonetic, Enclosed CJK
  [0x3220, 0x3247], // Enclosed CJK
  [0x3250, 0x4dbf], // CJK Misc, Extensions
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa48c], // Yi Syllables
  [0xa490, 0xa4c6], // Yi Radicals
  [0xa960, 0xa97c], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical Forms
  [0xfe30, 0xfe52], // CJK Compatibility Forms
  [0xfe54, 0xfe66], // Small Form Variants
  [0xfe68, 0xfe6b], // Small Form Variants
  [0xff01, 0xff60], // Fullwidth ASCII
  [0xffe0, 0xffe6], // Fullwidth symbols
  [0x1b000, 0x1b001], // Kana Supplement
  [0x1f200, 0x1f251], // Enclosed Ideographic
  [0x1f300, 0x1f64f], // Misc Symbols, Emoticons
  [0x1f680, 0x1f6ff], // Transport/Map Symbols
  [0x1f900, 0x1f9ff], // Supplemental Symbols
  [0x20000, 0x2fffd], // CJK Extension B, C, D, E, F
  [0x30000, 0x3fffd], // CJK Extension G
];


//#region Zero-Width Ranges

const ZERO_WIDTH_RANGES: [number, number][] = [
  [0x0300, 0x036f], // Combining Diacriticals
  [0x0483, 0x0489], // Cyrillic combining
  [0x0591, 0x05bd], // Hebrew combining
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a], // Arabic combining
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711], // Syriac
  [0x0730, 0x074a],
  [0x07a6, 0x07b0], // Thaana
  [0x07eb, 0x07f3],
  [0x0816, 0x0819], // Samaritan
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0859, 0x085b], // Mandaic
  [0x08d4, 0x08e1], // Arabic Extended-A
  [0x08e3, 0x0902],
  [0x093a, 0x093a], // Devanagari
  [0x093c, 0x093c],
  [0x0941, 0x0948],
  [0x094d, 0x094d],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x0981, 0x0981], // Bengali
  [0x09bc, 0x09bc],
  [0x09c1, 0x09c4],
  [0x09cd, 0x09cd],
  [0x09e2, 0x09e3],
  [0x0a01, 0x0a02], // Gurmukhi
  [0x0a3c, 0x0a3c],
  [0x0a41, 0x0a42],
  [0x0a47, 0x0a48],
  [0x0a4b, 0x0a4d],
  [0x0a51, 0x0a51],
  [0x0a70, 0x0a71],
  [0x0a75, 0x0a75],
  [0x200b, 0x200f], // Zero width space, etc.
  [0x2028, 0x202e], // Line/paragraph separators
  [0x2060, 0x2064], // Word joiner, etc.
  [0x2066, 0x206f], // Directional formatting
  [0xfe00, 0xfe0f], // Variation Selectors
  [0xfeff, 0xfeff], // BOM
  [0xfff9, 0xfffb], // Interlinear annotation
  [0x1d167, 0x1d169], // Musical combining
  [0x1d173, 0x1d182],
  [0x1d185, 0x1d18b],
  [0x1d1aa, 0x1d1ad],
  [0xe0001, 0xe0001], // Language tag
  [0xe0020, 0xe007f], // Tag components
  [0xe0100, 0xe01ef], // Variation Selectors Supplement
];


//#region Range Lookup

const inRange = (codePoint: number, ranges: [number, number][]): boolean => {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const [start, end] = ranges[mid];

    if (codePoint < start) {
      high = mid - 1;
    } else if (codePoint > end) {
      low = mid + 1;
    } else {
      return true;
    }
  }

  return false;
};


//#region Width Functions

export const getCharWidth = (char: string): 0 | 1 | 2 => {
  if (!char || char.length === 0) return 0;

  const codePoint = char.codePointAt(0)!;

  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }

  if (inRange(codePoint, ZERO_WIDTH_RANGES)) {
    return 0;
  }

  if (inRange(codePoint, FULLWIDTH_RANGES)) {
    return 2;
  }

  return 1;
};

export const getStringWidth = (str: string): number => {
  let width = 0;

  for (const char of str) {
    width += getCharWidth(char);
  }

  return width;
};

export const isControlChar = (char: string): boolean => {
  if (!char || char.length === 0) return false;
  const code = char.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
};

