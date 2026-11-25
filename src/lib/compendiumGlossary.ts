import { computed } from "@preact/signals";
import { catalog, conditionCatalog, maliceFeatures, officialHydrationEpoch } from "../data.ts";
import { buildCompendiumGlossary, type CompendiumTerm } from "./compendiumLinks.ts";

/**
 * Live-harvested + built-in Draw Steel Compendium rule links for the Studio
 * text editors. Isolated from `data.ts` so `compendiumLinks.ts` code-splits
 * cleanly with the lazy Homebrew chunk, and keyed on `officialHydrationEpoch`
 * so homebrew edits never trigger full-catalog glossary rebuilds.
 */
export const compendiumGlossary = computed<readonly CompendiumTerm[]>(() => {
  void officialHydrationEpoch.value;
  return buildCompendiumGlossary(catalog.value, maliceFeatures.value, conditionCatalog.value);
});
