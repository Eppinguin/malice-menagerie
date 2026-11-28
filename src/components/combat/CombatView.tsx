import { maliceLoadStatus } from "../../data.ts";
import {
  activeEncounter,
  autoPickMalice,
  canRedo,
  canUndo,
  maliceSelectionReady,
  quickAddOpen,
  redoLabel,
  redoStep,
  removeActiveEffect,
  state,
  toggleMaliceDock,
  toggleQuickAdd,
  undoLabel,
  undoStep,
} from "../../store.ts";
import { MaliceDock } from "./MaliceDock.tsx";
import { CombatBoard, GroupFilterBar } from "./CombatBoard.tsx";
import { TriggerWatch } from "./Watch.tsx";
import { CaretIcon, CloseIcon, PlusIcon, RedoIcon, UndoIcon } from "../Icons.tsx";
import { PenRing, PenStrike } from "../Pen.tsx";

function ActiveEffects() {
  return (
    <div class="active-effects">
      {activeEncounter().combat.activeEffects.map((effect) => (
        <span class="effect-chip" key={effect.id}>
          <strong>
            {effect.name}
            <PenStrike seed={`${effect.id}:strike`} />
          </strong>
          <button
            aria-label={`End ${effect.name}`}
            title="Cross it off"
            onClick={() => removeActiveEffect(effect.id)}
          >
            <CloseIcon />
          </button>
          <PenRing seed={effect.id} />
        </span>
      ))}
    </div>
  );
}

export function CombatView({ active }: { active: boolean }) {
  const maliceOpen = state.value.ui.maliceDockOpen;
  const selectedCount = activeEncounter().combat.selectedMaliceFeatureIds.length;
  const drawerOpen = quickAddOpen.value;
  return (
    <section class={`view combat-view ${active ? "active" : ""}`}>
      {/* One strip over the board: the Malice toggle, live effects, group
          filter, and board utilities (Undo/Redo, + Add) share a line, keeping
          the running head clear for round/Malice rhythm. */}
      <div class={`encounter-dock malice-dock ${maliceOpen ? "open" : "closed"}`}>
        <header class="run-strip">
          <div class="malice-dock-header">
            <button
              class="malice-dock-toggle"
              aria-expanded={maliceOpen}
              onClick={toggleMaliceDock}
            >
              <CaretIcon class="malice-dock-caret" />
              <span class="ds-glyph malice-skull" aria-hidden="true">
                d
              </span>
              <strong>Encounter Malice</strong>
              <span class="malice-dock-count">
                {maliceLoadStatus.value === "failed" ? "Load failed" : `${selectedCount} selected`}
              </span>
            </button>
            {maliceOpen ? (
              <button
                type="button"
                class="secondary compact-button"
                disabled={!maliceSelectionReady.value}
                title="Choose a balanced 3–4 feature set"
                onClick={autoPickMalice}
              >
                Auto pick 3–4
              </button>
            ) : null}
          </div>
          <ActiveEffects />
          <GroupFilterBar />
          <div class="run-strip-tools">
            <div class="history-controls" role="group" aria-label="Undo and redo">
              <button
                class="icon-button"
                disabled={!canUndo.value}
                aria-label={canUndo.value ? `Undo: ${undoLabel.value}` : "Nothing to undo"}
                title={canUndo.value ? `Undo: ${undoLabel.value} (Ctrl/Cmd+Z)` : "Nothing to undo"}
                onClick={undoStep}
              >
                <UndoIcon />
              </button>
              <button
                class="icon-button"
                disabled={!canRedo.value}
                aria-label={canRedo.value ? `Redo: ${redoLabel.value}` : "Nothing to redo"}
                title={canRedo.value ? `Redo: ${redoLabel.value} (Ctrl+Y)` : "Nothing to redo"}
                onClick={redoStep}
              >
                <RedoIcon />
              </button>
            </div>
            <button
              class={`secondary compact-button quick-add-trigger ${drawerOpen ? "active" : ""}`}
              aria-expanded={drawerOpen}
              aria-controls="quickAddDrawer"
              title="Add or trim monsters (/)"
              onClick={toggleQuickAdd}
            >
              <PlusIcon />
              <span>Add</span>
            </button>
          </div>
        </header>
        {maliceOpen ? (
          <div class="malice-dock-body">
            <MaliceDock />
          </div>
        ) : null}
      </div>
      <TriggerWatch />
      <CombatBoard />
    </section>
  );
}
