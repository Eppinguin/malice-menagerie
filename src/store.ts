import { effect, signal } from "@preact/signals";
import { clampInt, normalizeToken, uid } from "./lib/text.ts";
import {
  clickEdgeOverride,
  makeCharacteristicRoll,
  makePowerRoll,
  partyMath,
} from "./lib/rules.ts";
import type { CharacteristicKey } from "./lib/rules.ts";
import { dedupeMaliceFeatures, featureText, isPriorMaliceGateway } from "./lib/malice.ts";
import { isDazed } from "./lib/conditions.ts";
import { planSummon, squadRules, type SquadRules } from "./lib/summons.ts";
import {
  canCaptain,
  captainStaminaBonus,
  defaultSquads,
  isMinion,
  minionStamina,
  resizeSquad,
  SQUAD_MAX,
  squadSizes,
  standing,
} from "./lib/minions.ts";
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
  EdgeState,
  Encounter,
  EncounterItem,
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

export const STORAGE_KEY = "steel-table-v7";
export const MAX_LIBRARY_RESULTS = 120;

// ---------- State construction, sanitizing, persistence ----------

function defaultCombat(): CombatState {
  return {
    active: false,
    round: 1,
    malice: 0,
    instances: [],
    activeGroupFilter: null,
    activeEffects: [],
    selectedMaliceFeatureIds: [],
    maliceSelectionInitialized: false,
  };
}

function newEncounter(name = "Untitled encounter"): Encounter {
  return {
    id: uid("enc"),
    name,
    updatedAt: Date.now(),
    view: "builder",
    party: { heroes: 5, level: 1, victories: 0, bonusMalice: 0 },
    groups: [
      { id: uid("group"), name: "A" },
      { id: uid("group"), name: "B" },
    ],
    activePrepGroupId: "",
    items: [],
    combat: defaultCombat(),
  };
}

function defaultState(): AppState {
  const first = newEncounter("New encounter");
  first.activePrepGroupId = (first.groups[0] as Group).id;
  return {
    encounters: [first],
    activeEncounterId: first.id,
    ui: {
      role: "all",
      search: "",
      maliceDockOpen: maliceDockDefault(),
      watchOpen: maliceDockDefault(),
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
    },
  };
}

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;
/** On phones the Malice strip starts closed so the first screen shows a statblock. */
const maliceDockDefault = (): boolean =>
  typeof window === "undefined" || !window.matchMedia?.("(max-width: 620px)").matches;

export const MAX_TURNS = 9;

/** Turns and turns taken, reading the older single `acted` flag when that is
    all a saved encounter has. */
function restoreTurns(item: Record<string, unknown>): { turns: number; turnsTaken: number } {
  const turns = clampInt(item["turns"] ?? 1, 1, MAX_TURNS);
  const taken = item["turnsTaken"] ?? (item["acted"] === true ? turns : 0);
  return { turns, turnsTaken: clampInt(taken, 0, turns) };
}

function restoreReactions(value: unknown): CombatInstance["reactions"] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((item) =>
    typeof item["name"] === "string" ? [{ name: item["name"], malice: clampInt(item["malice"] ?? 0, 0, 99) }] : [],
  );
}

const asBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const asNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Rebuild one guaranteed-valid Encounter from whatever was persisted. */
function sanitizeEncounter(value: unknown, index: number): Encounter {
  const base = newEncounter(`Encounter ${index + 1}`);
  if (!isRecord(value)) {
    base.activePrepGroupId = (base.groups[0] as Group).id;
    return base;
  }

  base.id = asString(value["id"], base.id);
  base.name = asString(value["name"], base.name).trim() || base.name;
  base.updatedAt = Number(value["updatedAt"]) || base.updatedAt;
  base.view = value["view"] === "combat" ? "combat" : "builder";

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
  base.activePrepGroupId = asString(value["activePrepGroupId"], (base.groups[0] as Group).id);

  // `items` is the new field name; `encounter` is the legacy v6 field name.
  const rawItems = Array.isArray(value["items"])
    ? value["items"]
    : Array.isArray(value["encounter"])
      ? value["encounter"]
      : [];
  base.items = rawItems.filter(isRecord).flatMap((item) => {
    const id = item["id"];
    const sourcePath = item["sourcePath"];
    const groupId = item["groupId"];
    if (typeof id !== "string" || typeof sourcePath !== "string" || typeof groupId !== "string")
      return [];
    const count = clampInt(item["count"], 1, 99);
    const entry: EncounterItem = { id, sourcePath, groupId, count };
    if (item["squad"] === true) {
      entry.squad = true;
    }
    const squads = item["squads"];
    if (Array.isArray(squads) && squads.every((size) => Number.isInteger(size) && size >= 1)) {
      entry.squads = squads as number[];
    }
    return [entry];
  });

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
              ...(typeof item["entryId"] === "string" ? { entryId: item["entryId"] } : {}),
              kind: item["kind"] === "minion-squad" ? "minion-squad" : "creature",
              count: clampInt(item["count"], 1, 99),
              name: asString(item["name"], "Creature"),
              currentStamina: Math.max(0, Number(item["currentStamina"]) || 0),
              maxStamina: Math.max(0, Number(item["maxStamina"]) || 0),
              ...restoreTurns(item),
              conditions: asStringArray(item["conditions"]),
              reactions: restoreReactions(item["reactions"]),
              villainRounds: [0, 1, 2].map((i) =>
                Array.isArray(item["villainRounds"]) ? clampInt(item["villainRounds"][i] ?? 0, 0, 999) : 0,
              ),
              ...(typeof item["captainId"] === "string" ? { captainId: item["captainId"] } : {}),
              ...(typeof item["summonedBy"] === "string" ? { summonedBy: item["summonedBy"] } : {}),
            },
          ];
        })
      : [];
    base.combat = {
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
  }

  linkInstances(base);
  normalizeEntries(base);
  return base;
}

/** Tie saves from before instances knew their entry to one: each entry takes
    the instances of its monster and group in order, as many as it holds (one
    per squad, one per creature). */
function linkInstances(enc: Encounter): void {
  const ids = new Set(enc.items.map((item) => item.id));
  const taken = new Map<string, number>();
  for (const instance of enc.combat.instances) {
    if (instance.summonedBy !== undefined) continue;
    if (instance.entryId && ids.has(instance.entryId)) continue;
    delete instance.entryId;
    const entry = enc.items.find((item) => {
      if (item.sourcePath !== instance.sourcePath || item.groupId !== instance.groupId) return false;
      return (taken.get(item.id) ?? 0) < (item.squad ? 1 : item.count);
    });
    if (!entry) continue;
    instance.entryId = entry.id;
    taken.set(entry.id, (taken.get(entry.id) ?? 0) + 1);
  }
}

