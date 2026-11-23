import { afterEach, describe, expect, it, vi } from "vitest";
import { withRateLimitRetry } from "../../../obr/src/requests.ts";

afterEach(() => vi.useRealTimers());

describe("Owlbear rate-limit recovery", () => {
  it.each(["Too many requests", { error: { message: "Too many requests" } }, { status: 429 }])(
    "waits and retries a rate-limit rejection: %j",
    async (error) => {
      vi.useFakeTimers();
      const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("done");
      const result = withRateLimitRetry(operation);
      expect(operation).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(499);
      expect(operation).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe("done");
      expect(operation).toHaveBeenCalledTimes(2);
    },
  );

  it("does not retry validation errors or ambiguous transport failures", async () => {
    for (const error of [new Error("Invalid image URL"), new Error("Connection closed")]) {
      const operation = vi.fn().mockRejectedValue(error);
      await expect(withRateLimitRetry(operation)).rejects.toBe(error);
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it("backs off and eventually reports a persistent limit", async () => {
    vi.useFakeTimers();
    const operation = vi.fn().mockRejectedValue("Too many requests");
    const result = withRateLimitRetry(operation);
    const failure = expect(result).rejects.toBe("Too many requests");
    await vi.runAllTimersAsync();
    await failure;
    expect(operation).toHaveBeenCalledTimes(6);
  });
});
