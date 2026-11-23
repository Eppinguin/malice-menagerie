import { useState } from "preact/hooks";
import {
  liveNegotiation,
  setNegotiationInterest,
  setNegotiationOutcome,
  setNegotiationPatience,
} from "../../store.ts";
import { richText } from "../../lib/text.ts";
import { INTEREST_LADDER, interestStep } from "../../lib/negotiation.ts";
import type { Negotiation } from "../../types.ts";
import { PencilIcon } from "../Icons.tsx";
import { PenRing } from "../Pen.tsx";

/** Interest as the book prints it: a ladder from 5 down to 0, each rung
    naming what the NPC offers at that level. The rung they are standing on
    is circled by hand, the way the Director marks the line that matters. */
export function InterestLadder({ negotiation: given }: { negotiation: Negotiation }) {
  const negotiation = liveNegotiation(given);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");

  const startEdit = (level: number, currentText: string) => {
    setEditing(level);
    setDraftText(currentText);
  };

  const commit = (level: number) => {
    setNegotiationOutcome(level, draftText.trim());
    setEditing(null);
  };

  return (
    <section class="talk-interest" aria-labelledby="talk-interest-title">
      <div class="talk-block-head">
        <h2 id="talk-interest-title">Interest</h2>
        <span class="talk-block-note">What the NPC offers right now</span>
      </div>
      <ol class="interest-ladder">
        {INTEREST_LADDER.map((step) => {
          const current = step.value === negotiation.interest;
          const own = negotiation.outcomes[step.value] ?? "";
          return (
            <li
              key={step.value}
              class={`interest-row${current ? " current" : ""}${step.terminal ? " terminal" : ""}`}
              aria-current={current ? "true" : undefined}
            >
              <button
                class="interest-mark"
                aria-label={`Set interest to ${step.value}`}
                title={`Set interest to ${step.value} · ${step.label}`}
                onClick={() => setNegotiationInterest(step.value)}
              >
                <b>{step.value}</b>
                {current ? <PenRing key={step.value} seed={`interest:${step.value}`} /> : null}
              </button>
              <div class="interest-body">
                <strong>{step.label}</strong>
                <span class="interest-book">{step.summary}</span>
                {own && editing !== step.value ? (
                  <span class="interest-own" dangerouslySetInnerHTML={{ __html: richText(own) }} />
                ) : null}
              </div>
              {editing === step.value ? (
                <input
                  class="interest-edit-input"
                  autoFocus
                  value={draftText}
                  aria-label={`What the NPC offers at interest ${step.value}`}
                  placeholder="What they offer at this level"
                  onInput={(event) => setDraftText(event.currentTarget.value)}
                  onBlur={() => commit(step.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit(step.value);
                    if (event.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button
                  class="icon-button interest-edit"
                  aria-label={`Write what the NPC offers at interest ${step.value}`}
                  title="Write what they offer at this level"
                  onClick={() => startEdit(step.value, own)}
                >
                  <PencilIcon />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Patience as five printed boxes: filled while the NPC will still listen.
    An empty row (0) is the final offer — tap active 1 or "Set 0" to clear. */
export function PatienceClock({ negotiation: given }: { negotiation: Negotiation }) {
  const negotiation = liveNegotiation(given);
  const left = negotiation.patience;
  return (
    <section class="talk-patience" aria-labelledby="talk-patience-title">
      <div class="talk-block-head">
        <h2 id="talk-patience-title">Patience</h2>
        <span class="talk-block-note">Arguments left before final offer</span>
      </div>
      <div class="patience-pips" role="group" aria-label={`Patience ${left} of 5`}>
        {[5, 4, 3, 2, 1].map((value) => {
          const togglesZero = value === 1 && left === 1;
          return (
            <button
              key={value}
              class={`patience-pip${value <= left ? " left" : ""}`}
              aria-label={togglesZero ? "Set patience to 0" : `Set patience to ${value}`}
              title={togglesZero ? "Tap again to set patience to 0" : `Set patience to ${value}`}
              onClick={() => setNegotiationPatience(togglesZero ? 0 : value)}
            >
              {value}
            </button>
          );
        })}
        <button
          class={`patience-pip patience-zero${left === 0 ? " left" : ""}`}
          aria-label="Set patience to 0 (final offer)"
          title="Set patience to 0 (final offer)"
          onClick={() => setNegotiationPatience(0)}
        >
          0
        </button>
      </div>
      <p class="patience-note">
        {left === 0
          ? "Final offer — patience is spent."
          : negotiation.ended
            ? "The negotiation has ended."
            : left === 1
              ? "1 argument left before their final offer."
              : `${left} arguments left before their final offer.`}
      </p>
    </section>
  );
}

/** The rung the NPC is standing on, for the running head's legend & spine rows. */
export function negotiationSummary(negotiation: Negotiation): string {
  if (negotiation.ended) {
    if (negotiation.ended === "interest-5") return "5 · They said yes";
    if (negotiation.ended === "interest-0") return "0 · No deal";
    return `${negotiation.interest} · Out of patience`;
  }
  const step = interestStep(negotiation.interest);
  return `${negotiation.interest} · ${step.label} · patience ${negotiation.patience}`;
}
