import { signal } from "@preact/signals";
import { clampInt, normalizeToken, uid } from "./lib/text.ts";
import { makePowerRoll, partyMath } from "./lib/rules.ts";
import { dedupeMaliceFeatures, featureText, isPriorMaliceGateway } from "./lib/malice.ts";
import {
  catalog,
  catalogSearchText,
  hydrateCatalogInBackground,
  hydrateConditionsInBackground,
  hydrateMaliceInBackground,
  loadMonster,
  loadSourceIndex,
  maliceFeatures,
  maliceLoading,
  monsterCache,
  monstersVersion,
} from "./data.ts";
import { isRecord } from "./types.ts";
import type {
  AppState,
  CatalogEntry,
  CombatInstance,
  CombatState,
  FacetKey,
  Group,
  MaliceFeature,
  MaliceGroup,
  Monster,
  PowerRollResult,
  SortKey,
  UIState,
  ViewName,
} from "./types.ts";

export const STORAGE_KEY = "steel-table-v6";
export const MAX_LIBRARY_RESULTS = 120;

// ---------- State construction, sanitizing, persistence ----------

function defaultState(): AppState {
  return {
    party: { heroes: 5, level: 1, victories: 0, bonusMalice: 0 },
    groups: [
      { id: "group-a", name: "A" },
      { id: "group-b", name: "B" },
    ],
    activePrepGroupId: "group-a",
    encounter: [],
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
    ui: {
      view: "builder",
      role: "all",
      search: "",
      maliceDockOpen: true,
      maliceLibraryOpen: false,
      sort: "name",
      filtersOpen: false,
      roles: [],
      sizes: [],
      keywords: [],
      levelMin: null,
      levelMax: null,
      evMin: null,
      evMax: null,
    },
  };
}

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;
const asBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const asNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Rebuild a guaranteed-valid AppState from whatever was persisted. */
function sanitizeState(value: unknown): AppState {
  const base = defaultState();
  if (!isRecord(value)) return base;

  if (isRecord(value["party"])) {
    const party = value["party"];
    base.party = {
      heroes: clampInt(party["heroes"], 1, 12),
      level: clampInt(party["level"], 1, 10),
      victories: clampInt(party["victories"], 0, 20),
      bonusMalice: clampInt(party["bonusMalice"], 0, 99),
    };
  }

  if (Array.isArray(value["groups"])) {
    const groups = value["groups"]
      .filter(isRecord)
      .map((group): Group | null => {
        const id = group["id"];
        const name = group["name"];
        return typeof id === "string" && typeof name === "string" ? { id, name } : null;
      })
      .filter((group): group is Group => group !== null);
    if (groups.length) base.groups = groups;
  }

  if (Array.isArray(value["encounter"])) {
    base.encounter = value["encounter"].filter(isRecord).flatMap((item) => {
      const id = item["id"];
      const sourcePath = item["sourcePath"];
      const groupId = item["groupId"];
      if (typeof id !== "string" || typeof sourcePath !== "string" || typeof groupId !== "string")
        return [];
      return [{ id, sourcePath, groupId, count: clampInt(item["count"], 1, 99) }];
    });
  }

  if (isRecord(value["combat"])) {
    const combat = value["combat"];
    const instances: CombatInstance[] = Array.isArray(combat["instances"])
      ? combat["instances"].filter(isRecord).flatMap((item): CombatInstance[] => {
          const id = item["id"];
          const sourcePath = item["sourcePath"];
          const groupId = item["groupId"];
          if (
            typeof id !== "string" ||
            typeof sourcePath !== "string" ||
            typeof groupId !== "string"
          )
            return [];
          return [
            {
              id,
              sourcePath,
              groupId,
              kind: item["kind"] === "minion-squad" ? "minion-squad" : "creature",
              count: clampInt(item["count"], 1, 99),
              name: asString(item["name"], "Creature"),
              currentStamina: Math.max(0, Number(item["currentStamina"]) || 0),
              maxStamina: Math.max(0, Number(item["maxStamina"]) || 0),
              acted: asBool(item["acted"], false),
              conditions: asStringArray(item["conditions"]),
            },
          ];
        })
      : [];
    const combatState: CombatState = {
      active: asBool(combat["active"], false),
      round: clampInt(combat["round"], 1, 999),
      malice: Math.max(0, Number(combat["malice"]) || 0),
      instances,
      activeGroupFilter:
        typeof combat["activeGroupFilter"] === "string" ? combat["activeGroupFilter"] : null,
      activeEffects: Array.isArray(combat["activeEffects"])
        ? combat["activeEffects"].filter(isRecord).flatMap((effect) => {
            const id = effect["id"];
            const name = effect["name"];
            if (typeof id !== "string" || typeof name !== "string") return [];
            return [
              {
                id,
                name,
                expiresRound: Number(effect["expiresRound"]) || 0,
                sourcePath: asString(effect["sourcePath"], ""),
              },
            ];
          })
        : [],
      selectedMaliceFeatureIds: asStringArray(combat["selectedMaliceFeatureIds"]),
      maliceSelectionInitialized: asBool(combat["maliceSelectionInitialized"], false),
    };
    base.combat = combatState;
  }

  if (isRecord(value["ui"])) {
    const ui = value["ui"];
    const sort = ui["sort"];
    const view = ui["view"];
    const uiState: UIState = {
      view: view === "combat" ? "combat" : "builder",
      role: asString(ui["role"], "all"),
      search: asString(ui["search"], ""),
      maliceDockOpen: asBool(ui["maliceDockOpen"], true),
      maliceLibraryOpen: asBool(ui["maliceLibraryOpen"], false),
      sort: sort === "level" || sort === "ev" ? sort : "name",
      filtersOpen: asBool(ui["filtersOpen"], false),
      roles: asStringArray(ui["roles"]),
      sizes: asStringArray(ui["sizes"]),
      keywords: asStringArray(ui["keywords"]),
      levelMin: asNullableNumber(ui["levelMin"]),
      levelMax: asNullableNumber(ui["levelMax"]),
      evMin: asNullableNumber(ui["evMin"]),
      evMax: asNullableNumber(ui["evMax"]),
    };
    base.ui = uiState;
  }

  ensureIntegrity(base);
  return base;
}

