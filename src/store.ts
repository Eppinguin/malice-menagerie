import { requestSharedDice, setSharedRollReset } from "./lib/rollTransport.ts";
import { computed, effect, signal } from "@preact/signals";
import { clampInt, normalizeToken, uid } from "./lib/text.ts";
import {
  type History,
  navigate as navigateHistory,
  packHistory,
  record as recordHistory,
  redo as redoHistory,
  SESSION_HISTORY_KEY,
  startHistory,
  undo as undoHistory,
  unpackHistory,
} from "./lib/history.ts";
import { parseStaminaCommand } from "./lib/stamina.ts";
import {
  type CatalogMatch,
  fitsEvBudget,
  matchCatalogEntry,
  parseQuery,
  type ParsedQuery,
} from "./lib/browse.ts";
import {
  clickEdgeOverride,
  makeCharacteristicRoll,
  makePowerRoll,
  resolvePowerRollBonus,
  resolvePowerRollDice,
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
  hydrateCatalogInBackground,
  hydrateConditionsInBackground,
  hydrateMaliceInBackground,
  loadMonster,
  loadSourceIndex,
  maliceFeatures,
  maliceLoading,
  monsterAt,
  monsterNameForPath,
  monstersVersion,
} from "./data.ts";
import { basePath, levelKey } from "./lib/levels.ts";
import { isRecord } from "./types.ts";
import {
  applyOutcome,
  archetypeOf,
  attitudeOf,
  ATTITUDES,
  endingFor,
  impressionBandOf,
  lieBites,
  randomTraitPair,
  readSpent,
  tierLines,
  tierOutcome,
  traitOf,
} from "./lib/negotiation.ts";
import type { AttitudeKey, ArgumentPlan, Ending, ImpressionBandKey } from "./lib/negotiation.ts";
import type {
  AppState,
  CatalogEntry,
  CombatInstance,
  CombatState,
  EdgeState,
  Encounter,
  EncounterItem,
  EncounterView,
  FacetKey,
  Group,
  LanguageBonus,
  MaliceFeature,
  MaliceGroup,
  Monster,
  Negotiation,
  NegotiationLogEntry,
  NegotiationTrait,
  PowerRollResult,
  SectionName,
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
    negotiations: [],
    activeNegotiationId: "",
    ui: {
      section: "encounters",
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
      fitsBudget: false,
      inEncounter: false,
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
  return value
    .filter(isRecord)
    .flatMap((item) =>
      typeof item["name"] === "string"
        ? [{ name: item["name"], malice: clampInt(item["malice"] ?? 0, 0, 99) }]
        : [],
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
                Array.isArray(item["villainRounds"])
                  ? clampInt(item["villainRounds"][i] ?? 0, 0, 999)
                  : 0,
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
      if (item.sourcePath !== instance.sourcePath || item.groupId !== instance.groupId)
        return false;
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
    const m = monsterAt(item.sourcePath);
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

/** Rebuild a guaranteed-valid Negotiation from whatever was persisted. */
function sanitizeNegotiation(value: unknown, index: number): Negotiation {
  const base = newNegotiation(`NPC ${index + 1}`);
  if (!isRecord(value)) return base;

  base.id = asString(value["id"], base.id);
  base.name = asString(value["name"], base.name).trim() || base.name;
  base.ask = asString(value["ask"], "");
  base.archetype = asString(value["archetype"], "");
  const attitude = value["attitude"];
  base.attitude = (
    ATTITUDES.some((item) => item.key === attitude) ? attitude : "neutral"
  ) as AttitudeKey;
  const rawLang = Number(value["languageBonus"]);
  base.languageBonus = rawLang === 1 || rawLang === 2 ? rawLang : 0;
  base.interest = clampInt(value["interest"], 0, 5);
  base.patience = clampInt(value["patience"], 0, 5);
  base.impression = clampInt(value["impression"], 1, 12);
  const renown = value["renown"];
  base.renown = renown === "famous" || renown === "infamous" ? renown : "unknown";
  base.ended = (value["ended"] ?? null) as Ending;
  if (asBool(value["overrideEnded"], false)) base.overrideEnded = true;

  const traits = (raw: unknown): NegotiationTrait[] =>
    Array.isArray(raw)
      ? raw.filter(isRecord).flatMap((item): NegotiationTrait[] => {
          const name = asString(item["name"], "").trim();
          if (!name) return [];
          return [
            {
              id: asString(item["id"], uid("trait")),
              name,
              note: asString(item["note"], ""),
              used: asBool(item["used"], false),
              revealed: asBool(item["revealed"], false),
            },
          ];
        })
      : [];
  base.motivations = traits(value["motivations"]);
  base.pitfalls = traits(value["pitfalls"]);

  const outcomes = value["outcomes"];
  if (Array.isArray(outcomes)) {
    for (let level = 0; level < 6; level += 1) {
      base.outcomes[level] = asString(outcomes[level], "");
    }
  }

  const log = value["log"];
  if (Array.isArray(log)) {
    base.log = log.filter(isRecord).flatMap((entry): NegotiationLogEntry[] => {
      const id = entry["id"];
      const title = entry["title"];
      if (typeof id !== "string" || typeof title !== "string") return [];
      const before = isRecord(entry["before"]) ? entry["before"] : {};
      const memo = asString(entry["memo"], "");
      const hasRevealedPitfalls = Array.isArray(before["revealedPitfallIds"]);
      return [
        {
          id,
          kind: entry["kind"] === "read" ? "read" : "argument",
          title,
          ...(memo ? { memo } : {}),
          result: asString(entry["result"], ""),
          roll: asString(entry["roll"], ""),
          before: {
            interest: clampInt(before["interest"], 0, 5),
            patience: clampInt(before["patience"], 0, 5),
            usedIds: asStringArray(before["usedIds"]),
            ...(hasRevealedPitfalls
              ? { revealedPitfallIds: asStringArray(before["revealedPitfallIds"]) }
              : {}),
          },
          at: Number(entry["at"]) || 0,
        },
      ];
    });
  }

  base.updatedAt = Number(value["updatedAt"]) || base.updatedAt;
  return base;
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
    base.activeEncounterId = asString(value["activeEncounterId"], (encounters[0] as Encounter).id);
  }

  // Legacy migration: `view` used to be a single global `ui.view`, and `"talk"`
  // used to be stored on `enc.view` before `ui.section` separated tools from
  // per-encounter Prep/Run lenses.
  const activeEnc = base.encounters.find((enc) => enc.id === base.activeEncounterId);
  const activeRaw = rawEncounters.find(
    (raw): raw is Record<string, unknown> => isRecord(raw) && raw["id"] === activeEnc?.id,
  );
  const legacyView = isRecord(value["ui"]) ? value["ui"]["view"] : undefined;
  if (legacyView === "combat" || legacyView === "builder") {
    if (activeEnc && activeRaw && !("view" in activeRaw)) activeEnc.view = legacyView;
  }
  const migratedFromTalk = activeRaw?.["view"] === "talk" || legacyView === "talk";
  if (activeEnc && activeRaw?.["view"] === "talk" && activeEnc.combat.active) {
    activeEnc.view = "combat";
  }

  const negotiations = Array.isArray(value["negotiations"])
    ? value["negotiations"].map((raw, index) => sanitizeNegotiation(raw, index))
    : [];
  if (negotiations.length) {
    base.negotiations = negotiations;
    base.activeNegotiationId = asString(
      value["activeNegotiationId"],
      (negotiations[0] as Negotiation).id,
    );
  }

  if (isRecord(value["ui"])) {
    const ui = value["ui"];
    const sort = ui["sort"];
    const savedSection = ui["section"];
    const section: SectionName =
      savedSection === "negotiations" || savedSection === "encounters"
        ? savedSection
        : migratedFromTalk
          ? "negotiations"
          : "encounters";
    base.ui = {
      section,
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
      fitsBudget: asBool(ui["fitsBudget"], false),
      inEncounter: asBool(ui["inEncounter"], false),
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
  if (!draft.negotiations.some((item) => item.id === draft.activeNegotiationId))
    draft.activeNegotiationId = (draft.negotiations[0] as Negotiation | undefined)?.id ?? "";
  for (const enc of draft.encounters) ensureEncounterIntegrity(enc);
}

function loadState(): AppState {
  try {
    return sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return defaultState();
  }
}

function loadInitialHistory(): History<AppState> {
  try {
    const rawStored = localStorage.getItem(STORAGE_KEY);
    const rawSession =
      typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_HISTORY_KEY) : null;
    const restored = unpackHistory(rawSession, rawStored, sanitizeState);
    if (restored) return restored;
  } catch {
    // Storage disabled or unavailable.
  }
  return startHistory(loadState());
}

const initialHistory = loadInitialHistory();
export const historyState = signal<History<AppState>>(initialHistory);
export const state = signal<AppState>(initialHistory.present);

export const canUndo = computed(() => historyState.value.past.length > 0);
export const canRedo = computed(() => historyState.value.future.length > 0);
export const undoLabel = computed(
  () => historyState.value.past[historyState.value.past.length - 1]?.label ?? "",
);
export const redoLabel = computed(
  () => historyState.value.future[historyState.value.future.length - 1]?.label ?? "",
);

export function persistSessionHistory(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const current = historyState.peek();
    const packed = packHistory({ ...current, present: state.peek() });
    sessionStorage.setItem(SESSION_HISTORY_KEY, packed);
  } catch {
    try {
      sessionStorage.removeItem(SESSION_HISTORY_KEY);
    } catch {
      // Storage disabled.
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", persistSessionHistory);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistSessionHistory();
  });
}

// Older minion entries become one entry per squad as their statblocks load.
effect(() => {
  void monstersVersion.value;
  const legacy = (item: EncounterItem) => {
    const m = monsterAt(item.sourcePath);
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

/** The currently open negotiation, or null until one is created. */
export function activeNegotiation(): Negotiation | null {
  const { negotiations, activeNegotiationId } = state.value;
  return negotiations.find((item) => item.id === activeNegotiationId) ?? null;
}

/**
 * The open negotiation, read fresh. A block that keeps its own state (the
 * ladder's edit box, a list's add field, the read's spent rule) only
 * re-renders on a signal it has read itself, so each one reads the
 * negotiation here rather than trusting the prop it was last handed.
 */
export function liveNegotiation(prop: Negotiation): Negotiation {
  return activeNegotiation() ?? prop;
}

/**
 * A flat view over the active encounter + global UI, matching the field layout
 * mutations were originally written against (`draft.party`, `draft.encounter`,
 * `draft.combat`, `draft.ui`, …). Reads and writes pass straight through to the
 * underlying active encounter, so existing mutation bodies work unchanged.
 */
export interface MutableDraft {
  view: EncounterView;
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

export interface HistoryStepMeta {
  label: string;
  key?: string;
  kind?: string;
}

/**
 * Apply a mutation against the active encounter (and global UI), stamp its
 * updated-at time, persist, and notify subscribers. When `step` is provided,
 * snapshots before/after onto the session undo/redo stack and returns the step id.
 */
export function mutate(fn: (draft: MutableDraft) => void, step?: HistoryStepMeta): string {
  const before = step ? structuredClone(state.value) : null;
  const app = state.value;
  const enc = activeEncounter();
  fn(draftView(app, enc));
  enc.updatedAt = Date.now();
  ensureIntegrity(app);
  persist(app);
  const next = { ...app };
  if (step && before) {
    const stepId = uid("step");
    historyState.value = recordHistory({ ...historyState.value, present: before }, next, {
      id: stepId,
      ...step,
    });
    state.value = next;
    return stepId;
  }
  historyState.value = navigateHistory(historyState.value, next);
  state.value = next;
  return "";
}

/** Apply a mutation to the whole app state (encounter library, active id). */
export function mutateApp(fn: (draft: AppState) => void, step?: HistoryStepMeta): string {
  const before = step ? structuredClone(state.value) : null;
  const app = state.value;
  fn(app);
  ensureIntegrity(app);
  persist(app);
  const next = { ...app };
  if (step && before) {
    const stepId = uid("step");
    historyState.value = recordHistory({ ...historyState.value, present: before }, next, {
      id: stepId,
      ...step,
    });
    state.value = next;
    return stepId;
  }
  historyState.value = navigateHistory(historyState.value, next);
  state.value = next;
  return "";
}

export function undoStep(): void {
  const current = historyState.value;
  const step = current.past[current.past.length - 1];
  if (!step) {
    toast("Nothing to undo");
    return;
  }
  const prevActiveId = state.value.activeEncounterId;
  const updated = undoHistory({ ...current, present: structuredClone(state.value) });
  const next = structuredClone(updated.present);
  ensureIntegrity(next);
  historyState.value = { ...updated, present: next };
  persist(next);
  state.value = next;
  const elsewhere =
    next.activeEncounterId !== prevActiveId
      ? next.encounters.find((item) => item.id === next.activeEncounterId)?.name
      : undefined;
  toast(`Undone: ${step.label}${elsewhere ? ` · ${elsewhere}` : ""}`, {
    redoStepId: step.id,
  });
}

export function redoStep(): void {
  const current = historyState.value;
  const step = current.future[current.future.length - 1];
  if (!step) {
    toast("Nothing to redo");
    return;
  }
  const updated = redoHistory({ ...current, present: structuredClone(state.value) });
  const next = structuredClone(updated.present);
  ensureIntegrity(next);
  historyState.value = { ...updated, present: next };
  persist(next);
  state.value = next;
  toast(`Redone: ${step.label}`, {
    undoStepId: step.id,
  });
}

/** Clear undo/redo stacks (used by tests to isolate history across cases). */
export function clearHistory(): void {
  historyState.value = startHistory(state.value);
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
/** Whether the Run Quick-Add monster drawer is open. Ephemeral. */
export const quickAddOpen = signal<boolean>(false);

export function openQuickAdd(): void {
  mobileNavOpen.value = false;
  quickAddOpen.value = true;
}

export function closeQuickAdd(): void {
  quickAddOpen.value = false;
}

export function toggleQuickAdd(): void {
  if (quickAddOpen.value) closeQuickAdd();
  else openQuickAdd();
}

export const expandedMaliceFeatures = signal<ReadonlySet<string>>(new Set());
export const openConditionPickerFor = signal<string | null>(null);
export const previewPath = signal<string | null>(null);
export const qtyDrafts = signal<ReadonlyMap<string, number>>(new Map());
export const lastRolls = signal<ReadonlyMap<string, PowerRollResult>>(new Map());
export const lastMaliceRolls = signal<ReadonlyMap<string, PowerRollResult>>(new Map());
export const sharedRollActive = signal<boolean>(false);
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export const toastState = signal<{
  message: string;
  shown: boolean;
  action: ToastAction | null;
  undoStepId: string | null;
  redoStepId: string | null;
}>({
  message: "",
  shown: false,
  action: null,
  undoStepId: null,
  redoStepId: null,
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function dismissToast(): void {
  clearTimeout(toastTimer);
  toastState.value = {
    ...toastState.value,
    shown: false,
    action: null,
    undoStepId: null,
    redoStepId: null,
  };
}

export function toast(
  message: string,
  options?:
    | number
    | {
        durationMs?: number;
        action?: ToastAction;
        undoStepId?: string;
        redoStepId?: string;
      },
): void {
  clearTimeout(toastTimer);
  const action = typeof options === "object" ? (options.action ?? null) : null;
  const undoStepId = typeof options === "object" ? (options.undoStepId ?? null) : null;
  const redoStepId = typeof options === "object" ? (options.redoStepId ?? null) : null;
  const hasInteractive = Boolean(action || undoStepId || redoStepId);
  const duration =
    typeof options === "number"
      ? options
      : (options?.durationMs ?? (hasInteractive ? 5_200 : message.length > 48 ? 4_200 : 1_800));
  toastState.value = { message, shown: true, action, undoStepId, redoStepId };
  toastTimer = setTimeout(() => {
    toastState.value = {
      ...toastState.value,
      shown: false,
      action: null,
      undoStepId: null,
      redoStepId: null,
    };
  }, duration);
}

export function qtyFor(path: string): number {
  return qtyDrafts.value.get(path) ?? monsterAt(path)?.defaultQty ?? 1;
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
  if (activeEncounter().items.length > 0 && activeEncounter().view === "combat") {
    void ensureCombatReady();
  }
}

export function retrySource(): void {
  void initApp();
}

// ---------- View / section / party ----------

/** Active top-level tool in the spine: Encounters or Negotiations. */
export function activeSection(): SectionName {
  return state.value.ui.section;
}

/** Resolved active page: "talk" in Negotiations, or the active encounter's Prep/Run lens. */
export function activeView(): ViewName {
  return state.value.ui.section === "negotiations" ? "talk" : activeEncounter().view;
}

export function setSection(section: SectionName): void {
  if (section !== "encounters") quickAddOpen.value = false;
  mutateApp((draft) => {
    draft.ui.section = section;
  });
  if (section === "encounters" && activeEncounter().view === "combat") {
    void ensureCombatReady();
  }
}

export function setView(view: ViewName): void {
  if (view === "talk") {
    setSection("negotiations");
    return;
  }
  if (view !== "combat") quickAddOpen.value = false;
  mutate((draft) => {
    draft.ui.section = "encounters";
    draft.view = view;
  });
  if (view === "combat") void ensureCombatReady();
}

/** Collapse/expand the desktop sidebar (persisted preference). */
export function toggleSidebar(): void {
  mutate((draft) => {
    draft.ui.sidebarCollapsed = !draft.ui.sidebarCollapsed;
  });
}

export function setMobileNav(open: boolean): void {
  if (open) quickAddOpen.value = false;
  mobileNavOpen.value = open;
}

export function updateParty(values: {
  heroes: unknown;
  level: unknown;
  victories: unknown;
  bonusMalice: unknown;
}): void {
  mutate(
    (draft) => {
      const enc = activeEncounter();
      const pristine = !hasCombatProgress(enc);
      draft.party.heroes = clampInt(values.heroes, 1, 12);
      draft.party.level = clampInt(values.level, 1, 10);
      draft.party.victories = clampInt(values.victories, 0, 20);
      draft.party.bonusMalice = clampInt(values.bonusMalice, 0, 99);
      if (pristine && draft.combat.active) {
        draft.combat.malice = partyMath(draft.party).roundOne;
      }
    },
    { label: "Updated party", key: "party" },
  );
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

/** Create a fresh empty encounter, make it active, and stay in the current lens (Prep or Run). */
export function createEncounter(): string {
  let newId = "";
  let newName = "";
  const inCombat = activeView() === "combat";
  mutateApp(
    (draft) => {
      const enc = newEncounter(defaultEncounterName(draft.encounters));
      enc.view = inCombat ? "combat" : "builder";
      enc.activePrepGroupId = (enc.groups[0] as Group).id;
      draft.encounters.push(enc);
      draft.activeEncounterId = enc.id;
      draft.ui.section = "encounters";
      newId = enc.id;
      newName = enc.name;
    },
    { label: "Created encounter" },
  );
  quickAddOpen.value = false;
  toast(newName || "New encounter");
  return newId;
}

/** Switch the active encounter. Each encounter restores its own last lens (Prep or Run). */
export function selectEncounter(encounterId: string): void {
  if (state.value.activeEncounterId === encounterId && state.value.ui.section === "encounters")
    return;
  if (!state.value.encounters.some((enc) => enc.id === encounterId)) return;
  if (sharedRollPending) {
    sharedRollGeneration += 1;
    clearSharedRollPending();
  }
  quickAddOpen.value = false;
  mutateApp((draft) => {
    draft.activeEncounterId = encounterId;
    draft.ui.section = "encounters";
  });
  void hydrateSavedStateSources().then(() => {
    if (activeView() === "combat") void ensureCombatReady();
  });
}

export function renameEncounter(encounterId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  mutateApp(
    (draft) => {
      const enc = draft.encounters.find((item) => item.id === encounterId);
      if (enc) {
        enc.name = trimmed;
        enc.updatedAt = Date.now();
      }
    },
    { label: `Renamed to ${trimmed}` },
  );
}

/** Deep-copy an encounter under fresh ids and make the copy active. */
export function duplicateEncounter(encounterId: string): void {
  if (sharedRollPending) {
    sharedRollGeneration += 1;
    clearSharedRollPending();
  }
  const sourceName =
    state.value.encounters.find((item) => item.id === encounterId)?.name ?? "encounter";
  const stepId = mutateApp(
    (draft) => {
      const source = draft.encounters.find((item) => item.id === encounterId);
      if (!source) return;
      const copy: Encounter = structuredClone(source);
      copy.id = uid("enc");
      copy.name = `${source.name} (copy)`;
      copy.updatedAt = Date.now();
      // Regenerate all internal ids so the copy never collides with the source
      // encounter's Owlbear token/minion-group links or selection state.
      const groupIds = new Map<string, string>();
      for (const group of copy.groups) {
        const nextId = uid("group");
        groupIds.set(group.id, nextId);
        group.id = nextId;
      }
      copy.activePrepGroupId = groupIds.get(copy.activePrepGroupId) ?? copy.groups[0]?.id ?? "";
      const entryIds = new Map<string, string>();
      for (const item of copy.items) {
        const nextId = uid("entry");
        entryIds.set(item.id, nextId);
        item.id = nextId;
        item.groupId = groupIds.get(item.groupId) ?? copy.activePrepGroupId;
      }
      const instanceIds = new Map<string, string>();
      for (const instance of copy.combat.instances) {
        const nextId = uid("inst");
        instanceIds.set(instance.id, nextId);
        instance.id = nextId;
      }
      for (const instance of copy.combat.instances) {
        instance.groupId = groupIds.get(instance.groupId) ?? copy.activePrepGroupId;
        if (instance.entryId) {
          const mapped = entryIds.get(instance.entryId);
          if (mapped) instance.entryId = mapped;
        }
        if (instance.captainId) {
          const mapped = instanceIds.get(instance.captainId);
          if (mapped) instance.captainId = mapped;
          else delete instance.captainId;
        }
        if (instance.summonedBy) {
          const mapped = instanceIds.get(instance.summonedBy);
          if (mapped) instance.summonedBy = mapped;
          else delete instance.summonedBy;
        }
      }
      if (copy.combat.activeGroupFilter) {
        copy.combat.activeGroupFilter = groupIds.get(copy.combat.activeGroupFilter) ?? null;
      }
      for (const effect of copy.combat.activeEffects) {
        effect.id = uid("eff");
      }
      const index = draft.encounters.indexOf(source);
      draft.encounters.splice(index + 1, 0, copy);
      draft.activeEncounterId = copy.id;
    },
    { label: `Duplicated ${sourceName}` },
  );
  toast("Encounter duplicated", { undoStepId: stepId });
}

export function deleteEncounter(encounterId: string): void {
  if (state.value.encounters.length === 1) {
    toast("At least one encounter is required.");
    return;
  }
  const target = state.value.encounters.find((item) => item.id === encounterId);
  if (!target) return;
  const name = target.name;
  const stepId = mutateApp(
    (draft) => {
      const index = draft.encounters.findIndex((item) => item.id === encounterId);
      if (index === -1) return;
      draft.encounters.splice(index, 1);
      if (draft.activeEncounterId === encounterId) {
        const fallback = draft.encounters[Math.max(0, index - 1)] as Encounter;
        draft.activeEncounterId = fallback.id;
      }
    },
    { label: `Deleted ${name}` },
  );
  toast(`Deleted ${name}`, { undoStepId: stepId });
}

/** Clear the active encounter back to empty (party params preserved). */
export function resetActiveEncounter(): void {
  const stepId = mutate(
    (draft) => {
      draft.groups = [
        { id: uid("group"), name: "A" },
        { id: uid("group"), name: "B" },
      ];
      draft.activePrepGroupId = (draft.groups[0] as Group).id;
      draft.encounter = [];
      draft.combat = defaultCombat();
      draft.view = "builder";
    },
    { label: "Cleared encounter" },
  );
  toast("Encounter cleared", { undoStepId: stepId });
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
    draft.ui.fitsBudget = false;
    draft.ui.inEncounter = false;
  });
}

export function toggleFitsBudget(): void {
  mutate((draft) => {
    draft.ui.fitsBudget = !draft.ui.fitsBudget;
  });
}

export function toggleInEncounter(): void {
  mutate((draft) => {
    draft.ui.inEncounter = !draft.ui.inEncounter;
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

/** Recommended monster level window around the active party's level (±1),
    clamped to catalog bounds. */
export function partyLevelWindow(bounds: readonly [number, number]): [number, number] {
  const level = activeEncounter().party.level;
  const lo = Math.max(bounds[0], level - 1);
  const hi = Math.min(bounds[1], level + 1);
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

export function isPartyLevelWindowActive(ui: UIState, bounds: readonly [number, number]): boolean {
  const [lo, hi] = partyLevelWindow(bounds);
  const expectedMin = lo <= bounds[0] ? null : lo;
  const expectedMax = hi >= bounds[1] ? null : hi;
  if (expectedMin === null && expectedMax === null) return false;
  return ui.levelMin === expectedMin && ui.levelMax === expectedMax;
}

export function togglePartyLevelWindow(bounds: readonly [number, number]): void {
  const ui = state.value.ui;
  if (isPartyLevelWindowActive(ui, bounds)) {
    setRangeFilter("level", null, null);
    return;
  }
  const [lo, hi] = partyLevelWindow(bounds);
  setRangeFilter("level", lo <= bounds[0] ? null : lo, hi >= bounds[1] ? null : hi);
}

export function activeFilterCount(ui: UIState): number {
  return (
    (ui.role !== "all" ? 1 : 0) +
    (ui.fitsBudget ? 1 : 0) +
    (ui.inEncounter ? 1 : 0) +
    hiddenFilterCount(ui)
  );
}

// Active filters that live inside the collapsible "More" panel (everything
// except primary bar chips). When `levelBounds` is provided, a level range
// already represented by the visible "Lv X–Y" primary chip is not double-counted.
export function hiddenFilterCount(ui: UIState, levelBounds?: readonly [number, number]): number {
  let count = ui.roles.length + ui.sizes.length + ui.keywords.length;
  const hasLevel = ui.levelMin !== null || ui.levelMax !== null;
  if (hasLevel && !(levelBounds && isPartyLevelWindowActive(ui, levelBounds))) count += 1;
  if (ui.evMin !== null || ui.evMax !== null) count += 1;
  return count;
}

/** Remaining EV before crossing the next difficulty threshold: before Hard
    while still under the Standard ceiling, then before Extreme while under the
    Hard ceiling, else 0. */
export function evBudgetRemaining(): { remaining: number; nextBand: "Hard" | "Extreme" } {
  const { ev } = encounterTotals();
  const { partyES, oneHeroES } = partyMath(activeEncounter().party);
  const standardCap = partyES + oneHeroES;
  if (ev < standardCap) return { remaining: Math.max(0, standardCap - ev), nextBand: "Hard" };
  const hardCap = partyES + 3 * oneHeroES;
  return { remaining: Math.max(0, hardCap - ev), nextBand: "Extreme" };
}

/** Map of base monster path -> total count currently in the encounter roster. */
export function fieldedCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of activeEncounter().items) {
    const path = basePath(item.sourcePath);
    counts.set(path, (counts.get(path) ?? 0) + item.count);
  }
  return counts;
}

function monsterMatchesFilters(m: Monster, ui: UIState, remainingEv: number): boolean {
  if (ui.role !== "all" && normalizeToken(m.organization) !== normalizeToken(ui.role)) return false;
  if (ui.fitsBudget && !fitsEvBudget(m, remainingEv)) return false;
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

export function needsMonsterData(ui: UIState, parsed?: ParsedQuery): boolean {
  const q = parsed ?? parseQuery(ui.search);
  return (
    ui.role !== "all" ||
    ui.fitsBudget ||
    ui.roles.length > 0 ||
    ui.sizes.length > 0 ||
    ui.keywords.length > 0 ||
    ui.levelMin !== null ||
    ui.levelMax !== null ||
    ui.evMin !== null ||
    ui.evMax !== null ||
    ui.sort !== "name" ||
    Boolean(q.level || q.ev)
  );
}

export function parsedSearch(search = state.value.ui.search): ParsedQuery {
  return parseQuery(search);
}

export function matchedCatalog(): {
  matches: CatalogMatch[];
  parsed: ParsedQuery;
  hiddenByFilters: number;
} {
  void monstersVersion.value; // subscribe: matches change as statblocks hydrate
  const ui = state.value.ui;
  const parsed = parseQuery(ui.search);
  const requiresData = needsMonsterData(ui, parsed);
  const { remaining } = evBudgetRemaining();
  const fielded = ui.inEncounter ? fieldedCounts() : null;
  const matches: CatalogMatch[] = [];
  let hiddenByFilters = 0;

  for (const entry of catalog.value) {
    const found = matchCatalogEntry(entry, parsed);
    if (!found) continue;
    if (fielded && !fielded.has(entry.path)) {
      hiddenByFilters += 1;
      continue;
    }
    if (requiresData) {
      if (!entry.monster) continue;
      if (!monsterMatchesFilters(entry.monster, ui, remaining)) {
        hiddenByFilters += 1;
        continue;
      }
    }
    matches.push(found);
  }

  const searching = parsed.words.length > 0;
  matches.sort((a, b) => {
    if (ui.sort === "level") {
      return (
        (a.entry.monster?.level ?? 0) - (b.entry.monster?.level ?? 0) ||
        (searching ? b.score - a.score : 0) ||
        a.entry.derivedName.localeCompare(b.entry.derivedName)
      );
    }
    if (ui.sort === "ev") {
      return (
        (a.entry.monster?.ev ?? 0) - (b.entry.monster?.ev ?? 0) ||
        (searching ? b.score - a.score : 0) ||
        a.entry.derivedName.localeCompare(b.entry.derivedName)
      );
    }
    return (
      (searching ? b.score - a.score : 0) || a.entry.derivedName.localeCompare(b.entry.derivedName)
    );
  });

  return { matches, parsed, hiddenByFilters };
}

export function filteredCatalog(): CatalogEntry[] {
  return matchedCatalog().matches.map((item) => item.entry);
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
  mutate(
    (draft) => {
      createGroupRecord(draft);
    },
    { label: "Added group" },
  );
}

export function createGroupForDrop(): Group {
  let created: Group | undefined;
  mutate(
    (draft) => {
      created = createGroupRecord(draft);
    },
    { label: "Added group" },
  );
  if (!created) throw new Error("group creation failed");
  return created;
}

export function removeGroup(groupId: string): void {
  if (activeEncounter().groups.length === 1) {
    toast("At least one group is required.");
    return;
  }
  const name = activeEncounter().groups.find((g) => g.id === groupId)?.name ?? "group";
  const stepId = mutate(
    (draft) => {
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
    },
    { label: `Removed group ${name}` },
  );
  toast(`Removed group ${name}`, { undoStepId: stepId });
}

export function renameGroup(groupId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  mutate(
    (draft) => {
      const group = draft.groups.find((item) => item.id === groupId);
      if (group) group.name = trimmed;
    },
    { label: `Renamed group to ${trimmed}`, key: `group-name:${groupId}` },
  );
}

export function selectPrepGroup(groupId: string): void {
  mutate((draft) => {
    draft.activePrepGroupId = groupId;
  });
}

/** True once combat has progressed past a fresh Round 1 board (turns taken,
    damage dealt, Malice spent, conditions, active effects, summons, or round > 1). */
export function hasCombatProgress(enc: Encounter): boolean {
  const c = enc.combat;
  if (!c.active) return false;
  if (c.round > 1) return true;
  if (c.activeEffects.length > 0) return true;
  if (c.instances.length > 0 && c.malice !== partyMath(enc.party).roundOne) return true;
  return c.instances.some(
    (inst) =>
      inst.currentStamina !== inst.maxStamina ||
      inst.turnsTaken > 0 ||
      inst.conditions.length > 0 ||
      inst.reactions.length > 0 ||
      inst.villainRounds.some((r) => r > 0) ||
      Boolean(inst.captainId) ||
      inst.summonedBy !== undefined,
  );
}

function squadInFight(entryId: string): boolean {
  const inst = activeEncounter().combat.instances.find((item) => item.entryId === entryId);
  if (!inst) return false;
  return (
    inst.currentStamina !== inst.maxStamina ||
    inst.turnsTaken > 0 ||
    inst.conditions.length > 0 ||
    inst.reactions.length > 0 ||
    Boolean(inst.captainId)
  );
}

/** Reconcile combat instances in-place against `draft.encounter`, auto-starting
    combat at Round 1 once the encounter has any monsters. */
function syncCombatDraft(draft: MutableDraft, autoActivate = true): void {
  if (!draft.encounter.length) {
    const summons = draft.combat.instances.filter((item) => item.summonedBy !== undefined);
    draft.combat.instances = summons;
    if (!summons.length) {
      draft.combat.active = false;
      draft.combat.activeGroupFilter = null;
    }
    return;
  }
  if (!draft.combat.active) {
    if (!autoActivate) return;
    draft.combat.active = true;
    draft.combat.round = 1;
    draft.combat.malice = partyMath(draft.party).roundOne;
  }

  // Normalize any legacy minion entries whose statblocks are now loaded.
  draft.encounter = draft.encounter.flatMap((item) => {
    if (item.squad) return [item];
    const m = monsterAt(item.sourcePath);
    if (!item.squads?.length && !(m && isMinion(m))) return [item];
    const sizes = squadSizes(item);
    const entries = sizes.map((size, i): EncounterItem => ({
      id: i ? uid("enc") : item.id,
      sourcePath: item.sourcePath,
      groupId: item.groupId,
      count: size,
      squad: true,
    }));
    draft.combat.instances
      .filter((instance) => instance.entryId === item.id)
      .forEach((instance, i) => {
        const entry = entries[i];
        if (entry) instance.entryId = entry.id;
      });
    return entries;
  });

  const kept: CombatInstance[] = [];
  const counters = new Map<string, number>();
  const bump = (path: string) => {
    const next = (counters.get(path) || 0) + 1;
    counters.set(path, next);
    return next;
  };

  const byEntry = new Map<string, CombatInstance[]>();
  for (const instance of draft.combat.instances) {
    if (!instance.entryId) continue;
    const list = byEntry.get(instance.entryId);
    if (list) list.push(instance);
    else byEntry.set(instance.entryId, [instance]);
  }

  for (const entry of draft.encounter) {
    const m = monsterAt(entry.sourcePath);
    if (!m) continue;
    const current = byEntry.get(entry.id) ?? [];
    for (const instance of current) instance.groupId = entry.groupId;

    if (entry.squad) {
      const squad = current[0];
      const n = bump(basePath(entry.sourcePath));
      if (!squad) {
        kept.push(newSquad(entry, m, entry.count, n));
      } else {
        resizeSquad(squad, entry.count, minionStamina(squad, m));
        kept.push(squad);
      }
      continue;
    }

    const survivors = current.slice(0, entry.count);
    for (const survivor of survivors) {
      bump(basePath(entry.sourcePath));
      kept.push(survivor);
    }
    for (let i = survivors.length; i < entry.count; i += 1)
      kept.push(newCreature(entry, m, bump(basePath(entry.sourcePath))));
  }
  kept.push(...draft.combat.instances.filter((instance) => instance.summonedBy !== undefined));

  for (const squad of kept) {
    if (squad.captainId && !kept.some((item) => item.id === squad.captainId)) detachCaptain(squad);
  }
  draft.combat.instances = kept;
}

export async function addToEncounterInGroup(
  sourcePath: string,
  count: number,
  groupId: string,
  { announce = true } = {},
): Promise<boolean> {
  try {
    const monster = await loadMonster(sourcePath);
    const amount = Math.max(1, Math.min(30, Number(count) || 1));
    const stepId = mutate(
      (draft) => {
        const targetGroupId = draft.groups.some((group) => group.id === groupId)
          ? groupId
          : draft.activePrepGroupId;
        if (isMinion(monster)) {
          // Minions arrive as squads of their own, four to a squad.
          for (const size of defaultSquads(amount))
            draft.encounter.push({
              id: uid("enc"),
              sourcePath,
              groupId: targetGroupId,
              count: size,
              squad: true,
            });
        } else {
          const existing = draft.encounter.find(
            (item) => item.sourcePath === sourcePath && item.groupId === targetGroupId,
          );
          if (existing) existing.count += amount;
          else
            draft.encounter.push({
              id: uid("enc"),
              sourcePath,
              groupId: targetGroupId,
              count: amount,
            });
        }
        draft.activePrepGroupId = targetGroupId;
        syncCombatDraft(draft);
      },
      { label: `Added ${amount} × ${monster.name}` },
    );
    if (announce) toast(`Added ${amount} × ${monster.name}`, { undoStepId: stepId });
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
  const existing = activeEncounter().items.find((entry) => entry.id === itemId);
  if (!existing) return;
  const name = monsterNameForPath(existing.sourcePath);
  const nextCount = existing.count + delta;
  const stepId = mutate(
    (draft) => {
      const item = draft.encounter.find((entry) => entry.id === itemId);
      if (!item) return;
      const next = item.count + delta;
      if (next <= 0) {
        draft.encounter = draft.encounter.filter((entry) => entry.id !== itemId);
      } else {
        item.count = next;
      }
      syncCombatDraft(draft);
    },
    {
      label: nextCount <= 0 ? `Removed ${name}` : `${name}: ${nextCount}`,
      ...(nextCount > 0 ? { key: `entry-count:${itemId}` } : {}),
    },
  );
  if (nextCount <= 0) toast(`Removed ${name}`, { undoStepId: stepId });
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
    squad that has already taken wounds or combat marks can't be split fairly. */
export function canPeelEntry(item: EncounterItem, amount = 1): boolean {
  if (item.count <= amount) return false;
  return !(item.squad && squadInFight(item.id));
}

/**
 * Take `amount` off an entry and put it in `groupId`: creatures join an entry
 * of their monster already there, minions form a new squad. On the board the
 * newest creatures go, wounds and all.
 */
export function peelToGroup(itemId: string, groupId: string, amount = 1): void {
  const item = activeEncounter().items.find((entry) => entry.id === itemId);
  if (!item || !canPeelEntry(item, amount)) return;
  const name = monsterNameForPath(item.sourcePath);
  const id = uid("enc");
  let landed = id;
  mutate(
    (draft) => {
      const source = draft.encounter.find((entry) => entry.id === itemId);
      if (!source || !draft.groups.some((group) => group.id === groupId)) return;
      source.count -= amount;
      const moving = draft.combat.instances
        .filter((each) => each.entryId === itemId)
        .slice(-amount);
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
        if (groupId === source.groupId)
          draft.encounter.splice(draft.encounter.indexOf(source) + 1, 0, peeled);
        else draft.encounter.push(peeled);
      }
      for (const instance of moving) {
        instance.entryId = landed;
        instance.groupId = groupId;
      }
      syncCombatDraft(draft);
    },
    { label: `Split ${name}` },
  );
  markFresh(landed);
}

/** Whether minions can move from squad `fromId` into squad `toId`: two
    squads of the same minion, before either squad has taken combat wounds. */
export function canTransferMinions(fromId: string, toId: string): boolean {
  const { items } = activeEncounter();
  const from = items.find((entry) => entry.id === fromId);
  const to = items.find((entry) => entry.id === toId);
  return Boolean(
    from?.squad &&
    to?.squad &&
    from.id !== to.id &&
    !squadInFight(from.id) &&
    !squadInFight(to.id) &&
    from.sourcePath === to.sourcePath,
  );
}

/** Move `amount` minions from one squad into another of the same minion. */
export function transferMinions(fromId: string, toId: string, amount = 1): void {
  if (!canTransferMinions(fromId, toId)) return;
  const fromEntry = activeEncounter().items.find((entry) => entry.id === fromId);
  const name = fromEntry ? monsterNameForPath(fromEntry.sourcePath) : "minions";
  mutate(
    (draft) => {
      const from = draft.encounter.find((entry) => entry.id === fromId);
      const to = draft.encounter.find((entry) => entry.id === toId);
      if (!from || !to) return;
      const moved = Math.min(amount, from.count);
      to.count += moved;
      from.count -= moved;
      if (!from.count) draft.encounter = draft.encounter.filter((entry) => entry.id !== fromId);
      syncCombatDraft(draft);
    },
    { label: `Moved ${name}` },
  );
  markFresh(toId);
}

export function removeEncounterEntry(itemId: string): void {
  const entry = activeEncounter().items.find((item) => item.id === itemId);
  if (!entry) return;
  const name = monsterNameForPath(entry.sourcePath);
  const stepId = mutate(
    (draft) => {
      draft.encounter = draft.encounter.filter((item) => item.id !== itemId);
      syncCombatDraft(draft);
    },
    { label: `Removed ${name}` },
  );
  toast(`Removed ${name}`, { undoStepId: stepId });
}

/** Move an entry, and its creatures on the board, to another group. Plain
    creatures join an entry of the same monster already there; a squad stays
    its own squad. */
export function moveEncounterEntryToGroup(itemId: string, groupId: string): void {
  const entry = activeEncounter().items.find((item) => item.id === itemId);
  if (!entry || entry.groupId === groupId) return;
  const name = monsterNameForPath(entry.sourcePath);
  const groupName = activeEncounter().groups.find((g) => g.id === groupId)?.name ?? "group";
  mutate(
    (draft) => {
      const item = draft.encounter.find((each) => each.id === itemId);
      if (!item || !draft.groups.some((group) => group.id === groupId) || item.groupId === groupId)
        return;
      const linked = draft.combat.instances.filter((instance) => instance.entryId === itemId);
      linked.forEach((instance) => {
        instance.groupId = groupId;
      });
      const existing = item.squad
        ? undefined
        : draft.encounter.find(
            (each) =>
              each.id !== item.id &&
              !each.squad &&
              each.sourcePath === item.sourcePath &&
              each.groupId === groupId,
          );
      if (existing) {
        existing.count += item.count;
        linked.forEach((instance) => {
          instance.entryId = existing.id;
        });
        draft.encounter = draft.encounter.filter((each) => each.id !== item.id);
      } else {
        item.groupId = groupId;
      }
      syncCombatDraft(draft);
    },
    { label: `Moved ${name} to ${groupName}` },
  );
}

export function clearEncounter(): void {
  const stepId = mutate(
    (draft) => {
      draft.encounter = [];
      syncCombatDraft(draft);
    },
    { label: "Cleared encounter" },
  );
  toast("Encounter cleared", { undoStepId: stepId });
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
    const loaded = members.every((item) => !!monsterAt(item.sourcePath));
    if (!loaded) {
      result.set(group.id, { ev: null, off: null });
      continue;
    }
    const ev = members.reduce(
      (sum, item) => sum + (monsterAt(item.sourcePath)?.ev ?? 0) * item.count,
      0,
    );
    const single = members.length === 1 && !members[0]?.squad && members[0]?.count === 1;
    const off = ev > 2 * oneHeroES && !single ? "heavy" : ev < oneHeroES ? "light" : null;
    result.set(group.id, { ev, off });
  }
  return result;
}

/** The book's group count, about as many groups as heroes give or take
    two, when the roster's groups fall outside it. Encounters with a solo
    creature are exempt; empty groups don't count. */
export function groupCountAdvice(): {
  groups: number;
  heroes: number;
  lo: number;
  hi: number;
} | null {
  const { items, party } = activeEncounter();
  const groups = groupBalance().size;
  const solo = items.some(
    (item) => monsterAt(item.sourcePath)?.organization.toLowerCase() === "solo",
  );
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
    const m = monsterAt(item.sourcePath);
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
    ev += (monsterAt(item.sourcePath)?.ev ?? 0) * item.count;
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

export async function startCombat(options: { switchView?: boolean } = {}): Promise<void> {
  const encounter = activeEncounter();
  if (!encounter.items.length) return;
  const paths = [...new Set(encounter.items.map((item) => item.sourcePath))];
  const loaded = await Promise.allSettled(paths.map(loadMonster));
  if (activeEncounter() !== encounter) return;
  if (loaded.some((result) => result.status === "rejected")) {
    toast("Some SteelCompendium statblocks could not be loaded.");
    return;
  }

  const counters = new Map<string, number>();
  const bump = (path: string) => {
    const next = (counters.get(path) || 0) + 1;
    counters.set(path, next);
    return next;
  };
  mutate((draft) => {
    normalizeEntries(encounter);
    const instances: CombatInstance[] = [];
    for (const entry of encounter.items) {
      const m = monsterAt(entry.sourcePath);
      if (!m) continue;
      instances.push(...buildInstancesForEntry(entry, m, () => bump(basePath(entry.sourcePath))));
    }

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
    if (options.switchView !== false) draft.view = "combat";
  });
  if (options.switchView === false)
    toast(`Combat roster prepared · ${encounter.combat.malice} Malice`);
  else toast(`Combat started · ${encounter.combat.malice} Malice`);
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
/** Ensure the active encounter's combat board is hydrated and reconciled from
    Prep without discarding any in-progress stamina, conditions, or Malice. */
export async function ensureCombatReady(): Promise<void> {
  const encounter = activeEncounter();
  if (!encounter.items.length) return;
  const paths = [...new Set(encounter.items.map((item) => item.sourcePath))];
  const missing = paths.filter((path) => !monsterAt(path));
  if (missing.length) {
    await Promise.allSettled(missing.map(loadMonster));
    if (activeEncounter() !== encounter) return;
  }
  const expectedEntries = new Set(encounter.items.map((item) => item.id));
  const covered = new Set(encounter.combat.instances.map((item) => item.entryId).filter(Boolean));
  const needsSync = !encounter.combat.active || [...expectedEntries].some((id) => !covered.has(id));
  if (!needsSync) return;
  mutate((draft) => {
    syncCombatDraft(draft, true);
  });
}

/** Reset combat back to Round 1 with full Stamina, no conditions/effects,
    no summons, and recalculated Round 1 Malice — backed by Undo. */
export async function resetCombat(encounterId?: string): Promise<void> {
  const targetId = encounterId ?? state.value.activeEncounterId;
  const encounter = state.value.encounters.find((item) => item.id === targetId);
  if (!encounter || !encounter.items.length) return;
  const paths = [...new Set(encounter.items.map((item) => item.sourcePath))];
  const loaded = await Promise.allSettled(paths.map(loadMonster));
  if (!state.value.encounters.some((item) => item.id === targetId)) return;
  if (loaded.some((result) => result.status === "rejected")) {
    toast("Some SteelCompendium statblocks could not be loaded.");
    return;
  }

  const counters = new Map<string, number>();
  const bump = (path: string) => {
    const next = (counters.get(path) || 0) + 1;
    counters.set(path, next);
    return next;
  };
  let resetMalice = 0;
  const stepId = mutateApp(
    (app) => {
      const target = app.encounters.find((item) => item.id === targetId);
      if (!target) return;
      normalizeEntries(target);
      const instances: CombatInstance[] = [];
      for (const entry of target.items) {
        const m = monsterAt(entry.sourcePath);
        if (!m) continue;
        instances.push(...buildInstancesForEntry(entry, m, () => bump(basePath(entry.sourcePath))));
      }
      resetMalice = partyMath(target.party).roundOne;
      target.combat = {
        active: true,
        round: 1,
        malice: resetMalice,
        instances,
        activeGroupFilter: null,
        activeEffects: [],
        selectedMaliceFeatureIds: target.combat.selectedMaliceFeatureIds,
        maliceSelectionInitialized: target.combat.maliceSelectionInitialized,
      };
      target.updatedAt = Date.now();
    },
    { label: `Reset combat (${encounter.name})` },
  );
  toast(`Combat reset · ${resetMalice} Malice`, { undoStepId: stepId });
}

export function reconcileCombat(): void {
  if (!activeEncounter().combat.active) return;
  mutate((draft) => {
    syncCombatDraft(draft, false);
  });
}

export function nextRound(): void {
  if (!activeEncounter().combat.instances.length) return;
  const enc = activeEncounter();
  const next = enc.combat.round + 1;
  const stepId = mutate(
    (draft) => {
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
    },
    { label: `Round ${next}`, kind: `round:${enc.id}:${next}` },
  );
  const combat = activeEncounter().combat;
  toast(`Round ${combat.round} · +${activeEncounter().party.heroes + combat.round} Malice`, {
    undoStepId: stepId,
  });
}

/**
 * Step back one round and remove the Malice that advancing into the current
 * round granted. When that round advance is in this session's undo history,
 * restores the turn marks, reactions, and active effects that were live when
 * the round ended without discarding Stamina changes made since.
 */
export function previousRound(): void {
  const enc = activeEncounter();
  if (enc.combat.round <= 1) return;
  const currentRound = enc.combat.round;
  const targetRound = currentRound - 1;
  const roundStep = [...historyState.value.past]
    .reverse()
    .find((step) => step.kind === `round:${enc.id}:${currentRound}`);
  const prevEnc = roundStep?.before.encounters.find((item) => item.id === enc.id);
  const prevMarks = prevEnc
    ? new Map(
        prevEnc.combat.instances.map((item) => [
          item.id,
          { turnsTaken: item.turnsTaken, reactions: structuredClone(item.reactions) },
        ]),
      )
    : null;
  const prevEffects = prevEnc ? structuredClone(prevEnc.combat.activeEffects) : null;

  const stepId = mutate(
    (draft) => {
      const undoneGain = draft.party.heroes + draft.combat.round;
      draft.combat.malice = Math.max(0, draft.combat.malice - undoneGain);
      draft.combat.round -= 1;
      draft.combat.instances.forEach((instance) => {
        const saved = prevMarks?.get(instance.id);
        instance.turnsTaken = saved ? Math.min(instance.turns, saved.turnsTaken) : 0;
        instance.reactions = saved ? saved.reactions : [];
      });
      if (prevEffects) {
        const existingIds = new Set(draft.combat.activeEffects.map((effect) => effect.id));
        for (const effect of prevEffects) {
          if (!existingIds.has(effect.id)) draft.combat.activeEffects.push(effect);
        }
      }
    },
    { label: `Back to round ${targetRound}` },
  );
  const combat = activeEncounter().combat;
  toast(`Round ${combat.round} · −${activeEncounter().party.heroes + (combat.round + 1)} Malice`, {
    undoStepId: stepId,
  });
}

export function adjustMalice(delta: number): void {
  mutate(
    (draft) => {
      draft.combat.malice = Math.max(0, draft.combat.malice + delta);
    },
    { label: delta > 0 ? `+${delta} Malice` : `−${Math.abs(delta)} Malice`, key: "malice" },
  );
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
  const inst = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!inst) return;
  const clearing = index < inst.turnsTaken;
  mutate(
    (draft) => {
      const instance = draft.combat.instances.find((item) => item.id === instanceId);
      if (!instance) return;
      instance.turnsTaken =
        index < instance.turnsTaken ? index : Math.min(instance.turns, index + 1);
    },
    { label: `${clearing ? "Unmarked" : "Marked"} turn for ${inst.name}` },
  );
}

/** Override how many turns a creature takes each round. */
export function adjustTurns(instanceId: string, delta: number): void {
  const inst = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!inst) return;
  mutate(
    (draft) => {
      const instance = draft.combat.instances.find((item) => item.id === instanceId);
      if (!instance) return;
      instance.turns = clampInt(instance.turns + delta, 1, MAX_TURNS);
      instance.turnsTaken = Math.min(instance.turnsTaken, instance.turns);
    },
    { label: `Turns for ${inst.name}` },
  );
}

/** Remove one creature or squad from Run, syncing its Prep entry and EV.
    Summoned creatures have no Prep entry and leave only the board. */
export function removeInstance(instanceId: string): void {
  const inst = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!inst) return;
  let lost: string[] = [];
  const stepId = mutate(
    (draft) => {
      const target = draft.combat.instances.find((item) => item.id === instanceId);
      if (!target) return;
      lost = releaseCaptain(draft.combat.instances, instanceId).map((squad) => squad.name);
      draft.combat.instances = draft.combat.instances.filter((item) => item.id !== instanceId);
      if (target.entryId) {
        const entry = draft.encounter.find((item) => item.id === target.entryId);
        if (entry) {
          if (entry.squad || entry.count <= 1) {
            draft.encounter = draft.encounter.filter((item) => item.id !== entry.id);
          } else {
            entry.count -= 1;
          }
        }
      }
      if (!draft.encounter.length && !draft.combat.instances.length) {
        draft.combat.active = false;
        draft.combat.activeGroupFilter = null;
      }
    },
    { label: `Removed ${inst.name}` },
  );
  const captainNote = lost.length
    ? ` · ${lost.join(", ")} lost ${lost.length > 1 ? "their" : "its"} captain`
    : "";
  toast(`Removed ${inst.name}${captainNote}`, { undoStepId: stepId });
}

/** Remove an entire monster lane (all copies/squads, including summons) from
    both Run and Prep in one undoable step. */
export function removeLane(sourcePath: string): void {
  const enc = activeEncounter();
  const matching = enc.combat.instances.filter((item) => item.sourcePath === sourcePath);
  const entries = enc.items.filter((item) => item.sourcePath === sourcePath);
  if (!matching.length && !entries.length) return;
  const name = monsterNameForPath(sourcePath);
  const count = matching.length || entries.reduce((sum, item) => sum + item.count, 0);
  const label = count > 1 ? `Removed ${name} (${count})` : `Removed ${name}`;
  const stepId = mutate(
    (draft) => {
      const removedIds = new Set(
        draft.combat.instances
          .filter((item) => item.sourcePath === sourcePath)
          .map((item) => item.id),
      );
      for (const id of removedIds) releaseCaptain(draft.combat.instances, id);
      draft.combat.instances = draft.combat.instances.filter(
        (item) => item.sourcePath !== sourcePath,
      );
      draft.encounter = draft.encounter.filter((item) => item.sourcePath !== sourcePath);
      if (!draft.encounter.length && !draft.combat.instances.length) {
        draft.combat.active = false;
        draft.combat.activeGroupFilter = null;
      }
    },
    { label },
  );
  toast(label, { undoStepId: stepId });
}

/** Add one more copy (or one default minion squad) directly onto an existing
    Run lane, keeping Prep and EV in sync. */
export async function addAnotherInLane(sourcePath: string): Promise<boolean> {
  const enc = activeEncounter();
  const filterGroup = enc.combat.activeGroupFilter;
  const laneInstances = enc.combat.instances.filter((item) => item.sourcePath === sourcePath);
  const fallbackGroup =
    [...laneInstances].reverse().find((item) => item.summonedBy === undefined)?.groupId ??
    laneInstances[laneInstances.length - 1]?.groupId ??
    enc.activePrepGroupId;
  const groupId = filterGroup ?? fallbackGroup;
  try {
    const monster = await loadMonster(sourcePath);
    const count = isMinion(monster) ? Math.max(1, monster.defaultQty) : 1;
    return await addToEncounterInGroup(sourcePath, count, groupId);
  } catch {
    toast("Could not load that statblock.");
    return false;
  }
}

function isUntouchedInstance(instance: CombatInstance, all: CombatInstance[]): boolean {
  return (
    instance.currentStamina === instance.maxStamina &&
    instance.turnsTaken === 0 &&
    instance.conditions.length === 0 &&
    instance.reactions.length === 0 &&
    !instance.captainId &&
    !all.some((other) => other.captainId === instance.id)
  );
}

/** Smart decrement for library FieldSteppers: removes the newest untouched
    non-summoned instance of `monsterPath`, falling back to the newest copy. */
export function decrementMonster(monsterPath: string): void {
  const enc = activeEncounter();
  const targetBase = basePath(monsterPath);
  const candidates = enc.combat.instances.filter(
    (item) => basePath(item.sourcePath) === targetBase && item.summonedBy === undefined,
  );
  if (candidates.length) {
    const pick =
      [...candidates].reverse().find((item) => isUntouchedInstance(item, enc.combat.instances)) ??
      candidates[candidates.length - 1]!;
    removeInstance(pick.id);
    return;
  }
  const entry = [...enc.items].reverse().find((item) => basePath(item.sourcePath) === targetBase);
  if (!entry) return;
  if (entry.squad || entry.count <= 1) removeEncounterEntry(entry.id);
  else changeEncounterCount(entry.id, -1);
}

// ---------- Summons ----------

/** The squad limits a creature on the board prints, if it prints any. */
export function summonerRules(summoner: CombatInstance): SquadRules | null {
  const m = monsterAt(summoner.sourcePath);
  return m ? squadRules(m, catalog.value, (path) => monsterAt(path)) : null;
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
  const stepId = mutate(
    (draft) => {
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
      const near = same.length
        ? same
        : instances.filter((item) => item.sourcePath === summoner.sourcePath);
      const after = near.length
        ? instances.indexOf(near[near.length - 1] as CombatInstance) + 1
        : instances.length;
      instances.splice(after, 0, ...added);
      draft.combat.malice -= malice;
      summoned =
        `${summoner.name} summons ${count - dropped} × ${m.name}${malice ? ` · −${malice} Malice` : ""}` +
        (dropped ? ` · ${dropped} more find no room in their squads` : "");
    },
    { label: `Summoned ${count} × ${m.name}` },
  );
  if (summoned) toast(summoned, { undoStepId: stepId });
}

// ---------- Squad captains ----------

/** Attach a captain: each minion gains the "With Captain" benefit, and a
    Stamina bonus lands on every minion still standing. */
function attachCaptain(squad: CombatInstance, captainId: string): void {
  const m = monsterAt(squad.sourcePath);
  const bonus = m ? captainStaminaBonus(m) : 0;
  if (m && bonus) {
    squad.currentStamina += bonus * standing(squad.currentStamina, m.stamina);
    squad.maxStamina = (m.stamina + bonus) * squad.count;
  }
  squad.captainId = captainId;
}

/** Detach a squad's captain, taking back any Stamina bonus it granted. */
function detachCaptain(squad: CombatInstance): void {
  const m = monsterAt(squad.sourcePath);
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
export function releaseCaptain(instances: CombatInstance[], captainId: string): CombatInstance[] {
  const led = instances.filter((item) => item.captainId === captainId);
  led.forEach(detachCaptain);
  return led;
}

/** The creatures that could captain `squad` now: standing non-minion,
    non-mount creatures, including one leading another squad (a creature
    captains one squad at a time, so picking it moves it here). */
export function captainCandidates(squad: CombatInstance): CombatInstance[] {
  return activeEncounter()
    .combat.instances.filter((item) => {
      if (item.kind !== "creature" || item.currentStamina <= 0) return false;
      const m = monsterAt(item.sourcePath);
      return !!m && canCaptain(m);
    })
    .filter((item) => item.id !== squad.id);
}

/** Put `captainId` in charge of a squad, or clear its captain with null. A
    squad has one captain and a captain leads one squad, so both sides let go
    of any previous link. */
export function setSquadCaptain(squadId: string, captainId: string | null): void {
  const existingSquad = activeEncounter().combat.instances.find((item) => item.id === squadId);
  if (
    !existingSquad ||
    existingSquad.kind !== "minion-squad" ||
    existingSquad.captainId === (captainId ?? undefined)
  )
    return;
  const captainName = captainId
    ? activeEncounter().combat.instances.find((item) => item.id === captainId)?.name
    : undefined;
  let named = "";
  const stepId = mutate(
    (draft) => {
      const instances = draft.combat.instances;
      const squad = instances.find((item) => item.id === squadId);
      if (!squad || squad.kind !== "minion-squad" || squad.captainId === (captainId ?? undefined))
        return;
      if (squad.captainId) detachCaptain(squad);
      if (!captainId) return;
      const captain = instances.find((item) => item.id === captainId);
      if (!captain || captain.kind !== "creature") return;
      releaseCaptain(instances, captainId);
      attachCaptain(squad, captainId);
      named = `${captain.name} leads ${squad.name}`;
    },
    {
      label: captainName
        ? `${captainName} leads ${existingSquad.name}`
        : `Cleared captain on ${existingSquad.name}`,
    },
  );
  if (named) toast(named, { undoStepId: stepId });
}

export function renameInstance(instanceId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  mutate(
    (draft) => {
      const instance = draft.combat.instances.find((item) => item.id === instanceId);
      if (instance) instance.name = trimmed;
    },
    { label: `Renamed to ${trimmed}`, key: `inst-name:${instanceId}` },
  );
}

/** Move one creature or squad to another group from the board. Prep follows:
    an entry that holds only this instance moves with it, and a creature from
    a larger entry splits off into an entry of its own. */
export function setInstanceGroup(instanceId: string, groupId: string): void {
  const inst = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!inst || inst.groupId === groupId) return;
  const groupName = activeEncounter().groups.find((g) => g.id === groupId)?.name ?? "group";
  mutate(
    (draft) => {
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
      const split: EncounterItem = {
        id: uid("enc"),
        sourcePath: entry.sourcePath,
        groupId,
        count: 1,
      };
      draft.encounter.splice(draft.encounter.indexOf(entry) + 1, 0, split);
      instance.entryId = split.id;
    },
    { label: `Moved ${inst.name} to ${groupName}` },
  );
}

// ---------- Monster levels ----------

/** A creature's Stamina carried to the statblock at another level: its
    maximum scales with the statblock's, and it keeps the same share of it,
    so a winded creature stays winded. */
function rescaleStamina(instance: CombatInstance, from: Monster, to: Monster): void {
  if (!from.stamina) return;
  const ratio = to.stamina / from.stamina;
  const max = Math.max(1, Math.ceil(instance.maxStamina * ratio - 1e-9));
  const share = instance.maxStamina ? instance.currentStamina / instance.maxStamina : 1;
  instance.currentStamina =
    instance.currentStamina <= 0 ? instance.currentStamina : Math.round(max * share);
  instance.maxStamina = max;
}

/**
 * Put prep entries, and their creatures on the board, at another level. A
 * creature entry that lands on an entry of the same monster at that level in
 * its group joins it, as moving it between groups would.
 */
function relevel(
  draft: MutableDraft,
  entryIds: ReadonlySet<string>,
  fromKey: string,
  level: number,
  summoned: boolean,
): void {
  const printed = monsterAt(basePath(fromKey));
  const from = monsterAt(fromKey);
  if (!printed || !from) return;
  const key = levelKey(fromKey, level, printed.level);
  const to = monsterAt(key);
  if (!to || key === fromKey) return;
  for (const instance of draft.combat.instances) {
    const moving = instance.entryId
      ? entryIds.has(instance.entryId)
      : summoned && instance.sourcePath === fromKey;
    if (!moving || instance.sourcePath !== fromKey) continue;
    instance.sourcePath = key;
    rescaleStamina(instance, from, to);
  }
  for (const entry of draft.encounter.filter((item) => entryIds.has(item.id))) {
    entry.sourcePath = key;
    if (entry.squad) continue;
    const join = draft.encounter.find(
      (item) =>
        item.id !== entry.id &&
        !item.squad &&
        item.sourcePath === key &&
        item.groupId === entry.groupId,
    );
    if (!join) continue;
    join.count += entry.count;
    for (const instance of draft.combat.instances)
      if (instance.entryId === entry.id) instance.entryId = join.id;
    draft.encounter = draft.encounter.filter((item) => item.id !== entry.id);
  }
}

/** Set every creature of one statblock lane to `level`: the prep entries it
    was dealt from, and anything summoned onto it. */
export function setLaneLevel(key: string, level: number): string | null {
  const printed = monsterAt(basePath(key));
  if (!printed) return null;
  const ids = new Set(
    activeEncounter()
      .items.filter((item) => item.sourcePath === key)
      .map((item) => item.id),
  );
  mutate((draft) => relevel(draft, ids, key, level, true), {
    label: `${printed.name}: Level ${level}`,
    key: `level:${basePath(key)}`,
  });
  const next = levelKey(key, level, printed.level);
  return activeEncounter().combat.instances.some((item) => item.sourcePath === next) ? next : null;
}

/** Set one prep entry to `level`; returns the key it is now at and the
    entry that holds it (another one, when it joined it). */
export function setEntryLevel(
  entryId: string,
  level: number,
): { key: string; entryId: string } | null {
  const entry = activeEncounter().items.find((item) => item.id === entryId);
  const printed = entry && monsterAt(basePath(entry.sourcePath));
  if (!entry || !printed) return null;
  const { groupId, sourcePath } = entry;
  mutate((draft) => relevel(draft, new Set([entryId]), sourcePath, level, false), {
    label: `${printed.name}: Level ${level}`,
    key: `level:${entryId}`,
  });
  const key = levelKey(sourcePath, level, printed.level);
  const items = activeEncounter().items;
  const holder =
    items.find((item) => item.id === entryId) ??
    items.find((item) => !item.squad && item.sourcePath === key && item.groupId === groupId);
  return { key, entryId: holder?.id ?? entryId };
}

export function applyStaminaCommand(instanceId: string, rawValue: string): number | null {
  const existing = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!existing) return null;
  const parsed = parseStaminaCommand(rawValue, existing.currentStamina);
  if (!parsed) return null;
  // A squad's pool can't gain temporary Stamina; a raise only puts back
  // what a slip of the pen took.
  const ceiling = existing.kind === "minion-squad" ? existing.maxStamina : Infinity;
  const clamped = Math.max(0, Math.min(ceiling, parsed.next));
  if (clamped === existing.currentStamina) return clamped;
  const diff = clamped - existing.currentStamina;
  const label =
    parsed.kind === "set"
      ? `${existing.name}: Stamina ${clamped}`
      : diff < 0
        ? `${existing.name}: −${Math.abs(diff)} Stamina`
        : `${existing.name}: +${diff} Stamina`;
  let lost: string[] = [];
  const stepId = mutate(
    (draft) => {
      const instance = draft.combat.instances.find((item) => item.id === instanceId);
      if (!instance) return;
      instance.currentStamina = clamped;
      if (instance.kind === "creature" && instance.currentStamina <= 0) {
        lost = releaseCaptain(draft.combat.instances, instance.id).map((squad) => squad.name);
      }
    },
    { label },
  );
  if (lost.length) {
    toast(`${lost.join(", ")} lost ${lost.length > 1 ? "their" : "its"} captain`, {
      undoStepId: stepId,
    });
  }
  return clamped;
}

export function toggleConditionPicker(instanceId: string): void {
  openConditionPickerFor.value = openConditionPickerFor.value === instanceId ? null : instanceId;
}

export function addCondition(instanceId: string, condition: string): void {
  openConditionPickerFor.value = null;
  const inst = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!inst || inst.conditions.includes(condition)) return;
  mutate(
    (draft) => {
      const instance = draft.combat.instances.find((item) => item.id === instanceId);
      if (instance) instance.conditions = [...new Set([...instance.conditions, condition])];
    },
    { label: `${condition} on ${inst.name}` },
  );
}

export function removeCondition(instanceId: string, condition: string): void {
  const inst = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!inst || !inst.conditions.includes(condition)) return;
  mutate(
    (draft) => {
      const instance = draft.combat.instances.find((item) => item.id === instanceId);
      if (instance) instance.conditions = instance.conditions.filter((item) => item !== condition);
    },
    { label: `Cleared ${condition} from ${inst.name}` },
  );
}

export function removeActiveEffect(effectId: string): void {
  const eff = activeEncounter().combat.activeEffects.find((item) => item.id === effectId);
  if (!eff) return;
  const stepId = mutate(
    (draft) => {
      draft.combat.activeEffects = draft.combat.activeEffects.filter(
        (effect) => effect.id !== effectId,
      );
    },
    { label: `Ended ${eff.name}` },
  );
  toast(`Ended ${eff.name}`, { undoStepId: stepId });
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

const SHARED_ROLL_MAX_WAIT_MS = 22_000;
let sharedRollGeneration = 0;
let sharedRollPending = false;
let sharedRollStartedAt = 0;
let sharedRollGuard: ReturnType<typeof setTimeout> | undefined;

function clearSharedRollPending(generation?: number): void {
  if (generation !== undefined && generation !== sharedRollGeneration) return;
  sharedRollPending = false;
  sharedRollActive.value = false;
  sharedRollStartedAt = 0;
  if (sharedRollGuard !== undefined) {
    clearTimeout(sharedRollGuard);
    sharedRollGuard = undefined;
  }
}

setSharedRollReset(() => {
  sharedRollGeneration += 1;
  clearSharedRollPending();
});

function performRoll(
  bonus: number,
  edge: EdgeState,
  local: () => PowerRollResult,
  apply: (roll: PowerRollResult) => void,
): void {
  if (sharedRollPending) {
    // Background tabs can throttle promise timeouts; clear an overdue lock by
    // wall clock so rolling can never remain wedged until reload.
    if (Date.now() - sharedRollStartedAt >= SHARED_ROLL_MAX_WAIT_MS) {
      sharedRollGeneration += 1;
      clearSharedRollPending();
    } else {
      toast("Wait for the current dice roll to finish.");
      return;
    }
  }
  const shared = requestSharedDice(bonus, edge);
  if (!shared) {
    apply(local());
    return;
  }
  const encounterId = activeEncounter().id;
  const generation = ++sharedRollGeneration;
  sharedRollPending = true;
  sharedRollActive.value = true;
  sharedRollStartedAt = Date.now();
  sharedRollGuard = setTimeout(() => {
    if (generation !== sharedRollGeneration || !sharedRollPending) return;
    sharedRollGeneration += 1;
    clearSharedRollPending();
    toast("Shared roll timed out. Check Owlbear before rolling again.");
  }, SHARED_ROLL_MAX_WAIT_MS);
  toast("Rolling…");
  void shared
    .then((result) => {
      if (generation !== sharedRollGeneration) return;
      if (activeEncounter().id !== encounterId) return;
      apply(result.dice ? resolvePowerRollDice(result.dice, bonus, edge) : local());
      result.onApplied?.();
    })
    .catch((error: unknown) => {
      if (generation !== sharedRollGeneration) return;
      toast(
        error instanceof Error
          ? error.message
          : "Shared roll failed. Check Owlbear before rolling again.",
      );
    })
    .finally(() => {
      clearSharedRollPending(generation);
    });
}

export function rollFeature(
  monsterPath: string,
  featureIndex: number,
  effectIndex: number,
  input?: EdgeInput,
): void {
  const m = monsterAt(monsterPath);
  const effect = m?.features[featureIndex]?.effects?.[effectIndex];
  if (!m || !effect?.roll) return;
  const key = `${m.id}|${featureIndex}|${effectIndex}`;
  const edge = takeEdge(input);
  performRoll(
    resolvePowerRollBonus(effect.roll, m),
    edge,
    () => makePowerRoll(effect.roll, m, edge),
    (roll) => {
      const next = new Map(lastRolls.value);
      // Map.set keeps an existing key's position: delete first so insertion
      // order always reflects recency (readers pick the "latest" roll by order).
      next.delete(key);
      next.set(key, roll);
      lastRolls.value = next;
    },
  );
}

export function rollCharacteristic(
  monsterPath: string,
  key: CharacteristicKey,
  input?: EdgeInput,
): void {
  const m = monsterAt(monsterPath);
  if (!m) return;
  const rollKey = `${m.id}|char|${key}`;
  const edge = takeEdge(input);
  performRoll(
    Number(m.chars[key]) || 0,
    edge,
    () => makeCharacteristicRoll(m, key, edge),
    (roll) => {
      const next = new Map(lastRolls.value);
      // See rollFeature: delete first so a re-roll moves to the end (recency).
      next.delete(rollKey);
      next.set(rollKey, roll);
      lastRolls.value = next;
    },
  );
}

export function rollMaliceFeature(featureId: string, effectIndex: number, input?: EdgeInput): void {
  const feature = maliceFeatures.value.find((item) => item.id === featureId);
  const effect = feature?.effects[effectIndex];
  if (!feature || !effect || !(effect.tier1 || effect.tier2 || effect.tier3)) return;
  const key = `${feature.id}|${effectIndex}`;
  const edge = takeEdge(input);
  const rollText = effect.roll || "Power Roll";
  performRoll(
    resolvePowerRollBonus(rollText, null),
    edge,
    () => makePowerRoll(rollText, null, edge),
    (roll) => {
      const next = new Map(lastMaliceRolls.value);
      // See rollFeature: delete first so a re-roll moves to the end (recency).
      next.delete(key);
      next.set(key, roll);
      lastMaliceRolls.value = next;
    },
  );
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
  const enc = activeEncounter();
  const sources = [
    ...enc.items.map((item) => item.sourcePath),
    ...enc.combat.instances.map((instance) => instance.sourcePath),
  ];
  for (const sourcePath of sources) {
    const monster = monsterAt(sourcePath);
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

/** Family Malice features unlocked by a single monster at its current level. */
export function maliceFeaturesForMonster(monster: Monster): MaliceFeature[] {
  const family = monster.familyPath.toLowerCase().split("/").filter(Boolean)[0];
  if (!family) return [];
  const available = maliceFeatures.value.filter(
    (feature) =>
      feature.scope === "family" &&
      feature.family === family &&
      feature.minLevel <= monster.level &&
      !isPriorMaliceGateway(feature),
  );
  return dedupeMaliceFeatures(available).sort(
    (a, b) => a.cost - b.cost || a.name.localeCompare(b.name),
  );
}

export function relevantMaliceGroups(): MaliceGroup[] {
  const enc = activeEncounter();
  if (!enc.items.length && !enc.combat.instances.length) return [];
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
  const stepId = mutate(
    (draft) => {
      const target = draft.combat.instances.find((item) => item.id === instanceId);
      if (!target) return;
      target.reactions = target.reactions.filter((item, i) => !drop(item, i));
      draft.combat.malice += refund;
    },
    { label: `Took back ${name}` },
  );
  toast(refund ? `${name} taken back · +${refund} Malice` : `${name} taken back`, {
    undoStepId: stepId,
  });
}

/**
 * The one gesture on a triggered action's box: each tap counts another use
 * while the creature has any left, and the tap after that wraps this one back
 * to none, refunding it. With one a round that is a plain tick and untick.
 */
export function cycleReaction(
  instanceId: string,
  name: string,
  malice: number,
  capacity: number,
): void {
  const instance = activeEncounter().combat.instances.find((item) => item.id === instanceId);
  if (!instance) return;
  const uses = instance.reactions.filter((item) => item.name === name).length;
  if (uses && (capacity === 1 || instance.reactions.length >= capacity))
    takeBackReaction(instanceId, name, true);
  else useReaction(instanceId, name, malice, capacity);
}

/**
 * Use a triggered action, paying its Malice. The rules allow one a round
 * (`capacity`; Ajax three), and nothing stops a creature with several using
 * the same one twice, so each use is counted. With one a round the box is a
 * toggle: tapping the marked one takes it back, tapping another swaps them.
 */
export function useReaction(
  instanceId: string,
  name: string,
  malice: number,
  capacity: number,
): void {
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
  const stepId = mutate(
    (draft) => {
      const target = draft.combat.instances.find((item) => item.id === instanceId);
      if (!target) return;
      if (swapped) target.reactions = target.reactions.slice(0, -1);
      draft.combat.malice += refund - malice;
      target.reactions.push({ name, malice });
    },
    { label: `${instance.name}: ${name}` },
  );
  toast(malice ? `${instance.name} · ${name} · −${malice} Malice` : `${instance.name} · ${name}`, {
    undoStepId: stepId,
  });
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
  mutate(
    (draft) => {
      const target = draft.combat.instances.find((item) => item.id === instanceId);
      if (!target) return;
      const rounds = [0, 1, 2].map((i) => target.villainRounds[i] ?? 0);
      rounds[n - 1] = marking ? draft.combat.round : 0;
      target.villainRounds = rounds;
    },
    { label: `${marking ? "Used" : "Cleared"} villain action ${n}` },
  );
  if (marking && earlier) toast(`${earlier.name} already used this round's villain action.`);
}

export function useMaliceFeature(featureId: string): void {
  const feature = maliceFeatures.value.find((item) => item.id === featureId);
  if (!feature) return;
  if (feature.cost > activeEncounter().combat.malice) {
    toast(`Need ${feature.cost} Malice.`);
    return;
  }
  const stepId = mutate(
    (draft) => {
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
    },
    { label: `Used ${feature.name}` },
  );
  toast(`${feature.name} · −${feature.cost} Malice`, { undoStepId: stepId });
}

export function spendAbilityMalice(cost: number, name: string): void {
  if (cost > activeEncounter().combat.malice) {
    toast(`Need ${cost} Malice.`);
    return;
  }
  const stepId = mutate(
    (draft) => {
      draft.combat.malice -= cost;
    },
    { label: `${name} (−${cost} Malice)` },
  );
  toast(`${name} · −${cost} Malice`, { undoStepId: stepId });
}

// ---------- Negotiation ----------

/** True while the Director is picking an archetype / random NPC / blank NPC
    via Quick Create (always reachable even when NPCs already exist). */
export const creatingNegotiation = signal(false);

/** Set to a newly created Blank NPC's ID so its trait picker and Setup tray open
    automatically; Quick Improv and Archetypes start collapsed for instant play. */
export const autoEditTraitsFor = signal<string | null>(null);
export const autoOpenSetupFor = signal<string | null>(null);

const DEFAULT_NPC_NAMES = new Set(["New NPC", "Local NPC", "Notable NPC", "Legendary NPC"]);

function effectiveEnding(draft: Negotiation): Ending {
  return draft.overrideEnded ? null : endingFor(draft.interest, draft.patience);
}

export function openNewNegotiation(): void {
  creatingNegotiation.value = true;
  mobileNavOpen.value = false;
}

export function closeNewNegotiation(): void {
  creatingNegotiation.value = false;
}

/** A fresh, empty negotiation: the Director's own NPC, with both tracks at
    a neutral start and six blank outcome lines. */
function newNegotiation(name = "New NPC"): Negotiation {
  const attitude = attitudeOf("neutral");
  return {
    id: uid("neg"),
    name,
    ask: "",
    archetype: "",
    attitude: attitude.key,
    languageBonus: 0,
    interest: attitude.interest,
    patience: attitude.patience,
    impression: 1,
    renown: "unknown",
    motivations: [],
    pitfalls: [],
    outcomes: ["", "", "", "", "", ""],
    log: [],
    ended: null,
    updatedAt: Date.now(),
  };
}

function blankTrait(name: string): NegotiationTrait {
  return { id: uid("trait"), name, note: "", used: false, revealed: false };
}

/** A negotiation built from one of the book's archetypes: its motivations
    and pitfalls are laid out, its Impression and attitude are set, and the
    Director edits from there. */
function archetypeNegotiation(key: string): Negotiation {
  const archetype = archetypeOf(key);
  const base = newNegotiation(archetype ? archetype.label : "New NPC");
  if (!archetype) return base;
  base.archetype = archetype.key;
  base.impression = archetype.impression;
  base.motivations = archetype.motivations.map((name) => blankTrait(traitOf(name).label));
  base.pitfalls = archetype.pitfalls.map((name) => blankTrait(traitOf(name).label));
  return base;
}

export function createNegotiation(archetypeKey = ""): string {
  const fresh = archetypeKey ? archetypeNegotiation(archetypeKey) : newNegotiation();
  clearNegotiationRolls();
  creatingNegotiation.value = false;
  mobileNavOpen.value = false;
  autoEditTraitsFor.value = archetypeKey ? null : fresh.id;
  autoOpenSetupFor.value = archetypeKey ? null : fresh.id;
  mutateApp((app) => {
    app.negotiations.push(fresh);
    app.activeNegotiationId = fresh.id;
  });
  return fresh.id;
}

/** Instant mid-session improvisation: deal a ready-to-run Neutral NPC in one
    of the three Impression bands with 3 non-overlapping motivations + 2 pitfalls. */
export function createRandomNegotiation(bandKey: ImpressionBandKey): string {
  const band = impressionBandOf(bandKey);
  const fresh = newNegotiation(band.npcName);
  const deal = randomTraitPair(3, 2);
  fresh.impression = band.defaultImpression;
  fresh.motivations = deal.motivations.map((trait) => blankTrait(trait.label));
  fresh.pitfalls = deal.pitfalls.map((trait) => blankTrait(trait.label));
  clearNegotiationRolls();
  creatingNegotiation.value = false;
  mobileNavOpen.value = false;
  autoEditTraitsFor.value = null;
  autoOpenSetupFor.value = null;
  mutateApp((app) => {
    app.negotiations.push(fresh);
    app.activeNegotiationId = fresh.id;
  });
  return fresh.id;
}

export function selectNegotiation(id: string): void {
  creatingNegotiation.value = false;
  mobileNavOpen.value = false;
  clearNegotiationRolls();
  mutateApp((app) => {
    app.activeNegotiationId = id;
  });
}

export function renameNegotiation(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  mutateApp((app) => {
    const target = app.negotiations.find((item) => item.id === id);
    if (target) target.name = trimmed;
  });
}

export function duplicateNegotiation(id: string): void {
  creatingNegotiation.value = false;
  mobileNavOpen.value = false;
  clearNegotiationRolls();
  mutateApp((app) => {
    const source = app.negotiations.find((item) => item.id === id);
    if (!source) return;
    const copy: Negotiation = {
      ...structuredClone(source),
      id: uid("neg"),
      name: `${source.name} copy`,
      log: [],
      ended: null,
      updatedAt: Date.now(),
    };
    delete copy.overrideEnded;
    for (const item of [...copy.motivations, ...copy.pitfalls]) item.used = false;
    app.negotiations.push(copy);
    app.activeNegotiationId = copy.id;
  });
}

export function deleteNegotiation(id: string): void {
  const appNow = state.value;
  const index = appNow.negotiations.findIndex((item) => item.id === id);
  if (index < 0) return;
  const snapshot = structuredClone(appNow.negotiations[index]!);
  const prevActive = appNow.activeNegotiationId;
  mutateApp((app) => {
    app.negotiations = app.negotiations.filter((item) => item.id !== id);
    if (app.activeNegotiationId === id) app.activeNegotiationId = app.negotiations[0]?.id ?? "";
  });
  toast(`Deleted ${snapshot.name || "NPC"}`, {
    action: {
      label: "Undo",
      onClick: () => {
        mutateApp((app) => {
          if (app.negotiations.some((item) => item.id === snapshot.id)) return;
          app.negotiations.splice(Math.min(index, app.negotiations.length), 0, snapshot);
          app.activeNegotiationId =
            prevActive === snapshot.id ? snapshot.id : app.activeNegotiationId;
        });
      },
    },
  });
}

/** One mutation against the open negotiation, stamped and persisted. It
    goes through the app-level mutation so every reader of the state —
    including the spine's NPC list — sees it. */
function mutateNegotiation(fn: (draft: Negotiation) => void): void {
  mutateApp((app) => {
    const target = app.negotiations.find((item) => item.id === app.activeNegotiationId);
    if (!target) return;
    fn(target);
    target.updatedAt = Date.now();
  });
}

/** The open negotiation's fields, edited in place. */
export function editNegotiation(
  values: Partial<Pick<Negotiation, "name" | "ask" | "impression" | "renown">>,
): void {
  mutateNegotiation((draft) => {
    if (values.name !== undefined) draft.name = values.name;
    if (values.ask !== undefined) draft.ask = values.ask;
    if (values.impression !== undefined) draft.impression = clampInt(values.impression, 1, 12);
    if (values.renown !== undefined) draft.renown = values.renown;
  });
}

/** Adopt one of the book's archetypes: its motivations and pitfalls replace
    whatever the NPC had, and its Impression comes with it. Swapping when the
    NPC still has a default placeholder name adopts the archetype's name too. */
export function setNegotiationArchetype(key: string): void {
  const open = activeNegotiation();
  if (!open || key === open.archetype) return;
  if (!key) {
    mutateNegotiation((draft) => {
      draft.archetype = "";
    });
    return;
  }
  const archetype = archetypeOf(key);
  if (!archetype) return;
  const targetId = open.id;
  const prev = {
    archetype: open.archetype,
    name: open.name,
    impression: open.impression,
    motivations: structuredClone(open.motivations),
    pitfalls: structuredClone(open.pitfalls),
  };
  const hadContent = open.motivations.length > 0 || open.pitfalls.length > 0;
  mutateNegotiation((draft) => {
    draft.archetype = archetype.key;
    if (DEFAULT_NPC_NAMES.has(draft.name.trim()) || !draft.name.trim()) {
      draft.name = archetype.label;
    }
    draft.impression = archetype.impression;
    draft.motivations = archetype.motivations.map((name) => blankTrait(traitOf(name).label));
    draft.pitfalls = archetype.pitfalls.map((name) => blankTrait(traitOf(name).label));
  });
  if (hadContent) {
    toast(`Applied ${archetype.label}`, {
      action: {
        label: "Undo",
        onClick: () => {
          mutateApp((app) => {
            const target = app.negotiations.find((item) => item.id === targetId);
            if (!target) return;
            target.archetype = prev.archetype;
            target.name = prev.name;
            target.impression = prev.impression;
            target.motivations = prev.motivations;
            target.pitfalls = prev.pitfalls;
            target.updatedAt = Date.now();
          });
        },
      },
    });
  }
}

/** Set the starting attitude. Before any argument lands, this immediately sets
    Interest and Patience (including any active language bonus). Once arguments
    exist, restarting is non-blocking and backed by an Undo toast. */
export function setNegotiationAttitude(key: AttitudeKey): void {
  const attitude = attitudeOf(key);
  const open = activeNegotiation();
  if (!open || open.attitude === attitude.key) return;
  const targetId = open.id;
  const hadLog = open.log.length > 0;
  const prev = hadLog ? structuredClone(open) : null;
  clearNegotiationRolls();
  mutateNegotiation((draft) => {
    draft.attitude = attitude.key;
    draft.interest = attitude.interest;
    draft.patience = clampInt(attitude.patience + draft.languageBonus, 0, 5);
    delete draft.overrideEnded;
    draft.ended = endingFor(draft.interest, draft.patience);
    draft.log = [];
    for (const item of [...draft.motivations, ...draft.pitfalls]) item.used = false;
  });
  if (prev) {
    toast(`Restarted at ${attitude.label}`, {
      action: {
        label: "Undo",
        onClick: () => {
          mutateApp((app) => {
            const i = app.negotiations.findIndex((item) => item.id === targetId);
            if (i >= 0) app.negotiations[i] = prev;
          });
        },
      },
    });
  }
}

/** Explicit restart back to the NPC's current starting attitude & language
    bonus, clearing the log and freeing spent motivations — backed by Undo toast. */
export function resetNegotiation(): void {
  const open = activeNegotiation();
  if (!open) return;
  const targetId = open.id;
  const prev = structuredClone(open);
  const attitude = attitudeOf(open.attitude);
  clearNegotiationRolls();
  mutateNegotiation((draft) => {
    draft.interest = attitude.interest;
    draft.patience = clampInt(attitude.patience + draft.languageBonus, 0, 5);
    delete draft.overrideEnded;
    draft.ended = endingFor(draft.interest, draft.patience);
    draft.log = [];
    for (const item of [...draft.motivations, ...draft.pitfalls]) item.used = false;
  });
  toast(`Reset to ${attitude.label}`, {
    action: {
      label: "Undo",
      onClick: () => {
        mutateApp((app) => {
          const i = app.negotiations.findIndex((item) => item.id === targetId);
          if (i >= 0) app.negotiations[i] = prev;
        });
      },
    },
  });
}

export function setNegotiationInterest(value: number): void {
  mutateNegotiation((draft) => {
    draft.interest = clampInt(value, 0, 5);
    draft.ended = effectiveEnding(draft);
  });
}

export function setNegotiationPatience(value: number): void {
  mutateNegotiation((draft) => {
    draft.patience = clampInt(value, 0, 5);
    draft.ended = effectiveEnding(draft);
  });
}

/** Lossless starting native-language bonus (0, +1, or +2): computes exact
    effective bonus clamped against the starting attitude's Patience so toggling
    +2 → None on a Trusting (5) or Friendly (4) NPC never silently eats Patience. */
export function setNegotiationLanguageBonus(bonus: LanguageBonus): void {
  mutateNegotiation((draft) => {
    const prev = draft.languageBonus ?? 0;
    if (prev === bonus) return;
    const basePat = attitudeOf(draft.attitude).patience;
    draft.languageBonus = bonus;
    if (draft.log.length === 0) {
      draft.patience = clampInt(basePat + bonus, 0, 5);
    } else {
      const appliedPrev = Math.min(5, basePat + prev) - basePat;
      const appliedNext = Math.min(5, basePat + bonus) - basePat;
      draft.patience = clampInt(draft.patience + (appliedNext - appliedPrev), 0, 5);
    }
    draft.ended = effectiveEnding(draft);
  });
}

export function setNegotiationOutcome(level: number, text: string): void {
  mutateNegotiation((draft) => {
    draft.outcomes[clampInt(level, 0, 5)] = text;
  });
}

function hasTraitLabel(list: readonly NegotiationTrait[], label: string): boolean {
  const key = label.trim().toLowerCase();
  return list.some((item) => item.name.trim().toLowerCase() === key);
}

function addTraitChecked(
  draft: Negotiation,
  kind: "motivation" | "pitfall",
  name: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const own = kind === "motivation" ? draft.motivations : draft.pitfalls;
  const other = kind === "motivation" ? draft.pitfalls : draft.motivations;
  if (hasTraitLabel(own, trimmed)) return `${trimmed} is already listed.`;
  if (hasTraitLabel(other, trimmed)) {
    return `${trimmed} is already a ${kind === "motivation" ? "pitfall" : "motivation"}.`;
  }
  own.push(blankTrait(trimmed));
  return null;
}

export function addNegotiationMotivation(name: string): void {
  let warning: string | null = null;
  mutateNegotiation((draft) => {
    warning = addTraitChecked(draft, "motivation", name);
  });
  if (warning) toast(warning);
}

export function addNegotiationPitfall(name: string): void {
  let warning: string | null = null;
  mutateNegotiation((draft) => {
    warning = addTraitChecked(draft, "pitfall", name);
  });
  if (warning) toast(warning);
}

/** Toggle one of the 12 official Draw Steel traits on or off in one tap. */
export function toggleNegotiationOfficialTrait(
  kind: "motivation" | "pitfall",
  label: string,
): void {
  let warning: string | null = null;
  mutateNegotiation((draft) => {
    const own = kind === "motivation" ? draft.motivations : draft.pitfalls;
    const other = kind === "motivation" ? draft.pitfalls : draft.motivations;
    const key = label.trim().toLowerCase();
    const existing = own.findIndex((item) => item.name.trim().toLowerCase() === key);
    if (existing >= 0) {
      own.splice(existing, 1);
      return;
    }
    if (hasTraitLabel(other, label)) {
      warning = `${label} is already a ${kind === "motivation" ? "pitfall" : "motivation"}.`;
      return;
    }
    own.push(blankTrait(label));
  });
  if (warning) toast(warning);
}

/** Deal fresh random motivations & pitfalls in one tap, with Undo toast. */
export function shuffleNegotiationTraits(motivationCount = 3, pitfallCount = 2): void {
  const open = activeNegotiation();
  if (!open) return;
  const targetId = open.id;
  const prevMotivations = structuredClone(open.motivations);
  const prevPitfalls = structuredClone(open.pitfalls);
  const prevArchetype = open.archetype;
  const deal = randomTraitPair(motivationCount, pitfallCount);
  mutateNegotiation((draft) => {
    draft.archetype = "";
    draft.motivations = deal.motivations.map((trait) => blankTrait(trait.label));
    draft.pitfalls = deal.pitfalls.map((trait) => blankTrait(trait.label));
  });
  toast("Dealt new random traits", {
    action: {
      label: "Undo",
      onClick: () => {
        mutateApp((app) => {
          const target = app.negotiations.find((item) => item.id === targetId);
          if (!target) return;
          target.archetype = prevArchetype;
          target.motivations = prevMotivations;
          target.pitfalls = prevPitfalls;
          target.updatedAt = Date.now();
        });
      },
    },
  });
}

export function editNegotiationTraitNote(
  kind: "motivation" | "pitfall",
  id: string,
  note: string,
): void {
  mutateNegotiation((draft) => {
    const item = (kind === "motivation" ? draft.motivations : draft.pitfalls).find(
      (entry) => entry.id === id,
    );
    if (item) item.note = note.trim();
  });
}

export function removeNegotiationTrait(kind: "motivation" | "pitfall", id: string): void {
  const open = activeNegotiation();
  if (!open) return;
  const targetId = open.id;
  const list = kind === "motivation" ? open.motivations : open.pitfalls;
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return;
  const snapshot = structuredClone(list[index]!);
  mutateNegotiation((draft) => {
    const targetList = kind === "motivation" ? draft.motivations : draft.pitfalls;
    const i = targetList.findIndex((item) => item.id === id);
    if (i >= 0) targetList.splice(i, 1);
  });
  toast(`Removed ${snapshot.name}`, {
    action: {
      label: "Undo",
      onClick: () => {
        mutateApp((app) => {
          const target = app.negotiations.find((item) => item.id === targetId);
          if (!target) return;
          const targetList = kind === "motivation" ? target.motivations : target.pitfalls;
          if (targetList.some((item) => item.id === snapshot.id)) return;
          targetList.splice(Math.min(index, targetList.length), 0, snapshot);
          target.updatedAt = Date.now();
        });
      },
    },
  });
}

export function toggleNegotiationTraitUsed(kind: "motivation" | "pitfall", id: string): void {
  mutateNegotiation((draft) => {
    const item = (kind === "motivation" ? draft.motivations : draft.pitfalls).find(
      (entry) => entry.id === id,
    );
    if (item) item.used = !item.used;
  });
}

/** Mark a motivation or pitfall as known to the heroes, or take it back:
    a read that learned one is the only thing that reveals it, and the
    Director can change their mind. */
export function toggleNegotiationTraitKnown(kind: "motivation" | "pitfall", id: string): void {
  mutateNegotiation((draft) => {
    const item = (kind === "motivation" ? draft.motivations : draft.pitfalls).find(
      (entry) => entry.id === id,
    );
    if (item) item.revealed = !item.revealed;
  });
}

/**
 * The roll in flight for each test, argument and read. Ephemeral: a re-render
 * never re-rolls, and leaving the negotiation drops them.
 */
export const argumentRoll = signal<NegotiationFlight | null>(null);
export const readRoll = signal<NegotiationFlight | null>(null);

interface NegotiationFlight {
  roll: PowerRollResult;
  /** Bumped on every roll, so a new roll always redraws its mark. */
  serial: number;
}

const rollSerials: Record<"argument" | "read", number> = { argument: 0, read: 0 };

export function rollNegotiationTest(input: {
  bonus: number;
  edge?: EdgeState | undefined;
  which: "argument" | "read";
}): void {
  const negotiation = activeNegotiation();
  if (!negotiation) return;
  if (input.which === "read" && readSpent(negotiation.log)) return;
  const label =
    input.bonus === 0 ? "Power Roll" : `Power Roll ${input.bonus > 0 ? "+" : ""}${input.bonus}`;
  const roll = makePowerRoll(label, null, input.edge ?? "normal");
  rollSerials[input.which] += 1;
  const flight: NegotiationFlight = { roll, serial: rollSerials[input.which] };
  if (input.which === "argument") argumentRoll.value = flight;
  else readRoll.value = flight;
}

export function clearNegotiationRolls(): void {
  argumentRoll.value = null;
  readRoll.value = null;
}

/** What an applied argument is worth, as one printed line. It reads the same
    words the tier row printed before the dice, so the log can never disagree
    with what the Director tapped. */
function resultLine(plan: ArgumentPlan, tier: 1 | 2 | 3, critical: boolean, lie: boolean): string {
  return tierLines(plan.kind, tier, lie, critical).join(", ");
}

/**
 * Apply an argument: move both tracks, mark the motivation as appealed to,
 * and write it on the negotiation's log so the table can read the argument
 * back. Works identically for physical/VTT dice (no in-app roll needed) and
 * optional in-app rolls.
 */
export function applyNegotiationArgument(input: {
  plan: ArgumentPlan;
  tier: 1 | 2 | 3;
  motivationId: string | null;
  motivationName: string;
  pitfallId?: string | null | undefined;
  pitfallName?: string | undefined;
  /** The motivation had already been appealed to before this argument. */
  reused: boolean;
  lie: boolean;
  /** True when a player rolled a physical Natural 19–20 on a plain argument. */
  naturalCrit?: boolean | undefined;
  /** Optional short memo of what the party offered or promised. */
  memo?: string | undefined;
}): void {
  const {
    plan,
    tier,
    motivationId,
    motivationName,
    pitfallId,
    pitfallName,
    reused,
    lie,
    naturalCrit,
    memo,
  } = input;
  mutateNegotiation((draft) => {
    const roll = plan.roll === null ? null : (argumentRoll.value?.roll ?? null);
    const critical = Boolean(naturalCrit || roll?.critical);
    const outcome = tierOutcome(plan, tier, critical);
    const caught = lie && lieBites(outcome);
    const before = {
      interest: draft.interest,
      patience: draft.patience,
      usedIds: draft.motivations.filter((item) => item.used).map((item) => item.id),
      revealedPitfallIds: draft.pitfalls.filter((item) => item.revealed).map((item) => item.id),
    };
    const next = applyOutcome(before.interest, before.patience, outcome);
    if (caught) next.interest = clampInt(next.interest - 1, 0, 5);
    draft.interest = next.interest;
    draft.patience = next.patience;
    if (motivationId) {
      const item = draft.motivations.find((entry) => entry.id === motivationId);
      if (item) item.used = true;
    }
    if (pitfallId) {
      const pit = draft.pitfalls.find((entry) => entry.id === pitfallId);
      if (pit) pit.revealed = true;
    }
    const title = motivationName
      ? `${reused ? "Reused" : "Appealed to"} ${motivationName}`
      : pitfallName
        ? `Touched pitfall: ${pitfallName}`
        : plan.title;
    const trimmedMemo = memo?.trim() ?? "";
    draft.log.unshift({
      id: uid("log"),
      kind: "argument",
      title,
      ...(trimmedMemo ? { memo: trimmedMemo } : {}),
      result: resultLine(plan, tier, critical, lie),
      roll: roll ? roll.label : naturalCrit && tier === 3 ? "Natural 19–20" : "",
      before,
      at: Date.now(),
    });
    draft.ended = effectiveEnding(draft);
  });
  argumentRoll.value = null;
}

/** Take the last argument back: the two tracks return to where they were
    and the motivation it used is free again. */
export function undoNegotiationArgument(): void {
  mutateNegotiation((draft) => {
    const entry = draft.log.shift();
    if (!entry) return;
    draft.interest = entry.before.interest;
    draft.patience = entry.before.patience;
    draft.ended = effectiveEnding(draft);
    if (entry.kind === "argument") {
      const used = new Set(entry.before.usedIds);
      for (const item of draft.motivations) item.used = used.has(item.id);
      if (entry.before.revealedPitfallIds) {
        const revealed = new Set(entry.before.revealedPitfallIds);
        for (const item of draft.pitfalls) item.revealed = revealed.has(item.id);
      }
    }
  });
}

/** A read: learn one of the NPC's motivations or pitfalls. */
export function applyNegotiationRead(tier: 1 | 2 | 3): void {
  const open = activeNegotiation();
  if (!open) return;
  // A read rolled when the sheet allowed one can fall back into a spent
  // sheet — the argument it followed was taken back — so the rule is held
  // here as well as on the Roll.
  if (readSpent(open.log)) return;
  mutateNegotiation((draft) => {
    const roll = readRoll.value?.roll ?? null;
    const before = {
      interest: draft.interest,
      patience: draft.patience,
      usedIds: draft.motivations.filter((item) => item.used).map((item) => item.id),
    };
    const learn = tier === 3;
    const probed = tier === 1;
    const next = applyOutcome(before.interest, before.patience, {
      interest: 0,
      patience: probed ? -1 : 0,
    });
    draft.interest = next.interest;
    draft.patience = next.patience;
    draft.log.unshift({
      id: uid("log"),
      kind: "read",
      title: learn ? "Read the NPC" : "Tried to read the NPC",
      result: learn
        ? "learns one motivation or pitfall"
        : probed
          ? "learns nothing, patience −1"
          : "learns nothing",
      roll: roll ? roll.label : "",
      before,
      at: Date.now(),
    });
    draft.ended = effectiveEnding(draft);
  });
  readRoll.value = null;
}

/** Reopen a negotiation the two tracks have closed, at the Director's call.
    Sets overrideEnded so subsequent arguments don't immediately re-lock it. */
export function reopenNegotiation(): void {
  clearNegotiationRolls();
  mutateNegotiation((draft) => {
    draft.ended = null;
    draft.overrideEnded = true;
  });
}

// ---------- Preview drawer ----------

/** The prep entry the preview drawer shows, when it was opened from the
    roster: a level set there is that entry's. */
export const previewEntry = signal<string | null>(null);

export function openPreview(path: string, entryId: string | null = null): void {
  previewEntry.value = entryId;
  previewPath.value = path;
  if (!monsterAt(path)) {
    loadMonster(path).catch(() => {
      // A failed load leaves the drawer showing its error state.
      if (previewPath.value === path) monstersVersion.value += 1;
    });
  }
}

/** Put the previewed statblock at another level: the roster entry it was
    opened from, or just the preview (and what it adds) from the library. */
export function setPreviewLevel(level: number): string | null {
  const path = previewPath.value;
  const printed = path ? monsterAt(basePath(path)) : undefined;
  if (!path || !printed) return null;
  // An entry that has since left the roster leaves a plain preview behind.
  let entryId = previewEntry.value;
  if (entryId && !activeEncounter().items.some((item) => item.id === entryId)) {
    previewEntry.value = entryId = null;
  }
  if (!entryId) {
    previewPath.value = levelKey(path, level, printed.level);
    return previewPath.value;
  }
  const moved = setEntryLevel(entryId, level);
  if (!moved) return null;
  previewEntry.value = moved.entryId;
  previewPath.value = moved.key;
  return moved.key;
}

export function closePreview(): void {
  previewEntry.value = null;
  previewPath.value = null;
}
