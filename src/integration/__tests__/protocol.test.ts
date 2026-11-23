import { describe, expect, it } from "vitest";
import {
  HELLO_MESSAGE_TYPE,
  LIMITS,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  READY_MESSAGE_TYPE,
  READY_REQUEST_TYPE,
  isBridgeEnvelope,
  isHelloMessage,
  isReadyMessage,
  isReadyRequestMessage,
  makeEnvelope,
  makeReadyMessage,
  makeReadyRequestMessage,
  newMessageId,
  parseAllowedOrigin,
  validateCommand,
  validateEvent,
  validateResponse,
  type BridgeEnvelope,
  type DesiredCombatant,
} from "../../../shared/obr/protocol.ts";

const sessionId = "session-1";
const pairingToken = "pair-token";

function commandEnvelope(overrides: Partial<BridgeEnvelope> = {}): BridgeEnvelope {
  return {
    ...makeEnvelope("malice", sessionId, "PING", {}, "message-1"),
    ...overrides,
  };
}

function desiredCombatant(overrides: Partial<DesiredCombatant> = {}): DesiredCombatant {
  return {
    instanceId: "instance-1",
    entryId: "entry-1",
    slot: 0,
    kind: "creature",
    name: "Goblin Warrior",
    count: 1,
    activationGroupId: "group-1",
    activationGroupName: "Front line",
    currentStamina: 20,
    maxStamina: 20,
    individualStamina: null,
    statblock: { resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" },
    minionGroupId: null,
    existingTokenIds: [],
    summoned: false,
    ...overrides,
  };
}

function sceneSummary() {
  return {
    roomId: "room-1",
    sceneId: "scene-1",
    sceneReady: true,
    gridDpi: 256,
    viewport: { x: 0, y: 0, scale: 1 },
    label: "Scene 1",
  };
}

describe("handshake messages", () => {
  it("recognises a valid HELLO", () => {
    const hello = {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      type: HELLO_MESSAGE_TYPE,
      sessionId,
      pairingToken,
      extensionVersion: "1.0.0",
    };
    expect(isHelloMessage(hello)).toBe(true);
  });

  it("rejects a HELLO from another protocol version or with a missing token", () => {
    const base = {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      type: HELLO_MESSAGE_TYPE,
      sessionId,
      pairingToken,
      extensionVersion: "1.0.0",
    };
    expect(isHelloMessage({ ...base, version: 2 })).toBe(false);
    expect(isHelloMessage({ ...base, protocol: "other" })).toBe(false);
    expect(isHelloMessage({ ...base, pairingToken: "" })).toBe(false);
    expect(isHelloMessage({ ...base, sessionId: "" })).toBe(false);
    expect(isHelloMessage({ ...base, pairingToken: "x".repeat(161) })).toBe(false);
    expect(isHelloMessage(null)).toBe(false);
    expect(isHelloMessage("hello")).toBe(false);
  });

  it("round-trips READY and READY_REQUEST", () => {
    expect(isReadyMessage(makeReadyMessage())).toBe(true);
    expect(isReadyRequestMessage(makeReadyRequestMessage(pairingToken))).toBe(true);
    expect(
      isReadyRequestMessage({ ...makeReadyRequestMessage(pairingToken), protocol: "other" }),
    ).toBe(false);
    expect(isReadyRequestMessage({ ...makeReadyRequestMessage(pairingToken), version: 0 })).toBe(
      false,
    );
    expect(isReadyRequestMessage(makeReadyRequestMessage(""))).toBe(false);
    expect(makeReadyMessage().type).toBe(READY_MESSAGE_TYPE);
    expect(makeReadyRequestMessage(pairingToken).type).toBe(READY_REQUEST_TYPE);
  });
});

describe("bridge envelopes", () => {
  it("accepts a well-formed envelope from either source", () => {
    expect(isBridgeEnvelope(commandEnvelope())).toBe(true);
    expect(
      isBridgeEnvelope(commandEnvelope({ source: "owlbear", type: "CONNECTED", payload: {} })),
    ).toBe(true);
  });

  it("rejects malformed or unknown envelopes", () => {
    expect(isBridgeEnvelope(null)).toBe(false);
    expect(isBridgeEnvelope([])).toBe(false);
    expect(isBridgeEnvelope(commandEnvelope({ protocol: "other" as never }))).toBe(false);
    expect(isBridgeEnvelope(commandEnvelope({ version: 99 }))).toBe(false);
    expect(isBridgeEnvelope(commandEnvelope({ type: "UNKNOWN" as never }))).toBe(false);
    expect(isBridgeEnvelope(commandEnvelope({ id: "" }))).toBe(false);
    expect(isBridgeEnvelope(commandEnvelope({ source: "relay" as never }))).toBe(false);
    expect(isBridgeEnvelope(commandEnvelope({ ts: Number.NaN }))).toBe(false);
    expect(isBridgeEnvelope(commandEnvelope({ error: { code: "", message: "bad" } }))).toBe(false);
  });

  it("keeps reply metadata only when valid", () => {
    expect(isBridgeEnvelope(commandEnvelope({ replyTo: "request-1" }))).toBe(true);
    expect(isBridgeEnvelope(commandEnvelope({ replyTo: "" }))).toBe(false);
    expect(isBridgeEnvelope(commandEnvelope({ ok: false }))).toBe(true);
    expect(isBridgeEnvelope(commandEnvelope({ ok: "yes" as never }))).toBe(false);
  });

  it("creates fresh, unique message ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newMessageId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
    expect(makeEnvelope("malice", sessionId, "PING", {}, "id").sessionId).toBe(sessionId);
  });
});

