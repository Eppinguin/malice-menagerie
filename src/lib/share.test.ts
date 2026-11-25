import { describe, expect, it } from "vitest";
import { blankHomebrewMalice, blankHomebrewMonster } from "./homebrew.ts";
import { homebrewMaliceId, homebrewMonsterPath, uuidv7 } from "./id.ts";
import { sourceRef } from "./repo.ts";
import { resolvePowerRollBonus } from "./rules.ts";
import {
  analyzeImportBundle,
  applyImportToAppState,
  buildEncounterBundle,
  buildMonsterBundle,
  buildNegotiationBundle,
  decodeBundleFromHash,
  encodeBundleToHash,
  itemKey,
  parseImportInput,
  type ImportDecision,
} from "./share.ts";
import type { AppState, Encounter, Negotiation } from "../types.ts";

function makeEmptyState(): AppState {
  const enc: Encounter = {
    id: uuidv7(),
    name: "Existing Fight",
    schemaVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
    view: "builder",
    party: { heroes: 5, level: 1, victories: 0, bonusMalice: 0 },
    groups: [{ id: "g1", name: "A" }],
    activePrepGroupId: "g1",
    items: [],
    combat: {
      active: false,
      round: 1,
      malice: 0,
      instances: [],
      activeGroupFilter: null,
      activeEffects: [],
      selectedMaliceFeatureIds: [],
      maliceSelectionInitialized: false,
    },
  };
  return {
    encounters: [enc],
    activeEncounterId: enc.id,
    negotiations: [],
    activeNegotiationId: "",
    homebrewMonsters: [],
    homebrewMalice: [],
    ui: {
      section: "encounters",
      role: "all",
      search: "",
      maliceDockOpen: true,
      watchOpen: true,
      maliceLibraryOpen: false,
      sort: "name",
      filtersOpen: false,
      sidebarCollapsed: false,
      roles: [],
      sizes: [],
      keywords: [],
      levelMin: null,
      levelMax: null,
      evMin: null,
      evMax: null,
      fitsBudget: false,
      inEncounter: false,
      homebrewOnly: false,
    },
  };
}

