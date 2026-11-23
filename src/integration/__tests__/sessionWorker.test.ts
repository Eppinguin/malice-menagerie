import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HELLO_MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
} from "../../../shared/obr/protocol.ts";

class Port {
  peer: Port | null = null;
  onmessage: ((event: { data: unknown; ports: Port[] }) => void) | null = null;
  closed = false;
  postMessage(data: unknown, ports: Port[] = []) {
    if (!this.closed && !this.peer?.closed) this.peer?.onmessage?.({ data, ports });
  }
  close() {
    this.closed = true;
  }
}
class Channel {
  port1 = new Port();
  port2 = new Port();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}
const hello = {
  protocol: PROTOCOL_NAME,
  version: PROTOCOL_VERSION,
  type: HELLO_MESSAGE_TYPE,
  sessionId: "session",
  pairingToken: "private",
  extensionVersion: "test",
};
const CONTROL = "malice-menagerie/session-transport";
let scope: { onconnect: (event: { ports: Port[] }) => void };

function document(role = "client") {
  const channel = new Channel();
  const messages: Array<{ data: Record<string, unknown>; ports: Port[] }> = [];
  channel.port2.onmessage = (event) => messages.push(event as (typeof messages)[number]);
  scope.onconnect({ ports: [channel.port1] });
  channel.port2.postMessage({ type: "register", role });
  return { port: channel.port2, messages };
}
function install(doc: ReturnType<typeof document>) {
  const channel = new Channel();
  doc.port.postMessage({ type: "install", hello, origin: "https://extension.example" }, [
    channel.port1,
  ]);
  return channel.port2;
}

beforeEach(async () => {
  vi.resetModules();
  scope = {} as typeof scope;
  vi.stubGlobal("self", scope);
  vi.stubGlobal("MessageChannel", Channel);
  await import("../../../shared/obr/sessionWorker.ts");
});
afterEach(() => vi.unstubAllGlobals());

