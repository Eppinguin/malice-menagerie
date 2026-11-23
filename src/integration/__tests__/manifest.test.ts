import { describe, expect, it } from "vitest";
import manifest from "../../../obr/public/manifest.json";

const hosted = [
  ["icon", manifest.icon],
  ["action.icon", manifest.action.icon],
  ["action.popover", manifest.action.popover],
  ["background_url", manifest.background_url],
] as const;

describe("Owlbear manifest", () => {
  // Owlbear resolves these by concatenation (`origin + value`), not
  // `new URL(value, base)`, so a bare "index.html" corrupts the hostname and
  // throws before the extension frame can load. Serving the extension under
  // `/obr/` requires every hosted path to carry the `/obr/` prefix.
  it("spells every hosted path under /obr/ or absolute", () => {
    for (const [label, value] of hosted) {
      expect(typeof value, label).toBe("string");
      expect(
        value.startsWith("/obr/") || value.startsWith("http"),
        `${label} must start with "/obr/" or "http"`,
      ).toBe(true);
    }
  });

  it("keeps the required identity fields within Owlbear's limits", () => {
    expect(manifest.manifest_version).toBe(1);
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.name.length).toBeLessThanOrEqual(45);
    expect(manifest.description.length).toBeLessThanOrEqual(128);
    expect(manifest.action.title.length).toBeGreaterThan(0);
  });

  it("loads the popover and background pages the build emits", () => {
    expect(manifest.action.popover).toBe("/obr/index.html");
    expect(manifest.background_url).toBe("/obr/background.html");
  });
});
