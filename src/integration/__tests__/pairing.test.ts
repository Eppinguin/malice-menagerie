import { describe, expect, it } from "vitest";
import { allowsPairing, requiresPairingApproval } from "../pairing.ts";

describe("pairing authorization", () => {
  it("lets a trusted extension origin re-pair with a fresh token", () => {
    expect(allowsPairing(true, "old-token", "new-token")).toBe(true);
    expect(allowsPairing(true, null, "new-token")).toBe(true);
  });

  it("accepts a nontrusted origin only with the exact pending token", () => {
    expect(allowsPairing(false, "token", "token")).toBe(true);
  });

  it("rejects a mismatched token", () => {
    expect(allowsPairing(false, "token", "other")).toBe(false);
    expect(allowsPairing(false, "token", "")).toBe(false);
  });

  it("rejects a window that was opened without a pending token", () => {
    expect(allowsPairing(false, null, "anything")).toBe(false);
    expect(allowsPairing(false, "", "")).toBe(false);
  });

  it("requires explicit approval only for untrusted third-party origins", () => {
    expect(requiresPairingApproval(true, "https://other.example", "https://malice.example")).toBe(
      false,
    );
    expect(requiresPairingApproval(false, "https://malice.example", "https://malice.example")).toBe(
      false,
    );
    expect(requiresPairingApproval(false, "https://other.example", "https://malice.example")).toBe(
      true,
    );
  });
});
