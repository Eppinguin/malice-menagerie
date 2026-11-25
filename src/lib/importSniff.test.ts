import { describe, expect, it } from "vitest";
import { isShareLinkText, looksLikeImport } from "./importSniff.ts";

describe("looksLikeImport", () => {
  it("recognises share links, bare codes, and JSON", () => {
    expect(looksLikeImport("https://malice-menagerie.app/#s=1.eJyrVkrOz8lJTS7")).toBe(true);
    expect(looksLikeImport("  1.eJyrVkrOz8lJ  ")).toBe(true);
    expect(looksLikeImport('{"format":"malice-menagerie","version":1}')).toBe(true);
    expect(looksLikeImport('[{"name":"Goblin Sniper"}]')).toBe(true);
  });

  it("leaves ordinary library queries alone", () => {
    for (const query of ["", "goblin", "lv 2 ev<=12", "lv 1-3 ev<=12 grab", "1.5", "{goblin"]) {
      expect(looksLikeImport(query)).toBe(false);
    }
  });

  it("tells links apart from JSON", () => {
    expect(isShareLinkText("#s=1.abcdefghij")).toBe(true);
    expect(isShareLinkText('{"a":1}')).toBe(false);
  });
});
