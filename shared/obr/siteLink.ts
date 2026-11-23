import {
  HELLO_MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  isHelloMessage,
  newMessageId,
  parseAllowedOrigin,
  type HelloMessage,
} from "./protocol.ts";

/** This used to be a README example, not an actual deployment. Never silently
 * send a user's connection capability to a guessed host. */
const OLD_EXAMPLE_ORIGIN = "https://malice-owlbear.pages.dev";
export const EXTENSION_MANIFEST_PATH = "/obr/manifest.json";

export function preferredExtensionAddress(
  saved: string,
  trustedOrigins: string[],
  pageOrigin = "",
): string {
  if (saved && extensionOrigin(saved) !== OLD_EXAMPLE_ORIGIN) return saved;
  const trusted = trustedOrigins.at(-1);
  if (trusted) {
    try {
      const url = new URL(trusted);
      return url.pathname === "/" || url.pathname === ""
        ? `${url.origin}${EXTENSION_MANIFEST_PATH}`
        : trusted;
    } catch {
      return trusted;
    }
  }
  if (pageOrigin.startsWith("https://")) return `${pageOrigin}${EXTENSION_MANIFEST_PATH}`;
  return "";
}
const SESSION_KEY = "malice-menagerie/owlbear-site-link";
const CONNECT = "MALICE_OWLBEAR_SITE_CONNECT";
const PROBE = "MALICE_OWLBEAR_SITE_PROBE";
const STOP = "MALICE_OWLBEAR_SITE_STOP";
const REJECT = "MALICE_OWLBEAR_SITE_REJECT";

interface LinkMessage {
  protocol: typeof PROTOCOL_NAME;
  version: typeof PROTOCOL_VERSION;
  type: typeof CONNECT | typeof PROBE | typeof STOP | typeof REJECT;
  pairingToken: string;
  requestId: string;
}

function message(type: LinkMessage["type"], pairingToken: string, requestId = ""): LinkMessage {
  return { protocol: PROTOCOL_NAME, version: PROTOCOL_VERSION, type, pairingToken, requestId };
}

function isLinkMessage(value: unknown): value is LinkMessage {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    data["protocol"] === PROTOCOL_NAME &&
    data["version"] === PROTOCOL_VERSION &&
    [CONNECT, PROBE, STOP, REJECT].includes(String(data["type"])) &&
    typeof data["pairingToken"] === "string" &&
    data["pairingToken"].length > 0 &&
    data["pairingToken"].length <= 160 &&
    typeof data["requestId"] === "string" &&
    data["requestId"].length <= 160 &&
    (data["type"] !== CONNECT || data["requestId"].length > 0)
  );
}

export function extensionOrigin(raw: string): string | null {
  return parseAllowedOrigin(raw);
}

