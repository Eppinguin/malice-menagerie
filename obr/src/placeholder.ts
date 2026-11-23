/**
 * Scene images are fetched by every player and by other extensions, not by
 * this extension's frame. Never persist extension-local, data, or blob URLs.
 * Twemoji's neutral black circle (CC BY 4.0), pinned to its release. It is
 * only a 411-byte background; the monster initials are native Owlbear text.
 */
export const INITIALS_IMAGE_URL =
  "https://raw.githubusercontent.com/twitter/twemoji/v14.0.2/assets/72x72/26ab.png";

export function placeholderArtwork() {
  return { url: INITIALS_IMAGE_URL, width: 72, height: 72, mime: "image/png" };
}

/** Recognise only our old generated SVG placeholders; leave custom art alone. */
export function isBrokenInitialsImage(raw: string): boolean {
  try {
    return /\/token-initials(?:-[\w-]+)?\.svg$/.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

/** Recognise broken legacy placeholders that cannot render in Owlbear
 * (extension-local `/token.png`, inline `data:` / `blob:` URLs). */
export function isBrokenLegacyImage(raw: string): boolean {
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return true;
  try {
    return new URL(raw).pathname.endsWith("/token.png");
  } catch {
    return false;
  }
}
