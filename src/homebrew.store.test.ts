import { beforeEach, describe, expect, it } from "vitest";
import { allCatalog, allMaliceFeatures, monsterAt } from "./data.ts";
import { blankHomebrewMalice, blankHomebrewMonster } from "./lib/homebrew.ts";
import { homebrewMaliceId, homebrewMonsterPath } from "./lib/id.ts";
import { analyzeImportBundle, buildEncounterBundle, type ImportDecision } from "./lib/share.ts";
import {
  activeEncounter,
  addToEncounter,
  applyStaminaCommand,
  clearAllFilters,
  clearHistory,
  commitImportBundle,
  deleteHomebrewMonster,
  matchedCatalog,
  mutateApp,
  redoStep,
  relevantMaliceGroups,
  saveHomebrewMalice,
  saveHomebrewMonster,
  setSquadCaptain,
  startCombat,
  state,
  toggleHomebrewOnly,
  undoStep,
  useMaliceFeature,
} from "./store.ts";

beforeEach(() => {
  mutateApp((app) => {
    app.homebrewMonsters = [];
    app.homebrewMalice = [];
    const first = app.encounters[0]!;
    first.items = [];
    first.combat.active = false;
    first.combat.instances = [];
    first.combat.selectedMaliceFeatureIds = [];
    first.combat.maliceSelectionInitialized = false;
    app.encounters = [first];
    app.activeEncounterId = first.id;
  });
  clearAllFilters();
  clearHistory();
});

