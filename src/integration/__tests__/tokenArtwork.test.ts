import { afterEach, describe, expect, it, vi } from "vitest";
import { isLegacyTokenImage } from "../../../obr/src/tokenArtwork.ts";

describe("legacy token artwork", () => {
  it("recognises the old bundled artwork URL on any host", () => {
    expect(isLegacyTokenImage("http://localhost:5174/token.png")).toBe(true);
    expect(isLegacyTokenImage("https://malice-owlbear.pages.dev/token.png")).toBe(true);
    expect(isLegacyTokenImage("https://example.com/base/token.png")).toBe(true);
  });

  it("recognises artwork Owlbear can never load", () => {
    // Item images are fetched under Owlbear's `connect-src` policy, which
    // excludes `data:`; a `blob:` URL belongs to another document.
    expect(isLegacyTokenImage("data:image/png;base64,AAAA")).toBe(true);
    expect(isLegacyTokenImage("blob:https://example.com/1234")).toBe(true);
  });

  it("leaves GM-supplied images alone", () => {
    expect(isLegacyTokenImage("https://images.owlbear.rodeo/account/items/abc.webp")).toBe(false);
    expect(isLegacyTokenImage("https://example.com/dragon.png")).toBe(false);
    expect(isLegacyTokenImage("https://example.com/not-token.png")).toBe(false);
    expect(isLegacyTokenImage("")).toBe(false);
    expect(isLegacyTokenImage("not a url")).toBe(false);
  });
});

describe("mapped token artwork", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves source paths and adjusted levels without relying on token names", async () => {
    const { artworkUrlFor } = await import("../../../obr/src/tokenArtwork.ts");
    const full = "en/unified/json/monster/goblin/statblock/goblin-warrior.json";
    expect(artworkUrlFor(full)).toContain("/Goblin/GoblinForestMaleGraygreenMelee%20(1).webp");
    expect(artworkUrlFor(`${full}@5`)).toBe(artworkUrlFor(full));
    expect(artworkUrlFor("goblin/statblock/goblin-warrior.json")).toBe(artworkUrlFor(full));
  });

  it("uses the Pathfinder repository's Tokens directory", async () => {
    const { artworkUrlFor } = await import("../../../obr/src/tokenArtwork.ts");
    expect(artworkUrlFor("angulotl/statblock/angulotl-cleaver.json")).toBe(
      "https://raw.githubusercontent.com/IsThisMyRealName/too-many-tokens-pf/main/Tokens/Boggard%20Warrior/BoggardWarrior%20(11).webp",
    );
  });

  it("uses the mapped Human Guard for unknown and explicitly unassigned sources", async () => {
    const { artworkUrlFor } = await import("../../../obr/src/tokenArtwork.ts");
    const { TOKEN_IMAGE_URL } = await import("../../../obr/src/config.ts");
    expect(artworkUrlFor()).toBe(TOKEN_IMAGE_URL);
    expect(artworkUrlFor("unknown.json")).toBe(TOKEN_IMAGE_URL);
    expect(artworkUrlFor("arixx/statblock/arixx.json")).toBe(TOKEN_IMAGE_URL);
  });

  it("checks decoded dimensions, closes bitmaps, and shares image loads across a squad", async () => {
    vi.resetModules();
    const close = vi.fn();
    const fetchImage = vi.fn(
      async () => new Response(new Blob(["image bytes"], { type: "image/webp" })),
    );
    vi.stubGlobal("fetch", fetchImage);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 512, height: 256, close })),
    );
    const { loadTokenArtwork } = await import("../../../obr/src/tokenArtwork.ts");
    const images = await Promise.all([
      loadTokenArtwork("goblin/statblock/goblin-warrior.json"),
      loadTokenArtwork("goblin/statblock/goblin-warrior.json"),
    ]);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(images[0]).toMatchObject({ width: 512, height: 256, mime: "image/webp" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects HTML error pages even when the server returns 200", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>not an image</html>", { headers: { "Content-Type": "text/html" } }),
      ),
    );
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const { loadTokenArtwork } = await import("../../../obr/src/tokenArtwork.ts");
    await expect(loadTokenArtwork()).rejects.toThrow("not an image");
    expect(decode).not.toHaveBeenCalled();
  });

  it("reports decode failures and retries failed images on the next send", async () => {
    vi.resetModules();
    const fetchImage = vi.fn(
      async () => new Response(new Blob(["broken"], { type: "image/webp" })),
    );
    vi.stubGlobal("fetch", fetchImage);
    vi.stubGlobal(
      "createImageBitmap",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("The source image could not be decoded."))
        .mockResolvedValueOnce({ width: 256, height: 256, close: vi.fn() }),
    );
    const { createTokenArtworkLoader } = await import("../../../obr/src/tokenArtwork.ts");
    const firstSend = createTokenArtworkLoader();
    await expect(firstSend()).rejects.toThrow("could not be decoded");
    await expect(firstSend("unknown.json")).rejects.toThrow("could not be decoded");
    expect(fetchImage).toHaveBeenCalledTimes(1);
    const nextSend = createTokenArtworkLoader();
    await expect(nextSend()).resolves.toMatchObject({ mime: "image/webp" });
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });
});
