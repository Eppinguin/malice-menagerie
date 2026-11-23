/**
 * The typed contract between Malice Menagerie and the Malice Menagerie
 * Owlbear companion extension.
 *
 * This module is shared by both applications. It must stay dependency-free
 * and DOM-free so the extension can bundle it without pulling in the app.
 *
 * Two rules matter more than the shapes below:
 *
 * 1. Every message that crosses a window boundary is untrusted. `parseEnvelope`
 *    and `validateCommand` / `validateEvent` are the only doors in.
 * 2. The transport is replaceable. Nothing here mentions `Window`, `MessagePort`
 *    or WebSockets, so the popup/MessageChannel bridge and a future relay can
 *    carry the same messages.
 */

export const PROTOCOL_NAME = "malice-menagerie-owlbear" as const;
export const PROTOCOL_VERSION = 1 as const;
export const MAX_COMBATANT_UPDATES = 50;

/** Metadata written by this integration onto Owlbear items and scenes. */
export const INTEGRATION_NAMESPACE = "com.malicemenagerie.owlbear" as const;
export const TOKEN_METADATA_KEY = `${INTEGRATION_NAMESPACE}/token` as const;
export const SCENE_METADATA_KEY = `${INTEGRATION_NAMESPACE}/scene` as const;
export const ENCOUNTER_METADATA_KEY = `${INTEGRATION_NAMESPACE}/encounter` as const;

/**
 * Seamus Finlayson's Draw Steel Tools extension. These keys are an external,
 * undocumented contract, not a public API. They are isolated in
 * `seamusContract.ts` so a format change has one place to land.
 */
export const SEAMUS_TOKEN_METADATA_KEY = "com.draw-steel-stat-bubbles/metadata" as const;
export const SEAMUS_MINION_GROUPS_KEY = "com.draw-steel-stat-bubbles/monsterGroups" as const;

/** The window name used by the extension's `window.open` handshake. */
export const MALICE_WINDOW_NAME = "malice-menagerie-owlbear" as const;
/** Query parameter the extension adds so Malice knows a pairing is expected. */
export const CONNECT_QUERY_PARAM = "obr" as const;
export const CONNECT_QUERY_VALUE = "connect" as const;

/** The raw `postMessage` envelope that opens the pairing handshake. */
export const HELLO_MESSAGE_TYPE = "MALICE_OWLBEAR_HELLO" as const;
/** Sent from Malice to the extension popover once the page is listening. */
export const READY_MESSAGE_TYPE = "MALICE_OWLBEAR_READY" as const;
/** Sent from the extension popover to an already-open Malice window. */
export const READY_REQUEST_TYPE = "MALICE_OWLBEAR_READY_REQUEST" as const;
/** Query/hash parameter carrying the one-time pairing token. */
export const PAIRING_TOKEN_PARAM = "obrToken" as const;
/** Query/hash parameter carrying the extension origin, for the ready ping. */
export const PAIRING_ORIGIN_PARAM = "obrOrigin" as const;

/**
 * Sent once, directly from the Owlbear extension to a Malice window, carrying
 * the transferred port that becomes the long-lived bridge. Everything after
 * this travels inside the port; the window origin is only needed for this one
 * message.
 */
export interface HelloMessage {
  protocol: typeof PROTOCOL_NAME;
  version: number;
  type: typeof HELLO_MESSAGE_TYPE;
  sessionId: string;
  pairingToken: string;
  extensionVersion: string;
}

export interface ReadyMessage {
  protocol: typeof PROTOCOL_NAME;
  version: number;
  type: typeof READY_MESSAGE_TYPE;
}

export interface ReadyRequestMessage {
  protocol: typeof PROTOCOL_NAME;
  version: number;
  type: typeof READY_REQUEST_TYPE;
  pairingToken: string;
}

export function isReadyMessage(value: unknown): value is ReadyMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["protocol"] === PROTOCOL_NAME &&
    record["version"] === PROTOCOL_VERSION &&
    record["type"] === READY_MESSAGE_TYPE
  );
}

export function isReadyRequestMessage(value: unknown): value is ReadyRequestMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["protocol"] === PROTOCOL_NAME &&
    record["version"] === PROTOCOL_VERSION &&
    record["type"] === READY_REQUEST_TYPE &&
    typeof record["pairingToken"] === "string" &&
    record["pairingToken"].length > 0 &&
    record["pairingToken"].length <= 160
  );
}

export function makeReadyMessage(): ReadyMessage {
  return { protocol: PROTOCOL_NAME, version: PROTOCOL_VERSION, type: READY_MESSAGE_TYPE };
}

export function makeReadyRequestMessage(pairingToken: string): ReadyRequestMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: READY_REQUEST_TYPE,
    pairingToken,
  };
}

export function isHelloMessage(value: unknown): value is HelloMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["protocol"] === PROTOCOL_NAME &&
    record["version"] === PROTOCOL_VERSION &&
    record["type"] === HELLO_MESSAGE_TYPE &&
    typeof record["sessionId"] === "string" &&
    record["sessionId"].length > 0 &&
    record["sessionId"].length <= 160 &&
    typeof record["pairingToken"] === "string" &&
    record["pairingToken"].length > 0 &&
    record["pairingToken"].length <= 160 &&
    isString(record["extensionVersion"], 40)
  );
}