describe("command validation", () => {
  it("requires an app version and pairing token on CONNECT", () => {
    expect(
      validateCommand("CONNECT", { appVersion: "1.0.0", encounterId: null, pairingToken }),
    ).toEqual({ ok: true, value: { appVersion: "1.0.0", encounterId: null, pairingToken } });
    expect(validateCommand("CONNECT", { encounterId: null, pairingToken }).ok).toBe(false);
    expect(validateCommand("CONNECT", { appVersion: "1.0.0", encounterId: null }).ok).toBe(false);
    expect(
      validateCommand("CONNECT", { appVersion: "1.0.0", encounterId: 5, pairingToken }).ok,
    ).toBe(false);
  });

  it("truncates a long app version instead of trusting it", () => {
    const result = validateCommand("CONNECT", {
      appVersion: "v".repeat(100),
      encounterId: null,
      pairingToken,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as { appVersion: string }).appVersion).toHaveLength(40);
  });

  it("accepts empty payloads only for DISCONNECT and PING", () => {
    expect(validateCommand("DISCONNECT", {})).toEqual({ ok: true, value: {} });
    expect(validateCommand("PING", {})).toEqual({ ok: true, value: {} });
    expect(validateCommand("PING", null).ok).toBe(false);
  });

  it("validates an import request and keeps the declared mode", () => {
    const result = validateCommand("IMPORT_ENCOUNTER", {
      encounterId: "encounter-1",
      encounterName: "The Crypt",
      mode: "import",
      combatants: [desiredCombatant()],
      expectedSceneId: "scene-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { mode: string }).mode).toBe("import");
      expect((result.value as { combatants: unknown[] }).combatants).toHaveLength(1);
    }
  });

  it("rejects an import without a scene binding", () => {
    for (const expectedSceneId of [null, undefined, ""]) {
      expect(
        validateCommand("IMPORT_ENCOUNTER", {
          encounterId: "encounter-1",
          encounterName: "The Crypt",
          mode: "import",
          combatants: [desiredCombatant()],
          expectedSceneId,
        }).ok,
      ).toBe(false);
    }
  });

  it("preserves an optional artwork source path and rejects invalid path types", () => {
    const request = {
      encounterId: "encounter-1",
      encounterName: "Test",
      mode: "import",
      expectedSceneId: "scene-1",
      combatants: [
        desiredCombatant({
          sourcePath: "en/unified/json/monster/goblin/statblock/goblin-warrior.json@5",
        }),
      ],
    };
    const result = validateCommand("IMPORT_ENCOUNTER", request);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect((result.value as { combatants: DesiredCombatant[] }).combatants[0]?.sourcePath).toBe(
        request.combatants[0]?.sourcePath,
      );
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        ...request,
        combatants: [{ ...request.combatants[0], sourcePath: 42 }],
      }).ok,
    ).toBe(false);
  });

  it("rejects a mode that does not match the command", () => {
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        encounterId: "encounter-1",
        encounterName: "The Crypt",
        mode: "add",
        combatants: [desiredCombatant()],
        expectedSceneId: "scene-1",
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("ADD_COMBATANTS", {
        encounterId: "encounter-1",
        encounterName: "The Crypt",
        mode: "add",
        combatants: [desiredCombatant()],
        expectedSceneId: "scene-1",
      }).ok,
    ).toBe(true);
  });

  it("rejects empty, oversized, or malformed combatant lists", () => {
    const base = {
      encounterId: "encounter-1",
      encounterName: "The Crypt",
      mode: "import",
      expectedSceneId: "scene-1",
    };
    expect(validateCommand("IMPORT_ENCOUNTER", { ...base, combatants: [] }).ok).toBe(false);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        ...base,
        combatants: Array.from({ length: LIMITS.combatantsPerRequest + 1 }, () =>
          desiredCombatant(),
        ),
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        ...base,
        combatants: [desiredCombatant({ currentStamina: -1 })],
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        ...base,
        combatants: [desiredCombatant({ maxStamina: LIMITS.stamina + 1 })],
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        ...base,
        combatants: [desiredCombatant({ name: "x".repeat(LIMITS.nameLength + 1) })],
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        ...base,
        combatants: [desiredCombatant({ kind: "minion-squad", count: 4 })],
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        ...base,
        combatants: [desiredCombatant({ kind: "dragon" as never })],
      }).ok,
    ).toBe(false);
  });

  it("accepts a minion squad only when it has per-minion Stamina", () => {
    const result = validateCommand("IMPORT_ENCOUNTER", {
      encounterId: "encounter-1",
      encounterName: "The Crypt",
      mode: "import",
      combatants: [
        desiredCombatant({
          kind: "minion-squad",
          count: 4,
          currentStamina: 20,
          maxStamina: 20,
          individualStamina: 5,
          minionGroupId: "mm-instance-1",
        }),
      ],
      expectedSceneId: "scene-1",
    });
    expect(result.ok).toBe(true);
  });

  it("validates single and batched updates", () => {
    const combatant = {
      instanceId: "instance-1",
      currentStamina: 10,
      maxStamina: 20,
      name: "Goblin Warrior",
      activationGroupId: "group-1",
      activationGroupName: "Front line",
      statblock: null,
      revision: 3,
    };
    expect(
      validateCommand("UPDATE_COMBATANT", { expectedSceneId: "scene", encounterId: "e", combatant })
        .ok,
    ).toBe(true);
    expect(
      validateCommand("UPDATE_COMBATANTS", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatants: [combatant],
      }).ok,
    ).toBe(true);
    expect(
      validateCommand("UPDATE_COMBATANTS", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatants: [],
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("UPDATE_COMBATANTS", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatants: Array.from({ length: 51 }, () => combatant),
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("UPDATE_COMBATANT", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatant: { ...combatant, revision: -1 },
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("UPDATE_COMBATANT", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatant: { ...combatant, statblock: { resourceId: "", name: "x" } },
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("UPDATE_COMBATANT", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatant: { ...combatant, individualStamina: 5 },
      }).ok,
    ).toBe(true);
    expect(
      validateCommand("UPDATE_COMBATANT", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatant: { ...combatant, individualStamina: -1 },
      }).ok,
    ).toBe(false);
  });

  it("validates selection, focus, and cleanup payloads", () => {
    expect(validateCommand("SELECT_COMBATANT", { encounterId: "e", instanceId: "i" }).ok).toBe(
      true,
    );
    expect(validateCommand("FOCUS_COMBATANT", { encounterId: "e", instanceId: "i" }).ok).toBe(true);
    expect(validateCommand("FOCUS_COMBATANT", { encounterId: "e" }).ok).toBe(false);
    expect(validateCommand("CLEANUP_COMBATANTS", { encounterId: "e", instanceIds: ["i"] }).ok).toBe(
      false,
    );
    expect(
      validateCommand("CLEANUP_COMBATANTS", {
        encounterId: "e",
        instanceIds: ["i"],
        expectedSceneId: "scene",
      }).ok,
    ).toBe(true);
    expect(validateCommand("CLEANUP_COMBATANTS", { encounterId: "e", instanceIds: [5] }).ok).toBe(
      false,
    );
    expect(
      validateCommand("CLEANUP_COMBATANTS", {
        encounterId: "e",
        instanceIds: ["i".repeat(161)],
      }).ok,
    ).toBe(false);
  });

  it("rejects unknown command types", () => {
    expect(validateCommand("DROP_TABLES" as never, {}).ok).toBe(false);
  });
});

