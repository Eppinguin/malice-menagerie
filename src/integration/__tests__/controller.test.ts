import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Encounter } from "../../types.ts";
import type {
  ImportResult,
  SceneState,
  SceneSummary,
  TokenMapping,
  UpdatesResponse,
} from "../../../shared/obr/protocol.ts";

const bridge = vi.hoisted(() => ({
  adopt: undefined as undefined | ((...args: unknown[]) => void),
  clients: [] as Array<{
    request: ReturnType<typeof vi.fn>;
    onEvent: (type: string, payload: unknown) => void;
    onStatus: (status: string, detail?: string) => void;
  }>,
  snapshot: undefined as undefined | ((encounterId: string) => Promise<SceneState>),
  update: undefined as undefined | (() => Promise<UpdatesResponse>),
  send: undefined as undefined | (() => Promise<ImportResult>),
}));
vi.mock("../client.ts", () => ({
  ProtocolError: class extends Error {},
  BridgeClient: class {
    request = vi.fn(
      async (
        type: string,
        payload: { encounterId: string; combatants: { instanceId: string }[] },
      ) => {
        if (type === "CONNECT") return { scene, extensionVersion: "test", linkedInstances: 1 };
        if (type === "GET_SCENE_STATE") return bridge.snapshot!(payload.encounterId);
        if (type === "UPDATE_COMBATANTS")
          return (
            bridge.update?.() ?? {
              appliedInstanceIds: payload.combatants.map((entry) => entry.instanceId),
            }
          );
        if (["IMPORT_ENCOUNTER", "ADD_COMBATANTS", "RECONCILE_ENCOUNTER"].includes(type))
          return bridge.send!();
        return {};
      },
    );
    constructor(
      _port: unknown,
      _session: string,
      options: {
        onEvent: (type: string, payload: unknown) => void;
        onStatus: (status: string, detail?: string) => void;
      },
    ) {
      bridge.clients.push({
        request: this.request,
        onEvent: options.onEvent,
        onStatus: options.onStatus,
      });
    }
    start() {}
    close() {}
  },
}));
vi.mock("../../store.ts", async () => {
  const { signal } = await import("@preact/signals");
  const { captainStaminaBonus, standing } = await import("../../lib/minions.ts");
  const { monsterAt } = await import("../../data.ts");
  const state = signal({ activeEncounterId: "a", encounters: [] as Encounter[] });
  return {
    state,
    activeEncounter: () =>
      state.value.encounters.find((entry) => entry.id === state.value.activeEncounterId)!,
    mutateApp: (mutate: (value: typeof state.value) => void) => {
      mutate(state.peek());
      state.value = { ...state.peek() };
    },
    releaseCaptain: (instances: Encounter["combat"]["instances"], captainId: string) => {
      const led = instances.filter((item) => item.captainId === captainId);
      for (const squad of led) {
        const m = monsterAt(squad.sourcePath);
        const bonus = m ? captainStaminaBonus(m) : 0;
        if (m && bonus && squad.captainId) {
          const alive = standing(squad.currentStamina, m.stamina + bonus);
          squad.currentStamina = Math.max(0, squad.currentStamina - bonus * alive);
          squad.maxStamina = m.stamina * squad.count;
        }
        delete squad.captainId;
      }
      return led;
    },
    reconcileCombat: vi.fn(),
    startCombat: vi.fn(),
    toast: vi.fn(),
  };
});
vi.mock("../../data.ts", () => ({
  monsterAt: vi.fn(() => ({ name: "Test monster", level: 1, keywords: [], stamina: 10 })),
  loadMonster: vi.fn(),
}));
vi.mock("../../../shared/obr/sessionLease.ts", () => ({
  sessionLeaseId: () => "test",
  openSessionLease: (options: { onAdopt: typeof bridge.adopt }) => {
    bridge.adopt = options.onAdopt;
    return null;
  },
}));
vi.mock("../../../shared/obr/siteLink.ts", () => ({
  createSiteLink: () => ({ stop() {}, dispose() {} }),
}));
vi.mock("../pairingRelay.ts", () => ({ openPairingRelay: () => null }));

const scene: SceneSummary = {
  roomId: "room",
  sceneId: "scene",
  sceneReady: true,
  label: "Scene",
  gridDpi: 150,
  viewport: { x: 0, y: 0, scale: 1 },
};
function encounter(id: string): Encounter {
  return {
    id,
    name: id,
    items: [],
    groups: [],
    combat: {
      active: true,
      instances: [
        {
          id: `${id}-1`,
          kind: "creature",
          sourcePath: "test",
          name: id,
          groupId: "group",
          currentStamina: 10,
          maxStamina: 10,
          conditions: [],
        },
      ],
    },
  } as unknown as Encounter;
}
function snapshot(id: string, stamina = 10, currentScene = scene): SceneState {
  return {
    scene: currentScene,
    minionGroups: [],
    orphanTokens: [],
    mappings: [
      {
        encounterId: id,
        instanceId: `${id}-1`,
        sceneId: currentScene.sceneId,
        tokenIds: [`token-${id}`],
        kind: "creature",
        name: id,
        currentStamina: stamina,
        maxStamina: 10,
        conditions: [],
        missing: false,
        updatedAt: 1,
        slot: 0,
        entryId: null,
        minionGroupId: null,
        individualStamina: null,
      } satisfies TokenMapping,
    ],
  };
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function pair() {
  bridge.adopt!(
    {
      sessionId: `session-${bridge.clients.length}`,
      pairingToken: "token",
      extensionVersion: "test",
    },
    "https://extension.example",
    {},
  );
  return settle();
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  bridge.clients = [];
  bridge.snapshot = async (id) => snapshot(id);
  bridge.update = undefined;
  bridge.send = async () => ({
    mode: "reconcile",
    scene,
    mappings: snapshot("a").mappings,
    createdInstanceIds: [],
    created: 0,
    updated: 1,
    missing: [],
    warnings: [],
  });
  vi.stubGlobal("location", { href: "https://malice.example" });
  vi.stubGlobal("window", { addEventListener() {}, name: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
  const { state } = await import("../../store.ts");
  state.value = {
    ...state.peek(),
    activeEncounterId: "a",
    encounters: [encounter("a"), encounter("b")],
  };
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const controller = await import("../controller.ts");
  const store = await import("../../store.ts");
  controller.initOwlbearIntegration();
  await pair();
  await vi.advanceTimersByTimeAsync(120);
  return { ...controller, ...store };
}

it("keeps integration startup optional when secure UUIDs are unavailable", async () => {
  vi.stubGlobal("crypto", {});
  const { initOwlbearIntegration, connectFromSite, owlbearConnection } =
    await import("../controller.ts");
  expect(() => initOwlbearIntegration()).not.toThrow();
  connectFromSite("", "");
  expect(owlbearConnection.value.lastError).toContain("Open Malice over HTTPS");
});

it.each([true, false])(
  "aborts a prepared send after switching scenes (ready: %s)",
  async (sceneReady) => {
    const { sendToOwlbear } = await setup();
    const { loadMonster, monsterAt } = await import("../../data.ts");
    const send = vi.fn(bridge.send!);
    bridge.send = send;
    vi.mocked(monsterAt).mockReturnValueOnce(undefined);
    let finishLoad!: () => void;
    vi.mocked(loadMonster).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = () => resolve(monsterAt("test")!);
        }),
    );
    const sending = sendToOwlbear();
    await settle();
    expect(vi.mocked(loadMonster).mock.lastCall?.[0]).toBe("test");
    const otherScene = { ...scene, sceneId: "other", sceneReady };
    bridge.snapshot = async (id) => snapshot(id, 10, otherScene);
    bridge.clients[0]!.onEvent("SCENE_CHANGED", { scene: otherScene });
    finishLoad();
    await sending;
    expect(send).not.toHaveBeenCalled();
  },
);