/**
 * Parse and validate an HTTPS origin (or loopback HTTP for local development),
 * rejecting URLs with embedded credentials. Returns the normalized `url.origin`.
 */
export function parseAllowedOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (url.hostname === "localhost" ||
          url.hostname === "127.0.0.1" ||
          url.hostname === "[::1]" ||
          url.hostname === "::1")
      )
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

const MAX_SQUAD_SIZE = 99;

export const LIMITS = {
  combatantsPerRequest: 200,
  nameLength: 120,
  /** Five million Stamina is far beyond any published statblock. */
  stamina: 5_000_000,
  groupNameLength: 120,
  minionsPerSquad: MAX_SQUAD_SIZE,
  tokenIdsPerInstance: MAX_SQUAD_SIZE,
  messageBudget: 64 * 1024,
} as const;

// ---------------------------------------------------------------------------
// Domain payloads
// ---------------------------------------------------------------------------

export type CombatantKind = "creature" | "minion-squad";
export type BridgeSource = "malice" | "owlbear";
export type ImportMode = "import" | "add" | "reconcile";

export interface StatblockRef {
  resourceId: string;
  name: string;
}

/**
 * One thing Malice wants on the map. This is deliberately *not* the whole
 * encounter: an import sends only the combatants being created or updated.
 */
export interface DesiredCombatant {
  instanceId: string;
  /** Optional for compatibility with existing bridge clients. Selects token artwork. */
  sourcePath?: string;
  /** Optional Draw Steel monster size (e.g. "1M", "1S", "2", "3"). Defaults to 1×1. */
  size?: string;
  /** The prep entry this instance was dealt from, when it has one. */
  entryId: string | null;
  /** Ordinal within that entry, stable across a combat restart. */
  slot: number;
  kind: CombatantKind;
  name: string;
  /** 1 for a creature, the number of minions for a squad. */
  count: number;
  activationGroupId: string;
  activationGroupName: string;
  /** Optional for compatibility with older companions. Draw Steel condition names. */
  conditions?: string[];
  currentStamina: number;
  maxStamina: number;
  /** Per-minion Stamina for a squad; null for a creature. */
  individualStamina: number | null;
  statblock: StatblockRef | null;
  /** Stable shared-group id, so a reimport can find Seamus's group record. */
  minionGroupId: string | null;
  /** Token ids Malice believes belong to this combatant (a cache hint only). */
  existingTokenIds: string[];
  /** Set when the instance was brought in by an ability rather than a prep entry. */
  summoned: boolean;
}

export interface TokenMapping {
  encounterId: string;
  instanceId: string;
  sceneId: string;
  tokenIds: string[];
  minionGroupId: string | null;
  entryId: string | null;
  slot: number;
  kind: CombatantKind;
  name: string;
  /** Optional for compatibility with older companions. Draw Steel condition names. */
  conditions?: string[];
  /** Values observed in Owlbear at the time the mapping was read. */
  currentStamina: number;
  maxStamina: number;
  individualStamina: number | null;
  /** Optional for compatibility with older companions. True when at least one token is visible. */
  visible?: boolean;
  missing: boolean;
  updatedAt: number;
}

export interface ExtensionSettingsSummary {
  ringsSync: boolean;
  conditionSync: "auto" | "marked" | "token-labels" | "off";
  diceEnabled: boolean;
  diceStatus: "disconnected" | "connecting" | "connected" | "unavailable";
  diceGmOnly: boolean;
}

export interface SceneSummary {
  roomId: string;
  sceneId: string;
  sceneReady: boolean;
  gridDpi: number;
  viewport: { x: number; y: number; scale: number };
  /** A short, non-secret label for diagnostics. */
  label: string;
}

export interface MinionGroupSummary {
  id: string;
  name: string;
  currentStamina: number;
  individualStamina: number;
  tokenCount: number;
}

/** Remaining turns in Rings are converted to Malice's turns-taken count. */
export interface InitiativeCombatant {
  instanceId: string;
  groupId: string;
  groupName: string;
  turns: number;
  turnsTaken: number;
}

export interface InitiativeState {
  expectedSceneId?: string;
  encounterId: string;
  round: number;
  combatants: InitiativeCombatant[];
}

export function isInitiativeState(value: unknown): value is InitiativeState {
  if (
    !isRecord(value) ||
    (value["expectedSceneId"] !== undefined && !isString(value["expectedSceneId"], 200)) ||
    !isString(value["encounterId"], 160) ||
    !isBoundedInt(value["round"], 1, 10_000)
  )
    return false;
  const combatants = value["combatants"];
  return (
    Array.isArray(combatants) &&
    combatants.length <= LIMITS.combatantsPerRequest &&
    new Set(combatants.map((entry) => (isRecord(entry) ? entry["instanceId"] : null))).size ===
      combatants.length &&
    combatants.every(
      (entry) =>
        isRecord(entry) &&
        isString(entry["instanceId"], 160) &&
        isString(entry["groupId"], 160) &&
        isString(entry["groupName"], LIMITS.groupNameLength) &&
        isBoundedInt(entry["turns"], 1, 100) &&
        isBoundedInt(entry["turnsTaken"], 0, entry["turns"] as number),
    )
  );
}

export interface SceneState {
  scene: SceneSummary;
  mappings: TokenMapping[];
  initiative?: InitiativeState;
  minionGroups: MinionGroupSummary[];
  /** Tokens carry this integration's identity but no live Malice combatant. */
  orphanTokens: { tokenId: string; encounterId: string; instanceId: string; name: string }[];
}

