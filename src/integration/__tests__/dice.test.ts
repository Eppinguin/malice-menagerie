import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  listeners: new Map<string, (event: { data: unknown; connectionId?: string }) => void>(),
  send: vi.fn(async (_channel: string, _data: unknown, _options: { destination: string }) => {}),
  saved: new Map<string, string>(),
  connectionId: "local-conn",
}));
vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    player: {
      getConnectionId: vi.fn(async () => mock.connectionId),
    },
    broadcast: {
      onMessage: (
        channel: string,
        fn: (event: { data: unknown; connectionId?: string }) => void,
      ) => {
        mock.listeners.set(channel, fn);
        return () => mock.listeners.delete(channel);
      },
      sendMessage: mock.send,
    },
  },
}));
import {
  ConnectedDice,
  DICE_CONFIG,
  DICE_HELLO,
  DICE_REPLY,
  parseDiceConfig,
} from "../../../obr/src/dice.ts";
import { validateCommand, validateResponse } from "../../../shared/obr/protocol.ts";
import { resolvePowerRollDice } from "../../lib/rules.ts";
let dice: ConnectedDice;
const changed = vi.fn();
const config = {
  dieTypes: ["D10"],
  rollRequestChannels: ["dice.rollRequest", "dice.powerRollRequest"],
  styles: [
    { id: "blue", color: "#123456" },
    { id: "red", color: "#ff0000" },
  ],
};
const emit = (channel: string, data: unknown, connectionId?: string) =>
  mock.listeners.get(channel)?.(connectionId === undefined ? { data } : { data, connectionId });
