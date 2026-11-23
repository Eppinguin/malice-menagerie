import type { DiceRollResponse } from "../../shared/obr/protocol.ts";

/** Observe delivery, state update, and the next rendering opportunity separately.
 * Nothing awaits a timer or animation frame before applying the actual roll.
 */
export function trackDicePresentation(
  requestedAt: number,
  timing: DiceRollResponse["timing"],
  report: (line: string) => void,
): () => void {
  const receivedAt = Date.now();
  const received = performance.now();
  const stages = timing
    ? `outbound ${Math.max(0, timing.requestedAt - requestedAt)}ms · Connected Dice ${timing.resultAt - timing.requestedAt}ms · return ${Math.max(0, receivedAt - timing.resultAt)}ms`
    : `Connected Dice + bridge ${Math.max(0, receivedAt - requestedAt)}ms`;
  return () => {
    const applied = performance.now();
    const stateMs = Math.round(applied - received);
    // Logging persists preferences. Run it after Preact's queued update, so it
    // cannot block rendering the new total and tier.
    queueMicrotask(() => {
      const renderedMs = Math.round(performance.now() - applied);
      report(
        `Roll timing: ${stages} · Malice state ${stateMs}ms · render queue ${renderedMs}ms (${document.visibilityState}).`,
      );
    });
    const frame = requestAnimationFrame(() => {
      clearTimeout(watchdog);
      const elapsed = Math.round(performance.now() - applied);
      if (elapsed >= 250)
        report(`Roll frame delayed ${elapsed}ms after state update (${document.visibilityState}).`);
    });
    // A hidden tab may not get another frame until the Director switches back.
    // Bound the measurement and report that fact instead of retaining callbacks.
    const watchdog = setTimeout(() => {
      cancelAnimationFrame(frame);
      report(
        `No roll frame within ${Math.round(performance.now() - applied)}ms of state update (${document.visibilityState}).`,
      );
    }, 250);
  };
}