export interface ImportResult {
  mode: ImportMode;
  scene: SceneSummary;
  mappings: TokenMapping[];
  /** Instances whose tokens were created by this request. */
  createdInstanceIds: string[];
  created: number;
  updated: number;
  missing: { instanceId: string; tokenIds: string[] }[];
  warnings: string[];
}

export interface CombatantUpdate {
  instanceId: string;
  /** Optional for compatibility with older companions. Draw Steel condition names. */
  conditions?: string[];
  currentStamina: number;
  maxStamina: number;
  name: string;
  activationGroupId: string;
  activationGroupName: string;
  statblock: StatblockRef | null;
  /**
   * Malice's own per-minion Stamina for a squad. Optional so an older or
   * Owlbear-originated update can omit it; without it the receiver divides
   * `maxStamina` by the number of tokens it can see.
   */
  individualStamina?: number | null;
  /** Optional visibility state observed from Owlbear tokens. */
  visible?: boolean;
  revision: number;
}

export interface BridgeError {
  code: string;
  message: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export const COMMAND_TYPES = [
  "CONNECT",
  "DISCONNECT",
  "PING",
  "GET_SCENE_STATE",
  "ROLL_POWER",
  "DICE_CONTROL",
  "IMPORT_ENCOUNTER",
  "ADD_COMBATANTS",
  "RECONCILE_ENCOUNTER",
  "UPDATE_COMBATANT",
  "UPDATE_COMBATANTS",
  "SYNC_INITIATIVE",
  "SELECT_COMBATANT",
  "FOCUS_COMBATANT",
  "SET_VISIBILITY",
  "CLEANUP_COMBATANTS",
  "RENAME_SCENE",
] as const;
export type BridgeCommandType = (typeof COMMAND_TYPES)[number];

export const EVENT_TYPES = [
  "CONNECTED",
  "DISCONNECTED",
  "SCENE_CHANGED",
  "SETTINGS_UPDATED",
  "IMPORT_PROGRESS",
  "IMPORT_COMPLETED",
  "IMPORT_FAILED",
  "COMBATANT_UPDATED",
  "INITIATIVE_UPDATED",
  "TOKEN_DELETED",
  "SELECTION_CHANGED",
  "SYNC_CONFLICT",
  "PONG",
  "ERROR",
] as const;
export type BridgeEventType = (typeof EVENT_TYPES)[number];

export type BridgeMessageType = BridgeCommandType | BridgeEventType;

export interface BridgeEnvelope<T = unknown> {
  protocol: typeof PROTOCOL_NAME;
  version: number;
  /** Unique per message; responses set `replyTo` to the request id. */
  id: string;
  sessionId: string;
  type: BridgeMessageType;
  payload: T;
  ts: number;
  source: BridgeSource;
  replyTo?: string;
  ok?: boolean;
  error?: BridgeError;
}

export interface ConnectRequest {
  appVersion: string;
  encounterId: string | null;
  /** Echo of the token from the window HELLO; proves this port is the paired one. */
  pairingToken: string;
}

export interface ConnectResponse {
  extensionVersion: string;
  protocolVersion: number;
  scene: SceneSummary;
  linkedInstances: number;
  settings?: ExtensionSettingsSummary;
}

export interface ImportRequest {
  encounterId: string;
  encounterName: string;
  mode: ImportMode;
  combatants: DesiredCombatant[];
  /** The scene Malice believes it is working in; a mismatch is reported. */
  expectedSceneId: string;
  /** When true, newly created tokens spawn hidden from players (ambush/staging). */
  hidden?: boolean;
}

export interface UpdateRequest {
  expectedSceneId: string;
  encounterId: string;
  combatant: CombatantUpdate;
}

export interface UpdatesRequest {
  expectedSceneId: string;
  encounterId: string;
  combatants: CombatantUpdate[];
}

export interface UpdatesResponse {
  appliedInstanceIds: string[];
}

export interface SelectionRequest {
  encounterId: string;
  instanceId: string;
}

export interface SetVisibilityRequest {
  expectedSceneId: string;
  encounterId: string;
  instanceId: string;
  visible: boolean;
}

export interface SetVisibilityResponse {
  visible: boolean;
}

export interface CleanupRequest {
  expectedSceneId: string;
  encounterId: string;
  instanceIds: string[];
}

export interface RenameSceneRequest {
  expectedSceneId: string;
  label: string;
}

export interface RenameSceneResponse {
  scene: SceneSummary;
}

export interface DiceRollRequest {
  bonus: number;
  netEdges: number;
}
export interface DiceRollResponse {
  dice: [number, number] | null;
  /** Wall-clock timestamps from the companion; optional for older companions. */
  timing?: { requestedAt: number; resultAt: number };
}

export interface DiceControlRequest {
  action: "cancel" | "retry" | "set-gm-only";
  gmOnly?: boolean;
}

/** The normalized payload each command validator returns. */
export interface CommandPayloadMap {
  ROLL_POWER: DiceRollRequest;
  DICE_CONTROL: DiceControlRequest;
  CONNECT: ConnectRequest;
  DISCONNECT: Record<string, never>;
  PING: Record<string, never>;
  GET_SCENE_STATE: { encounterId: string | null };
  IMPORT_ENCOUNTER: ImportRequest;
  ADD_COMBATANTS: ImportRequest;
  RECONCILE_ENCOUNTER: ImportRequest;
  UPDATE_COMBATANT: UpdateRequest;
  UPDATE_COMBATANTS: UpdatesRequest;
  SYNC_INITIATIVE: InitiativeState;
  SELECT_COMBATANT: SelectionRequest;
  FOCUS_COMBATANT: SelectionRequest;
  SET_VISIBILITY: SetVisibilityRequest;
  CLEANUP_COMBATANTS: CleanupRequest;
  RENAME_SCENE: RenameSceneRequest;
}

export interface TokenDeletedEvent {
  encounterId: string;
  instanceId: string;
  sceneId?: string;
  tokenIds: string[];
  allMissing: boolean;
}

export interface CombatantUpdatedEvent {
  encounterId: string;
  update: CombatantUpdate;
  sceneId: string;
  tokenIds: string[];
  observedAt: number;
}

export interface SceneChangedEvent {
  scene: SceneSummary;
  reason?: "scene" | "rings" | "conditions";
  settings?: ExtensionSettingsSummary;
}

export interface SettingsUpdatedEvent {
  settings: ExtensionSettingsSummary;
}

export interface SelectionChangedEvent {
  encounterId: string | null;
  instanceId: string | null;
  tokenIds: string[];
}

export interface SyncConflictEvent {
  encounterId: string;
  instanceId: string;
  local: number;
  external: number;
  policy: "local-wins" | "owlbear-wins";
}

export interface ImportProgressEvent {
  encounterId: string;
  done: number;
  total: number;
  phase: "prepare" | "tokens" | "groups" | "observe";
}

export interface ImportFailedEvent {
  encounterId: string;
  error: BridgeError;
}

export interface DisconnectedEvent {
  reason: string;
}

export interface PongEvent {
  receivedAt: number;
}

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

const COMMAND_SET: ReadonlySet<string> = new Set(COMMAND_TYPES);
const EVENT_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

export function isCommandType(value: unknown): value is BridgeCommandType {
  return typeof value === "string" && COMMAND_SET.has(value);
}

export function isEventType(value: unknown): value is BridgeEventType {
  return typeof value === "string" && EVENT_SET.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isString(value: unknown, max: number = LIMITS.nameLength): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isBoundedInt(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max;
}

function isStamina(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= LIMITS.stamina;
}

function isStatblockRef(value: unknown): value is StatblockRef {
  return (
    isRecord(value) &&
    isString(value["resourceId"], 120) &&
    isString(value["name"], LIMITS.nameLength)
  );
}

function isStringArray(value: unknown, max: number, maxLength = 100): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((entry) => isString(entry, maxLength))
  );
}

