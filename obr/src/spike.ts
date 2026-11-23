import {
  HELLO_MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  isReadyMessage,
  type HelloMessage,
} from "../../shared/obr/protocol.ts";

/**
 * Throwaway Phase 0 diagnostic. Run it from an OBR popover (repoint the
 * manifest's `action.popover`) before trusting the real bridge. It exercises
 * the three platform assumptions that cannot be proven offline:
 *
 * 1. a popover may call `window.open`;
 * 2. the opened window may post READY back to the popover;
 * 3. a transferable MessagePort survives the hop and carries both directions.
 */

const logList = document.getElementById("log") as HTMLOListElement;
const resultBox = document.getElementById("result") as HTMLParagraphElement;
const runButton = document.getElementById("run") as HTMLButtonElement;

const SPIKE_PEER = "spike-peer.html";
const SPIKE_WINDOW = "malice-menagerie-spike-peer";
const TIMEOUT_MS = 10_000;

let popup: Window | null = null;
let port: MessagePort | null = null;
let timeout: ReturnType<typeof setTimeout> | undefined;
let finished = false;

function log(message: string, ok?: boolean): void {
  const item = document.createElement("li");
  item.textContent = message;
  if (ok !== undefined) item.dataset["ok"] = String(ok);
  logList.append(item);
}

function finish(ok: boolean, message: string): void {
  if (finished) return;
  finished = true;
  if (timeout !== undefined) clearTimeout(timeout);
  resultBox.hidden = false;
  resultBox.textContent = message;
  runButton.disabled = false;
  log(message, ok);
}

function reset(): void {
  finished = false;
  logList.replaceChildren();
  resultBox.hidden = true;
  resultBox.textContent = "";
  port?.close();
  port = null;
  if (timeout !== undefined) clearTimeout(timeout);
  timeout = undefined;
  try {
    popup?.close();
  } catch {
    // A closed popup is fine.
  }
  popup = null;
}

window.addEventListener("message", (event) => {
  if (!popup || event.source !== popup) return;
  log(`Peer replied from origin ${event.origin}`);
  if (event.origin !== window.location.origin) {
    finish(false, `Origin mismatch: expected ${window.location.origin}.`);
    return;
  }
  if (!isReadyMessage(event.data)) return;
  log("READY received from the opened window", true);

  const channel = new MessageChannel();
  port = channel.port1;
  port.onmessage = (message: MessageEvent<unknown>) => {
    const data = message.data;
    if (
      typeof data !== "object" ||
      data === null ||
      (data as Record<string, unknown>)["type"] !== "SPIKE_PONG"
    )
      return;
    log("PONG returned over the transferred port", true);
    finish(true, "PASS: window.open, READY, and MessagePort all work in this host.");
  };

  const hello: HelloMessage = {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: HELLO_MESSAGE_TYPE,
    sessionId: "spike-session",
    pairingToken: "spike-token",
    extensionVersion: "spike",
  };
  try {
    popup?.postMessage(hello, event.origin, [channel.port2]);
    log("HELLO sent with one transferred port", true);
  } catch (error) {
    finish(false, `postMessage failed: ${String(error)}`);
  }
});

runButton.addEventListener("click", () => {
  reset();
  log(`Popover origin: ${window.location.origin}`);
  log(`Secure context: ${String(window.isSecureContext)}`);
  runButton.disabled = true;

  try {
    popup = window.open(SPIKE_PEER, SPIKE_WINDOW, "width=420,height=520");
  } catch (error) {
    finish(false, `window.open threw: ${String(error)}`);
    return;
  }
  if (!popup) {
    finish(false, "window.open returned null. Owlbear or the browser blocked the popup.");
    return;
  }
  log("window.open returned a window handle", true);

  timeout = setTimeout(() => {
    finish(
      false,
      "Timed out. The opened window never sent READY; check the popup console and whether it loaded at all.",
    );
  }, TIMEOUT_MS);
});