describe("controller synchronization", () => {
  it.each([false, true])(
    "batches dirty combatants and retries only unacknowledged batches (failure: %s)",
    async (fail) => {
      const store = await import("../../store.ts");
      const template = encounter("a").combat.instances[0]!;
      store.state.value.encounters[0]!.combat.instances = Array.from(
        { length: 101 },
        (_, index) => ({
          ...template,
          id: `a-${index + 1}`,
        }),
      );
      bridge.snapshot = async (id) => ({
        ...snapshot(id),
        mappings: store.state.peek().encounters[0]!.combat.instances.map((instance) => ({
          ...snapshot(id).mappings[0]!,
          instanceId: instance.id,
          tokenIds: [`token-${instance.id}`],
        })),
      });
      const { mutateApp } = await setup();
      let calls = 0;
      const request = bridge.clients[0]!.request;
      const original = request.getMockImplementation()! as (
        type: string,
        payload: unknown,
      ) => Promise<unknown>;
      request.mockImplementation(async (type, payload) => {
        if (type === "UPDATE_COMBATANTS") {
          calls += 1;
          if (fail && calls === 2) throw new Error("temporary failure");
        }
        return original(type, payload);
      });
      mutateApp((app) => {
        for (const instance of app.encounters[0]!.combat.instances) {
          instance.groupId = "ungrouped";
          instance.currentStamina = 6;
        }
      });
      await vi.advanceTimersByTimeAsync(400);
      const requests = () =>
        bridge.clients[0]!.request.mock.calls.filter(([type]) => type === "UPDATE_COMBATANTS").map(
          ([, payload]) => payload as unknown as { combatants: { instanceId: string }[] },
        );
      expect(requests().map((payload) => payload.combatants.length)).toEqual(
        fail ? [50, 50] : [50, 50, 1],
      );
      await vi.advanceTimersByTimeAsync(3_000);
      expect(requests().map((payload) => payload.combatants.length)).toEqual(
        fail ? [50, 50, 50, 1] : [50, 50, 1],
      );
      const successful = requests()
        .filter((_, index) => !fail || index !== 1)
        .flatMap((payload) => payload.combatants);
      expect(new Set(successful.map((entry) => entry.instanceId)).size).toBe(101);
      expect(successful).toHaveLength(101);
    },
  );

  it("retains skipped edits and retries only those edits when the scene is refreshed", async () => {
    const { state } = await import("../../store.ts");
    const second = { ...encounter("a").combat.instances[0]!, id: "a-2" };
    state.value.encounters[0]!.combat.instances.push(second);
    const initial = snapshot("a");
    initial.mappings.push({ ...initial.mappings[0]!, instanceId: "a-2", tokenIds: ["token-2"] });
    bridge.snapshot = async () => initial;
    const { mutateApp, owlbearLog } = await setup();
    bridge.update = async () => ({ appliedInstanceIds: ["a-1"] });
    mutateApp((app) => {
      for (const instance of app.encounters[0]!.combat.instances) instance.currentStamina = 6;
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(owlbearLog.value.at(-1)).toContain("Synced 1 combatant update to Owlbear.");

    initial.mappings[0]!.currentStamina = 6;
    bridge.update = undefined;
    bridge.clients[0]!.onEvent("SCENE_CHANGED", { scene });
    await vi.advanceTimersByTimeAsync(400);
    const requests = bridge.clients[0]!.request.mock.calls.filter(
      ([type]) => type === "UPDATE_COMBATANTS",
    );
    expect(
      requests.map(([, payload]) =>
        payload.combatants.map((entry: { instanceId: string }) => entry.instanceId),
      ),
    ).toEqual([["a-1", "a-2"], ["a-2"]]);
  });

  it.each([false, true])(
    "reconciles external groups and combatant values while preserving pending local edits (%s)",
    async (localEdit) => {
      const { mutateApp, activeEncounter } = await setup();
      if (localEdit)
        mutateApp((app) => {
          const instance = app.encounters[0]!.combat.instances[0]!;
          instance.currentStamina = 6;
          instance.conditions = ["Slowed"];
        });
      bridge.snapshot = async (id) => ({
        ...snapshot(id, 4),
        mappings: snapshot(id, 4).mappings.map((mapping) => ({
          ...mapping,
          conditions: ["Dazed"],
        })),
        initiative: {
          encounterId: id,
          round: activeEncounter().combat.round,
          combatants: [
            {
              instanceId: `${id}-1`,
              groupId: "external",
              groupName: "External",
              turns: 1,
              turnsTaken: 0,
            },
          ],
        },
      });
      await pair();
      const expected = {
        groupId: "external",
        currentStamina: localEdit ? 6 : 4,
        conditions: localEdit ? ["Slowed"] : ["Dazed"],
      };
      expect(activeEncounter().combat.instances[0]).toMatchObject(expected);
      await vi.advanceTimersByTimeAsync(400);
      const updates = bridge.clients[1]!.request.mock.calls.filter(
        ([type]) => type === "UPDATE_COMBATANTS",
      );
      for (const [, payload] of updates)
        expect(payload).toMatchObject({
          combatants: [
            expect.objectContaining({
              currentStamina: expected.currentStamina,
              conditions: expected.conditions,
            }),
          ],
        });
      if (localEdit) expect(updates).not.toHaveLength(0);
    },
  );

  it("clears an empty encounter snapshot without clearing another encounter's links", async () => {
    const { state, owlbearStore, owlbearConnection, sendToOwlbear } = await setup();
    state.value = { ...state.peek(), activeEncounterId: "b" };
    await settle();
    state.value = { ...state.peek(), activeEncounterId: "a" };
    await settle();
    bridge.snapshot = async (id) => ({ ...snapshot(id), mappings: [] });
    await pair();
    expect(owlbearStore.value.encounters.a?.scenes.scene?.mappings).toEqual([]);
    expect(owlbearStore.value.encounters.b?.scenes.scene?.mappings).toHaveLength(1);
    expect(owlbearConnection.value.linkedInstances).toBe(0);
    await sendToOwlbear();
    expect(bridge.clients[1]!.request).toHaveBeenCalledWith(
      "IMPORT_ENCOUNTER",
      expect.objectContaining({ encounterId: "a", mode: "import" }),
      expect.any(Number),
    );
  });

  it.each(["stamina", "conditions", "both"])(
    "preserves and flushes a debounced %s edit when a send finishes",
    async (edit) => {
      const { mutateApp, activeEncounter, sendToOwlbear } = await setup();
      let resolve!: (result: ImportResult) => void;
      bridge.send = () =>
        new Promise((done) => {
          resolve = done;
        });
      const sending = sendToOwlbear();
      await settle();
      mutateApp((app) => {
        const instance = app.encounters[0]!.combat.instances[0]!;
        if (edit !== "conditions") instance.currentStamina = 6;
        if (edit !== "stamina") instance.conditions = ["Dazed"];
      });
      const expected = {
        currentStamina: edit === "conditions" ? 10 : 6,
        conditions: edit === "stamina" ? [] : ["Dazed"],
      };
      resolve({
        mode: "reconcile",
        scene,
        mappings: snapshot("a").mappings,
        createdInstanceIds: [],
        created: 0,
        updated: 1,
        missing: [],
        warnings: [],
      });
      await sending;
      expect(activeEncounter().combat.instances[0]).toMatchObject(expected);
      await vi.advanceTimersByTimeAsync(400);
      expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
        "UPDATE_COMBATANTS",
        expect.objectContaining({ combatants: [expect.objectContaining(expected)] }),
        45_000,
      );
    },
  );

  it("reads the newly selected encounter before sending and ignores superseded reads", async () => {
    const { state, owlbearConnection, activeEncounter } = await setup();
    let resolve!: (value: SceneState) => void;
    bridge.snapshot = () =>
      new Promise((done) => {
        resolve = done;
      });
    state.value = { ...state.peek(), activeEncounterId: "b" };
    const oldRead = resolve;
    expect(owlbearConnection.value.status).toBe("synchronizing");
    await vi.advanceTimersByTimeAsync(400);
    expect(bridge.clients[0]!.request).toHaveBeenLastCalledWith(
      "GET_SCENE_STATE",
      { encounterId: "b" },
      15_000,
    );
    state.value = { ...state.peek(), activeEncounterId: "a" };
    resolve(snapshot("a", 8));
    await settle();
    oldRead(snapshot("b", 3));
    await settle();
    expect(activeEncounter().combat.instances[0]!.currentStamina).toBe(8);
    expect(owlbearConnection.value.status).toBe("connected");
    expect(state.peek().encounters[1]!.combat.instances[0]!.currentStamina).toBe(10);
  });

  it("receives edits and deletions for an encounter after selecting it", async () => {
    const { state, owlbearStore, activeEncounter } = await setup();
    state.value = { ...state.peek(), activeEncounterId: "b" };
    await settle();
    expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
      "GET_SCENE_STATE",
      { encounterId: "b" },
      15_000,
    );
    bridge.clients[0]!.onEvent("COMBATANT_UPDATED", {
      encounterId: "b",
      sceneId: scene.sceneId,
      tokenIds: ["token-b"],
      observedAt: 1,
      update: { instanceId: "b-1", currentStamina: 5, maxStamina: 10 },
    });
    expect(activeEncounter().combat.instances[0]!.currentStamina).toBe(5);
    bridge.clients[0]!.onEvent("TOKEN_DELETED", {
      encounterId: "b",
      instanceId: "b-1",
      tokenIds: ["token-b"],
      allMissing: true,
    });
    expect(owlbearStore.value.encounters.b?.scenes.scene?.mappings[0]?.missing).toBe(true);
  });

  it.each(["debounced", "queued", "in flight"])(
    "preserves and flushes a %s edit across re-pairing",
    async (phase) => {
      const { mutateApp, activeEncounter } = await setup();
      mutateApp((app) => {
        const instance = app.encounters[0]!.combat.instances[0]!;
        instance.currentStamina = 6;
        instance.conditions = ["Dazed"];
      });
      if (phase !== "debounced") await vi.advanceTimersByTimeAsync(120);
      let acknowledge: (() => void) | undefined;
      if (phase === "in flight") {
        bridge.update = () =>
          new Promise<UpdatesResponse>((resolve) => {
            acknowledge = () => resolve({ appliedInstanceIds: ["a-1"] });
          });
        await vi.advanceTimersByTimeAsync(220);
      }
      bridge.update = undefined;
      await pair();
      acknowledge?.();
      await settle();
      expect(activeEncounter().combat.instances[0]).toMatchObject({
        currentStamina: 6,
        conditions: ["Dazed"],
      });
      await vi.advanceTimersByTimeAsync(400);
      expect(bridge.clients[1]!.request).toHaveBeenCalledWith(
        "UPDATE_COMBATANTS",
        expect.objectContaining({
          encounterId: "a",
          combatants: [expect.objectContaining({ currentStamina: 6, conditions: ["Dazed"] })],
        }),
        45_000,
      );
    },
  );

  it("keeps pending edits scoped to their scene", async () => {
    const { mutateApp, activeEncounter, owlbearConnection } = await setup();
    mutateApp((app) => {
      app.encounters[0]!.combat.instances[0]!.currentStamina = 6;
    });
    await vi.advanceTimersByTimeAsync(120);
    const otherScene = { ...scene, sceneId: "other" };
    bridge.snapshot = async (id) => snapshot(id, 4, otherScene);
    bridge.clients[0]!.onEvent("SCENE_CHANGED", { scene: otherScene });
    await settle();
    expect(activeEncounter().combat.instances[0]!.currentStamina).toBe(4);
    expect(owlbearConnection.value.scene?.sceneId).toBe("other");
    await vi.advanceTimersByTimeAsync(400);
    expect(bridge.clients[0]!.request).not.toHaveBeenCalledWith(
      "UPDATE_COMBATANTS",
      expect.anything(),
      expect.anything(),
    );
  });
});