function isDesiredCombatant(value: unknown): value is DesiredCombatant {
  if (!isRecord(value)) return false;
  const kind = value["kind"];
  if (kind !== "creature" && kind !== "minion-squad") return false;
  const statblock = value["statblock"];
  return (
    isString(value["instanceId"], 160) &&
    (value["sourcePath"] === undefined || isString(value["sourcePath"], 1024)) &&
    (value["size"] === undefined || isString(value["size"], 20)) &&
    (value["entryId"] === null || isString(value["entryId"], 160)) &&
    isBoundedInt(value["slot"], 0, 10_000) &&
    isString(value["name"], LIMITS.nameLength) &&
    isBoundedInt(value["count"], 1, LIMITS.minionsPerSquad) &&
    isString(value["activationGroupId"], 160) &&
    isString(value["activationGroupName"], LIMITS.groupNameLength) &&
    (value["conditions"] === undefined || isStringArray(value["conditions"], 32, 120)) &&
    isStamina(value["currentStamina"]) &&
    isStamina(value["maxStamina"]) &&
    (value["individualStamina"] === null || isStamina(value["individualStamina"])) &&
    (statblock === null || isStatblockRef(statblock)) &&
    (value["minionGroupId"] === null || isString(value["minionGroupId"], 160)) &&
    isStringArray(value["existingTokenIds"], LIMITS.tokenIdsPerInstance) &&
    typeof value["summoned"] === "boolean" &&
    (kind === "minion-squad"
      ? typeof value["individualStamina"] === "number" && value["individualStamina"] > 0
      : true)
  );
}

function isCombatantUpdate(value: unknown): value is CombatantUpdate {
  if (!isRecord(value)) return false;
  const statblock = value["statblock"];
  const individual = value["individualStamina"];
  return (
    isString(value["instanceId"], 160) &&
    (value["conditions"] === undefined || isStringArray(value["conditions"], 32, 120)) &&
    isStamina(value["currentStamina"]) &&
    isStamina(value["maxStamina"]) &&
    isString(value["name"], LIMITS.nameLength) &&
    isString(value["activationGroupId"], 160) &&
    isString(value["activationGroupName"], LIMITS.groupNameLength) &&
    (statblock === null || isStatblockRef(statblock)) &&
    (individual === undefined || individual === null || isStamina(individual)) &&
    (value["visible"] === undefined || typeof value["visible"] === "boolean") &&
    isBoundedInt(value["revision"], 0, Number.MAX_SAFE_INTEGER)
  );
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: BridgeError };

function invalid(message: string): ValidationResult<never> {
  return { ok: false, error: { code: "INVALID_PAYLOAD", message } };
}

