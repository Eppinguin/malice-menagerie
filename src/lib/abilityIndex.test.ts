import { describe, expect, it } from "vitest";
import {
  buildAbilityIndex,
  cloneAbilityForLevel,
  featureCategories,
  filterAbilityIndex,
} from "./abilityIndex.ts";
import { blankHomebrewMonster, homebrewToCatalogEntry } from "./homebrew.ts";
import type { CatalogEntry, MonsterFeature } from "../types.ts";

function makeEntry(
  name: string,
  level: number,
  role: string,
  features: MonsterFeature[],
  isHomebrew = false,
): CatalogEntry {
  const hb = blankHomebrewMonster(level, "Platoon", role);
  hb.name = name;
  hb.features = features;
  const entry = homebrewToCatalogEntry(hb);
  if (!isHomebrew && entry.monster) {
    entry.isHomebrew = false;
    entry.monster.isHomebrew = false;
    delete entry.monster.homebrewId;
  }
  return entry;
}

describe("abilityIndex", () => {
  it("classifies Signature, Malice, Maneuver, Triggered, Villain Action, and Trait features", () => {
    expect(featureCategories({ name: "Slash", ability_type: "Signature Ability" })).toContain(
      "signature",
    );
    const maliceManeuver = featureCategories({
      name: "Shadow Step",
      cost: "3 Malice",
      usage: "Maneuver",
    });
    expect(maliceManeuver).toContain("malice");
    expect(maliceManeuver).toContain("maneuver");

    expect(
      featureCategories({
        name: "Riposte",
        usage: "Triggered",
        trigger: "An enemy misses.",
      }),
    ).toContain("triggered");
    expect(
      featureCategories({ name: "Rally", cost: "Villain Action 1", usage: "Villain Action" }),
    ).toContain("villain");
    expect(featureCategories({ name: "Pack Tactics", feature_type: "trait" })).toContain("trait");
  });

  it("indexes and filters abilities across official and homebrew monsters by category, role, and text", () => {
    const entries = [
      makeEntry("Goblin Sniper", 1, "Artillery", [
        {
          name: "Pinning Shot",
          ability_type: "Signature Ability",
          usage: "Main action",
          effects: [{ roll: "Power Roll + 2", tier1: "4 damage", tier2: "6 damage; slowed" }],
        },
        {
          name: "Smoke Bomb",
          cost: "3 Malice",
          usage: "Maneuver",
          effects: [{ effect: "Teleport 5 squares and become concealed." }],
        },
      ]),
      makeEntry(
        "Ash Knight",
        3,
        "Defender",
        [
          {
            name: "Shield Wall",
            usage: "Triggered",
            trigger: "An adjacent ally takes damage.",
            effects: [{ effect: "Halve the triggering damage." }],
          },
          {
            name: "Iron Will",
            feature_type: "trait",
            effects: [{ effect: "Immune to frightened." }],
          },
        ],
        true,
      ),
    ];

    const index = buildAbilityIndex(entries);
    expect(index).toHaveLength(4);

    const malice = filterAbilityIndex(index, {
      query: "",
      category: "malice",
      onlyHomebrew: false,
    });
    expect(malice.map((i) => i.feature.name)).toEqual(["Smoke Bomb"]);

    const teleport = filterAbilityIndex(index, {
      query: "teleport",
      category: "all",
      onlyHomebrew: false,
    });
    expect(teleport.map((i) => i.feature.name)).toEqual(["Smoke Bomb"]);

    const hbOnly = filterAbilityIndex(index, {
      query: "",
      category: "all",
      onlyHomebrew: true,
    });
    expect(hbOnly.map((i) => i.feature.name)).toEqual(["Iron Will", "Shield Wall"]);

    const artilleryOnly = filterAbilityIndex(index, {
      query: "",
      category: "all",
      onlyHomebrew: false,
      roleFilter: "Artillery",
    });
    expect(artilleryOnly).toHaveLength(2);
  });

  it("finds a monster's abilities by the monster's name, in statblock order, ahead of text mentions", () => {
    const entries = [
      makeEntry("Arixx", 1, "", [
        { name: "Bite", ability_type: "Signature Ability", usage: "Main action" },
        { name: "Acid Spew", cost: "3 Malice", usage: "Main action" },
      ]),
      makeEntry("Goblin Sage", 1, "Support", [
        {
          name: "Old Lore",
          feature_type: "trait",
          effects: [{ effect: "Knows where the arixx sleeps." }],
        },
      ]),
    ];
    const found = filterAbilityIndex(buildAbilityIndex(entries), {
      query: "arixx",
      category: "all",
      onlyHomebrew: false,
    });
    expect(found.map((i) => i.feature.name)).toEqual(["Bite", "Acid Spew", "Old Lore"]);
  });

  it("scales cloned ability damage when target level differs", () => {
    const entry = makeEntry("Goblin Warrior", 1, "Brute", [
      {
        name: "Cleaver",
        ability_type: "Signature Ability",
        usage: "Main action",
        effects: [
          {
            roll: "Power Roll + 2",
            tier1: "5 damage",
            tier2: "8 damage",
            tier3: "11 damage",
          },
        ],
      },
    ]);
    const [item] = buildAbilityIndex([entry]);
    expect(item).toBeDefined();
    const scaled = cloneAbilityForLevel(item!, 6, true);
    expect(scaled.effects?.[0]?.tier3).not.toBe("11 damage");
    const unscaled = cloneAbilityForLevel(item!, 6, false);
    expect(unscaled.effects?.[0]?.tier3).toBe("11 damage");
  });
});