it.each(["manual", "learned"])(
  "syncs %s statblock choices to an existing token",
  async (source) => {
    const { setManualStatblock, owlbearStore } = await setup();
    const ref = { resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" };
    bridge.clients[0]!.request.mockClear();
    if (source === "manual") setManualStatblock("test monster|1", ref);
    else
      owlbearStore.value = {
        ...owlbearStore.value,
        learnedStatblocks: { "test monster|1": ref },
      };
    await vi.advanceTimersByTimeAsync(400);
    expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
      "UPDATE_COMBATANTS",
      expect.objectContaining({
        expectedSceneId: "scene",
        combatants: [expect.objectContaining({ instanceId: "a-1", statblock: ref })],
      }),
      45_000,
    );
  },
);

it("serializes in-flight combatant flushes and sends follow-up edits once the first finishes", async () => {
  const { mutateApp } = await setup();
  let finishFirst!: (response: UpdatesResponse) => void;
  bridge.update = () =>
    new Promise<UpdatesResponse>((resolve) => {
      finishFirst = resolve;
    });
  mutateApp((app) => {
    app.encounters[0]!.combat.instances[0]!.currentStamina = 7;
  });
  await vi.advanceTimersByTimeAsync(400);
  const updateCalls = () =>
    bridge.clients[0]!.request.mock.calls.filter(([type]) => type === "UPDATE_COMBATANTS");
  expect(updateCalls()).toHaveLength(1);

  mutateApp((app) => {
    app.encounters[0]!.combat.instances[0]!.currentStamina = 4;
  });
  await vi.advanceTimersByTimeAsync(400);
  expect(updateCalls()).toHaveLength(1);

  bridge.update = undefined;
  finishFirst({ appliedInstanceIds: ["a-1"] });
  await vi.advanceTimersByTimeAsync(400);
  expect(updateCalls()).toHaveLength(2);
  expect(updateCalls()[1]?.[1]).toMatchObject({
    combatants: [expect.objectContaining({ instanceId: "a-1", currentStamina: 4 })],
  });
});

