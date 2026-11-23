import { describeError } from "./errors.ts";

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 4_000];
export const ITEM_BATCH_SIZE = 50;

/** Only retry explicit rate-limit rejections. Never replay an ambiguous
 * network failure or a validation error that waiting cannot fix. */
export async function withRateLimitRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
      const limited =
        record?.status === 429 ||
        record?.code === 429 ||
        /too many requests|rate[ -]?limit|(?:http|status|code|error)\s*:?\s*429\b/i.test(
          describeError(error, ""),
        );
      const delay = RETRY_DELAYS_MS[attempt];
      if (!limited || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