/** Validate a command payload before it is acted on. */
export function validateCommand(
  type: BridgeCommandType,
  payload: unknown,
): ValidationResult<unknown> {
  if (!isRecord(payload)) return invalid("Payload must be an object.");
  switch (type) {
    case "ROLL_POWER":
      return isBoundedInt(payload["bonus"], -100, 100) && isBoundedInt(payload["netEdges"], -2, 2)
        ? { ok: true, value: { bonus: payload["bonus"], netEdges: payload["netEdges"] } }
        : invalid("Bad power roll request.");
    case "DICE_CONTROL": {
      const action = payload["action"];
      if (action === "cancel" || action === "retry") return { ok: true, value: { action } };
      if (action === "set-gm-only" && typeof payload["gmOnly"] === "boolean")
        return { ok: true, value: { action, gmOnly: payload["gmOnly"] } };
      return invalid("Bad dice control request.");
    }
    case "SYNC_INITIATIVE":
      return isInitiativeState(payload)
        ? { ok: true, value: payload }
        : invalid("Bad initiative state.");
    case "CONNECT": {
      const encounterId = payload["encounterId"];
      if (typeof payload["appVersion"] !== "string") return invalid("Missing app version.");
      if (encounterId !== null && !isString(encounterId, 160))
        return invalid("Invalid encounter id.");
      if (!isString(payload["pairingToken"], 160)) return invalid("Missing pairing token.");
      return {
        ok: true,
        value: {
          appVersion: payload["appVersion"].slice(0, 40),
          encounterId,
          pairingToken: payload["pairingToken"],
        },
      };
    }
    case "DISCONNECT":
      return { ok: true, value: {} };
    case "PING":
      return { ok: true, value: {} };
    case "GET_SCENE_STATE": {
      const encounterId = payload["encounterId"];
      if (encounterId !== null && !isString(encounterId, 160))
        return invalid("Invalid encounter id.");
      return { ok: true, value: { encounterId } };
    }
    case "IMPORT_ENCOUNTER":
    case "ADD_COMBATANTS":
    case "RECONCILE_ENCOUNTER": {
      const mode = payload["mode"];
      const expectedMode =
        type === "IMPORT_ENCOUNTER" ? "import" : type === "ADD_COMBATANTS" ? "add" : "reconcile";
      if (mode !== expectedMode) return invalid("Mode does not match the command.");
      const combatants = payload["combatants"];
      if (
        !Array.isArray(combatants) ||
        combatants.length === 0 ||
        combatants.length > LIMITS.combatantsPerRequest ||
        !combatants.every(isDesiredCombatant)
      )
        return invalid("Invalid combatant list.");
      if (!isString(payload["encounterId"], 160)) return invalid("Invalid encounter id.");
      if (!isString(payload["encounterName"], LIMITS.nameLength))
        return invalid("Invalid encounter name.");
      const expectedSceneId = payload["expectedSceneId"];
      if (!isString(expectedSceneId, 200)) return invalid("Invalid scene id.");
      if (payload["hidden"] !== undefined && typeof payload["hidden"] !== "boolean")
        return invalid("Invalid hidden flag.");
      return {
        ok: true,
        value: {
          encounterId: payload["encounterId"],
          encounterName: payload["encounterName"],
          mode,
          combatants,
          expectedSceneId,
          ...(payload["hidden"] !== undefined ? { hidden: payload["hidden"] } : {}),
        },
      };
    }
    case "UPDATE_COMBATANT": {
      if (!isString(payload["expectedSceneId"], 200)) return invalid("Invalid expected scene id.");
      if (!isString(payload["encounterId"], 160)) return invalid("Invalid encounter id.");
      if (!isCombatantUpdate(payload["combatant"])) return invalid("Invalid combatant update.");
      return {
        ok: true,
        value: {
          expectedSceneId: payload["expectedSceneId"],
          encounterId: payload["encounterId"],
          combatant: payload["combatant"],
        },
      };
    }
    case "UPDATE_COMBATANTS": {
      if (!isString(payload["expectedSceneId"], 200)) return invalid("Invalid expected scene id.");
      if (!isString(payload["encounterId"], 160)) return invalid("Invalid encounter id.");
      const combatants = payload["combatants"];
      if (
        !Array.isArray(combatants) ||
        combatants.length === 0 ||
        combatants.length > MAX_COMBATANT_UPDATES ||
        !combatants.every(isCombatantUpdate)
      )
        return invalid("Invalid combatant updates.");
      return {
        ok: true,
        value: {
          expectedSceneId: payload["expectedSceneId"],
          encounterId: payload["encounterId"],
          combatants,
        },
      };
    }
    case "SELECT_COMBATANT":
    case "FOCUS_COMBATANT": {
      if (!isString(payload["encounterId"], 160)) return invalid("Invalid encounter id.");
      if (!isString(payload["instanceId"], 160)) return invalid("Invalid instance id.");
      return {
        ok: true,
        value: { encounterId: payload["encounterId"], instanceId: payload["instanceId"] },
      };
    }
    case "SET_VISIBILITY": {
      if (!isString(payload["expectedSceneId"], 200)) return invalid("Invalid expected scene id.");
      if (!isString(payload["encounterId"], 160)) return invalid("Invalid encounter id.");
      if (!isString(payload["instanceId"], 160)) return invalid("Invalid instance id.");
      if (typeof payload["visible"] !== "boolean") return invalid("Invalid visibility flag.");
      return {
        ok: true,
        value: {
          expectedSceneId: payload["expectedSceneId"],
          encounterId: payload["encounterId"],
          instanceId: payload["instanceId"],
          visible: payload["visible"],
        },
      };
    }
    case "CLEANUP_COMBATANTS": {
      if (!isString(payload["expectedSceneId"], 200)) return invalid("Invalid expected scene id.");
      if (!isString(payload["encounterId"], 160)) return invalid("Invalid encounter id.");
      const instanceIds = payload["instanceIds"];
      if (!isStringArray(instanceIds, LIMITS.combatantsPerRequest, 160))
        return invalid("Invalid instance list.");
      return {
        ok: true,
        value: {
          encounterId: payload["encounterId"],
          instanceIds,
          expectedSceneId: payload["expectedSceneId"],
        },
      };
    }
    case "RENAME_SCENE": {
      if (!isString(payload["expectedSceneId"], 200)) return invalid("Invalid expected scene id.");
      if (typeof payload["label"] !== "string" || payload["label"].length > 80)
        return invalid("Invalid scene label.");
      return {
        ok: true,
        value: {
          expectedSceneId: payload["expectedSceneId"],
          label: payload["label"],
        },
      };
    }
    default:
      return invalid("Unknown command.");
  }
}

