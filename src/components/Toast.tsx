import { toastState } from "../store.ts";

export function Toast() {
  const { message, shown } = toastState.value;
  return (
    <div class={`toast ${shown ? "show" : ""}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
