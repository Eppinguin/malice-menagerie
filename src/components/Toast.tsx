import { dismissToast, toastState } from "../store.ts";

export function Toast() {
  const { message, shown, action } = toastState.value;
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
    </div>
  );
}
