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
  /** A minion entry: the entry is one squad of `count` minions (at most
      eight). Absent on older minion entries until they are dealt into
      squads (see `normalizeEntries`). */
  squad?: boolean;
  /** Legacy (pre-squad-entry) squad sizes, read only to split old saves. */
  squads?: number[];
}

export type InstanceKind = "creature" | "minion-squad";

export interface CombatInstance {
  id: string;
  sourcePath: string;
  groupId: string;
  /** The prep entry this instance was dealt from. */
  entryId?: string;
  kind: InstanceKind;
  count: number;
  name: string;
  currentStamina: number;
  maxStamina: number;
  /** Turns this creature takes each round; starts from the statblock, adjustable. */
  turns: number;
  /** Turns already taken this round, 0..turns. */
  turnsTaken: number;
  conditions: string[];
  /** Triggered actions used this round (one, for nearly every creature), each
      with the Malice it cost, so taking it back refunds exactly that. */
  reactions: { name: string; malice: number }[];
  /** The round each villain action (1–3) was used in, or 0 while unused. */
  villainRounds: number[];
  /** A minion squad's attached captain (another instance's id). */
  captainId?: string;
  /** Brought onto the board by an ability rather than dealt from a prep
      entry: the id of the creature that summoned it. It has no `entryId`,
      so it adds no EV and prep edits leave it be. */
  summonedBy?: string;
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
  role: string;
  search: string;
  maliceDockOpen: boolean;
  watchOpen: boolean;
  maliceLibraryOpen: boolean;
  sort: SortKey;
  filtersOpen: boolean;
  sidebarCollapsed: boolean;
  roles: string[];
  sizes: string[];
  keywords: string[];
  levelMin: number | null;
  levelMax: number | null;
  evMin: number | null;
  evMax: number | null;
}

/**
 * A single saved encounter document: party parameters, monster roster,
 * groups, and any in-progress combat. The app holds a library of these
 * and points at one active encounter at a time.
 */
export interface Encounter {
  id: string;
  name: string;
  updatedAt: number;
  /** The view (Prep/Run) this encounter was last left on. */
  view: ViewName;
  party: Party;
  groups: Group[];
  activePrepGroupId: string;
  items: EncounterItem[];
  combat: CombatState;
}

export interface AppState {
  encounters: Encounter[];
  activeEncounterId: string;
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
  /** A summoned minion's own price, e.g. "2 Malice for two minions". */
  cost?: string;
  keywords?: unknown;
  features?: unknown;
  size?: string | number;
  speed?: string | number;
  stamina?: number | string;
  stability?: string | number;
  free_strike?: string | number;
  freeStrike?: string | number;
  movement?: string;
  immunities?: unknown;
  weaknesses?: unknown;
  with_captain?: string;
  might?: number;
  agility?: number;
  reason?: number;
  intuition?: number;
  presence?: number;
}

export interface FeatureEffect {
  /** A printed label such as "Effect", "Special" or "End Effect". */
  name?: string;
  /** An extra cost printed before the text, e.g. "2 Malice". */
  cost?: string;
  effect?: string;
  roll?: string;
  tier1?: string;
  tier2?: string;
  tier3?: string;
}

export interface MonsterFeature {
  name?: string;
  /** The book's printed icon, as an emoji. */
  icon?: string;
  feature_type?: string;
  ability_type?: string;
  cost?: string | number;
  usage?: string;
  keywords?: string[];
  distance?: string;
  target?: string;
  trigger?: string;
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
  /** Movement modes beyond walking ("Fly, hover"), or "" when none. */
  movement: string;
  immunities: string[];
  weaknesses: string[];
  /** A minion's bonus while led by a captain, or "". */
  withCaptain: string;
  /** Turns per round, read from a solo's "Solo Turns" trait; 1 otherwise. */
  turnsPerRound: number;
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
  icon?: string;
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
  /** The book's printed icon, as an emoji. */
  icon: string;
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
  edge: EdgeState;
  dice: [number, number];
  /** A natural 19 or 20: always tier 3, whatever the bonus, edges or banes. */
  critical: boolean;
}

export type EdgeState = "double-bane" | "bane" | "normal" | "edge" | "double-edge";

export interface ParsedEv {
  unit: number;
  label: string;
  suggestedQty: number;
}

export interface Difficulty {
  label: string;
  tier: "trivial" | "easy" | "standard" | "hard" | "extreme";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
