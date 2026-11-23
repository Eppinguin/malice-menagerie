/**
 * Per-minion Stamina to write into Seamus's group record.
 *
 * Malice knows how many minions a squad really has, so prefer the split it
 * sends. The fallback keeps an update from an older sender working: divide the
 * pool by the tokens this scene can see. That fallback is also why the split is
 * sent at all — extra tokens a GM added in Owlbear would otherwise make every
 * minion's maximum look smaller than it is.
 */
export function individualStaminaFor(
  update: { individualStamina?: number | null; maxStamina: number },
  tokenCount: number,
): number {
  const declared = update.individualStamina;
  if (typeof declared === "number" && Number.isFinite(declared) && declared > 0)
    return Math.max(1, Math.round(declared));
  return Math.max(1, Math.round(update.maxStamina / Math.max(1, tokenCount)));
}
