import { useState } from "preact/hooks";
import {
  deleteNegotiation,
  duplicateNegotiation,
  openNewNegotiation,
  renameNegotiation,
  selectNegotiation,
  state,
} from "../../store.ts";
import { negotiationSummary } from "./NegotiationTracks.tsx";
import { CloseIcon, CopyIcon, PencilIcon, PlusIcon } from "../Icons.tsx";

function NegotiationRow({ id, active }: { id: string; active: boolean }) {
  const negotiation = state.value.negotiations.find((item) => item.id === id);
  const [editing, setEditing] = useState(false);
  if (!negotiation) return null;
  const commit = (value: string) => {
    setEditing(false);
    renameNegotiation(negotiation.id, value);
  };
  return (
    <div class={`encounter-row negotiation-row ${active ? "active" : ""}`}>
      <div class="encounter-row-main">
        {editing ? (
          <input
            class="encounter-name-input"
            autoFocus
            value={negotiation.name}
            aria-label="NPC name"
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            class="encounter-name"
            aria-current={active ? "true" : undefined}
            title="Select NPC (double-click to rename)"
            onClick={() => selectNegotiation(negotiation.id)}
            onDblClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            <strong>{negotiation.name || "Untitled NPC"}</strong>
            <small>{negotiationSummary(negotiation)}</small>
          </button>
        )}
      </div>
      <div class="encounter-row-actions">
        <button
          class="icon-button"
          title="Rename"
          aria-label={`Rename ${negotiation.name || "NPC"}`}
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </button>
        <button
          class="icon-button"
          title="Duplicate"
          aria-label={`Duplicate ${negotiation.name || "NPC"}`}
          onClick={() => duplicateNegotiation(negotiation.id)}
        >
          <CopyIcon />
        </button>
        <button
          class="icon-button danger"
          title="Delete negotiation (undoable)"
          aria-label={`Delete ${negotiation.name || "NPC"}`}
          onClick={() => deleteNegotiation(negotiation.id)}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

/** The spine's NPC list, shown while the Talk page is open. */
export function NegotiationSwitcher() {
  const { negotiations, activeNegotiationId } = state.value;
  return (
    <section class="encounter-switcher negotiation-switcher">
      <div class="encounter-switcher-head">
        <h2 class="spine-heading">Negotiations</h2>
        <button class="mini-button" title="New NPC" onClick={openNewNegotiation}>
          <PlusIcon />
          New
        </button>
      </div>
      <div class="encounter-list">
        {negotiations.map((negotiation) => (
          <NegotiationRow
            key={negotiation.id}
            id={negotiation.id}
            active={negotiation.id === activeNegotiationId}
          />
        ))}
      </div>
      {negotiations.length ? null : (
        <p class="negotiation-switcher-empty">
          No NPCs yet. Pick Quick improv or an archetype on the page.
        </p>
      )}
    </section>
  );
}