function connect() {
  dice.connect();
  emit(DICE_CONFIG, config);
}
function lastRequest(): Record<string, unknown> {
  return mock.send.mock.calls.at(-1)![1] as Record<string, unknown>;
}
beforeEach(() => {
  vi.useFakeTimers();
  mock.saved.clear();
  mock.listeners.clear();
  mock.send.mockReset();
  mock.send.mockResolvedValue(undefined);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mock.saved.get(key) ?? null,
    setItem: (key: string, value: string) => mock.saved.set(key, value),
  });
  dice = new ConnectedDice("room", changed);
});
afterEach(() => {
  dice.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("discovers the roller locally, loads themes, and remembers a room's preference", () => {
  connect();
  expect(mock.send).toHaveBeenCalledWith(DICE_HELLO, {}, { destination: "LOCAL" });
  expect(dice.snapshot()).toMatchObject({
    enabled: true,
    status: "connected",
    styles: config.styles,
  });
  dice.selectStyle("red");
  dice.stop();
  dice = new ConnectedDice("room", changed);
  expect(dice.snapshot()).toMatchObject({ enabled: true, status: "connecting", styleId: "red" });
  emit(DICE_CONFIG, config);
  expect(dice.snapshot().styleId).toBe("red");
});
it("sends public power rolls using the selected theme and accepts only its own valid result", async () => {
  connect();
  dice.selectStyle("blue");
  const promise = dice.roll({ bonus: 3, netEdges: -2 });
  const request = lastRequest();
  expect(request).toMatchObject({
    gmOnly: false,
    styleId: "blue",
    replyChannel: DICE_REPLY,
    rollProperties: { bonus: 3, netEdges: -2, hasSkill: false, dice: "2d10" },
  });
  emit(DICE_REPLY, {
    id: "other",
    result: [
      { id: "a", result: 10 },
      { id: "b", result: 10 },
    ],
  });
  emit(DICE_REPLY, {
    id: request.id,
    result: [
      { id: "a", result: 0 },
      { id: "b", result: 8 },
    ],
  });
  await expect(dice.roll({ bonus: 0, netEdges: 0 })).rejects.toThrow("Wait");
  emit(DICE_REPLY, {
    id: request.id,
    result: [
      { id: "a", result: 7 },
      { id: "b", result: 8 },
    ],
  });
  await expect(promise).resolves.toMatchObject({
    dice: [7, 8],
    timing: { requestedAt: expect.any(Number), resultAt: expect.any(Number) },
  });
});
it("disconnects independently, ignores later discovery, and restores local rolling", async () => {
  connect();
  dice.selectStyle("red");
  dice.disconnect();
  emit(DICE_CONFIG, config);
  expect(dice.snapshot()).toMatchObject({ enabled: false, status: "disconnected", styleId: "red" });
  await expect(dice.roll({ bonus: 0, netEdges: 0 })).resolves.toEqual({ dice: null });
  dice.stop();
  dice = new ConnectedDice("room", changed);
  expect(dice.snapshot().enabled).toBe(false);
});
it("reports missing dice and supports retry without silently rolling locally", async () => {
  dice.connect();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(dice.snapshot().status).toBe("unavailable");
  await expect(dice.roll({ bonus: 0, netEdges: 0 })).rejects.toThrow("unavailable");
  connect();
  expect(dice.snapshot().status).toBe("connected");
});
it("times out a dispatched roll without producing a second result", async () => {
  connect();
  const promise = dice.roll({ bonus: 0, netEdges: 0 });
  const rejection = expect(promise).rejects.toThrow("Check Owlbear");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejection;
  expect(dice.snapshot().status).toBe("unavailable");
  expect(mock.send).toHaveBeenCalledTimes(2);
});
it("cancels an in-flight roll on disconnect and ignores its late response", async () => {
  connect();
  const promise = dice.roll({ bonus: 0, netEdges: 0 });
  const request = lastRequest();
  const rejection = expect(promise).rejects.toThrow("cancelled");
  dice.disconnect();
  emit(DICE_REPLY, {
    id: request.id,
    result: [
      { id: "a", result: 1 },
      { id: "b", result: 2 },
    ],
  });
  await rejection;
  expect(dice.snapshot().status).toBe("disconnected");
});
it("resets a removed theme to the roller default and rejects invalid discovery", () => {
  connect();
  dice.selectStyle("red");
  emit(DICE_CONFIG, { ...config, styles: [] });
  expect(dice.snapshot().styleId).toBe("");
  expect(parseDiceConfig({ ...config, dieTypes: ["D6"] })).toBeNull();
  expect(parseDiceConfig({ ...config, styles: [{ id: "bad", color: null }] })).toBeNull();
});
it("validates dice commands and results at the bridge boundary", () => {
  expect(validateCommand("ROLL_POWER", { bonus: 3, netEdges: 2 }).ok).toBe(true);
  expect(validateCommand("ROLL_POWER", { bonus: 3, netEdges: 3 }).ok).toBe(false);
  expect(validateResponse("ROLL_POWER", { dice: [10, 1] }).ok).toBe(true);
  expect(validateResponse("ROLL_POWER", { dice: [11, 0] }).ok).toBe(false);
  expect(validateResponse("ROLL_POWER", { dice: null }).ok).toBe(true);
});
it("applies bonuses and edges once, and keeps natural 19 critical under double bane", () => {
  expect(resolvePowerRollDice([5, 6], 3, "edge")).toMatchObject({ total: 16, bonus: 5, tier: 2 });
  expect(resolvePowerRollDice([5, 6], 0, "double-edge")).toMatchObject({ total: 11, tier: 2 });
  expect(resolvePowerRollDice([9, 10], -10, "double-bane")).toMatchObject({
    total: 9,
    tier: 3,
    critical: true,
  });
});

it("rejects malformed timing fields without rejecting older companions", () => {
  expect(validateResponse("ROLL_POWER", { dice: [7, 8] }).ok).toBe(true);
  expect(
    validateResponse("ROLL_POWER", { dice: [7, 8], timing: { requestedAt: 1000, resultAt: 2000 } })
      .ok,
  ).toBe(true);
  expect(
    validateResponse("ROLL_POWER", { dice: [7, 8], timing: { requestedAt: 2000, resultAt: 1000 } })
      .ok,
  ).toBe(false);
  expect(
    validateResponse("ROLL_POWER", {
      dice: [7, 8],
      timing: { requestedAt: "1000", resultAt: Infinity },
    }).ok,
  ).toBe(false);
});

it("persists private GM-only rolling and passes gmOnly on roll broadcasts", async () => {
  connect();
  expect(dice.snapshot().gmOnly).toBe(false);
  dice.setGmOnly(true);
  expect(dice.snapshot()).toMatchObject({
    gmOnly: true,
    detail: expect.stringContaining("private"),
  });
  const promise = dice.roll({ bonus: 2, netEdges: 0 });
  const request = lastRequest();
  expect(request).toMatchObject({ gmOnly: true });
  emit(DICE_REPLY, {
    id: request.id,
    result: [
      { id: "a", result: 4 },
      { id: "b", result: 6 },
    ],
  });
  await expect(promise).resolves.toMatchObject({ dice: [4, 6] });

  dice.stop();
  dice = new ConnectedDice("room", changed);
  expect(dice.snapshot().gmOnly).toBe(true);
});

it("retries discovery during startup so late-loading Connected Dice still connects", async () => {
  dice.connect();
  expect(mock.send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_500);
  expect(mock.send).toHaveBeenCalledTimes(2);
  emit(DICE_CONFIG, config);
  expect(dice.snapshot().status).toBe("connected");
  // No further discovery pings after connecting.
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mock.send).toHaveBeenCalledTimes(2);
});

it("clears stuck pending rolls on reconnect, cancelPending, or wall-clock expiry", async () => {
  connect();
  const first = dice.roll({ bonus: 1, netEdges: 0 });
  const firstRejection = expect(first).rejects.toThrow("Malice disconnected");
  dice.cancelPending("Malice disconnected.");
  await firstRejection;

  // connect() must cancel any active pending roll instead of being ignored.
  const second = dice.roll({ bonus: 2, netEdges: 0 });
  const secondRejection = expect(second).rejects.toThrow("Reconnecting dice cancelled");
  dice.connect();
  await secondRejection;
  emit(DICE_CONFIG, config);
  expect(dice.snapshot().status).toBe("connected");

  // Even if setTimeout is throttled, wall-clock expiry unblocks the next roll.
  const start = Date.now();
  const third = dice.roll({ bonus: 0, netEdges: 0 });
  const thirdRejection = expect(third).rejects.toThrow("Check Owlbear");
  vi.spyOn(Date, "now").mockReturnValue(start + 16_000);
  const fourth = dice.roll({ bonus: 3, netEdges: 1 });
  await thirdRejection;
  const req = lastRequest();
  // Backward clock tick must still produce resultAt >= requestedAt.
  vi.spyOn(Date, "now").mockReturnValue(start + 15_000);
  emit(DICE_REPLY, {
    id: req.id,
    result: [
      { id: "a", result: 6 },
      { id: "b", result: 9 },
    ],
  });
  const resolved = await fourth;
  expect(resolved.dice).toEqual([6, 9]);
  expect(validateResponse("ROLL_POWER", resolved).ok).toBe(true);
  vi.restoreAllMocks();
});

it("ignores remote connectionId broadcasts and skips redundant publishes on identical config", async () => {
  await Promise.resolve(); // allow getConnectionId() microtask to resolve
  connect();
  changed.mockClear();

  // Remote config from another player must be ignored.
  emit(
    DICE_CONFIG,
    { ...config, styles: [{ id: "spoof", color: "#000000" }] },
    "remote-player-conn",
  );
  expect(dice.snapshot().styles).toEqual(config.styles);
  expect(changed).not.toHaveBeenCalled();

  // Identical local config must not trigger redundant changed() notifications.
  emit(DICE_CONFIG, config, "local-conn");
  expect(changed).not.toHaveBeenCalled();

  // Remote roll reply must not resolve our pending roll; local reply does.
  const pending = dice.roll({ bonus: 1, netEdges: 0 });
  const req = lastRequest();
  emit(
    DICE_REPLY,
    {
      id: req.id,
      result: [
        { id: "a", result: 1 },
        { id: "b", result: 1 },
      ],
    },
    "remote-player-conn",
  );
  emit(
    DICE_REPLY,
    {
      id: req.id,
      result: [
        { id: "a", result: 9 },
        { id: "b", result: 10 },
      ],
    },
    "local-conn",
  );
  await expect(pending).resolves.toMatchObject({ dice: [9, 10] });
});