describe("event validation", () => {
  it("accepts CONNECTED and SCENE_CHANGED with a complete scene", () => {
    expect(
      validateEvent("CONNECTED", {
        extensionVersion: "1.0.0",
        scene: sceneSummary(),
        linkedInstances: 2,
      }).ok,
    ).toBe(true);
    expect(validateEvent("SCENE_CHANGED", { scene: sceneSummary() }).ok).toBe(true);
    expect(
      validateEvent("SCENE_CHANGED", { scene: { ...sceneSummary(), gridDpi: "256" } }).ok,
    ).toBe(false);
    expect(
      validateEvent("SCENE_CHANGED", {
        scene: { ...sceneSummary(), viewport: { x: 0, y: 0 } },
      }).ok,
    ).toBe(false);
  });

  it("requires a reason for DISCONNECTED and truncates it", () => {
    expect(validateEvent("DISCONNECTED", { reason: "popover closed" }).ok).toBe(true);
    const long = "x".repeat(500);
    const result = validateEvent("DISCONNECTED", { reason: long });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as { reason: string }).reason).toHaveLength(300);
  });

  it("validates progress and failure events", () => {
    expect(
      validateEvent("IMPORT_PROGRESS", {
        encounterId: "e",
        done: 1,
        total: 4,
        phase: "tokens",
      }).ok,
    ).toBe(true);
    expect(
      validateEvent("IMPORT_PROGRESS", {
        encounterId: "e",
        done: 1,
        total: 4,
        phase: "nowhere",
      }).ok,
    ).toBe(false);
    expect(
      validateEvent("IMPORT_FAILED", {
        encounterId: "e",
        error: { code: "SCENE_NOT_READY", message: "Not ready." },
      }).ok,
    ).toBe(true);
    expect(
      validateEvent("IMPORT_FAILED", { encounterId: "e", error: { code: "", message: "" } }).ok,
    ).toBe(false);
  });

  it("validates combatant updates and token deletions", () => {
    const update = {
      instanceId: "i",
      currentStamina: 4,
      maxStamina: 8,
      name: "Goblin",
      activationGroupId: "g",
      activationGroupName: "Goblins",
      statblock: null,
      revision: 0,
    };
    expect(
      validateEvent("COMBATANT_UPDATED", {
        encounterId: "e",
        update,
        sceneId: "s",
        tokenIds: ["t"],
        observedAt: 1,
      }).ok,
    ).toBe(true);
    expect(
      validateEvent("COMBATANT_UPDATED", {
        encounterId: "e",
        update,
        sceneId: "s",
        tokenIds: [],
        observedAt: Number.POSITIVE_INFINITY,
      }).ok,
    ).toBe(false);
    expect(
      validateEvent("TOKEN_DELETED", {
        encounterId: "e",
        instanceId: "i",
        tokenIds: ["t"],
        allMissing: false,
      }).ok,
    ).toBe(true);
    expect(
      validateEvent("TOKEN_DELETED", {
        encounterId: "e",
        instanceId: "i",
        tokenIds: ["t"],
        allMissing: "no",
      }).ok,
    ).toBe(false);
  });

  it("allows null selection fields but not missing ones", () => {
    expect(
      validateEvent("SELECTION_CHANGED", {
        encounterId: null,
        instanceId: null,
        tokenIds: [],
      }).ok,
    ).toBe(true);
    expect(validateEvent("SELECTION_CHANGED", { instanceId: null, tokenIds: [] }).ok).toBe(false);
  });

  it("validates conflict and error events", () => {
    expect(
      validateEvent("SYNC_CONFLICT", {
        encounterId: "e",
        instanceId: "i",
        local: 4,
        external: 7,
        policy: "local-wins",
      }).ok,
    ).toBe(true);
    expect(
      validateEvent("SYNC_CONFLICT", {
        encounterId: "e",
        instanceId: "i",
        local: 4,
        external: 7,
        policy: "coin-flip",
      }).ok,
    ).toBe(false);
    expect(validateEvent("ERROR", { error: { code: "X", message: "Boom." } }).ok).toBe(true);
    expect(validateEvent("ERROR", { error: { code: "X", message: "Boom.", detail: 4 } }).ok).toBe(
      false,
    );
    expect(validateEvent("PONG", { receivedAt: 1 }).ok).toBe(true);
    expect(validateEvent("NOT_AN_EVENT" as never, {}).ok).toBe(false);
  });
});

