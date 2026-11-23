import { describe, expect, it } from "vitest";
import { clampStamina, decideExternalUpdate, hasPendingLocalChange } from "../syncPolicy.ts";

function decide(overrides: Partial<Parameters<typeof decideExternalUpdate>[0]> = {}) {
  return decideExternalUpdate({
    kind: "creature",
    currentStamina: 10,
    maxStamina: 20,
    updateCurrentStamina: 12,
    updateMaxStamina: 20,
    dirty: false,
    ...overrides,
  });
}

describe("stamina clamping", () => {
  it("rounds and floors at zero", () => {
    expect(clampStamina(4.6, 20, "creature")).toBe(5);
    expect(clampStamina(-8, 20, "creature")).toBe(0);
    expect(clampStamina(Number.NaN, 20, "creature")).toBe(0);
    expect(clampStamina(Number.POSITIVE_INFINITY, 20, "creature")).toBe(0);
  });

  it("caps a minion squad at its pool but lets a creature exceed its maximum", () => {
    expect(clampStamina(30, 20, "minion-squad")).toBe(20);
    expect(clampStamina(30, 20, "creature")).toBe(30);
  });
});

describe("pending local edits", () => {
  const baseline = { stamina: 10, maxStamina: 20, name: "Goblin", groupId: "g1" };
  const current = { currentStamina: 10, maxStamina: 20, name: "Goblin", groupId: "g1" };

  it("detects an edit made before the debounced diff marks it dirty", () => {
    expect(hasPendingLocalChange({ ...current, currentStamina: 9 }, baseline)).toBe(true);
    expect(hasPendingLocalChange({ ...current, maxStamina: 21 }, baseline)).toBe(true);
    expect(hasPendingLocalChange({ ...current, name: "Renamed" }, baseline)).toBe(true);
    // Group moves are synced through SYNC_INITIATIVE, not UPDATE_COMBATANTS.
    expect(hasPendingLocalChange({ ...current, groupId: "g2" }, baseline)).toBe(false);
  });

  it("reports no pending change when the instance matches its last stamp", () => {
    expect(hasPendingLocalChange(current, baseline)).toBe(false);
    expect(hasPendingLocalChange(current, null)).toBe(false);
    expect(hasPendingLocalChange(current, undefined)).toBe(false);
  });
});

describe("incoming Owlbear updates", () => {
  it("never overwrites a pending local edit", () => {
    expect(decide({ currentStamina: 4, updateCurrentStamina: 19, dirty: true })).toEqual({
      apply: false,
      reason: "dirty",
      currentStamina: 4,
      maxStamina: 20,
    });
  });

  it("applies a different current Stamina", () => {
    expect(decide()).toEqual({
      apply: true,
      reason: "apply",
      currentStamina: 12,
      maxStamina: 20,
    });
  });

  it("does nothing when the values already agree", () => {
    expect(decide({ updateCurrentStamina: 10 })).toEqual({
      apply: false,
      reason: "unchanged",
      currentStamina: 10,
      maxStamina: 20,
    });
  });

  it("lets Owlbear raise a creature's maximum", () => {
    expect(decide({ updateMaxStamina: 25 })).toMatchObject({
      apply: true,
      currentStamina: 12,
      maxStamina: 25,
    });
  });

  it("never lowers a creature's maximum from an incoming value", () => {
    expect(decide({ updateCurrentStamina: 10, updateMaxStamina: 5 })).toEqual({
      apply: false,
      reason: "unchanged",
      currentStamina: 10,
      maxStamina: 20,
    });
  });

  it("raises the maximum when the incoming current exceeds it", () => {
    expect(decide({ currentStamina: 20, updateCurrentStamina: 23 })).toMatchObject({
      apply: true,
      currentStamina: 23,
      maxStamina: 23,
    });
  });

  it("rounds fractional incoming Stamina", () => {
    expect(decide({ updateCurrentStamina: 7.4 })).toMatchObject({
      apply: true,
      currentStamina: 7,
    });
  });

  it("floors negative incoming Stamina", () => {
    expect(decide({ updateCurrentStamina: -4 })).toMatchObject({
      apply: true,
      currentStamina: 0,
    });
  });

  it("caps a squad at its current pool and ignores an incoming maximum", () => {
    expect(
      decide({
        kind: "minion-squad",
        currentStamina: 15,
        maxStamina: 20,
        updateCurrentStamina: 40,
        updateMaxStamina: 60,
      }),
    ).toEqual({
      apply: true,
      reason: "apply",
      currentStamina: 20,
      maxStamina: 20,
    });
  });
});

it("protects a condition edit before the debounced outbound diff runs", () => {
  expect(
    hasPendingLocalChange(
      { currentStamina: 10, maxStamina: 10, name: "Goblin", groupId: "g", conditions: ["Dazed"] },
      { stamina: 10, maxStamina: 10, name: "Goblin", groupId: "g", conditions: [] },
    ),
  ).toBe(true);
});
