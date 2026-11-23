import { isHelloMessage, type HelloMessage } from "./protocol.ts";

// Each origin keeps its end of the channel here across document reloads. The
// server asks the client to repeat CONNECT when a new background attaches.
// Browsers retain SharedWorkers briefly between loads; extendedLifetime adds
// a longer grace period where supported. This is not browser-restart storage.
interface Metadata {
  hello: HelloMessage;
  origin: string;
}
const scope = self as unknown as { onconnect: (event: MessageEvent) => void };
let remote: MessagePort | null = null;
let local: MessagePort | null = null;
let owner: MessagePort | null = null;
let metadata: Metadata | null = null;
let role = "";
const CONTROL = "malice-menagerie/session-transport";

function safePost(port: MessagePort | null, message: unknown, transfer?: Transferable[]): void {
  if (!port) return;
  try {
    if (transfer) port.postMessage(message, transfer);
    else port.postMessage(message);
  } catch {
    // Port already closed or detached.
  }
}

function attach(): void {
  if (!owner || !metadata || !remote) return;
  local?.close();
  const channel = new MessageChannel();
  local = channel.port1;
  local.onmessage = (event: MessageEvent<unknown>) => safePost(remote, event.data);
  safePost(owner, { type: "session", ...metadata }, [channel.port2]);
}
function clear(notifyRemote: boolean, notifyOwner = true): void {
  if (notifyRemote) safePost(remote, { transport: CONTROL, type: "stop" });
  remote?.close();
  local?.close();
  remote = local = null;
  metadata = null;
  if (notifyOwner) safePost(owner, { type: "forgot", reason: "stopped" });
}
scope.onconnect = (event) => {
  const port = event.ports[0];
  if (!port) return;
  port.onmessage = (message: MessageEvent<unknown>) => {
    if (!message.data || typeof message.data !== "object") return;
    const data = message.data as Record<string, unknown>;
    if (data["type"] === "register" && ["client", "server"].includes(String(data["role"]))) {
      const previousOwner = owner;
      owner = port;
      role = String(data["role"]);
      if (data["ack"] === true) safePost(port, { type: "ready" });
      if (previousOwner && previousOwner !== port && metadata && remote) {
        safePost(previousOwner, { type: "forgot", reason: "displaced" });
      }
      if (metadata && remote) {
        attach();
        if (role === "server") safePost(remote, { transport: CONTROL, type: "resume" });
      }
      return;
    }
    if (port !== owner) return;
    if (data["type"] === "clear") {
      clear(true, false);
      return;
    }
    if (
      data["type"] !== "install" ||
      !isHelloMessage(data["hello"]) ||
      typeof data["origin"] !== "string" ||
      !message.ports[0]
    )
      return;
    remote?.close();
    remote = message.ports[0];
    metadata = { hello: data["hello"], origin: data["origin"] };
    remote.onmessage = (incoming: MessageEvent<unknown>) => {
      const value = incoming.data;
      if (
        value &&
        typeof value === "object" &&
        "transport" in value &&
        value.transport === CONTROL
      ) {
        if ("type" in value && value.type === "stop") clear(false);
        else if ("type" in value && value.type === "resume" && role === "client") attach();
        return;
      }
      safePost(local, value);
    };
    attach();
  };
};
