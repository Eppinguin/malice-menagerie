import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { trackDicePresentation } from "../rollTiming.ts";

let frame: FrameRequestCallback;
const report = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(4000);
  report.mockReset();
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("separates waiting for the roller from return delivery and state application", async () => {
  const applied = trackDicePresentation(1000, { requestedAt: 1010, resultAt: 3900 }, report);
  vi.advanceTimersByTime(2);
  applied();
  expect(report).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(report).toHaveBeenCalledWith(
    "Roll timing: outbound 10ms · Connected Dice 2890ms · return 100ms · Malice state 2ms · render queue 0ms (visible).",
  );
  frame(0);
  vi.advanceTimersByTime(500);
  expect(report).toHaveBeenCalledTimes(1);
});
it("identifies hidden-tab rendering delay without waiting to apply the roll", async () => {
  vi.stubGlobal("document", { visibilityState: "hidden" });
  const apply = vi.fn();
  const applied = trackDicePresentation(1000, undefined, report);
  apply();
  applied();
  expect(apply).toHaveBeenCalledOnce();
  expect(requestAnimationFrame).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(250);
  expect(report).toHaveBeenCalledWith("No roll frame within 250ms of state update (hidden).");
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
});
it("logs a late frame separately from the result delivery", async () => {
  trackDicePresentation(1000, undefined, report)();
  await Promise.resolve();
  // Model an occupied main thread: the frame arrives before the delayed timer.
  vi.spyOn(performance, "now").mockReturnValue(350);
  frame(350);
  expect(report).toHaveBeenCalledWith("Roll frame delayed 350ms after state update (visible).");
  vi.advanceTimersByTime(500);
  expect(report).toHaveBeenCalledTimes(2);
});
