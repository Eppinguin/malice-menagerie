import { describe, expect, it } from "vitest";
import workerSource from "../../../public/pairing-worker.js?raw";

/**
 * The tab relay is plain JavaScript served from `public/`, so evaluate it
 * against a fake `self` and drive it with real MessagePorts. This covers the
 * two-phase hand-off that keeps the pairing tab holding the port until the
 * target has proved it is alive.
 */
type Scope = { onconnect?: (event: { ports: MessagePort[] }) => void };

function loadWorker() {
  const scope: Scope = {};
  new Function("self", workerSource)(scope);
  return {
    connect() {
      const channel = new MessageChannel();
      scope.onconnect?.({ ports: [channel.port1] });
      const inbox: Array<{ data: Record<string, unknown>; ports: MessagePort[] }> = [];
      channel.port2.onmessage = (event) =>
        inbox.push({ data: event.data as Record<string, unknown>, ports: [...event.ports] });
      channel.port2.start();
      return { port: channel.port2, inbox };
    },
  };
}

async function until(check: () => boolean, label: string, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

describe("pairing worker", () => {
  it("prefers the tab that was last focused, not the pairing tab", async () => {
    const worker = loadWorker();
    const normal = worker.connect();
    normal.port.postMessage({ type: "register", tabId: "normal", pairing: false });
    normal.port.postMessage({ type: "focus", tabId: "normal", focused: true });

    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });

    await until(() => pairing.inbox.length === 1, "the welcome");
    expect(pairing.inbox[0]?.data).toEqual({
      type: "welcome",
      tabId: "pairing",
      preferred: "normal",
    });
  });

  it("reports no preferred tab when only the pairing tab exists", async () => {
    const worker = loadWorker();
    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });

    await until(() => pairing.inbox.length === 1, "the welcome");
    expect(pairing.inbox[0]?.data).toEqual({
      type: "welcome",
      tabId: "pairing",
      preferred: null,
    });
  });

  it("tells a waiting pairing tab when a normal tab arrives later", async () => {
    const worker = loadWorker();
    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });
    await until(() => pairing.inbox.length === 1, "the welcome");

    const normal = worker.connect();
    normal.port.postMessage({ type: "register", tabId: "normal", pairing: false });
    await until(() => pairing.inbox.length === 2, "the preferred update");
    expect(pairing.inbox[1]?.data).toEqual({
      type: "preferred",
      tabId: "pairing",
      preferred: "normal",
    });
  });

  it("moves the port only after the target answers prepare", async () => {
    const worker = loadWorker();
    const normal = worker.connect();
    normal.port.postMessage({ type: "register", tabId: "normal", pairing: false });
    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });
    await until(() => normal.inbox.length === 1, "the normal welcome");
    await until(() => pairing.inbox.length === 1, "the pairing welcome");

    pairing.port.postMessage({ type: "prepare", handoffId: "h1", to: "normal" });
    await until(() => normal.inbox.length === 2, "the prepare");
    expect(normal.inbox[1]?.data).toEqual({ type: "prepare", handoffId: "h1" });
    expect(normal.inbox[1]?.ports).toHaveLength(0);

    normal.port.postMessage({ type: "ready", handoffId: "h1" });
    await until(() => pairing.inbox.length === 2, "the commit");
    expect(pairing.inbox[1]?.data).toEqual({ type: "commit", handoffId: "h1" });

    const port = new MessageChannel().port1;
    pairing.port.postMessage(
      {
        type: "handoff",
        handoffId: "h1",
        origin: "https://extension.example",
        hello: { type: "hello" },
      },
      [port],
    );
    await until(() => normal.inbox.length === 3, "the adopt");
    expect(normal.inbox[2]?.data).toMatchObject({ type: "adopt", handoffId: "h1" });
    expect(normal.inbox[2]?.ports).toHaveLength(1);

    normal.port.postMessage({ type: "adopted", handoffId: "h1" });
    await until(() => pairing.inbox.length === 3, "the result");
    expect(pairing.inbox[2]?.data).toEqual({ type: "handoff-result", handoffId: "h1", ok: true });
  });

  it("keeps the port with the pairing tab when the target is gone", async () => {
    const worker = loadWorker();
    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });
    await until(() => pairing.inbox.length === 1, "the welcome");

    pairing.port.postMessage({ type: "prepare", handoffId: "h1", to: "missing" });
    await until(() => pairing.inbox.length === 2, "the abort");
    expect(pairing.inbox[1]?.data).toEqual({ type: "abort", handoffId: "h1" });
  });

  it("returns the port when the target refuses it", async () => {
    const worker = loadWorker();
    const normal = worker.connect();
    normal.port.postMessage({ type: "register", tabId: "normal", pairing: false });
    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });
    await until(() => normal.inbox.length === 1, "the normal welcome");
    await until(() => pairing.inbox.length === 1, "the pairing welcome");

    pairing.port.postMessage({ type: "prepare", handoffId: "h1", to: "normal" });
    await until(() => normal.inbox.length === 2, "the prepare");
    normal.port.postMessage({ type: "ready", handoffId: "h1" });
    await until(() => pairing.inbox.length === 2, "the commit");

    const port = new MessageChannel().port1;
    pairing.port.postMessage(
      { type: "handoff", handoffId: "h1", origin: "https://extension.example", hello: {} },
      [port],
    );
    await until(() => normal.inbox.length === 3, "the adopt");
    const transferred = normal.inbox[2]?.ports[0];
    expect(transferred).toBeInstanceOf(MessagePort);

    normal.port.postMessage({ type: "rejected", handoffId: "h1" }, [transferred!]);
    await until(() => pairing.inbox.length === 3, "the failed result");
    expect(pairing.inbox[2]?.data).toEqual({ type: "handoff-result", handoffId: "h1", ok: false });
    expect(pairing.inbox[2]?.ports).toHaveLength(1);
  });

  it("drops a target that never answers and tries the next tab", async () => {
    const worker = loadWorker();
    const first = worker.connect();
    first.port.postMessage({ type: "register", tabId: "first", pairing: false });
    const second = worker.connect();
    second.port.postMessage({ type: "register", tabId: "second", pairing: false });
    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });
    await until(() => pairing.inbox.length === 1, "the pairing welcome");
    expect(pairing.inbox[0]?.data).toMatchObject({ preferred: "second" });

    // "second" is a stale entry: it never answers the probe.
    pairing.port.postMessage({ type: "prepare", handoffId: "h1", to: "second" });
    await until(() => first.inbox.length === 2, "the retry to the live tab", 400);
    expect(first.inbox[1]?.data).toEqual({ type: "prepare", handoffId: "h1" });

    first.port.postMessage({ type: "ready", handoffId: "h1" });
    await until(() => pairing.inbox.some((entry) => entry.data.type === "commit"), "the commit");
    const commit = pairing.inbox.find((entry) => entry.data.type === "commit");
    expect(commit?.data).toEqual({ type: "commit", handoffId: "h1" });
  });

  it("forgets a tab that says goodbye instead of preferring it", async () => {
    const worker = loadWorker();
    const normal = worker.connect();
    normal.port.postMessage({ type: "register", tabId: "normal", pairing: false });
    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });
    await until(() => pairing.inbox.length === 1, "the pairing welcome");
    expect(pairing.inbox[0]?.data).toMatchObject({ preferred: "normal" });

    normal.port.postMessage({ type: "unregister", tabId: "normal" });
    await until(() => pairing.inbox.length === 2, "the preferred update");
    expect(pairing.inbox[1]?.data).toEqual({
      type: "preferred",
      tabId: "pairing",
      preferred: null,
    });

    pairing.port.postMessage({ type: "prepare", handoffId: "h1", to: "normal" });
    await until(() => pairing.inbox.length === 3, "the abort");
    expect(pairing.inbox[2]?.data).toEqual({ type: "abort", handoffId: "h1" });
  });

  it("does not let an unfocused background tab steal preference from a focused tab", async () => {
    const worker = loadWorker();
    const focused = worker.connect();
    focused.port.postMessage({ type: "register", tabId: "focused", pairing: false, focused: true });
    const bg = worker.connect();
    bg.port.postMessage({ type: "register", tabId: "bg", pairing: false, focused: false });

    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });
    await until(() => pairing.inbox.length === 1, "the pairing welcome");
    expect(pairing.inbox[0]?.data).toMatchObject({ preferred: "focused" });
  });

  it("ignores cancel and adopted messages from tabs that do not own the handoff", async () => {
    const worker = loadWorker();
    const normal = worker.connect();
    normal.port.postMessage({ type: "register", tabId: "normal", pairing: false });
    const bystander = worker.connect();
    bystander.port.postMessage({ type: "register", tabId: "bystander", pairing: false });
    const pairing = worker.connect();
    pairing.port.postMessage({ type: "register", tabId: "pairing", pairing: true });
    await until(() => pairing.inbox.length === 1, "pairing welcome");

    pairing.port.postMessage({ type: "prepare", handoffId: "h-auth", to: "normal" });
    await until(() => normal.inbox.length === 2, "prepare");

    // Bystander cannot cancel or adopt the handoff.
    bystander.port.postMessage({ type: "cancel", handoffId: "h-auth" });
    bystander.port.postMessage({ type: "adopted", handoffId: "h-auth" });

    normal.port.postMessage({ type: "ready", handoffId: "h-auth" });
    await until(() => pairing.inbox.some((entry) => entry.data.type === "commit"), "commit");
    expect(pairing.inbox.some((entry) => entry.data.type === "handoff-result")).toBe(false);
  });
});
