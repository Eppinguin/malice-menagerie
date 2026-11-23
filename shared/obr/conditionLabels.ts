/** Draw Steel conditions understood by Token Labels' built-in libraries.
 * Winded is derived from Stamina in Malice and is deliberately not imported.
 */
const CONDITIONS = [
  "Bleeding",
  "Dazed",
  "Frightened",
  "Grabbed",
  "Prone",
  "Restrained",
  "Slowed",
  "Taunted",
  "Weakened",
] as const;

/** Accept the upstream emoji and duration variants without importing free text. */
export function conditionFromLabel(text: string): string | null {
  const match = /^\s*([a-z]+)(?=\s|$)/i.exec(text);
  if (!match) return null;
  const condition = CONDITIONS.find((name) => name.toLowerCase() === match[1]?.toLowerCase());
  if (!condition) return null;
  const suffix = text.slice(match[0].length).trim();
  // Only the library's optional emoji, duration, and duration emoji are allowed.
  const plain = suffix.replace(/\p{Extended_Pictographic}|\p{Emoji_Component}/gu, "").trim();
  return /^(?:\((?:EoT|SE)\))?$/i.test(plain) ? condition : null;
}

export function sameConditions(a: readonly string[], b: readonly string[]): boolean {
  const normalize = (values: readonly string[]) =>
    [...new Set(values.map((value) => value.toLowerCase()))].sort().join("\n");
  return normalize(a) === normalize(b);
}

/** Keep app-only/custom conditions and preserve existing duration/emoji
 * suffixes on Malice conditions when accepting the supported label catalog. */
export function mergeLabelConditions(
  current: readonly string[],
  labels: readonly string[],
): string[] {
  const custom: string[] = [];
  const existingByCanonical = new Map<string, string>();
  for (const name of current) {
    const canonical = conditionFromLabel(name);
    if (!canonical) custom.push(name);
    else if (!existingByCanonical.has(canonical)) existingByCanonical.set(canonical, name);
  }
  const mergedLabels = labels.map((label) => {
    const canonical = conditionFromLabel(label);
    return canonical ? (existingByCanonical.get(canonical) ?? label) : label;
  });
  return [...custom, ...mergedLabels];
}