function tokenMapping(overrides: Record<string, unknown> = {}) {
  return {
    encounterId: "e",
    instanceId: "i",
    sceneId: "s",
    tokenIds: ["t"],
    minionGroupId: null,
    entryId: "entry-1",
    slot: 0,
    kind: "creature",
    name: "Goblin",
    currentStamina: 4,
    maxStamina: 8,
    individualStamina: null,
    missing: false,
    updatedAt: 1,
    ...overrides,
  };
}

function importResult(overrides: Record<string, unknown> = {}) {
  return {
    mode: "import",
    scene: sceneSummary(),
    mappings: [tokenMapping()],
    createdInstanceIds: ["i"],
    created: 1,
    updated: 0,
    missing: [],
    warnings: [],
    ...overrides,
  };
}

function sceneState(overrides: Record<string, unknown> = {}) {
  return {
    scene: sceneSummary(),
    mappings: [tokenMapping()],
    minionGroups: [
      { id: "g", name: "Goblin Squad", currentStamina: 8, individualStamina: 2, tokenCount: 4 },
    ],
    orphanTokens: [],
    ...overrides,
  };
}

describe("command response validation", () => {
  it("rejects squads and mappings beyond the supported maximum", () => {
    const tokenIds = Array.from(
      { length: LIMITS.tokenIdsPerInstance + 1 },
      (_, index) => `t-${index}`,
    );
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        encounterId: "e",
        encounterName: "Encounter",
        mode: "import",
        expectedSceneId: "s",
        combatants: [
          desiredCombatant({
            kind: "minion-squad",
            count: LIMITS.minionsPerSquad + 1,
            individualStamina: 1,
          }),
        ],
      }).ok,
    ).toBe(false);
    expect(
      validateResponse("IMPORT_ENCOUNTER", importResult({ mappings: [tokenMapping({ tokenIds })] }))
        .ok,
    ).toBe(false);
    expect(
      validateResponse("GET_SCENE_STATE", sceneState({ mappings: [tokenMapping({ tokenIds })] }))
        .ok,
    ).toBe(false);
  });

  it("validates a connect response", () => {
    expect(
      validateResponse("CONNECT", {
        extensionVersion: "1.0.0",
        protocolVersion: PROTOCOL_VERSION,
        scene: sceneSummary(),
        linkedInstances: 1,
      }).ok,
    ).toBe(true);
    expect(
      validateResponse("CONNECT", {
        extensionVersion: "1.0.0",
        protocolVersion: PROTOCOL_VERSION,
        scene: sceneSummary(),
      }).ok,
    ).toBe(false);
  });

  it("validates scene state, mappings, groups, and orphans", () => {
    expect(validateResponse("GET_SCENE_STATE", sceneState()).ok).toBe(true);
    expect(
      validateResponse(
        "GET_SCENE_STATE",
        sceneState({ mappings: [tokenMapping({ tokenIds: [4] })] }),
      ).ok,
    ).toBe(false);
    expect(
      validateResponse(
        "GET_SCENE_STATE",
        sceneState({ mappings: [tokenMapping({ currentStamina: -1 })] }),
      ).ok,
    ).toBe(false);
    expect(
      validateResponse(
        "GET_SCENE_STATE",
        sceneState({ minionGroups: [{ id: "g", name: "Squad" }] }),
      ).ok,
    ).toBe(false);
    expect(
      validateResponse(
        "GET_SCENE_STATE",
        sceneState({
          orphanTokens: [{ tokenId: "t", encounterId: "e", instanceId: "i", name: "G" }],
        }),
      ).ok,
    ).toBe(true);
    expect(
      validateResponse("GET_SCENE_STATE", sceneState({ orphanTokens: [{ tokenId: "t" }] })).ok,
    ).toBe(false);
  });

  it("validates an import result", () => {
    expect(validateResponse("IMPORT_ENCOUNTER", importResult()).ok).toBe(true);
    expect(validateResponse("ADD_COMBATANTS", importResult({ mode: "add" })).ok).toBe(true);
    expect(validateResponse("RECONCILE_ENCOUNTER", importResult({ mode: "reconcile" })).ok).toBe(
      true,
    );
    expect(validateResponse("IMPORT_ENCOUNTER", importResult({ mode: "import" })).ok).toBe(true);
    expect(validateResponse("IMPORT_ENCOUNTER", importResult({ warnings: [4] })).ok).toBe(false);
    expect(validateResponse("IMPORT_ENCOUNTER", importResult({ missing: [{}] })).ok).toBe(false);
    expect(validateResponse("IMPORT_ENCOUNTER", importResult({ mappings: "none" })).ok).toBe(false);
  });

  it("validates cleanup, combatant acknowledgements, and empty responses", () => {
    expect(validateResponse("CLEANUP_COMBATANTS", { deleted: 2 }).ok).toBe(true);
    expect(validateResponse("CLEANUP_COMBATANTS", { deleted: -1 }).ok).toBe(false);
    expect(validateResponse("UPDATE_COMBATANTS", { appliedInstanceIds: ["i"] }).ok).toBe(true);
    expect(validateResponse("UPDATE_COMBATANTS", { appliedInstanceIds: [] }).ok).toBe(true);
    expect(validateResponse("UPDATE_COMBATANTS", { appliedInstanceIds: [42] }).ok).toBe(false);
    expect(validateResponse("UPDATE_COMBATANTS", {}).ok).toBe(false);
    expect(validateResponse("SELECT_COMBATANT", {}).ok).toBe(true);
    expect(validateResponse("PING", null).ok).toBe(false);
  });

  it("rejects an unknown command response", () => {
    expect(validateResponse("NOPE" as never, {}).ok).toBe(false);
  });
});