it("follows Owlbear selection only when enabled and clears on deselect or toggle off", async () => {
  const { setInverseSelection, owlbearSelectedInstanceId, owlbearSelectionPulse } = await setup();
  bridge.clients[0]!.onEvent("SELECTION_CHANGED", {
    encounterId: "a",
    instanceId: "a-1",
    tokenIds: ["token-a"],
  });
  expect(owlbearSelectionPulse.value).toBeNull();

  setInverseSelection(true);
  bridge.clients[0]!.onEvent("SELECTION_CHANGED", {
    encounterId: "a",
    instanceId: "a-1",
    tokenIds: ["token-a"],
  });
  expect(owlbearSelectedInstanceId.value).toBe("a-1");
  expect(owlbearSelectionPulse.value?.instanceId).toBe("a-1");

  const firstSeq = owlbearSelectionPulse.value!.seq;
  bridge.clients[0]!.onEvent("SELECTION_CHANGED", {
    encounterId: "a",
    instanceId: "a-1",
    tokenIds: ["token-a"],
  });
  expect(owlbearSelectionPulse.value!.seq).toBeGreaterThan(firstSeq);

  bridge.clients[0]!.onEvent("SELECTION_CHANGED", {
    encounterId: null,
    instanceId: null,
    tokenIds: [],
  });
  expect(owlbearSelectedInstanceId.value).toBeNull();
  expect(owlbearSelectionPulse.value).toBeNull();

  bridge.clients[0]!.onEvent("SELECTION_CHANGED", {
    encounterId: "a",
    instanceId: "a-1",
    tokenIds: ["token-a"],
  });
  setInverseSelection(false);
  expect(owlbearSelectedInstanceId.value).toBeNull();
  expect(owlbearSelectionPulse.value).toBeNull();
});

it("preserves and pushes Malice conditions when condition sync settings change", async () => {
  const { mutateApp, activeEncounter } = await setup();
  // Establish a clean combatant with Dazed in Malice while the map has no labels yet
  // (e.g. condition sync was off, or GM switched from Token Labels to Marked!).
  mutateApp((app) => {
    app.encounters[0]!.combat.instances[0]!.conditions = ["Dazed"];
  });
  await vi.advanceTimersByTimeAsync(400);
  bridge.clients[0]!.request.mockClear();

  bridge.snapshot = async (id) => ({
    ...snapshot(id, 10),
    mappings: snapshot(id, 10).mappings.map((mapping) => ({
      ...mapping,
      conditions: ["Slowed"],
    })),
  });
  bridge.clients[0]!.onEvent("SCENE_CHANGED", { scene, reason: "conditions" });
  await settle();
  await vi.advanceTimersByTimeAsync(400);

  expect(activeEncounter().combat.instances[0]!.conditions).toEqual(["Dazed", "Slowed"]);
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "UPDATE_COMBATANTS",
    expect.objectContaining({
      combatants: [
        expect.objectContaining({
          instanceId: "a-1",
          conditions: ["Dazed", "Slowed"],
        }),
      ],
    }),
    45_000,
  );
});

it("renames the active Owlbear scene and updates the displayed label", async () => {
  const { renameOwlbearScene, owlbearConnection } = await setup();
  bridge.clients[0]!.request.mockImplementationOnce(async () => ({
    scene: { ...scene, label: "Vault of Shadows" },
  }));
  const ok = await renameOwlbearScene("Vault of Shadows");
  expect(ok).toBe(true);
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "RENAME_SCENE",
    { expectedSceneId: "scene", label: "Vault of Shadows" },
    15_000,
  );
  expect(owlbearConnection.value.scene?.label).toBe("Vault of Shadows");
});

it("skips shared dice transport when companion reports Connected Dice is off", async () => {
  const { owlbearConnection } = await setup();
  const { requestSharedDice } = await import("../../lib/rollTransport.ts");
  bridge.clients[0]!.onEvent("SETTINGS_UPDATED", {
    settings: {
      ringsSync: false,
      conditionSync: "auto",
      diceEnabled: false,
      diceStatus: "disconnected",
      diceGmOnly: false,
    },
  });
  expect(owlbearConnection.value.settings?.diceEnabled).toBe(false);
  expect(requestSharedDice(2, "normal")).toBeNull();

  bridge.clients[0]!.onEvent("SETTINGS_UPDATED", {
    settings: {
      ringsSync: true,
      conditionSync: "marked",
      diceEnabled: true,
      diceStatus: "connected",
      diceGmOnly: true,
    },
  });
  bridge.clients[0]!.request.mockImplementationOnce(async () => ({ dice: [6, 7] }));
  const pending = requestSharedDice(2, "edge");
  expect(pending).not.toBeNull();
  await expect(pending).resolves.toMatchObject({ dice: [6, 7] });
});

it("syncs token visibility both ways, tracks defeated tokens, and prunes deleted encounters", async () => {
  const { setCombatantVisibility, defeatedMappings, mutateApp, owlbearStore, state } =
    await setup();
  bridge.clients[0]!.request.mockImplementationOnce(async () => ({ visible: false }));
  await setCombatantVisibility("a-1", false);
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "SET_VISIBILITY",
    { expectedSceneId: "scene", encounterId: "a", instanceId: "a-1", visible: false },
    15_000,
  );
  expect(owlbearStore.value.encounters.a?.scenes.scene?.mappings[0]?.visible).toBe(false);

  bridge.clients[0]!.onEvent("COMBATANT_UPDATED", {
    encounterId: "a",
    sceneId: scene.sceneId,
    tokenIds: ["token-a"],
    observedAt: 2,
    update: { instanceId: "a-1", currentStamina: 10, maxStamina: 10, visible: true },
  });
  expect(owlbearStore.value.encounters.a?.scenes.scene?.mappings[0]?.visible).toBe(true);

  expect(defeatedMappings()).toHaveLength(0);
  mutateApp((app) => {
    app.encounters[0]!.combat.instances[0]!.currentStamina = 0;
  });
  expect(defeatedMappings().map((entry) => entry.instanceId)).toEqual(["a-1"]);

  // Deleting an encounter prunes its cached Owlbear mappings.
  state.value = { ...state.peek(), activeEncounterId: "b" };
  await settle();
  expect(owlbearStore.value.encounters.a).toBeDefined();
  state.value = {
    ...state.peek(),
    encounters: state.peek().encounters.filter((entry) => entry.id !== "a"),
  };
  await settle();
  expect(owlbearStore.value.encounters.a).toBeUndefined();
});

