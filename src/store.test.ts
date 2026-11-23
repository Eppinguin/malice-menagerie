import { expect, it, vi } from "vitest";
import { loadMonster, maliceFeatures, maliceLoading, monsterAt } from "./data.ts";
import { resetPendingSharedRoll, setDiceTransport } from "./lib/rollTransport.ts";
import {
  activeEncounter,
  activeSection,
  activeView,
  addToEncounter,
  applyStaminaCommand,
  clearAllFilters,
  clearHistory,
  createEncounter,
  decrementMonster,
  duplicateEncounter,
  hasCombatProgress,
  hiddenFilterCount,
  isPartyLevelWindowActive,
  lastRolls,
  maliceFeaturesForMonster,
  markTurn,
  mutateApp,
  nextRound,
  previousRound,
  redoStep,
  relevantMaliceGroups,
  removeInstance,
  removeLane,
  resetCombat,
  rollCharacteristic,
  selectEncounter,
  setSection,
  setView,
  startCombat,
  state,
  togglePartyLevelWindow,
  undoStep,
  updateParty,
} from "./store.ts";
import type { MaliceFeature, Monster } from "./types.ts";

vi.mock("./data.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data.ts")>()),
  loadMonster: vi.fn(),
  monsterAt: vi.fn(),
}));

it("leaves the selected encounter's combat intact when roster loading began in another encounter", async () => {
  const original = activeEncounter();
  const targetId = createEncounter();
  mutateApp((app) => {
    const target = activeEncounter();
    target.combat.active = true;
    target.combat.round = 4;
    target.combat.malice = 12;
    original.items.push({
      id: "entry",
      sourcePath: "test",
      groupId: original.groups[0]!.id,
      count: 1,
    });
    app.activeEncounterId = original.id;
  });

  let finishLoad!: () => void;
  vi.mocked(loadMonster).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishLoad = () => resolve({} as Awaited<ReturnType<typeof loadMonster>>);
      }),
  );
  const starting = startCombat({ switchView: false });
  expect(vi.mocked(loadMonster).mock.lastCall?.[0]).toBe("test");

  mutateApp((app) => {
    app.activeEncounterId = targetId;
  });
  const targetCombat = activeEncounter().combat;
  // The statblock value is cached by the loader. This test only needs its promise to settle.
  finishLoad();
  await starting;

  expect(activeEncounter().combat).toBe(targetCombat);
  expect(targetCombat).toMatchObject({ active: true, round: 4, malice: 12 });
  expect(original.combat.active).toBe(false);
});

it("unblocks a stalled shared dice roll on reset or wall-clock expiry without needing a reload", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(monsterAt).mockReturnValue({
      id: "m-test",
      chars: { M: 2, A: 1, R: 0, I: 0, P: 0 },
    } as unknown as ReturnType<typeof monsterAt>);
    let call = 0;
    setDiceTransport(() => {
      call += 1;
      if (call === 1) return new Promise(() => {});
      return Promise.resolve({ dice: [8, 9] });
    });

    rollCharacteristic("test/monster.json", "M");
    // A second roll while the first is active is rejected with the wait guard.
    rollCharacteristic("test/monster.json", "M");
    expect(call).toBe(1);

    // Resetting (e.g. on disconnect or dice disabled) clears the lock immediately.
    resetPendingSharedRoll();
    rollCharacteristic("test/monster.json", "M");
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toBe(2);
    expect(lastRolls.value.get("m-test|char|M")?.dice).toEqual([8, 9]);

    // A hung promise also clears automatically after the safety timeout.
    call = 0;
    rollCharacteristic("test/monster.json", "A");
    expect(call).toBe(1);
    await vi.advanceTimersByTimeAsync(22_000);
    rollCharacteristic("test/monster.json", "A");
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toBe(2);
    expect(lastRolls.value.get("m-test|char|A")?.dice).toEqual([8, 9]);
  } finally {
    setDiceTransport(() => null);
    resetPendingSharedRoll();
    vi.useRealTimers();
  }
});