/**
 * Deal older whole-roster minion entries ("8 goblins, as 4 + 4") into one
 * entry per squad, each linked to its squad on the board. Minion-ness needs
 * the statblock, so entries without a saved split wait until it loads.
 * Returns whether anything changed.
 */
function normalizeEntries(enc: Encounter): boolean {
  let changed = false;
  enc.items = enc.items.flatMap((item) => {
    if (item.squad) return [item];
    const m = monsterCache.get(item.sourcePath);
    if (!item.squads?.length && !(m && isMinion(m))) return [item];
    changed = true;
    const sizes = squadSizes(item);
    const entries = sizes.map((size, i): EncounterItem => ({
      id: i ? uid("enc") : item.id,
      sourcePath: item.sourcePath,
      groupId: item.groupId,
      count: size,
      squad: true,
    }));
    enc.combat.instances
      .filter((instance) => instance.entryId === item.id)
      .forEach((instance, i) => {
        const entry = entries[i];
        if (entry) instance.entryId = entry.id;
      });
    return entries;
  });
  return changed;
}

/** Rebuild a guaranteed-valid AppState from whatever was persisted. */
function sanitizeState(value: unknown): AppState {
  const base = defaultState();
  if (!isRecord(value)) return base;

  // New shape: a library of encounters. Legacy v6 shape: a single encounter
  // stored flat at the top level (party/groups/encounter/combat).
  const rawEncounters = Array.isArray(value["encounters"])
    ? value["encounters"]
    : "party" in value || "encounter" in value || "combat" in value
      ? [value]
      : [];
  const encounters = rawEncounters.map((raw, index) => sanitizeEncounter(raw, index));
  if (encounters.length) {
    base.encounters = encounters;
    base.activeEncounterId = asString(
      value["activeEncounterId"],
      (encounters[0] as Encounter).id,
    );
  }

  // Legacy migration: `view` used to be a single global `ui.view`. Seed the
  // active encounter's per-encounter view from it when the encounter record
  // itself didn't carry one.
  const legacyView = isRecord(value["ui"]) ? value["ui"]["view"] : undefined;
  if (legacyView === "combat" || legacyView === "builder") {
    const active = base.encounters.find((enc) => enc.id === base.activeEncounterId);
    const activeRaw = rawEncounters.find(
      (raw): raw is Record<string, unknown> => isRecord(raw) && raw["id"] === active?.id,
    );
    if (active && activeRaw && !("view" in activeRaw)) active.view = legacyView;
  }

  if (isRecord(value["ui"])) {
    const ui = value["ui"];
    const sort = ui["sort"];
    base.ui = {
      role: asString(ui["role"], "all"),
      search: asString(ui["search"], ""),
      maliceDockOpen: asBool(ui["maliceDockOpen"], maliceDockDefault()),
      watchOpen: asBool(ui["watchOpen"], maliceDockDefault()),
      maliceLibraryOpen: asBool(ui["maliceLibraryOpen"], false),
      sort: sort === "level" || sort === "ev" ? sort : "name",
      filtersOpen: asBool(ui["filtersOpen"], false),
      sidebarCollapsed: asBool(ui["sidebarCollapsed"], false),
      roles: asStringArray(ui["roles"]),
      sizes: asStringArray(ui["sizes"]),
      keywords: asStringArray(ui["keywords"]),
      levelMin: asNullableNumber(ui["levelMin"]),
      levelMax: asNullableNumber(ui["levelMax"]),
      evMin: asNullableNumber(ui["evMin"]),
      evMax: asNullableNumber(ui["evMax"]),
    };
  }

  ensureIntegrity(base);
  return base;
}

/** Keep an encounter's internal references (group ids) self-consistent. */
function ensureEncounterIntegrity(enc: Encounter): void {
  if (!enc.groups.length) enc.groups = [{ id: uid("group"), name: "A" }];
  const firstGroup = enc.groups[0] as Group;
  if (!enc.groups.some((group) => group.id === enc.activePrepGroupId))
    enc.activePrepGroupId = firstGroup.id;
  const validGroupIds = new Set(enc.groups.map((group) => group.id));
  for (const item of enc.items) {
    if (!validGroupIds.has(item.groupId)) item.groupId = firstGroup.id;
  }
  for (const instance of enc.combat.instances) {
    if (!validGroupIds.has(instance.groupId)) instance.groupId = firstGroup.id;
  }
  if (enc.combat.activeGroupFilter && !validGroupIds.has(enc.combat.activeGroupFilter)) {
    enc.combat.activeGroupFilter = null;
  }
}

function ensureIntegrity(draft: AppState): void {
  if (!draft.encounters.length) {
    const fresh = newEncounter("New encounter");
    fresh.activePrepGroupId = (fresh.groups[0] as Group).id;
    draft.encounters = [fresh];
  }
  if (!draft.encounters.some((enc) => enc.id === draft.activeEncounterId))
    draft.activeEncounterId = (draft.encounters[0] as Encounter).id;
  for (const enc of draft.encounters) ensureEncounterIntegrity(enc);
}

function loadState(): AppState {
  try {
    return sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return defaultState();
  }
}

export const state = signal<AppState>(loadState());

// Older minion entries become one entry per squad as their statblocks load.
effect(() => {
  void monstersVersion.value;
  const legacy = (item: EncounterItem) => {
    const m = monsterCache.get(item.sourcePath);
    return !item.squad && !!m && isMinion(m);
  };
  if (state.peek().encounters.some((enc) => enc.items.some(legacy)))
    queueMicrotask(() => {
      const changed = state.peek().encounters.map(normalizeEntries).some(Boolean);
      if (changed) mutateApp(() => {});
    });
});

/** The currently active encounter document. */
export function activeEncounter(): Encounter {
  const { encounters, activeEncounterId } = state.value;
  return encounters.find((enc) => enc.id === activeEncounterId) ?? (encounters[0] as Encounter);
}

/**
 * A flat view over the active encounter + global UI, matching the field layout
 * mutations were originally written against (`draft.party`, `draft.encounter`,
 * `draft.combat`, `draft.ui`, …). Reads and writes pass straight through to the
 * underlying active encounter, so existing mutation bodies work unchanged.
 */
export interface MutableDraft {
  view: ViewName;
  party: AppState["encounters"][number]["party"];
  groups: AppState["encounters"][number]["groups"];
  activePrepGroupId: string;
  encounter: AppState["encounters"][number]["items"];
  combat: CombatState;
  ui: UIState;
}