function ensureIntegrity(draft: AppState): void {
  if (!draft.groups.length) draft.groups = [{ id: uid("group"), name: "A" }];
  const firstGroup = draft.groups[0] as Group;
  if (!draft.groups.some((group) => group.id === draft.activePrepGroupId))
    draft.activePrepGroupId = firstGroup.id;
  const validGroupIds = new Set(draft.groups.map((group) => group.id));
  for (const item of draft.encounter) {
    if (!validGroupIds.has(item.groupId)) item.groupId = firstGroup.id;
  }
  for (const instance of draft.combat.instances) {
    if (!validGroupIds.has(instance.groupId)) instance.groupId = firstGroup.id;
  }
  if (draft.combat.activeGroupFilter && !validGroupIds.has(draft.combat.activeGroupFilter)) {
    draft.combat.activeGroupFilter = null;
  }
}

function loadState(): AppState {
  try {
    return sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return defaultState();
  }
}

export const state = signal<AppState>(loadState());

/** Apply a mutation to the app state, persist it, and notify subscribers. */
export function mutate(fn: (draft: AppState) => void): void {
  const draft = state.value;
  fn(draft);
  ensureIntegrity(draft);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Persistence is best-effort; private windows may reject writes.
  }
  state.value = { ...draft };
}

// ---------- Ephemeral (non-persisted) UI state ----------