export function owlbearRoomUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (
      url.origin !== "https://www.owlbear.rodeo" ||
      url.username ||
      url.password ||
      !/^\/room\/[^/]+(?:\/.*)?$/.test(url.pathname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

interface SiteSession {
  origin: string;
  token: string;
  sessionId?: string;
}

/** Only called for a room deliberately opened by this tab. No wildcard targets,
 * DOM inspection, or access to the other site's location is needed. */
export function visitFrames(root: Window, visit: (frame: Window) => void): void {
  const queue = [root];
  for (let index = 0; index < queue.length && index < 64; index += 1) {
    const frame = queue[index]!;
    try {
      visit(frame);
      for (let child = 0; child < frame.length && queue.length < 64; child += 1)
        queue.push(frame.frames[child]!);
    } catch {
      /* A navigating or sandboxed frame can become inaccessible. */
    }
  }
}

export function createSiteLink(options: {
  onHello: (hello: HelloMessage, origin: string, port: MessagePort) => void;
  isConnected: () => boolean;
  onError: (message: string) => void;
  onWaiting: () => void;
  onReset: () => void;
}) {
  let session: SiteSession | null = null;
  let peer: Window | null = null;
  let room: Window | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let requestId = newMessageId();
  let activeSessionId = "";
  let awaitingHello = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as SiteSession | null;
    if (
      saved &&
      extensionOrigin(saved.origin) === saved.origin &&
      typeof saved.token === "string" &&
      saved.token.length > 0 &&
      saved.token.length <= 160
    ) {
      session = saved;
      if (typeof saved.sessionId === "string" && saved.sessionId.length <= 160) {
        activeSessionId = saved.sessionId;
      }
      awaitingHello = true;
    }
  } catch {
    /* Session persistence is optional. */
  }

  function save(): void {
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* The current connection still works without storage. */
    }
  }
  function dispose(): void {
    clearInterval(timer);
    clearTimeout(timeout);
    timer = undefined;
    timeout = undefined;
  }
  function stop(): void {
    if (session && peer) {
      try {
        peer.postMessage(message(STOP, session.token), session.origin);
      } catch {
        /* Gone. */
      }
    }
    dispose();
    awaitingHello = false;
    session = null;
    peer = null;
    room = null;
    save();
  }
  function request(target: Window): void {
    if (!session) return;
    try {
      target.postMessage(message(CONNECT, session.token, requestId), session.origin);
    } catch {
      /* Navigation can race discovery; the next tick retries. */
    }
  }
  return {
    connect(roomUrl: string, origin: string): void {
      stop();
      session = { origin, token: newMessageId() };
      requestId = newMessageId();
      awaitingHello = true;
      save();
      // A fresh room window establishes the relationship. Named unrelated tabs
      // cannot reliably be found, and navigating an existing room would disrupt it.
      room = window.open(roomUrl, "_blank");
      if (!room) {
        stop();
        options.onError("Allow pop-ups for Malice Menagerie, then try Connect again.");
        return;
      }
      options.onWaiting();
      const discover = () => {
        if (!room) return;
        if (room.closed) {
          stop();
          options.onError(
            "The room window closed or its browser policy blocked the connection. You can still connect from the extension.",
          );
          return;
        }
        visitFrames(room, request);
      };
      timer = setInterval(discover, 750);
      timeout = setTimeout(() => {
        stop();
        options.onError(
          "The extension did not answer. Enable Malice Menagerie in that room, check the extension address, and try again. You can also connect from the extension.",
        );
      }, 45_000);
      discover();
    },
    handleMessage(event: MessageEvent<unknown>): boolean {
      if (!session || event.origin !== session.origin || !event.source) return false;
      const source = event.source as Window;
      if (isLinkMessage(event.data) && event.data.type === REJECT) {
        if (event.data.pairingToken !== session.token) return true;
        stop();
        options.onError(
          "The extension is configured for another Malice address. In the extension, set Malice Menagerie address to this site's address, then try again.",
        );
        return true;
      }
      if (isLinkMessage(event.data) && event.data.type === PROBE) {
        if (event.data.pairingToken !== session.token) return true;
        if (options.isConnected() && event.data.requestId !== activeSessionId) options.onReset();
        if (!options.isConnected()) {
          // Use a fresh requestId so the background doesn't deduplicate a
          // recovery attempt against an already-used id.
          requestId = newMessageId();
          awaitingHello = true;
          request(source);
        }
        return true;
      }
      if (!isHelloMessage(event.data)) return false;
      const port = event.ports[0];
      // Do not fall through to legacy trusted-origin pairing while a site
      // connection is actively pending: this flow requires its exact private token.
      if (event.data.pairingToken !== session.token) {
        if (awaitingHello || timer !== undefined) {
          port?.close();
          return true;
        }
        return false;
      }
      if (!port) return true;
      if (options.isConnected()) {
        port.close();
        return true;
      }
      awaitingHello = false;
      peer = source;
      activeSessionId = event.data.sessionId;
      session = { ...session, sessionId: activeSessionId };
      save();
      dispose();
      options.onHello(event.data, event.origin, port);
      return true;
    },
    stop,
    dispose,
  };
}

