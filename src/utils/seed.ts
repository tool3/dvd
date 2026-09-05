export type Seed = string | string[];

export const resolveSeedLines = (seed?: Seed): string[] => {
  if (seed === undefined) return [];
  if (Array.isArray(seed)) return seed;
  return seed.length === 0 ? [] : seed.replace(/\n$/, '').split('\n');
};

export const resolveSeedText = (seed?: Seed): string =>
  resolveSeedLines(seed).join('\n');
