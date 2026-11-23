import { isHelloMessage, newMessageId, type HelloMessage } from "./protocol.ts";

// Newer browsers support this option ahead of the project's DOM typings.
declare global {
  interface WorkerOptions {
    extendedLifetime?: boolean;
  }
}

export type SessionForgotReason = "stopped" | "displaced";

const READY_FALLBACK_MS = 1_500;

function workerBuildTag(): string {
  try {
    const pathname = new URL(import.meta.url).pathname;
    return pathname.split("/").pop() || "v1";
  } catch {
    return "v1";
  }
}

export function openSessionLease(options: {
  name: string;
  role: "client" | "server";
  onAdopt: (hello: HelloMessage, origin: string, port: MessagePort) => void;
  onForgot: (reason: SessionForgotReason) => void;
  onError: () => void;
}) {
  let worker: SharedWorker;
  try {
    // Include the bundle filename in the SharedWorker name so a new deploy
    // never collides with an older extendedLifetime worker from a prior build.
    worker = new SharedWorker(new URL("./sessionWorker.ts", import.meta.url), {
      extendedLifetime: true,
      name: `malice-session/${workerBuildTag()}/${options.name}`,
      type: "module",
    });
  } catch {
    return null;
  }
  let failed = false;
  let ready = false;
  let closed = false;
  let pendingInstall: {
    hello: HelloMessage;
    origin: string;
    port: MessagePort;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  function flushPendingToDirect(): void {
    if (!pendingInstall) return;
    const entry = pendingInstall;
    pendingInstall = null;
    clearTimeout(entry.timer);
    if (!closed) options.onAdopt(entry.hello, entry.origin, entry.port);
    else {
      try {
        entry.port.close();
      } catch {
        // Already detached.
      }
    }
  }

  function failWorker(): void {
    if (failed) return;
    failed = true;
    worker.port.onmessage = null;
    try {
      worker.port.close();
    } catch {
      // Already detached.
    }
    // Notify the caller BEFORE adopting any buffered port directly so
    // background reload-recovery flags flip on and app-side onError sees
    // pre-adoption state rather than clobbering the new direct connection.
    if (!closed) options.onError();
    flushPendingToDirect();
  }

  worker.onerror = () => {
    failWorker();
  };
  worker.port.onmessage = (event: MessageEvent<unknown>) => {
    if (closed || failed || !event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    if (data["type"] === "ready") {
      ready = true;
      if (pendingInstall) {
        const entry = pendingInstall;
        pendingInstall = null;
        clearTimeout(entry.timer);
        try {
          worker.port.postMessage({ type: "install", hello: entry.hello, origin: entry.origin }, [
            entry.port,
          ]);
        } catch {
          pendingInstall = { ...entry, timer: setTimeout(() => {}, 0) };
          clearTimeout(pendingInstall.timer);
          failWorker();
        }
      }
      return;
    }
    if (data["type"] === "forgot") {
      const reason: SessionForgotReason = data["reason"] === "displaced" ? "displaced" : "stopped";
      options.onForgot(reason);
      return;
    }
    const hello = data["hello"];
    const port = event.ports[0];
    if (
      data["type"] !== "session" ||
      !isHelloMessage(hello) ||
      typeof data["origin"] !== "string" ||
      !port
    )
      return;
    ready = true;
    options.onAdopt(hello, data["origin"], port);
  };
  worker.port.start();
  worker.port.postMessage({ type: "register", role: options.role, ack: true });
  return {
    install(hello: HelloMessage, origin: string, port: MessagePort): void {
      if (closed || failed) {
        options.onAdopt(hello, origin, port);
        return;
      }
      if (!ready) {
        if (pendingInstall) {
          clearTimeout(pendingInstall.timer);
          try {
            pendingInstall.port.close();
          } catch {
            // Replaced before worker became ready.
          }
        }
        pendingInstall = {
          hello,
          origin,
          port,
          timer: setTimeout(() => {
            failWorker();
          }, READY_FALLBACK_MS),
        };
        return;
      }
      try {
        worker.port.postMessage({ type: "install", hello, origin }, [port]);
      } catch {
        pendingInstall = {
          hello,
          origin,
          port,
          timer: setTimeout(() => {}, 0),
        };
        clearTimeout(pendingInstall.timer);
        failWorker();
      }
    },
    clear(): void {
      if (pendingInstall) {
        clearTimeout(pendingInstall.timer);
        try {
          pendingInstall.port.close();
        } catch {
          // Already detached.
        }
        pendingInstall = null;
      }
      if (closed || failed) return;
      try {
        worker.port.postMessage({ type: "clear" });
      } catch {
        // Already detached.
      }
    },
    close(): void {
      closed = true;
      if (pendingInstall) {
        clearTimeout(pendingInstall.timer);
        try {
          pendingInstall.port.close();
        } catch {
          // Already detached.
        }
        pendingInstall = null;
      }
      worker.port.onmessage = null;
      try {
        worker.port.close();
      } catch {
        // Already detached.
      }
    },
  };
}

/** sessionStorage survives reloads. A pairing popup gets a new id because its
 * opener can have copied another Malice tab's storage namespace. */
export function sessionLeaseId(fresh: boolean): string {
  const key = "malice-menagerie/channel-owner";
  try {
    const existing = sessionStorage.getItem(key);
    if (!fresh && existing) return existing;
    const id = newMessageId();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return newMessageId();
  }
}