it("skips condition sync for minion squads, resyncs initiative on partial deletion, and stays quiet when a defeated squad is cleared", async () => {
  const { state } = await import("../../store.ts");
  state.value.encounters[0]!.combat.instances = [
    {
      ...encounter("a").combat.instances[0]!,
      id: "squad-1",
      kind: "minion-squad",
      count: 4,
      name: "Squad 1 · Goblin",
      currentStamina: 20,
      maxStamina: 20,
      turns: 1,
      turnsTaken: 0,
      conditions: [],
    },
  ];
  bridge.snapshot = async () => ({
    ...snapshot("a"),
    mappings: [
      {
        ...snapshot("a").mappings[0]!,
        instanceId: "squad-1",
        kind: "minion-squad",
        name: "Squad 1 · Goblin",
        tokenIds: ["t1", "t2", "t3", "t4"],
        minionGroupId: "mm-squad-1",
        currentStamina: 20,
        maxStamina: 20,
        individualStamina: 5,
        conditions: ["Dazed"],
      },
    ],
  });
  const { mutateApp, activeEncounter, toast } = await setup();
  // Incoming squad conditions are ignored.
  expect(activeEncounter().combat.instances[0]!.conditions).toEqual([]);

  bridge.clients[0]!.request.mockClear();
  // Local condition edits on a minion squad do not trigger outbound combatant sync.
  mutateApp((app) => {
    app.encounters[0]!.combat.instances[0]!.conditions = ["Slowed"];
  });
  await vi.advanceTimersByTimeAsync(400);
  expect(bridge.clients[0]!.request).not.toHaveBeenCalledWith(
    "UPDATE_COMBATANTS",
    expect.anything(),
    expect.anything(),
  );

  // Stamina updates on a minion squad omit conditions so per-minion labels stay untouched.
  mutateApp((app) => {
    app.encounters[0]!.combat.instances[0]!.currentStamina = 14;
  });
  await vi.advanceTimersByTimeAsync(400);
  const updateCall = bridge.clients[0]!.request.mock.calls.find(
    ([type]) => type === "UPDATE_COMBATANTS",
  );
  expect(updateCall?.[1]).toMatchObject({
    combatants: [
      expect.objectContaining({
        instanceId: "squad-1",
        currentStamina: 14,
        individualStamina: 5,
      }),
    ],
  });
  expect(
    (updateCall?.[1] as { combatants?: Array<{ conditions?: string[] }> } | undefined)
      ?.combatants?.[0]?.conditions,
  ).toBeUndefined();

  // Partial deletion of a minion token triggers SYNC_INITIATIVE so a surviving minion takes over
  // the Rings carrier role if the deleted minion was the carrier.
  bridge.clients[0]!.request.mockClear();
  bridge.clients[0]!.onEvent("TOKEN_DELETED", {
    encounterId: "a",
    instanceId: "squad-1",
    tokenIds: ["t1"],
    allMissing: false,
  });
  await vi.advanceTimersByTimeAsync(400);
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "SYNC_INITIATIVE",
    expect.objectContaining({ encounterId: "a" }),
    45_000,
  );

  // Clearing all tokens of a defeated squad must not warn with a "lost its Owlbear token" toast.
  mutateApp((app) => {
    app.encounters[0]!.combat.instances[0]!.currentStamina = 0;
  });
  await vi.advanceTimersByTimeAsync(400);
  vi.mocked(toast).mockClear();
  bridge.clients[0]!.onEvent("TOKEN_DELETED", {
    encounterId: "a",
    instanceId: "squad-1",
    tokenIds: ["t2", "t3", "t4"],
    allMissing: true,
  });
  expect(toast).not.toHaveBeenCalled();
});

it("detaches a minion squad captain when the captain drops to 0 Stamina in Owlbear", async () => {
  const { state } = await import("../../store.ts");
  const base = encounter("a").combat.instances[0]!;
  state.value.encounters[0]!.combat.instances = [
    {
      ...base,
      id: "cap-1",
      sourcePath: "en/unified/json/monster/goblin/statblock/goblin-warrior.json",
      kind: "creature",
      count: 1,
      name: "Goblin Boss",
      groupId: "g1",
      currentStamina: 20,
      maxStamina: 20,
      turns: 1,
      turnsTaken: 0,
      conditions: [],
    },
    {
      ...base,
      id: "sq-1",
      sourcePath: "en/unified/json/monster/goblin/statblock/goblin-minion.json",
      kind: "minion-squad",
      count: 4,
      name: "Goblin Minions",
      groupId: "g1",
      captainId: "cap-1",
      currentStamina: 28,
      maxStamina: 28,
      turns: 1,
      turnsTaken: 0,
      conditions: [],
    },
  ];
  const data = await import("../../data.ts");
  vi.mocked(data.monsterAt).mockImplementation((path: string) =>
    path.includes("minion")
      ? ({
          id: "m-minion",
          name: "Goblin Minion",
          level: 1,
          role: "Skirmisher",
          organization: "Minion",
          keywords: ["Goblin"],
          stamina: 5,
          withCaptain: "+2 bonus to Stamina",
        } as unknown as ReturnType<typeof data.monsterAt>)
      : ({
          id: "m-boss",
          name: "Goblin Boss",
          level: 1,
          role: "Leader",
          organization: "Leader",
          keywords: ["Goblin"],
          stamina: 20,
          withCaptain: "",
        } as unknown as ReturnType<typeof data.monsterAt>),
  );
  bridge.snapshot = async () => ({
    ...snapshot("a"),
    mappings: [
      {
        ...snapshot("a").mappings[0]!,
        instanceId: "cap-1",
        name: "Goblin Boss",
        tokenIds: ["t-cap"],
        currentStamina: 20,
        maxStamina: 20,
      },
      {
        ...snapshot("a").mappings[0]!,
        instanceId: "sq-1",
        kind: "minion-squad",
        name: "Goblin Minions",
        tokenIds: ["t-m1", "t-m2", "t-m3", "t-m4"],
        minionGroupId: "mm-sq-1",
        currentStamina: 28,
        maxStamina: 28,
        individualStamina: 7,
      },
    ],
  });
  const { activeEncounter, toast } = await setup();
  bridge.clients[0]!.request.mockClear();
  vi.mocked(toast).mockClear();

  bridge.clients[0]!.onEvent("COMBATANT_UPDATED", {
    encounterId: "a",
    sceneId: scene.sceneId,
    tokenIds: ["t-cap"],
    observedAt: Date.now(),
    update: {
      instanceId: "cap-1",
      currentStamina: 0,
      maxStamina: 20,
      name: "Goblin Boss",
      activationGroupId: "g1",
      activationGroupName: "Group 1",
      statblock: null,
      revision: 0,
    },
  });

  const squad = activeEncounter().combat.instances.find((entry) => entry.id === "sq-1")!;
  expect(squad.captainId).toBeUndefined();
  expect(squad.maxStamina).toBe(20);
  expect(squad.currentStamina).toBe(20);
  expect(toast).toHaveBeenCalledWith("Goblin Minions lost its captain");

  await vi.advanceTimersByTimeAsync(400);
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "UPDATE_COMBATANTS",
    expect.objectContaining({
      combatants: expect.arrayContaining([
        expect.objectContaining({
          instanceId: "sq-1",
          currentStamina: 20,
          maxStamina: 20,
          individualStamina: 5,
        }),
      ]),
    }),
    45_000,
  );
});