it("validates optional condition names in imports, updates and external events", () => {
  const update = {
    instanceId: "i",
    name: "Goblin",
    currentStamina: 10,
    maxStamina: 10,
    activationGroupId: "g",
    activationGroupName: "Goblins",
    statblock: null,
    revision: 1,
  };
  for (const conditions of [undefined, [], ["Dazed"]]) {
    const entry = { ...update, ...(conditions === undefined ? {} : { conditions }) };
    expect(
      validateCommand("UPDATE_COMBATANTS", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatants: [entry],
      }).ok,
    ).toBe(true);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        encounterId: "e",
        encounterName: "Battle",
        mode: "import",
        expectedSceneId: "scene-1",
        combatants: [desiredCombatant(conditions === undefined ? {} : { conditions })],
      }).ok,
    ).toBe(true);
    expect(
      validateEvent("COMBATANT_UPDATED", {
        encounterId: "e",
        sceneId: "s",
        tokenIds: ["t"],
        observedAt: 1,
        update: entry,
      }).ok,
    ).toBe(true);
  }
  for (const conditions of [null, "Dazed", [42], ["x".repeat(121)], Array(33).fill("Dazed")]) {
    expect(
      validateCommand("UPDATE_COMBATANTS", {
        expectedSceneId: "scene",
        encounterId: "e",
        combatants: [{ ...update, conditions }],
      }).ok,
    ).toBe(false);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        encounterId: "e",
        encounterName: "Battle",
        mode: "import",
        expectedSceneId: "scene-1",
        combatants: [{ ...desiredCombatant(), conditions }],
      }).ok,
    ).toBe(false);
    expect(
      validateEvent("COMBATANT_UPDATED", {
        encounterId: "e",
        sceneId: "s",
        tokenIds: ["t"],
        observedAt: 1,
        update: { ...update, conditions },
      }).ok,
    ).toBe(false);
  }
});