function draftView(app: AppState, enc: Encounter): MutableDraft {
  return {
    get view() {
      return enc.view;
    },
    set view(value) {
      enc.view = value;
    },
    get party() {
      return enc.party;
    },
    set party(value) {
      enc.party = value;
    },
    get groups() {
      return enc.groups;
    },
    set groups(value) {
      enc.groups = value;
    },
    get activePrepGroupId() {
      return enc.activePrepGroupId;
    },
    set activePrepGroupId(value) {
      enc.activePrepGroupId = value;
    },
    get encounter() {
      return enc.items;
    },
    set encounter(value) {
      enc.items = value;
    },
    get combat() {
      return enc.combat;
    },
    set combat(value) {
      enc.combat = value;
    },
    get ui() {
      return app.ui;
    },
    set ui(value) {
      app.ui = value;
    },
  };
}

/**
 * Apply a mutation against the active encounter (and global UI), stamp its
 * updated-at time, persist, and notify subscribers.
 */
export function mutate(fn: (draft: MutableDraft) => void): void {
  const app = state.value;
  const enc = activeEncounter();
  fn(draftView(app, enc));
  enc.updatedAt = Date.now();
  ensureIntegrity(app);
  persist(app);
  state.value = { ...app };
}

/** Apply a mutation to the whole app state (encounter library, active id). */
export function mutateApp(fn: (draft: AppState) => void): void {
  const app = state.value;
  fn(app);
  ensureIntegrity(app);
  persist(app);
  state.value = { ...app };
}

function persist(app: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app));
  } catch {
    // Persistence is best-effort; private windows may reject writes.
  }
}

// ---------- Ephemeral (non-persisted) UI state ----------

/** Whether the off-canvas mobile navigation drawer is open. Ephemeral. */
export const mobileNavOpen = signal<boolean>(false);

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
  const needed = new Set<string>();
  for (const enc of state.value.encounters) {
    for (const item of enc.items) needed.add(item.sourcePath);
    for (const instance of enc.combat.instances) needed.add(instance.sourcePath);
  }
  await Promise.allSettled([...needed].map(loadMonster));
}

export function retrySource(): void {
  void initApp();
}

// ---------- View / party ----------

export function setView(view: ViewName): void {
  mutate((draft) => {
    draft.view = view;
  });
}

/** Collapse/expand the desktop sidebar (persisted preference). */
export function toggleSidebar(): void {
  mutate((draft) => {
    draft.ui.sidebarCollapsed = !draft.ui.sidebarCollapsed;
  });
}

