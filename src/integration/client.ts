import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  isBridgeEnvelope,
  isEventType,
  makeEnvelope,
  newMessageId,
  validateCommand,
  validateEvent,
  validateResponse,
  type BridgeCommandType,
  type BridgeEnvelope,
  type BridgeError,
  type BridgeEventType,
} from "../../shared/obr/protocol.ts";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "synchronizing"
  | "lost"
  | "disconnected"
  | "error";

export interface BridgeClientHandlers {
  onEvent: (type: BridgeEventType, payload: unknown) => void;
  onStatus: (status: ConnectionStatus, detail?: string) => void;
  onLog: (line: string) => void;
}

interface Pending {
  type: BridgeCommandType;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ProtocolError extends Error {
  readonly code: string;
  constructor(error: BridgeError) {
    super(error.message);
    this.name = "ProtocolError";
    this.code = error.code;
  }
}

const HEARTBEAT_MS = 5_000;
const LOST_AFTER_MS = 75_000;
const WAKE_JUMP_MS = Math.max(LOST_AFTER_MS, 90_000);
const WAKE_GRACE_MS = 15_000;

/**
 * Malice's end of an already-paired MessagePort.
 *
 * The port is the security boundary: only the window that received it from
 * the Owlbear extension can use it. On top of that, every envelope is
 * validated, the session id is enforced, unknown types are dropped, and a
 * heartbeat turns a silent port into an explicit "connection lost" state.
 */
export class BridgeClient {
  private readonly port: MessagePort;
  private readonly sessionId: string;
  private readonly handlers: BridgeClientHandlers;
  private readonly pending = new Map<string, Pending>();
  private readonly sendQueue: BridgeEnvelope[] = [];
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastSeen = Date.now();
  private lastCheck = Date.now();
  private lastPingSent = 0;
  private closed = false;
  private started = false;

  constructor(port: MessagePort, sessionId: string, handlers: BridgeClientHandlers) {
    this.port = port;
    this.sessionId = sessionId;
    this.handlers = handlers;
    this.port.addEventListener("message", this.handleMessage);
    this.port.addEventListener("messageerror", this.handleMessageError);
    this.port.start();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.lastSeen = Date.now();
    this.lastCheck = this.lastSeen;
    this.handlers.onStatus("connecting");
    this.flushQueue();
    this.heartbeat = setInterval(() => this.checkHeartbeat(), HEARTBEAT_MS);
  }

  request<T>(type: BridgeCommandType, payload: unknown, timeoutMs = 15_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The Owlbear connection is closed."));
    const check = validateCommand(type, payload);
    if (!check.ok) return Promise.reject(new ProtocolError(check.error));

    const id = newMessageId();
    const envelope = makeEnvelope("malice", this.sessionId, type, check.value, id);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const queued = this.sendQueue.findIndex((entry) => entry.id === id);
        if (queued !== -1) this.sendQueue.splice(queued, 1);
        reject(new ProtocolError({ code: "TIMEOUT", message: `${type} timed out.` }));
      }, timeoutMs);
      this.pending.set(id, {
        type,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      if (this.started) this.post(envelope);
      else this.sendQueue.push(envelope);
    });
  }

  close(reason = "Closed by Malice Menagerie.", status: ConnectionStatus = "disconnected"): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.port.removeEventListener("message", this.handleMessage);
    this.port.removeEventListener("messageerror", this.handleMessageError);
    try {
      this.port.close();
    } catch {
      // Already detached.
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    this.sendQueue.length = 0;
    this.handlers.onStatus(status, reason);
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (this.closed) return;
    const envelope = event.data;
    if (!isBridgeEnvelope(envelope)) {
      this.handlers.onLog("Dropped a malformed bridge message.");
      return;
    }
    if (envelope.sessionId !== this.sessionId) {
      this.handlers.onLog("Dropped a message for a different session.");
      return;
    }
    if (envelope.source !== "owlbear") {
      this.handlers.onLog("Dropped a message with the wrong source.");
      return;
    }
    if (envelope.replyTo) {
      this.acceptResponse(envelope);
      return;
    }
    if (!isEventType(envelope.type)) {
      this.handlers.onLog(`Dropped an unknown event type: ${envelope.type}`);
      return;
    }
    const payload = validateEvent(envelope.type, envelope.payload);
    if (!payload.ok) {
      this.handlers.onLog(`Dropped an invalid ${envelope.type} event: ${payload.error.message}`);
      return;
    }
    this.lastSeen = Date.now();
    if (envelope.type === "PONG") {
      if (this.lastSeen - this.lastPingSent >= HEARTBEAT_MS / 2) {
        this.lastPingSent = this.lastSeen;
        void this.request("PING", {}, 10_000).catch(() => {});
      }
      return;
    }
    if (envelope.type === "DISCONNECTED") {
      this.close((payload.value as { reason: string }).reason);
      return;
    }
    this.handlers.onEvent(envelope.type, payload.value);
  };

  private readonly handleMessageError = () => {
    this.handlers.onLog("The bridge port received a message it could not decode.");
  };

  private acceptResponse(envelope: BridgeEnvelope): void {
    const pending = this.pending.get(envelope.replyTo ?? "");
    if (!pending || envelope.type !== pending.type) {
      this.handlers.onLog(`Dropped an unmatched response: ${envelope.type}`);
      return;
    }
    this.pending.delete(envelope.replyTo as string);
    clearTimeout(pending.timer);
    this.lastSeen = Date.now();
    if (envelope.ok === false || envelope.error) {
      pending.reject(
        new ProtocolError(
          envelope.error ?? { code: "UNKNOWN", message: "The extension reported an error." },
        ),
      );
      return;
    }
    const check = validateResponse(pending.type, envelope.payload);
    if (!check.ok) {
      this.handlers.onLog(`Dropped an invalid ${pending.type} response: ${check.error.message}`);
      pending.reject(new ProtocolError(check.error));
      return;
    }
    pending.resolve(check.value);
  }

  private post(envelope: BridgeEnvelope): void {
    try {
      this.port.postMessage(envelope);
    } catch (error) {
      const reason = `Could not send ${envelope.type}: ${error instanceof Error ? error.message : "unknown error"}`;
      this.handlers.onLog(reason);
      this.close(`${reason}. Open the extension and press Connect again.`, "lost");
    }
  }

  private flushQueue(): void {
    for (const envelope of this.sendQueue.splice(0)) this.post(envelope);
  }

  private checkHeartbeat(): void {
    if (this.closed) return;
    const now = Date.now();
    // Background tabs throttle setInterval to ~60s; only treat larger jumps as
    // system sleep and grant a bounded grace window for queued replies.
    if (now - this.lastCheck > WAKE_JUMP_MS) {
      this.lastSeen = Math.max(this.lastSeen, now - LOST_AFTER_MS + WAKE_GRACE_MS);
    }
    this.lastCheck = now;
    if (now - this.lastSeen > LOST_AFTER_MS) {
      this.close("Owlbear stopped responding. Open the extension and press Connect again.", "lost");
      return;
    }
    this.lastPingSent = now;
    void this.request("PING", {}, 4_000).catch(() => {
      // The heartbeat timeout check above owns the failure state.
    });
  }
}

export function protocolVersionLabel(): string {
  return `${PROTOCOL_NAME} v${PROTOCOL_VERSION}`;
}
