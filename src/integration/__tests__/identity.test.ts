import { describe, expect, it } from "vitest";
import type { CombatInstance, Encounter, Monster } from "../../types.ts";
import {
  alignMappingsAfterRestart,
  allMappingsForEncounter,
  clearEncounterMappings,
  emptyIntegration,
  encounterSyncSummary,
  mappingsFor,
  mergeSceneMappings,
  minionGroupIdFor,
  nextImportMode,
  planImport,
  replaceSceneMappings,
  sanitizeIntegration,
  slotIndexes,
  upsertMapping,
  type PersistedIntegration,
} from "../identity.ts";
import { LIMITS, type TokenMapping } from "../../../shared/obr/protocol.ts";

const encounterId = "encounter-1";
const roomId = "room-1";
const sceneId = "scene-1";

type InstanceOverrides = Omit<Partial<CombatInstance>, "entryId"> & { entryId?: string | null };

function instance(overrides: InstanceOverrides = {}): CombatInstance {
  const { entryId, ...rest } = overrides;
  const out: CombatInstance = {
    id: "instance-1",
    sourcePath: "goblin/goblin-warrior",
    groupId: "group-1",
    entryId: "entry-1",
    kind: "creature",
    count: 1,
    name: "Goblin Warrior",
    currentStamina: 8,
    maxStamina: 10,
    turns: 1,
    turnsTaken: 0,
    conditions: [],
    reactions: [],
    villainRounds: [],
    ...rest,
  };
  if (entryId === null) delete out.entryId;
  else if (entryId !== undefined) out.entryId = entryId;
  return out;
}

function mapping(overrides: Partial<TokenMapping> = {}): TokenMapping {
  return {
    encounterId,
    instanceId: "instance-1",
    sceneId,
    tokenIds: ["token-1"],
    minionGroupId: null,
    entryId: "entry-1",
    slot: 0,
    kind: "creature",
    name: "Goblin Warrior",
    currentStamina: 8,
    maxStamina: 10,
    individualStamina: null,
    missing: false,
    updatedAt: 1,
    ...overrides,
  };
}

function monster(overrides: Partial<Monster> = {}): Monster {
  return {
    id: "monster-1",
    path: "goblin/goblin-warrior",
    book: "Monsters",
    familyPath: "goblin",
    slug: "goblin-warrior",
    name: "Goblin Warrior",
    level: 1,
    organization: "Horde",
    role: "Harrier",
    ev: 3,
    evLabel: "3",
    defaultQty: 1,
    keywords: ["Goblin", "Humanoid"],
    ancestry: "Goblin",
    size: "1S",
    speed: 5,
    stamina: 10,
    stability: 0,
    freeStrike: 2,
    movement: "",
    immunities: [],
    weaknesses: [],
    withCaptain: "",
    turnsPerRound: 1,
    chars: { M: 0, A: 0, R: 0, I: 0, P: 0 },
    features: [],
    source: "SteelCompendium",
    raw: {},
    ...overrides,
  };
}

function encounter(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: encounterId,
    name: "The Crypt",
    updatedAt: 1,
    view: "combat",
    party: { heroes: 4, level: 1, victories: 0, bonusMalice: 0 },
    groups: [
      { id: "group-1", name: "Front line" },
      { id: "group-2", name: "Back line" },
    ],
    activePrepGroupId: "group-1",
    items: [],
    combat: {
      active: true,
      round: 1,
      malice: 0,
      instances: [],
      activeGroupFilter: null,
      activeEffects: [],
      selectedMaliceFeatureIds: [],
      maliceSelectionInitialized: false,
    },
    ...overrides,
  };
}

function withMappings(store: PersistedIntegration, entries: TokenMapping[]): PersistedIntegration {
  return mergeSceneMappings(store, roomId, sceneId, entries, encounterId);
}

