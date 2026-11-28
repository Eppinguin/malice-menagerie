import { disclosure } from "../../lib/disclosure.ts";
import { useEffect, useState } from "preact/hooks";
import {
  activeNegotiation,
  addNegotiationMotivation,
  addNegotiationPitfall,
  editNegotiationTraitNote,
  removeNegotiationTrait,
  shuffleNegotiationTraits,
  toggleNegotiationOfficialTrait,
  toggleNegotiationTraitKnown,
  toggleNegotiationTraitUsed,
} from "../../store.ts";
import { richText } from "../../lib/text.ts";
import { TRAITS, traitDescription } from "../../lib/negotiation.ts";
import type { NegotiationTrait } from "../../types.ts";
import { AlertIcon, CloseIcon, EyeIcon, PencilIcon, SyncIcon } from "../Icons.tsx";
import { PenTick } from "../Pen.tsx";
import { argumentDraft, stageMotivation, triggerPitfall } from "./ResolverPanel.tsx";

/**
 * Motivations & Pitfalls: live triggers directly above the Argument resolver.
 *
 * Tap any Motivation or Pitfall row to stage it immediately (disabled once
 * the negotiation has ended). Toggling "Edit traits" opens ONE shared 12-chip
 * Draw Steel trait deck with a Motivations / Pitfalls target switch — halving
 * button count and vertical height compared to duplicating 12 chips twice.
 */
