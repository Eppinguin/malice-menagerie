import { describe, expect, it, vi } from "vitest";
import { BridgeHost, type CommandHandlers } from "../../../obr/src/bridgeHost.ts";
import { makeEnvelope, newMessageId, type BridgeEnvelope } from "../../../shared/obr/protocol.ts";

const sessionId = "session-1";
const pairingToken = "pair-token";

const scene = {
  roomId: "room-1",
  sceneId: "scene-1",
  sceneReady: true,
  gridDpi: 256,
  viewport: { x: 0, y: 0, scale: 1 },
  label: "Room · Scene",
};

function handlers() {
  return {
    connect: vi.fn<CommandHandlers["connect"]>(async () => ({
      extensionVersion: "0.1.0",
      protocolVersion: 1,
      scene,
      linkedInstances: 0,
    })),
    rollPower: vi.fn<NonNullable<CommandHandlers["rollPower"]>>(async () => ({ dice: [7, 8] })),
    diceControl: vi.fn<NonNullable<CommandHandlers["diceControl"]>>(async () => {}),
    disconnect: vi.fn<CommandHandlers["disconnect"]>(async () => {}),
    sceneState: vi.fn<CommandHandlers["sceneState"]>(async () => ({
      scene,
      mappings: [],
      minionGroups: [],
      orphanTokens: [],
    })),
    import: vi.fn<CommandHandlers["import"]>(async () => ({
      mode: "add",
      scene,
      mappings: [],
      createdInstanceIds: [],
      created: 0,
      updated: 0,
      missing: [],
      warnings: [],
    })),
    updates: vi.fn<CommandHandlers["updates"]>(async () => ({ appliedInstanceIds: [] })),
    update: vi.fn<CommandHandlers["update"]>(async () => {}),
    select: vi.fn<CommandHandlers["select"]>(async () => {}),
    focus: vi.fn<CommandHandlers["focus"]>(async () => {}),
    setVisibility: vi.fn<NonNullable<CommandHandlers["setVisibility"]>>(async (payload) => ({
      visible: payload.visible,
    })),
    cleanup: vi.fn<CommandHandlers["cleanup"]>(async () => ({ deleted: 0 })),
    renameScene: vi.fn<NonNullable<CommandHandlers["renameScene"]>>(async (payload) => ({
      scene: { ...scene, label: payload.label || scene.label },
    })),
    onEncounter: vi.fn<CommandHandlers["onEncounter"]>(),
    onConnectionChange: vi.fn<CommandHandlers["onConnectionChange"]>(),
  };
}

/** Wires a BridgeHost to one end of a MessageChannel and returns Malice's end. */
function connect(
  options: {
    sessionId?: string;
    pairingToken?: string;
    lostAfterMs?: number;
    checkMs?: number;
  } = {},
) {
  const channel = new MessageChannel();
  const inbox: BridgeEnvelope[] = [];
  const malice = channel.port2;
  malice.onmessage = (event: MessageEvent<BridgeEnvelope>) => inbox.push(event.data);
  malice.start();

  const api = handlers();
  const host = new BridgeHost({
    port: channel.port1,
    sessionId: options.sessionId ?? sessionId,
    pairingToken: options.pairingToken ?? pairingToken,
    handlers: api,
    ...(options.lostAfterMs === undefined ? {} : { lostAfterMs: options.lostAfterMs }),
    ...(options.checkMs === undefined ? {} : { checkMs: options.checkMs }),
  });
  return { host, malice, inbox, api };
}

