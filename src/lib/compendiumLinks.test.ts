import { describe, expect, it } from "vitest";
import {
  autoLinkCompendiumText,
  autoLinkFeature,
  buildCompendiumGlossary,
  detectRuleTrigger,
  featureListMentionsName,
  matchGlossaryTerms,
  replaceMonsterNameInFeature,
  replaceMonsterNameInText,
  segmentCompendiumTerms,
  stripCompendiumLinks,
  stripCompendiumLinksFromFeature,
} from "./compendiumLinks.ts";
import { blankHomebrewMonster, homebrewToCatalogEntry } from "./homebrew.ts";

describe("compendiumLinks", () => {
  it("harvests verified scc.v1 links from official statblocks and merges built-ins", () => {
    const hb = blankHomebrewMonster(1, "Platoon", "Brute");
    hb.name = "Official Ogre";
    hb.features = [
      {
        name: "Bully",
        effects: [
          {
            effect:
              "Can't be [flanked](scc.v1:mcdm.heroes.v1/rule.combat/flanking) or [flanked](scc.v1:mcdm.heroes.v1/rule.combat/flanking) twice.",
          },
        ],
      },
    ];
    const entry = homebrewToCatalogEntry(hb);
    entry.isHomebrew = false;
    if (entry.monster) entry.monster.isHomebrew = false;

    const glossary = buildCompendiumGlossary([entry], []);
    expect(glossary.some((t) => t.label === "frightened" && t.category === "Condition")).toBe(true);
    expect(glossary.some((t) => t.label === "flanked" && t.href.includes("flanking"))).toBe(true);
  });

  it("auto-links plain conditions and rules without double-linking existing markdown links", () => {
    const glossary = buildCompendiumGlossary([], []);
    const input =
      "Xorannox can't be made frightened or knocked [prone](scc.v1:mcdm.heroes.v1/condition/prone), and can push 2.";
    const res = autoLinkCompendiumText(input, glossary);
    expect(res.count).toBe(2);
    expect(res.text).toContain("[frightened](scc.v1:mcdm.heroes.v1/condition/frightened)");
    expect(res.text).toContain("[prone](scc.v1:mcdm.heroes.v1/condition/prone)");
    expect(res.text).not.toContain("[[prone]");
    expect(res.text).toContain("[push](scc.v1:mcdm.heroes.v1/movement/forced-movement) 2");
  });

  it("auto-links trigger, tiers, and prose across a whole feature", () => {
    const glossary = buildCompendiumGlossary([], []);
    const { feature, count } = autoLinkFeature(
      {
        name: "Roar",
        trigger: "An adjacent enemy moves.",
        effects: [
          {
            tier1: "4 damage; push 1",
            tier3: "10 damage; M < 2, prone",
            effect: "Target is frightened.",
          },
        ],
      },
      glossary,
    );
    expect(count).toBe(4);
    expect(feature.trigger).toContain("[adjacent](");
    expect(feature.effects?.[0]?.tier1).toContain("[push](");
    expect(feature.effects?.[0]?.tier3).toContain("[prone](");
    expect(feature.effects?.[0]?.effect).toContain("[frightened](");
  });

  it("replaces source monster names including boss epithets, titles, and troop short names", () => {
    // Named boss with epithet ("Xorannox the Tyract" -> "Xorannox")
    const xorannox = replaceMonsterNameInText(
      "Xorannox can't be made [frightened](scc.v1:mcdm.heroes.v1/condition/frightened) or knocked [prone](scc.v1:mcdm.heroes.v1/condition/prone), and Xorannox's allies shift 2.",
      "Xorannox the Tyract",
      "Cindermaw",
    );
    expect(xorannox.count).toBe(2);
    expect(xorannox.text).toBe(
      "Cindermaw can't be made [frightened](scc.v1:mcdm.heroes.v1/condition/frightened) or knocked [prone](scc.v1:mcdm.heroes.v1/condition/prone), and Cindermaw's allies shift 2.",
    );

    // Titled boss ("Count Rhodar von Glauer" -> "Rhodar")
    const rhodar = replaceMonsterNameInText(
      "Each enemy within 10 squares of Rhodar takes a -2 penalty.",
      "Count Rhodar von Glauer",
      "Lord Vex",
    );
    expect(rhodar.count).toBe(1);
    expect(rhodar.text).toBe("Each enemy within 10 squares of Lord Vex takes a -2 penalty.");

    // Troop short name ("Goblin Redeye" -> "The redeye", "Meteor Dragon" -> "The dragon")
    const { feature, count } = replaceMonsterNameInFeature(
      {
        name: "Ready Rodent",
        effects: [{ effect: "The redeye makes a free strike." }],
      },
      "Goblin Redeye",
      "Ashfang",
    );
    expect(count).toBe(1);
    expect(feature.effects?.[0]?.effect).toBe("Ashfang makes a free strike.");
    expect(featureListMentionsName([feature], "Goblin Redeye")).toBe(false);

    const dragon = replaceMonsterNameInText(
      "The dragon flies up to their speed.",
      "Meteor Dragon",
      "Cindermaw",
    );
    expect(dragon.text).toBe("Cindermaw flies up to their speed.");
  });

  it("detects explicit @/[ triggers and passive rule words while ignoring completed links", () => {
    const glossary = buildCompendiumGlossary([], []);

    const at = detectRuleTrigger("Target is @fri", 14, glossary);
    expect(at).toEqual({ kind: "explicit", start: 10, end: 14, query: "fri" });

    const bracket = detectRuleTrigger("Target is [[pro", 15, glossary);
    expect(bracket).toEqual({ kind: "explicit", start: 10, end: 15, query: "pro" });

    const passive = detectRuleTrigger("Target is frig", 14, glossary);
    expect(passive).toEqual({ kind: "word", start: 10, end: 14, query: "frig" });
    expect(matchGlossaryTerms(glossary, "frig", "word")[0]?.label).toBe("frightened");

    // Ordinary words must not trigger passive suggestions
    expect(detectRuleTrigger("Target is the", 13, glossary)).toBeNull();

    // Cursor inside an existing markdown link must not trigger
    const linked = "Target is [frightened](scc.v1:mcdm.heroes.v1/condition/frightened)";
    expect(detectRuleTrigger(linked, 18, glossary)).toBeNull();

    // segmentCompendiumTerms leaves existing markdown links unhighlighted
    const segsWithLink = segmentCompendiumTerms(
      "Target is [frightened](scc.v1:mcdm.heroes.v1/condition/frightened) and prone.",
      glossary,
    );
    expect(segsWithLink.map((s) => s.text).join("")).toBe(
      "Target is [frightened](scc.v1:mcdm.heroes.v1/condition/frightened) and prone.",
    );
    expect(segsWithLink.filter((s) => s.term).map((s) => s.text)).toEqual(["prone"]);
  });

  it("strips scc.v1 compendium URIs cleanly while leaving non-scc markdown intact", () => {
    const raw =
      "10 damage; [push](scc.v1:mcdm.heroes.v1/movement/forced-movement) 4; M < 2, [prone](scc.v1:mcdm.heroes.v1/condition/prone) and [notes](https://example.com)";
    expect(stripCompendiumLinks(raw)).toBe(
      "10 damage; push 4; M < 2, prone and [notes](https://example.com)",
    );

    const stripped = stripCompendiumLinksFromFeature({
      name: "Slam",
      trigger: "An [adjacent](scc.v1:mcdm.heroes.v1/rule.combat/adjacent) enemy moves.",
      effects: [
        {
          tier3: "12 damage; M < 2, [prone](scc.v1:mcdm.heroes.v1/condition/prone)",
          effect: "Target is [slowed](scc.v1:mcdm.heroes.v1/condition/slowed).",
        },
      ],
    });
    expect(stripped.trigger).toBe("An adjacent enemy moves.");
    expect(stripped.effects?.[0]?.tier3).toBe("12 damage; M < 2, prone");
    expect(stripped.effects?.[0]?.effect).toBe("Target is slowed.");

    const glossary = buildCompendiumGlossary([], []);
    const sample = "10 damage; push 4; M < 2, prone";
    const segs = segmentCompendiumTerms(sample, glossary);
    expect(segs.map((s) => s.text).join("")).toBe(sample);
    expect(segs.filter((s) => s.term).map((s) => s.text)).toEqual(["push", "prone"]);
  });
});