it("regenerates and remaps all group, entry, instance, captain, summon, and effect IDs on duplicateEncounter", () => {
  const sourceId = createEncounter();
  const originalGroupId = activeEncounter().groups[0]!.id;
  mutateApp(() => {
    const enc = activeEncounter();
    enc.items = [
      { id: "entry-cap", sourcePath: "cap.json", groupId: originalGroupId, count: 1 },
      { id: "entry-min", sourcePath: "min.json", groupId: originalGroupId, count: 4 },
    ];
    enc.combat.active = true;
    enc.combat.instances = [
      {
        id: "inst-cap",
        kind: "creature",
        count: 1,
        entryId: "entry-cap",
        sourcePath: "cap.json",
        name: "Captain",
        groupId: originalGroupId,
        currentStamina: 30,
        maxStamina: 30,
        conditions: [],
        reactions: [],
        villainRounds: [],
        turns: 1,
        turnsTaken: 0,
      },
      {
        id: "inst-squad",
        kind: "minion-squad",
        entryId: "entry-min",
        sourcePath: "min.json",
        name: "Minions",
        groupId: originalGroupId,
        currentStamina: 20,
        maxStamina: 20,
        count: 4,
        captainId: "inst-cap",
        conditions: [],
        reactions: [],
        villainRounds: [],
        turns: 1,
        turnsTaken: 0,
      },
      {
        id: "inst-summon",
        kind: "creature",
        count: 1,
        sourcePath: "sum.json",
        name: "Summon",
        groupId: originalGroupId,
        currentStamina: 10,
        maxStamina: 10,
        summonedBy: "inst-cap",
        conditions: [],
        reactions: [],
        villainRounds: [],
        turns: 1,
        turnsTaken: 0,
      },
    ];
    enc.combat.activeEffects = [
      { id: "eff-1", name: "Aura", expiresRound: 3, sourcePath: "cap.json" },
    ];
  });

  duplicateEncounter(sourceId);
  const copy = activeEncounter();
  expect(copy.id).not.toBe(sourceId);

  const [copyCap, copySquad, copySummon] = copy.combat.instances;
  expect(copy.groups[0]!.id).not.toBe(originalGroupId);
  expect(copy.items[0]!.id).not.toBe("entry-cap");
  expect(copy.items[0]!.groupId).toBe(copy.groups[0]!.id);
  expect(copyCap!.id).not.toBe("inst-cap");
  expect(copyCap!.entryId).toBe(copy.items[0]!.id);
  expect(copyCap!.groupId).toBe(copy.groups[0]!.id);
  expect(copySquad!.id).not.toBe("inst-squad");
  expect(copySquad!.entryId).toBe(copy.items[1]!.id);
  expect(copySquad!.captainId).toBe(copyCap!.id);
  expect(copySummon!.id).not.toBe("inst-summon");
  expect(copySummon!.summonedBy).toBe(copyCap!.id);
  expect(copy.combat.activeEffects[0]!.id).not.toBe("eff-1");
});

it("unblocks a pending shared roll when switching encounters", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(monsterAt).mockReturnValue({
      id: "m-switch",
      chars: { M: 2, A: 1, R: 0, I: 0, P: 0 },
    } as unknown as ReturnType<typeof monsterAt>);
    const originalId = activeEncounter().id;
    createEncounter();
    let calls = 0;
    setDiceTransport(() => {
      calls += 1;
      return calls === 1 ? new Promise(() => {}) : Promise.resolve({ dice: [6, 7] });
    });

    rollCharacteristic("test/switch.json", "M");
    expect(calls).toBe(1);
    selectEncounter(originalId);
    rollCharacteristic("test/switch.json", "M");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
  } finally {
    setDiceTransport(() => null);
    resetPendingSharedRoll();
    vi.useRealTimers();
  }
});

function fakeMonster(path: string, name: string, stamina = 30): Monster {
  return {
    id: path,
    path,
    book: "unified",
    familyPath: "goblin",
    slug: name.toLowerCase(),
    name,
    level: 1,
    organization: "Horde",
    role: "Harrier",
    ev: 6,
    evLabel: "6",
    defaultQty: 1,
    keywords: ["Goblin"],
    ancestry: "Goblin",
    size: "1S",
    speed: 6,
    stamina,
    stability: 0,
    freeStrike: 3,
    movement: "",
    immunities: [],
    weaknesses: [],
    withCaptain: "",
    turnsPerRound: 1,
    chars: { M: 0, A: 2, R: 0, I: 0, P: 0 },
    features: [],
    source: "",
    raw: {},
  };
}