export function setMobileNav(open: boolean): void {
  mobileNavOpen.value = open;
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

// ---------- Encounter library ----------

/** A concise, unique default name for a freshly created encounter. */
function defaultEncounterName(existing: Encounter[]): string {
  const used = new Set(existing.map((enc) => enc.name.trim().toLowerCase()));
  for (let n = existing.length + 1; ; n += 1) {
    const candidate = `Encounter ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Create a fresh empty encounter, make it active, and switch to Prep. */
export function createEncounter(): string {
  let newId = "";
  mutateApp((draft) => {
    const enc = newEncounter(defaultEncounterName(draft.encounters));
    enc.activePrepGroupId = (enc.groups[0] as Group).id;
    draft.encounters.push(enc);
    draft.activeEncounterId = enc.id;
    newId = enc.id;
  });
  toast("New encounter");
  return newId;
}

/** Switch the active encounter. Each encounter restores its own last view. */
export function selectEncounter(encounterId: string): void {
  if (state.value.activeEncounterId === encounterId) return;
  mutateApp((draft) => {
    if (!draft.encounters.some((enc) => enc.id === encounterId)) return;
    draft.activeEncounterId = encounterId;
  });
  void hydrateSavedStateSources();
}

export function renameEncounter(encounterId: string, name: string): void {
  mutateApp((draft) => {
    const enc = draft.encounters.find((item) => item.id === encounterId);
    if (enc) {
      enc.name = name.trim() || enc.name;
      enc.updatedAt = Date.now();
    }
  });
}

/** Deep-copy an encounter under a new id and make the copy active. */
export function duplicateEncounter(encounterId: string): void {
  mutateApp((draft) => {
    const source = draft.encounters.find((item) => item.id === encounterId);
    if (!source) return;
    const copy: Encounter = structuredClone(source);
    copy.id = uid("enc");
    copy.name = `${source.name} (copy)`;
    copy.updatedAt = Date.now();
    const index = draft.encounters.indexOf(source);
    draft.encounters.splice(index + 1, 0, copy);
    draft.activeEncounterId = copy.id;
  });
  toast("Encounter duplicated");
}

export function deleteEncounter(encounterId: string): void {
  if (state.value.encounters.length === 1) {
    toast("At least one encounter is required.");
    return;
  }
  mutateApp((draft) => {
    const index = draft.encounters.findIndex((item) => item.id === encounterId);
    if (index === -1) return;
    draft.encounters.splice(index, 1);
    if (draft.activeEncounterId === encounterId) {
      const fallback = draft.encounters[Math.max(0, index - 1)] as Encounter;
      draft.activeEncounterId = fallback.id;
    }
  });
  toast("Encounter deleted");
}

/** Clear the active encounter back to empty (party params preserved). */
export function resetActiveEncounter(): void {
  mutate((draft) => {
    draft.groups = [
      { id: uid("group"), name: "A" },
      { id: uid("group"), name: "B" },
    ];
    draft.activePrepGroupId = (draft.groups[0] as Group).id;
    draft.encounter = [];
    draft.combat = defaultCombat();
    draft.view = "builder";
  });
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

function createGroupRecord(draft: MutableDraft): Group {
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
  if (activeEncounter().groups.length === 1) {
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
      if (isMinion(monster)) {
        // Minions arrive as squads of their own, four to a squad.
        for (const size of defaultSquads(amount))
          draft.encounter.push({ id: uid("enc"), sourcePath, groupId: targetGroupId, count: size, squad: true });
      } else {
        const existing = draft.encounter.find(
          (item) => item.sourcePath === sourcePath && item.groupId === targetGroupId,
        );
        if (existing) existing.count += amount;
        else draft.encounter.push({ id: uid("enc"), sourcePath, groupId: targetGroupId, count: amount });
      }
      draft.activePrepGroupId = targetGroupId;
    });
    reconcileCombat();
    if (announce) toast(`Added ${Math.max(1, Math.min(30, Number(count) || 1))} × ${monster.name}`);
    return true;
  } catch {
    toast("Could not load that statblock.");
    return false;
  }
}

export async function addToEncounter(sourcePath: string, count: number): Promise<boolean> {
  return addToEncounterInGroup(sourcePath, count, activeEncounter().activePrepGroupId);
}

/** Step an entry's count; an entry stepped to nothing leaves the roster.
    Squads may pass the book's eight (the roster hints at it). */
export function changeEncounterCount(itemId: string, delta: number): void {
  mutate((draft) => {
    const item = draft.encounter.find((entry) => entry.id === itemId);
    if (!item) return;
    const next = item.count + delta;
    if (next <= 0) {
      draft.encounter = draft.encounter.filter((entry) => entry.id !== itemId);
      return;
    }
    item.count = next;
  });
  reconcileCombat();
}

/** The entry a peel just made, marked for a moment so the eye finds it. */
export const freshEntry = signal<string | null>(null);

function markFresh(id: string): void {
  freshEntry.value = id;
  setTimeout(() => {
    if (freshEntry.peek() === id) freshEntry.value = null;
  }, 1200);
}

/** Whether `amount` can be taken off an entry now, leaving some behind: a
    squad on the board can't give any up, since its wounds can't be divided
    fairly. */
export function canPeelEntry(item: EncounterItem, amount = 1): boolean {
  if (item.count <= amount) return false;
  return !(item.squad && activeEncounter().combat.active);
}

/**
 * Take `amount` off an entry and put it in `groupId`: creatures join an entry
 * of their monster already there, minions form a new squad. On the board the
 * newest creatures go, wounds and all.
 */
export function peelToGroup(itemId: string, groupId: string, amount = 1): void {
  const item = activeEncounter().items.find((entry) => entry.id === itemId);
  if (!item || !canPeelEntry(item, amount)) return;
  const id = uid("enc");
  let landed = id;
  mutate((draft) => {
    const source = draft.encounter.find((entry) => entry.id === itemId);
    if (!source || !draft.groups.some((group) => group.id === groupId)) return;
    source.count -= amount;
    const moving = draft.combat.instances.filter((each) => each.entryId === itemId).slice(-amount);
    const join = source.squad
      ? undefined
      : draft.encounter.find(
          (entry) =>
            entry.id !== source.id &&
            !entry.squad &&
            entry.sourcePath === source.sourcePath &&
            entry.groupId === groupId,
        );
    if (join) {
      join.count += amount;
      landed = join.id;
    } else {
      const peeled: EncounterItem = { id, sourcePath: source.sourcePath, groupId, count: amount };
      if (source.squad) peeled.squad = true;
      // Next to its stack when it stays in the group, at the end of a new one.
      if (groupId === source.groupId) draft.encounter.splice(draft.encounter.indexOf(source) + 1, 0, peeled);
      else draft.encounter.push(peeled);
    }
    for (const instance of moving) {
      instance.entryId = landed;
      instance.groupId = groupId;
    }
  });
  reconcileCombat();
  markFresh(landed);
}

/** Whether minions can move from squad `fromId` into squad `toId`: two
    squads of the same minion, before the fight. */
export function canTransferMinions(fromId: string, toId: string): boolean {
  const { items, combat } = activeEncounter();
  const from = items.find((entry) => entry.id === fromId);
  const to = items.find((entry) => entry.id === toId);
  return Boolean(
    from?.squad && to?.squad && from.id !== to.id && !combat.active && from.sourcePath === to.sourcePath,
  );
}

/** Move `amount` minions from one squad into another of the same minion. */
export function transferMinions(fromId: string, toId: string, amount = 1): void {
  if (!canTransferMinions(fromId, toId)) return;
  mutate((draft) => {
    const from = draft.encounter.find((entry) => entry.id === fromId);
    const to = draft.encounter.find((entry) => entry.id === toId);
    if (!from || !to) return;
    const moved = Math.min(amount, from.count);
    to.count += moved;
    from.count -= moved;
    if (!from.count) draft.encounter = draft.encounter.filter((entry) => entry.id !== fromId);
  });
  markFresh(toId);
}

export function removeEncounterEntry(itemId: string): void {
  mutate((draft) => {
    draft.encounter = draft.encounter.filter((item) => item.id !== itemId);
  });
  reconcileCombat();
}

/** Move an entry, and its creatures on the board, to another group. Plain
    creatures join an entry of the same monster already there; a squad stays
    its own squad. */
export function moveEncounterEntryToGroup(itemId: string, groupId: string): void {
  mutate((draft) => {
    const item = draft.encounter.find((entry) => entry.id === itemId);
    if (!item || !draft.groups.some((group) => group.id === groupId) || item.groupId === groupId)
      return;
    const linked = draft.combat.instances.filter((instance) => instance.entryId === itemId);
    linked.forEach((instance) => {
      instance.groupId = groupId;
    });
    const existing = item.squad
      ? undefined
      : draft.encounter.find(
          (entry) =>
            entry.id !== item.id &&
            !entry.squad &&
            entry.sourcePath === item.sourcePath &&
            entry.groupId === groupId,
        );
    if (existing) {
      existing.count += item.count;
      linked.forEach((instance) => {
        instance.entryId = existing.id;
      });
      draft.encounter = draft.encounter.filter((entry) => entry.id !== item.id);
    } else {
      item.groupId = groupId;
    }
  });
  reconcileCombat();
}

export function clearEncounter(): void {
  mutate((draft) => {
    draft.encounter = [];
  });
  reconcileCombat();
  toast("Encounter cleared");
}

export interface GroupBalance {
  /** The group's EV, or null while any of its statblocks is still loading. */
  ev: number | null;
  /** Outside the book's one-to-two-hero range: over two heroes (and more than
      a single creature), or under one hero. */
  off: "heavy" | "light" | null;
}

/**
 * Each group's EV against the book's initiative-group advice: keep a group
 * between one and two heroes' encounter strength. A group of a single
 * creature may run heavy. Every light group is flagged, though the book allows
 * one; the hint says so. Empty groups are left out.
 */
export function groupBalance(): Map<string, GroupBalance> {
  void monstersVersion.value; // subscribe: EV settles as statblocks hydrate
  const { items, groups, party } = activeEncounter();
  const { oneHeroES } = partyMath(party);
  const result = new Map<string, GroupBalance>();
  for (const group of groups) {
    const members = items.filter((item) => item.groupId === group.id);
    if (!members.length) continue;
    const loaded = members.every((item) => monsterCache.has(item.sourcePath));
    if (!loaded) {
      result.set(group.id, { ev: null, off: null });
      continue;
    }
    const ev = members.reduce((sum, item) => sum + (monsterCache.get(item.sourcePath)?.ev ?? 0) * item.count, 0);
    const single = members.length === 1 && !members[0]?.squad && members[0]?.count === 1;
    const off = ev > 2 * oneHeroES && !single ? "heavy" : ev < oneHeroES ? "light" : null;
    result.set(group.id, { ev, off });
  }
  return result;
}

/** The book's group count, about as many groups as heroes give or take
    two, when the roster's groups fall outside it. Encounters with a solo
    creature are exempt; empty groups don't count. */
export function groupCountAdvice(): { groups: number; heroes: number; lo: number; hi: number } | null {
  const { items, party } = activeEncounter();
  const groups = groupBalance().size;
  const solo = items.some((item) => monsterCache.get(item.sourcePath)?.organization.toLowerCase() === "solo");
  const heroes = Math.max(1, party.heroes);
  const lo = Math.max(1, heroes - 2);
  const hi = heroes + 2;
  if (solo || !groups || (groups >= lo && groups <= hi)) return null;
  return { groups, heroes, lo, hi };
}

/**
 * The Monsters book's encounter-building advice the roster breaks, as short
 * notes: no more than eight creatures per hero, and at least half minions
 * past three per hero. The
 * initiative-group advice is shown by the groups themselves (`groupBalance`,
 * `groupCountAdvice`).
 */
export function encounterChecks(): string[] {
  void monstersVersion.value; // subscribe: organizations settle as statblocks hydrate
  const { items, party } = activeEncounter();
  let creatures = 0;
  let minions = 0;
  for (const item of items) {
    creatures += item.count;
    const m = monsterCache.get(item.sourcePath);
    if (m && isMinion(m)) minions += item.count;
  }
  const notes: string[] = [];
  const heroes = Math.max(1, party.heroes);
  if (creatures > 8 * heroes) notes.push("More than eight creatures per hero.");
  else if (creatures > 3 * heroes && minions * 2 < creatures)
    notes.push("Over three creatures per hero: at least half should be minions.");
  return notes;
}

export interface EncounterTotals {
  count: number;
  ev: number;
}

export function encounterTotals(): EncounterTotals {
  void monstersVersion.value; // subscribe: EV settles as statblocks hydrate
  // Every creature counts on its own; a minion is its share of its set's EV
  // (the Prep roster deals minions in whole sets by default), so the total is
  // always the sum of the groups.
  let count = 0;
  let ev = 0;
  for (const item of activeEncounter().items) {
    count += item.count;
    ev += (monsterCache.get(item.sourcePath)?.ev ?? 0) * item.count;
  }
  return { count, ev };
}

// ---------- Combat ----------

/** Build the fresh combat instances one prep entry expands into. `ordinal`
    numbers instances of the same monster across the whole roster, so names
    stay unique. A squad entry is one squad; other creatures spawn one
    instance each. */
function buildInstancesForEntry(
  entry: EncounterItem,
  m: Monster,
  nextOrdinal: () => number,
): CombatInstance[] {
  if (isMinion(m)) return [newSquad(entry, m, entry.count, nextOrdinal())];
  return Array.from({ length: entry.count }, () => newCreature(entry, m, nextOrdinal()));
}

function newCreature(entry: EncounterItem, m: Monster, n: number): CombatInstance {
  return {
    id: uid("enemy"),
    sourcePath: entry.sourcePath,
    groupId: entry.groupId,
    entryId: entry.id,
    kind: "creature",
    count: 1,
    name: `${m.name}${n > 1 ? ` ${n}` : ""}`,
    currentStamina: m.stamina,
    maxStamina: m.stamina,
    turns: m.turnsPerRound,
    turnsTaken: 0,
    conditions: [],
    reactions: [],
    villainRounds: [0, 0, 0],
  };
}

function newSquad(entry: EncounterItem, m: Monster, size: number, n: number): CombatInstance {
  return {
    id: uid("enemy"),
    sourcePath: entry.sourcePath,
    groupId: entry.groupId,
    entryId: entry.id,
    kind: "minion-squad",
    count: size,
    // The number leads, so sibling squads stay apart when a slip cuts the name short.
    name: `Squad ${n} · ${m.name}`,
    currentStamina: m.stamina * size,
    maxStamina: m.stamina * size,
    turns: m.turnsPerRound,
    turnsTaken: 0,
    conditions: [],
    reactions: [],
    villainRounds: [0, 0, 0],
  };
}

export async function startCombat(): Promise<void> {
  const encounter = activeEncounter().items;
  if (!encounter.length) return;
  const paths = [...new Set(encounter.map((item) => item.sourcePath))];
  const loaded = await Promise.allSettled(paths.map(loadMonster));
  if (loaded.some((result) => result.status === "rejected")) {
    toast("Some SteelCompendium statblocks could not be loaded.");
    return;
  }
  mutate(() => {
    normalizeEntries(activeEncounter());
  });

  const counters = new Map<string, number>();
  const bump = (path: string) => {
    const next = (counters.get(path) || 0) + 1;
    counters.set(path, next);
    return next;
  };
  const instances: CombatInstance[] = [];
  for (const entry of activeEncounter().items) {
    const m = monsterCache.get(entry.sourcePath);
    if (!m) continue;
    instances.push(...buildInstancesForEntry(entry, m, () => bump(entry.sourcePath)));
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
    draft.view = "combat";
  });
  toast(`Combat started · ${activeEncounter().combat.malice} Malice`);
}

/** Jump to the Run view for an already-active combat without rebuilding it,
    so in-progress stamina/conditions/malice are preserved. */
export function resumeCombat(): void {
  mutate((draft) => {
    draft.view = "combat";
  });
}

/**
 * Reconcile the live combat roster with the current prep roster after a prep
 * edit, preserving the state (stamina, conditions, acted, custom names) of
 * instances that should survive. Only spawns/removes the delta:
 *
 * - Every instance belongs to the prep entry it was dealt from, and follows
 *   that entry's group.
 * - A squad entry keeps its squad, resized to the entry: new minions arrive
 *   at full Stamina; removed minions are the dead ones first, then living
 *   ones, a whole minion's Stamina each (see `resizeSquad`).
 * - Other creatures spawn one instance per count. Raising the count adds
 *   fresh instances; lowering it removes the highest-ordinal (newest) ones,
 *   keeping the creatures already in play. Removing a prep entry (or dropping
 *   its count to zero) removes its instances.
 * - Summoned creatures belong to no entry, so they stay as they are.
 *
 * No-op unless combat is active, so plain prep editing before "Run" is
 * unaffected. `mutate`'s own draft would fight a nested `mutate`, so this must
 * be called on its own, not from inside another mutation.
 */
export function reconcileCombat(): void {
  if (!activeEncounter().combat.active) return;
  mutate((draft) => {
    normalizeEntries(activeEncounter());
    const kept: CombatInstance[] = [];
    // Ordinal counter per monster, spanning surviving + newly spawned, so
    // added instances get names that don't collide with the survivors.
    const counters = new Map<string, number>();
    const bump = (path: string) => {
      const next = (counters.get(path) || 0) + 1;
      counters.set(path, next);
      return next;
    };

    // Bucket existing instances by the prep entry they belong to.
    const byEntry = new Map<string, CombatInstance[]>();
    for (const instance of draft.combat.instances) {
      if (!instance.entryId) continue;
      const list = byEntry.get(instance.entryId);
      if (list) list.push(instance);
      else byEntry.set(instance.entryId, [instance]);
    }

    for (const entry of draft.encounter) {
      const m = monsterCache.get(entry.sourcePath);
      if (!m) continue;
      const current = byEntry.get(entry.id) ?? [];
      for (const instance of current) instance.groupId = entry.groupId;

      if (entry.squad) {
        const squad = current[0];
        const n = bump(entry.sourcePath);
        if (!squad) {
          kept.push(newSquad(entry, m, entry.count, n));
        } else {
          resizeSquad(squad, entry.count, minionStamina(squad, m));
          kept.push(squad);
        }
        continue;
      }

      // Keep up to `count` existing instances (lowest ordinals first — those
      // are the ones that entered play earliest), spawn the rest.
      const survivors = current.slice(0, entry.count);
      for (const survivor of survivors) {
        bump(entry.sourcePath);
        kept.push(survivor);
      }
      for (let i = survivors.length; i < entry.count; i += 1)
        kept.push(newCreature(entry, m, bump(entry.sourcePath)));
    }
    kept.push(...draft.combat.instances.filter((instance) => instance.summonedBy !== undefined));

    // A captain who left the board leaves their squad without one.
    for (const squad of kept) {
      if (squad.captainId && !kept.some((item) => item.id === squad.captainId)) detachCaptain(squad);
    }
    draft.combat.instances = kept;
  });
}

export function nextRound(): void {
  if (!activeEncounter().combat.instances.length) return;
  mutate((draft) => {
    const endingRound = draft.combat.round;
    draft.combat.activeEffects = draft.combat.activeEffects.filter(
      (effect) => effect.expiresRound > endingRound,
    );
    draft.combat.round += 1;
    draft.combat.malice += draft.party.heroes + draft.combat.round;
    draft.combat.instances.forEach((instance) => {
      instance.turnsTaken = 0;
      instance.reactions = [];
    });
  });
  const combat = activeEncounter().combat;
  toast(`Round ${combat.round} · +${activeEncounter().party.heroes + combat.round} Malice`);
}

/**
 * Undo an accidental {@link nextRound}: step back one round and remove the Malice
 * that advancing into the current round granted (heroes + currentRound). Effects that
 * `nextRound` expired can't be recovered, so this is a best-effort misclick undo.
 */
export function previousRound(): void {
  if (activeEncounter().combat.round <= 1) return;
  mutate((draft) => {
    const undoneGain = draft.party.heroes + draft.combat.round;
    draft.combat.malice = Math.max(0, draft.combat.malice - undoneGain);
    draft.combat.round -= 1;
    draft.combat.instances.forEach((instance) => {
      instance.turnsTaken = 0;
      instance.reactions = [];
    });
  });
  const combat = activeEncounter().combat;
  toast(`Round ${combat.round} · −${activeEncounter().party.heroes + (combat.round + 1)} Malice`);
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

export function hasActed(instance: CombatInstance): boolean {
  return instance.turnsTaken >= instance.turns;
}

/** Tap turn box `index` (0-based): an open box marks every turn up to and
    including it; a marked box clears it and every turn after it. */
export function markTurn(instanceId: string, index: number): void {
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (!instance) return;
    instance.turnsTaken = index < instance.turnsTaken ? index : Math.min(instance.turns, index + 1);
  });
}

/** Override how many turns a creature takes each round. */
export function adjustTurns(instanceId: string, delta: number): void {
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (!instance) return;
    instance.turns = clampInt(instance.turns + delta, 1, MAX_TURNS);
    instance.turnsTaken = Math.min(instance.turnsTaken, instance.turns);
  });
}

export function removeInstance(instanceId: string): void {
  mutate((draft) => {
    releaseCaptain(draft.combat.instances, instanceId);
    draft.combat.instances = draft.combat.instances.filter((item) => item.id !== instanceId);
  });
}

// ---------- Summons ----------

/** The squad limits a creature on the board prints, if it prints any. */
export function summonerRules(summoner: CombatInstance): SquadRules | null {
  const m = monsterCache.get(summoner.sourcePath);
  return m ? squadRules(m, catalog.value, (path) => monsterCache.get(path)) : null;
}

/**
 * Bring `count` of a statblock onto the board for an ability of the creature
 * `summonerId`. They join the summoner's activation group; minions join the
 * summoner's own standing squads of them while they have room, then form new
 * squads, within the squad limits the summoner prints (two squads of six, one
 * of them signature minions); those that find no room stay off the board.
 * Nothing is added to the prep roster, so the encounter's EV stays as
 * it was built. `malice` is paid first, for creatures that carry their own
 * price (a rival summoner's minions).
 */
export async function summonCreatures(
  summonerId: string,
  sourcePath: string,
  count: number,
  malice = 0,
): Promise<void> {
  if (count < 1) return;
  if (malice > activeEncounter().combat.malice) {
    toast(`Need ${malice} Malice.`);
    return;
  }
  let m: Monster;
  try {
    m = await loadMonster(sourcePath);
  } catch {
    toast("That statblock could not be loaded from SteelCompendium.");
    return;
  }
  let summoned = "";
  mutate((draft) => {
    const instances = draft.combat.instances;
    const summoner = instances.find((item) => item.id === summonerId);
    if (!summoner || malice > draft.combat.malice) return;
    const same = instances.filter((item) => item.sourcePath === sourcePath);
    const stub: EncounterItem = { id: "", sourcePath, groupId: summoner.groupId, count };
    const tag = (instance: CombatInstance): CombatInstance => {
      delete instance.entryId;
      instance.summonedBy = summonerId;
      return instance;
    };
    const added: CombatInstance[] = [];
    let dropped = 0;
    if (isMinion(m)) {
      const plan = planSummon(
        instances,
        summonerId,
        sourcePath,
        count,
        summonerRules(summoner),
        SQUAD_MAX,
        (squad) => standing(squad.currentStamina, minionStamina(squad, m)),
      );
      if (!plan.top.length && !plan.fresh.length) {
        summoned = `${summoner.name}'s squads have no room for ${m.name}`;
        return;
      }
      // A squad's dead make way for the newcomers rather than holding their places.
      for (const { id, size } of plan.top) {
        const squad = instances.find((item) => item.id === id);
        if (squad) resizeSquad(squad, size, minionStamina(squad, m));
      }
      let n = same.filter((item) => item.kind === "minion-squad").length;
      for (const size of plan.fresh) added.push(tag(newSquad(stub, m, size, (n += 1))));
      dropped = plan.dropped;
    } else {
      let n = same.length;
      for (let left = count; left > 0; left -= 1) added.push(tag(newCreature(stub, m, (n += 1))));
    }
    // Beside their own kind, or else beside the summoner, so a new statblock
    // opens next to the one that called it.
    const near = same.length ? same : instances.filter((item) => item.sourcePath === summoner.sourcePath);
    const after = near.length ? instances.indexOf(near[near.length - 1] as CombatInstance) + 1 : instances.length;
    instances.splice(after, 0, ...added);
    draft.combat.malice -= malice;
    summoned =
      `${summoner.name} summons ${count - dropped} × ${m.name}${malice ? ` · −${malice} Malice` : ""}` +
      (dropped ? ` · ${dropped} more find no room in their squads` : "");
  });
  if (summoned) toast(summoned);
}

