import { describe, expect, it } from "vitest";
import { INITIALS_IMAGE_URL } from "../../../obr/src/placeholder.ts";
import { TOKEN_IMAGE_URL, tokenImageUrl } from "../../../obr/src/config.ts";

/**
 * Owlbear fetches an image item's URL in every client and rejects URLs that
 * are too long or that its CSP cannot load. The inlined `data:` artwork was
 * 4338 characters, so every token creation failed with a message this
 * extension then hid. Keep this contract pinned.
 */
describe("token artwork URL", () => {
  it("gives initials a public HTTPS background independent of the extension host", () => {
    const url = new URL(INITIALS_IMAGE_URL);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("raw.githubusercontent.com");
    expect(INITIALS_IMAGE_URL.length).toBeLessThanOrEqual(2048);
  });

  it("is a public https URL", () => {
    const url = new URL(TOKEN_IMAGE_URL);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).not.toBe("localhost");
    expect(url.hostname).not.toBe("127.0.0.1");
    expect(url.pathname.endsWith(".webp")).toBe(true);
  });

  it("fits Owlbear's 2048-character image URL limit", () => {
    expect(TOKEN_IMAGE_URL.length).toBeLessThanOrEqual(2048);
    expect(tokenImageUrl()).toBe(TOKEN_IMAGE_URL);
  });

  it("is not a URL Owlbear refuses to fetch", () => {
    expect(TOKEN_IMAGE_URL.startsWith("data:")).toBe(false);
    expect(TOKEN_IMAGE_URL.startsWith("blob:")).toBe(false);
  });
});