it("auto-readies Run on add, syncs Run removals back to Prep, and undoes/redoes cleanly", async () => {
  createEncounter();
  clearHistory();
  const goblin = fakeMonster("test/goblin.json", "Goblin Runner", 20);
  vi.mocked(loadMonster).mockResolvedValue(goblin);
  vi.mocked(monsterAt).mockImplementation((key) => (key === goblin.path ? goblin : undefined));

  await addToEncounter(goblin.path, 2);
  expect(activeEncounter().combat.active).toBe(true);
  expect(activeEncounter().combat.instances).toHaveLength(2);
  expect(activeEncounter().items[0]?.count).toBe(2);
  expect(hasCombatProgress(activeEncounter())).toBe(false);

  // Damage the first goblin using appended math and verify progress + undo.
  const firstId = activeEncounter().combat.instances[0]!.id;
  expect(applyStaminaCommand(firstId, "20-7")).toBe(13);
  expect(activeEncounter().combat.instances[0]?.currentStamina).toBe(13);
  expect(hasCombatProgress(activeEncounter())).toBe(true);

  // decrementMonster removes the newest untouched goblin (index 1), preserving the wounded one.
  decrementMonster(goblin.path);
  expect(activeEncounter().combat.instances).toHaveLength(1);
  expect(activeEncounter().combat.instances[0]?.id).toBe(firstId);
  expect(activeEncounter().items[0]?.count).toBe(1);

  // Undo restores the removed goblin in both Run and Prep.
  undoStep();
  expect(activeEncounter().combat.instances).toHaveLength(2);
  expect(activeEncounter().items[0]?.count).toBe(2);

  // Redo re-applies the removal.
  redoStep();
  expect(activeEncounter().combat.instances).toHaveLength(1);
  expect(activeEncounter().items[0]?.count).toBe(1);

  // Removing the last instance clears both Run and Prep; lane removal is also undoable.
  removeInstance(firstId);
  expect(activeEncounter().combat.instances).toHaveLength(0);
  expect(activeEncounter().items).toHaveLength(0);

  undoStep();
  expect(activeEncounter().combat.instances).toHaveLength(1);
  removeLane(goblin.path);
  expect(activeEncounter().combat.instances).toHaveLength(0);
  expect(activeEncounter().items).toHaveLength(0);

  undoStep();
  expect(activeEncounter().combat.instances).toHaveLength(1);
});

it("restores turn marks and expired effects on previousRound, and supports undoable resetCombat", async () => {
  createEncounter();
  clearHistory();
  const orc = fakeMonster("test/orc.json", "Orc Brute", 35);
  vi.mocked(loadMonster).mockResolvedValue(orc);
  vi.mocked(monsterAt).mockImplementation((key) => (key === orc.path ? orc : undefined));

  await addToEncounter(orc.path, 1);
  const inst = activeEncounter().combat.instances[0]!;
  markTurn(inst.id, 0);
  mutateApp(() => {
    activeEncounter().combat.activeEffects.push({
      id: "eff-r1",
      name: "Blood Frenzy",
      expiresRound: 1,
      sourcePath: orc.path,
    });
  });

  nextRound();
  expect(activeEncounter().combat.round).toBe(2);
  expect(activeEncounter().combat.instances[0]?.turnsTaken).toBe(0);
  expect(activeEncounter().combat.activeEffects).toHaveLength(0);

  // Step back to Round 1: turn mark and expired effect are restored.
  previousRound();
  expect(activeEncounter().combat.round).toBe(1);
  expect(activeEncounter().combat.instances[0]?.turnsTaken).toBe(1);
  expect(activeEncounter().combat.activeEffects.map((e) => e.name)).toContain("Blood Frenzy");

  // Damage then resetCombat restores full Stamina, and Undo brings back the wounded fight.
  applyStaminaCommand(inst.id, "-15");
  expect(activeEncounter().combat.instances[0]?.currentStamina).toBe(20);
  await resetCombat();
  expect(activeEncounter().combat.instances[0]?.currentStamina).toBe(35);
  expect(activeEncounter().combat.activeEffects).toHaveLength(0);

  undoStep();
  expect(activeEncounter().combat.instances[0]?.currentStamina).toBe(20);
});

it("keeps new encounters in the current lens (Prep or Run) instead of forcing Prep", () => {
  createEncounter();
  setView("combat");
  expect(activeEncounter().view).toBe("combat");

  createEncounter();
  expect(activeEncounter().view).toBe("combat");

  setView("builder");
  createEncounter();
  expect(activeEncounter().view).toBe("builder");
});