// ---------- Squad captains ----------

/** Attach a captain: each minion gains the "With Captain" benefit, and a
    Stamina bonus lands on every minion still standing. */
function attachCaptain(squad: CombatInstance, captainId: string): void {
  const m = monsterCache.get(squad.sourcePath);
  const bonus = m ? captainStaminaBonus(m) : 0;
  if (m && bonus) {
    squad.currentStamina += bonus * standing(squad.currentStamina, m.stamina);
    squad.maxStamina = (m.stamina + bonus) * squad.count;
  }
  squad.captainId = captainId;
}

/** Detach a squad's captain, taking back any Stamina bonus it granted. */
function detachCaptain(squad: CombatInstance): void {
  const m = monsterCache.get(squad.sourcePath);
  const bonus = m ? captainStaminaBonus(m) : 0;
  if (m && bonus && squad.captainId) {
    const alive = standing(squad.currentStamina, m.stamina + bonus);
    squad.currentStamina = Math.max(0, squad.currentStamina - bonus * alive);
    squad.maxStamina = m.stamina * squad.count;
  }
  delete squad.captainId;
}

/** Free every squad `captainId` leads (they fell, or left the board); returns
    the squads that lost their captain. */
function releaseCaptain(instances: CombatInstance[], captainId: string): CombatInstance[] {
  const led = instances.filter((item) => item.captainId === captainId);
  led.forEach(detachCaptain);
  return led;
}

