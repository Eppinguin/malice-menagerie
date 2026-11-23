import { describe, expect, it } from "vitest";
import {
  ARCHETYPES,
  ATTITUDES,
  TRAITS,
  applyOutcome,
  attitudeOf,
  endingFor,
  lieBites,
  planArgument,
  randomTraitPair,
  readSpent,
  tierLines,
  tierOutcome,
  traitDescription,
} from "./negotiation.ts";
import {
  activeNegotiation,
  applyNegotiationArgument,
  applyNegotiationRead,
  createNegotiation,
  createRandomNegotiation,
  reopenNegotiation,
  setNegotiationAttitude,
  setNegotiationInterest,
  setNegotiationLanguageBonus,
  undoNegotiationArgument,
} from "../store.ts";

describe("negotiation rules", () => {
  it("resolves starting attitudes and falls back to Neutral", () => {
    expect(ATTITUDES).toHaveLength(6);
    expect(attitudeOf("hostile")).toMatchObject({ interest: 1, patience: 2 });
    expect(attitudeOf("trusting")).toMatchObject({ interest: 3, patience: 5 });
    expect(attitudeOf("unknown").key).toBe("neutral");
  });

  it("ships twelve valid Heroes book archetypes with non-overlapping traits", () => {
    const traitKeys = new Set(TRAITS.map((t) => t.key));
    expect(ARCHETYPES).toHaveLength(12);
    for (const arch of ARCHETYPES) {
      expect(arch.impression).toBeGreaterThanOrEqual(1);
      expect(arch.impression).toBeLessThanOrEqual(12);
      const motSet = new Set(arch.motivations);
      for (const key of arch.motivations) expect(traitKeys.has(key)).toBe(true);
      for (const key of arch.pitfalls) {
        expect(traitKeys.has(key)).toBe(true);
        expect(motSet.has(key)).toBe(false);
      }
    }
    const bandit = ARCHETYPES.find((a) => a.key === "bandit-chief")!;
    expect(traitDescription(bandit.key, "Greed", "motivation")).toBe(bandit.motivationNotes.greed);
    expect(traitDescription("", "Greed", "pitfall")).toContain("bribes");
  });

  it("deals non-overlapping random motivation and pitfall traits", () => {
    const deal = randomTraitPair(3, 2);
    expect(deal.motivations).toHaveLength(3);
    expect(deal.pitfalls).toHaveLength(2);
    const allKeys = new Set([...deal.motivations, ...deal.pitfalls].map((t) => t.key));
    expect(allKeys.size).toBe(5);
  });

  it("plans arguments and computes tier outcomes accurately", () => {
    const motPlan = planArgument({
      motivation: "Greed",
      pitfall: false,
      repeat: false,
      usedMotivation: false,
      lie: false,
    });
    expect(motPlan.kind).toBe("motivation");
    expect(motPlan.roll).toBe("medium");
    expect(tierOutcome(motPlan, 1)).toEqual({ interest: 0, patience: -1, natural: false });
    expect(tierOutcome(motPlan, 2)).toEqual({ interest: 1, patience: -1, natural: false });
    expect(tierOutcome(motPlan, 3)).toEqual({ interest: 1, patience: 0, natural: false });

    const plainPlan = planArgument({
      motivation: null,
      pitfall: false,
      repeat: false,
      usedMotivation: false,
      lie: false,
    });
    expect(plainPlan.kind).toBe("plain");
    expect(plainPlan.roll).toBe("hard");
    expect(tierOutcome(plainPlan, 1)).toEqual({ interest: -1, patience: -1, natural: false });
    expect(tierOutcome(plainPlan, 3, false)).toEqual({ interest: 1, patience: -1, natural: false });
    expect(tierOutcome(plainPlan, 3, true)).toEqual({ interest: 1, patience: 0, natural: true });

    const pitfallPlan = planArgument({
      motivation: "Greed",
      pitfall: true,
      repeat: false,
      usedMotivation: false,
      lie: false,
    });
    expect(pitfallPlan.kind).toBe("pitfall");
    expect(pitfallPlan.roll).toBeNull();
    expect(tierOutcome(pitfallPlan, 3)).toEqual({ interest: -1, patience: -1, natural: false });

    const reusedPlan = planArgument({
      motivation: "Greed",
      pitfall: false,
      repeat: false,
      usedMotivation: true,
      lie: false,
    });
    expect(reusedPlan.kind).toBe("used-motivation");
    expect(reusedPlan.roll).toBeNull();
    expect(tierOutcome(reusedPlan, 3)).toEqual({ interest: 0, patience: -1, natural: false });

    const repeatPlan = planArgument({
      motivation: null,
      pitfall: false,
      repeat: true,
      usedMotivation: false,
      lie: false,
    });
    expect(repeatPlan.kind).toBe("repeat");
    expect(repeatPlan.roll).toBeNull();
    expect(tierOutcome(repeatPlan, 3)).toEqual({ interest: -1, patience: -1, natural: false });
  });

  it("charges a caught lie only when interest does not increase", () => {
    expect(lieBites({ interest: 1 })).toBe(false);
    expect(lieBites({ interest: 0 })).toBe(true);
    expect(lieBites({ interest: -1 })).toBe(true);

    expect(tierLines("motivation", 1, true)).toContain("The lie: interest −1");
    expect(tierLines("motivation", 2, true)).not.toContain("The lie: interest −1");
    expect(tierLines("plain", 3, false, true)).toContain("Patience unchanged");
  });

  it("clamps track outcomes and detects negotiation endings", () => {
    expect(applyOutcome(5, 0, { interest: 1, patience: -1 })).toEqual({ interest: 5, patience: 0 });
    expect(applyOutcome(0, 5, { interest: -1, patience: 1 })).toEqual({ interest: 0, patience: 5 });

    expect(endingFor(5, 2)).toBe("interest-5");
    expect(endingFor(0, 2)).toBe("interest-0");
    expect(endingFor(3, 0)).toBe("patience-0");
    expect(endingFor(3, 1)).toBeNull();

    expect(readSpent([])).toBe(false);
    expect(readSpent([{ kind: "read" }])).toBe(true);
    expect(readSpent([{ kind: "argument" }, { kind: "read" }])).toBe(false);
  });
});