function command(
  type: Parameters<typeof makeEnvelope>[2],
  payload: unknown,
  overrides: Partial<BridgeEnvelope> = {},
): BridgeEnvelope {
  return {
    ...makeEnvelope("malice", sessionId, type, payload, newMessageId()),
    ...overrides,
  };
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function connectMessage(token = pairingToken): BridgeEnvelope {
  return command("CONNECT", { appVersion: "1.0.0", encounterId: null, pairingToken: token });
}

describe("BridgeHost", () => {
  it("preserves structured SDK errors and allows a failed handshake to be retried", async () => {
    const { host, malice, inbox, api } = connect();
    api.connect.mockRejectedValueOnce({ error: { message: "Scene is not ready" } });
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 1, "structured error");
    expect(inbox[0]?.error?.message).toBe("Scene is not ready");
    expect(host.isConnected).toBe(false);
    malice.postMessage(connectMessage());
    await until(() => host.isConnected, "retried handshake");
    expect(api.connect).toHaveBeenCalledTimes(2);
    host.close();
    malice.close();
  });
  it("refuses a CONNECT with the wrong pairing token and stays unconnected", async () => {
    const { malice, inbox, api } = connect();
    malice.postMessage(connectMessage("not-the-token"));
    await until(() => inbox.length === 1, "the pairing error");
    expect(inbox[0]?.ok).toBe(false);
    expect(inbox[0]?.error?.code).toBe("PAIRING");
    expect(api.connect).not.toHaveBeenCalled();

    malice.postMessage(command("GET_SCENE_STATE", { encounterId: null }));
    await until(() => inbox.length === 2, "the not-connected error");
    expect(inbox[1]?.error?.code).toBe("NOT_CONNECTED");
    expect(api.sceneState).not.toHaveBeenCalled();
  });

  it("ignores envelopes for another session or from the wrong source", async () => {
    const { malice, inbox, api } = connect();
    malice.postMessage(connectMessage("bad"));
    await until(() => inbox.length === 1, "the pairing error");

    malice.postMessage({ ...connectMessage(), sessionId: "other-session" });
    malice.postMessage({ ...connectMessage(), source: "owlbear" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(inbox).toHaveLength(1);
    expect(api.connect).not.toHaveBeenCalled();
  });

  it("connects on the right token, emits CONNECTED, then dispatches commands", async () => {
    const { malice, inbox, api } = connect();
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "the connect reply and event");
    expect(inbox[0]?.ok).toBe(true);
    expect(inbox[0]?.replyTo).toBeTruthy();
    expect(inbox[1]?.type).toBe("CONNECTED");
    expect(api.connect).toHaveBeenCalledTimes(1);
    expect(api.onConnectionChange).toHaveBeenCalledWith(true, expect.any(String));

    malice.postMessage(command("GET_SCENE_STATE", { encounterId: "enc-1" }));
    await until(() => inbox.length === 3, "the scene state reply");
    expect(inbox[2]?.ok).toBe(true);
    expect(api.sceneState).toHaveBeenCalledWith({ encounterId: "enc-1" });
    expect(api.onEncounter).toHaveBeenCalledWith("enc-1");
  });

  it("rejects a malformed command without dispatching it", async () => {
    const { malice, inbox, api } = connect();
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "the connect reply");

    malice.postMessage(command("UPDATE_COMBATANT", { encounterId: "enc-1", combatant: {} }));
    await until(() => inbox.length === 3, "the validation error");
    expect(inbox[2]?.ok).toBe(false);
    expect(inbox[2]?.error?.code).toBe("INVALID_PAYLOAD");
    expect(api.update).not.toHaveBeenCalled();
  });

  it("surfaces handler failures as an error reply and keeps serving", async () => {
    const { malice, inbox, api } = connect();
    api.focus.mockRejectedValueOnce(new Error("No token to focus."));
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "the connect reply");

    malice.postMessage(command("FOCUS_COMBATANT", { encounterId: "enc-1", instanceId: "i-1" }));
    await until(() => inbox.length === 3, "the failure reply");
    expect(inbox[2]?.ok).toBe(false);
    expect(inbox[2]?.error?.message).toBe("No token to focus.");

    malice.postMessage(command("PING", {}));
    await until(() => inbox.length === 4, "the ping reply");
    expect(inbox[3]?.ok).toBe(true);
  });

  it("answers heartbeats while a scene operation is still pending", async () => {
    const { host, malice, inbox, api } = connect();
    let finish!: () => void;
    api.focus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "connect");
    malice.postMessage(command("FOCUS_COMBATANT", { encounterId: "enc-1", instanceId: "i-1" }));
    await until(() => api.focus.mock.calls.length === 1, "slow operation");
    const ping = command("PING", {});
    malice.postMessage(ping);
    await until(
      () => inbox.some((entry) => entry.replyTo === ping.id),
      "heartbeat during operation",
    );
    expect(inbox.find((entry) => entry.replyTo === ping.id)?.ok).toBe(true);
    finish();
    host.close();
    malice.close();
  });

  it("returns the instance IDs acknowledged by a partial combatant update", async () => {
    const { host, malice, inbox, api } = connect();
    api.updates.mockResolvedValueOnce({ appliedInstanceIds: ["present"] });
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "connect");
    const update = {
      currentStamina: 3,
      maxStamina: 10,
      name: "Goblin",
      activationGroupId: "group-1",
      activationGroupName: "Goblins",
      statblock: null,
      revision: 1,
    };
    const batch = command("UPDATE_COMBATANTS", {
      expectedSceneId: scene.sceneId,
      encounterId: "enc-1",
      combatants: ["present", "missing"].map((instanceId) => ({ ...update, instanceId })),
    });

    malice.postMessage(batch);
    await until(() => inbox.some((entry) => entry.replyTo === batch.id), "update reply");
    expect(inbox.find((entry) => entry.replyTo === batch.id)).toMatchObject({
      ok: true,
      payload: { appliedInstanceIds: ["present"] },
    });
    host.close();
    malice.close();
  });

  it("does not execute queued mutations after the connection closes", async () => {
    const { host, malice, inbox, api } = connect();
    let finish!: () => void;
    api.focus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "connect");
    malice.postMessage(command("FOCUS_COMBATANT", { encounterId: "enc-1", instanceId: "i-1" }));
    await until(() => api.focus.mock.calls.length === 1, "slow operation");
    malice.postMessage(
      command("CLEANUP_COMBATANTS", {
        encounterId: "enc-1",
        instanceIds: ["i-1"],
        expectedSceneId: "scene-1",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    host.close();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.cleanup).not.toHaveBeenCalled();
    expect(host.isConnected).toBe(false);
    malice.close();
  });

  it("stops accepting commands after close", async () => {
    const { host, malice, inbox, api } = connect();
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "the connect reply");

    host.close("done");
    malice.postMessage(command("PING", {}));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(inbox).toHaveLength(3);
    expect(inbox[2]?.type).toBe("DISCONNECTED");
    expect(api.onConnectionChange).toHaveBeenCalledWith(false, "done");
  });

  it("drops a silent connection instead of reporting it as connected", async () => {
    const { malice, inbox, api } = connect({ lostAfterMs: 30, checkMs: 5 });
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "the connect reply");

    await until(
      () => api.onConnectionChange.mock.calls.some(([ok]) => ok === false),
      "the liveness timeout",
    );
    expect(api.onConnectionChange).toHaveBeenLastCalledWith(
      false,
      "Malice Menagerie stopped responding.",
    );
  });

  it("keeps the connection while heartbeats keep arriving", async () => {
    const { malice, inbox, api } = connect({ lostAfterMs: 40, checkMs: 5 });
    malice.postMessage(connectMessage());
    await until(() => inbox.length === 2, "the connect reply");

    for (let beat = 0; beat < 6; beat += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      malice.postMessage(command("PING", {}));
    }
    expect(api.onConnectionChange.mock.calls.some(([ok]) => ok === false)).toBe(false);
  });
});

