import { describe, expect, it } from "vitest";
import { parseStaminaCommand } from "./stamina.ts";

describe("parseStaminaCommand", () => {
  it("parses relative damage and healing including unicode minus", () => {
    expect(parseStaminaCommand("-12", 40)).toEqual({ next: 28, kind: "damage", delta: 12 });
    expect(parseStaminaCommand("−7", 40)).toEqual({ next: 33, kind: "damage", delta: 7 });
    expect(parseStaminaCommand("+5", 40)).toEqual({ next: 45, kind: "heal", delta: 5 });
  });

  it("parses appended inline arithmetic like 45-12 and 45+5", () => {
    expect(parseStaminaCommand("45-12", 45)).toEqual({ next: 33, kind: "damage", delta: 12 });
    expect(parseStaminaCommand("45 + 8", 45)).toEqual({ next: 53, kind: "heal", delta: 8 });
    expect(parseStaminaCommand("45 − 50", 45)).toEqual({ next: -5, kind: "damage", delta: 50 });
  });

  it("parses exact sets with or without =", () => {
    expect(parseStaminaCommand("20", 45)).toEqual({ next: 20, kind: "set", delta: 25 });
    expect(parseStaminaCommand("=18", 45)).toEqual({ next: 18, kind: "set", delta: 27 });
  });

  it("rejects empty or invalid commands", () => {
    expect(parseStaminaCommand("", 45)).toBeNull();
    expect(parseStaminaCommand("abc", 45)).toBeNull();
    expect(parseStaminaCommand("45-", 45)).toBeNull();
  });
});