describe("negotiation store actions", () => {
  it("applies arguments, marks motivations, reveals pitfalls, and undoes cleanly", () => {
    createNegotiation("bandit-chief");
    const neg = activeNegotiation()!;
    expect(neg.interest).toBe(2);
    expect(neg.patience).toBe(3);

    const mot = neg.motivations[0]!;
    const motPlan = planArgument({
      motivation: mot.name,
      pitfall: false,
      repeat: false,
      usedMotivation: false,
      lie: false,
    });
    applyNegotiationArgument({
      plan: motPlan,
      tier: 3,
      motivationId: mot.id,
      motivationName: mot.name,
      reused: false,
      lie: false,
      memo: "Offered gold",
    });

    let updated = activeNegotiation()!;
    expect(updated.interest).toBe(3);
    expect(updated.patience).toBe(3);
    expect(updated.motivations[0]!.used).toBe(true);
    expect(updated.log[0]!.memo).toBe("Offered gold");

    // Caught lie on a failed motivation tier drops interest by 1 extra.
    const secondMot = updated.motivations[1]!;
    applyNegotiationArgument({
      plan: motPlan,
      tier: 1,
      motivationId: secondMot.id,
      motivationName: secondMot.name,
      reused: false,
      lie: true,
    });
    updated = activeNegotiation()!;
    expect(updated.interest).toBe(2);
    expect(updated.patience).toBe(2);

    // Touching a pitfall drops both tracks and auto-reveals the pitfall.
    const pit = updated.pitfalls[0]!;
    const pitPlan = planArgument({
      motivation: null,
      pitfall: true,
      repeat: false,
      usedMotivation: false,
      lie: false,
    });
    applyNegotiationArgument({
      plan: pitPlan,
      tier: 1,
      motivationId: null,
      motivationName: "",
      pitfallId: pit.id,
      pitfallName: pit.name,
      reused: false,
      lie: false,
    });
    updated = activeNegotiation()!;
    expect(updated.interest).toBe(1);
    expect(updated.patience).toBe(1);
    expect(updated.pitfalls[0]!.revealed).toBe(true);

    // Undoing restores tracks and hides the auto-revealed pitfall again.
    undoNegotiationArgument();
    updated = activeNegotiation()!;
    expect(updated.interest).toBe(2);
    expect(updated.patience).toBe(2);
    expect(updated.pitfalls[0]!.revealed).toBe(false);
  });

  it("enforces one Read the NPC between arguments and lossless language bonuses", () => {
    createRandomNegotiation("local");
    setNegotiationAttitude("friendly"); // interest 3, patience 4

    // Friendly (4) + 2 clamps at 5, and toggling back to 0 returns cleanly to 4.
    setNegotiationLanguageBonus(2);
    expect(activeNegotiation()!.patience).toBe(5);
    setNegotiationLanguageBonus(0);
    expect(activeNegotiation()!.patience).toBe(4);

    // Tier 1 Read drops patience by 1 and blocks a second consecutive read.
    applyNegotiationRead(1);
    expect(activeNegotiation()!.patience).toBe(3);
    expect(activeNegotiation()!.log).toHaveLength(1);
    applyNegotiationRead(3);
    expect(activeNegotiation()!.log).toHaveLength(1);

    // Reaching interest 5 ends the negotiation; reopening overrides the lock.
    setNegotiationInterest(5);
    expect(activeNegotiation()!.ended).toBe("interest-5");
    reopenNegotiation();
    expect(activeNegotiation()!.ended).toBeNull();
    expect(activeNegotiation()!.overrideEnded).toBe(true);
  });
});
