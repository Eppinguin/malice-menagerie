import { describe, expect, it } from "vitest";
import workerSource from "../../../obr/public/bridge-worker.js?raw";

/**
 * The shared worker is plain JavaScript served from `public/`, so it is not
 * part of the bundle. Evaluate it against a fake `self` and drive it with real
 * MessagePorts to prove the hand-off that a BroadcastChannel cannot do.
 */
const scope: { onconnect?: (event: { ports: MessagePort[] }) => void } = {};
new Function("self", workerSource)(scope);

function connect(): MessagePort {
  const channel = new MessageChannel();
  scope.onconnect?.({ ports: [channel.port1] });
  return channel.port2;
}

function inbox(port: MessagePort): { messages: Array<{ data: unknown; ports: MessagePort[] }> } {
  const messages: Array<{ data: unknown; ports: MessagePort[] }> = [];
  port.onmessage = (event) =>
    messages.push({ data: event.data, ports: [...((event as MessageEvent).ports ?? [])] });
  port.start();
  return { messages };
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

describe("bridge worker", () => {
  it("routes a transferred port to the registered background of the same room", async () => {
    const background = connect();
    const backgroundInbox = inbox(background);
    background.postMessage({ type: "register", role: "background", roomId: "room-a" });

    const popover = connect();
    const malice = new MessageChannel();
    popover.postMessage(
      { type: "bridge", roomId: "room-a", sessionId: "session", pairingToken: "token" },
      [malice.port1],
    );

    await until(() => backgroundInbox.messages.length === 1, "the adopted port");
    const adopt = backgroundInbox.messages[0]!;
    expect(adopt.data).toEqual({
      type: "adopt",
      sessionId: "session",
      pairingToken: "token",
    });
    const adopted = adopt.ports[0];
    expect(adopted).toBeInstanceOf(MessagePort);
    expect(adopt.ports).toHaveLength(1);

    // The adopted port is a live pipe to Malice's half of the channel.
    const adoptedInbox = inbox(adopted!);
    malice.port2.postMessage({ hello: true });
    await until(() => adoptedInbox.messages.length === 1, "traffic on the adopted port");
    expect(adoptedInbox.messages[0]?.data).toEqual({ hello: true });
  });

  it("keeps rooms apart", async () => {
    const background = connect();
    const backgroundInbox = inbox(background);
    background.postMessage({ type: "register", role: "background", roomId: "room-a" });

    const popover = connect();
    popover.postMessage({ type: "bridge", roomId: "room-b", sessionId: "s", pairingToken: "t" }, [
      new MessageChannel().port1,
    ]);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(backgroundInbox.messages).toHaveLength(0);
  });

  it("queues a port until a background registers, then delivers it", async () => {
    const popover = connect();
    popover.postMessage(
      { type: "bridge", roomId: "room-late", sessionId: "s", pairingToken: "t" },
      [new MessageChannel().port1],
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const background = connect();
    const backgroundInbox = inbox(background);
    background.postMessage({ type: "register", role: "background", roomId: "room-late" });

    await until(() => backgroundInbox.messages.length === 1, "the queued port");
    expect(backgroundInbox.messages[0]?.data).toMatchObject({ type: "adopt" });
    expect(backgroundInbox.messages[0]?.ports).toHaveLength(1);
  });

  it("ignores messages without a room id", async () => {
    const background = connect();
    const backgroundInbox = inbox(background);
    background.postMessage({ type: "register", role: "background", roomId: "room-c" });

    const popover = connect();
    popover.postMessage({ type: "bridge", sessionId: "s" }, [new MessageChannel().port1]);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(backgroundInbox.messages).toHaveLength(0);
  });

  it("evicts oldest queued pairings when overflowed so the latest pairing survives", async () => {
    const popover = connect();
    for (let i = 1; i <= 5; i += 1) {
      popover.postMessage(
        { type: "bridge", roomId: "room-overflow", sessionId: `s-${i}`, pairingToken: "t" },
        [new MessageChannel().port1],
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 15));

    const background = connect();
    const backgroundInbox = inbox(background);
    background.postMessage({ type: "register", role: "background", roomId: "room-overflow" });

    await until(() => backgroundInbox.messages.length === 4, "the 4 newest queued ports");
    expect(
      backgroundInbox.messages.map((m) => (m.data as { sessionId: string }).sessionId),
    ).toEqual(["s-2", "s-3", "s-4", "s-5"]);
  });

  it("removes a room background on unregister so subsequent bridges queue for the next background", async () => {
    const bg1 = connect();
    const bg1Inbox = inbox(bg1);
    bg1.postMessage({ type: "register", role: "background", roomId: "room-unreg" });
    bg1.postMessage({ type: "unregister", roomId: "room-unreg" });

    const popover = connect();
    popover.postMessage(
      { type: "bridge", roomId: "room-unreg", sessionId: "s-unreg", pairingToken: "t" },
      [new MessageChannel().port1],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bg1Inbox.messages).toHaveLength(0);

    const bg2 = connect();
    const bg2Inbox = inbox(bg2);
    bg2.postMessage({ type: "register", role: "background", roomId: "room-unreg" });
    await until(() => bg2Inbox.messages.length === 1, "queued port delivered to replacement");
    expect(bg2Inbox.messages[0]?.data).toMatchObject({ type: "adopt", sessionId: "s-unreg" });
  });

  it("evicts a dead probe-enabled background and queues the port for the next registration", async () => {
    const deadBg = connect();
    const deadInbox = inbox(deadBg);
    deadBg.postMessage({
      type: "register",
      role: "background",
      roomId: "room-probe",
      probe: true,
    });

    const popover = connect();
    popover.postMessage(
      { type: "bridge", roomId: "room-probe", sessionId: "s-probe", pairingToken: "t" },
      [new MessageChannel().port1],
    );
    await until(() => deadInbox.messages.length === 1, "probe ping");
    expect(deadInbox.messages[0]?.data).toMatchObject({ type: "ping" });

    // Never reply with pong; wait for probe timeout (>500ms), then register a live background.
    await new Promise((resolve) => setTimeout(resolve, 560));
    expect(deadInbox.messages).toHaveLength(1);

    const liveBg = connect();
    const liveInbox = inbox(liveBg);
    liveBg.postMessage({ type: "register", role: "background", roomId: "room-probe" });
    await until(() => liveInbox.messages.length === 1, "port delivered after dead bg evicted");
    expect(liveInbox.messages[0]?.data).toMatchObject({ type: "adopt", sessionId: "s-probe" });
  });

  it("delivers an in-flight probed port immediately when a replacement background registers", async () => {
    const oldBg = connect();
    const oldInbox = inbox(oldBg);
    oldBg.postMessage({
      type: "register",
      role: "background",
      roomId: "room-race",
      probe: true,
    });

    const popover = connect();
    popover.postMessage(
      { type: "bridge", roomId: "room-race", sessionId: "s-race", pairingToken: "t" },
      [new MessageChannel().port1],
    );
    await until(() => oldInbox.messages.length === 1, "probe ping to old bg");
    const probeId = (oldInbox.messages[0]?.data as { probeId?: string } | undefined)?.probeId;
    expect(probeId).toBeTruthy();

    // Replacement background registers BEFORE the 500ms probe times out.
    const newBg = connect();
    const newInbox = inbox(newBg);
    newBg.postMessage({
      type: "register",
      role: "background",
      roomId: "room-race",
      probe: true,
    });

    await until(() => newInbox.messages.length === 1, "in-flight port handed to new bg");
    expect(newInbox.messages[0]?.data).toMatchObject({ type: "adopt", sessionId: "s-race" });

    // Late pong from superseded oldBg must not cause a duplicate delivery.
    oldBg.postMessage({ type: "pong", probeId });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(oldInbox.messages).toHaveLength(1);
    expect(newInbox.messages).toHaveLength(1);
  });
});