describe("channel retention during document reloads", () => {
  it("forwards protocol messages and gives a refreshed app a new local port", () => {
    const app = document();
    const remote = install(app);
    const outgoing: unknown[] = [];
    remote.onmessage = ({ data }) => outgoing.push(data);
    const oldLocal = app.messages[0]!.ports[0]!;
    oldLocal.postMessage({ type: "CONNECT" });
    expect(outgoing).toEqual([{ type: "CONNECT" }]);
    const refreshed = document();
    expect(refreshed.messages[0]!.data["hello"]).toEqual(hello);
    const newLocal = refreshed.messages[0]!.ports[0]!;
    oldLocal.postMessage({ type: "STALE" });
    newLocal.postMessage({ type: "CONNECT", refreshed: true });
    expect(outgoing).toEqual([{ type: "CONNECT" }, { type: "CONNECT", refreshed: true }]);
    const incoming: unknown[] = [];
    newLocal.onmessage = ({ data }) => incoming.push(data);
    remote.postMessage({ type: "CONNECTED" });
    expect(incoming).toEqual([{ type: "CONNECTED" }]);
  });

  it("asks the app to repeat CONNECT when a refreshed background attaches", () => {
    const background = document("server");
    const remote = install(background);
    const outgoing: unknown[] = [];
    remote.onmessage = ({ data }) => outgoing.push(data);
    const refreshed = document("server");
    expect(refreshed.messages[0]!.data["hello"]).toEqual(hello);
    expect(outgoing).toEqual([{ transport: CONTROL, type: "resume" }]);
  });

  it("replaces the app's local channel when its remote background resumes", () => {
    const app = document();
    const remote = install(app);
    remote.postMessage({ transport: CONTROL, type: "resume" });
    expect(app.messages.map((m) => m.data["type"])).toEqual(["session", "session"]);
  });

  it("revokes the remote capability and does not restore after explicit disconnect", () => {
    const app = document();
    const remote = install(app);
    const outgoing: unknown[] = [];
    remote.onmessage = ({ data }) => outgoing.push(data);
    app.port.postMessage({ type: "clear" });
    expect(outgoing).toEqual([{ transport: CONTROL, type: "stop" }]);
    expect(document().messages).toEqual([]);
    expect(app.messages.map((m) => m.data["type"])).toEqual(["session"]);
  });

  it("notifies the app when the extension disconnects and drops the retained channel", () => {
    const app = document();
    const remote = install(app);
    remote.postMessage({ transport: CONTROL, type: "stop" });
    expect(app.messages.map((m) => m.data["type"])).toEqual(["session", "forgot"]);
    expect(app.messages[1]?.data["reason"]).toBe("stopped");
    expect(document().messages).toEqual([]);
  });

  it("ignores messages from an obsolete document and notifies the displaced owner", () => {
    const app = document();
    install(app);
    document();
    expect(app.messages.map((m) => m.data["type"])).toEqual(["session", "forgot"]);
    expect(app.messages[1]?.data["reason"]).toBe("displaced");
    app.port.postMessage({ type: "clear" });
    expect(document().messages[0]!.data["type"]).toBe("session");
  });

  it("buffers install until the worker sends ready and falls back directly to onAdopt on worker error", async () => {
    const port = new Port();
    const peer = new Port();
    port.peer = peer;
    peer.peer = port;
    (port as unknown as { start: () => void }).start = vi.fn();
    const receivedByWorker: Array<{ data: unknown; ports: Port[] }> = [];
    peer.onmessage = (event) => receivedByWorker.push(event);
    const hooks: { onerror: (() => void) | null } = { onerror: null };
    class MockSharedWorker {
      port = port;
      set onerror(fn: (() => void) | null) {
        hooks.onerror = fn;
      }
      get onerror(): (() => void) | null {
        return hooks.onerror;
      }
    }
    vi.stubGlobal("SharedWorker", MockSharedWorker);
    const { openSessionLease } = await import("../../../shared/obr/sessionLease.ts");
    const onAdopt = vi.fn();
    const onError = vi.fn();
    const lease = openSessionLease({
      name: "room-2",
      role: "client",
      onAdopt,
      onForgot: vi.fn(),
      onError,
    });
    expect(receivedByWorker).toHaveLength(1);
    expect(receivedByWorker[0]?.data).toEqual({ type: "register", role: "client", ack: true });

    // install() before ready is buffered rather than sent immediately.
    const channel = new Channel();
    lease!.install(hello, "https://extension.example", channel.port1 as unknown as MessagePort);
    expect(receivedByWorker).toHaveLength(1);

    const order: string[] = [];
    onError.mockImplementation(() => order.push("error"));
    onAdopt.mockImplementation(() => order.push("adopt"));

    // Worker fails before sending ready -> notifies onError first (so recovery
    // flags flip on without clobbering the adopted connection), then adopts the
    // buffered port directly and ignores any subsequent worker messages.
    hooks.onerror?.();
    expect(order).toEqual(["error", "adopt"]);
    expect(onAdopt).toHaveBeenCalledWith(hello, "https://extension.example", channel.port1);
    expect(port.closed).toBe(true);
    expect(port.onmessage).toBeNull();

    // Subsequent error calls are idempotent.
    hooks.onerror?.();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("openSessionLease.close detaches listeners and closes the worker port", async () => {
    const port = new Port();
    const start = vi.fn();
    (port as unknown as { start: typeof start }).start = start;
    class MockSharedWorker {
      port = port;
      onerror: (() => void) | null = null;
    }
    vi.stubGlobal("SharedWorker", MockSharedWorker);
    const { openSessionLease } = await import("../../../shared/obr/sessionLease.ts");
    const onForgot = vi.fn();
    const lease = openSessionLease({
      name: "room-1",
      role: "server",
      onAdopt: vi.fn(),
      onForgot,
      onError: vi.fn(),
    });
    expect(lease).not.toBeNull();
    expect(port.onmessage).not.toBeNull();
    lease!.close();
    expect(port.onmessage).toBeNull();
    expect(port.closed).toBe(true);
    expect(onForgot).not.toHaveBeenCalled();
  });
});