describe("persisted integration sanitizer", () => {
  it("returns an empty store for corrupt or old data", () => {
    expect(sanitizeIntegration(null)).toEqual(emptyIntegration());
    expect(sanitizeIntegration("garbage")).toEqual(emptyIntegration());
    expect(sanitizeIntegration([])).toEqual(emptyIntegration());
    expect(sanitizeIntegration({ version: 2, encounters: {} })).toEqual(emptyIntegration());
    expect(sanitizeIntegration({ version: 1 })).toEqual(emptyIntegration());
  });

  it("keeps only supported trusted origins", () => {
    const result = sanitizeIntegration({
      version: 1,
      trustedOrigins: [
        "https://example.com",
        "https://example.com",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://evil.example",
        "javascript:alert(1)",
        "not a url",
        5,
      ],
    });
    expect(result.trustedOrigins).toEqual([
      "https://example.com",
      "http://localhost:5173",
      "http://127.0.0.1:4173",
    ]);
  });

  it("drops malformed scene mappings and repairs field values", () => {
    const result = sanitizeIntegration({
      version: 1,
      encounters: {
        [encounterId]: {
          updatedAt: 5,
          scenes: {
            [sceneId]: {
              roomId,
              updatedAt: 6,
              mappings: [
                mapping(),
                { ...mapping({ instanceId: "bad-kind" }), kind: "nope" },
                { instanceId: "missing-fields" },
                mapping({
                  instanceId: "clamped",
                  tokenIds: ["a", 4, "b"] as never,
                  slot: -3,
                  name: "N".repeat(200),
                  currentStamina: -5,
                  maxStamina: Number.NaN,
                  individualStamina: null,
                  missing: true,
                  updatedAt: Number.NaN,
                }),
              ],
            },
          },
        },
      },
    });
    const scene = result.encounters[encounterId]?.scenes[sceneId];
    expect(scene?.roomId).toBe(roomId);
    expect(scene?.mappings).toHaveLength(2);
    const clamped = scene?.mappings.find((entry) => entry.instanceId === "clamped");
    expect(clamped).toMatchObject({
      tokenIds: ["a", "b"],
      slot: 0,
      currentStamina: 0,
      maxStamina: 0,
      missing: true,
      updatedAt: 0,
    });
    expect(clamped?.name).toHaveLength(120);
  });

  it("caps token ids at the supported squad size and drops non-string entries", () => {
    const result = sanitizeIntegration({
      version: 1,
      encounters: {
        [encounterId]: {
          scenes: {
            [sceneId]: {
              mappings: [
                mapping({
                  tokenIds: Array.from({ length: 110 }, (_, index) =>
                    index === 0 ? 7 : `token-${index}`,
                  ) as never,
                }),
              ],
            },
          },
        },
      },
    });
    expect(result.encounters[encounterId]?.scenes[sceneId]?.mappings[0]?.tokenIds).toHaveLength(
      LIMITS.tokenIdsPerInstance,
    );
  });

  it("keeps only well-formed manual and learned statblocks", () => {
    const result = sanitizeIntegration({
      version: 1,
      manualStatblocks: {
        good: { resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" },
        bad: { resourceId: 5, name: "No" },
        worse: "no",
      },
      learnedStatblocks: {
        fine: { resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" },
      },
    });
    expect(result.manualStatblocks).toEqual({
      good: { resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" },
    });
    expect(result.learnedStatblocks).toEqual({
      fine: { resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" },
    });
  });

  it("sanitizes small preferences and the log", () => {
    const result = sanitizeIntegration({
      version: 1,
      lastSelectedInstanceId: "instance-1",
      inverseSelection: true,
      log: [...Array.from({ length: 60 }, (_, index) => `line ${index}`), 5],
    });
    expect(result.lastSelectedInstanceId).toBe("instance-1");
    expect(result.inverseSelection).toBe(true);
    expect(result.log).toHaveLength(50);
  });
});

describe("mapping storage", () => {
  it("replaces an instance mapping without deleting others", () => {
    const first = withMappings(emptyIntegration(), [
      mapping({ instanceId: "a", tokenIds: ["t1"] }),
      mapping({ instanceId: "b", tokenIds: ["t2"] }),
    ]);
    const next = withMappings(first, [mapping({ instanceId: "a", tokenIds: ["t3"] })]);
    const entries = mappingsFor(next, encounterId, sceneId);
    expect(entries.map((entry) => [entry.instanceId, entry.tokenIds])).toEqual([
      ["a", ["t3"]],
      ["b", ["t2"]],
    ]);
  });

  it("ignores mappings for another encounter or scene", () => {
    const store = withMappings(emptyIntegration(), [
      mapping({ encounterId: "other" }),
      mapping({ sceneId: "other" }),
    ]);
    expect(mappingsFor(store, encounterId, sceneId)).toEqual([]);
  });

  it("keeps scenes separate and can list every mapping for an encounter", () => {
    let store = mergeSceneMappings(
      emptyIntegration(),
      roomId,
      "scene-a",
      [mapping({ sceneId: "scene-a", instanceId: "a" })],
      encounterId,
    );
    store = mergeSceneMappings(
      store,
      roomId,
      "scene-b",
      [mapping({ sceneId: "scene-b", instanceId: "b" })],
      encounterId,
    );
    expect(mappingsFor(store, encounterId, "scene-a")).toHaveLength(1);
    expect(mappingsFor(store, encounterId, "scene-b")).toHaveLength(1);
    expect(allMappingsForEncounter(store, encounterId).map((entry) => entry.instanceId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("upserts a single mapping and updates the room", () => {
    const store = upsertMapping(emptyIntegration(), "room-2", mapping());
    expect(store.encounters[encounterId]?.scenes[sceneId]?.roomId).toBe("room-2");
    expect(store.encounters[encounterId]?.scenes[sceneId]?.mappings).toHaveLength(1);
  });

  it("replaces an authoritative scene snapshot and drops stale tokens", () => {
    let store = withMappings(emptyIntegration(), [
      mapping({ instanceId: "kept", tokenIds: ["t1"] }),
      mapping({ instanceId: "deleted-while-offline", tokenIds: ["t2"] }),
    ]);
    store = mergeSceneMappings(
      store,
      roomId,
      "other-scene",
      [mapping({ sceneId: "other-scene", instanceId: "elsewhere" })],
      encounterId,
    );
    const next = replaceSceneMappings(
      store,
      roomId,
      sceneId,
      [mapping({ instanceId: "kept", tokenIds: ["t1"] })],
      encounterId,
    );
    expect(mappingsFor(next, encounterId, sceneId).map((entry) => entry.instanceId)).toEqual([
      "kept",
    ]);
    expect(mappingsFor(next, encounterId, "other-scene")).toHaveLength(1);
  });

  it("ignores entries for another encounter or scene when replacing", () => {
    const next = replaceSceneMappings(
      emptyIntegration(),
      roomId,
      sceneId,
      [mapping(), mapping({ encounterId: "other" }), mapping({ sceneId: "other" })],
      encounterId,
    );
    expect(mappingsFor(next, encounterId, sceneId)).toHaveLength(1);
  });

  it("clears one encounter without touching another", () => {
    let store = withMappings(emptyIntegration(), [mapping()]);
    store = mergeSceneMappings(
      store,
      roomId,
      sceneId,
      [mapping({ encounterId: "other" })],
      "other",
    );
    const next = clearEncounterMappings(store, encounterId);
    expect(mappingsFor(next, encounterId, sceneId)).toEqual([]);
    expect(mappingsFor(next, "other", sceneId)).toHaveLength(1);
  });

  it("derives a stable minion group id scoped by encounter when provided", () => {
    expect(minionGroupIdFor("instance-1")).toBe("mm-instance-1");
    expect(minionGroupIdFor("instance-1")).toBe(minionGroupIdFor("instance-1"));
    expect(minionGroupIdFor("instance-1", "enc-a")).toBe("mm-enc-a-instance-1");
    expect(minionGroupIdFor("instance-1", "enc-a")).not.toBe(
      minionGroupIdFor("instance-1", "enc-b"),
    );
  });
});

describe("slots and combat restarts", () => {
  it("numbers instances within each prep entry", () => {
    const slots = slotIndexes([
      instance({ id: "a", entryId: "entry-1" }),
      instance({ id: "b", entryId: "entry-2" }),
      instance({ id: "c", entryId: "entry-1" }),
    ]);
    expect(slots.get("a")).toBe(0);
    expect(slots.get("b")).toBe(0);
    expect(slots.get("c")).toBe(1);
  });

  it("gives each summoned instance its own slot", () => {
    const slots = slotIndexes([
      instance({ id: "summon-1", entryId: null, summonedBy: "a" }),
      instance({ id: "summon-2", entryId: null, summonedBy: "a" }),
    ]);
    expect(slots.get("summon-1")).toBe(0);
    expect(slots.get("summon-2")).toBe(0);
  });

  it("does not remap while any current instance still has a mapping", () => {
    const current = [instance({ id: "new-1" }), instance({ id: "new-2" })];
    const mappings = [mapping({ instanceId: "new-1" }), mapping({ instanceId: "old-1" })];
    const result = alignMappingsAfterRestart(encounterId, mappings, current);
    expect(result.changed).toBe(false);
    expect(result.mappings).toEqual(mappings);
  });

  it("reattaches a whole restarted roster by kind, entry, and slot", () => {
    const current = [
      instance({ id: "new-creature", kind: "creature", entryId: "entry-1" }),
      instance({
        id: "new-squad",
        kind: "minion-squad",
        entryId: "entry-2",
        count: 4,
        maxStamina: 20,
      }),
    ];
    const mappings = [
      mapping({
        instanceId: "old-creature",
        kind: "creature",
        entryId: "entry-1",
        slot: 0,
        tokenIds: ["tc"],
        minionGroupId: null,
      }),
      mapping({
        instanceId: "old-squad",
        kind: "minion-squad",
        entryId: "entry-2",
        slot: 0,
        tokenIds: ["t1", "t2", "t3", "t4"],
        minionGroupId: null,
      }),
    ];
    const result = alignMappingsAfterRestart(encounterId, mappings, current);
    expect(result.changed).toBe(true);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        instanceId: "new-creature",
        tokenIds: ["tc"],
        minionGroupId: null,
      }),
      expect.objectContaining({
        instanceId: "new-squad",
        tokenIds: ["t1", "t2", "t3", "t4"],
        minionGroupId: "mm-encounter-1-new-squad",
      }),
    ]);
  });

  it("does not reuse a token for a different kind", () => {
    const current = [instance({ id: "new-creature", kind: "creature" })];
    const result = alignMappingsAfterRestart(
      encounterId,
      [mapping({ instanceId: "old-squad", kind: "minion-squad" })],
      current,
    );
    expect(result.changed).toBe(false);
  });

  it("leaves mappings without a prep entry alone", () => {
    const current = [instance({ id: "new-summon", entryId: null })];
    const result = alignMappingsAfterRestart(
      encounterId,
      [mapping({ instanceId: "old-summon", entryId: null })],
      current,
    );
    expect(result.changed).toBe(false);
  });

  it("handles empty input", () => {
    expect(alignMappingsAfterRestart(encounterId, [], [])).toEqual({
      mappings: [],
      changed: false,
    });
  });
});

describe("import planning", () => {
  it("expands creatures and squads with Stamina and group metadata", () => {
    const plan = planImport({
      encounter: encounter({
        combat: {
          ...encounter().combat,
          instances: [
            instance({ id: "creature-1", currentStamina: 7 }),
            instance({
              id: "squad-1",
              kind: "minion-squad",
              count: 4,
              entryId: "entry-2",
              groupId: "group-2",
              name: "Goblin Squad",
              currentStamina: 18,
              maxStamina: 20,
            }),
          ],
        },
      }),
      mappings: [],
      lookup: () => monster(),
    });
    expect(plan.missingMonsters).toEqual([]);
    expect(plan.unresolved).toEqual([]);
    expect(plan.combatants).toHaveLength(2);
    expect(plan.combatants[0]).toMatchObject({
      instanceId: "creature-1",
      sourcePath: "goblin/goblin-warrior",
      entryId: "entry-1",
      slot: 0,
      kind: "creature",
      count: 1,
      individualStamina: null,
      minionGroupId: null,
      currentStamina: 7,
      maxStamina: 10,
      activationGroupName: "Front line",
      statblock: { resourceId: "cs-GoblinWarrior", name: "Goblin Warrior" },
      summoned: false,
    });
    expect(plan.combatants[1]).toMatchObject({
      instanceId: "squad-1",
      entryId: "entry-2",
      kind: "minion-squad",
      count: 4,
      individualStamina: 5,
      minionGroupId: "mm-encounter-1-squad-1",
      activationGroupName: "Back line",
    });
    expect(plan.combatants[0]?.conditions).toEqual([]);
    expect(plan.combatants[1]?.conditions).toBeUndefined();
  });

  it("reports monsters that are not in the catalog", () => {
    const plan = planImport({
      encounter: encounter({
        combat: {
          ...encounter().combat,
          instances: [instance({ id: "a", sourcePath: "missing/one" })],
        },
      }),
      mappings: [],
      lookup: () => undefined,
    });
    expect(plan.combatants).toEqual([]);
    expect(plan.missingMonsters).toEqual(["missing/one"]);
  });

  it("reports an unresolved statblock with candidates", () => {
    const plan = planImport({
      encounter: encounter({
        combat: {
          ...encounter().combat,
          instances: [instance({ id: "a", sourcePath: "goblin/elite" })],
        },
      }),
      mappings: [],
      lookup: () => monster({ name: "Goblin Warrior", level: 5 }),
    });
    expect(plan.combatants[0]?.statblock).toBeNull();
    expect(plan.unresolved).toHaveLength(1);
    expect(plan.unresolved[0]).toMatchObject({
      key: "goblin warrior|5",
      name: "Goblin Warrior",
      level: 5,
    });
    expect(plan.unresolved[0]?.candidates.length).toBeGreaterThan(0);
  });

  it("deduplicates unresolved statblocks across multiple copies and includes 0-candidate monsters", () => {
    const plan = planImport({
      encounter: encounter({
        combat: {
          ...encounter().combat,
          instances: [
            instance({ id: "a", sourcePath: "goblin/elite" }),
            instance({ id: "b", sourcePath: "goblin/elite" }),
            instance({ id: "c", sourcePath: "custom/xyzzyspawn" }),
          ],
        },
      }),
      mappings: [],
      lookup: (path) =>
        path === "custom/xyzzyspawn"
          ? monster({ name: "Xyzzy Quantum Flumph", level: 9 })
          : monster({ name: "Goblin Warrior", level: 5 }),
    });
    expect(plan.unresolved.map((entry) => entry.key)).toEqual([
      "goblin warrior|5",
      "xyzzy quantum flumph|9",
    ]);
    expect(plan.unresolved[1]?.candidates).toEqual([]);
  });

  it("keeps existing tokens only when the mapping is live", () => {
    const mappings = [
      mapping({ instanceId: "live", tokenIds: ["t1"] }),
      mapping({ instanceId: "missing", tokenIds: ["t2"], missing: true }),
    ];
    const plan = planImport({
      encounter: encounter({
        combat: {
          ...encounter().combat,
          instances: [instance({ id: "live" }), instance({ id: "missing", entryId: "entry-2" })],
        },
      }),
      mappings,
      lookup: () => monster(),
    });
    expect(plan.combatants[0]?.existingTokenIds).toEqual(["t1"]);
    expect(plan.combatants[1]?.existingTokenIds).toEqual([]);
  });

  it("reuses the stored minion group id and marks summoned instances", () => {
    const plan = planImport({
      encounter: encounter({
        combat: {
          ...encounter().combat,
          instances: [
            instance({
              id: "squad",
              kind: "minion-squad",
              count: 2,
              maxStamina: 10,
              summonedBy: "creature-1",
              entryId: null,
            }),
          ],
        },
      }),
      mappings: [
        mapping({ instanceId: "squad", minionGroupId: "mm-stored", kind: "minion-squad" }),
      ],
      lookup: () => monster(),
    });
    expect(plan.combatants[0]).toMatchObject({
      minionGroupId: "mm-stored",
      summoned: true,
      entryId: null,
      slot: 0,
    });
  });

  it("falls back to the monster's Stamina when the squad pool is empty", () => {
    const plan = planImport({
      encounter: encounter({
        combat: {
          ...encounter().combat,
          instances: [instance({ id: "squad", kind: "minion-squad", count: 4, maxStamina: 0 })],
        },
      }),
      mappings: [],
      lookup: () => monster({ stamina: 6 }),
    });
    expect(plan.combatants[0]?.individualStamina).toBe(6);
  });

  it("falls back to Ungrouped when the group is gone", () => {
    const plan = planImport({
      encounter: encounter({
        combat: { ...encounter().combat, instances: [instance({ groupId: "deleted" })] },
      }),
      mappings: [],
      lookup: () => monster(),
    });
    expect(plan.combatants[0]?.activationGroupName).toBe("Ungrouped");
  });
});

describe("next import mode", () => {
  const plan = planImport({
    encounter: encounter({
      combat: {
        ...encounter().combat,
        instances: [
          instance({ id: "a", entryId: "entry-1" }),
          instance({ id: "b", entryId: "entry-2" }),
        ],
      },
    }),
    mappings: [],
    lookup: () => monster(),
  });

  it("starts with import", () => {
    expect(nextImportMode([], plan)).toBe("import");
  });

  it("reconciles when every live combatant already has a token", () => {
    expect(
      nextImportMode(
        [
          mapping({ instanceId: "a", entryId: "entry-1" }),
          mapping({ instanceId: "b", entryId: "entry-2" }),
        ],
        plan,
      ),
    ).toBe("reconcile");
  });

  it("adds when a live combatant has no mapping", () => {
    expect(nextImportMode([mapping({ instanceId: "a" })], plan)).toBe("add");
  });

  it("treats missing tokens as not imported", () => {
    expect(
      nextImportMode(
        [mapping({ instanceId: "a" }), mapping({ instanceId: "b", missing: true })],
        plan,
      ),
    ).toBe("add");
  });

  it.each([0, 1, 3])("recovers a four-token squad with %i remaining tokens", (count) => {
    const squadPlan = {
      ...plan,
      combatants: [
        {
          ...plan.combatants[0]!,
          kind: "minion-squad" as const,
          count: 4,
          currentStamina: 20,
          maxStamina: 20,
          individualStamina: 5,
        },
      ],
    };
    const remaining = Array.from({ length: count }, (_, index) => `token-${index}`);
    expect(nextImportMode([mapping({ instanceId: "a", tokenIds: remaining })], squadPlan)).toBe(
      "add",
    );
    expect(
      nextImportMode([mapping({ instanceId: "a", tokenIds: ["1", "2", "3", "4"] })], squadPlan),
    ).toBe("reconcile");
  });

  it("ignores stale mappings for old instances", () => {
    expect(nextImportMode([mapping({ instanceId: "old" })], plan)).toBe("add");
  });

  it("summarizes linked and unsent tokens for toolbar feedback", () => {
    const enc = {
      id: "enc-1",
      items: [],
      combat: {
        instances: [
          { id: "a", kind: "creature", count: 1 },
          { id: "b", kind: "minion-squad", count: 4 },
        ],
      },
    } as unknown as Parameters<typeof encounterSyncSummary>[0];
    expect(encounterSyncSummary(enc, [])).toEqual({
      unsentTokens: 5,
      linkedInstances: 0,
      totalInstances: 2,
    });
    expect(
      encounterSyncSummary(enc, [
        mapping({ instanceId: "a", tokenIds: ["t1"] }),
        mapping({ instanceId: "b", tokenIds: ["t2", "t3"] }),
      ]),
    ).toEqual({
      unsentTokens: 2,
      linkedInstances: 2,
      totalInstances: 2,
    });
    expect(
      encounterSyncSummary(enc, [
        mapping({ instanceId: "a", tokenIds: ["t1"] }),
        mapping({ instanceId: "b", tokenIds: ["t2", "t3", "t4", "t5"] }),
      ]),
    ).toEqual({
      unsentTokens: 0,
      linkedInstances: 2,
      totalInstances: 2,
    });
    const withDefeated = {
      id: "enc-1",
      items: [],
      combat: {
        instances: [
          { id: "a", kind: "creature", count: 1, currentStamina: 10 },
          { id: "c", kind: "creature", count: 1, currentStamina: 0 },
        ],
      },
    } as unknown as Parameters<typeof encounterSyncSummary>[0];
    expect(
      encounterSyncSummary(withDefeated, [mapping({ instanceId: "a", tokenIds: ["t1"] })]),
    ).toEqual({
      unsentTokens: 0,
      linkedInstances: 1,
      totalInstances: 2,
    });
  });

  it("tracks minion squad desired tokens by standing count instead of starting squad size", () => {
    const damagedSquad = {
      id: "enc-1",
      items: [],
      combat: {
        instances: [
          {
            id: "s",
            kind: "minion-squad",
            count: 4,
            currentStamina: 14,
            maxStamina: 20,
          },
        ],
      },
    } as unknown as Parameters<typeof encounterSyncSummary>[0];
    // 14/20 at 5 per minion => 3 standing. Deleting 1 fallen token keeps unsentTokens at 0.
    expect(
      encounterSyncSummary(damagedSquad, [
        mapping({ instanceId: "s", kind: "minion-squad", tokenIds: ["t1", "t2", "t3"] }),
      ]),
    ).toEqual({ unsentTokens: 0, linkedInstances: 1, totalInstances: 1 });
    // 2 tokens on the map while 3 are standing needs 1 token.
    expect(
      encounterSyncSummary(damagedSquad, [
        mapping({ instanceId: "s", kind: "minion-squad", tokenIds: ["t1", "t2"] }),
      ]),
    ).toEqual({ unsentTokens: 1, linkedInstances: 1, totalInstances: 1 });

    const squadPlan = {
      ...plan,
      combatants: [
        {
          ...plan.combatants[0]!,
          kind: "minion-squad" as const,
          count: 4,
          currentStamina: 14,
          maxStamina: 20,
          individualStamina: 5,
        },
      ],
    };
    expect(
      nextImportMode([mapping({ instanceId: "a", tokenIds: ["t1", "t2", "t3"] })], squadPlan),
    ).toBe("reconcile");
    expect(nextImportMode([mapping({ instanceId: "a", tokenIds: ["t1", "t2"] })], squadPlan)).toBe(
      "add",
    );
    expect(
      nextImportMode([mapping({ instanceId: "a", tokenIds: [], missing: true })], {
        ...squadPlan,
        combatants: [{ ...squadPlan.combatants[0]!, currentStamina: 0 }],
      }),
    ).toBe("reconcile");
  });

  it("updates scene mappings immutably without mutating prior store references", () => {
    const initial = replaceSceneMappings(
      emptyIntegration(),
      "room-1",
      "scene-1",
      [mapping({ encounterId: "enc-1", sceneId: "scene-1", instanceId: "a", tokenIds: ["t1"] })],
      "enc-1",
    );
    const prevEncounter = initial.encounters["enc-1"];
    const prevScenes = prevEncounter?.scenes;
    const merged = mergeSceneMappings(
      initial,
      "room-1",
      "scene-1",
      [mapping({ encounterId: "enc-1", sceneId: "scene-1", instanceId: "b", tokenIds: ["t2"] })],
      "enc-1",
    );
    expect(merged.encounters["enc-1"]).not.toBe(prevEncounter);
    expect(merged.encounters["enc-1"]?.scenes).not.toBe(prevScenes);
    expect(prevEncounter?.scenes["scene-1"]?.mappings.map((m) => m.instanceId)).toEqual(["a"]);
    expect(
      merged.encounters["enc-1"]?.scenes["scene-1"]?.mappings.map((m) => m.instanceId),
    ).toEqual(["a", "b"]);
  });

  it("rejects non-http protocols for localhost trusted origins in sanitizeIntegration", () => {
    const clean = sanitizeIntegration({
      version: 1,
      trustedOrigins: [
        "https://ext.example",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "ftp://localhost",
        "ws://localhost:5173",
        "http://evil.example",
      ],
    });
    expect(clean.trustedOrigins).toEqual([
      "https://ext.example",
      "http://localhost:5173",
      "http://127.0.0.1:4173",
    ]);
  });
});