it.each(["UPDATE_COMBATANT", "UPDATE_COMBATANTS"] as const)(
  "requires a valid scene for %s",
  (command) => {
    for (const expectedSceneId of [undefined, null, "", 42, "x".repeat(201)]) {
      const combatant = {
        instanceId: "i",
        name: "Goblin",
        currentStamina: 10,
        maxStamina: 10,
        activationGroupId: "g",
        activationGroupName: "Goblins",
        statblock: null,
        revision: 1,
      };
      const payload = { encounterId: "e", combatant, combatants: [combatant] };
      expect(validateCommand(command, { ...payload, expectedSceneId: "scene" }).ok).toBe(true);
      expect(validateCommand(command, { ...payload, expectedSceneId }).ok).toBe(false);
    }
  },
);

it("validates optional combatant size, scene-change reason, and RENAME_SCENE", () => {
  expect(
    validateCommand("IMPORT_ENCOUNTER", {
      encounterId: "e",
      encounterName: "Battle",
      mode: "import",
      expectedSceneId: "scene-1",
      combatants: [desiredCombatant({ size: "3" })],
    }).ok,
  ).toBe(true);
  expect(
    validateCommand("IMPORT_ENCOUNTER", {
      encounterId: "e",
      encounterName: "Battle",
      mode: "import",
      expectedSceneId: "scene-1",
      combatants: [{ ...desiredCombatant(), size: 3 }],
    }).ok,
  ).toBe(false);
  expect(validateEvent("SCENE_CHANGED", { scene: sceneSummary(), reason: "conditions" }).ok).toBe(
    true,
  );
  expect(validateEvent("SCENE_CHANGED", { scene: sceneSummary(), reason: "bogus" }).ok).toBe(false);
  expect(
    validateCommand("RENAME_SCENE", { expectedSceneId: "scene-1", label: "Throne Room" }).ok,
  ).toBe(true);
  expect(validateCommand("RENAME_SCENE", { expectedSceneId: "scene-1", label: "" }).ok).toBe(true);
  expect(
    validateCommand("RENAME_SCENE", { expectedSceneId: "scene-1", label: "x".repeat(81) }).ok,
  ).toBe(false);
  expect(validateResponse("RENAME_SCENE", { scene: sceneSummary() }).ok).toBe(true);
});

