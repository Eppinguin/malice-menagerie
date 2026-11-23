import OBR from "@owlbear-rodeo/sdk";
import {
  newMessageId,
  type DiceRollRequest,
  type DiceRollResponse,
} from "../../shared/obr/protocol.ts";

// External contract: SeamusFinlayson/draw-steel-tools-2/src/diceProtocol.ts
// Discovery and requests are LOCAL; Connected Dice handles sharing with the room.
export const DICE_HELLO = "general.diceRoller.hello";
export const DICE_CONFIG = "general.diceClient.hello";
export const DICE_REPLY = "com.malicemenagerie.owlbear/powerRollResult";
export const ROLL_TIMEOUT_MS = 15_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_RETRY_DELAYS_MS = [1_500, 3_500] as const;
export interface DiceStyle {
  id: string;
  color: string;
}
export interface DiceState {
  enabled: boolean;
  status: "disconnected" | "connecting" | "connected" | "unavailable";
  detail: string;
  styleId: string;
  styles: DiceStyle[];
  gmOnly: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseDiceConfig(value: unknown): { channel: string; styles: DiceStyle[] } | null {
  if (!record(value) || !Array.isArray(value["dieTypes"]) || !value["dieTypes"].includes("D10"))
    return null;
  const channels = value["rollRequestChannels"];
  const styles = value["styles"];
  if (!Array.isArray(channels) || !Array.isArray(styles)) return null;
  const channel = channels.find(
    (v): v is string => typeof v === "string" && v.length < 256 && v.includes("powerRollRequest"),
  );
  if (!channel || styles.length > 500) return null;
  if (
    !styles.every(
      (s) =>
        record(s) &&
        typeof s["id"] === "string" &&
        s["id"].length > 0 &&
        s["id"].length < 160 &&
        typeof s["color"] === "string" &&
        s["color"].length <= 80,
    )
  )
    return null;
  return { channel, styles: styles as DiceStyle[] };
}

export class ConnectedDice {
  private state: DiceState = {
    enabled: false,
    status: "disconnected",
    detail: "Connect to share Malice rolls with players in Owlbear.",
    styleId: "",
    styles: [],
    gmOnly: false,
  };
  private channel: string | null = null;
  private localConnectionId: string | null = null;
  private discoveryGeneration = 0;
  private stopped = false;
  private discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private discoveryRetryTimers: ReturnType<typeof setTimeout>[] = [];
  private pending: {
    id: string;
    requestedAt: number;
    resolve: (value: DiceRollResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly storageKey: string;
  private readonly unsubscribe: (() => void)[];

  constructor(
    roomId: string,
    private readonly changed: (state: DiceState) => void,
  ) {
    this.storageKey = `malice-menagerie/dice/${roomId}`;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(this.storageKey) ?? "null");
      if (record(saved)) {
        this.state.enabled = saved["enabled"] === true;
        this.state.gmOnly = saved["gmOnly"] === true;
        if (typeof saved["styleId"] === "string")
          this.state.styleId = saved["styleId"].slice(0, 160);
      }
    } catch {
      /* Preferences are optional. */
    }
    if (typeof OBR.player?.getConnectionId === "function") {
      void OBR.player
        .getConnectionId()
        .then((id) => {
          if (typeof id === "string" && id) this.localConnectionId = id;
        })
        .catch(() => {});
    }
    this.unsubscribe = [
      OBR.broadcast.onMessage(DICE_CONFIG, (event) => {
        if (this.isRemote(event.connectionId)) return;
        this.receiveConfig(event.data);
      }),
      OBR.broadcast.onMessage(DICE_REPLY, (event) => {
        if (this.isRemote(event.connectionId)) return;
        this.receiveResult(event.data);
      }),
    ];
    if (this.state.enabled) this.connect();
  }

  private isRemote(connectionId: string | undefined): boolean {
    return (
      typeof connectionId === "string" &&
      connectionId.length > 0 &&
      this.localConnectionId !== null &&
      connectionId !== this.localConnectionId
    );
  }

