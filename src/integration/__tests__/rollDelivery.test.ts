import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { monsterCache } from "../../data.ts";
import { lastRolls, rollFeature, sharedRollActive, toastState } from "../../store.ts";
import { setDiceTransport, type SharedDiceResult } from "../../lib/rollTransport.ts";
import type { Monster } from "../../types.ts";

const monster: Monster = {
  id: "test-monster",
  path: "test-monster.json",
  book: "",
  familyPath: "",
  slug: "test",
  name: "Test",
  level: 1,
  organization: "Horde",
  role: "Brute",
  ev: 3,
  evLabel: "3",
  defaultQty: 1,
  keywords: [],
  ancestry: "",
  size: 1,
  speed: 5,
  stamina: 10,
  stability: 0,
  freeStrike: 2,
  movement: "",
  immunities: [],
  weaknesses: [],
  withCaptain: "",
  turnsPerRound: 1,
  chars: { M: 3, A: 0, R: 0, I: 0, P: 0 },
  features: [
    { name: "Strike", effects: [{ roll: "Power Roll + 3", tier1: "4", tier2: "6", tier3: "8" }] },
  ],
  source: "",
  raw: {},
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  monsterCache.set(monster.path, monster);
  lastRolls.value = new Map();
});
afterEach(async () => {
  await flush();
  setDiceTransport(() => null);
  monsterCache.delete(monster.path);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("applies received dice in the same microtask turn without a timer or animation frame", async () => {
  let deliver!: (result: SharedDiceResult) => void;
  const applied = vi.fn(() => {
    expect(lastRolls.value.get("test-monster|0|0")?.dice).toEqual([7, 8]);
  });
  setDiceTransport(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const random = vi.spyOn(Math, "random");
  rollFeature(monster.path, 0, 0, "edge");
  expect(lastRolls.value.size).toBe(0);
  deliver({ dice: [7, 8], onApplied: applied });
  await flush();
  expect(lastRolls.value.get("test-monster|0|0")).toMatchObject({
    dice: [7, 8],
    total: 20,
    tier: 3,
    bonus: 5,
  });
  expect(applied).toHaveBeenCalledOnce();
  expect(random).not.toHaveBeenCalled();
  expect(vi.getMockedSystemTime()).toBeDefined();
});
it("reports a delivery failure without inventing a replacement local roll and keeps long errors visible longer", async () => {
  setDiceTransport(() =>
    Promise.reject(
      new Error("Connected Dice is unavailable. Reconnect or disconnect dice in settings."),
    ),
  );
  const random = vi.spyOn(Math, "random");
  rollFeature(monster.path, 0, 0);
  expect(sharedRollActive.value).toBe(true);
  await flush();
  expect(sharedRollActive.value).toBe(false);
  expect(lastRolls.value.size).toBe(0);
  expect(random).not.toHaveBeenCalled();
  expect(toastState.value.message).toBe(
    "Connected Dice is unavailable. Reconnect or disconnect dice in settings.",
  );
  expect(toastState.value.shown).toBe(true);
  vi.advanceTimersByTime(2_500);
  expect(toastState.value.shown).toBe(true);
  vi.advanceTimersByTime(2_000);
  expect(toastState.value.shown).toBe(false);
});
