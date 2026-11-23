import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBackgroundSiteLink,
  createSiteLink,
  extensionOrigin,
  owlbearRoomUrl,
  preferredExtensionAddress,
} from "../../../shared/obr/siteLink.ts";
import {
  HELLO_MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
} from "../../../shared/obr/protocol.ts";

const siteOrigin = "https://malice.example";
const bridgeOrigin = "https://extension.example";
const token = "secret-capability";
const sessionKey = "malice-menagerie/owlbear-site-link";
const callbacks: Array<() => void> = [];
let listeners: Map<string, EventListener>;
let storage: Map<string, string>;

function packet(type: string, pairingToken = token, requestId = "request-1") {
  return { protocol: PROTOCOL_NAME, version: PROTOCOL_VERSION, type, pairingToken, requestId };
}
function event(data: unknown, origin: string, source: unknown, ports: unknown[] = []) {
  return { data, origin, source, ports } as unknown as MessageEvent<unknown>;
}
function hello(pairingToken = token, sessionId = "session-1") {
  return { ...packet(HELLO_MESSAGE_TYPE, pairingToken), sessionId, extensionVersion: "test" };
}
function makeSiteLink() {
  let connected = false;
  const options = {
    isConnected: () => connected,
    onHello: vi.fn(() => {
      connected = true;
    }),
    onError: vi.fn(),
    onWaiting: vi.fn(),
    onReset: vi.fn(() => {
      connected = false;
    }),
  };
  const link = createSiteLink(options);
  callbacks.push(link.dispose);
  return { link, options };
}
function makeBackground() {
  let connected = false;
  const options = {
    roomId: "room-1",
    extensionVersion: "test",
    allowedOrigin: () => siteOrigin,
    isConnected: () => connected,
    adopt: vi.fn(() => {
      connected = true;
    }),
    disconnect: vi.fn(() => {
      connected = false;
    }),
  };
  const background = createBackgroundSiteLink(options);
  callbacks.push(background.dispose);
  const receive = (data: unknown, origin: string, source: unknown) => {
    listeners.get("message")?.(event(data, origin, source));
  };
  return { background, options, receive };
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
  listeners = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", {
    open: vi.fn(),
    top: { opener: null },
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  });
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = { close: vi.fn() };
      port2 = { close: vi.fn() };
    },
  );
});
afterEach(() => {
  for (const dispose of callbacks.splice(0)) dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("site connection addresses", () => {
  it("learns the installed extension host, replaces the old example default, and defaults to same-origin /obr/ over HTTPS", () => {
    expect(preferredExtensionAddress("", [])).toBe("");
    expect(preferredExtensionAddress("", [], "http://127.0.0.1:5173")).toBe("");
    expect(preferredExtensionAddress("", [], "https://malice-menagerie.pages.dev")).toBe(
      "https://malice-menagerie.pages.dev/obr/manifest.json",
    );
    expect(
      preferredExtensionAddress(
        "https://malice-owlbear.pages.dev",
        [],
        "https://preview.malice-menagerie.pages.dev",
      ),
    ).toBe("https://preview.malice-menagerie.pages.dev/obr/manifest.json");
    expect(
      preferredExtensionAddress(
        "https://malice-owlbear.pages.dev/manifest.json",
        [],
        "https://preview.malice-menagerie.pages.dev",
      ),
    ).toBe("https://preview.malice-menagerie.pages.dev/obr/manifest.json");
    expect(
      preferredExtensionAddress("https://malice-owlbear.pages.dev", ["http://localhost:5174"]),
    ).toBe("http://localhost:5174/obr/manifest.json");
    expect(preferredExtensionAddress("http://localhost:5174/obr/manifest.json", [])).toBe(
      "http://localhost:5174/obr/manifest.json",
    );
  });
  it("accepts real room URLs and rejects lookalikes, credentials, and non-room pages", () => {
    expect(owlbearRoomUrl("https://www.owlbear.rodeo/room/abc/My-Room")).toContain("/room/abc");
    for (const bad of [
      "https://www.owlbear.rodeo.evil/room/abc",
      "https://user@www.owlbear.rodeo/room/abc",
      "http://www.owlbear.rodeo/room/abc",
      "https://www.owlbear.rodeo/profile",
      "https://www.owlbear.rodeo/room/",
    ])
      expect(owlbearRoomUrl(bad)).toBeNull();
    expect(extensionOrigin("https://example.com/manifest.json")).toBe("https://example.com");
    expect(extensionOrigin("http://localhost:5174")).toBe("http://localhost:5174");
    expect(extensionOrigin("http://example.com")).toBeNull();
    expect(extensionOrigin("https://user:password@example.com")).toBeNull();
  });
});

describe("site pairing and recovery", () => {
  beforeEach(() => storage.set(sessionKey, JSON.stringify({ origin: bridgeOrigin, token })));

  it("requires both the pinned extension origin and private token", () => {
    const { link, options } = makeSiteLink();
    const peer = { postMessage: vi.fn() };
    const port = { close: vi.fn() };
    link.handleMessage(event(hello(), "https://unrelated.example", peer, [port]));
    link.handleMessage(event(hello("wrong-token"), bridgeOrigin, peer, [port]));
    expect(options.onHello).not.toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledOnce();
    link.handleMessage(event(hello(), bridgeOrigin, peer, [port]));
    expect(options.onHello).toHaveBeenCalledOnce();
  });

  it("reports an origin configuration mismatch instead of waiting silently", () => {
    const { link, options } = makeSiteLink();
    link.handleMessage(
      event(packet("MALICE_OWLBEAR_SITE_REJECT"), bridgeOrigin, { postMessage: vi.fn() }),
    );
    expect(options.onError).toHaveBeenCalledWith(expect.stringContaining("another Malice address"));
    expect(storage.has(sessionKey)).toBe(false);
  });

  it("re-pairs after a site reload without opening any windows", () => {
    const first = makeSiteLink();
    const peer = { postMessage: vi.fn() };
    first.link.handleMessage(event(hello(), bridgeOrigin, peer, [{ close: vi.fn() }]));
    first.link.dispose();
    const refreshed = makeSiteLink();
    refreshed.link.handleMessage(
      event(packet("MALICE_OWLBEAR_SITE_PROBE", token, "session-1"), bridgeOrigin, peer),
    );
    expect(peer.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MALICE_OWLBEAR_SITE_CONNECT",
        pairingToken: token,
      }),
      bridgeOrigin,
    );
    expect(window.open).not.toHaveBeenCalled();
    refreshed.link.handleMessage(
      event(hello(token, "session-2"), bridgeOrigin, peer, [{ close: vi.fn() }]),
    );
    expect(refreshed.options.onHello).toHaveBeenCalledOnce();
  });

  it("keeps a healthy connection and replaces it when the room background restarts", () => {
    const { link, options } = makeSiteLink();
    const peer = { postMessage: vi.fn() };
    link.handleMessage(event(hello(), bridgeOrigin, peer, [{ close: vi.fn() }]));
    link.handleMessage(
      event(packet("MALICE_OWLBEAR_SITE_PROBE", token, "session-1"), bridgeOrigin, peer),
    );
    expect(peer.postMessage).not.toHaveBeenCalled();
    expect(options.onReset).not.toHaveBeenCalled();
    link.handleMessage(
      event(
        packet("MALICE_OWLBEAR_SITE_PROBE", "wrong-token", "new-background"),
        bridgeOrigin,
        peer,
      ),
    );
    expect(options.onReset).not.toHaveBeenCalled();
    link.handleMessage(
      event(packet("MALICE_OWLBEAR_SITE_PROBE", token, "new-background"), bridgeOrigin, peer),
    );
    expect(options.onReset).toHaveBeenCalledOnce();
    expect(peer.postMessage).toHaveBeenCalledOnce();
  });

  it("forgets the capability on explicit disconnect and ignores subsequent probes", () => {
    const { link, options } = makeSiteLink();
    const peer = { postMessage: vi.fn() };
    link.handleMessage(event(hello(), bridgeOrigin, peer, [{ close: vi.fn() }]));
    link.stop();
    expect(storage.has(sessionKey)).toBe(false);
    peer.postMessage.mockClear();
    link.handleMessage(event(packet("MALICE_OWLBEAR_SITE_PROBE"), bridgeOrigin, peer));
    expect(peer.postMessage).not.toHaveBeenCalled();
    expect(options.onReset).not.toHaveBeenCalled();
  });

  it("reports blocked popups and bounds discovery when no extension answers", () => {
    const { link, options } = makeSiteLink();
    vi.mocked(window.open).mockReturnValueOnce(null);
    link.connect("https://www.owlbear.rodeo/room/abc", bridgeOrigin);
    expect(options.onError).toHaveBeenCalledWith(expect.stringContaining("Allow pop-ups"));
    expect(storage.has(sessionKey)).toBe(false);
    const room = { closed: false, length: 0, postMessage: vi.fn() } as unknown as Window;
    vi.mocked(window.open).mockReturnValueOnce(room);
    link.connect("https://www.owlbear.rodeo/room/abc", bridgeOrigin);
    vi.advanceTimersByTime(45_000);
    expect(options.onError).toHaveBeenLastCalledWith(expect.stringContaining("did not answer"));
    expect(storage.has(sessionKey)).toBe(false);
  });

  it("does not swallow a popover HELLO with a different token once site-link handshake completes", () => {
    const { link, options } = makeSiteLink();
    const peer = { postMessage: vi.fn() };
    const firstPort = { close: vi.fn() };
    expect(link.handleMessage(event(hello(), bridgeOrigin, peer, [firstPort]))).toBe(true);
    expect(options.onHello).toHaveBeenCalledOnce();

    // A later popover-initiated HELLO from the same extension origin with a new pairing token
    // should not be consumed or have its port closed by the site-link handler.
    const popoverPort = { close: vi.fn() };
    expect(
      link.handleMessage(
        event(hello("popover-token", "session-2"), bridgeOrigin, peer, [popoverPort]),
      ),
    ).toBe(false);
    expect(popoverPort.close).not.toHaveBeenCalled();
  });

  it("uses a fresh requestId when replying to a background PROBE after restart", () => {
    const { link } = makeSiteLink();
    const peer = { postMessage: vi.fn() };
    link.handleMessage(event(hello(), bridgeOrigin, peer, [{ close: vi.fn() }]));
    link.handleMessage(
      event(packet("MALICE_OWLBEAR_SITE_PROBE", token, "bg-1"), bridgeOrigin, peer),
    );
    link.handleMessage(
      event(packet("MALICE_OWLBEAR_SITE_PROBE", token, "bg-2"), bridgeOrigin, peer),
    );
    expect(peer.postMessage).toHaveBeenCalledTimes(2);
    const firstId = (peer.postMessage.mock.calls[0]?.[0] as { requestId?: string } | undefined)
      ?.requestId;
    const secondId = (peer.postMessage.mock.calls[1]?.[0] as { requestId?: string } | undefined)
      ?.requestId;
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
  });

  it("remembers activeSessionId across reload so a surviving lease is not reset by a matching PROBE", () => {
    const first = makeSiteLink();
    const peer = { postMessage: vi.fn() };
    first.link.handleMessage(
      event(hello(token, "session-keep"), bridgeOrigin, peer, [{ close: vi.fn() }]),
    );
    first.link.dispose();

    // Simulate reload where sessionLease kept the connection alive (`isConnected() === true`).
    const options = {
      isConnected: () => true,
      onHello: vi.fn(),
      onError: vi.fn(),
      onWaiting: vi.fn(),
      onReset: vi.fn(),
    };
    const reloaded = createSiteLink(options);
    callbacks.push(reloaded.dispose);
    reloaded.handleMessage(
      event(packet("MALICE_OWLBEAR_SITE_PROBE", token, "session-keep"), bridgeOrigin, peer),
    );
    expect(options.onReset).not.toHaveBeenCalled();
    expect(peer.postMessage).not.toHaveBeenCalled();
  });
});

