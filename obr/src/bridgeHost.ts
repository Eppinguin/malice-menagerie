import {
  PROTOCOL_VERSION,
  isBridgeEnvelope,
  isCommandType,
  makeEnvelope,
  newMessageId,
  validateCommand,
  validateEvent,
  type BridgeCommandType,
  type BridgeEnvelope,
  type BridgeError,
  type CleanupRequest,
  type CommandPayloadMap,
  type ConnectRequest,
  type ConnectResponse,
  type DiceControlRequest,
  type ImportRequest,
  type ImportResult,
  type InitiativeState,
  type RenameSceneRequest,
  type RenameSceneResponse,
  type SceneState,
  type SelectionRequest,
  type SetVisibilityRequest,
  type SetVisibilityResponse,
  type UpdateRequest,
  type UpdatesRequest,
  type UpdatesResponse,
} from "../../shared/obr/protocol.ts";
import { describeError } from "./errors.ts";

export interface CommandHandlers {
  rollPower?(
    payload: CommandPayloadMap["ROLL_POWER"],
  ): Promise<import("../../shared/obr/protocol.ts").DiceRollResponse>;
  diceControl?(payload: DiceControlRequest): Promise<void>;
  connect(payload: ConnectRequest): Promise<ConnectResponse>;
  disconnect(): Promise<void>;
  sceneState(payload: { encounterId: string | null }): Promise<SceneState>;
  import(payload: ImportRequest): Promise<ImportResult>;
  initiative?(payload: InitiativeState): Promise<void>;
  updates(payload: UpdatesRequest): Promise<UpdatesResponse>;
  update(payload: UpdateRequest): Promise<void>;
  select(payload: SelectionRequest): Promise<void>;
  focus(payload: SelectionRequest): Promise<void>;
  setVisibility?(payload: SetVisibilityRequest): Promise<SetVisibilityResponse>;
  cleanup(payload: CleanupRequest): Promise<{ deleted: number }>;
  renameScene?(payload: RenameSceneRequest): Promise<RenameSceneResponse>;
  onEncounter(encounterId: string | null): void;
  onConnectionChange(connected: boolean, detail: string): void;
  onHandshakeError?(detail: string): void;
}

function error(code: string, message: string): BridgeError {
  return { code, message };
}

/**
 * Malice pings every five seconds, so silence for this long means the tab is
 * gone (closed, crashed, or asleep). Without this the background would keep
 * reporting "connected" for a port that can no longer carry anything.
 */
// Background tabs can throttle timers to one minute. Allow a full tick plus grace.
const LOST_AFTER_MS = 75_000;
const LIVENESS_CHECK_MS = 5_000;
const WAKE_GRACE_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * Background end of an adopted MessagePort.
 *
 * The port is the security boundary: it was created by the popover and handed
 * to both windows, so only the paired Malice window can use it. Every inbound
 * envelope is validated, the session id is enforced, and commands are ignored
 * until CONNECT has proved possession of the pairing token.
 */
export class BridgeHost {
  private readonly port: MessagePort;
  private readonly sessionId: string;
  private readonly pairingToken: string;
  private readonly handlers: CommandHandlers;
  private connected = false;
  private closed = false;
  private encounterId: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastInbound = Date.now();
  private lastCheck = Date.now();
  private liveness: ReturnType<typeof setInterval> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly lostAfterMs: number;
  private readonly checkMs: number;

