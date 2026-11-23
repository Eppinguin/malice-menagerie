import { isHelloMessage, newMessageId, type HelloMessage } from "../../shared/obr/protocol.ts";

/**
 * Same-origin tab rendezvous, see `public/pairing-worker.js`.
 *
 * A pairing tab joins with `pairing: true`; every other Malice tab joins as a
 * candidate. When the pairing tab receives the extension's port it asks the
 * worker for the tab the user was last using and hands the port there. If no
 * other tab answers, the port stays with the pairing tab and is adopted
 * locally, exactly as before.
 */
const WORKER_URL = "/pairing-worker.js";
const WORKER_NAME = "malice-menagerie-tabs";
/** Long enough for a worker round trip, short enough not to delay a first pairing. */
const READY_TIMEOUT_MS = 800;
/** A short wait after the worker's welcome, so a tab that is still loading can join. */
const READY_GRACE_MS = 250;
/** Long enough for the worker to drop a dead target and try the next one. */
const HANDOFF_TIMEOUT_MS = 3_500;

export type HandoffResult = { delivered: true } | { delivered: false; port: MessagePort | null };

export interface PairingRelay {
  /** Resolves once the worker names the tab that should receive a pairing. */
  readonly ready: Promise<string | null>;
  readonly preferredTabId: string | null;
  /** Resolves when another Malice tab appears, or with null after `timeoutMs`. */
  waitForPeer(timeoutMs: number): Promise<string | null>;
  handoff(hello: HelloMessage, origin: string, port: MessagePort): Promise<HandoffResult>;
  close(): void;
}

interface PendingHandoff {
  port: MessagePort | null;
  origin: string;
  hello: HelloMessage;
  resolve: (result: HandoffResult) => void;
  timer: ReturnType<typeof setTimeout>;
  phase: "prepare" | "sent";
}