/** Validate an event payload after it crosses the bridge. */
export function validateEvent(type: BridgeEventType, payload: unknown): ValidationResult<unknown> {
  if (!isRecord(payload)) return invalid("Payload must be an object.");
  switch (type) {
    case "INITIATIVE_UPDATED":
      return isString(payload["sceneId"], 200) && isInitiativeState(payload["initiative"])
        ? { ok: true, value: payload }
        : invalid("Bad initiative event.");
    case "CONNECTED": {
      if (!isString(payload["extensionVersion"], 40)) return invalid("Bad extension version.");
      const scene = payload["scene"];
      if (!isSceneSummary(scene)) return invalid("Bad scene.");
      if (!isBoundedInt(payload["linkedInstances"], 0, 100_000)) return invalid("Bad count.");
      if (payload["settings"] !== undefined && !isExtensionSettingsSummary(payload["settings"]))
        return invalid("Bad settings summary.");
      return { ok: true, value: payload };
    }
    case "DISCONNECTED": {
      if (typeof payload["reason"] !== "string") return invalid("Bad reason.");
      return { ok: true, value: { reason: payload["reason"].slice(0, 300) } };
    }
    case "SCENE_CHANGED": {
      if (!isSceneSummary(payload["scene"])) return invalid("Bad scene.");
      if (
        payload["reason"] !== undefined &&
        !["scene", "rings", "conditions"].includes(String(payload["reason"]))
      )
        return invalid("Bad scene change reason.");
      if (payload["settings"] !== undefined && !isExtensionSettingsSummary(payload["settings"]))
        return invalid("Bad settings summary.");
      return { ok: true, value: payload };
    }
    case "SETTINGS_UPDATED": {
      if (!isExtensionSettingsSummary(payload["settings"])) return invalid("Bad settings summary.");
      return { ok: true, value: payload };
    }
    case "IMPORT_PROGRESS": {
      if (
        !isString(payload["encounterId"], 160) ||
        !isBoundedInt(payload["done"], 0, 100_000) ||
        !isBoundedInt(payload["total"], 0, 100_000) ||
        !["prepare", "tokens", "groups", "observe"].includes(String(payload["phase"]))
      )
        return invalid("Bad progress.");
      return { ok: true, value: payload };
    }
    case "IMPORT_COMPLETED": {
      const result = payload["result"];
      if (!isImportResult(result)) return invalid("Bad import result.");
      return { ok: true, value: { result } };
    }
    case "IMPORT_FAILED": {
      const error = payload["error"];
      if (!isBridgeError(error)) return invalid("Bad error.");
      if (!isString(payload["encounterId"], 160)) return invalid("Bad encounter id.");
      return { ok: true, value: payload };
    }
    case "COMBATANT_UPDATED": {
      if (
        !isString(payload["encounterId"], 160) ||
        !isCombatantUpdate(payload["update"]) ||
        !isString(payload["sceneId"], 200) ||
        !isStringArray(payload["tokenIds"], LIMITS.tokenIdsPerInstance) ||
        !isFiniteNumber(payload["observedAt"])
      )
        return invalid("Bad combatant update.");
      return { ok: true, value: payload };
    }
    case "TOKEN_DELETED": {
      if (
        !isString(payload["encounterId"], 160) ||
        !isString(payload["instanceId"], 160) ||
        (payload["sceneId"] !== undefined && !isString(payload["sceneId"], 200)) ||
        !isStringArray(payload["tokenIds"], LIMITS.tokenIdsPerInstance) ||
        typeof payload["allMissing"] !== "boolean"
      )
        return invalid("Bad token deletion.");
      return { ok: true, value: payload };
    }
    case "SELECTION_CHANGED": {
      if (
        (payload["encounterId"] !== null && !isString(payload["encounterId"], 160)) ||
        (payload["instanceId"] !== null && !isString(payload["instanceId"], 160)) ||
        !isStringArray(payload["tokenIds"], LIMITS.tokenIdsPerInstance)
      )
        return invalid("Bad selection.");
      return { ok: true, value: payload };
    }
    case "SYNC_CONFLICT": {
      if (
        !isString(payload["encounterId"], 160) ||
        !isString(payload["instanceId"], 160) ||
        !isStamina(payload["local"]) ||
        !isStamina(payload["external"]) ||
        !["local-wins", "owlbear-wins"].includes(String(payload["policy"]))
      )
        return invalid("Bad conflict.");
      return { ok: true, value: payload };
    }
    case "PONG":
      return isFiniteNumber(payload["receivedAt"]) && payload["receivedAt"] >= 0
        ? { ok: true, value: { receivedAt: payload["receivedAt"] } }
        : invalid("Bad pong.");
    case "ERROR": {
      if (!isBridgeError(payload["error"])) return invalid("Bad error.");
      return { ok: true, value: payload };
    }
    default:
      return invalid("Unknown event.");
  }
}

