import { describe, expect, it } from "vitest";
import { individualStaminaFor } from "../../../obr/src/minionStamina.ts";

describe("per-minion Stamina", () => {
  it("uses the split Malice sent", () => {
    expect(individualStaminaFor({ individualStamina: 5, maxStamina: 20 }, 4)).toBe(5);
  });

  it("keeps the real per-minion maximum when extra tokens exist", () => {
    // A four-minion squad (max 20) with a fifth token a GM dropped on the map.
    expect(individualStaminaFor({ individualStamina: 5, maxStamina: 20 }, 5)).toBe(5);
    expect(individualStaminaFor({ maxStamina: 20 }, 5)).toBe(4);
  });

  it("falls back to dividing the pool for an update without the field", () => {
    expect(individualStaminaFor({ maxStamina: 20 }, 4)).toBe(5);
  });

  it("never returns zero or a fraction", () => {
    expect(individualStaminaFor({ individualStamina: 0, maxStamina: 3 }, 4)).toBe(1);
    expect(individualStaminaFor({ maxStamina: 0 }, 0)).toBe(1);
  });
});