it("keeps active tool (Encounters vs Negotiations) separate from each encounter's Prep/Run lens", () => {
  createEncounter();
  setView("combat");
  expect(activeSection()).toBe("encounters");
  expect(activeView()).toBe("combat");

  setSection("negotiations");
  expect(activeSection()).toBe("negotiations");
  expect(activeView()).toBe("talk");
  // Underlying encounter remembers it was in Run.
  expect(activeEncounter().view).toBe("combat");

  setSection("encounters");
  expect(activeSection()).toBe("encounters");
  expect(activeView()).toBe("combat");
});

it("surfaces family and encounter Malice directly from Prep items and for monster previews", () => {
  const prevFeatures = maliceFeatures.value;
  const prevLoading = maliceLoading.value;
  try {
    createEncounter();
    const goblin = fakeMonster("test/goblin-prep.json", "Goblin Sniper", 15);
    goblin.level = 2;
    goblin.familyPath = "goblin/statblocks";
    vi.mocked(monsterAt).mockImplementation((key) => (key === goblin.path ? goblin : undefined));

    const makeFeature = (overrides: Partial<MaliceFeature>): MaliceFeature => ({
      id: overrides.id ?? "mf-1",
      path: "malice/goblin.json",
      name: overrides.name ?? "Goblin Mode",
      cost: overrides.cost ?? 3,
      costText: `${overrides.cost ?? 3} Malice`,
      icon: "",
      effects: [{ effect: "Goblins gain +2 speed." }],
      distance: "",
      target: "",
      keywords: [],
      source: "",
      tokens: [],
      scope: overrides.scope ?? "family",
      family: overrides.family ?? "goblin",
      familyLabel: "Goblin",
      minLevel: overrides.minLevel ?? 1,
      blockName: "Goblin Malice",
    });

    maliceFeatures.value = [
      makeFeature({
        id: "basic-1",
        name: "Brutal Effectiveness",
        cost: 3,
        scope: "basic",
        family: "",
      }),
      makeFeature({ id: "gob-1", name: "Goblin Mode", cost: 3, minLevel: 1 }),
      makeFeature({ id: "gob-hi", name: "Goblin King's Wrath", cost: 7, minLevel: 5 }),
    ];
    maliceLoading.value = false;

    // Previewing a Level 2 Goblin surfaces only level <= 2 family Malice features.
    const previewFeatures = maliceFeaturesForMonster(goblin);
    expect(previewFeatures.map((f) => f.id)).toEqual(["gob-1"]);

    // Even with Prep items only (no combat instances yet), relevantMaliceGroups works.
    mutateApp(() => {
      const enc = activeEncounter();
      enc.items = [
        { id: "prep-only", sourcePath: goblin.path, groupId: enc.groups[0]!.id, count: 2 },
      ];
      enc.combat.instances = [];
    });
    const groups = relevantMaliceGroups();
    expect(groups.map((g) => g.id)).toEqual(["basic", "goblin"]);
    expect(groups[1]?.features.map((f) => f.id)).toEqual(["gob-1"]);
  } finally {
    maliceFeatures.value = prevFeatures;
    maliceLoading.value = prevLoading;
  }
});

it("toggles the party-level catalog window around the active party's level", () => {
  createEncounter();
  clearAllFilters();
  updateParty({ heroes: 5, level: 4, victories: 0, bonusMalice: 0 });
  const bounds: readonly [number, number] = [1, 10];

  expect(isPartyLevelWindowActive(state.value.ui, bounds)).toBe(false);
  togglePartyLevelWindow(bounds);
  expect(state.value.ui.levelMin).toBe(3);
  expect(state.value.ui.levelMax).toBe(5);
  expect(isPartyLevelWindowActive(state.value.ui, bounds)).toBe(true);
  // Active primary Lv chip is not double-counted as a hidden "More" filter.
  expect(hiddenFilterCount(state.value.ui, bounds)).toBe(0);
  expect(hiddenFilterCount(state.value.ui)).toBe(1);

  togglePartyLevelWindow(bounds);
  expect(state.value.ui.levelMin).toBeNull();
  expect(state.value.ui.levelMax).toBeNull();
  expect(isPartyLevelWindowActive(state.value.ui, bounds)).toBe(false);
});