export const expandedMaliceFeatures = signal<ReadonlySet<string>>(new Set());
export const openConditionPickerFor = signal<string | null>(null);
export const previewPath = signal<string | null>(null);
export const qtyDrafts = signal<ReadonlyMap<string, number>>(new Map());
export const lastRolls = signal<ReadonlyMap<string, PowerRollResult>>(new Map());
export const lastMaliceRolls = signal<ReadonlyMap<string, PowerRollResult>>(new Map());
export const toastState = signal<{ message: string; shown: boolean }>({
  message: "",
  shown: false,
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string): void {
  clearTimeout(toastTimer);
  toastState.value = { message, shown: true };
  toastTimer = setTimeout(() => {
    toastState.value = { message, shown: false };
  }, 1800);
}

export function qtyFor(path: string): number {
  return qtyDrafts.value.get(path) ?? monsterCache.get(path)?.defaultQty ?? 1;
}

export function setQtyDraft(path: string, value: number): void {
  const next = new Map(qtyDrafts.value);
  next.set(path, clampInt(value, 1, 30));
  qtyDrafts.value = next;
}

// ---------- Boot ----------

export async function initApp(): Promise<void> {
  try {
    await loadSourceIndex();
  } catch {
    return; // sourceError signal carries the message; the library renders it
  }
  void hydrateCatalogInBackground();
  void hydrateMaliceInBackground().then(() => {
    expandedMaliceFeatures.value = new Set(maliceFeatures.value.map((feature) => feature.id));
  });
  void hydrateConditionsInBackground();
  void hydrateSavedStateSources();
}

async function hydrateSavedStateSources(): Promise<void> {
  const needed = new Set([
    ...state.value.encounter.map((item) => item.sourcePath),
    ...state.value.combat.instances.map((item) => item.sourcePath),
  ]);
  await Promise.allSettled([...needed].map(loadMonster));
}

export function retrySource(): void {
  void initApp();
}

// ---------- View / party ----------

export function setView(view: ViewName): void {
  mutate((draft) => {
    draft.ui.view = view;
  });
}

export function updateParty(values: {
  heroes: unknown;
  level: unknown;
  victories: unknown;
  bonusMalice: unknown;
}): void {
  mutate((draft) => {
    draft.party.heroes = clampInt(values.heroes, 1, 12);
    draft.party.level = clampInt(values.level, 1, 10);
    draft.party.victories = clampInt(values.victories, 0, 20);
    draft.party.bonusMalice = clampInt(values.bonusMalice, 0, 99);
  });
}

export function resetApp(): void {
  localStorage.removeItem(STORAGE_KEY);
  state.value = defaultState();
  toast("Encounter reset");
}

// ---------- Library filters ----------

export function setSearch(search: string): void {
  mutate((draft) => {
    draft.ui.search = search;
  });
}

export function setRole(role: string): void {
  mutate((draft) => {
    draft.ui.role = role;
  });
}

export function setSort(sort: SortKey): void {
  mutate((draft) => {
    draft.ui.sort = sort;
  });
}

export function toggleFiltersOpen(): void {
  mutate((draft) => {
    draft.ui.filtersOpen = !draft.ui.filtersOpen;
  });
}

export function clearAllFilters(): void {
  mutate((draft) => {
    draft.ui.role = "all";
    draft.ui.roles = [];
    draft.ui.sizes = [];
    draft.ui.keywords = [];
    draft.ui.levelMin = draft.ui.levelMax = draft.ui.evMin = draft.ui.evMax = null;
  });
}

export function toggleFacetValue(key: FacetKey, value: string): void {
  mutate((draft) => {
    const list = draft.ui[key];
    const index = list.indexOf(value);
    if (index === -1) list.push(value);
    else list.splice(index, 1);
  });
}

export function setRangeFilter(key: "level" | "ev", min: number | null, max: number | null): void {
  mutate((draft) => {
    draft.ui[`${key}Min`] = min;
    draft.ui[`${key}Max`] = max;
  });
}

export function activeFilterCount(ui: UIState): number {
  return (ui.role !== "all" ? 1 : 0) + hiddenFilterCount(ui);
}

// Active filters that live inside the collapsible "More" panel (everything
// except Type, which is always visible in the bar).
export function hiddenFilterCount(ui: UIState): number {
  let count = ui.roles.length + ui.sizes.length + ui.keywords.length;
  if (ui.levelMin !== null || ui.levelMax !== null) count += 1;
  if (ui.evMin !== null || ui.evMax !== null) count += 1;
  return count;
}

function monsterMatchesFilters(m: Monster, ui: UIState): boolean {
  if (ui.role !== "all" && normalizeToken(m.organization) !== normalizeToken(ui.role)) return false;
  if (ui.roles.length && !ui.roles.includes(normalizeToken(m.role))) return false;
  if (ui.sizes.length && !ui.sizes.includes(normalizeToken(m.size))) return false;
  if (ui.keywords.length) {
    const owned = new Set(m.keywords.map(normalizeToken));
    if (!ui.keywords.some((keyword) => owned.has(keyword))) return false;
  }
  if (ui.levelMin !== null && m.level < ui.levelMin) return false;
  if (ui.levelMax !== null && m.level > ui.levelMax) return false;
  if (ui.evMin !== null && m.ev < ui.evMin) return false;
  if (ui.evMax !== null && m.ev > ui.evMax) return false;
  return true;
}

export function needsMonsterData(ui: UIState): boolean {
  return (
    ui.role !== "all" ||
    ui.roles.length > 0 ||
    ui.sizes.length > 0 ||
    ui.keywords.length > 0 ||
    ui.levelMin !== null ||
    ui.levelMax !== null ||
    ui.evMin !== null ||
    ui.evMax !== null ||
    ui.sort !== "name"
  );
}

export function filteredCatalog(): CatalogEntry[] {
  void monstersVersion.value; // subscribe: matches change as statblocks hydrate
  const ui = state.value.ui;
  const search = ui.search.trim().toLowerCase();
  const requiresData = needsMonsterData(ui);
  const matches = catalog.value.filter((entry) => {
    if (search && !catalogSearchText(entry).includes(search)) return false;
    if (requiresData) {
      if (!entry.monster) return false;
      if (!monsterMatchesFilters(entry.monster, ui)) return false;
    }
    return true;
  });
  return sortCatalog(matches, ui.sort);
}

function sortCatalog(entries: CatalogEntry[], sort: SortKey): CatalogEntry[] {
  if (sort === "name") return entries;
  const sorted = entries.slice();
  if (sort === "level") {
    sorted.sort(
      (a, b) =>
        (a.monster?.level ?? 0) - (b.monster?.level ?? 0) ||
        a.derivedName.localeCompare(b.derivedName),
    );
  } else {
    sorted.sort(
      (a, b) =>
        (a.monster?.ev ?? 0) - (b.monster?.ev ?? 0) || a.derivedName.localeCompare(b.derivedName),
    );
  }
  return sorted;
}

// ---------- Groups & encounter ----------

function createGroupRecord(draft: AppState): Group {
  const used = new Set(draft.groups.map((group) => group.name.trim().toUpperCase()));
  let name = "";
  for (let code = 65; code <= 90; code += 1) {
    const candidate = String.fromCharCode(code);
    if (!used.has(candidate)) {
      name = candidate;
      break;
    }
  }
  if (!name) name = `Group ${draft.groups.length + 1}`;
  const group: Group = { id: uid("group"), name };
  draft.groups.push(group);
  draft.activePrepGroupId = group.id;
  return group;
}

export function addGroup(): void {
  mutate((draft) => {
    createGroupRecord(draft);
  });
}

export function createGroupForDrop(): Group {
  let created: Group | undefined;
  mutate((draft) => {
    created = createGroupRecord(draft);
  });
  if (!created) throw new Error("group creation failed");
  return created;
}

export function removeGroup(groupId: string): void {
  if (state.value.groups.length === 1) {
    toast("At least one group is required.");
    return;
  }
  mutate((draft) => {
    const remaining = draft.groups.filter((group) => group.id !== groupId);
    const fallback = remaining[0];
    if (!fallback) return;
    draft.groups = remaining;
    draft.encounter.forEach((item) => {
      if (item.groupId === groupId) item.groupId = fallback.id;
    });
    draft.combat.instances.forEach((instance) => {
      if (instance.groupId === groupId) instance.groupId = fallback.id;
    });
    if (draft.activePrepGroupId === groupId) draft.activePrepGroupId = fallback.id;
    if (draft.combat.activeGroupFilter === groupId) draft.combat.activeGroupFilter = null;
  });
}

export function renameGroup(groupId: string, name: string): void {
  mutate((draft) => {
    const group = draft.groups.find((item) => item.id === groupId);
    if (group) group.name = name.trim() || group.name;
  });
}

export function selectPrepGroup(groupId: string): void {
  mutate((draft) => {
    draft.activePrepGroupId = groupId;
  });
}

export async function addToEncounterInGroup(
  sourcePath: string,
  count: number,
  groupId: string,
  { announce = true } = {},
): Promise<boolean> {
  try {
    const monster = await loadMonster(sourcePath);
    mutate((draft) => {
      const targetGroupId = draft.groups.some((group) => group.id === groupId)
        ? groupId
        : draft.activePrepGroupId;
      const amount = Math.max(1, Math.min(30, Number(count) || 1));
      const existing = draft.encounter.find(
        (item) => item.sourcePath === sourcePath && item.groupId === targetGroupId,
      );
      if (existing) existing.count += amount;
      else
        draft.encounter.push({ id: uid("enc"), sourcePath, groupId: targetGroupId, count: amount });
      draft.activePrepGroupId = targetGroupId;
    });
    if (announce) toast(`Added ${Math.max(1, Math.min(30, Number(count) || 1))} × ${monster.name}`);
    return true;
  } catch {
    toast("Could not load that statblock.");
    return false;
  }
}

export async function addToEncounter(sourcePath: string, count: number): Promise<boolean> {
  return addToEncounterInGroup(sourcePath, count, state.value.activePrepGroupId);
}

export function changeEncounterCount(itemId: string, delta: number): void {
  mutate((draft) => {
    const item = draft.encounter.find((entry) => entry.id === itemId);
    if (!item) return;
    item.count += delta;
    if (item.count <= 0) draft.encounter = draft.encounter.filter((entry) => entry.id !== itemId);
  });
}

export function removeEncounterEntry(itemId: string): void {
  mutate((draft) => {
    draft.encounter = draft.encounter.filter((item) => item.id !== itemId);
  });
}

export function moveEncounterEntryToGroup(itemId: string, groupId: string): void {
  mutate((draft) => {
    const item = draft.encounter.find((entry) => entry.id === itemId);
    if (!item || !draft.groups.some((group) => group.id === groupId) || item.groupId === groupId)
      return;
    const existing = draft.encounter.find(
      (entry) =>
        entry.id !== item.id && entry.sourcePath === item.sourcePath && entry.groupId === groupId,
    );
    if (existing) {
      existing.count += item.count;
      draft.encounter = draft.encounter.filter((entry) => entry.id !== item.id);
    } else {
      item.groupId = groupId;
    }
  });
}

export function clearEncounter(): void {
  mutate((draft) => {
    draft.encounter = [];
  });
  toast("Encounter cleared");
}

export interface EncounterTotals {
  count: number;
  ev: number;
}

export function encounterTotals(): EncounterTotals {
  void monstersVersion.value; // subscribe: EV settles as statblocks hydrate
  let count = 0;
  let ev = 0;
  for (const item of state.value.encounter) {
    count += item.count;
    const monster = monsterCache.get(item.sourcePath);
    if (monster) ev += monster.ev * item.count;
  }
  return { count, ev };
}

// ---------- Combat ----------

export async function startCombat(): Promise<void> {
  const encounter = state.value.encounter;
  if (!encounter.length) return;
  const paths = [...new Set(encounter.map((item) => item.sourcePath))];
  const loaded = await Promise.allSettled(paths.map(loadMonster));
  if (loaded.some((result) => result.status === "rejected")) {
    toast("Some SteelCompendium statblocks could not be loaded.");
    return;
  }

  const counters = new Map<string, number>();
  const instances: CombatInstance[] = [];
  for (const entry of encounter) {
    const m = monsterCache.get(entry.sourcePath);
    if (!m) continue;
    if (m.organization.toLowerCase() === "minion") {
      const current = (counters.get(entry.sourcePath) || 0) + 1;
      counters.set(entry.sourcePath, current);
      instances.push({
        id: uid("enemy"),
        sourcePath: entry.sourcePath,
        groupId: entry.groupId,
        kind: "minion-squad",
        count: entry.count,
        name: `${m.name} Squad${current > 1 ? ` ${current}` : ""}`,
        currentStamina: m.stamina * entry.count,
        maxStamina: m.stamina * entry.count,
        acted: false,
        conditions: [],
      });
    } else {
      for (let index = 0; index < entry.count; index += 1) {
        const current = (counters.get(entry.sourcePath) || 0) + 1;
        counters.set(entry.sourcePath, current);
        instances.push({
          id: uid("enemy"),
          sourcePath: entry.sourcePath,
          groupId: entry.groupId,
          kind: "creature",
          count: 1,
          name: `${m.name}${current > 1 ? ` ${current}` : ""}`,
          currentStamina: m.stamina,
          maxStamina: m.stamina,
          acted: false,
          conditions: [],
        });
      }
    }
  }

  mutate((draft) => {
    draft.combat = {
      active: true,
      round: 1,
      malice: partyMath(draft.party).roundOne,
      instances,
      activeGroupFilter: null,
      activeEffects: [],
      selectedMaliceFeatureIds: [],
      maliceSelectionInitialized: false,
    };
    draft.ui.view = "combat";
  });
  toast(`Combat started · ${state.value.combat.malice} Malice`);
}

export function nextRound(): void {
  if (!state.value.combat.instances.length) return;
  mutate((draft) => {
    const endingRound = draft.combat.round;
    draft.combat.activeEffects = draft.combat.activeEffects.filter(
      (effect) => effect.expiresRound > endingRound,
    );
    draft.combat.round += 1;
    draft.combat.malice += draft.party.heroes + draft.combat.round;
    draft.combat.instances.forEach((instance) => {
      instance.acted = false;
    });
  });
  const combat = state.value.combat;
  toast(`Round ${combat.round} · +${state.value.party.heroes + combat.round} Malice`);
}

/**
 * Undo an accidental {@link nextRound}: step back one round and remove the Malice
 * that advancing into the current round granted (heroes + currentRound). Effects that
 * `nextRound` expired can't be recovered, so this is a best-effort misclick undo.
 */
export function previousRound(): void {
  if (state.value.combat.round <= 1) return;
  mutate((draft) => {
    const undoneGain = draft.party.heroes + draft.combat.round;
    draft.combat.malice = Math.max(0, draft.combat.malice - undoneGain);
    draft.combat.round -= 1;
    draft.combat.instances.forEach((instance) => {
      instance.acted = false;
    });
  });
  const combat = state.value.combat;
  toast(`Round ${combat.round} · −${state.value.party.heroes + (combat.round + 1)} Malice`);
}

export function adjustMalice(delta: number): void {
  mutate((draft) => {
    draft.combat.malice = Math.max(0, draft.combat.malice + delta);
  });
}

export function setGroupFilter(groupId: string | null): void {
  mutate((draft) => {
    draft.combat.activeGroupFilter = draft.combat.activeGroupFilter === groupId ? null : groupId;
  });
}

export function toggleActed(instanceId: string): void {
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (instance) instance.acted = !instance.acted;
  });
}

