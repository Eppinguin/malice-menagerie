import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  activeNegotiation,
  applyNegotiationArgument,
  applyNegotiationRead,
  argumentRoll,
  clearNegotiationRolls,
  liveNegotiation,
  readRoll,
  rollNegotiationTest,
  toast,
  undoNegotiationArgument,
} from "../../store.ts";
import { PROBE_PLAN, planArgument, readSpent, tierLines } from "../../lib/negotiation.ts";
import type { EdgeState, Negotiation, Renown } from "../../types.ts";
import { CloseIcon, UndoIcon } from "../Icons.tsx";
import { PenLoop } from "../Pen.tsx";
import { RollTally, TierMark, rollSerial } from "../Statblock.tsx";
import { rollPress } from "../combat/EdgeMenu.tsx";

/**
 * The mark the Director stages before applying a tier: which motivation
 * the hero appealed to, plus modifiers. Shared with TraitLists so tapping any
 * Motivation row stages it immediately and switches to the Argument tab, while
 * tapping a Pitfall row triggers immediately (no roll is called for).
 */
export interface ArgumentDraft {
  motivationId: string | null;
  pitfall: boolean;
  repeat: boolean;
  lie: boolean;
  naturalCrit: boolean;
}

const BLANK: ArgumentDraft = {
  motivationId: null,
  pitfall: false,
  repeat: false,
  lie: false,
  naturalCrit: false,
};

export const argumentDraft = signal<ArgumentDraft>(BLANK);
export const argumentMemo = signal<string>("");
export const resolverTab = signal<"argument" | "read">("argument");

export function clearArgumentDraft(): void {
  argumentDraft.value = BLANK;
}

function updateArgumentDraft(next: ArgumentDraft): void {
  argumentDraft.value = next;
  argumentRoll.value = null;
}

export function stageMotivation(id: string): void {
  const cur = argumentDraft.value;
  resolverTab.value = "argument";
  if (cur.motivationId === id) {
    updateArgumentDraft({ ...cur, motivationId: null });
    return;
  }
  updateArgumentDraft({
    ...cur,
    motivationId: id,
    pitfall: false,
    repeat: false,
    naturalCrit: false,
  });
}

/** Trigger a listed pitfall in one tap: no roll is called for, so it drops
    Interest & Patience by 1 immediately (honoring Caught in a lie and any
    typed memo), reveals the pitfall, and offers an Undo toast. */
export function triggerPitfall(id: string, name: string): void {
  const open = activeNegotiation();
  if (!open || open.ended) return;
  const targetId = open.id;
  const lie = argumentDraft.value.lie;
  const memo = argumentMemo.value;
  const plan = planArgument({
    motivation: null,
    pitfall: true,
    repeat: false,
    usedMotivation: false,
    lie,
  });
  applyNegotiationArgument({
    plan,
    tier: 1,
    motivationId: null,
    motivationName: "",
    pitfallId: id,
    pitfallName: name,
    reused: false,
    lie,
    naturalCrit: false,
    memo,
  });
  const loggedId = activeNegotiation()?.log[0]?.id;
  clearArgumentDraft();
  argumentMemo.value = "";
  toast(`Pitfall: ${name} · ${tierLines("pitfall", 1, lie).join(" · ")}`, {
    action: {
      label: "Undo",
      onClick: () => {
        const cur = activeNegotiation();
        if (cur?.id === targetId && cur.log[0]?.id === loggedId) {
          undoNegotiationArgument();
        }
      },
    },
  });
}

const EDGE_OPTIONS: readonly { value: EdgeState; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "edge", label: "Edge (+2)" },
  { value: "bane", label: "Bane (−2)" },
  { value: "double-edge", label: "2× Edge" },
  { value: "double-bane", label: "2× Bane" },
];

/** Compact, optional in-app roll helper. Never gates the tier rows above it:
    players rolling physical or VTT dice tap the tier directly; Directors who
    want the app to roll 2d10 use this single-line bar. */