describe("share bundles, link encoding, and conflict-safe imports", () => {
  it("roundtrips an encounter bundle with transitive homebrew monsters & custom Malice via encoded hash", async () => {
    const mal = blankHomebrewMalice("ashbone", "Ashbone", 1);
    mal.name = "Cinder Wake";
    const mon = blankHomebrewMonster(2, "Elite", "Brute");
    mon.name = "Ashbone Reaver";
    mon.maliceIds = [mal.id];

    const app = makeEmptyState();
    app.homebrewMalice.push(mal);
    app.homebrewMonsters.push(mon);
    const enc = app.encounters[0]!;
    enc.name = "Sunken Mill Ambush";
    enc.items = [
      { id: "e1", sourcePath: `${homebrewMonsterPath(mon.id)}@4`, groupId: "g1", count: 2 },
    ];
    enc.combat.active = true;
    enc.combat.round = 3;
    enc.combat.malice = 9;
    enc.combat.selectedMaliceFeatureIds = [homebrewMaliceId(mal.id)];

    // Prep-clean export strips live combat progress while keeping curated Malice & transitive homebrew
    const bundle = buildEncounterBundle(enc, app.homebrewMonsters, app.homebrewMalice, {
      includeCombat: false,
    });
    expect(bundle.monsters?.map((m) => m.id)).toEqual([mon.id]);
    expect(bundle.malice?.map((m) => m.id)).toEqual([mal.id]);
    expect(bundle.encounters?.[0]?.combat.active).toBe(false);
    expect(bundle.encounters?.[0]?.combat.round).toBe(1);
    expect(bundle.encounters?.[0]?.combat.selectedMaliceFeatureIds).toEqual([
      homebrewMaliceId(mal.id),
    ]);

    const hash = await encodeBundleToHash(bundle);
    expect(hash.startsWith("#s=")).toBe(true);
    const decoded = await decodeBundleFromHash(`https://example.com/${hash}`);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.bundle.encounters?.[0]?.name).toBe("Sunken Mill Ambush");
    expect(decoded.bundle.monsters?.[0]?.name).toBe("Ashbone Reaver");
    expect(decoded.bundle.malice?.[0]?.name).toBe("Cinder Wake");
  });

  it("remaps copied homebrew monster & custom Malice IDs inside imported encounters (preserving @level)", () => {
    const mal = blankHomebrewMalice("", "Custom", 1);
    mal.name = "Bone Storm";
    const mon = blankHomebrewMonster(1, "Platoon", "Harrier");
    mon.name = "Bone Runner";
    mon.maliceIds = [mal.id];

    const app = makeEmptyState();
    app.homebrewMalice.push(structuredClone(mal));
    app.homebrewMonsters.push(structuredClone(mon));

    const sharedEnc: Encounter = {
      ...structuredClone(app.encounters[0]!),
      id: uuidv7(),
      name: "Catacomb Chase",
      items: [
        { id: "e1", sourcePath: `${homebrewMonsterPath(mon.id)}@3`, groupId: "g1", count: 2 },
      ],
      combat: {
        ...app.encounters[0]!.combat,
        selectedMaliceFeatureIds: [homebrewMaliceId(mal.id)],
      },
    };
    const bundle = buildEncounterBundle(sharedEnc, [mon], [mal]);

    const analysis = analyzeImportBundle(bundle, app);
    expect(analysis.items.find((i) => i.kind === "monster")?.status).toBe("identical");
    expect(analysis.items.find((i) => i.kind === "malice")?.status).toBe("identical");

    // Force "copy" for monster & malice and "add" for encounter: encounter must point to the new copy IDs!
    const decisions = new Map<string, ImportDecision>([
      [itemKey("encounter", sharedEnc.id), "add"],
      [itemKey("monster", mon.id), "copy"],
      [itemKey("malice", mal.id), "copy"],
    ]);

    const result = applyImportToAppState(
      app,
      bundle,
      decisions,
      (raw) => raw as Encounter,
      (raw) => raw as Negotiation,
    );
    expect(result.added).toBe(1);
    expect(result.copied).toBe(2);

    const copiedMal = app.homebrewMalice.find((m) => m.id !== mal.id)!;
    const copiedMon = app.homebrewMonsters.find((m) => m.id !== mon.id)!;
    const importedEnc = app.encounters.find((e) => e.id === sharedEnc.id)!;

    expect(copiedMon.maliceIds).toEqual([copiedMal.id]);
    expect(importedEnc.items[0]?.sourcePath).toBe(`${homebrewMonsterPath(copiedMon.id)}@3`);
    expect(importedEnc.combat.selectedMaliceFeatureIds).toEqual([homebrewMaliceId(copiedMal.id)]);
  });

  it("strips negotiation progress by default when building a negotiation share bundle", () => {
    const neg: Negotiation = {
      id: uuidv7(),
      name: "Lady Vex",
      ask: "Open the bridge",
      archetype: "",
      attitude: "suspicious",
      languageBonus: 1,
      interest: 4,
      patience: 1,
      impression: 5,
      renown: "famous",
      motivations: [{ id: "t1", name: "Greed", note: "Gold", used: true, revealed: true }],
      pitfalls: [{ id: "t2", name: "Benevolence", note: "", used: false, revealed: true }],
      outcomes: ["", "", "", "", "", ""],
      log: [
        {
          id: "l1",
          kind: "argument",
          title: "Appealed to Greed",
          result: "Interest +1",
          roll: "15",
          before: { interest: 2, patience: 3, usedIds: [] },
          at: 100,
        },
      ],
      ended: null,
      updatedAt: 200,
    };
    const cleanBundle = buildNegotiationBundle(neg, { includeProgress: false });
    const shared = cleanBundle.negotiations![0]!;
    expect(shared.log).toEqual([]);
    expect(shared.motivations[0]?.used).toBe(false);
    expect(shared.motivations[0]?.revealed).toBe(true);
    expect(shared.interest).toBe(2); // suspicious starts at 2
    expect(shared.patience).toBe(3); // suspicious 2 + languageBonus 1
  });

  it("rejects corrupted links and future bundle versions gracefully", async () => {
    const badLink = await decodeBundleFromHash("#s=1.not_valid_compressed_data");
    expect(badLink.ok).toBe(false);

    const future = await parseImportInput(
      JSON.stringify({ format: "malice-menagerie", version: 99, kind: "monster" }),
    );
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toContain("newer version");

    const mon = blankHomebrewMonster(1, "Platoon", "Brute");
    mon.name = "Valid Foe";
    const okJson = await parseImportInput(JSON.stringify(buildMonsterBundle(mon, [])));
    expect(okJson.ok).toBe(true);

    const zeroVersion = await parseImportInput(
      JSON.stringify({ format: "malice-menagerie", version: 0, kind: "monster" }),
    );
    expect(zeroVersion.ok).toBe(false);
  });

  it("parses valid JSON whose notes contain #s= without mistaking it for a share link", async () => {
    const mon = blankHomebrewMonster(1, "Platoon", "Brute");
    mon.name = "Hash Note Foe";
    mon.features = [{ name: "Note", effects: [{ effect: "See link #s=1.abc in notes." }] }];
    const parsed = await parseImportInput(JSON.stringify(buildMonsterBundle(mon, [])));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.bundle.monsters?.[0]?.name).toBe("Hash Note Foe");
  });

  it("defensively normalizes malformed encounter items and remaps negotiation undo logs on copy", async () => {
    const malformed = await parseImportInput(
      JSON.stringify({
        format: "malice-menagerie",
        version: 1,
        kind: "encounter",
        encounters: [{ id: "__proto__", name: { bad: true }, items: [null, 42, { count: 2 }] }],
      }),
    );
    expect(malformed.ok).toBe(true);
    if (!malformed.ok) return;
    const analysis = analyzeImportBundle(malformed.bundle, makeEmptyState());
    expect(analysis.items).toHaveLength(1);
    expect(analysis.items[0]?.id).not.toBe("__proto__");
    expect(analysis.items[0]?.name).toBe("Untitled encounter");

    // Copying a negotiation must remap log.before.usedIds & revealedPitfallIds to the new trait IDs
    const app = makeEmptyState();
    const neg: Negotiation = {
      id: uuidv7(),
      name: "Duke Varn",
      ask: "Sign the treaty",
      archetype: "",
      attitude: "neutral",
      languageBonus: 0,
      interest: 3,
      patience: 2,
      impression: 3,
      renown: "famous",
      motivations: [{ id: "m-orig", name: "Power", note: "", used: true, revealed: true }],
      pitfalls: [{ id: "p-orig", name: "Mercy", note: "", used: false, revealed: true }],
      outcomes: ["", "", "", "", "", ""],
      log: [
        {
          id: "log-1",
          kind: "argument",
          title: "Appeal to Power",
          result: "Interest +1",
          roll: "16",
          before: { interest: 2, patience: 3, usedIds: ["m-orig"], revealedPitfallIds: ["p-orig"] },
          at: 100,
        },
      ],
      ended: null,
      updatedAt: 200,
    };
    app.negotiations.push(structuredClone(neg));
    const bundle = buildNegotiationBundle(neg, { includeProgress: true });
    const decisions = new Map<string, ImportDecision>([[itemKey("negotiation", neg.id), "copy"]]);
    applyImportToAppState(
      app,
      bundle,
      decisions,
      (raw) => raw as Encounter,
      (raw) => raw as Negotiation,
    );
    const copied = app.negotiations.find((n) => n.id !== neg.id)!;
    expect(copied.motivations[0]!.id).not.toBe("m-orig");
    expect(copied.pitfalls[0]!.id).not.toBe("p-orig");
    expect(copied.log[0]?.before?.usedIds).toEqual([copied.motivations[0]!.id]);
    expect(copied.log[0]?.before?.revealedPitfallIds).toEqual([copied.pitfalls[0]!.id]);
  });

  it("rejects path traversal in scc.v1 links and parses Unicode minus in Power Roll bonuses", () => {
    expect(sourceRef("scc.v1:x/a/../../../../attacker/repo/main/payload")).toBeNull();
    expect(sourceRef("scc.v1:mcdm.heroes.v1/condition/frightened")).not.toBeNull();
    expect(resolvePowerRollBonus("Power Roll \u2212 1", null)).toBe(-1);
    expect(resolvePowerRollBonus("Power Roll - 2", null)).toBe(-2);
    expect(resolvePowerRollBonus("Power Roll + 3", null)).toBe(3);
  });
});