it("returns shared dice without blocking scene updates during animation", async () => {
  const { host, malice, inbox, api } = connect();
  let finish!: (value: { dice: [number, number] }) => void;
  api.rollPower.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    malice.postMessage(connectMessage());
    await until(() => host.isConnected, "connection");
    const roll = command("ROLL_POWER", { bonus: 3, netEdges: 1 });
    malice.postMessage(roll);
    await until(() => api.rollPower.mock.calls.length === 1, "roll request");
    const sceneRequest = command("GET_SCENE_STATE", { encounterId: null });
    malice.postMessage(sceneRequest);
    await until(
      () => inbox.some((message) => message.replyTo === sceneRequest.id),
      "scene response during roll",
    );
    expect(inbox.some((message) => message.replyTo === roll.id)).toBe(false);
    finish({ dice: [7, 8] });
    await until(() => inbox.some((message) => message.replyTo === roll.id), "dice result");
    expect(inbox.find((message) => message.replyTo === roll.id)?.payload).toEqual({ dice: [7, 8] });
  } finally {
    host.close();
    malice.close();
  }
});

it("dispatches RENAME_SCENE and returns the updated scene summary", async () => {
  const { host, malice, inbox, api } = connect();
  try {
    malice.postMessage(connectMessage());
    await until(() => host.isConnected, "connection");
    const rename = command("RENAME_SCENE", { expectedSceneId: "scene-1", label: "Keep Gate" });
    malice.postMessage(rename);
    await until(() => inbox.some((entry) => entry.replyTo === rename.id), "rename reply");
    expect(api.renameScene).toHaveBeenCalledWith({
      expectedSceneId: "scene-1",
      label: "Keep Gate",
    });
    expect(inbox.find((entry) => entry.replyTo === rename.id)).toMatchObject({
      ok: true,
      payload: { scene: { label: "Keep Gate" } },
    });
  } finally {
    host.close();
    malice.close();
  }
});