function OptionalRollBar({
  bonus,
  setBonus,
  which,
  disabled = false,
  disabledTitle,
}: {
  bonus: string;
  setBonus: (value: string) => void;
  which: "argument" | "read";
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [edge, setEdge] = useState<EdgeState>("normal");
  const amount = Number(bonus) || 0;
  const rollFor = (picked?: EdgeState) =>
    rollNegotiationTest({ bonus: amount, edge: picked ?? edge, which });

  return (
    <div class="arg-roll">
      <span class="arg-roll-label">Or roll here</span>
      <label class="arg-roll-bonus">
        <span>Bonus</span>
        <input
          class="arg-bonus"
          type="number"
          inputMode="numeric"
          placeholder="0"
          value={bonus}
          disabled={disabled}
          aria-label="Hero's roll bonus"
          onInput={(event) => setBonus(event.currentTarget.value)}
        />
      </label>
      <select
        class="arg-edge-select"
        value={edge}
        disabled={disabled}
        aria-label="Edge or bane"
        onChange={(event) => setEdge(event.currentTarget.value as EdgeState)}
      >
        {EDGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        class="secondary compact-button arg-roll-button"
        disabled={disabled}
        title={disabled ? disabledTitle : "Roll 2d10 + bonus (hold for quick edge/bane menu)"}
        {...rollPress(
          () => rollFor(),
          (picked) => {
            setEdge(picked);
            rollFor(picked);
          },
        )}
      >
        Roll 2d10
      </button>
    </div>
  );
}

/**
 * The unified live resolver: Make an argument | Read the NPC.
 *
 * Player-rolled first: mark what the hero appealed to (or tap a trait above),
 * then tap the tier their dice landed on — one tap, zero fake rolls. Complete
 * WAI-ARIA Tabs contract (roving tabIndex, Arrow keys, aria-controls).
 */
export function ResolverPanel({ negotiation: given }: { negotiation: Negotiation }) {
  const negotiation = liveNegotiation(given);
  const tab = resolverTab.value;
  const [argBonus, setArgBonus] = useState<string>("");
  const [readBonus, setReadBonus] = useState<string>("");
  const memo = argumentMemo.value;
  const argTabRef = useRef<HTMLButtonElement>(null);
  const readTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    clearArgumentDraft();
    clearNegotiationRolls();
    argumentMemo.value = "";
    resolverTab.value = "argument";
  }, [negotiation.id]);

  const mark = argumentDraft.value;
  const motivation = negotiation.motivations.find((item) => item.id === mark.motivationId) ?? null;
  const plan = planArgument({
    motivation: motivation ? motivation.name : null,
    pitfall: mark.pitfall,
    repeat: mark.repeat,
    usedMotivation: motivation?.used ?? false,
    lie: mark.lie,
  });

  const argFlight = argumentRoll.value;
  const argRoll = argFlight?.roll ?? null;
  const readFlight = readRoll.value;
  const readRollVal = readFlight?.roll ?? null;
  const isReadSpent = readSpent(negotiation.log);
  const spentTitle = "Read used — argue again to read further";
  const effectiveCrit = mark.naturalCrit || Boolean(argRoll?.critical);

  const applyArg = (tier: 1 | 2 | 3) => {
    applyNegotiationArgument({
      plan,
      tier,
      motivationId: motivation?.id ?? null,
      motivationName: motivation?.name ?? "",
      pitfallId: null,
      pitfallName: "",
      reused: motivation?.used ?? false,
      lie: mark.lie,
      naturalCrit: mark.naturalCrit,
      memo,
    });
    clearArgumentDraft();
    argumentMemo.value = "";
  };

  const switchTab = (next: "argument" | "read", moveFocus = false) => {
    resolverTab.value = next;
    if (moveFocus) {
      (next === "argument" ? argTabRef.current : readTabRef.current)?.focus();
    }
  };

  const onTabKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      switchTab(tab === "argument" ? "read" : "argument", true);
    } else if (event.key === "Home") {
      event.preventDefault();
      switchTab("argument", true);
    } else if (event.key === "End") {
      event.preventDefault();
      switchTab("read", true);
    }
  };

  const stagedLabel = motivation
    ? `Appeals to ${motivation.name}${motivation.used ? " (used)" : ""}`
    : mark.pitfall
      ? "Touched a pitfall"
      : "No motivation";

  const hasStagedTrait = Boolean(motivation || mark.pitfall);
  const showGenericPitfallChip = negotiation.pitfalls.length === 0 || mark.pitfall;

  return (
    <section
      class="talk-argument"
      aria-labelledby={tab === "argument" ? "tab-argument" : "tab-read"}
    >
      <div class="talk-block-head resolver-head">
        <div class="resolver-tabs" role="tablist" aria-label="Negotiation action">
          <button
            ref={argTabRef}
            id="tab-argument"
            role="tab"
            aria-selected={tab === "argument"}
            aria-controls="panel-argument"
            tabIndex={tab === "argument" ? 0 : -1}
            class={`resolver-tab${tab === "argument" ? " active" : ""}`}
            onClick={() => switchTab("argument")}
            onKeyDown={onTabKeyDown}
          >
            An argument
          </button>
          <button
            ref={readTabRef}
            id="tab-read"
            role="tab"
            aria-selected={tab === "read"}
            aria-controls="panel-read"
            tabIndex={tab === "read" ? 0 : -1}
            class={`resolver-tab${tab === "read" ? " active" : ""}${isReadSpent ? " spent" : ""}`}
            onClick={() => switchTab("read")}
            onKeyDown={onTabKeyDown}
          >
            Read the NPC
            {isReadSpent ? <span class="resolver-tab-badge">used</span> : null}
          </button>
        </div>
        {negotiation.log.length ? (
          <button
            class="text-button resolver-undo"
            onClick={undoNegotiationArgument}
            title="Take the last entry back"
          >
            <UndoIcon />
            Take it back
          </button>
        ) : null}
      </div>

      {tab === "argument" ? (
        <div
          id="panel-argument"
          class="resolver-body"
          role="tabpanel"
          aria-labelledby="tab-argument"
        >
          <div class="arg-staged">
            <div class={`arg-staged-pill${hasStagedTrait ? " active" : ""}`}>
              <span>{stagedLabel}</span>
              {hasStagedTrait ? (
                <button
                  class="icon-button arg-staged-clear"
                  aria-label="Clear staged trait"
                  title="Clear to plain argument"
                  onClick={() =>
                    updateArgumentDraft({
                      ...mark,
                      motivationId: null,
                      pitfall: false,
                    })
                  }
                >
                  <CloseIcon />
                </button>
              ) : null}
            </div>
            <div class="arg-chips" role="group" aria-label="Argument modifiers">
              {showGenericPitfallChip ? (
                <button
                  class={`chip${mark.pitfall ? " active" : ""}`}
                  aria-pressed={mark.pitfall}
                  title="The argument touched a pitfall: fails outright, no roll."
                  onClick={() =>
                    updateArgumentDraft({
                      ...mark,
                      pitfall: !mark.pitfall,
                      motivationId: null,
                      naturalCrit: false,
                    })
                  }
                >
                  Pitfall
                </button>
              ) : null}
              <button
                class={`chip${mark.repeat ? " active" : ""}`}
                aria-pressed={mark.repeat}
                disabled={Boolean(motivation)}
                title={
                  motivation
                    ? "Only applies when no motivation is appealed to"
                    : "Same argument as last time with no motivation: automatic tier 1."
                }
                onClick={() => updateArgumentDraft({ ...mark, repeat: !mark.repeat })}
              >
                Same again
              </button>
              <button
                class={`chip${mark.lie ? " active" : ""}`}
                aria-pressed={mark.lie}
                title="Caught in a lie: extra Interest −1 if the argument didn't raise Interest."
                onClick={() => updateArgumentDraft({ ...mark, lie: !mark.lie })}
              >
                Caught in a lie
              </button>
              {plan.naturalHoldsPatience ? (
                <button
                  class={`chip${mark.naturalCrit ? " active" : ""}`}
                  aria-pressed={mark.naturalCrit}
                  title="Natural 19 or 20 on a plain argument keeps the NPC's patience on Tier 3."
                  onClick={() => updateArgumentDraft({ ...mark, naturalCrit: !mark.naturalCrit })}
                >
                  Nat 19–20
                </button>
              ) : null}
            </div>
          </div>

          <p class="arg-hint">
            <strong>{plan.title}.</strong> {plan.hint}
          </p>

          {negotiation.renown !== "unknown" ? (
            <p class="arg-renown-note">
              {negotiation.renown === "famous"
                ? `Famous (Impression ${negotiation.impression}): edge on Flirt, Lead or Persuade if the hero's Renown ≥ ${negotiation.impression}.`
                : `Infamous (Impression ${negotiation.impression}): edge on Brag, Interrogate or Intimidate if the hero's Renown ≥ ${negotiation.impression}.`}
            </p>
          ) : null}

          <input
            class="arg-memo"
            value={memo}
            placeholder="Optional note — what did the heroes offer?"
            aria-label="Optional note about what the heroes offered"
            onInput={(event) => {
              argumentMemo.value = event.currentTarget.value;
            }}
          />

          {plan.roll === null ? (
            <button class="arg-auto primary wide" onClick={() => applyArg(1)}>
              <span>Apply — no roll called for</span>
              <b>{tierLines(plan.kind, 1, mark.lie).join(" · ")}</b>
            </button>
          ) : (
            <>
              {argRoll ? (
                <RollTally key={rollSerial(argRoll)} roll={argRoll} crit="natural" />
              ) : null}

              <ol class="arg-tiers">
                {([1, 2, 3] as const).map((tier) => {
                  const lines = tierLines(plan.kind, tier, mark.lie, effectiveCrit);
                  const rolled = argRoll?.tier === tier;
                  return (
                    <li key={tier}>
                      <button
                        class={`arg-tier${rolled ? " rolled" : ""}`}
                        aria-current={rolled ? "true" : undefined}
                        title={`Apply tier ${tier} outcome`}
                        onClick={() => applyArg(tier)}
                      >
                        {rolled ? (
                          <PenLoop key={rollSerial(argRoll)} seed={rollSerial(argRoll)} />
                        ) : null}
                        <TierMark index={tier - 1} />
                        <span class="arg-tier-lines">
                          {lines.map((line) => (
                            <b key={line}>{line}</b>
                          ))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <p class="arg-note">
                Tap the player's tier to apply (or tap 17+ for great roleplay) — or roll below.
              </p>

              <OptionalRollBar bonus={argBonus} setBonus={setArgBonus} which="argument" />
            </>
          )}

          {mark.lie ? (
            <p class="arg-note">
              A caught lie costs another Interest −1 only if the argument didn't raise it.
            </p>
          ) : null}
        </div>
      ) : (
        <div id="panel-read" class="resolver-body" role="tabpanel" aria-labelledby="tab-read">
          <p class="arg-hint">{PROBE_PLAN.hint}</p>

          {readRollVal ? (
            <RollTally key={rollSerial(readRollVal)} roll={readRollVal} crit="natural" />
          ) : null}

          <ol class="arg-tiers">
            {PROBE_PLAN.tiers.map((lines, index) => {
              const tier = (index + 1) as 1 | 2 | 3;
              const rolled = readRollVal?.tier === tier;
              return (
                <li key={tier}>
                  <button
                    class={`arg-tier${rolled ? " rolled" : ""}`}
                    aria-current={rolled ? "true" : undefined}
                    disabled={isReadSpent}
                    title={isReadSpent ? spentTitle : `Apply tier ${tier} read outcome`}
                    onClick={() => applyNegotiationRead(tier)}
                  >
                    {rolled ? (
                      <PenLoop key={rollSerial(readRollVal)} seed={rollSerial(readRollVal)} />
                    ) : null}
                    <TierMark index={index} />
                    <span class="arg-tier-lines">
                      {lines.map((line) => (
                        <b key={line}>{line}</b>
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <p class="arg-note">
            {isReadSpent
              ? "Read used — argue again to read further."
              : "Tap the player's tier to apply. On Tier 3, tap the eye on the trait they learned."}
          </p>

          <OptionalRollBar
            bonus={readBonus}
            setBonus={setReadBonus}
            which="read"
            disabled={isReadSpent}
            disabledTitle={spentTitle}
          />
        </div>
      )}
    </section>
  );
}

export const RENOWN_LABELS: Record<Renown, string> = {
  unknown: "Unknown",
  famous: "Famous",
  infamous: "Infamous",
};