it("validates SET_VISIBILITY, SETTINGS_UPDATED, hidden imports, and visible fields", () => {
  const settings = {
    ringsSync: true,
    conditionSync: "marked",
    diceEnabled: true,
    diceStatus: "connected",
    diceGmOnly: true,
  };
  expect(validateEvent("SETTINGS_UPDATED", { settings }).ok).toBe(true);
  expect(
    validateEvent("SETTINGS_UPDATED", { settings: { ...settings, conditionSync: "bad" } }).ok,
  ).toBe(false);
  expect(
    validateCommand("IMPORT_ENCOUNTER", {
      encounterId: "e",
      encounterName: "Ambush",
      mode: "import",
      expectedSceneId: "scene-1",
      hidden: true,
      combatants: [desiredCombatant()],
    }).ok,
  ).toBe(true);
  expect(
    validateCommand("SET_VISIBILITY", {
      expectedSceneId: "scene-1",
      encounterId: "e",
      instanceId: "i",
      visible: false,
    }).ok,
  ).toBe(true);
  expect(
    validateCommand("SET_VISIBILITY", {
      expectedSceneId: "scene-1",
      encounterId: "e",
      instanceId: "i",
      visible: "no",
    }).ok,
  ).toBe(false);
  expect(validateResponse("SET_VISIBILITY", { visible: true }).ok).toBe(true);
  expect(validateCommand("DICE_CONTROL", { action: "cancel" }).ok).toBe(true);
  expect(validateCommand("DICE_CONTROL", { action: "retry" }).ok).toBe(true);
  expect(validateCommand("DICE_CONTROL", { action: "set-gm-only", gmOnly: true }).ok).toBe(true);
  expect(validateCommand("DICE_CONTROL", { action: "set-gm-only" }).ok).toBe(false);
  expect(validateCommand("DICE_CONTROL", { action: "invalid" }).ok).toBe(false);
  expect(validateResponse("DICE_CONTROL", {}).ok).toBe(true);
  expect(
    validateEvent("COMBATANT_UPDATED", {
      encounterId: "e",
      sceneId: "s".repeat(200),
      tokenIds: ["t1"],
      observedAt: 1,
      update: {
        instanceId: "i",
        currentStamina: 5,
        maxStamina: 10,
        name: "Goblin",
        activationGroupId: "g1",
        activationGroupName: "A",
        statblock: null,
        revision: 0,
      },
    }).ok,
  ).toBe(true);
});