it("skips SYNC_INITIATIVE when Rings sync is disabled and supports single-combatant sends", async () => {
  const { state } = await import("../../store.ts");
  const base = encounter("a").combat.instances[0]!;
  state.value.encounters[0]!.combat.instances.push({
    ...base,
    id: "inst-2",
    sourcePath: "en/unified/json/monster/goblin/statblock/goblin-warrior.json",
    kind: "creature",
    count: 1,
    name: "Goblin Archer",
    groupId: "g1",
    currentStamina: 15,
    maxStamina: 15,
    turns: 1,
    turnsTaken: 0,
    conditions: [],
  });
  const data = await import("../../data.ts");
  vi.mocked(data.monsterAt).mockReturnValue({
    id: "m-goblin",
    name: "Goblin Warrior",
    level: 1,
    role: "Ambusher",
    organization: "Horde",
    keywords: ["Goblin"],
    stamina: 15,
    withCaptain: "",
  } as unknown as ReturnType<typeof data.monsterAt>);

  const { sendCombatantToOwlbear, mutateApp } = await setup();
  bridge.clients[0]!.onEvent("SETTINGS_UPDATED", {
    settings: {
      ringsSync: false,
      conditionSync: "auto",
      diceEnabled: false,
      diceStatus: "disconnected",
      diceGmOnly: false,
    },
  });
  bridge.clients[0]!.request.mockClear();
  mutateApp((app) => {
    app.encounters[0]!.combat.round = 2;
  });
  await vi.advanceTimersByTimeAsync(400);
  expect(bridge.clients[0]!.request).not.toHaveBeenCalledWith(
    "SYNC_INITIATIVE",
    expect.anything(),
    expect.anything(),
  );

  bridge.clients[0]!.request.mockImplementation(async (type) => {
    if (type === "ADD_COMBATANTS") {
      return {
        mode: "add",
        scene: snapshot("a").scene,
        mappings: snapshot("a").mappings,
        createdInstanceIds: ["inst-2"],
        created: 1,
        updated: 0,
        missing: [],
        warnings: [],
      };
    }
    return {};
  });
  await sendCombatantToOwlbear("inst-2", { hidden: true });
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "ADD_COMBATANTS",
    expect.objectContaining({
      mode: "add",
      hidden: true,
      combatants: [expect.objectContaining({ instanceId: "inst-2" })],
    }),
    120_000,
  );
});

it("updates linkedInstances on token deletion, cleanup, and disconnect, and avoids redundant SYNC_INITIATIVE for single-token Rings updates", async () => {
  const { cleanupOrphanTokens, disconnectOwlbear, owlbearConnection, mutateApp } = await setup();
  expect(owlbearConnection.value.linkedInstances).toBe(1);
  mutateApp((app) => {
    const enc = app.encounters[0]!;
    enc.party = { heroes: 4, level: 1, victories: 0, bonusMalice: 0 };
    enc.combat.round = 1;
    enc.combat.malice = 0;
    enc.combat.activeEffects = [];
    enc.combat.instances[0]!.turns = 1;
    enc.combat.instances[0]!.turnsTaken = 0;
  });
  await vi.advanceTimersByTimeAsync(400);

  // A single-token creature turn toggle in Rings should not echo SYNC_INITIATIVE back.
  bridge.clients[0]!.request.mockClear();
  bridge.clients[0]!.onEvent("INITIATIVE_UPDATED", {
    sceneId: snapshot("a").scene.sceneId,
    initiative: {
      encounterId: "a",
      round: 1,
      combatants: [{ instanceId: "a-1", groupId: "g1", groupName: "A", turns: 1, turnsTaken: 1 }],
    },
  });
  await vi.advanceTimersByTimeAsync(400);
  expect(bridge.clients[0]!.request).not.toHaveBeenCalledWith(
    "SYNC_INITIATIVE",
    expect.anything(),
    expect.anything(),
  );

  // Deleting the token updates linkedInstances immediately.
  bridge.clients[0]!.onEvent("TOKEN_DELETED", {
    encounterId: "a",
    instanceId: "a-1",
    tokenIds: ["token-a"],
    allMissing: true,
  });
  expect(owlbearConnection.value.linkedInstances).toBe(0);

  // Confirm cleanupOrphanTokens & disconnectOwlbear keep linkedInstances accurate.
  bridge.clients[0]!.request.mockResolvedValue({ deleted: 1 });
  await cleanupOrphanTokens(["a-1"]);
  expect(owlbearConnection.value.linkedInstances).toBe(0);

  await disconnectOwlbear();
  expect(owlbearConnection.value.linkedInstances).toBe(0);
});

it("resets stale connection state on transport disconnect/loss and clears unresolved/selection on encounter switch", async () => {
  const {
    owlbearConnection,
    owlbearUnresolved,
    owlbearSelectedInstanceId,
    setManualStatblock,
    removeManualStatblock,
    owlbearStore,
    mutateApp,
  } = await setup();

  bridge.clients[0]!.onEvent("SETTINGS_UPDATED", {
    settings: {
      ringsSync: true,
      conditionSync: "auto",
      diceEnabled: true,
      diceStatus: "connected",
      diceGmOnly: true,
    },
  });
  owlbearUnresolved.value = [
    { key: "goblin|1", name: "Goblin", level: 1, reason: "ambiguous", candidates: [] },
  ];
  owlbearSelectedInstanceId.value = "a-1";
  setManualStatblock("goblin|1", { resourceId: "res-1", name: "Goblin" });
  expect(owlbearStore.value.manualStatblocks["goblin|1"]).toEqual({
    resourceId: "res-1",
    name: "Goblin",
  });
  removeManualStatblock("goblin|1");
  expect(owlbearStore.value.manualStatblocks["goblin|1"]).toBeUndefined();

  // Switching encounters clears unresolved statblocks and selection.
  owlbearUnresolved.value = [
    { key: "goblin|1", name: "Goblin", level: 1, reason: "ambiguous", candidates: [] },
  ];
  mutateApp((app) => {
    app.activeEncounterId = "b";
  });
  await settle();
  expect(owlbearUnresolved.value).toEqual([]);
  expect(owlbearSelectedInstanceId.value).toBeNull();

  // Transport disconnect via onStatus clears settings, scene, linkedInstances, unresolved, and selection.
  owlbearUnresolved.value = [
    { key: "orc|1", name: "Orc", level: 1, reason: "missing", candidates: [] },
  ];
  owlbearSelectedInstanceId.value = "b-1";
  bridge.clients[0]!.onStatus("disconnected", "Disconnected from popover.");
  expect(owlbearConnection.value).toMatchObject({
    status: "disconnected",
    detail: "Disconnected from popover.",
    settings: null,
    scene: null,
    linkedInstances: 0,
    progress: null,
  });
  expect(owlbearUnresolved.value).toEqual([]);
  expect(owlbearSelectedInstanceId.value).toBeNull();
});