/** Runs in Owlbear's persistent extension background, rather than its popover.
 * Retaining event.source lets us reach the same Malice tab after it reloads. */
export function createBackgroundSiteLink(options: {
  roomId: string;
  allowedOrigin: () => string | null;
  extensionVersion: string;
  adopt: (port: MessagePort, sessionId: string, pairingToken: string) => void;
  disconnect: () => void;
  isConnected: () => boolean;
  manageRecovery?: boolean | (() => boolean);
}) {
  const key = `${SESSION_KEY}/${options.roomId}`;
  let target: Window | null = null;
  let origin = "";
  let token = "";
  let lastRequest = "";
  let activeSessionId = newMessageId();
  let offeredAt = 0;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as SiteSession | null;
    if (
      saved &&
      saved.origin === options.allowedOrigin() &&
      typeof saved.token === "string" &&
      saved.token.length > 0 &&
      saved.token.length <= 160
    ) {
      origin = saved.origin;
      token = saved.token;
      target = window.top?.opener ?? null;
    }
  } catch {
    /* A sandbox may restrict opener access or storage. */
  }

  function stop(): void {
    target = null;
    origin = token = lastRequest = "";
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Optional. */
    }
  }
  function handleMessage(event: MessageEvent<unknown>): void {
    if (!isLinkMessage(event.data) || !event.source) return;
    if (event.data.type === STOP) {
      if (event.source === target && event.origin === origin && event.data.pairingToken === token) {
        stop();
        options.disconnect();
      }
      return;
    }
    if (event.data.type !== CONNECT) return;
    if (event.origin !== options.allowedOrigin()) {
      // An explicit error is useful during local development, where each port
      // is a different origin. Do not reveal the configured address or adopt.
      if (extensionOrigin(event.origin)) {
        try {
          (event.source as Window).postMessage(
            message(REJECT, event.data.pairingToken),
            event.origin,
          );
        } catch {
          /* The requesting window may have navigated. */
        }
      }
      return;
    }
    if (
      event.source === target &&
      event.origin === origin &&
      event.data.pairingToken === token &&
      event.data.requestId === lastRequest &&
      (options.isConnected() || Date.now() - offeredAt < 5_000)
    )
      return;
    target = event.source as Window;
    origin = event.origin;
    token = event.data.pairingToken;
    lastRequest = event.data.requestId;
    try {
      sessionStorage.setItem(key, JSON.stringify({ origin, token }));
    } catch {
      /* Optional. */
    }
    const sessionId = newMessageId();
    activeSessionId = sessionId;
    offeredAt = Date.now();
    const channel = new MessageChannel();
    try {
      target.postMessage(
        {
          protocol: PROTOCOL_NAME,
          version: PROTOCOL_VERSION,
          type: HELLO_MESSAGE_TYPE,
          sessionId,
          pairingToken: token,
          extensionVersion: options.extensionVersion,
        } satisfies HelloMessage,
        origin,
        [channel.port1],
      );
      options.adopt(channel.port2, sessionId, token);
    } catch {
      channel.port1.close();
      channel.port2.close();
      lastRequest = "";
    }
  }
  window.addEventListener("message", handleMessage);
  const timer = setInterval(() => {
    const enabled =
      typeof options.manageRecovery === "function"
        ? options.manageRecovery()
        : options.manageRecovery;
    if (enabled === false) return;
    if (!target) return;
    try {
      if (target.closed) {
        stop();
        return;
      }
      target.postMessage(message(PROBE, token, activeSessionId), origin);
    } catch {
      /* Keep the capability while the tab is navigating. */
    }
  }, 2_000);
  return {
    stop,
    dispose(): void {
      clearInterval(timer);
      window.removeEventListener("message", handleMessage);
    },
  };
}
