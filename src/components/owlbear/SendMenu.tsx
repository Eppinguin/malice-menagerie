import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  cleanupOrphanTokens,
  defeatedMappings,
  orphanedMappings,
  owlbearBusy,
  owlbearConnection,
  reconcileWithOwlbear,
  sendCombatantToOwlbear,
  sendToOwlbear,
} from "../../integration/controller.ts";

const SEND_HOLD_MS = 450;
const SEND_MOVE_TOLERANCE_PX = 12;

interface SendMenuState {
  x: number;
  y: number;
  hasLinked: boolean;
  trigger: HTMLElement | null;
  instanceId?: string;
  instanceName?: string;
  onSend?: (hidden: boolean) => void;
}

const sendMenuState = signal<SendMenuState | null>(null);
const sendPress = {
  timer: undefined as number | undefined,
  startX: 0,
  startY: 0,
  firedAt: 0,
  firedTarget: null as HTMLElement | null,
};

export function isSendMenuOpen(): boolean {
  return sendMenuState.peek() !== null;
}

function cancelSendPress(): void {
  if (sendPress.timer !== undefined) {
    clearTimeout(sendPress.timer);
    sendPress.timer = undefined;
  }
}

function anchorPoint(el: HTMLElement | null): { x: number; y: number } {
  const rect = el?.getBoundingClientRect();
  return rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 8, y: 8 };
}

function openSendMenu(state: SendMenuState): void {
  sendMenuState.value = state;
}

function closeSendMenu(restoreFocus = false): void {
  const trigger = sendMenuState.peek()?.trigger ?? null;
  sendMenuState.value = null;
  if (restoreFocus && trigger?.isConnected) trigger.focus();
}

/**
 * Tap-or-hold (plus Shift+click, right-click, and ArrowDown) handling matching EdgeMenu:
 * tap sends visible tokens, Shift+click sends hidden tokens immediately, and
 * holding, right-clicking, or pressing ArrowDown opens the send options menu.
 */
export function sendTokenPress(options: {
  enabled: boolean;
  hasLinked: boolean;
  instanceId?: string;
  instanceName?: string;
  onSend?: (hidden: boolean) => void;
  onFallbackClick?: (invoker: HTMLElement) => void;
  stopPropagation?: boolean;
}) {
  const menuFor = (x: number, y: number, trigger: HTMLElement | null): SendMenuState => ({
    x,
    y,
    hasLinked: options.hasLinked,
    trigger,
    ...(options.instanceId ? { instanceId: options.instanceId } : {}),
    ...(options.instanceName ? { instanceName: options.instanceName } : {}),
    ...(options.onSend ? { onSend: options.onSend } : {}),
  });
  return {
    onPointerDown: (event: PointerEvent): void => {
      if (options.stopPropagation) event.stopPropagation();
      if (!options.enabled) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      cancelSendPress();
      const target = event.currentTarget as HTMLButtonElement | null;
      const x = event.clientX;
      const y = event.clientY;
      sendPress.startX = x;
      sendPress.startY = y;
      sendPress.timer = window.setTimeout(() => {
        sendPress.timer = undefined;
        if (!target || !target.isConnected || target.disabled) return;
        sendPress.firedAt = Date.now();
        sendPress.firedTarget = target;
        openSendMenu(menuFor(x, y, target));
      }, SEND_HOLD_MS);
    },
    onPointerMove: (event: PointerEvent): void => {
      if (
        sendPress.timer !== undefined &&
        Math.hypot(event.clientX - sendPress.startX, event.clientY - sendPress.startY) >
          SEND_MOVE_TOLERANCE_PX
      )
        cancelSendPress();
    },
    onPointerUp: (): void => cancelSendPress(),
    onPointerCancel: (): void => cancelSendPress(),
    onPointerLeave: (): void => cancelSendPress(),
    onClick: (event: MouseEvent): void => {
      if (options.stopPropagation) event.stopPropagation();
      const target = event.currentTarget as HTMLElement | null;
      if (target === sendPress.firedTarget && Date.now() - sendPress.firedAt < 750) return;
      if (!options.enabled) {
        if (target) options.onFallbackClick?.(target);
        return;
      }
      if (options.onSend) options.onSend(event.shiftKey);
      else void sendToOwlbear({ hidden: event.shiftKey });
    },
    onKeyDown: (event: KeyboardEvent): void => {
      if (!options.enabled) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (options.stopPropagation) event.stopPropagation();
        const target = event.currentTarget as HTMLElement | null;
        const { x, y } = anchorPoint(target);
        openSendMenu(menuFor(x, y, target));
      }
    },
    onContextMenu: (event: MouseEvent): void => {
      if (!options.enabled) return;
      event.preventDefault();
      if (options.stopPropagation) event.stopPropagation();
      cancelSendPress();
      const target = event.currentTarget as HTMLElement | null;
      // Only open on an intentional desktop right-click or keyboard context menu; touch longpress already opened it.
      if (target !== sendPress.firedTarget || Date.now() - sendPress.firedAt >= 750) {
        const point =
          event.clientX === 0 && event.clientY === 0
            ? anchorPoint(target)
            : { x: event.clientX, y: event.clientY };
        openSendMenu(menuFor(point.x, point.y, target));
      }
    },
  };
}