it("guards cleanupOrphanTokens with owlbearBusy, supports encounter cleanup, and dispatches DICE_CONTROL", async () => {
  const {
    cleanupOrphanTokens,
    cleanupEncounterTokens,
    linkedTokensForEncounter,
    cancelSharedRoll,
    retryConnectedDice,
    setConnectedDiceGmOnly,
    owlbearBusy,
  } = await setup();

  expect(linkedTokensForEncounter("a")).toBe(1);

  let releaseCleanup!: () => void;
  bridge.clients[0]!.request.mockImplementation(async (type) => {
    if (type === "CLEANUP_COMBATANTS") {
      await new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      return { deleted: 1 };
    }
    return {};
  });

  const first = cleanupOrphanTokens(["a-1"]);
  expect(owlbearBusy.value).toBe(true);
  // Concurrent call while busy is ignored.
  await cleanupOrphanTokens(["a-1"]);
  expect(
    bridge.clients[0]!.request.mock.calls.filter(([type]) => type === "CLEANUP_COMBATANTS"),
  ).toHaveLength(1);
  releaseCleanup();
  await first;
  expect(owlbearBusy.value).toBe(false);

  // Dice controls send DICE_CONTROL commands.
  await cancelSharedRoll();
  await retryConnectedDice();
  await setConnectedDiceGmOnly(true);
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "DICE_CONTROL",
    { action: "cancel" },
    5_000,
  );
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "DICE_CONTROL",
    { action: "retry" },
    5_000,
  );
  expect(bridge.clients[0]!.request).toHaveBeenCalledWith(
    "DICE_CONTROL",
    { action: "set-gm-only", gmOnly: true },
    5_000,
  );

  // Cleanup encounter tokens returns 0 when no tokens remain.
  expect(await cleanupEncounterTokens("a")).toBe(0);
});

it("excludes restart-reattachable tokens from orphanedMappings and skips UPDATE_COMBATANTS on group-only moves", async () => {
  const { orphanedMappings, restartReattachableMappings, mutateApp } = await setup();
  // Move group only: must not send UPDATE_COMBATANTS.
  bridge.clients[0]!.request.mockClear();
  mutateApp((app) => {
    const enc = app.encounters[0]!;
    enc.combat.instances[0]!.entryId = "entry-1";
    enc.combat.instances[0]!.groupId = "g2";
  });
  await vi.advanceTimersByTimeAsync(400);
  expect(bridge.clients[0]!.request).not.toHaveBeenCalledWith(
    "UPDATE_COMBATANTS",
    expect.anything(),
    expect.anything(),
  );

  // Simulate a full combat restart where entryId/slot match old mappings.
  const restartSnapshot: SceneState = {
    ...snapshot("a"),
    mappings: [
      { ...snapshot("a").mappings[0]!, instanceId: "old-1", entryId: "entry-1", slot: 0 },
      { ...snapshot("a").mappings[0]!, instanceId: "old-summon", entryId: null, slot: 0 },
    ],
  };
  bridge.snapshot = async () => restartSnapshot;
  bridge.clients[0]!.onEvent("SCENE_CHANGED", { scene });
  await settle();

  expect(restartReattachableMappings().map((entry) => entry.instanceId)).toEqual(["old-1"]);
  expect(orphanedMappings().map((entry) => entry.instanceId)).toEqual(["old-summon"]);
});

it("does not let CONNECTED overwrite synchronizing status and avoids isStaleScene deadlock on newer scene", async () => {
  const { owlbearConnection, sendToOwlbear } = await setup();
  let releaseSceneState!: () => void;
  const newerScene: SceneSummary = { ...scene, sceneId: "scene-2", label: "Scene 2" };

  bridge.snapshot = async () => {
    await new Promise<void>((resolve) => {
      releaseSceneState = resolve;
    });
    return snapshot("a", 10, newerScene);
  };

  // Trigger a re-sync via SCENE_CHANGED to a newer scene while a CONNECTED event races in.
  bridge.clients[0]!.onEvent("SCENE_CHANGED", { scene: newerScene });
  expect(owlbearConnection.value.status).toBe("synchronizing");

  bridge.clients[0]!.onEvent("CONNECTED", {
    extensionVersion: "test",
    scene,
    linkedInstances: 1,
  });
  expect(owlbearConnection.value.status).toBe("synchronizing");

  releaseSceneState();
  await settle();
  expect(owlbearConnection.value.status).toBe("connected");
  expect(owlbearConnection.value.scene?.sceneId).toBe("scene-2");

  // Sending on the newly adopted scene-2 must succeed (not deadlock as stale).
  const sendMock = vi.fn(async () => ({
    mode: "reconcile" as const,
    scene: newerScene,
    mappings: snapshot("a", 10, newerScene).mappings,
    createdInstanceIds: [],
    created: 0,
    updated: 1,
    missing: [],
    warnings: [],
  }));
  bridge.send = sendMock;
  await sendToOwlbear();
  expect(sendMock).toHaveBeenCalledOnce();
  expect(owlbearConnection.value.lastError).toBeNull();
});

it("ignores SELECTION_CHANGED for another encounter and TOKEN_DELETED for another scene", async () => {
  const { owlbearSelectedInstanceId, owlbearStore, setInverseSelection } = await setup();
  setInverseSelection(true);

  bridge.clients[0]!.onEvent("SELECTION_CHANGED", {
    encounterId: "other-enc",
    instanceId: "other-1",
    tokenIds: ["t-other"],
  });
  expect(owlbearSelectedInstanceId.value).toBeNull();

  bridge.clients[0]!.onEvent("SELECTION_CHANGED", {
    encounterId: "a",
    instanceId: "a-1",
    tokenIds: ["token-a"],
  });
  expect(owlbearSelectedInstanceId.value).toBe("a-1");

  // TOKEN_DELETED for a different scene must not mark active scene's mapping missing.
  bridge.clients[0]!.onEvent("TOKEN_DELETED", {
    encounterId: "a",
    instanceId: "a-1",
    sceneId: "old-scene",
    tokenIds: ["token-a"],
    allMissing: true,
  });
  const stored = owlbearStore.value.encounters["a"]?.scenes["scene"]?.mappings ?? [];
  expect(stored.find((entry) => entry.instanceId === "a-1")?.missing).toBe(false);
});

