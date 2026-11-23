/**
 * Rendezvous for the popover's Malice MessagePort.
 *
 * Owlbear unmounts the action popover when it closes, and a `BroadcastChannel`
 * cannot transfer a `MessagePort` (it has no transfer list), so the popover
 * cannot hand its port to the long-lived background page directly. Both pages
 * connect to this shared worker instead: the background registers per room and
 * the popover sends the port with the room id, so the worker can route it.
 *
 * The worker stays alive while either page is connected; the background page
 * is always open, so the port survives the popover closing.
 *
 * Plain JavaScript on purpose: it is served verbatim from `public/`, outside
 * the Vite bundle and the TypeScript project.
 */
const backgrounds = new Map();
const queues = new Map();
const probes = new Map();
const MAX_QUEUED = 4;
const QUEUE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 500;
let nextProbeId = 0;

function enqueue(roomId, item) {
  const now = Date.now();
  const queued = (queues.get(roomId) ?? []).filter((entry) => {
    if (now - entry.queuedAt <= QUEUE_TTL_MS) return true;
    closePorts(entry.ports);
    return false;
  });
  while (queued.length >= MAX_QUEUED) {
    const dropped = queued.shift();
    if (dropped) closePorts(dropped.ports);
  }
  queued.push({ data: item.data, ports: item.ports, queuedAt: now });
  queues.set(roomId, queued);
}

function flushQueue(roomId, port) {
  const queued = queues.get(roomId);
  if (!queued) return;
  queues.delete(roomId);
  const now = Date.now();
  for (const item of queued) {
    if (now - item.queuedAt > QUEUE_TTL_MS || !deliver(port, item)) {
      closePorts(item.ports);
    }
  }
}

function cancelProbes(roomId, onlyTargetPort) {
  const rescued = [];
  for (const [probeId, entry] of probes) {
    if (entry.roomId !== roomId) continue;
    if (onlyTargetPort && entry.target.port !== onlyTargetPort) continue;
    clearTimeout(entry.timer);
    probes.delete(probeId);
    rescued.push(entry.item);
  }
  return rescued;
}

function routeItem(roomId, item) {
  const target = backgrounds.get(roomId);
  if (target) {
    if (target.probe) {
      const probeId = `p-${++nextProbeId}`;
      const timer = setTimeout(() => {
        const entry = probes.get(probeId);
        if (!entry) return;
        probes.delete(probeId);
        if (backgrounds.get(roomId) === target) {
          backgrounds.delete(roomId);
          enqueue(roomId, entry.item);
        } else {
          // A replacement background registered while this probe was in flight.
          routeItem(roomId, entry.item);
        }
      }, PROBE_TIMEOUT_MS);
      probes.set(probeId, { roomId, target, item, timer });
      try {
        target.port.postMessage({ type: "ping", probeId });
        return;
      } catch {
        clearTimeout(timer);
        probes.delete(probeId);
        if (backgrounds.get(roomId) === target) backgrounds.delete(roomId);
      }
    } else {
      if (deliver(target.port, item)) return;
      // Dead background port: forget it and queue this fresh pairing so a
      // newly booting background can adopt it.
      if (backgrounds.get(roomId) === target) backgrounds.delete(roomId);
    }
  }
  // The background may still be starting. Queue briefly instead of dropping
  // the only port that can carry this pairing; evict stale oldest entries first.
  enqueue(roomId, item);
}

self.onconnect = (event) => {
  const port = event.ports[0];
  if (!port) return;
  port.onmessage = (message) => {
    const data = message.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "pong" && typeof data.probeId === "string") {
      const pending = probes.get(data.probeId);
      if (!pending || pending.target.port !== port) return;
      clearTimeout(pending.timer);
      probes.delete(data.probeId);
      if (backgrounds.get(pending.roomId) !== pending.target) {
        routeItem(pending.roomId, pending.item);
        return;
      }
      if (!deliver(pending.target.port, pending.item)) {
        if (backgrounds.get(pending.roomId) === pending.target) backgrounds.delete(pending.roomId);
        enqueue(pending.roomId, pending.item);
      }
      return;
    }

    const roomId = typeof data.roomId === "string" ? data.roomId : "";
    if (!roomId) return;

    if (data.type === "unregister") {
      const current = backgrounds.get(roomId);
      if (current && current.port === port) backgrounds.delete(roomId);
      for (const item of cancelProbes(roomId, port)) enqueue(roomId, item);
      return;
    }

    if (data.type === "register" && data.role === "background") {
      backgrounds.set(roomId, { port, probe: data.probe === true });
      for (const item of cancelProbes(roomId, null)) enqueue(roomId, item);
      flushQueue(roomId, port);
      return;
    }

    if (data.type !== "bridge") return;
    const adopt = {
      type: "adopt",
      sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
      pairingToken: typeof data.pairingToken === "string" ? data.pairingToken : "",
    };
    const ports = Array.isArray(message.ports) ? message.ports : [];
    routeItem(roomId, { data: adopt, ports });
  };
};

function closePorts(ports) {
  for (const port of ports) {
    try {
      port.close();
    } catch {
      // Already closed or detached.
    }
  }
}

function deliver(target, item) {
  try {
    target.postMessage(item.data, item.ports);
    return true;
  } catch {
    return false;
  }
}