export function removeInstance(instanceId: string): void {
  mutate((draft) => {
    draft.combat.instances = draft.combat.instances.filter((item) => item.id !== instanceId);
  });
}

export function renameInstance(instanceId: string, name: string): void {
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (instance) instance.name = name.trim() || instance.name;
  });
}

export function setInstanceGroup(instanceId: string, groupId: string): void {
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (instance) instance.groupId = groupId;
  });
}

export function applyStaminaCommand(instanceId: string, rawValue: string): void {
  const raw = rawValue.trim();
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (!instance) return;
    let next: number;
    if (/^[+-]\s*\d+(?:\.\d+)?$/.test(raw))
      next = instance.currentStamina + Number(raw.replace(/\s/g, ""));
    else if (/^\d+(?:\.\d+)?$/.test(raw)) next = Number(raw);
    else return;
    instance.currentStamina = Math.max(0, Math.round(next));
  });
}

export function toggleConditionPicker(instanceId: string): void {
  openConditionPickerFor.value = openConditionPickerFor.value === instanceId ? null : instanceId;
}

export function addCondition(instanceId: string, condition: string): void {
  openConditionPickerFor.value = null;
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (instance) instance.conditions = [...new Set([...instance.conditions, condition])];
  });
}

export function removeCondition(instanceId: string, condition: string): void {
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (instance) instance.conditions = instance.conditions.filter((item) => item !== condition);
  });
}

