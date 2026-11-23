/**
 * Parses a Stamina command entered by the Director:
 * - `-12` / `−12`: deal 12 damage (relative subtract)
 * - `+5`: heal 5 (relative add)
 * - `45-12` / `45+5`: appended inline arithmetic (common when clicking at the end of displayed Stamina)
 * - `=20` or `20`: set Stamina directly to 20
 */
export interface ParsedStamina {
  next: number;
  kind: "damage" | "heal" | "set";
  delta: number;
}

const normalizeMinus = (raw: string): string => raw.replace(/[−–—]/g, "-").trim();

export function parseStaminaCommand(rawValue: string, current: number): ParsedStamina | null {
  const raw = normalizeMinus(rawValue);
  if (!raw) return null;

  // Leading +/- relative delta: "-12", "+5"
  const relative = /^([+-])\s*(\d+(?:\.\d+)?)$/.exec(raw);
  if (relative) {
    const sign = relative[1] === "-" ? -1 : 1;
    const amount = Number(relative[2]);
    if (!Number.isFinite(amount)) return null;
    const delta = sign * amount;
    const next = Math.round(current + delta);
    return { next, kind: delta < 0 ? "damage" : "heal", delta: Math.round(Math.abs(delta)) };
  }

  // Appended arithmetic: "45-12", "45 + 5"
  const expr = /^(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)$/.exec(raw);
  if (expr) {
    const base = Number(expr[1]);
    const sign = expr[2] === "-" ? -1 : 1;
    const amount = Number(expr[3]);
    if (!Number.isFinite(base) || !Number.isFinite(amount)) return null;
    const next = Math.round(base + sign * amount);
    const diff = next - current;
    return {
      next,
      kind: diff < 0 ? "damage" : diff > 0 ? "heal" : "set",
      delta: Math.abs(diff),
    };
  }

  // Explicit or bare set: "=20" or "20"
  const exact = /^=?\s*(\d+(?:\.\d+)?)$/.exec(raw);
  if (exact) {
    const next = Math.round(Number(exact[1]));
    if (!Number.isFinite(next)) return null;
    return { next, kind: "set", delta: Math.abs(next - current) };
  }

  return null;
}
