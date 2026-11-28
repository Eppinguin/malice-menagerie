import { signal, type Signal } from "@preact/signals";
import type { TargetedEvent } from "preact";
import { readDisclosure, writeDisclosure } from "../../shared/disclosureStorage.ts";

const choices = new Map<string, Signal<string | null>>();

function choiceSignal(key: string): Signal<string | null> {
  let choice = choices.get(key);
  if (!choice) {
    choice = signal(readDisclosure(key));
    choices.set(key, choice);
  }
  return choice;
}

export function saveDisclosureChoice(key: string, value: string): void {
  writeDisclosure(key, value);
  choiceSignal(key).value = value;
}

export function disclosureChoice(key: string): string | null {
  return choiceSignal(key).value;
}

export function disclosure(key: string, defaultOpen = false) {
  const choice = disclosureChoice(key);
  const open = choice === "true" || (choice !== "false" && defaultOpen);
  const setOpen = (next: boolean) => saveDisclosureChoice(key, String(next));
  return { open, setOpen, toggle: () => setOpen(!open) };
}

export function disclosureDetails(key: string, defaultOpen = false) {
  const { open, setOpen } = disclosure(key, defaultOpen);
  return {
    open,
    onToggle(event: TargetedEvent<HTMLDetailsElement>) {
      const next = event.currentTarget.open;
      if (next !== open) setOpen(next);
    },
  };
}