/** The creatures that could captain `squad` now: standing non-minion,
    non-mount creatures, including one leading another squad (a creature
    captains one squad at a time, so picking it moves it here). */
export function captainCandidates(squad: CombatInstance): CombatInstance[] {
  return activeEncounter().combat.instances.filter((item) => {
    if (item.kind !== "creature" || item.currentStamina <= 0) return false;
    const m = monsterCache.get(item.sourcePath);
    return !!m && canCaptain(m);
  }).filter((item) => item.id !== squad.id);
}

/** Put `captainId` in charge of a squad, or clear its captain with null. A
    squad has one captain and a captain leads one squad, so both sides let go
    of any previous link. */
export function setSquadCaptain(squadId: string, captainId: string | null): void {
  let named = "";
  mutate((draft) => {
    const instances = draft.combat.instances;
    const squad = instances.find((item) => item.id === squadId);
    if (!squad || squad.kind !== "minion-squad" || squad.captainId === (captainId ?? undefined)) return;
    if (squad.captainId) detachCaptain(squad);
    if (!captainId) return;
    const captain = instances.find((item) => item.id === captainId);
    if (!captain || captain.kind !== "creature") return;
    releaseCaptain(instances, captainId);
    attachCaptain(squad, captainId);
    named = `${captain.name} leads ${squad.name}`;
  });
  if (named) toast(named);
}