export function removeActiveEffect(effectId: string): void {
  mutate((draft) => {
    draft.combat.activeEffects = draft.combat.activeEffects.filter(
      (effect) => effect.id !== effectId,
    );
  });
}

export function groupInstancesByMonster(): [string, CombatInstance[]][] {
  const map = new Map<string, CombatInstance[]>();
  for (const instance of state.value.combat.instances) {
    const list = map.get(instance.sourcePath);
    if (list) list.push(instance);
    else map.set(instance.sourcePath, [instance]);
  }
  return [...map.entries()];
}

// ---------- Rolls ----------

export function rollFeature(monsterPath: string, featureIndex: number, effectIndex: number): void {
  const m = monsterCache.get(monsterPath);
  const effect = m?.features[featureIndex]?.effects?.[effectIndex];
  if (!m || !effect?.roll) return;
  const next = new Map(lastRolls.value);
  next.set(`${m.id}|${featureIndex}|${effectIndex}`, makePowerRoll(effect.roll, m));
  lastRolls.value = next;
}

export function rollMaliceFeature(featureId: string, effectIndex: number): void {
  const feature = maliceFeatures.value.find((item) => item.id === featureId);
  const effect = feature?.effects[effectIndex];
  if (!feature || !effect || !(effect.tier1 || effect.tier2 || effect.tier3)) return;
  const next = new Map(lastMaliceRolls.value);
  next.set(`${feature.id}|${effectIndex}`, makePowerRoll(effect.roll || "Power Roll"));
  lastMaliceRolls.value = next;
}

