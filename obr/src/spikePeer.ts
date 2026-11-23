import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  READY_MESSAGE_TYPE,
  isHelloMessage,
} from "../../shared/obr/protocol.ts";

/**
 * The peer half of the Phase 0 spike. It announces READY to its opener, then
 * answers HELLO over the transferred port. Kept deliberately tiny so a failure
 * points at the transport, not at Malice or Owlbear scene APIs.
 */

const status = document.getElementById("status") as HTMLParagraphElement;

if (!window.opener) {
  status.textContent = "No window.opener. The popover opened this page without a handle.";
} else {
  window.opener.postMessage(
    { protocol: PROTOCOL_NAME, version: PROTOCOL_VERSION, type: READY_MESSAGE_TYPE },
    window.location.origin,
  );
  status.textContent = "READY sent. Waiting for HELLO and a message port…";

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (!isHelloMessage(event.data)) return;
    const port = event.ports[0];
    if (!port) {
      status.textContent = "HELLO arrived without a transferred port.";
      return;
    }
    port.postMessage({ type: "SPIKE_PONG", sessionId: event.data.sessionId });
    status.textContent = "HELLO accepted and PONG sent over the port.";
  });
}