  snapshot(): DiceState {
    return { ...this.state, styles: [...this.state.styles] };
  }
  private publish(): void {
    this.changed(this.snapshot());
  }
  private save(): void {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          enabled: this.state.enabled,
          styleId: this.state.styleId,
          gmOnly: this.state.gmOnly,
        }),
      );
    } catch {
      /* Optional. */
    }
  }
  private connectedDetail(): string {
    return this.state.gmOnly
      ? "Malice rolls are private (GM only) in Owlbear."
      : "Malice rolls are shared with players in Owlbear.";
  }
  private clearDiscoveryTimers(): void {
    clearTimeout(this.discoveryTimer);
    this.discoveryTimer = undefined;
    for (const timer of this.discoveryRetryTimers.splice(0)) clearTimeout(timer);
  }
  private sendHello(generation: number): void {
    void OBR.broadcast.sendMessage(DICE_HELLO, {}, { destination: "LOCAL" }).catch(() => {
      if (generation === this.discoveryGeneration)
        this.unavailable("Could not contact Connected Dice. Try connecting again.");
    });
  }
  connect(): void {
    if (this.stopped) return;
    if (this.pending) {
      this.finishPending(
        new Error(
          "Reconnecting dice cancelled the pending roll. Check Owlbear before rolling again.",
        ),
      );
    }
    const generation = ++this.discoveryGeneration;
    this.clearDiscoveryTimers();
    this.channel = null;
    this.state.enabled = true;
    this.state.status = "connecting";
    this.state.detail = "Looking for Connected Dice…";
    this.save();
    this.publish();
    this.discoveryTimer = setTimeout(
      () =>
        this.unavailable(
          "Connected Dice did not answer. Install and enable it in this room, then retry.",
        ),
      DISCOVERY_TIMEOUT_MS,
    );
    this.sendHello(generation);
    // Extensions boot in arbitrary order; retry discovery briefly so a slower
    // Connected Dice iframe still answers without needing a manual Retry click.
    for (const delay of DISCOVERY_RETRY_DELAYS_MS) {
      this.discoveryRetryTimers.push(
        setTimeout(() => {
          if (
            this.stopped ||
            generation !== this.discoveryGeneration ||
            this.state.status !== "connecting"
          )
            return;
          this.sendHello(generation);
        }, delay),
      );
    }
  }
  disconnect(): void {
    this.discoveryGeneration++;
    this.clearDiscoveryTimers();
    this.channel = null;
    this.state.enabled = false;
    this.state.status = "disconnected";
    this.state.detail = "Disconnected. Malice rolls locally.";
    this.finishPending(
      new Error(
        "Dice disconnected. The pending roll was cancelled; check Owlbear before rolling again.",
      ),
    );
    this.save();
    this.publish();
  }
  /** Clear any in-flight roll when the bridge disconnects or is replaced so a
   * reconnected Malice session can never inherit a stale pending roll. */
  cancelPending(reason = "The pending dice roll was cancelled."): void {
    this.finishPending(new Error(reason));
  }
  selectStyle(styleId: string): void {
    if (styleId !== "" && !this.state.styles.some((s) => s.id === styleId)) return;
    this.state.styleId = styleId;
    this.save();
    this.publish();
  }
  setGmOnly(gmOnly: boolean): void {
    this.state.gmOnly = Boolean(gmOnly);
    if (this.state.status === "connected") this.state.detail = this.connectedDetail();
    this.save();
    this.publish();
  }
  private unavailable(detail: string): void {
    if (this.stopped || !this.state.enabled) return;
    this.clearDiscoveryTimers();
    this.channel = null;
    this.state.status = "unavailable";
    this.state.detail = detail;
    this.publish();
  }
  private receiveConfig(data: unknown): void {
    if (this.stopped || !this.state.enabled) return;
    const config = parseDiceConfig(data);
    if (!config) return;
    this.clearDiscoveryTimers();
    const nextStyleId = config.styles.some((s) => s.id === this.state.styleId)
      ? this.state.styleId
      : "";
    const nextDetail = this.connectedDetail();
    const unchanged =
      this.channel === config.channel &&
      this.state.status === "connected" &&
      this.state.styleId === nextStyleId &&
      this.state.detail === nextDetail &&
      this.state.styles.length === config.styles.length &&
      this.state.styles.every(
        (style, i) => style.id === config.styles[i]?.id && style.color === config.styles[i]?.color,
      );
    if (unchanged) return;
    this.channel = config.channel;
    this.state.styles = config.styles;
    this.state.styleId = nextStyleId;
    this.state.status = "connected";
    this.state.detail = nextDetail;
    this.save();
    this.publish();
  }
  roll(request: DiceRollRequest): Promise<DiceRollResponse> {
    if (!this.state.enabled) return Promise.resolve({ dice: null });
    // Background tabs can throttle setTimeout; enforce the deadline by wall clock
    // too so an overdue roll can never wedge future rolls indefinitely.
    if (this.pending && Date.now() - this.pending.requestedAt >= ROLL_TIMEOUT_MS) {
      this.finishPending(
        new Error("Connected Dice did not return a result. Check Owlbear before rolling again."),
      );
    }
    if (!this.channel || this.state.status !== "connected")
      return Promise.reject(
        new Error(
          "Connected Dice is unavailable. Reconnect or disconnect dice in the extension settings.",
        ),
      );
    if (this.pending) return Promise.reject(new Error("Wait for the current dice roll to finish."));
    const id = `malice-${newMessageId()}`;
    const channel = this.channel;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finishPending(
          new Error("Connected Dice did not return a result. Check Owlbear before rolling again."),
        );
        this.unavailable("The roll timed out. Check Owlbear, then reconnect dice.");
      }, ROLL_TIMEOUT_MS);
      this.pending = { id, requestedAt: Date.now(), resolve, reject, timer };
      void OBR.broadcast
        .sendMessage(
          channel,
          {
            id,
            replyChannel: DICE_REPLY,
            gmOnly: this.state.gmOnly,
            ...(this.state.styleId ? { styleId: this.state.styleId } : {}),
            rollProperties: {
              bonus: request.bonus,
              hasSkill: false,
              netEdges: request.netEdges,
              dice: "2d10",
            },
          },
          { destination: "LOCAL" },
        )
        .catch(() => {
          if (this.pending?.id === id)
            this.finishPending(
              new Error("Could not send the dice request. Check Owlbear before rolling again."),
            );
        });
    });
  }
  private receiveResult(data: unknown): void {
    if (!this.pending || !record(data) || data["id"] !== this.pending.id) return;
    const result = data["result"];
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      !result.every(
        (die) =>
          record(die) &&
          typeof die["id"] === "string" &&
          Number.isInteger(die["result"]) &&
          Number(die["result"]) >= 1 &&
          Number(die["result"]) <= 10,
      ) ||
      result[0].id === result[1].id
    ) {
      console.warn("Malice Menagerie: ignored unexpected Connected Dice reply", data);
      return;
    }
    const pending = this.pending;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve({
      dice: [result[0].result, result[1].result],
      timing: {
        requestedAt: pending.requestedAt,
        resultAt: Math.max(pending.requestedAt, Date.now()),
      },
    });
  }
  private finishPending(error: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = null;
  }
  stop(): void {
    this.stopped = true;
    this.discoveryGeneration++;
    this.clearDiscoveryTimers();
    this.finishPending(new Error("Dice connection closed."));
    for (const off of this.unsubscribe) off();
  }
}