  constructor(options: {
    port: MessagePort;
    sessionId: string;
    pairingToken: string;
    handlers: CommandHandlers;
    /** Overridable for tests; production uses the constants above. */
    lostAfterMs?: number;
    checkMs?: number;
    handshakeTimeoutMs?: number;
  }) {
    this.port = options.port;
    this.sessionId = options.sessionId;
    this.pairingToken = options.pairingToken;
    this.handlers = options.handlers;
    this.lostAfterMs = options.lostAfterMs ?? LOST_AFTER_MS;
    this.checkMs = options.checkMs ?? LIVENESS_CHECK_MS;
    this.port.addEventListener("message", this.handleMessage);
    this.port.addEventListener("messageerror", this.handleMessageError);
    this.port.start();
    const handshakeMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    if (handshakeMs > 0) {
      this.handshakeTimer = setTimeout(() => {
        if (!this.connected && !this.closed) {
          this.close("Malice Menagerie did not finish connecting.");
        }
      }, handshakeMs);
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  emit(type: Parameters<typeof validateEvent>[0], payload: unknown): void {
    if (this.closed) return;
    const check = validateEvent(type, payload);
    if (!check.ok) return;
    this.post(makeEnvelope("owlbear", this.sessionId, type, check.value, newMessageId()));
  }

  close(reason = "Closed by the extension."): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    try {
      this.port.postMessage(
        makeEnvelope("owlbear", this.sessionId, "DISCONNECTED", { reason }, newMessageId()),
      );
    } catch {
      // A broken port still needs local cleanup; do not recurse through post().
    }
    if (this.liveness !== undefined) clearInterval(this.liveness);
    this.liveness = undefined;
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.port.removeEventListener("message", this.handleMessage);
    this.port.removeEventListener("messageerror", this.handleMessageError);
    try {
      this.port.close();
    } catch {
      // Already detached.
    }
    this.handlers.onConnectionChange(false, reason);
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (this.closed) return;
    const envelope = event.data;
    if (!isBridgeEnvelope(envelope)) return;
    if (envelope.sessionId !== this.sessionId) return;
    if (envelope.source !== "malice") return;
    this.lastInbound = Date.now();
    if (!isCommandType(envelope.type)) return;
    const check = validateCommand(envelope.type, envelope.payload);
    if (!check.ok) {
      this.replyError(envelope, check.error);
      return;
    }
    // Liveness must not wait behind a slow scene read or token import.
    if (envelope.type === "PING") {
      this.reply(envelope, { receivedAt: Date.now() });
      return;
    }
    if (envelope.type === "ROLL_POWER" || envelope.type === "DICE_CONTROL") {
      void this.dispatch(envelope, check.value);
      return;
    }
    this.queue = this.queue
      .then(() => this.dispatch(envelope, check.value))
      .catch(() => {
        // A handler failure must not poison the queue.
      });
  };

  private readonly handleMessageError = () => {
    this.emit("ERROR", {
      error: error("DECODE", "The bridge received a message it could not decode."),
    });
  };

  private startLiveness(): void {
    if (this.liveness !== undefined) return;
    this.lastCheck = Date.now();
    this.liveness = setInterval(() => {
      if (this.closed || !this.connected) return;
      const now = Date.now();
      // Background tabs throttle setInterval to ~60s; only treat jumps larger
      // than normal throttling as system sleep and grant a bounded grace window.
      const wakeJumpMs = Math.max(this.lostAfterMs, 90_000);
      if (now - this.lastCheck > wakeJumpMs) {
        this.lastInbound = Math.max(
          this.lastInbound,
          now - this.lostAfterMs + Math.min(WAKE_GRACE_MS, this.lostAfterMs),
        );
      }
      this.lastCheck = now;
      if (now - this.lastInbound > this.lostAfterMs) {
        this.close("Malice Menagerie stopped responding.");
        return;
      }
      // Receiving this event wakes the site even when its timers are throttled.
      this.emit("PONG", { receivedAt: now });
    }, this.checkMs);
  }

  private async dispatch(envelope: BridgeEnvelope, payload: unknown): Promise<void> {
    if (this.closed) return;
    const type = envelope.type as BridgeCommandType;
    try {
      if (type === "PING") {
        this.reply(envelope, { receivedAt: Date.now() });
        return;
      }
      if (type === "CONNECT") {
        const request = payload as ConnectRequest;
        if (request.pairingToken !== this.pairingToken) {
          this.replyError(envelope, error("PAIRING", "The pairing token did not match."));
          return;
        }
        const response = await this.handlers.connect(request);
        if (this.closed) return;
        if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
        this.handshakeTimer = undefined;
        this.connected = true;
        this.lastInbound = Date.now();
        this.startLiveness();
        this.encounterId = request.encounterId;
        this.handlers.onEncounter(request.encounterId);
        this.handlers.onConnectionChange(true, "Connected to Malice Menagerie.");
        this.reply(envelope, response);
        this.emit("CONNECTED", {
          scene: response.scene,
          extensionVersion: response.extensionVersion,
          linkedInstances: response.linkedInstances,
          ...(response.settings ? { settings: response.settings } : {}),
        });
        return;
      }
      if (type === "DISCONNECT") {
        try {
          await this.handlers.disconnect();
        } catch {
          // Disconnect cleanup is best-effort.
        }
        this.reply(envelope, {});
        this.close("Disconnected by Malice Menagerie.");
        return;
      }
      if (!this.connected) {
        this.replyError(envelope, error("NOT_CONNECTED", "Pair with Malice Menagerie first."));
        return;
      }

      switch (type) {
        case "ROLL_POWER": {
          if (!this.handlers.rollPower)
            throw new Error("Update the companion extension to share dice rolls.");
          this.reply(
            envelope,
            await this.handlers.rollPower(payload as CommandPayloadMap["ROLL_POWER"]),
          );
          return;
        }
        case "DICE_CONTROL": {
          if (!this.handlers.diceControl)
            throw new Error(
              "Update the companion extension to control Connected Dice from Malice.",
            );
          await this.handlers.diceControl(payload as CommandPayloadMap["DICE_CONTROL"]);
          this.reply(envelope, {});
          return;
        }
        case "GET_SCENE_STATE": {
          const response = await this.handlers.sceneState(
            payload as CommandPayloadMap["GET_SCENE_STATE"],
          );
          this.encounterId = (payload as CommandPayloadMap["GET_SCENE_STATE"]).encounterId;
          this.handlers.onEncounter(this.encounterId);
          this.reply(envelope, response);
          return;
        }
        case "IMPORT_ENCOUNTER": {
          const response = await this.handlers.import(payload as ImportRequest);
          this.encounterId = (payload as ImportRequest).encounterId;
          this.handlers.onEncounter(this.encounterId);
          this.reply(envelope, response);
          return;
        }
        case "ADD_COMBATANTS":
        case "RECONCILE_ENCOUNTER": {
          const response = await this.handlers.import(payload as ImportRequest);
          this.encounterId = (payload as ImportRequest).encounterId;
          this.handlers.onEncounter(this.encounterId);
          this.reply(envelope, response);
          return;
        }
        case "SYNC_INITIATIVE": {
          if (!this.handlers.initiative)
            throw new Error("Update the Owlbear extension to sync initiative.");
          await this.handlers.initiative(payload as InitiativeState);
          this.reply(envelope, {});
          return;
        }
        case "UPDATE_COMBATANT": {
          await this.handlers.update(payload as UpdateRequest);
          this.reply(envelope, {});
          return;
        }
        case "UPDATE_COMBATANTS": {
          const response = await this.handlers.updates(payload as UpdatesRequest);
          this.reply(envelope, response);
          return;
        }
        case "SELECT_COMBATANT": {
          await this.handlers.select(payload as SelectionRequest);
          this.reply(envelope, {});
          return;
        }
        case "FOCUS_COMBATANT": {
          await this.handlers.focus(payload as SelectionRequest);
          this.reply(envelope, {});
          return;
        }
        case "SET_VISIBILITY": {
          if (!this.handlers.setVisibility)
            throw new Error("Update the Owlbear extension to hide or reveal tokens.");
          const response = await this.handlers.setVisibility(payload as SetVisibilityRequest);
          this.reply(envelope, response);
          return;
        }
        case "CLEANUP_COMBATANTS": {
          const response = await this.handlers.cleanup(payload as CleanupRequest);
          this.reply(envelope, response);
          return;
        }
        case "RENAME_SCENE": {
          if (!this.handlers.renameScene)
            throw new Error("Update the Owlbear extension to rename scenes.");
          const response = await this.handlers.renameScene(payload as RenameSceneRequest);
          this.reply(envelope, response);
          return;
        }
        default: {
          this.replyError(envelope, error("UNKNOWN", "Unknown command."));
        }
      }
    } catch (cause) {
      const message = describeError(cause, "The extension could not complete that.");
      if (type === "CONNECT") this.handlers.onHandshakeError?.(message);
      this.replyError(envelope, error("FAILED", message));
    }
  }

  private reply(request: BridgeEnvelope, payload: unknown): void {
    if (this.closed) return;
    const response = makeEnvelope("owlbear", this.sessionId, request.type, payload, newMessageId());
    response.replyTo = request.id;
    response.ok = true;
    this.post(response);
  }

  private replyError(request: BridgeEnvelope, failure: BridgeError): void {
    if (this.closed) return;
    const response = makeEnvelope("owlbear", this.sessionId, request.type, {}, newMessageId());
    response.replyTo = request.id;
    response.ok = false;
    response.error = failure;
    this.post(response);
  }

  private post(envelope: BridgeEnvelope): void {
    if (this.closed) return;
    try {
      this.port.postMessage(envelope);
    } catch {
      this.close("The bridge port closed.");
    }
  }
}

export { PROTOCOL_VERSION };