export function isBridgeError(value: unknown): value is BridgeError {
  return (
    isRecord(value) &&
    isString(value["code"], 80) &&
    typeof value["message"] === "string" &&
    value["message"].length <= 500 &&
    (value["detail"] === undefined ||
      (typeof value["detail"] === "string" && value["detail"].length <= 2_000))
  );
}

export function isSceneSummary(value: unknown): value is SceneSummary {
  return (
    isRecord(value) &&
    isString(value["roomId"], 200) &&
    isString(value["sceneId"], 200) &&
    typeof value["sceneReady"] === "boolean" &&
    isFiniteNumber(value["gridDpi"]) &&
    value["gridDpi"] > 0 &&
    isRecord(value["viewport"]) &&
    isFiniteNumber(value["viewport"]["x"]) &&
    isFiniteNumber(value["viewport"]["y"]) &&
    isFiniteNumber(value["viewport"]["scale"]) &&
    value["viewport"]["scale"] > 0 &&
    typeof value["label"] === "string" &&
    value["label"].length <= 120
  );
}

export function isExtensionSettingsSummary(value: unknown): value is ExtensionSettingsSummary {
  return (
    isRecord(value) &&
    typeof value["ringsSync"] === "boolean" &&
    ["auto", "marked", "token-labels", "off"].includes(String(value["conditionSync"])) &&
    typeof value["diceEnabled"] === "boolean" &&
    ["disconnected", "connecting", "connected", "unavailable"].includes(
      String(value["diceStatus"]),
    ) &&
    typeof value["diceGmOnly"] === "boolean"
  );
}

function isTokenMapping(value: unknown): value is TokenMapping {
  if (!isRecord(value)) return false;
  const kind = value["kind"];
  return (
    isString(value["encounterId"], 160) &&
    isString(value["instanceId"], 160) &&
    isString(value["sceneId"], 200) &&
    isStringArray(value["tokenIds"], LIMITS.tokenIdsPerInstance) &&
    (value["minionGroupId"] === null || isString(value["minionGroupId"], 160)) &&
    (value["entryId"] === null || isString(value["entryId"], 160)) &&
    isBoundedInt(value["slot"], 0, 10_000) &&
    (kind === "creature" || kind === "minion-squad") &&
    isString(value["name"], LIMITS.nameLength) &&
    (value["conditions"] === undefined || isStringArray(value["conditions"], 32, 120)) &&
    isStamina(value["currentStamina"]) &&
    isStamina(value["maxStamina"]) &&
    (value["individualStamina"] === null || isStamina(value["individualStamina"])) &&
    (value["visible"] === undefined || typeof value["visible"] === "boolean") &&
    typeof value["missing"] === "boolean" &&
    isFiniteNumber(value["updatedAt"])
  );
}

function isConnectResponse(value: unknown): value is ConnectResponse {
  return (
    isRecord(value) &&
    isString(value["extensionVersion"], 40) &&
    isBoundedInt(value["protocolVersion"], 0, 10_000) &&
    isSceneSummary(value["scene"]) &&
    isBoundedInt(value["linkedInstances"], 0, 100_000) &&
    (value["settings"] === undefined || isExtensionSettingsSummary(value["settings"]))
  );
}

function isSceneState(value: unknown): value is SceneState {
  if (!isRecord(value) || !isSceneSummary(value["scene"])) return false;
  const mappings = value["mappings"];
  const groups = value["minionGroups"];
  const orphans = value["orphanTokens"];
  return (
    (value["initiative"] === undefined || isInitiativeState(value["initiative"])) &&
    Array.isArray(mappings) &&
    mappings.length <= 5_000 &&
    mappings.every(isTokenMapping) &&
    Array.isArray(groups) &&
    groups.length <= 5_000 &&
    groups.every(
      (group) =>
        isRecord(group) &&
        isString(group["id"], 160) &&
        isString(group["name"], LIMITS.groupNameLength) &&
        isStamina(group["currentStamina"]) &&
        isStamina(group["individualStamina"]) &&
        isBoundedInt(group["tokenCount"], 0, 10_000),
    ) &&
    Array.isArray(orphans) &&
    orphans.length <= 5_000 &&
    orphans.every(
      (entry) =>
        isRecord(entry) &&
        isString(entry["tokenId"], 160) &&
        isString(entry["encounterId"], 160) &&
        isString(entry["instanceId"], 160) &&
        isString(entry["name"], LIMITS.nameLength),
    )
  );
}