/** Global send-options menu (mirrors EdgeMenu): opened by holding, right-clicking, or ArrowDown on Send tokens. */
export function OwlbearSendMenu() {
  const state = sendMenuState.value;
  const connectionStatus = owlbearConnection.value.status;
  const busy = owlbearBusy.value;
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!state) return;
    if (connectionStatus !== "connected" || busy) {
      closeSendMenu(false);
    }
  }, [state, connectionStatus, busy]);

  useLayoutEffect(() => {
    if (!state) {
      setCoords(null);
      return;
    }
    const el = menuRef.current;
    const width = el?.offsetWidth || 228;
    const height = el?.offsetHeight || 160;
    const x = Math.max(8, Math.min(state.x, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(state.y, window.innerHeight - height - 8));
    setCoords({ x, y });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const focusTimer = setTimeout(
      () => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(),
      0,
    );
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSendMenu(true);
        return;
      }
      if (event.key === "Tab") {
        closeSendMenu(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
      ];
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (index + 1) % items.length
              : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [state]);

  if (!state || connectionStatus !== "connected" || busy) return null;
  const single = Boolean(state.instanceId);
  const defeated = single ? [] : defeatedMappings();
  const orphans = single ? [] : orphanedMappings();
  const x = coords?.x ?? Math.max(8, Math.min(state.x, window.innerWidth - 236));
  const y = coords?.y ?? Math.max(8, Math.min(state.y, window.innerHeight - 168));
  return (
    <>
      <div
        class="edge-menu-backdrop"
        onClick={() => closeSendMenu(false)}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div
        ref={menuRef}
        class="edge-menu owlbear-send-menu"
        style={{ left: `${x}px`, top: `${y}px` }}
        role="menu"
        aria-label={
          state.instanceName
            ? `Send ${state.instanceName} to Owlbear Rodeo`
            : "Send tokens to Owlbear Rodeo"
        }
      >
        <button
          type="button"
          role="menuitem"
          class="edge-menu-option"
          onClick={() => {
            const id = state.instanceId;
            const onSend = state.onSend;
            closeSendMenu(true);
            if (onSend) onSend(false);
            else if (id) void sendCombatantToOwlbear(id, { hidden: false });
            else void sendToOwlbear();
          }}
        >
          <strong>Send visible</strong>
          <span>Click</span>
        </button>
        <button
          type="button"
          role="menuitem"
          class="edge-menu-option"
          onClick={() => {
            const id = state.instanceId;
            const onSend = state.onSend;
            closeSendMenu(true);
            if (onSend) onSend(true);
            else if (id) void sendCombatantToOwlbear(id, { hidden: true });
            else void sendToOwlbear({ hidden: true });
          }}
        >
          <strong>Send hidden</strong>
          <span>⇧Click</span>
        </button>
        {!single && state.hasLinked ? (
          <button
            type="button"
            role="menuitem"
            class="edge-menu-option"
            onClick={() => {
              closeSendMenu(true);
              void reconcileWithOwlbear();
            }}
          >
            <strong>Update linked</strong>
            <span>No new</span>
          </button>
        ) : null}
        {defeated.length ? (
          <button
            type="button"
            role="menuitem"
            class="edge-menu-option danger"
            onClick={() => {
              closeSendMenu(true);
              void cleanupOrphanTokens(defeated.map((entry) => entry.instanceId));
            }}
          >
            <strong>Remove defeated</strong>
            <span>{defeated.length}</span>
          </button>
        ) : null}
        {orphans.length ? (
          <button
            type="button"
            role="menuitem"
            class="edge-menu-option danger"
            onClick={() => {
              closeSendMenu(true);
              void cleanupOrphanTokens(orphans.map((entry) => entry.instanceId));
            }}
          >
            <strong>Remove unlinked</strong>
            <span>{orphans.length}</span>
          </button>
        ) : null}
      </div>
    </>
  );
}
