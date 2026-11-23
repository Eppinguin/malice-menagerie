import artworkMap from "./tokenArtworkMap.json";
import { TOKEN_IMAGE_URL } from "./config.ts";

const entries = artworkMap.entries as Record<string, string[] | null>;

export function hasMappedArtwork(sourcePath?: string): boolean {
  const path = (sourcePath ?? "").replace(/@\d+$/, "");
  const key = path.startsWith(artworkMap.keyPrefix)
    ? path.slice(artworkMap.keyPrefix.length)
    : path;
  const entry = Object.hasOwn(entries, key) ? entries[key] : undefined;
  return Boolean(
    entry &&
    artworkMap.imageSources[entry[0] as keyof typeof artworkMap.imageSources] &&
    entry[1] &&
    entry[2],
  );
}

/** Use the source identity, rather than a creature's editable display name. */
export function artworkUrlFor(sourcePath?: string): string {
  const path = (sourcePath ?? "").replace(/@\d+$/, "");
  const key = path.startsWith(artworkMap.keyPrefix)
    ? path.slice(artworkMap.keyPrefix.length)
    : path;
  const entry = Object.hasOwn(entries, key) ? entries[key] : undefined;
  if (!entry) return TOKEN_IMAGE_URL;
  const base = artworkMap.imageSources[entry[0] as keyof typeof artworkMap.imageSources];
  if (!base || !entry[1] || !entry[2]) return TOKEN_IMAGE_URL;
  return `${base}${encodeURIComponent(entry[1])}/${encodeURIComponent(entry[2])}`;
}

export interface TokenArtwork {
  url: string;
  width: number;
  height: number;
  mime: string;
}

const loaded = new Map<string, Promise<TokenArtwork>>();

export type TokenArtworkLoader = (sourcePath?: string) => Promise<TokenArtwork>;

/** One cache per import, shared by token creation and legacy image repair.
 * Keep rejected promises until that import ends so sequential copies fall
 * back immediately. A later import gets a fresh chance to load failed art.
 */
export function createTokenArtworkLoader(
  load: TokenArtworkLoader = loadTokenArtwork,
): TokenArtworkLoader {
  const attempts = new Map<string, Promise<TokenArtwork>>();
  return (sourcePath) => {
    const url = artworkUrlFor(sourcePath);
    let attempt = attempts.get(url);
    if (!attempt) {
      attempt = load(sourcePath);
      attempts.set(url, attempt);
    }
    return attempt;
  };
}

/** Check the actual bytes before writing an image item. A successful HTTP
 * response can still be an HTML error page, or an undecodable image.
 * Squads share one decode, and failed loads can be retried on the next send.
 */
export function loadTokenArtwork(sourcePath?: string): Promise<TokenArtwork> {
  const url = artworkUrlFor(sourcePath);
  const cached = loaded.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(10_000) });
    if (!response.ok)
      throw new Error(`Token artwork could not load (HTTP ${response.status}): ${url}`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/"))
      throw new Error(
        `Token artwork returned ${blob.type || "an unknown file type"}, not an image: ${url}`,
      );
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw new Error(`Token artwork could not be decoded. Try sending again: ${url}`);
    }
    try {
      if (bitmap.width < 1 || bitmap.height < 1)
        throw new Error(`Token artwork has no pixels: ${url}`);
      return { url, width: bitmap.width, height: bitmap.height, mime: blob.type };
    } finally {
      bitmap.close();
    }
  })();
  loaded.set(url, promise);
  void promise.catch(() => loaded.delete(url));
  return promise;
}

/** Repair old placeholders, inline URLs, and the generic fallback when a
 * source-specific image becomes available. GM-supplied artwork stays intact.
 */
export function isLegacyTokenImage(url: string): boolean {
  if (!url) return false;
  if (url === TOKEN_IMAGE_URL) return true;
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  try {
    return new URL(url).pathname.endsWith("/token.png");
  } catch {
    return false;
  }
}