function isImportResult(value: unknown): value is ImportResult {
  if (!isRecord(value) || !isSceneSummary(value["scene"])) return false;
  const mode = value["mode"];
  const mappings = value["mappings"];
  const created = value["createdInstanceIds"];
  const missing = value["missing"];
  return (
    (mode === "import" || mode === "add" || mode === "reconcile") &&
    Array.isArray(mappings) &&
    mappings.length <= 5_000 &&
    mappings.every(isTokenMapping) &&
    isStringArray(created, 5_000, 160) &&
    isBoundedInt(value["created"], 0, 100_000) &&
    isBoundedInt(value["updated"], 0, 100_000) &&
    Array.isArray(missing) &&
    missing.length <= 1_000 &&
    missing.every(
      (entry) =>
        isRecord(entry) &&
        isString(entry["instanceId"], 160) &&
        isStringArray(entry["tokenIds"], LIMITS.tokenIdsPerInstance),
    ) &&
    Array.isArray(value["warnings"]) &&
    value["warnings"].length <= 1_000 &&
    value["warnings"].every((warning) => typeof warning === "string" && warning.length <= 500)
  );
}

function isCleanupResponse(value: unknown): value is { deleted: number } {
  return isRecord(value) && isBoundedInt(value["deleted"], 0, 100_000);
}

/** Validate a command response before resolving the caller's promise. */
export function validateResponse(
  type: BridgeCommandType,
  payload: unknown,
): ValidationResult<unknown> {
  switch (type) {
    case "ROLL_POWER":
      return isRecord(payload) &&
        (payload["dice"] === null ||
          (Array.isArray(payload["dice"]) &&
            payload["dice"].length === 2 &&
            payload["dice"].every((die) => isBoundedInt(die, 1, 10)))) &&
        (payload["timing"] === undefined ||
          (isRecord(payload["timing"]) &&
            isBoundedInt(payload["timing"]["requestedAt"], 0, Number.MAX_SAFE_INTEGER) &&
            isBoundedInt(
              payload["timing"]["resultAt"],
              payload["timing"]["requestedAt"] as number,
              Number.MAX_SAFE_INTEGER,
            )))
        ? { ok: true, value: payload }
        : invalid("Bad dice result.");
    case "CONNECT":
      return isConnectResponse(payload)
        ? { ok: true, value: payload }
        : invalid("Bad connect response.");
    case "GET_SCENE_STATE":
      return isSceneState(payload) ? { ok: true, value: payload } : invalid("Bad scene state.");
    case "IMPORT_ENCOUNTER":
    case "ADD_COMBATANTS":
    case "RECONCILE_ENCOUNTER":
      return isImportResult(payload) ? { ok: true, value: payload } : invalid("Bad import result.");
    case "CLEANUP_COMBATANTS":
      return isCleanupResponse(payload)
        ? { ok: true, value: payload }
        : invalid("Bad cleanup response.");
    case "RENAME_SCENE":
      return isRecord(payload) && isSceneSummary(payload["scene"])
        ? { ok: true, value: payload }
        : invalid("Bad rename scene response.");
    case "SET_VISIBILITY":
      return isRecord(payload) && typeof payload["visible"] === "boolean"
        ? { ok: true, value: payload }
        : invalid("Bad visibility response.");
    case "UPDATE_COMBATANTS":
      return isRecord(payload) &&
        isStringArray(payload["appliedInstanceIds"], MAX_COMBATANT_UPDATES, 160)
        ? { ok: true, value: payload }
        : invalid("Bad combatant update response. Update the Owlbear extension and reconnect.");
    case "DISCONNECT":
    case "PING":
    case "DICE_CONTROL":
    case "UPDATE_COMBATANT":
    case "SYNC_INITIATIVE":
    case "SELECT_COMBATANT":
    case "FOCUS_COMBATANT":
      return isRecord(payload) ? { ok: true, value: payload } : invalid("Bad command response.");
    default:
      return invalid("Unknown command.");
  }
}

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (!isRecord(value)) return false;
  if (value["protocol"] !== PROTOCOL_NAME) return false;
  if (value["version"] !== PROTOCOL_VERSION) return false;
  if (!isString(value["id"], 100)) return false;
  if (!isString(value["sessionId"], 160)) return false;
  if (typeof value["type"] !== "string") return false;
  if (!isCommandType(value["type"]) && !isEventType(value["type"])) return false;
  if (!isFiniteNumber(value["ts"])) return false;
  if (value["source"] !== "malice" && value["source"] !== "owlbear") return false;
  if (value["replyTo"] !== undefined && !isString(value["replyTo"], 100)) return false;
  if (value["ok"] !== undefined && typeof value["ok"] !== "boolean") return false;
  if (value["error"] !== undefined && !isBridgeError(value["error"])) return false;
  return true;
}

export function makeEnvelope(
  source: BridgeSource,
  sessionId: string,
  type: BridgeMessageType,
  payload: unknown,
  id: string,
): BridgeEnvelope {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    id,
    sessionId,
    type,
    payload,
    ts: Date.now(),
    source,
  };
}

let fallbackCounter = 0;

/** Cryptographic random UUID where available, or a crypto-backed hex fallback. */
export function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  fallbackCounter = (fallbackCounter + 1) % 1_000_000;
  return `m-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