export function renameInstance(instanceId: string, name: string): void {
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (instance) instance.name = name.trim() || instance.name;
  });
}

/** Move one creature or squad to another group from the board. Prep follows:
    an entry that holds only this instance moves with it, and a creature from
    a larger entry splits off into an entry of its own. */
export function setInstanceGroup(instanceId: string, groupId: string): void {
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (!instance || instance.groupId === groupId) return;
    instance.groupId = groupId;
    const entry = draft.encounter.find((item) => item.id === instance.entryId);
    if (!entry) return;
    if (entry.squad || entry.count <= 1) {
      entry.groupId = groupId;
      draft.combat.instances.forEach((item) => {
        if (item.entryId === entry.id) item.groupId = groupId;
      });
      return;
    }
    entry.count -= 1;
    const split: EncounterItem = { id: uid("enc"), sourcePath: entry.sourcePath, groupId, count: 1 };
    draft.encounter.splice(draft.encounter.indexOf(entry) + 1, 0, split);
    instance.entryId = split.id;
  });
}

export function applyStaminaCommand(instanceId: string, rawValue: string): void {
  const raw = rawValue.trim();
  let lost: string[] = [];
  mutate((draft) => {
    const instance = draft.combat.instances.find((item) => item.id === instanceId);
    if (!instance) return;
    let next: number;
    if (/^[+-]\s*\d+(?:\.\d+)?$/.test(raw))
      next = instance.currentStamina + Number(raw.replace(/\s/g, ""));
    else if (/^\d+(?:\.\d+)?$/.test(raw)) next = Number(raw);
    else return;
    // A squad's pool can't gain temporary Stamina; a raise only puts back
    // what a slip of the pen took.
    const ceiling = instance.kind === "minion-squad" ? instance.maxStamina : Infinity;
    instance.currentStamina = Math.max(0, Math.min(ceiling, Math.round(next)));
    if (instance.kind === "creature" && instance.currentStamina <= 0) {
      lost = releaseCaptain(draft.combat.instances, instance.id).map((squad) => squad.name);
    }
  });
  if (lost.length) toast(`${lost.join(", ")} lost ${lost.length > 1 ? "their" : "its"} captain`);
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
  for (const instance of activeEncounter().combat.instances) {
    const list = map.get(instance.sourcePath);
    if (list) list.push(instance);
    else map.set(instance.sourcePath, [instance]);
  }
  return [...map.entries()];
}

// ---------- Rolls ----------