export function openPairingRelay(options: {
  pairing: boolean;
  onAdopt: (hello: HelloMessage, origin: string, port: MessagePort, handoffId: string) => boolean;
}): PairingRelay | null {
  if (typeof SharedWorker === "undefined") return null;
  let worker: SharedWorker;
  try {
    worker = new SharedWorker(WORKER_URL, { name: WORKER_NAME });
  } catch {
    return null;
  }

  const workerPort = worker.port;
  workerPort.start();
  const tabId = newMessageId();
  const pending = new Map<string, PendingHandoff>();
  const peerWaiters = new Set<(tabId: string | null) => void>();
  let preferredTabId: string | null = null;
  let closed = false;
  let failed = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady: (() => void) | undefined;
  let resolveReadyNow: (() => void) | undefined;

  function send(message: unknown, transfer: Transferable[] = []): boolean {
    if (closed || failed) return false;
    try {
      workerPort.postMessage(message, transfer);
      return true;
    } catch {
      return false;
    }
  }

  function setPreferred(value: string | null): void {
    preferredTabId = value;
    if (!value) return;
    for (const waiter of peerWaiters) waiter(value);
  }

  const ready = new Promise<string | null>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      clearTimeout(graceTimer);
      resolve(preferredTabId);
    };
    readyTimer = setTimeout(done, READY_TIMEOUT_MS);
    resolveReady = () => {
      clearTimeout(readyTimer);
      graceTimer = setTimeout(done, READY_GRACE_MS);
    };
    resolveReadyNow = done;
  });

  worker.onerror = () => {
    failed = true;
    resolveReadyNow?.();
    for (const waiter of peerWaiters) waiter(null);
    peerWaiters.clear();
    for (const [handoffId, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ delivered: false, port: entry.port });
      pending.delete(handoffId);
    }
  };

  function finish(handoffId: string, result: HandoffResult): void {
    const entry = pending.get(handoffId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(handoffId);
    entry.resolve(result);
  }

  workerPort.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    const record = data as Record<string, unknown>;
    const handoffId = typeof record["handoffId"] === "string" ? record["handoffId"] : "";

    switch (record["type"]) {
      case "welcome": {
        setPreferred(typeof record["preferred"] === "string" ? record["preferred"] : null);
        resolveReady?.();
        return;
      }
      case "preferred": {
        setPreferred(typeof record["preferred"] === "string" ? record["preferred"] : null);
        return;
      }
      case "prepare": {
        // The worker is asking whether this tab is alive before the port moves.
        if (handoffId) send({ type: "ready", handoffId });
        return;
      }
      case "commit": {
        const entry = pending.get(handoffId);
        if (!entry || entry.phase !== "prepare" || !entry.port) return;
        clearTimeout(entry.timer);
        const port = entry.port;
        if (
          !send({ type: "handoff", handoffId, origin: entry.origin, hello: entry.hello }, [port])
        ) {
          finish(handoffId, { delivered: false, port });
          return;
        }
        entry.port = null;
        entry.phase = "sent";
        entry.timer = setTimeout(
          () => finish(handoffId, { delivered: false, port: null }),
          HANDOFF_TIMEOUT_MS,
        );
        return;
      }
      case "abort": {
        const entry = pending.get(handoffId);
        if (entry) finish(handoffId, { delivered: false, port: entry.port });
        return;
      }
      case "handoff-result": {
        finish(
          handoffId,
          record["ok"] === true
            ? { delivered: true }
            : { delivered: false, port: event.ports[0] ?? null },
        );
        return;
      }
      case "adopt": {
        const hello = record["hello"];
        const origin = record["origin"];
        const port = event.ports[0];
        if (!handoffId || !port || typeof origin !== "string" || !isHelloMessage(hello)) {
          if (port) send({ type: "rejected", handoffId }, [port]);
          return;
        }
        let adopted = false;
        try {
          adopted = options.onAdopt(hello, origin, port, handoffId);
        } catch {
          adopted = false;
        }
        if (adopted) send({ type: "adopted", handoffId });
        else send({ type: "rejected", handoffId }, [port]);
        return;
      }
      default:
        return;
    }
  };

  const isFocused = () => (typeof document !== "undefined" ? document.hasFocus() : false);
  if (!send({ type: "register", tabId, pairing: options.pairing, focused: isFocused() })) {
    workerPort.close();
    return null;
  }

  const reportFocus = () => {
    if (closed) return;
    send({ type: "focus", tabId, focused: isFocused() });
  };
  if (!options.pairing) {
    window.addEventListener("focus", reportFocus);
    window.addEventListener("blur", reportFocus);
    reportFocus();
  }

  // `beforeunload` is not reliable (and never fires for a discarded tab), so a
  // closing tab also says goodbye here. Otherwise the worker keeps a dead
  // entry and may hand the next pairing to it.
  const leave = () => {
    if (closed) return;
    send({ type: "unregister", tabId });
  };
  const returnFromCache = () => {
    if (closed) return;
    send({ type: "register", tabId, pairing: options.pairing, focused: isFocused() });
  };
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) returnFromCache();
  };
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", restore);

  return {
    ready,
    get preferredTabId() {
      return preferredTabId;
    },
    waitForPeer(timeoutMs) {
      if (closed || failed || preferredTabId) return Promise.resolve(preferredTabId);
      return new Promise<string | null>((resolve) => {
        const waiter = (id: string | null) => {
          clearTimeout(timer);
          peerWaiters.delete(waiter);
          resolve(id);
        };
        const timer = setTimeout(() => {
          peerWaiters.delete(waiter);
          resolve(preferredTabId);
        }, timeoutMs);
        peerWaiters.add(waiter);
      });
    },
    handoff(hello, origin, port) {
      if (closed || failed || !preferredTabId)
        return Promise.resolve({ delivered: false, port } satisfies HandoffResult);
      const handoffId = newMessageId();
      return new Promise<HandoffResult>((resolve) => {
        const entry: PendingHandoff = {
          port,
          origin,
          hello,
          resolve,
          phase: "prepare",
          timer: setTimeout(() => {
            send({ type: "cancel", handoffId });
            finish(handoffId, { delivered: false, port });
          }, HANDOFF_TIMEOUT_MS),
        };
        pending.set(handoffId, entry);
        if (!send({ type: "prepare", handoffId, to: preferredTabId })) {
          finish(handoffId, { delivered: false, port });
        }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      resolveReadyNow?.();
      window.removeEventListener("focus", reportFocus);
      window.removeEventListener("blur", reportFocus);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", restore);
      try {
        workerPort.postMessage({ type: "unregister", tabId });
      } catch {
        // Already detached.
      }
      for (const waiter of peerWaiters) waiter(null);
      peerWaiters.clear();
      for (const [handoffId, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ delivered: false, port: entry.port });
        pending.delete(handoffId);
      }
      workerPort.close();
    },
  };
}