describe("hardened origin and payload bounds", () => {
  it("parses allowed HTTPS and loopback HTTP origins while rejecting credentials and insecure hosts", () => {
    expect(parseAllowedOrigin("https://malice.example/path?q=1")).toBe("https://malice.example");
    expect(parseAllowedOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(parseAllowedOrigin("http://127.0.0.1:5174")).toBe("http://127.0.0.1:5174");
    expect(parseAllowedOrigin("http://[::1]:5173")).toBe("http://[::1]:5173");
    expect(parseAllowedOrigin("http://malice.example")).toBeNull();
    expect(parseAllowedOrigin("https://user:pass@malice.example")).toBeNull();
    expect(parseAllowedOrigin("javascript:alert(1)")).toBeNull();
  });

  it("enforces HELLO extensionVersion length, PONG receivedAt, and positive minion/scene numbers", () => {
    expect(
      isHelloMessage({
        protocol: PROTOCOL_NAME,
        version: PROTOCOL_VERSION,
        type: HELLO_MESSAGE_TYPE,
        sessionId: "s",
        pairingToken: "t",
        extensionVersion: "x".repeat(41),
      }),
    ).toBe(false);
    expect(validateEvent("PONG", { receivedAt: -1 }).ok).toBe(false);
    expect(validateEvent("PONG", { receivedAt: Number.NaN }).ok).toBe(false);
    expect(
      validateCommand("IMPORT_ENCOUNTER", {
        encounterId: "e",
        encounterName: "Test",
        mode: "import",
        expectedSceneId: "scene-1",
        combatants: [
          desiredCombatant({
            kind: "minion-squad",
            count: 4,
            individualStamina: 0,
            minionGroupId: "mm-1",
          }),
        ],
      }).ok,
    ).toBe(false);
    expect(validateEvent("SCENE_CHANGED", { scene: { ...sceneSummary(), gridDpi: 0 } }).ok).toBe(
      false,
    );
    expect(
      validateEvent("SCENE_CHANGED", {
        scene: { ...sceneSummary(), viewport: { x: 0, y: 0, scale: 0 } },
      }).ok,
    ).toBe(false);
    expect(
      validateEvent("TOKEN_DELETED", {
        encounterId: "e",
        instanceId: "i",
        sceneId: "scene-1",
        tokenIds: ["t1"],
        allMissing: false,
      }).ok,
    ).toBe(true);
    expect(
      validateEvent("TOKEN_DELETED", {
        encounterId: "e",
        instanceId: "i",
        sceneId: 42,
        tokenIds: ["t1"],
        allMissing: false,
      }).ok,
    ).toBe(false);
  });
});