export function TraitLists() {
  const negotiation = activeNegotiation();
  const [startsOpen, setStartsOpen] = useState(false);
  const [deckTarget, setDeckTarget] = useState<"motivation" | "pitfall">("motivation");
  const [customName, setCustomName] = useState("");

  useEffect(() => {
    if (!negotiation) return;
    setStartsOpen(negotiation.motivations.length === 0 && negotiation.pitfalls.length === 0);
    setDeckTarget("motivation");
    setCustomName("");
  }, [negotiation?.id]);

  if (!negotiation) return null;

  const { open: editingTraits, toggle: toggleTraits } = disclosure(
    `negotiation-traits/${negotiation.id}`,
    startsOpen,
  );
  const isEnded = Boolean(negotiation.ended);
  const ownList = deckTarget === "motivation" ? negotiation.motivations : negotiation.pitfalls;
  const otherList = deckTarget === "motivation" ? negotiation.pitfalls : negotiation.motivations;
  const ownLabels = new Set(ownList.map((item) => item.name.trim().toLowerCase()));
  const otherLabels = new Set(otherList.map((item) => item.name.trim().toLowerCase()));

  const commitCustom = () => {
    const trimmed = customName.trim();
    if (!trimmed) return;
    if (deckTarget === "motivation") addNegotiationMotivation(trimmed);
    else addNegotiationPitfall(trimmed);
    setCustomName("");
  };

  return (
    <section class="talk-traits-wrap" aria-labelledby="talk-traits-heading">
      <h2 id="talk-traits-heading" class="sr-only">
        Motivations and pitfalls
      </h2>
      <div class="traits-toolbar">
        <span class="traits-toolbar-hint">
          {isEnded ? "Negotiation ended" : "Tap a motivation to stage · tap a pitfall to trigger"}
        </span>
        <div class="traits-toolbar-actions">
          <button
            class="text-button traits-action-btn"
            title="Deal 3 random motivations and 2 random pitfalls (undoable)"
            onClick={() => shuffleNegotiationTraits(3, 2)}
          >
            <SyncIcon />
            Shuffle
          </button>
          <button
            class={`chip traits-edit-toggle${editingTraits ? " active" : ""}`}
            aria-expanded={editingTraits}
            onClick={toggleTraits}
          >
            {editingTraits ? "Done editing" : "Edit traits"}
          </button>
        </div>
      </div>

      <div class="talk-lists">
        <TraitList
          kind="motivation"
          title="Motivations"
          note="Tap to appeal · tick when spent"
          editingTraits={editingTraits}
          disabled={isEnded}
        />
        <TraitList
          kind="pitfall"
          title="Pitfalls"
          note="Tap to trigger — Interest −1, Patience −1"
          editingTraits={editingTraits}
          disabled={isEnded}
        />
      </div>

      {editingTraits ? (
        <div class="trait-deck" aria-label="Official Draw Steel traits">
          <div class="trait-deck-head">
            <span class="trait-deck-label">Toggle traits for</span>
            <div class="trait-deck-switch" role="group" aria-label="Target list">
              <button
                class={`chip${deckTarget === "motivation" ? " active" : ""}`}
                aria-pressed={deckTarget === "motivation"}
                onClick={() => setDeckTarget("motivation")}
              >
                Motivations ({negotiation.motivations.length})
              </button>
              <button
                class={`chip${deckTarget === "pitfall" ? " active" : ""}`}
                aria-pressed={deckTarget === "pitfall"}
                onClick={() => setDeckTarget("pitfall")}
              >
                Pitfalls ({negotiation.pitfalls.length})
              </button>
            </div>
          </div>
          <div class="trait-palette" role="group" aria-label={`Official ${deckTarget}s`}>
            {TRAITS.map((trait) => {
              const key = trait.label.toLowerCase();
              const selected = ownLabels.has(key);
              const claimedOther = otherLabels.has(key);
              return (
                <button
                  key={trait.key}
                  class={`chip trait-chip${selected ? " active" : ""}`}
                  disabled={claimedOther}
                  aria-pressed={selected}
                  title={
                    claimedOther
                      ? `Already listed under ${deckTarget === "motivation" ? "Pitfalls" : "Motivations"}`
                      : traitDescription(negotiation.archetype, trait.label, deckTarget).replace(
                          /\*/g,
                          "",
                        )
                  }
                  onClick={() => toggleNegotiationOfficialTrait(deckTarget, trait.label)}
                >
                  {trait.label}
                </button>
              );
            })}
          </div>
          <div class="trait-add">
            <input
              value={customName}
              aria-label={`Custom ${deckTarget}`}
              placeholder={`Add custom ${deckTarget}…`}
              onInput={(event) => setCustomName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitCustom();
                }
                if (event.key === "Escape") setCustomName("");
              }}
            />
            <button
              class="secondary compact-button"
              disabled={!customName.trim()}
              onClick={commitCustom}
            >
              Add
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TraitList({
  kind,
  title,
  note,
  editingTraits,
  disabled,
}: {
  kind: "motivation" | "pitfall";
  title: string;
  note: string;
  editingTraits: boolean;
  disabled: boolean;
}) {
  const negotiation = activeNegotiation();
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  if (!negotiation) return null;

  const items: NegotiationTrait[] =
    kind === "motivation" ? negotiation.motivations : negotiation.pitfalls;
  const mark = argumentDraft.value;

  const openNoteEdit = (item: NegotiationTrait) => {
    setEditingNoteId(item.id);
    setNoteDraft(item.note);
  };

  const commitNote = (id: string) => {
    editNegotiationTraitNote(kind, id, noteDraft);
    setEditingNoteId(null);
  };

  return (
    <div class={`talk-list ${kind}`} aria-labelledby={`talk-${kind}-title`}>
      <div class="talk-block-head">
        <h3 id={`talk-${kind}-title`}>{title}</h3>
        <span class="talk-block-note">{note}</span>
      </div>

      {items.length ? (
        <ul class="trait-rows">
          {items.map((item) => {
            const staged = !disabled && kind === "motivation" && mark.motivationId === item.id;
            const isEditingNote = editingNoteId === item.id;
            return (
              <li
                key={item.id}
                class={`trait-row${item.used ? " used" : ""}${staged ? " staged" : ""}`}
              >
                {kind === "motivation" ? (
                  <button
                    class="trait-box"
                    aria-label={`${item.used ? "Free" : "Mark"} ${item.name} as appealed to`}
                    title={item.used ? "Already appealed to — tap to free" : "Mark as appealed to"}
                    aria-pressed={item.used}
                    onClick={() => toggleNegotiationTraitUsed("motivation", item.id)}
                  >
                    {item.used ? <PenTick key={item.id} seed={`trait:${item.id}`} /> : null}
                  </button>
                ) : (
                  <span class="trait-warning" aria-hidden="true">
                    <AlertIcon />
                  </span>
                )}

                <div class="trait-main">
                  <button
                    class="trait-pick"
                    disabled={disabled}
                    aria-pressed={kind === "motivation" ? staged : undefined}
                    title={
                      disabled
                        ? "Negotiation has ended"
                        : kind === "motivation"
                          ? staged
                            ? `Unstage ${item.name}`
                            : `Stage argument appealing to ${item.name}`
                          : `Trigger pitfall: ${item.name} (Interest −1, Patience −1)`
                    }
                    onClick={() =>
                      kind === "motivation"
                        ? stageMotivation(item.id)
                        : triggerPitfall(item.id, item.name)
                    }
                  >
                    <strong>{item.name}</strong>
                    {!isEditingNote ? (
                      item.note ? (
                        <span
                          class="trait-note own"
                          dangerouslySetInnerHTML={{ __html: richText(item.note) }}
                        />
                      ) : traitDescription(negotiation.archetype, item.name, kind) ? (
                        <span
                          class="trait-note gloss"
                          dangerouslySetInnerHTML={{
                            __html: richText(
                              traitDescription(negotiation.archetype, item.name, kind),
                            ),
                          }}
                        />
                      ) : null
                    ) : null}
                  </button>
                  {isEditingNote ? (
                    <input
                      class="trait-note-input"
                      autoFocus
                      value={noteDraft}
                      aria-label={`Note for ${item.name}`}
                      placeholder="NPC-specific note (e.g. owes the guild 200gp)"
                      onInput={(event) => setNoteDraft(event.currentTarget.value)}
                      onBlur={() => commitNote(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitNote(item.id);
                        if (event.key === "Escape") setEditingNoteId(null);
                      }}
                    />
                  ) : null}
                </div>

                <div class="trait-actions">
                  <button
                    class="icon-button trait-note-btn"
                    aria-label={`Edit note for ${item.name}`}
                    title="Add or edit NPC-specific note"
                    onClick={() => openNoteEdit(item)}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    class={`icon-button trait-reveal${item.revealed ? " known" : ""}`}
                    aria-label={
                      item.revealed
                        ? `Mark ${item.name} as not known to the heroes`
                        : `Mark ${item.name} as known to the heroes`
                    }
                    title={
                      item.revealed
                        ? "Known to the heroes — tap to take it back"
                        : "Mark as known to the heroes"
                    }
                    aria-pressed={item.revealed}
                    onClick={() => toggleNegotiationTraitKnown(kind, item.id)}
                  >
                    <EyeIcon />
                  </button>
                  {editingTraits ? (
                    <button
                      class="icon-button trait-remove"
                      aria-label={`Remove ${item.name}`}
                      title={`Remove ${item.name} (undoable)`}
                      onClick={() => removeNegotiationTrait(kind, item.id)}
                    >
                      <CloseIcon />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="trait-empty">
          None yet. {editingTraits ? "Tap traits below to add." : "Tap Edit traits to pick."}
        </p>
      )}
    </div>
  );
}
