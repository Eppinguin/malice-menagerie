import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeClient } from "../client.ts";
import { makeEnvelope, newMessageId } from "../../../shared/obr/protocol.ts";

function setup() {
  const port = new EventTarget() as MessagePort;
  port.start = vi.fn();
  port.close = vi.fn();
  port.postMessage = vi.fn();
  const onStatus = vi.fn();
  const client = new BridgeClient(port, "session", { onEvent: vi.fn(), onStatus, onLog: vi.fn() });
  client.start();
  return { port, client, onStatus };
}

afterEach(() => vi.useRealTimers());

describe("BridgeClient liveness", () => {
  it("waits for the handshake before reporting connected", () => {
    const { client, onStatus } = setup();
    expect(onStatus).toHaveBeenCalledWith("connecting");
    expect(onStatus).not.toHaveBeenCalledWith("connected");
    client.close();
  });

  it("keeps the lost state and rejects pending requests when the peer is silent", async () => {
    vi.useFakeTimers();
    const { client, onStatus } = setup();
    const request = client.request("GET_SCENE_STATE", { encounterId: null }, 100_000);
    const failure = expect(request).rejects.toThrow("Owlbear stopped responding");
    await vi.advanceTimersByTimeAsync(80_000);
    await failure;
    expect(client.isClosed).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith("lost", expect.stringContaining("press Connect"));
  });

  it("probes after sleep instead of dropping a port before queued replies arrive", () => {
    vi.useFakeTimers();
    const { client } = setup();
    vi.setSystemTime(Date.now() + 120_000);
    vi.advanceTimersByTime(5_000);
    expect(client.isClosed).toBe(false);
    client.close();
  });

  it("rejects immediately when the port cannot send", async () => {
    const { client, port, onStatus } = setup();
    vi.mocked(port.postMessage).mockImplementation(() => {
      throw new Error("Detached port");
    });
    await expect(client.request("PING", {})).rejects.toThrow("Detached port");
    expect(client.isClosed).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith("lost", expect.stringContaining("press Connect"));
  });

  it("answers the background heartbeat and closes immediately on DISCONNECTED", () => {
    const { client, port, onStatus } = setup();
    port.dispatchEvent(
      new MessageEvent("message", {
        data: makeEnvelope(
          "owlbear",
          "session",
          "PONG",
          { receivedAt: Date.now() },
          newMessageId(),
        ),
      }),
    );
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "PING" }));
    port.dispatchEvent(
      new MessageEvent("message", {
        data: makeEnvelope(
          "owlbear",
          "session",
          "DISCONNECTED",
          { reason: "Reconnect from Owlbear." },
          newMessageId(),
        ),
      }),
    );
    expect(client.isClosed).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith("disconnected", "Reconnect from Owlbear.");
  });

  it("still drops a silent peer under 60s background-tab timer throttling", () => {
    vi.useFakeTimers();
    const { client, onStatus } = setup();
    // Simulate a background tab whose 5s interval only fires once every 60s.
    // Neither 60s jump exceeds WAKE_JUMP_MS (90s), so after the second tick
    // total silence (130s) exceeds LOST_AFTER_MS (75s) and drops the peer.
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(5_000);
    expect(client.isClosed).toBe(false);
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(5_000);
    expect(client.isClosed).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith("lost", expect.stringContaining("press Connect"));
  });

  it("removes message listeners from the port on close", () => {
    const { client, port, onStatus } = setup();
    client.close();
    onStatus.mockClear();
    port.dispatchEvent(
      new MessageEvent("message", {
        data: makeEnvelope(
          "owlbear",
          "session",
          "DISCONNECTED",
          { reason: "Late event" },
          newMessageId(),
        ),
      }),
    );
    expect(onStatus).not.toHaveBeenCalled();
  });
});