it("keeps restart alignment ephemeral on failed sends and preserves remaining reattachments on single-combatant sends", async () => {
  const {
    sendToOwlbear,
    sendCombatantToOwlbear,
    owlbearStore,
    restartReattachableMappings,
    mutateApp,
  } = await setup();
  mutateApp((app) => {
    const enc = app.encounters[0]!;
    enc.combat.instances = [
      { ...enc.combat.instances[0]!, id: "new-1", entryId: "entry-1" },
      { ...enc.combat.instances[0]!, id: "new-2", entryId: "entry-2", name: "Orc" },
    ];
  });
  const restartSnapshot: SceneState = {
    ...snapshot("a"),
    mappings: [
      {
        ...snapshot("a").mappings[0]!,
        instanceId: "old-1",
        entryId: "entry-1",
        slot: 0,
        tokenIds: ["t-1"],
      },
      {
        ...snapshot("a").mappings[0]!,
        instanceId: "old-2",
        entryId: "entry-2",
        slot: 0,
        tokenIds: ["t-2"],
      },
    ],
  };
  bridge.snapshot = async () => restartSnapshot;
  bridge.clients[0]!.onEvent("SCENE_CHANGED", { scene });
  await settle();
  expect(restartReattachableMappings()).toHaveLength(2);

  // Failed full send must NOT mutate persisted owlbearStore mappings.
  bridge.send = async () => {
    throw new Error("boom");
  };
  await sendToOwlbear();
  const afterFailure = owlbearStore.value.encounters["a"]?.scenes["scene"]?.mappings ?? [];
  expect(afterFailure.some((entry) => entry.instanceId === "old-1")).toBe(true);
  expect(afterFailure.some((entry) => entry.instanceId === "new-1")).toBe(false);

  // Single-combatant send for new-1 must NOT run restart alignment on old-1/old-2
  // (existingTokenIds stays empty, leaving old tokens untouched on the scene).
  bridge.clients[0]!.request.mockClear();
  bridge.send = async () => ({
    mode: "add",
    scene,
    mappings: [
      ...restartSnapshot.mappings,
      {
        ...snapshot("a").mappings[0]!,
        instanceId: "new-1",
        entryId: "entry-1",
        slot: 0,
        tokenIds: ["t-new-1"],
      },
    ],
    createdInstanceIds: ["new-1"],
    created: 1,
    updated: 0,
    missing: [],
    warnings: [],
  });
  await sendCombatantToOwlbear("new-1");
  const addCall = bridge.clients[0]!.request.mock.calls.find(([type]) => type === "ADD_COMBATANTS");
  const sentCombatants =
    (
      addCall?.[1] as
        | { combatants: Array<{ instanceId: string; existingTokenIds: string[] }> }
        | undefined
    )?.combatants ?? [];
  expect(sentCombatants).toHaveLength(1);
  expect(sentCombatants[0]?.existingTokenIds).toEqual([]);
  const afterSingle = owlbearStore.value.encounters["a"]?.scenes["scene"]?.mappings ?? [];
  expect(afterSingle.some((entry) => entry.instanceId === "old-2")).toBe(true);
});

it("returns -1 from cleanupEncounterTokens when busy or when cleanup fails", async () => {
  const { cleanupEncounterTokens } = await setup();
  bridge.clients[0]!.request.mockImplementation(async (type) => {
    if (type === "CLEANUP_COMBATANTS") throw new Error("scene locked");
    return {};
  });
  expect(await cleanupEncounterTokens("a")).toBe(-1);
});

it("pushes reduced minion squad stamina after reconnect when captain died before squad in snapshot order", async () => {
  const { monsterAt } = await import("../../data.ts");
  vi.mocked(monsterAt).mockImplementation((path: string) =>
    path === "minion"
      ? ({
          name: "Goblin Minion",
          level: 1,
          keywords: ["minion"],
          stamina: 4,
          organization: "minion",
          role: "harrier",
          withCaptain: "+2 bonus to Stamina",
        } as never)
      : ({
          name: "Goblin Captain",
          level: 1,
          keywords: [],
          stamina: 20,
          organization: "leader",
          role: "leader",
          withCaptain: "",
        } as never),
  );
  const { mutateApp } = await setup();
  mutateApp((app) => {
    const enc = app.encounters[0]!;
    enc.combat.instances = [
      {
        id: "cap-1",
        kind: "creature",
        sourcePath: "captain",
        name: "Captain",
        groupId: "group",
        currentStamina: 20,
        maxStamina: 20,
        conditions: [],
      } as never,
      {
        id: "sq-1",
        kind: "minion-squad",
        sourcePath: "minion",
        name: "Minions",
        groupId: "group",
        count: 4,
        captainId: "cap-1",
        currentStamina: 24, // 4 * (4 + 2 captain bonus)
        maxStamina: 24,
        conditions: [],
      } as never,
    ];
  });
  // Snapshot lists captain at 0 stamina BEFORE squad still at 24 stamina.
  bridge.snapshot = async () => ({
    scene,
    minionGroups: [],
    orphanTokens: [],
    mappings: [
      {
        ...snapshot("a").mappings[0]!,
        instanceId: "cap-1",
        tokenIds: ["t-cap"],
        currentStamina: 0,
        maxStamina: 20,
      },
      {
        ...snapshot("a").mappings[0]!,
        instanceId: "sq-1",
        kind: "minion-squad",
        tokenIds: ["t-m1", "t-m2", "t-m3", "t-m4"],
        minionGroupId: "mm-a-sq-1",
        currentStamina: 24,
        maxStamina: 24,
        individualStamina: 6,
      },
    ],
  });
  bridge.clients[0]!.request.mockClear();
  bridge.clients[0]!.onEvent("SCENE_CHANGED", { scene });
  await settle();
  await vi.advanceTimersByTimeAsync(400);

  // Squad's captain was released so its stamina dropped to 16 (4*4) and must be pushed back to OBR!
  const updateCalls = bridge.clients[0]!.request.mock.calls.filter(
    ([type]) => type === "UPDATE_COMBATANTS",
  );
  expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  const pushedSquad = updateCalls
    .flatMap(
      ([, payload]) =>
        (payload as { combatants: Array<{ instanceId: string; currentStamina: number }> })
          .combatants,
    )
    .find((entry) => entry.instanceId === "sq-1");
  expect(pushedSquad?.currentStamina).toBe(16);
});

it("does not spin in a retry loop when SYNC_INITIATIVE fails with INVALID_PAYLOAD", async () => {
  const { ProtocolError } = await import("../client.ts");
  const { mutateApp } = await setup();
  let syncCalls = 0;
  bridge.clients[0]!.request.mockImplementation(async (type) => {
    if (type === "SYNC_INITIATIVE") {
      syncCalls += 1;
      const err = new ProtocolError({ code: "INVALID_PAYLOAD", message: "Bad initiative" });
      Object.assign(err, { code: "INVALID_PAYLOAD" });
      throw err;
    }
    return {};
  });
  mutateApp((app) => {
    app.encounters[0]!.combat.round = 2;
  });
  await vi.advanceTimersByTimeAsync(1_500);
  expect(syncCalls).toBe(1);
});