describe("background site pairing", () => {
  it("rejects unrelated origins and malformed requests before adopting a port", () => {
    const { options, receive } = makeBackground();
    const peer = { postMessage: vi.fn() };
    receive(packet("MALICE_OWLBEAR_SITE_CONNECT"), "https://unrelated.example", peer);
    receive({ ...packet("MALICE_OWLBEAR_SITE_CONNECT"), version: 999 }, siteOrigin, peer);
    receive(packet("MALICE_OWLBEAR_SITE_CONNECT", ""), siteOrigin, peer);
    receive(packet("MALICE_OWLBEAR_SITE_CONNECT", token, ""), siteOrigin, peer);
    expect(options.adopt).not.toHaveBeenCalled();
    expect(peer.postMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "MALICE_OWLBEAR_SITE_REJECT",
      }),
      "https://unrelated.example",
    );
  });

  it("retains the window, deduplicates discovery, and accepts a fresh request after reload", () => {
    const { options, receive } = makeBackground();
    const peer = { postMessage: vi.fn(), closed: false };
    const request = packet("MALICE_OWLBEAR_SITE_CONNECT");
    receive(request, siteOrigin, peer);
    receive(request, siteOrigin, peer);
    expect(options.adopt).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2_000);
    expect(peer.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "MALICE_OWLBEAR_SITE_PROBE",
        pairingToken: token,
      }),
      siteOrigin,
    );
    receive({ ...request, requestId: "refreshed-document" }, siteOrigin, peer);
    expect(options.adopt).toHaveBeenCalledTimes(2);
    receive(packet("MALICE_OWLBEAR_SITE_STOP", "wrong-token"), siteOrigin, peer);
    expect(options.disconnect).not.toHaveBeenCalled();
    receive(packet("MALICE_OWLBEAR_SITE_STOP"), siteOrigin, peer);
    expect(options.disconnect).toHaveBeenCalledOnce();
    peer.postMessage.mockClear();
    vi.advanceTimersByTime(4_000);
    expect(peer.postMessage).not.toHaveBeenCalled();
  });

  it("restores the opener capability after the room reloads", () => {
    storage.set(`${sessionKey}/room-1`, JSON.stringify({ origin: siteOrigin, token }));
    const opener = { postMessage: vi.fn(), closed: false };
    Object.assign(window.top!, { opener });
    makeBackground();
    vi.advanceTimersByTime(2_000);
    expect(opener.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MALICE_OWLBEAR_SITE_PROBE",
        pairingToken: token,
      }),
      siteOrigin,
    );
  });

  it("enables probe recovery dynamically when manageRecovery flips from false to true", () => {
    let allowRecovery = false;
    const peer = { postMessage: vi.fn(), closed: false };
    const background = createBackgroundSiteLink({
      roomId: "room-2",
      extensionVersion: "test",
      allowedOrigin: () => siteOrigin,
      isConnected: () => false,
      manageRecovery: () => allowRecovery,
      adopt: vi.fn(),
      disconnect: vi.fn(),
    });
    callbacks.push(background.dispose);
    listeners.get("message")?.(event(packet("MALICE_OWLBEAR_SITE_CONNECT"), siteOrigin, peer));
    peer.postMessage.mockClear();
    vi.advanceTimersByTime(4_000);
    expect(peer.postMessage).not.toHaveBeenCalled();
    allowRecovery = true;
    vi.advanceTimersByTime(2_000);
    expect(peer.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "MALICE_OWLBEAR_SITE_PROBE" }),
      siteOrigin,
    );
  });
});
