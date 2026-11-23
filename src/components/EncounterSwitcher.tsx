import { useState } from "preact/hooks";
import {
  cleanupEncounterTokens,
  linkedTokensForEncounter,
  owlbearBusy,
} from "../integration/controller.ts";
import {
  createEncounter,
  deleteEncounter,
  duplicateEncounter,
  hasCombatProgress,
  renameEncounter,
  resetCombat,
  selectEncounter,
  state,
} from "../store.ts";
import type { Encounter } from "../types.ts";
import { CloseIcon, CopyIcon, PencilIcon, PlusIcon, ResetIcon } from "./Icons.tsx";

function encounterSummary(enc: Encounter): string {
  const enemies = enc.items.reduce((sum, item) => sum + item.count, 0);
  if (hasCombatProgress(enc))
    return `Round ${enc.combat.round} · ${enemies} ${enemies === 1 ? "enemy" : "enemies"}`;
  if (!enemies) return "Empty";
  return `${enemies} ${enemies === 1 ? "enemy" : "enemies"}`;
}

function EncounterRow({
  enc,
  active,
  onNavigate,
}: {
  enc: Encounter;
  active: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const [editing, setEditing] = useState(false);

  const commitName = (value: string) => {
    setEditing(false);
    renameEncounter(enc.id, value);
  };

  return (
    <div
      class={`encounter-row ${active ? "active" : ""}`}
      aria-selected={active}
      onClick={() => {
        if (!editing) {
          selectEncounter(enc.id);
          onNavigate?.();
        }
      }}
    >
      <div class="encounter-row-main">
        {editing ? (
          <input
            class="encounter-name-input"
            autoFocus
            value={enc.name}
            aria-label="Encounter name"
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => commitName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            class="encounter-name"
            title="Double-click to rename"
            onDblClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            <strong>{enc.name}</strong>
            <small>{encounterSummary(enc)}</small>
          </button>
        )}
      </div>
      <div class="encounter-row-actions" onClick={(event) => event.stopPropagation()}>
        <button
          class="icon-button"
          title="Rename"
          aria-label={`Rename ${enc.name}`}
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </button>
        <button
          class="icon-button"
          title="Duplicate"
          aria-label={`Duplicate ${enc.name}`}
          onClick={() => duplicateEncounter(enc.id)}
        >
          <CopyIcon />
        </button>
        {hasCombatProgress(enc) ? (
          <button
            class="icon-button"
            title="Reset combat to Round 1 · Undo available"
            aria-label={`Reset combat for ${enc.name}`}
            onClick={() => void resetCombat(enc.id)}
          >
            <ResetIcon />
          </button>
        ) : null}
        {(() => {
          const linked = linkedTokensForEncounter(enc.id);
          const deleteBlocked =
            state.value.encounters.length === 1 || (linked > 0 && owlbearBusy.value);
          return (
            <button
              type="button"
              class="icon-button danger"
              title={
                linked > 0 && owlbearBusy.value
                  ? "Wait for Owlbear sync to finish before deleting"
                  : "Delete encounter · Undo available"
              }
              aria-label={`Delete ${enc.name}`}
              disabled={deleteBlocked}
              onClick={async () => {
                const count = linkedTokensForEncounter(enc.id);
                if (!count) {
                  deleteEncounter(enc.id);
                  return;
                }
                const prompt = `Delete “${enc.name}”? This will also remove ${count} linked ${count === 1 ? "token" : "tokens"} from the active Owlbear scene.`;
                if (!confirm(prompt)) return;
                const deleted = await cleanupEncounterTokens(enc.id);
                if (deleted >= 0) {
                  deleteEncounter(enc.id);
                } else if (
                  confirm(
                    `Could not remove linked tokens for “${enc.name}” from Owlbear. Delete the encounter in Malice anyway (tokens will stay on the map)?`,
                  )
                ) {
                  deleteEncounter(enc.id);
                }
              }}
            >
              <CloseIcon />
            </button>
          );
        })()}
      </div>
    </div>
  );
}

export function EncounterSwitcher({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { encounters, activeEncounterId } = state.value;
  return (
    <section class="encounter-switcher">
      <div class="encounter-switcher-head">
        <h2 class="spine-heading">Saved</h2>
        <button
          class="mini-button"
          title="New encounter"
          onClick={() => {
            createEncounter();
            onNavigate?.();
          }}
        >
          <PlusIcon />
          New
        </button>
      </div>
      <div class="encounter-list">
        {encounters.map((enc) => (
          <EncounterRow
            key={enc.id}
            enc={enc}
            active={enc.id === activeEncounterId}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </section>
  );
}