export type ClickMods = {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

/**
 * Explicit edge (longpress menu pick) or click-modifier edge
 * (⌘/Ctrl+click edge, ⌥+click bane, +⇧ doubles); otherwise a normal roll.
 * There is no armed/sticky state: every roll is self-contained.
 */
export type EdgeInput = EdgeState | ClickMods;

function takeEdge(input?: EdgeInput): EdgeState {
  if (typeof input === "string") return input;
  return clickEdgeOverride(input ?? {}) ?? "normal";
}

export function rollFeature(
  monsterPath: string,
  featureIndex: number,
  effectIndex: number,
  input?: EdgeInput,
): void {
  const m = monsterCache.get(monsterPath);
  const effect = m?.features[featureIndex]?.effects?.[effectIndex];
  if (!m || !effect?.roll) return;
  const key = `${m.id}|${featureIndex}|${effectIndex}`;
  const next = new Map(lastRolls.value);
  // Map.set keeps an existing key's position: delete first so insertion
  // order always reflects recency (readers pick the "latest" roll by order).
  next.delete(key);
  next.set(key, makePowerRoll(effect.roll, m, takeEdge(input)));
  lastRolls.value = next;
}

export function rollCharacteristic(
  monsterPath: string,
  key: CharacteristicKey,
  input?: EdgeInput,
): void {
  const m = monsterCache.get(monsterPath);
  if (!m) return;
  const rollKey = `${m.id}|char|${key}`;
  const next = new Map(lastRolls.value);
  // See rollFeature: delete first so a re-roll moves to the end (recency).
  next.delete(rollKey);
  next.set(rollKey, makeCharacteristicRoll(m, key, takeEdge(input)));
  lastRolls.value = next;
}

export function rollMaliceFeature(
  featureId: string,
  effectIndex: number,
  input?: EdgeInput,
): void {
  const feature = maliceFeatures.value.find((item) => item.id === featureId);
  const effect = feature?.effects[effectIndex];
  if (!feature || !effect || !(effect.tier1 || effect.tier2 || effect.tier3)) return;
  const key = `${feature.id}|${effectIndex}`;
  const next = new Map(lastMaliceRolls.value);
  // See rollFeature: delete first so a re-roll moves to the end (recency).
  next.delete(key);
  next.set(key, makePowerRoll(effect.roll || "Power Roll", null, takeEdge(input)));
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
  for (const instance of activeEncounter().combat.instances) {
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
  if (!activeEncounter().combat.instances.length) return [];
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
  const current = activeEncounter().combat.selectedMaliceFeatureIds;
  const filtered = current.filter((id) => availableIds.has(id));

  if (!activeEncounter().combat.maliceSelectionInitialized && availableIds.size) {
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

export function toggleWatch(): void {
  mutate((draft) => {
    draft.ui.watchOpen = !draft.ui.watchOpen;
  });
}

/** Take back uses of triggered action `name` this round (the last one, or
    every one with `all`) and refund their Malice. */
export function takeBackReaction(instanceId: string, name: string, all = false): void {
  const instance = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  const index = instance ? instance.reactions.map((item) => item.name).lastIndexOf(name) : -1;
  if (!instance || index < 0) return;
  const drop = (item: { name: string }, i: number) => (all ? item.name === name : i === index);
  const refund = instance.reactions.filter(drop).reduce((sum, item) => sum + item.malice, 0);
  mutate((draft) => {
    const target = draft.combat.instances.find((item) => item.id === instanceId);
    if (!target) return;
    target.reactions = target.reactions.filter((item, i) => !drop(item, i));
    draft.combat.malice += refund;
  });
  toast(refund ? `${name} taken back · +${refund} Malice` : `${name} taken back`);
}

/**
 * The one gesture on a triggered action's box: each tap counts another use
 * while the creature has any left, and the tap after that wraps this one back
 * to none, refunding it. With one a round that is a plain tick and untick.
 */
export function cycleReaction(instanceId: string, name: string, malice: number, capacity: number): void {
  const instance = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!instance) return;
  const uses = instance.reactions.filter((item) => item.name === name).length;
  if (uses && (capacity === 1 || instance.reactions.length >= capacity)) takeBackReaction(instanceId, name, true);
  else useReaction(instanceId, name, malice, capacity);
}

/**
 * Use a triggered action, paying its Malice. The rules allow one a round
 * (`capacity`; Ajax three), and nothing stops a creature with several using
 * the same one twice, so each use is counted. With one a round the box is a
 * toggle: tapping the marked one takes it back, tapping another swaps them.
 */
export function useReaction(instanceId: string, name: string, malice: number, capacity: number): void {
  const instance = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!instance) return;
  if (capacity === 1 && instance.reactions.some((item) => item.name === name)) {
    takeBackReaction(instanceId, name);
    return;
  }
  if (isDazed(instance)) {
    toast(`${instance.name} is Dazed and can't use triggered actions.`);
    return;
  }
  const full = instance.reactions.length >= capacity;
  if (full && capacity > 1) {
    toast(`${instance.name} has used all ${capacity} triggered actions this round.`);
    return;
  }
  const swapped = full ? instance.reactions[instance.reactions.length - 1] : undefined;
  const refund = swapped?.malice ?? 0;
  if (malice > activeEncounter().combat.malice + refund) {
    toast(`${name} needs ${malice} Malice.`);
    return;
  }
  mutate((draft) => {
    const target = draft.combat.instances.find((item) => item.id === instanceId);
    if (!target) return;
    if (swapped) target.reactions = target.reactions.slice(0, -1);
    draft.combat.malice += refund - malice;
    target.reactions.push({ name, malice });
  });
  toast(malice ? `${instance.name} · ${name} · −${malice} Malice` : `${instance.name} · ${name}`);
}

/** The creature that used a villain action this round, if any: the rules
    allow one per round across the whole encounter. */
export function villainActionThisRound(): CombatInstance | undefined {
  const combat = activeEncounter().combat;
  return combat.instances.find((instance) => instance.villainRounds.includes(combat.round));
}

/** Mark villain action `n` (1–3) used this round, or take the mark back. */
export function toggleVillainAction(instanceId: string, n: number): void {
  const instance = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!instance) return;
  const marking = !instance.villainRounds[n - 1];
  const earlier = villainActionThisRound();
  mutate((draft) => {
    const target = draft.combat.instances.find((item) => item.id === instanceId);
    if (!target) return;
    const rounds = [0, 1, 2].map((i) => target.villainRounds[i] ?? 0);
    rounds[n - 1] = marking ? draft.combat.round : 0;
    target.villainRounds = rounds;
  });
  if (marking && earlier) toast(`${earlier.name} already used this round's villain action.`);
}

export function useMaliceFeature(featureId: string): void {
  const feature = maliceFeatures.value.find((item) => item.id === featureId);
  if (!feature) return;
  if (feature.cost > activeEncounter().combat.malice) {
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
  if (cost > activeEncounter().combat.malice) {
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
