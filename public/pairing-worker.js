/**
 * Same-origin rendezvous between Malice Menagerie tabs.
 *
 * The Owlbear popover can only hand its `MessagePort` to the window it opened.
 * If the user already has Malice Menagerie open, that new window should not
 * become the place they have to work: it forwards the port to the tab they
 * were using and closes. `BroadcastChannel` cannot carry a port, so this
 * SharedWorker does the transfer.
 *
 * The hand-off is two-phase on purpose. The pairing tab asks first, and only
 * transfers the port once the target tab has answered. A closed or frozen
 * target therefore leaves the port with the pairing tab, which can still adopt
 * it locally instead of losing the connection.
 *
 * A tab that is closed or reloaded cannot always tell the worker, so a target
 * that does not answer the first probe is forgotten and the next candidate is
 * tried. Without that, a stale entry would keep winning `preferred` and every
 * Connect would open a second tab.
 *
 * Everything here is same-origin and therefore already as trusted as the app
 * itself. The receiving tab still re-checks the extension origin.
 */
const tabs = new Map();
const pending = new Map();
let lastFocused = null;

/** How long a tab gets to answer the liveness probe before it is dropped. */
const READY_TIMEOUT_MS = 1000;
/** How long the source or target gets to finish after a probe succeeds. */
const FINISH_TIMEOUT_MS = 3500;

function preferred(exclude) {
  if (lastFocused && lastFocused !== exclude && tabs.has(lastFocused)) return lastFocused;
  for (const [id, tab] of tabs) {
    if (id !== exclude && !tab.pairing) return id;
  }
  return null;
}

function post(port, message, transfer) {
  try {
    port.postMessage(message, transfer ?? []);
  } catch {
    // The other end went away between the check and the send.
  }
}

function forget(tabId) {
  tabs.delete(tabId);
  if (lastFocused === tabId) lastFocused = null;
  // A pairing tab may be waiting for a peer. Tell it the candidate changed so
  // it does not hand the port to a tab that is gone.
  for (const [id, tab] of tabs) {
    if (tab.pairing) post(tab.port, { type: "preferred", tabId: id, preferred: preferred(id) });
  }
}

function clearPending(handoffId) {
  const entry = pending.get(handoffId);
  if (!entry) return null;
  clearTimeout(entry.timer);
  pending.delete(handoffId);
  return entry;
}

function startHandoff(handoffId, sourceId, sourcePort, requestedId) {
  const requested = requestedId ? tabs.get(requestedId) : null;
  const targetId = requested && !requested.pairing ? requestedId : preferred(sourceId);
  const target = targetId ? tabs.get(targetId) : null;
  if (!targetId || !target) {
    post(sourcePort, { type: "abort", handoffId });
    return;
  }
  const entry = {
    handoffId,
    sourceId,
    sourcePort,
    targetId,
    targetPort: target.port,
    timer: setTimeout(() => {
      // No answer: the tab was closed, reloaded, or frozen. Drop it and try
      // the next one instead of making the pairing tab keep the connection.
      pending.delete(handoffId);
      forget(targetId);
      startHandoff(handoffId, sourceId, sourcePort, null);
    }, READY_TIMEOUT_MS),
  };
  pending.set(handoffId, entry);
  post(target.port, { type: "prepare", handoffId });
}

self.onconnect = (event) => {
  const port = event.ports[0];
  if (!port) return;
  let tabId = null;

  port.onmessage = (message) => {
    const data = message.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "register") {
      if (typeof data.tabId !== "string" || !data.tabId) return;
      tabId = data.tabId;
      tabs.set(tabId, { port, pairing: data.pairing === true });
      if (data.pairing !== true) {
        if (data.focused !== false || !lastFocused || !tabs.has(lastFocused)) {
          lastFocused = tabId;
        }
        // A pairing tab may already be waiting. Tell it a normal tab exists so
        // a slow-loading app tab can still receive the port.
        for (const [id, tab] of tabs) {
          if (id !== tabId && tab.pairing) {
            post(tab.port, { type: "preferred", tabId: id, preferred: preferred(id) });
          }
        }
      }
      post(port, { type: "welcome", tabId, preferred: preferred(tabId) });
      return;
    }

    if (data.type === "unregister") {
      if (!tabId) return;
      const gone = tabId;
      tabId = null;
      forget(gone);
      return;
    }

    if (data.type === "focus") {
      if (!tabId) return;
      const tab = tabs.get(tabId);
      if (!tab || tab.pairing) return;
      if (data.focused === true) lastFocused = tabId;
      return;
    }

    if (data.type === "prepare") {
      const source = tabId ? tabs.get(tabId) : null;
      const handoffId = typeof data.handoffId === "string" ? data.handoffId : "";
      if (!source || !handoffId) return;
      startHandoff(handoffId, tabId, source.port, typeof data.to === "string" ? data.to : null);
      return;
    }

    if (data.type === "ready") {
      const entry = pending.get(data.handoffId);
      if (!entry) return;
      // Only the tab the source asked for may answer.
      if (!tabId || tabId !== entry.targetId || tabs.get(tabId)?.port !== entry.targetPort) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        pending.delete(data.handoffId);
      }, FINISH_TIMEOUT_MS);
      post(entry.sourcePort, { type: "commit", handoffId: data.handoffId });
      return;
    }

    if (data.type === "cancel") {
      const entry = pending.get(data.handoffId);
      if (!entry || tabId !== entry.sourceId) return;
      clearPending(data.handoffId);
      return;
    }

    if (data.type === "handoff") {
      const entry = pending.get(data.handoffId);
      const transferred = message.ports && message.ports[0];
      if (!entry || !transferred || tabId !== entry.sourceId) {
        if (transferred && tabId && tabs.get(tabId)) {
          post(
            tabs.get(tabId).port,
            { type: "handoff-result", handoffId: data.handoffId, ok: false },
            [transferred],
          );
        }
        return;
      }
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        pending.delete(data.handoffId);
        forget(entry.targetId);
        post(entry.sourcePort, { type: "handoff-result", handoffId: data.handoffId, ok: false });
      }, FINISH_TIMEOUT_MS);
      post(
        entry.targetPort,
        { type: "adopt", handoffId: data.handoffId, origin: data.origin, hello: data.hello },
        [transferred],
      );
      return;
    }

    if (data.type === "adopted" || data.type === "rejected") {
      const current = pending.get(data.handoffId);
      if (!current || tabId !== current.targetId) return;
      const entry = clearPending(data.handoffId);
      if (!entry) return;
      if (data.type === "adopted") {
        post(entry.sourcePort, { type: "handoff-result", handoffId: data.handoffId, ok: true });
      } else {
        const transferred = message.ports && message.ports[0];
        post(
          entry.sourcePort,
          { type: "handoff-result", handoffId: data.handoffId, ok: false },
          transferred ? [transferred] : [],
        );
      }
    }
  };

  port.start();
};
