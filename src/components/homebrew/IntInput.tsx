import type { Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Controlled integer input that never snaps or fights mid-keystroke:
 * clearing the field or typing "-" / "+" stays as typed until a valid integer
 * is entered, while valid in-range values update live and blur clamps/restores.
 */
export function IntInput({
  value,
  min,
  max,
  onChange,
  inputRef,
  ariaLabel,
  class: className,
  signed = false,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  inputRef?: Ref<HTMLInputElement>;
  ariaLabel?: string;
  class?: string;
  signed?: boolean;
}) {
  const format = (n: number) => (signed && n > 0 ? `+${n}` : String(n));
  const [text, setText] = useState(() => format(value));
  const pendingLocalSync = useRef(false);

  useEffect(() => {
    if (pendingLocalSync.current) {
      pendingLocalSync.current = false;
      return;
    }
    setText(format(value));
  }, [value, signed]);

  useEffect(() => {
    pendingLocalSync.current = false;
  });

  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));

  const handleInput = (el: HTMLInputElement) => {
    const raw = el.value;
    const allowed = min < 0 || signed ? /^[+-]?\d*$/ : /^\d*$/;
    if (!allowed.test(raw)) {
      // Restore DOM value immediately so rejected characters never stick in Preact.
      el.value = text;
      return;
    }
    setText(raw);
    if (raw === "" || raw === "-" || raw === "+") return;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) return;
    if (parsed >= min && parsed <= max && parsed !== value) {
      pendingLocalSync.current = true;
      onChange(parsed);
    }
  };

  const handleBlur = (el: HTMLInputElement) => {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "+") {
      const formatted = format(value);
      setText(formatted);
      el.value = formatted;
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      const formatted = format(value);
      setText(formatted);
      el.value = formatted;
      return;
    }
    const clamped = clamp(parsed);
    const formatted = format(clamped);
    setText(formatted);
    el.value = formatted;
    if (clamped !== value) {
      pendingLocalSync.current = true;
      onChange(clamped);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const base = /^[+-]?\d+$/.test(text.trim()) ? Number(text.trim()) : value;
      const next = clamp(base + (event.key === "ArrowUp" ? 1 : -1));
      setText(format(next));
      if (next !== value) {
        pendingLocalSync.current = true;
        onChange(next);
      }
    }
  };

  return (
    <input
      {...(inputRef ? { ref: inputRef } : {})}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      {...(className ? { class: className } : {})}
      type="text"
      inputMode={min < 0 || signed ? "text" : "numeric"}
      value={text}
      onInput={(e) => handleInput(e.currentTarget)}
      onBlur={(e) => handleBlur(e.currentTarget)}
      onKeyDown={handleKeyDown}
    />
  );
}
