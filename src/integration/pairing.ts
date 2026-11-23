/**
 * Authorization for the two window messages that can create a bridge.
 *
 * A trusted extension origin may re-pair an already-open Malice window after a
 * popover refresh, because it mints a new one-time token each time. Every other
 * origin must prove it knows the token this window was opened with. Being the
 * opener is not proof: any site can open a window, so a brand-new cross-origin
 * extension also requires explicit user confirmation before adopting its port.
 */
export function allowsPairing(
  trusted: boolean,
  pendingToken: string | null,
  receivedToken: string,
): boolean {
  if (trusted) return true;
  if (pendingToken === null || pendingToken.length === 0) return false;
  return receivedToken === pendingToken;
}

/**
 * Same-origin (`/obr/` deployed alongside the app) and previously trusted
 * origins can pair silently. Any other HTTPS/loopback origin must be confirmed
 * by the user so an arbitrary website cannot hijack an open Malice session via
 * a crafted `?obr=connect` popup.
 */
export function requiresPairingApproval(
  trusted: boolean,
  origin: string,
  pageOrigin: string,
): boolean {
  if (trusted) return false;
  return origin !== pageOrigin;
}