it("dispatches SET_VISIBILITY and returns the applied visibility", async () => {
  const { host, malice, inbox, api } = connect();
  try {
    malice.postMessage(connectMessage());
    await until(() => host.isConnected, "connection");
    const hide = command("SET_VISIBILITY", {
      expectedSceneId: "scene-1",
      encounterId: "enc-1",
      instanceId: "inst-1",
      visible: false,
    });
    malice.postMessage(hide);
    await until(() => inbox.some((entry) => entry.replyTo === hide.id), "visibility reply");
    expect(api.setVisibility).toHaveBeenCalledWith({
      expectedSceneId: "scene-1",
      encounterId: "enc-1",
      instanceId: "inst-1",
      visible: false,
    });
    expect(inbox.find((entry) => entry.replyTo === hide.id)).toMatchObject({
      ok: true,
      payload: { visible: false },
    });
  } finally {
    host.close();
    malice.close();
  }
});

it("invokes handlers.disconnect on inbound DISCONNECT and dispatches DICE_CONTROL immediately", async () => {
  const { host, malice, inbox, api } = connect();
  try {
    malice.postMessage(connectMessage());
    await until(() => host.isConnected, "connection");
    const control = command("DICE_CONTROL", { action: "set-gm-only", gmOnly: true });
    malice.postMessage(control);
    await until(() => inbox.some((entry) => entry.replyTo === control.id), "dice control reply");
    expect(api.diceControl).toHaveBeenCalledWith({ action: "set-gm-only", gmOnly: true });

    const disc = command("DISCONNECT", {});
    malice.postMessage(disc);
    await until(() => host.isClosed, "host closed");
    expect(api.disconnect).toHaveBeenCalledTimes(1);
    expect(
      api.onConnectionChange.mock.calls.filter(([connected]) => connected === false),
    ).toHaveLength(1);
  } finally {
    host.close();
    malice.close();
  }
});

it("closes an unconnected host if CONNECT never arrives before handshake timeout", async () => {
  vi.useFakeTimers();
  try {
    const { host, malice, api } = connect();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(host.isClosed).toBe(true);
    expect(api.onConnectionChange).toHaveBeenCalledWith(
      false,
      expect.stringContaining("did not finish connecting"),
    );
    malice.close();
  } finally {
    vi.useRealTimers();
  }
});

it("drops a silent peer under 60s background-tab throttling", async () => {
  vi.useFakeTimers();
  try {
    const { host, malice, api } = connect({ lostAfterMs: 45_000, checkMs: 5_000 });
    malice.postMessage(connectMessage());
    await vi.advanceTimersByTimeAsync(10);
    expect(host.isConnected).toBe(true);
    // Simulate a throttled 60s tick where wall-clock moved past lostAfterMs but below sleep threshold.
    vi.setSystemTime(Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.isClosed).toBe(true);
    expect(api.onConnectionChange).toHaveBeenLastCalledWith(
      false,
      "Malice Menagerie stopped responding.",
    );
    malice.close();
  } finally {
    vi.useRealTimers();
  }
});
