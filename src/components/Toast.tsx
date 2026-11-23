import { dismissToast, historyState, redoStep, toastState, undoStep } from "../store.ts";
import { RedoIcon, UndoIcon } from "./Icons.tsx";

export function Toast() {
  const { message, shown, action, undoStepId, redoStepId } = toastState.value;
  const hist = historyState.value;
  const showUndo = Boolean(undoStepId && hist.past[hist.past.length - 1]?.id === undoStepId);
  const showRedo = Boolean(redoStepId && hist.future[hist.future.length - 1]?.id === redoStepId);
  return (
    <div class={`toast ${shown ? "show" : ""}`} role="status" aria-live="polite">
      <span>{message}</span>
      {action ? (
        <button
          class="toast-action"
          onClick={() => {
            const run = action.onClick;
            dismissToast();
            run();
          }}
        >
          {action.label}
        </button>
      ) : null}
      {showUndo ? (
        <button
          class="toast-action"
          onClick={() => {
            dismissToast();
            undoStep();
          }}
        >
          <UndoIcon />
          Undo
        </button>
      ) : null}
      {showRedo ? (
        <button
          class="toast-action"
          onClick={() => {
            dismissToast();
            redoStep();
          }}
        >
          <RedoIcon />
          Redo
        </button>
      ) : null}
    </div>
  );
}
