import { useEffect, useRef, useState } from "preact/hooks";
import {
  cleanupOrphanTokens,
  findMapping,
  focusCombatant,
  owlbearBusy,
  owlbearConnection,
  owlbearSelectedInstanceId,
  owlbearStore,
  selectCombatant,
  sendCombatantToOwlbear,
  setCombatantVisibility,
} from "../../integration/controller.ts";
import { activeEncounter } from "../../store.ts";
import { CursorIcon, EyeIcon, EyeOffIcon, LocateIcon, SendIcon, TrashIcon } from "../Icons.tsx";
import { sendTokenPress } from "./SendMenu.tsx";

/** Compact map tools share the existing Stamina row. */
export function OwlbearTokenActions({
  instanceId,
  name,
  defeated = false,
  standingCount,
}: {
  instanceId: string;
  name: string;
  defeated?: boolean;
  standingCount?: number | undefined;
}) {
  const [pending, setPending] = useState<
    "send" | "select" | "locate" | "visibility" | "remove" | null
  >(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const restoreFocusAfterSend = useRef(false);
  const connection = owlbearConnection.value;
  const busy = owlbearBusy.value;
  const sceneReady = Boolean(connection.scene?.sceneReady);
  const sceneId = sceneReady ? connection.scene?.sceneId : undefined;
  const mapping = sceneId
    ? owlbearStore.value.encounters[activeEncounter().id]?.scenes[sceneId]?.mappings.find(
        (entry) => entry.instanceId === instanceId,
      )
    : undefined;
  const isLinked = Boolean(mapping && !mapping.missing && mapping.tokenIds.length > 0);
  const ready = connection.status === "connected";
  const connected = ready || connection.status === "synchronizing";

  // Keep keyboard focus inside the action group when a single-card Send swaps
  // from the unlinked Send button to the linked visibility/select/locate buttons.
  useEffect(() => {
    if (!isLinked || !restoreFocusAfterSend.current) return;
    restoreFocusAfterSend.current = false;
    if (document.activeElement === document.body || !document.activeElement) {
      groupRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
  }, [isLinked]);

  const sendOne = async (hidden: boolean) => {
    if (!ready || pending || busy) return;
    restoreFocusAfterSend.current = !isLinked;
    setPending("send");
    try {
      await sendCombatantToOwlbear(instanceId, { hidden });
    } finally {
      setPending(null);
    }
  };
  if (!isLinked || !mapping) {
    // Keep the button mounted (disabled) while a send is in flight so keyboard focus isn't dropped.
    const showSend =
      sceneReady && !defeated && (ready || (connected && (pending === "send" || busy)));
    if (!showSend) return null;
    const sendPressProps = sendTokenPress({
      enabled: ready && !pending && !busy,
      hasLinked: false,
      instanceId,
      instanceName: name,
      onSend: (hidden) => void sendOne(hidden),
      stopPropagation: true,
    });
    return (
      <div
        ref={groupRef}
        class="owlbear-token-actions"
        role="group"
        aria-label={`Owlbear controls for ${name}`}
      >
        <button
          type="button"
          class="owlbear-token-action owlbear-token-send"
          disabled={!ready || pending !== null || busy}
          aria-busy={pending === "send"}
          aria-haspopup="menu"
          aria-label={`Send ${name} to Owlbear map`}
          title={`Send ${name} to Owlbear map (Shift+click, hold, or ArrowDown to send hidden)`}
          {...sendPressProps}
        >
          <SendIcon />
        </button>
      </div>
    );
  }
  const tokens = mapping.tokenIds.length;
  const fallenOnMap =
    !defeated && standingCount !== undefined && tokens > standingCount ? tokens - standingCount : 0;
  const missingOnMap =
    !defeated && standingCount !== undefined && tokens < standingCount ? standingCount - tokens : 0;
  const visible = mapping.visible !== false;
  const run = async (action: "select" | "locate" | "visibility" | "remove") => {
    if (!ready || pending) return;
    setPending(action);
    try {
      if (action === "select") await selectCombatant(instanceId);
      else if (action === "locate") await focusCombatant(instanceId);
      else if (action === "visibility") await setCombatantVisibility(instanceId, !visible);
      else await cleanupOrphanTokens([instanceId]);
    } finally {
      setPending(null);
    }
  };
  const addPressProps = missingOnMap
    ? sendTokenPress({
        enabled: ready && !pending && !busy,
        hasLinked: true,
        instanceId,
        instanceName: name,
        onSend: (hidden) => void sendOne(hidden),
        stopPropagation: true,
      })
    : null;
  return (
    <div
      ref={groupRef}
      class="owlbear-token-actions"
      role="group"
      aria-label={`Owlbear controls for ${name}`}
    >
      {defeated ? (
        <button
          type="button"
          class="owlbear-token-action owlbear-token-remove"
          disabled={!ready || pending !== null || busy}
          aria-label={`Remove ${name} from Owlbear map`}
          title={
            ready
              ? `Remove ${tokens === 1 ? "this defeated token" : `all ${tokens} defeated tokens`} from the Owlbear map`
              : "Reconnect to Owlbear to remove tokens"
          }
          onClick={(event) => {
            event.stopPropagation();
            void run("remove");
          }}
        >
          <TrashIcon />
        </button>
      ) : fallenOnMap > 0 ? (
        <button
          type="button"
          class="owlbear-token-action owlbear-token-fallen"
          disabled={!ready || pending !== null}
          aria-label={`${fallenOnMap} fallen ${fallenOnMap === 1 ? "minion" : "minions"} still on the Owlbear map for ${name}; locate squad in Owlbear`}
          title={
            ready
              ? `${fallenOnMap} fallen ${fallenOnMap === 1 ? "minion" : "minions"} still on the Owlbear map — click to locate the squad, then delete ${fallenOnMap} ${fallenOnMap === 1 ? "token" : "tokens"} in Owlbear`
              : `${fallenOnMap} fallen ${fallenOnMap === 1 ? "minion" : "minions"} still on the Owlbear map`
          }
          onClick={(event) => {
            event.stopPropagation();
            void run("locate");
          }}
        >
          −{fallenOnMap}
        </button>
      ) : missingOnMap > 0 && addPressProps ? (
        <button
          type="button"
          class="owlbear-token-action owlbear-token-add"
          disabled={!ready || pending !== null || busy}
          aria-busy={pending === "send"}
          aria-haspopup="menu"
          aria-label={`Send ${missingOnMap} missing ${missingOnMap === 1 ? "minion" : "minions"} for ${name} to Owlbear`}
          title={
            ready
              ? `Send ${missingOnMap} missing ${missingOnMap === 1 ? "minion" : "minions"} to the Owlbear map (Shift+click, hold, or ArrowDown to send hidden)`
              : `${missingOnMap} ${missingOnMap === 1 ? "minion" : "minions"} not yet on the Owlbear map`
          }
          {...addPressProps}
        >
          +{missingOnMap}
        </button>
      ) : null}
      <button
        type="button"
        class={`owlbear-token-action owlbear-token-visibility${visible ? "" : " hidden-token"}`}
        disabled={!ready || pending !== null}
        aria-pressed={!visible}
        aria-label={visible ? `Hide ${name} in Owlbear` : `Reveal ${name} in Owlbear`}
        title={
          ready
            ? visible
              ? `Hide ${tokens === 1 ? "this token" : `all ${tokens} linked tokens`} from players in Owlbear`
              : `Reveal ${tokens === 1 ? "this token" : `all ${tokens} linked tokens`} to players in Owlbear`
            : "Reconnect to Owlbear to change token visibility"
        }
        onClick={(event) => {
          event.stopPropagation();
          void run("visibility");
        }}
      >
        {visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
      <button
        type="button"
        class="owlbear-token-action owlbear-token-select"
        disabled={!ready || pending !== null}
        aria-label={`Select ${name} in Owlbear`}
        title={
          ready
            ? `Select ${tokens === 1 ? "this token" : `all ${tokens} linked tokens`} in Owlbear`
            : "Reconnect to Owlbear to select tokens"
        }
        onClick={(event) => {
          event.stopPropagation();
          void run("select");
        }}
      >
        <CursorIcon />
      </button>
      <button
        type="button"
        class="owlbear-token-action owlbear-token-locate"
        disabled={!ready || pending !== null}
        aria-label={`Locate ${name} in Owlbear`}
        title={
          ready
            ? "Pan the Owlbear map to the linked tokens without changing zoom"
            : "Reconnect to Owlbear to locate tokens"
        }
        onClick={(event) => {
          event.stopPropagation();
          void run("locate");
        }}
      >
        <LocateIcon />
      </button>
    </div>
  );
}

export function focusLinkedInstance(instanceId: string): void {
  if (owlbearConnection.peek().status !== "connected") return;
  const mapping = findMapping(instanceId);
  if (!mapping || mapping.missing || !mapping.tokenIds.length) return;
  void focusCombatant(instanceId);
}

export function isOwlbearSelectedInstance(instanceId: string): boolean {
  return (
    owlbearConnection.value.status === "connected" &&
    owlbearStore.value.inverseSelection &&
    owlbearSelectedInstanceId.value === instanceId
  );
}