// ---------- Malice selection ----------

interface FamilyInfo {
  family: string;
  label: string;
  maxLevel: number;
}

function activeMonsterFamilies(): Map<string, FamilyInfo> {
  void monstersVersion.value; // subscribe: families settle as statblocks hydrate
  const families = new Map<string, FamilyInfo>();
  for (const instance of state.value.combat.instances) {
    const monster = monsterCache.get(instance.sourcePath);
    if (!monster) continue;
    const family = monster.familyPath.toLowerCase().split("/").filter(Boolean)[0];
    if (!family) continue;
    const current = families.get(family) || {
      family,
      label: familyDisplayLabel(family),
      maxLevel: 0,
    };
    current.maxLevel = Math.max(current.maxLevel, monster.level);
    families.set(family, current);
  }
  return families;
}

function familyDisplayLabel(family: string): string {
  return family
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function relevantMaliceGroups(): MaliceGroup[] {
  if (!state.value.combat.instances.length) return [];
  const groups: MaliceGroup[] = [];
  const features = maliceFeatures.value;
  const basic = dedupeMaliceFeatures(
    features.filter((feature) => feature.scope === "basic" && !isPriorMaliceGateway(feature)),
  ).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  if (basic.length)
    groups.push({ id: "basic", label: "Basic", subtitle: "All monsters", features: basic });

  const activeFamilies = activeMonsterFamilies();
  for (const familyInfo of [...activeFamilies.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  )) {
    const available = features.filter(
      (feature) =>
        feature.scope === "family" &&
        feature.family === familyInfo.family &&
        feature.minLevel <= familyInfo.maxLevel &&
        !isPriorMaliceGateway(feature),
    );
    const groupFeatures = dedupeMaliceFeatures(available).sort(
      (a, b) => a.cost - b.cost || a.name.localeCompare(b.name),
    );
    if (!groupFeatures.length) continue;
    groups.push({
      id: familyInfo.family,
      label: familyInfo.label,
      subtitle: `Available through level ${familyInfo.maxLevel}`,
      features: groupFeatures,
    });
  }
  return groups;
}

export function allRelevantMaliceFeatures(groups: MaliceGroup[]): MaliceFeature[] {
  const seen = new Set<string>();
  const values: MaliceFeature[] = [];
  for (const group of groups) {
    for (const feature of group.features) {
      if (seen.has(feature.id)) continue;
      seen.add(feature.id);
      values.push(feature);
    }
  }
  return values;
}

export function suggestedMaliceFeatureIds(groups: MaliceGroup[]): string[] {
  const all = allRelevantMaliceFeatures(groups);
  if (!all.length) return [];

  const selected: MaliceFeature[] = [];
  const selectedIds = new Set<string>();
  const familyGroups = groups.filter((group) => group.id !== "basic");
  const targetCount = familyGroups.length > 1 ? 4 : 3;

  const ordered = [...all].sort((a, b) => {
    const scopeDelta = (a.scope === "family" ? 0 : 1) - (b.scope === "family" ? 0 : 1);
    return scopeDelta || a.cost - b.cost || a.name.localeCompare(b.name);
  });

  const addBest = (candidates: MaliceFeature[]): boolean => {
    const feature = candidates.find((item) => !selectedIds.has(item.id));
    if (!feature) return false;
    selected.push(feature);
    selectedIds.add(feature.id);
    return true;
  };

  addBest(ordered.filter((feature) => feature.cost >= 2 && feature.cost <= 3));
  addBest(ordered.filter((feature) => feature.cost >= 4 && feature.cost <= 6));
  addBest(ordered.filter((feature) => feature.cost >= 7));

  if (targetCount > selected.length) {
    const representedFamilies = new Set(
      selected.filter((feature) => feature.scope === "family").map((feature) => feature.family),
    );
    for (const group of familyGroups) {
      if (selected.length >= targetCount) break;
      if (representedFamilies.has(group.id)) continue;
      if (addBest(group.features)) representedFamilies.add(group.id);
    }
  }

  while (selected.length < targetCount && addBest(ordered)) {
    // Fill any missing band from the remaining encounter-relevant options.
  }

  return selected.slice(0, targetCount).map((feature) => feature.id);
}

/**
 * Keep the persisted malice selection consistent with what's available:
 * initialize with the suggested set once data arrives, and drop ids that are
 * no longer relevant. No-op until malice data is loaded.
 */
export function ensureMaliceSelection(groups: MaliceGroup[]): void {
  if (maliceLoading.value || !groups.length) return;
  const availableIds = new Set(allRelevantMaliceFeatures(groups).map((feature) => feature.id));
  const current = state.value.combat.selectedMaliceFeatureIds;
  const filtered = current.filter((id) => availableIds.has(id));

  if (!state.value.combat.maliceSelectionInitialized && availableIds.size) {
    const suggested = suggestedMaliceFeatureIds(groups);
    mutate((draft) => {
      draft.combat.selectedMaliceFeatureIds = suggested;
      draft.combat.maliceSelectionInitialized = true;
    });
    expandedMaliceFeatures.value = new Set([...expandedMaliceFeatures.value, ...suggested]);
    return;
  }

  if (filtered.length !== current.length) {
    mutate((draft) => {
      draft.combat.selectedMaliceFeatureIds = filtered;
    });
  }
}

export function autoPickMalice(): void {
  const groups = relevantMaliceGroups();
  const suggested = suggestedMaliceFeatureIds(groups);
  mutate((draft) => {
    draft.combat.selectedMaliceFeatureIds = suggested;
    draft.combat.maliceSelectionInitialized = true;
  });
  expandedMaliceFeatures.value = new Set([...expandedMaliceFeatures.value, ...suggested]);
  toast(`${suggested.length} Malice features selected`);
}

export function addMaliceSelection(featureId: string): void {
  mutate((draft) => {
    if (!draft.combat.selectedMaliceFeatureIds.includes(featureId))
      draft.combat.selectedMaliceFeatureIds.push(featureId);
    draft.combat.maliceSelectionInitialized = true;
  });
  expandedMaliceFeatures.value = new Set([...expandedMaliceFeatures.value, featureId]);
}

export function removeMaliceSelection(featureId: string): void {
  mutate((draft) => {
    draft.combat.selectedMaliceFeatureIds = draft.combat.selectedMaliceFeatureIds.filter(
      (id) => id !== featureId,
    );
    draft.combat.maliceSelectionInitialized = true;
  });
}

export function toggleMaliceExpanded(featureId: string): void {
  const next = new Set(expandedMaliceFeatures.value);
  if (next.has(featureId)) next.delete(featureId);
  else next.add(featureId);
  expandedMaliceFeatures.value = next;
}

export function toggleMaliceLibrary(): void {
  mutate((draft) => {
    draft.ui.maliceLibraryOpen = !draft.ui.maliceLibraryOpen;
  });
}

export function toggleMaliceDock(): void {
  mutate((draft) => {
    draft.ui.maliceDockOpen = !draft.ui.maliceDockOpen;
  });
}

export function useMaliceFeature(featureId: string): void {
  const feature = maliceFeatures.value.find((item) => item.id === featureId);
  if (!feature) return;
  if (feature.cost > state.value.combat.malice) {
    toast(`Need ${feature.cost} Malice.`);
    return;
  }
  mutate((draft) => {
    draft.combat.malice -= feature.cost;
    const text = featureText(feature).toLowerCase();
    if (
      text.includes("until the end of the round") ||
      text.includes("until end of the round") ||
      feature.name.toLowerCase() === "goblin mode"
    ) {
      const existing = draft.combat.activeEffects.find(
        (effect) => effect.name.toLowerCase() === feature.name.toLowerCase(),
      );
      if (!existing) {
        draft.combat.activeEffects.push({
          id: uid("effect"),
          name: feature.name,
          expiresRound: draft.combat.round,
          sourcePath: feature.path,
        });
      }
    }
  });
  toast(`${feature.name} · −${feature.cost} Malice`);
}

export function spendAbilityMalice(cost: number, name: string): void {
  if (cost > state.value.combat.malice) {
    toast(`Need ${cost} Malice.`);
    return;
  }
  mutate((draft) => {
    draft.combat.malice -= cost;
  });
  toast(`${name} · −${cost} Malice`);
}

// ---------- Preview drawer ----------

export function openPreview(path: string): void {
  previewPath.value = path;
  if (!monsterCache.has(path)) {
    loadMonster(path).catch(() => {
      // A failed load leaves the drawer showing its error state.
      if (previewPath.value === path) monstersVersion.value += 1;
    });
  }
}

export function closePreview(): void {
  previewPath.value = null;
}
