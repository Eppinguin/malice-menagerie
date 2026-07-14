// ---------- Persisted app state ----------

export interface Party {
  heroes: number;
  level: number;
  victories: number;
  bonusMalice: number;
}

export interface Group {
  id: string;
  name: string;
}

export interface EncounterItem {
  id: string;
  sourcePath: string;
  groupId: string;
  count: number;
}

export type InstanceKind = "creature" | "minion-squad";

export interface CombatInstance {
  id: string;
  sourcePath: string;
  groupId: string;
  kind: InstanceKind;
  count: number;
  name: string;
  currentStamina: number;
  maxStamina: number;
  acted: boolean;
  conditions: string[];
}

export interface ActiveEffect {
  id: string;
  name: string;
  expiresRound: number;
  sourcePath: string;
}

export interface CombatState {
  active: boolean;
  round: number;
  malice: number;
  instances: CombatInstance[];
  activeGroupFilter: string | null;
  activeEffects: ActiveEffect[];
  selectedMaliceFeatureIds: string[];
  maliceSelectionInitialized: boolean;
}

export type ViewName = "builder" | "combat";
export type SortKey = "name" | "level" | "ev";
export type FacetKey = "roles" | "sizes" | "keywords";

export interface UIState {
  view: ViewName;
  role: string;
  search: string;
  maliceLibraryOpen: boolean;
  sort: SortKey;
  filtersOpen: boolean;
  roles: string[];
  sizes: string[];
  keywords: string[];
  levelMin: number | null;
  levelMax: number | null;
  evMin: number | null;
  evMax: number | null;
}

export interface AppState {
  party: Party;
  groups: Group[];
  activePrepGroupId: string;
  encounter: EncounterItem[];
  combat: CombatState;
  ui: UIState;
}

// ---------- SteelCompendium source data ----------

/** Shape of a raw unified statblock JSON record. Every field is defensive. */
export interface RawStatblock {
  name?: string;
  level?: number | string;
  organization?: string;
  role?: string;
  ev?: number | string;
  keywords?: unknown;
  features?: unknown;
  size?: string | number;
  speed?: string | number;
  stamina?: number | string;
  stability?: string | number;
  free_strike?: string | number;
  freeStrike?: string | number;
  movement?: string;
  might?: number;
  agility?: number;
  reason?: number;
  intuition?: number;
  presence?: number;
}

export interface FeatureEffect {
  effect?: string;
  roll?: string;
  tier1?: string;
  tier2?: string;
  tier3?: string;
}

export interface MonsterFeature {
  name?: string;
  feature_type?: string;
  ability_type?: string;
  cost?: string | number;
  usage?: string;
  keywords?: string[];
  distance?: string;
  target?: string;
  effects?: FeatureEffect[];
}

export interface Characteristics {
  M: number;
  A: number;
  R: number;
  I: number;
  P: number;
}

export interface Monster {
  id: string;
  path: string;
  book: string;
  familyPath: string;
  slug: string;
  name: string;
  level: number;
  organization: string;
  role: string;
  ev: number;
  evLabel: string;
  defaultQty: number;
  keywords: string[];
  ancestry: string;
  size: string | number;
  speed: string | number;
  stamina: number;
  stability: string | number;
  freeStrike: string | number;
  movement: string;
  chars: Characteristics;
  features: MonsterFeature[];
  source: string;
  raw: RawStatblock;
}

export interface CatalogEntry {
  path: string;
  book: string;
  familyPath: string;
  slug: string;
  derivedName: string;
  monster: Monster | null;
  error: boolean;
}

// ---------- Malice ----------

export interface RawMaliceSection {
  label?: string;
  text?: string;
  body?: string;
  effect?: string;
}

export interface RawMalicePowerRoll {
  roll?: string;
  tiers?: { low?: string; mid?: string; high?: string };
}

export interface RawMaliceItem {
  name?: string;
  cost?: string | number;
  malice?: string | number;
  body?: string;
  intro?: string;
  usage?: string;
  distance?: string;
  target?: string;
  power_roll?: RawMalicePowerRoll;
  effects?: FeatureEffect[];
  sections?: RawMaliceSection[];
  keywords?: string[];
}

export interface RawMaliceRecord {
  name?: string;
  level?: number | string;
  features?: unknown;
  content?: string;
}

export type MaliceScope = "basic" | "family";

export interface MaliceFeature {
  id: string;
  path: string;
  name: string;
  cost: number;
  costText: string;
  effects: FeatureEffect[];
  distance: string;
  target: string;
  keywords: string[];
  source: string;
  tokens: string[];
  scope: MaliceScope;
  family: string;
  familyLabel: string;
  minLevel: number;
  blockName: string;
}

export interface MaliceGroup {
  id: string;
  label: string;
  subtitle: string;
  features: MaliceFeature[];
}

// ---------- Conditions ----------

export interface ConditionEntry {
  path: string;
  name: string;
  slug: string;
  description: string | null;
}

// ---------- Misc ----------

export interface PowerRollResult {
  total: number;
  tier: 1 | 2 | 3;
  bonus: number;
  label: string;
}

export interface ParsedEv {
  unit: number;
  label: string;
  suggestedQty: number;
}

export interface Difficulty {
  label: string;
  tier: "trivial" | "easy" | "standard" | "hard" | "extreme" | "deadly";
  help: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