describe("homebrew + share/import end-to-end store workflow", () => {
  it("creates homebrew monster, filters via homebrewOnly, runs in combat, and rescales live stamina on edit", async () => {
    const draft = blankHomebrewMonster(2, "Elite", "Brute");
    draft.name = "Ironbark Golem";
    draft.stamina = 100;

    const id = saveHomebrewMonster(draft);
    const path = homebrewMonsterPath(id);

    expect(monsterAt(path)?.name).toBe("Ironbark Golem");
    expect(monsterAt(`${path}@5`)?.level).toBe(5);
    expect(allCatalog.value.some((entry) => entry.path === path)).toBe(true);

    toggleHomebrewOnly();
    expect(matchedCatalog().matches.map((m) => m.entry.path)).toEqual([path]);

    const added = await addToEncounter(path, 1);
    expect(added).toBe(true);
    await startCombat({ switchView: false });

    const inst = activeEncounter().combat.instances[0]!;
    expect(inst.maxStamina).toBe(100);
    applyStaminaCommand(inst.id, "-50");
    expect(activeEncounter().combat.instances[0]!.currentStamina).toBe(50);

    // Edit the homebrew monster to 140 max Stamina & 2 turns: live combat instance scales proportionally (50% -> 70)
    const edited = { ...state.value.homebrewMonsters[0]!, stamina: 140, turnsPerRound: 2 };
    saveHomebrewMonster(edited);

    const updatedInst = activeEncounter().combat.instances[0]!;
    expect(updatedInst.maxStamina).toBe(140);
    expect(updatedInst.currentStamina).toBe(70);
    expect(updatedInst.turns).toBe(2);
    expect(state.value.homebrewMonsters[0]!.revision).toBe(2);

    // Undo -> Redo must preserve rescaled combat Stamina & turns atomically
    undoStep();
    expect(activeEncounter().combat.instances[0]!.maxStamina).toBe(100);
    expect(activeEncounter().combat.instances[0]!.currentStamina).toBe(50);
    redoStep();
    expect(activeEncounter().combat.instances[0]!.maxStamina).toBe(140);
    expect(activeEncounter().combat.instances[0]!.currentStamina).toBe(70);
    expect(activeEncounter().combat.instances[0]!.turns).toBe(2);

    // Deleting removes it cleanly (including encounter items, instances, and active flag) and can be undone atomically
    deleteHomebrewMonster(id);
    expect(state.value.homebrewMonsters).toHaveLength(0);
    expect(monsterAt(path)).toBeUndefined();
    expect(activeEncounter().items).toHaveLength(0);
    expect(activeEncounter().combat.instances).toHaveLength(0);
    expect(activeEncounter().combat.active).toBe(false);

    undoStep();
    expect(state.value.homebrewMonsters).toHaveLength(1);
    expect(monsterAt(path)?.name).toBe("Ironbark Golem");
    expect(activeEncounter().combat.instances).toHaveLength(1);
    expect(activeEncounter().combat.active).toBe(true);
  });

  it("preserves minion captain Stamina bonus on edit and releases captain when captain is deleted", async () => {
    const minion = blankHomebrewMonster(1, "Minion", "Brute");
    minion.name = "Ash Thrall";
    minion.stamina = 5;
    minion.withCaptain = "+2 bonus to Stamina";
    const minionId = saveHomebrewMonster(minion);
    const minionPath = homebrewMonsterPath(minionId);

    const captain = blankHomebrewMonster(1, "Platoon", "Leader");
    captain.name = "Ash Captain";
    captain.stamina = 40;
    const captainId = saveHomebrewMonster(captain);
    const captainPath = homebrewMonsterPath(captainId);

    await addToEncounter(minionPath, 4);
    await addToEncounter(captainPath, 1);
    await startCombat({ switchView: false });

    const squadInst = activeEncounter().combat.instances.find((i) => i.kind === "minion-squad")!;
    const capInst = activeEncounter().combat.instances.find((i) => i.kind === "creature")!;
    expect(squadInst.maxStamina).toBe(20); // 4 * 5

    setSquadCaptain(squadInst.id, capInst.id);
    expect(activeEncounter().combat.instances.find((i) => i.id === squadInst.id)!.maxStamina).toBe(
      28,
    ); // 4 * (5 + 2)

    // Editing the minion's name must keep the captain's +2/minion Stamina bonus intact
    saveHomebrewMonster({
      ...state.value.homebrewMonsters.find((m) => m.id === minionId)!,
      name: "Ash Thrall Renamed",
    });
    expect(activeEncounter().combat.instances.find((i) => i.id === squadInst.id)!.maxStamina).toBe(
      28,
    );

    // Deleting the captain homebrew monster must release the captain link and bonus cleanly
    deleteHomebrewMonster(captainId);
    const remainingSquad = activeEncounter().combat.instances.find((i) => i.id === squadInst.id)!;
    expect(remainingSquad.captainId).toBeUndefined();
    expect(remainingSquad.maxStamina).toBe(20);
  });

  it("creates custom Malice, pins it to encounter, spends it in combat, and roundtrips full import + undo", async () => {
    const mal = blankHomebrewMalice("", "Custom", 1);
    mal.name = "Shatter the Floor";
    mal.cost = 3;
    mal.costText = "3 Malice";

    const malId = saveHomebrewMalice(mal, { pinToEncounter: true });
    const malRef = homebrewMaliceId(malId);

    expect(allMaliceFeatures.value.some((f) => f.id === malRef)).toBe(true);
    expect(activeEncounter().combat.selectedMaliceFeatureIds).toContain(malRef);
    expect(relevantMaliceGroups().some((g) => g.features.some((f) => f.id === malRef))).toBe(true);

    // Spend custom Malice during combat
    mutateApp((app) => {
      app.encounters[0]!.combat.malice = 5;
    });
    useMaliceFeature(malRef);
    expect(activeEncounter().combat.malice).toBe(2);

    // Build encounter bundle, wipe local state, and commit import atomically
    const mon = blankHomebrewMonster(1, "Platoon", "Harrier");
    mon.name = "Glass Stalker";
    mon.maliceIds = [malId];
    const monId = saveHomebrewMonster(mon);
    await addToEncounter(homebrewMonsterPath(monId), 1);

    const bundle = buildEncounterBundle(
      activeEncounter(),
      state.value.homebrewMonsters,
      state.value.homebrewMalice,
    );

    // Clear local homebrew & encounter so import adds fresh
    mutateApp((app) => {
      app.homebrewMonsters = [];
      app.homebrewMalice = [];
      app.encounters[0]!.id = "local-other";
      app.encounters[0]!.items = [];
      app.activeEncounterId = "local-other";
    });
    clearHistory();

    const analysis = analyzeImportBundle(bundle, state.value);
    const decisions = new Map<string, ImportDecision>(
      analysis.items.map((item) => [item.key, item.defaultDecision]),
    );
    await commitImportBundle(bundle, decisions);

    expect(state.value.homebrewMonsters.some((m) => m.id === monId)).toBe(true);
    expect(state.value.homebrewMalice.some((m) => m.id === malId)).toBe(true);
    expect(activeEncounter().id).toBe(bundle.primaryId);

    // Undo rolls back the entire import atomically
    undoStep();
    expect(state.value.homebrewMonsters).toHaveLength(0);
    expect(state.value.homebrewMalice).toHaveLength(0);
  });
});
