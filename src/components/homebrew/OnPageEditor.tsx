import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { allCatalog, monstersVersion } from "../../data.ts";
import {
  buildAbilityIndex,
  cloneAbilityForLevel,
  filterAbilityIndex,
  type IndexedAbility,
} from "../../lib/abilityIndex.ts";
import type { CompendiumTerm } from "../../lib/compendiumLinks.ts";
import {
  ORGANIZATIONS,
  ROLES,
  type AbilityTemplateKind,
  type BaselineMonsterStats,
} from "../../lib/homebrew.ts";
import {
  appendTierClause,
  buildRoleStarterFeatures,
  rescaleAbilityToMonster,
  tierInsertChips,
  TIER_KEYS,
  type TierInsertChip,
  type TierKey,
} from "../../lib/monsterCraft.ts";
import { monsterTargetSheet, orgGuideFor, roleGuideFor } from "../../lib/monsterGuide.ts";
import { MONSTER_BASICS_URL } from "../../lib/repo.ts";
import {
  ABILITY_DISTANCE_SUGGESTIONS,
  ABILITY_KEYWORD_SUGGESTIONS,
  ABILITY_TARGET_SUGGESTIONS,
  ABILITY_TYPE_COST_SUGGESTIONS,
  ABILITY_USAGE_SUGGESTIONS,
  EFFECT_LABEL_SUGGESTIONS,
  MOVEMENT_SUGGESTIONS,
  powerRollSuggestions,
  SIZE_SUGGESTIONS,
  WITH_CAPTAIN_SUGGESTIONS,
  type SuggestOption,
} from "../../lib/monsterSuggestions.ts";
import type { StudioStepMeta } from "../../lib/studioHistory.ts";
import type { FeatureEffect, HomebrewMonster, Monster, MonsterFeature } from "../../types.ts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  ExternalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "../Icons.tsx";
import {
  FeatureGlyph,
  iconGlyph,
  StatblockBody,
  TierMark,
  type PreviewRollController,
} from "../Statblock.tsx";
import { applyTypeCost, isTraitFeature, typeCostLabel } from "./abilityEdits.ts";
import { BrowseAbilities } from "./BrowseAbilities.tsx";
import { BrowseMalice, familyInfo, PageMalice } from "./PageMalice.tsx";
import { GlyphPicker } from "./GlyphPicker.tsx";
import { RuleInlineInput, RuleTextEditor } from "./RuleTextEditor.tsx";
import { SuggestInput } from "./SuggestInput.tsx";
import { TierAddMenu, type TierAddScope } from "./TierAddMenu.tsx";

/**
 * The Homebrew Studio's page: the statblock is the editor.
 *
 * Every printed value takes the pen where it prints. Tap it, or Tab to it
 * and type, and Tab again writes it and moves on. A value that still equals
 * the print stays ink; one the Director changed is pen with the print in
 * brackets beside it ("48 (7)"), the grammar of a rescaled level.
 *
 * Help lives where attention already is: the book's number is a one-tap
 * chip under the value being written, and a statblock note is a mark on the
 * line it is about. Abilities open in place as their own printed lines in
 * pen; adding one is a search over every official ability.
 */

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export interface PageNote {
  id: string;
  /** Leads the note in bold, as a term does in the book. */
  heading?: string | undefined;
  /** The term's numbers, set quietly beside the heading. */
  meta?: string | undefined;
  message: string;
  fixLabel?: string | undefined;
  onFix?: (() => void) | undefined;
}

/** A note on the line it is about: a small ringed mark, the note a tap away. */
function NoteMark({
  notes,
  about,
  more,
}: {
  notes: readonly PageNote[];
  /** Reference, not a warning: a "?" that explains what the line means. */
  about?: string;
  /** Closes the note, e.g. a link to read further. */
  more?: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  if (!notes.length) return null;
  const first = notes[0]!;
  return (
    <span
      class={`hb-pg-mark${about ? " is-about" : ""}`}
      ref={wrap}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          btn.current?.focus();
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        class="hb-pg-mark-btn"
        aria-expanded={open}
        aria-label={
          about ?? (notes.length > 1 ? `${notes.length} notes: ${first.message}` : first.message)
        }
        title={about ?? first.message}
        onClick={() => setOpen((v) => !v)}
      >
        {about ? "?" : "!"}
      </button>
      {open ? (
        <span class="hb-pg-mark-pop" role="group" aria-label={about ?? "Statblock note"}>
          {notes.map((note) => (
            <span class="hb-pg-mark-note" key={note.id}>
              {note.meta ? (
                <span class="hb-pg-about">
                  <span class="hb-pg-about-head">
                    <strong>{note.heading}</strong>
                    <span>{note.meta}</span>
                  </span>
                  <span>{note.message}</span>
                </span>
              ) : (
                <span>
                  {note.heading ? <strong>{note.heading}. </strong> : null}
                  {note.message}
                </span>
              )}
              {note.fixLabel && note.onFix ? (
                <button
                  type="button"
                  class="secondary compact-button"
                  onClick={() => {
                    note.onFix?.();
                    setOpen(false);
                  }}
                >
                  {note.fixLabel}
                </button>
              ) : null}
            </span>
          ))}
          {more}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* A printed value that takes the pen                                  */
/* ------------------------------------------------------------------ */

type SlotKind = "text" | "int" | "signed";

function signedText(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function PenSlot({
  value,
  printed,
  book,
  label,
  kind = "text",
  suggestions,
  suggestMode = "single",
  min,
  max,
  placeholder = "—",
  showPrint = true,
  width,
  onCommit,
}: {
  value: string;
  /** The value as printed; undefined when there is no print to compare. */
  printed?: string | undefined;
  /** The book's number for this monster, offered as a chip while writing. */
  book?: string | undefined;
  label: string;
  kind?: SlotKind;
  /** Suggestions offered while writing a text slot. */
  suggestions?: readonly (string | SuggestOption)[];
  suggestMode?: "single" | "comma";
  min?: number;
  max?: number;
  placeholder?: string;
  /** Print the bracketed original beside a changed value. */
  showPrint?: boolean;
  /** Input width in characters while writing. */
  width?: number;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  const seeded = useRef(false);
  const done = useRef(false);

  const numeric = kind === "int" || kind === "signed";
  const show = (v: string | undefined) =>
    v === undefined ? undefined : kind === "signed" ? signedText(Number(v) || 0) : v;
  const display = show(value) ?? "";
  const printedDisplay = show(printed);
  const changed = printed !== undefined && String(value).trim() !== String(printed).trim();
  const empty = !display.trim();
  const bracket =
    changed && showPrint && printedDisplay ? (
      <span class="hb-pg-was" aria-hidden="true">
        ({printedDisplay})
      </span>
    ) : null;

  // Layout effect: the field must hold focus before the next keystroke lands.
  useLayoutEffect(() => {
    if (editing) {
      done.current = false;
      const el = inputRef.current;
      el?.focus({ preventScroll: true });
      if (el) {
        if (seeded.current) el.setSelectionRange(el.value.length, el.value.length);
        else el.select();
      }
      seeded.current = false;
    } else if (refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  const open = (seed?: string) => {
    seeded.current = seed !== undefined;
    setText(seed ?? (kind === "signed" ? String(Number(value) || 0) : value));
    setEditing(true);
  };
  const close = (focusBack: boolean) => {
    done.current = true;
    refocus.current = focusBack;
    setEditing(false);
  };
  const commit = (raw: string, focusBack: boolean) => {
    if (done.current) return;
    let next = raw;
    if (numeric) {
      const n = Math.round(Number(raw.replace(/^\+/, "").replace("−", "-")));
      if (!Number.isFinite(n) || raw.trim() === "") {
        close(focusBack);
        return;
      }
      next = String(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
    }
    if (next !== value) onCommit(next);
    close(focusBack);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit(text, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (numeric && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const step = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
      const n = (Number(text.replace(/^\+/, "")) || 0) + step;
      setText(String(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))));
    }
  };

  if (editing) {
    const bookShown =
      book !== undefined && book.trim() !== "" && book.trim() !== text.trim().replace(/^\+/, "");
    return (
      <span
        class={`hb-pg-writing${suggestions ? " has-suggest" : ""}`}
        style={
          suggestions ? { "--hb-pg-w": `${Math.max(width ?? 6, text.length + 2)}ch` } : undefined
        }
        onKeyDown={keys}
        onFocusOut={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit(text, false);
        }}
      >
        {suggestions ? (
          <SuggestInput
            value={text}
            options={suggestions}
            mode={suggestMode}
            class="hb-pg-input"
            ariaLabel={label}
            inputRef={inputRef}
            onChange={setText}
          />
        ) : (
          <input
            ref={inputRef}
            class={`hb-pg-input${numeric ? " is-num" : ""}`}
            aria-label={label}
            value={text}
            inputMode={numeric ? "numeric" : undefined}
            size={Math.max(width ?? 2, text.length + 1)}
            enterKeyHint="next"
            onInput={(e) => setText(e.currentTarget.value)}
          />
        )}
        {bookShown ? (
          <button
            type="button"
            class="hb-pg-book"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit(book, true)}
          >
            Book {kind === "signed" ? signedText(Number(book) || 0) : book}
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class={`hb-pg-slot${changed ? " is-pen" : ""}${empty ? " is-empty" : ""}`}
        aria-label={`${label}: ${empty ? "blank" : display}${
          changed && printedDisplay ? `, printed ${printedDisplay}` : ""
        }`}
        onClick={() => open()}
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          // Spreadsheet habit: start typing on a focused value to replace it.
          if (e.key.length === 1 && e.key !== " ") {
            if (numeric && !/[\d+\-−]/.test(e.key)) return;
            e.preventDefault();
            open(e.key);
          } else if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            open("");
          } else if (e.key === "F2") {
            e.preventDefault();
            open();
          }
        }}
      >
        {empty ? placeholder : display}
      </button>
      {bracket}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Abilities                                                           */
/* ------------------------------------------------------------------ */

export interface AbilityRowActions {
  onChange: (next: MonsterFeature, meta: StudioStepMeta) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/* ------------------------------------------------------------------ */
/* A printed word that opens a list of its choices                     */
/* ------------------------------------------------------------------ */

interface PickOption {
  value: string;
  label: string;
  /** Quiet numbers beside the label ("+30 Stamina"). */
  meta?: string | undefined;
  /** The second line: what the choice is for. */
  detail?: string | undefined;
}

/**
 * Organization and role print as words on the band. Tapped, the list opens
 * under the band with a line on what each choice does, so a first monster
 * can be chosen by meaning and a known one by its first letters and Enter.
 */
function PenPick({
  value,
  printed,
  label,
  placeholder,
  options,
  onCommit,
}: {
  value: string;
  printed?: string | undefined;
  label: string;
  placeholder?: string;
  options: readonly PickOption[];
  onCommit: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();

  const current = options.find((o) => o.value === value);
  const display = current?.value ? current.label : (placeholder ?? "");
  const changed = printed !== undefined && value.trim() !== printed.trim();
  const printedLabel = options.find((o) => o.value === printed)?.label ?? printed;

  const show = (index?: number) => {
    const at = options.findIndex((o) => o.value === value);
    setActive(index ?? Math.max(0, at));
    setOpen(true);
  };
  const close = (focusBack: boolean) => {
    setOpen(false);
    if (focusBack) btn.current?.focus({ preventScroll: true });
  };
  const choose = (index: number) => {
    const next = options[index];
    if (next && next.value !== value) onCommit(next.value);
    close(true);
  };

  useLayoutEffect(() => {
    if (open) list.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const move = (to: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, to)));
    };
    switch (e.key) {
      case "ArrowDown":
        return move(active + 1);
      case "ArrowUp":
        return move(active - 1);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "PageDown":
        return move(active + 5);
      case "PageUp":
        return move(active - 5);
      case "Enter":
      case " ":
        e.preventDefault();
        return choose(active);
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        return close(true);
      case "Tab":
        return close(false);
    }
    // Typing jumps to the choice that starts with what was typed.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typed.current;
      t.text = (now - t.at < 700 ? t.text : "") + e.key.toLowerCase();
      t.at = now;
      const hit = options.findIndex((o) => o.value && o.label.toLowerCase().startsWith(t.text));
      if (hit >= 0) move(hit);
    }
  };

  return (
    <span class="hb-pg-pickmenu" ref={wrap}>
      <button
        ref={btn}
        type="button"
        class={`hb-pg-pick${changed ? " is-pen" : ""}${current?.value ? "" : " is-empty"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.value ? current.label : "none"}`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
      >
        {display}
      </button>
      {changed && printedLabel ? (
        <span class="hb-pg-was" aria-hidden="true">
          ({printedLabel})
        </span>
      ) : null}
      {open ? (
        <ul
          ref={list}
          class="hb-pg-picklist"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              key={o.value || "none"}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              class={`${i === active ? "is-active" : ""}${o.value === value ? " is-chosen" : ""}`}
              onPointerMove={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span class="hb-pg-picklist-head">
                <strong>
                  {o.label}
                  {o.value === value ? <CheckIcon /> : null}
                </strong>
                {o.meta ? <span>{o.meta}</span> : null}
              </span>
              {o.detail ? <span class="hb-pg-picklist-detail">{o.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

function firstNumber(text: string | undefined): number | null {
  const m = /(\d+)/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

/** An effect line that doesn't exist yet: write into it and it does. */
function GhostEffect({
  names,
  trait,
  glossary,
  onWrite,
}: {
  names: readonly string[];
  trait: boolean;
  glossary: readonly CompendiumTerm[];
  onWrite: (lead: string, text: string) => void;
}) {
  const [lead, setLead] = useState("");
  const [text, setText] = useState("");
  return (
    <div
      class="hb-pgw-prose is-ghost"
      onFocusOut={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (text.trim() || lead.trim()) {
          onWrite(lead.trim(), text);
          setLead("");
          setText("");
        }
      }}
    >
      {trait ? (
        <input
          class="hb-pgw-input hb-pgw-lead"
          value={lead}
          aria-label="New sub-trait heading"
          placeholder="Heading"
          onInput={(e) => setLead(e.currentTarget.value)}
        />
      ) : (
        <span class="hb-pgw-lead">
          <SuggestInput
            value={lead}
            options={EFFECT_LABEL_SUGGESTIONS}
            class="hb-pgw-input"
            ariaLabel="New effect label or cost"
            placeholder="Label or cost"
            onChange={setLead}
          />
        </span>
      )}
      <RuleTextEditor
        names={names}
        rows={1}
        value={text}
        glossary={glossary}
        ariaLabel={trait ? "New sub-trait text" : "New effect text"}
        placeholder={trait ? "What it does" : "What happens"}
        onChange={setText}
      />
    </div>
  );
}

/**
 * One ability, written where it prints: title line, keywords and action,
 * distance and target, trigger, the Power Roll with its three tiers, then its
 * effect lines. Nothing here needs a second editor.
 */
function AbilityWriter({
  names,
  feature,
  printed,
  fresh,
  index,
  total,
  monster,
  glossary,
  actions,
  onDone,
}: {
  /** The monster's own name, offered while writing. */
  names: readonly string[];
  feature: MonsterFeature;
  /** The ability as printed, when the monster was taken from the book. */
  printed: MonsterFeature | null;
  /** Not in the print at all: every line is the Director's. */
  fresh: boolean;
  index: number;
  total: number;
  monster: Pick<HomebrewMonster, "level" | "organization" | "role" | "chars">;
  glossary: readonly CompendiumTerm[];
  actions: AbilityRowActions;
  onDone: () => void;
}) {
  const [addScope, setAddScope] = useState<TierAddScope>("tier");
  // Pen only where the Director has written over the print, as on the page.
  const plain = (v: unknown) =>
    String(v ?? "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();
  const pen = (now: unknown, was: unknown, cls = "is-pen") =>
    fresh ? ` ${cls}` : printed && plain(now) !== plain(was) ? ` ${cls}` : "";
  const pEff = printed?.effects ?? [];
  const name = feature.name?.trim() || "Ability";
  const isTrait = isTraitFeature(feature);
  const isVillain = !isTrait && /villain\s*action/i.test(String(feature.cost ?? ""));
  const isTriggered =
    !isTrait && (/trigger/i.test(String(feature.usage ?? "")) || Boolean(feature.trigger?.trim()));
  const effects: FeatureEffect[] = feature.effects?.length ? feature.effects : [{}];
  const first = effects[0] ?? {};
  const hasRoll = Boolean(first.roll || first.tier1 || first.tier2 || first.tier3);
  const primaryEmpty = !first.effect && !first.name && !first.cost;
  const chips = useMemo(
    () => tierInsertChips(monster, glossary),
    [monster.level, monster.organization, monster.role, glossary],
  );
  const key = (field: string) => `pgw:${index}:${field}`;

  const set = (next: MonsterFeature, label: string, field?: string) =>
    actions.onChange(next, field ? { label, key: key(field) } : { label });
  const setOptional = (
    field: "usage" | "distance" | "target" | "trigger",
    val: string,
    label: string,
  ) => {
    const next = { ...feature };
    if (val) next[field] = val;
    else delete next[field];
    if (field === "usage" && val) delete next.feature_type;
    set(next, label, field);
  };
  const cleanEffect = (eff: FeatureEffect): FeatureEffect => {
    const out = { ...eff };
    for (const k of ["name", "cost", "effect", "roll", "tier1", "tier2", "tier3"] as const) {
      if (out[k] === "") delete out[k];
    }
    return out;
  };
  const setEffect = (i: number, patch: Partial<FeatureEffect>, label: string, field?: string) => {
    const list = [...effects];
    list[i] = cleanEffect({ ...list[i], ...patch });
    set({ ...feature, effects: list }, label, field ? `eff:${i}:${field}` : undefined);
  };
  const writeRoll = (val: string) => {
    if (hasRoll || !val.trim()) {
      setEffect(0, { roll: val }, "Edit Power Roll", "roll");
      return;
    }
    // The first stroke on an empty roll line lays out the book's tiers too.
    const sheet = monsterTargetSheet(monster.level, monster.organization, monster.role);
    setEffect(
      0,
      {
        roll: val,
        tier1: `${sheet.baseline.tier1} damage`,
        tier2: `${sheet.baseline.tier2} damage`,
        tier3: `${sheet.baseline.tier3} damage`,
      },
      "Add Power Roll",
      "roll",
    );
  };
  const removeRoll = () => {
    const list = [...effects];
    const eff = { ...first };
    delete eff.roll;
    delete eff.tier1;
    delete eff.tier2;
    delete eff.tier3;
    list[0] = eff;
    set({ ...feature, effects: list }, `Remove Power Roll from ${name}`);
  };
  const removeEffect = (i: number) => {
    if (i === 0) {
      const eff = { ...first };
      delete eff.name;
      delete eff.cost;
      delete eff.effect;
      set({ ...feature, effects: [eff, ...effects.slice(1)] }, "Remove effect line");
    } else {
      set({ ...feature, effects: effects.filter((_, j) => j !== i) }, "Remove effect line");
    }
  };
  const setLead = (i: number, val: string) => {
    if (/malice/i.test(val)) setEffect(i, { cost: val, name: "" }, "Edit effect label", "lead");
    else setEffect(i, { name: val, cost: "" }, "Edit effect label", "lead");
  };
  const addTierClause = (tier: TierKey, chip: TierInsertChip, scope: TierAddScope) => {
    if (scope === "all") {
      const patch: Partial<FeatureEffect> = {};
      for (const t of TIER_KEYS) patch[t] = appendTierClause(first[t] ?? "", chip.clauses[t]);
      setEffect(0, patch, `Add ${chip.rangeLabel} to all tiers`);
    } else {
      setEffect(
        0,
        { [tier]: appendTierClause(first[tier] ?? "", chip.clauses[tier]) },
        `Add ${chip.clauses[tier]}`,
      );
    }
  };

  // The book's damage for this ability, offered like a stat's book number.
  const isArea = (feature.keywords ?? []).some((k) => /area/i.test(k));
  const scaled = hasRoll
    ? rescaleAbilityToMonster(feature, monster, isArea ? "area" : "single")
    : null;
  const scaledFirst = scaled?.effects?.[0];
  const bookTiers = scaledFirst
    ? [scaledFirst.tier1, scaledFirst.tier2, scaledFirst.tier3].map(firstNumber)
    : [];
  const bookDiffers =
    !!scaled &&
    JSON.stringify(scaledFirst) !== JSON.stringify(first) &&
    bookTiers.every((n) => n !== null);

  const bare = !isTrait && !hasRoll && primaryEmpty && effects.length === 1;
  const lastHasText = Boolean(effects[effects.length - 1]?.effect?.trim());
  const ghostIntoFirst = (hasRoll && primaryEmpty) || bare;
  const showGhost = ghostIntoFirst || lastHasText;

  const tierLabels = ["11 or lower", "12 to 16", "17 or higher"] as const;

  return (
    <section
      class={`hb-pgw${isTrait ? " is-trait" : ""}`}
      aria-label={`Writing ${name}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <div class="hb-pgw-title">
        <GlyphPicker
          value={feature.icon}
          fallback={isTrait ? "*" : ""}
          ariaLabel={`Glyph for ${name}`}
          onChange={(emoji) => set({ ...feature, icon: emoji }, "Change glyph")}
        />
        <input
          class={`hb-pgw-input hb-pgw-name${pen(feature.name, printed?.name)}`}
          value={feature.name ?? ""}
          aria-label="Ability name"
          placeholder="Name"
          onInput={(e) =>
            set({ ...feature, name: e.currentTarget.value }, "Edit ability name", "name")
          }
        />
        <span class="hb-pgw-kind">
          <SuggestInput
            value={typeCostLabel(feature)}
            options={ABILITY_TYPE_COST_SUGGESTIONS}
            class={`hb-pgw-input${pen(typeCostLabel(feature), printed ? typeCostLabel(printed) : "")}`}
            ariaLabel="Ability type or cost"
            placeholder="Type"
            onChange={(val) => set(applyTypeCost(feature, val), "Edit ability type", "typeCost")}
          />
        </span>
      </div>

      {!isTrait ? (
        <>
          <div class="hb-pgw-line is-keywords">
            <span class="hb-pgw-cell">
              <SuggestInput
                mode="comma"
                value={(feature.keywords ?? []).join(", ")}
                options={ABILITY_KEYWORD_SUGGESTIONS}
                class={`hb-pgw-input${pen((feature.keywords ?? []).join(", "), (printed?.keywords ?? []).join(", "))}`}
                ariaLabel="Ability keywords"
                placeholder="Keywords"
                onChange={(val) => {
                  const kw = val
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const next = { ...feature };
                  if (kw.length) next.keywords = kw;
                  else delete next.keywords;
                  set(next, "Edit ability keywords", "keywords");
                }}
              />
            </span>
            {!isVillain ? (
              <span class="hb-pgw-cell is-end">
                <SuggestInput
                  value={feature.usage ?? ""}
                  options={ABILITY_USAGE_SUGGESTIONS}
                  class={`hb-pgw-input${pen(feature.usage, printed?.usage)}`}
                  ariaLabel="Action"
                  placeholder="Action"
                  onChange={(val) => setOptional("usage", val, "Edit action usage")}
                />
              </span>
            ) : null}
          </div>
          <div class="hb-pgw-line">
            <span class="hb-pgw-cell">
              <FeatureGlyph glyph="o" />
              <SuggestInput
                value={feature.distance ?? ""}
                options={ABILITY_DISTANCE_SUGGESTIONS}
                class={`hb-pgw-input${pen(feature.distance, printed?.distance)}`}
                ariaLabel="Distance"
                placeholder="Distance"
                onChange={(val) => setOptional("distance", val, "Edit distance")}
              />
            </span>
            <span class="hb-pgw-cell is-end">
              <FeatureGlyph glyph="x" />
              <SuggestInput
                value={feature.target ?? ""}
                options={ABILITY_TARGET_SUGGESTIONS}
                class={`hb-pgw-input${pen(feature.target, printed?.target)}`}
                ariaLabel="Target"
                placeholder="Target"
                onChange={(val) => setOptional("target", val, "Edit target")}
              />
            </span>
          </div>
        </>
      ) : null}

      <div class="hb-pgw-body">
        {isTriggered ? (
          <div class={`hb-pgw-prose${pen(feature.trigger, printed?.trigger, "is-pen-text")}`}>
            <strong class="hb-pgw-fixed-lead">Trigger:</strong>
            <RuleInlineInput
              names={names}
              value={feature.trigger ?? ""}
              glossary={glossary}
              ariaLabel="Trigger"
              placeholder="When…"
              onChange={(val) => setOptional("trigger", val, "Edit trigger")}
            />
          </div>
        ) : null}

        {!isTrait ? (
          <div class={`hb-pgw-roll${hasRoll ? "" : " is-ghost"}`}>
            <span class="hb-pgw-roll-field">
              <SuggestInput
                value={first.roll ?? ""}
                options={powerRollSuggestions(monster.chars)}
                class={`hb-pgw-input hb-pgw-roll-input${pen(first.roll, pEff[0]?.roll)}`}
                ariaLabel="Power Roll"
                placeholder="Power Roll"
                onChange={writeRoll}
              />
            </span>
            {hasRoll && bookDiffers && scaled ? (
              <button
                type="button"
                class="hb-pg-book is-inline"
                title={isArea ? "The book's area damage" : "The book's damage"}
                onClick={() => set(scaled, isArea ? "Rescale area ×0.8" : "Rescale single-target")}
              >
                Book {bookTiers.join(" / ")}
              </button>
            ) : null}
            {hasRoll ? (
              <button
                type="button"
                class="icon-button hb-pgw-x"
                aria-label={`Remove Power Roll from ${name}`}
                title="Remove Power Roll"
                onClick={removeRoll}
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
        ) : null}

        {hasRoll
          ? TIER_KEYS.map((tier, t) => (
              <div
                class={`hb-pgw-tier${pen(first[tier], pEff[0]?.[tier], "is-pen-text")}`}
                key={tier}
              >
                <TierMark index={t} />
                <RuleTextEditor
                  names={names}
                  rows={1}
                  value={first[tier] ?? ""}
                  glossary={glossary}
                  ariaLabel={`Tier ${t + 1} outcome (${tierLabels[t]})`}
                  placeholder="Outcome"
                  onChange={(val) => setEffect(0, { [tier]: val }, `Edit Tier ${t + 1}`, tier)}
                />
                <TierAddMenu
                  tier={tier}
                  chips={chips}
                  scope={addScope}
                  onScopeChange={setAddScope}
                  onAdd={addTierClause}
                />
              </div>
            ))
          : null}

        {effects.map((eff, i) => {
          if (i === 0 && (ghostIntoFirst || (hasRoll && primaryEmpty))) return null;
          const leadValue = String(eff.cost || eff.name || "");
          const was = pEff[i];
          const wasLead = String(was?.cost || was?.name || "");
          return (
            <div class={`hb-pgw-prose${pen(eff.effect, was?.effect, "is-pen-text")}`} key={i}>
              {isTrait ? (
                effects.length > 1 || eff.name ? (
                  <input
                    class={`hb-pgw-input hb-pgw-lead${pen(eff.name, was?.name)}`}
                    value={eff.name ?? ""}
                    aria-label="Sub-trait heading"
                    placeholder="Heading"
                    onInput={(e) =>
                      setEffect(
                        i,
                        { name: e.currentTarget.value },
                        "Edit sub-trait heading",
                        "lead",
                      )
                    }
                  />
                ) : null
              ) : (
                <span class="hb-pgw-lead">
                  <SuggestInput
                    value={leadValue}
                    options={EFFECT_LABEL_SUGGESTIONS}
                    class={`hb-pgw-input${pen(leadValue, wasLead)}`}
                    ariaLabel="Effect label"
                    placeholder="Label or cost"
                    onChange={(val) => setLead(i, val)}
                  />
                </span>
              )}
              <RuleTextEditor
                names={names}
                rows={1}
                value={eff.effect ?? ""}
                glossary={glossary}
                ariaLabel={`${leadValue || (isTrait ? "Trait" : "Effect")} text`}
                placeholder={isTrait ? "What it does" : "What happens"}
                onChange={(val) => setEffect(i, { effect: val }, "Edit effect text", "effect")}
              />
              {effects.length > 1 || (i === 0 && hasRoll) ? (
                <button
                  type="button"
                  class="icon-button hb-pgw-x"
                  aria-label={`Remove ${leadValue || "this"} line`}
                  title="Remove line"
                  onClick={() => removeEffect(i)}
                >
                  <CloseIcon />
                </button>
              ) : null}
            </div>
          );
        })}

        {showGhost ? (
          <GhostEffect
            names={names}
            trait={isTrait}
            glossary={glossary}
            onWrite={(lead, body) => {
              const leadPatch: Partial<FeatureEffect> = /malice/i.test(lead)
                ? { cost: lead }
                : lead
                  ? { name: lead }
                  : {};
              if (ghostIntoFirst) {
                setEffect(0, { ...leadPatch, effect: body }, "Add effect");
              } else {
                set(
                  {
                    ...feature,
                    effects: [...effects, cleanEffect({ ...leadPatch, effect: body })],
                  },
                  "Add effect",
                );
              }
            }}
          />
        ) : null}
      </div>

      <div class="hb-pgw-foot">
        <span class="hb-pgw-tools">
          <button
            type="button"
            class="icon-button"
            aria-label={`Move ${name} up`}
            title="Move up"
            disabled={index === 0}
            onClick={() => actions.onMove(-1)}
          >
            <ArrowUpIcon />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label={`Move ${name} down`}
            title="Move down"
            disabled={index >= total - 1}
            onClick={() => actions.onMove(1)}
          >
            <ArrowDownIcon />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label={`Duplicate ${name}`}
            title="Duplicate"
            onClick={actions.onDuplicate}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            class="icon-button danger"
            aria-label={`Remove ${name}`}
            title="Remove (Undo available)"
            onClick={actions.onRemove}
          >
            <TrashIcon />
          </button>
        </span>
        <button type="button" class="primary compact-button" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  );
}

const TEMPLATES: readonly { kind: AbilityTemplateKind; label: string }[] = [
  { kind: "signature", label: "Signature ability" },
  { kind: "malice", label: "Malice ability" },
  { kind: "triggered", label: "Triggered action" },
  { kind: "villain", label: "Villain action" },
  { kind: "trait", label: "Trait" },
];

type AddOption =
  | { type: "template"; kind: AbilityTemplateKind; label: string }
  | { type: "ability"; item: IndexedAbility };

/**
 * The line after the last ability: type to search every official ability
 * (added at this monster's level), or pick a blank of the book's kinds,
 * named after what you typed.
 */
function AddAbility({
  draftId,
  level,
  onTemplate,
  onCopy,
}: {
  draftId: string;
  level: number;
  onTemplate: (kind: AbilityTemplateKind, name: string) => void;
  onCopy: (feature: MonsterFeature, sourceName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const listId = "hb-pg-add-list";

  const index = useMemo(
    () => (open ? buildAbilityIndex(allCatalog.value, draftId) : []),
    [open, allCatalog.value, monstersVersion.value, draftId],
  );
  const results = useMemo(
    () =>
      query.trim()
        ? filterAbilityIndex(index, { query, category: "all", onlyHomebrew: false }).slice(0, 8)
        : [],
    [index, query],
  );
  const options: AddOption[] = [
    ...results.map((item) => ({ type: "ability" as const, item })),
    ...TEMPLATES.map((t) => ({ type: "template" as const, ...t })),
  ];

  useEffect(() => setActive(0), [query]);

  const pick = (opt: AddOption | undefined) => {
    if (!opt) return;
    if (opt.type === "template") onTemplate(opt.kind, query.trim());
    else onCopy(cloneAbilityForLevel(opt.item, level, true), opt.item.monster.name);
    setQuery("");
    setOpen(false);
  };

  return (
    <div
      class="hb-pg-add"
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label class="hb-pg-add-field">
        <PlusIcon />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          aria-label="Add ability: search the book or pick a kind"
          placeholder="Add ability"
          value={query}
          onFocus={(e) => {
            setOpen(true);
            // Give the list room: the add line moves up, and the list opens
            // upward when the page still has no room below it.
            const field = e.currentTarget;
            field.scrollIntoView({ behavior: "smooth", block: "center" });
            window.setTimeout(() => {
              const r = field.getBoundingClientRect();
              const pane = field.closest(".hb-pg-scroll")?.getBoundingClientRect();
              if (pane)
                setUp(pane.bottom - r.bottom < 300 && r.top - pane.top > pane.bottom - r.bottom);
            }, 320);
          }}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(options[active]);
            } else if (e.key === "Escape" && (open || query)) {
              e.preventDefault();
              e.stopPropagation();
              if (query) setQuery("");
              else setOpen(false);
            }
          }}
        />
      </label>
      {open ? (
        <ul class={`hb-pg-add-list${up ? " is-up" : ""}`} id={listId} role="listbox">
          {options.map((opt, i) => (
            <li
              key={opt.type === "ability" ? opt.item.key : opt.kind}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              class={[
                i === active ? "is-active" : "",
                opt.type === "template" && i === results.length && results.length
                  ? "is-first-template"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(opt)}
            >
              {opt.type === "ability" ? (
                <>
                  <FeatureGlyph glyph={iconGlyph(opt.item.feature.icon, "*")} />
                  <strong>{opt.item.feature.name}</strong>
                  <span class="hb-pg-add-kind">{opt.item.kindLabel}</span>
                  <span class="hb-pg-add-src">
                    {opt.item.monster.name} · {opt.item.monster.level}
                  </span>
                </>
              ) : (
                <>
                  <PlusIcon />
                  <strong>{query.trim() ? `“${query.trim()}”` : opt.label}</strong>
                  {query.trim() ? <span class="hb-pg-add-kind">{opt.label}</span> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const CHAR_NAMES = {
  M: "Might",
  A: "Agility",
  R: "Reason",
  I: "Intuition",
  P: "Presence",
} as const;

/** Pair each ability with its printed original by name, so a reordered or
    added ability doesn't read as a rewrite of its neighbour. */
function matchPrinted(
  features: readonly MonsterFeature[],
  printed: readonly MonsterFeature[] | undefined,
): (MonsterFeature | null)[] {
  if (!printed) return features.map(() => null);
  const used = new Set<number>();
  return features.map((f) => {
    const name = (f.name ?? "").trim().toLowerCase();
    const idx = printed.findIndex(
      (p, i) => !used.has(i) && (p.name ?? "").trim().toLowerCase() === name,
    );
    if (idx < 0) return null;
    used.add(idx);
    return printed[idx] ?? null;
  });
}

/** Rules links are added for display; compare abilities without them. */
function stripLinks(feature: MonsterFeature | undefined): string {
  if (!feature) return "";
  return JSON.stringify(feature, (_key, value: unknown) =>
    typeof value === "string" ? value.replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1") : value,
  );
}

/** The studio keys rolls by the ability's place in the whole statblock; a
    single printed ability renders as ability 0. */
function remapRolls<T>(results: ReadonlyMap<string, T>, id: string, index: number): Map<string, T> {
  const out = new Map<string, T>();
  const prefix = `${id}|${index}|`;
  for (const [key, val] of results) {
    if (key.startsWith(prefix)) out.set(`${id}|0|${key.slice(prefix.length)}`, val);
  }
  return out;
}

const ROLL_BONUS_RE = /^Power Roll\s*([+−-])\s*(\d+)/i;

/** Where each statblock note belongs on the page. */
function placeNotes(
  notes: readonly PageNote[],
  features: readonly MonsterFeature[],
  chars: HomebrewMonster["chars"],
): (anchor: string) => PageNote[] {
  const at = new Map<string, PageNote[]>();
  const put = (anchor: string, note: PageNote) => at.set(anchor, [...(at.get(anchor) ?? []), note]);
  const top = Math.max(chars.M, chars.A, chars.R, chars.I, chars.P);
  for (const note of notes) {
    if (note.id === "tier-order" || note.id === "roll-mismatch") {
      let placed = false;
      features.forEach((f, i) => {
        const eff = f.effects?.[0];
        if (!eff) return;
        if (note.id === "tier-order") {
          const a = firstNumber(eff.tier1);
          const b = firstNumber(eff.tier2);
          const c = firstNumber(eff.tier3);
          if (a !== null && b !== null && c !== null && (b < a || c < b)) {
            put(`ability:${i}`, note);
            placed = true;
          }
        } else {
          const m = ROLL_BONUS_RE.exec(eff.roll ?? "");
          if (m && Number(m[2]) * (m[1] === "+" ? 1 : -1) !== top) {
            put(`ability:${i}`, note);
            placed = true;
          }
        }
      });
      if (!placed) put("abilities", note);
    } else if (note.id === "stamina-high" || note.id === "stamina-low") put("stamina", note);
    else if (note.id === "solo-turns" || note.id === "minion-captain") put("defenses", note);
    else if (note.id === "missing-signature" || note.id.endsWith("-villain"))
      put("abilities", note);
    else if (note.id === "minion-malice") put("malice", note);
    else put("band", note);
  }
  return (anchor: string) => at.get(anchor) ?? [];
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export interface PageMaliceProps {
  onSetFamily: (slug: string, label: string) => void;
  onToggle: (id: string, name: string) => void;
  onAttach: (id: string) => void;
  preview: ComponentChildren;
}

export function OnPageEditor({
  draft,
  monster,
  printMonster,
  printDraft,
  forked,
  baseline,
  previewRoll,
  glossary,
  keywordOptions,
  defenseOptions,
  notes,
  malice,
  abilityActions,
  onField,
  onIdentity,
  onNameCommit,
  onAuthor,
  onAddAbility,
  onCopyAbility,
  onOpenSource,
  facing,
  nameError,
  showHint,
}: {
  draft: HomebrewMonster;
  /** The draft as a statblock (linked rules text). */
  monster: Monster;
  /** The print the draft is compared against, as a statblock. */
  printMonster: Monster;
  printDraft: HomebrewMonster;
  /** Whether the print is a real statblock (fork) rather than baseline math. */
  forked: boolean;
  baseline: BaselineMonsterStats;
  previewRoll: PreviewRollController;
  glossary: readonly CompendiumTerm[];
  keywordOptions: readonly (string | SuggestOption)[];
  defenseOptions: readonly (string | SuggestOption)[];
  notes: readonly PageNote[];
  malice: PageMaliceProps;
  abilityActions: (index: number) => AbilityRowActions | null;
  onField: (patch: Partial<HomebrewMonster>, label: string, stats: boolean) => void;
  onIdentity: (patch: Partial<Pick<HomebrewMonster, "level" | "organization" | "role">>) => void;
  onNameCommit: (name: string) => void;
  onAuthor: (author: string) => void;
  /** Adds a blank ability of a kind and returns its index. */
  onAddAbility: (kind: AbilityTemplateKind, name?: string) => number;
  onCopyAbility: (feature: MonsterFeature, sourceName: string) => void;
  /** Read a statblock in full beside the page. */
  onOpenSource: (path: string) => void;
  /** An opened statblock, when the screen is too narrow to set it beside
      the page: it follows the page instead. */
  facing?: ComponentChildren;
  /** Shown under the name when a save needs one. */
  nameError: string;
  /** A new, untouched monster: say once how the page works. */
  showHint: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [moreDefs, setMoreDefs] = useState(false);
  // Browsing opens in the page itself, where the next ability or Malice
  // feature will land, and closes back to the print.
  const [browsing, setBrowsing] = useState<"abilities" | "malice" | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const openBrowse = (what: "abilities" | "malice") => {
    setBrowsing(what);
    setFocusKey((k) => k + 1);
  };
  useEffect(() => {
    if (!browsing) return;
    requestAnimationFrame(() =>
      document
        .querySelector(browsing === "malice" ? ".hb-pg-ideas.is-malice" : ".hb-pg-ideas")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [browsing, focusKey]);
  const closeBrowse = (back?: HTMLElement | null) => {
    setBrowsing(null);
    back?.focus({ preventScroll: true });
  };
  const browseBtnRef = useRef<HTMLButtonElement>(null);
  const rewriteRef = useRef<HTMLDivElement>(null);
  const abilityRefs = useRef<Map<number, HTMLElement>>(new Map());
  const lastOpened = useRef<number | null>(null);

  // The monster's name as its abilities print it: in full without the
  // "(Custom)" tag, and by its first word ("Ajax shifts…").
  const monsterNames = useMemo(() => {
    const full = draft.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const first = full.split(/\s+/)[0] ?? "";
    return [...new Set([full, first].filter((n) => n.length >= 4))];
  }, [draft.name]);
  const movedBy = useRef<-1 | 1 | null>(null);
  const printedFeatures = useMemo(
    () => matchPrinted(monster.features, forked ? printMonster.features : undefined),
    [monster.features, printMonster.features, forked],
  );
  const noteAt = useMemo(
    () => placeNotes(notes, draft.features, draft.chars),
    [notes, draft.features, draft.chars],
  );

  // A removed or moved ability can leave the open index pointing past the end.
  useEffect(() => {
    if (openIndex !== null && openIndex >= draft.features.length) setOpenIndex(null);
  }, [openIndex, draft.features.length]);

  useEffect(() => {
    if (openIndex === null) {
      const back = lastOpened.current;
      lastOpened.current = null;
      if (back !== null) {
        abilityRefs.current
          .get(back)
          ?.querySelector<HTMLButtonElement>(".hb-pg-rewrite-btn")
          ?.focus({ preventScroll: true });
      }
      return;
    }
    const moved = movedBy.current;
    movedBy.current = null;
    requestAnimationFrame(() => {
      const box = rewriteRef.current;
      box?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (moved) {
        // Moving keeps the hand on the same arrow, so it can press again.
        const want = box?.querySelector<HTMLButtonElement>(
          `.hb-pgw-tools button[title="${moved < 0 ? "Move up" : "Move down"}"]`,
        );
        const fallback = box?.querySelector<HTMLButtonElement>(
          `.hb-pgw-tools button[title="${moved < 0 ? "Move down" : "Move up"}"]`,
        );
        (want && !want.disabled ? want : fallback)?.focus({ preventScroll: true });
        return;
      }
      box?.querySelector<HTMLInputElement>(".hb-pgw-name")?.focus({ preventScroll: true });
    });
  }, [openIndex]);

  const openAbility = (index: number) => {
    lastOpened.current = null;
    setOpenIndex(index);
  };
  const closeAbility = () => {
    lastOpened.current = openIndex;
    setOpenIndex(null);
  };

  const p = printDraft;
  const stat = (patch: Partial<HomebrewMonster>, label: string) => onField(patch, label, true);
  const text = (patch: Partial<HomebrewMonster>, label: string) => onField(patch, label, false);
  const list = (raw: string) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const orgOptions: PickOption[] = ORGANIZATIONS.map((o) => {
    const g = orgGuideFor(o);
    return { value: o, label: o, meta: g && `EV ${g.evMult}`, detail: g?.brief };
  });
  const roleOptions: PickOption[] = [
    { value: "", label: "No role", detail: "Leaders and Solos often go without" },
    ...ROLES.map((r) => {
      const g = roleGuideFor(r);
      return { value: r, label: r, meta: g && `+${g.staminaMod} Stamina`, detail: g?.brief };
    }),
  ];
  // Starter abilities still under their kit names read as drafts: the
  // page says so once, and their pencils stay out in the margin.
  const starterNames = useMemo(() => {
    if (forked) return new Set<string>();
    const kit = buildRoleStarterFeatures(draft.level, draft.organization, draft.role, draft.chars);
    return new Set(kit.map((f) => (f.name ?? "").trim()).filter(Boolean));
  }, [forked, draft.level, draft.organization, draft.role, draft.chars]);
  const isStarter = (f: MonsterFeature | undefined) =>
    !!f && starterNames.has((f.name ?? "").trim());
  const hasStarters = draft.features.some(isStarter);
  const identity = [`Level ${draft.level}`, draft.organization, draft.role]
    .filter(Boolean)
    .join(" ");
  const identityNotes = useMemo((): PageNote[] => {
    const org = orgGuideFor(draft.organization);
    const role = roleGuideFor(draft.role);
    const out: PageNote[] = [];
    if (org) {
      out.push({
        id: "about-org",
        heading: org.name,
        meta: `EV ${org.evMult} · Stamina ${org.staminaMult}`,
        message: `${org.summary} ${org.tip}`,
      });
    }
    if (role) {
      const dmg = role.damageMod ? ` · +${role.damageMod} damage` : "";
      out.push({
        id: "about-role",
        heading: role.name,
        meta: `+${role.staminaMod} Stamina${dmg} · Speed ${role.typicalSpeed} · Stability ${role.typicalStability}`,
        message: `Leads with ${role.primaryChars}. ${role.job} ${role.tip}`,
      });
    }
    return out;
  }, [draft.organization, draft.role]);
  const isMinion = draft.organization.toLowerCase() === "minion";
  const isBoss = ["solo", "leader"].includes(draft.organization.toLowerCase());
  const showCaptain = isMinion || Boolean(draft.withCaptain) || moreDefs;
  const showTurns = (draft.turnsPerRound ?? 1) > 1 || isBoss || moreDefs;

  return (
    <>
      <div class="hb-pg-scroll">
        <div class="hb-pg-main">
          {showHint ? (
            <p class="hb-pg-hint">
              Start with what it is: the level, organization and role under the name. The stats and
              starter abilities follow.{" "}
              <span class="for-pointer">
                Then click any value, or Tab to it and type, to write over it.
              </span>
              <span class="for-touch">Then tap any value to write over it.</span>
            </p>
          ) : null}
          <article class="hb-pg-sheet" aria-label={`${draft.name || "Untitled monster"} statblock`}>
            <header class="lane-header">
              <div class="lane-band">
                <div class="lane-band-text">
                  <div class="lane-band-row">
                    <h2 class="hb-pg-name">
                      <PenSlot
                        value={draft.name}
                        printed={forked ? p.name : undefined}
                        label="Monster name"
                        placeholder="Name"
                        showPrint={false}
                        width={16}
                        onCommit={(v) => {
                          text({ name: v }, "Edit name");
                          onNameCommit(v);
                        }}
                      />
                    </h2>
                    <div class="lane-band-right">
                      <NoteMark notes={noteAt("band")} />
                      <span class="ev-badge">
                        EV{" "}
                        <PenSlot
                          value={draft.ev}
                          printed={p.ev}
                          book={baseline.ev}
                          label="EV"
                          width={3}
                          onCommit={(v) => stat({ ev: v }, "Edit EV")}
                        />
                      </span>
                    </div>
                  </div>
                  {nameError ? (
                    <p class="hb-pg-name-error" role="alert">
                      {nameError}
                    </p>
                  ) : null}
                  <div class="lane-band-row lane-keys">
                    <span class="lane-level">
                      Level{" "}
                      <PenSlot
                        value={String(draft.level)}
                        printed={forked ? String(p.level) : undefined}
                        label="Level"
                        kind="int"
                        min={0}
                        max={20}
                        onCommit={(v) => onIdentity({ level: Number(v) })}
                      />{" "}
                      <span class="lane-org">
                        <PenPick
                          value={draft.organization}
                          printed={forked ? p.organization : undefined}
                          label="Organization"
                          options={orgOptions}
                          onCommit={(v) => onIdentity({ organization: v })}
                        />{" "}
                        <PenPick
                          value={draft.role}
                          printed={forked ? p.role : undefined}
                          label="Role"
                          placeholder="role"
                          options={roleOptions}
                          onCommit={(v) => onIdentity({ role: v })}
                        />
                        <NoteMark
                          more={
                            <span class="hb-pg-about-more">
                              <span class="hb-pg-about-more-label">
                                Read more on Steel Compendium
                              </span>
                              <a
                                class="rule-link"
                                href={MONSTER_BASICS_URL}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Monster Basics
                              </a>
                              <span aria-hidden="true">·</span>
                              <a
                                class="rule-link"
                                href={`${MONSTER_BASICS_URL}#reskinning-monsters`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Reskinning monsters
                              </a>
                              <ExternalIcon aria-hidden="true" />
                            </span>
                          }
                          notes={identityNotes}
                          about={`What ${[draft.organization, draft.role].filter(Boolean).join(" ")} means`}
                        />
                      </span>
                    </span>
                    <span class="lane-keywords">
                      <PenSlot
                        value={draft.keywords.join(", ")}
                        printed={forked ? p.keywords.join(", ") : undefined}
                        label="Keywords"
                        placeholder="Keywords"
                        showPrint={false}
                        width={16}
                        suggestions={keywordOptions}
                        suggestMode="comma"
                        onCommit={(v) => text({ keywords: list(v) }, "Edit keywords")}
                      />
                    </span>
                  </div>
                </div>
              </div>

              <div class="lane-core-stats">
                <span>
                  <b>
                    <PenSlot
                      value={draft.size}
                      printed={p.size}
                      book={baseline.size}
                      label="Size"
                      width={4}
                      suggestions={SIZE_SUGGESTIONS}
                      onCommit={(v) => stat({ size: v }, "Edit Size")}
                    />
                  </b>
                  <small>Size</small>
                </span>
                <span>
                  <b>
                    <PenSlot
                      value={draft.speed}
                      printed={p.speed}
                      book={baseline.speed}
                      label="Speed"
                      width={2}
                      onCommit={(v) => stat({ speed: v }, "Edit Speed")}
                    />
                  </b>
                  <small>Speed</small>
                  <i class={`lane-movement${draft.movement.trim() ? "" : " is-blank"}`}>
                    <PenSlot
                      value={draft.movement.toLowerCase()}
                      printed={forked ? p.movement.toLowerCase() : undefined}
                      label="Movement"
                      placeholder="movement"
                      showPrint={false}
                      width={8}
                      suggestions={MOVEMENT_SUGGESTIONS}
                      suggestMode="comma"
                      onCommit={(v) => text({ movement: v }, "Edit movement")}
                    />
                  </i>
                </span>
                <span class="hb-pg-has-mark">
                  <b>
                    <PenSlot
                      value={String(draft.stamina)}
                      printed={String(p.stamina)}
                      book={String(baseline.stamina)}
                      label="Stamina"
                      kind="int"
                      min={1}
                      max={9999}
                      width={4}
                      onCommit={(v) => stat({ stamina: Number(v) }, "Edit Stamina")}
                    />
                  </b>
                  <small>Stamina</small>
                  <NoteMark notes={noteAt("stamina")} />
                </span>
                <span>
                  <b>
                    <PenSlot
                      value={draft.stability}
                      printed={p.stability}
                      book={baseline.stability}
                      label="Stability"
                      width={2}
                      onCommit={(v) => stat({ stability: v }, "Edit Stability")}
                    />
                  </b>
                  <small>Stability</small>
                </span>
                <span>
                  <b>
                    <PenSlot
                      value={draft.freeStrike}
                      printed={p.freeStrike}
                      book={baseline.freeStrike}
                      label="Free Strike"
                      width={2}
                      onCommit={(v) => stat({ freeStrike: v }, "Edit Free Strike")}
                    />
                  </b>
                  <small>Free Strike</small>
                </span>
              </div>

              <dl
                class={`lane-defenses hb-pg-defenses${
                  !draft.immunities.length && !draft.weaknesses.length && !draft.withCaptain
                    ? " is-blank"
                    : ""
                }`}
              >
                <div>
                  <dt>Immunity</dt>
                  <dd>
                    <PenSlot
                      value={draft.immunities.join(", ")}
                      printed={forked ? p.immunities.join(", ") : undefined}
                      label="Immunities"
                      showPrint={false}
                      width={12}
                      suggestions={defenseOptions}
                      suggestMode="comma"
                      onCommit={(v) => text({ immunities: list(v) }, "Edit immunities")}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Weakness</dt>
                  <dd>
                    <PenSlot
                      value={draft.weaknesses.join(", ")}
                      printed={forked ? p.weaknesses.join(", ") : undefined}
                      label="Weaknesses"
                      showPrint={false}
                      width={12}
                      suggestions={defenseOptions}
                      suggestMode="comma"
                      onCommit={(v) => text({ weaknesses: list(v) }, "Edit weaknesses")}
                    />
                  </dd>
                </div>
                {showCaptain ? (
                  <div>
                    <dt>With Captain</dt>
                    <dd>
                      <PenSlot
                        value={draft.withCaptain}
                        printed={forked ? p.withCaptain : undefined}
                        label="With Captain"
                        showPrint={false}
                        width={18}
                        suggestions={WITH_CAPTAIN_SUGGESTIONS}
                        onCommit={(v) => text({ withCaptain: v }, "Edit With Captain")}
                      />
                    </dd>
                  </div>
                ) : null}
                {showTurns ? (
                  <div>
                    <dt>Turns</dt>
                    <dd>
                      <PenSlot
                        value={String(draft.turnsPerRound ?? 1)}
                        printed={String(p.turnsPerRound ?? 1)}
                        book={String(baseline.turnsPerRound)}
                        label="Turns per round"
                        kind="int"
                        min={1}
                        max={5}
                        onCommit={(v) =>
                          stat({ turnsPerRound: Math.max(1, Number(v)) }, "Edit turns per round")
                        }
                      />
                    </dd>
                  </div>
                ) : null}
                {!showCaptain || !showTurns ? (
                  <div>
                    <button
                      type="button"
                      class="hb-pg-more"
                      aria-label="Show With Captain and Turns"
                      title="With Captain, Turns"
                      onClick={() => setMoreDefs(true)}
                    >
                      …
                    </button>
                  </div>
                ) : null}
                <NoteMark notes={noteAt("defenses")} />
              </dl>

              <div class="lane-characteristics hb-pg-chars">
                {(["M", "A", "R", "I", "P"] as const).map((key) => {
                  const name = CHAR_NAMES[key];
                  return (
                    <div class="hb-pg-char" key={key}>
                      <small>
                        <span class="ds-glyph" aria-hidden="true">
                          {key}
                        </span>
                        {name.slice(1)}
                      </small>
                      <b>
                        <PenSlot
                          value={String(draft.chars[key])}
                          printed={String(p.chars[key])}
                          book={String(baseline.chars[key])}
                          label={name}
                          kind="signed"
                          min={-99}
                          max={99}
                          onCommit={(v) =>
                            stat({ chars: { ...draft.chars, [key]: Number(v) } }, `Edit ${name}`)
                          }
                        />
                      </b>
                    </div>
                  );
                })}
              </div>
            </header>

            <div class="hb-pg-abilities">
              {hasStarters ? (
                <p class="hb-pg-starter-note">
                  Starter abilities for a {identity}.{" "}
                  <span class="for-pointer">Click one to rewrite it as your own.</span>
                  <span class="for-touch">Tap one to rewrite it as your own.</span>
                </p>
              ) : null}
              {monster.features.map((feature, index) => {
                const name = feature.name?.trim() || "Ability";
                const actions = abilityActions(index);
                const raw = draft.features[index];
                if (openIndex === index && actions && raw) {
                  return (
                    <div class="hb-pg-rewrite" ref={rewriteRef} key="writer">
                      <AbilityWriter
                        names={monsterNames}
                        feature={raw}
                        printed={printedFeatures[index] ?? null}
                        fresh={forked && !printedFeatures[index]}
                        index={index}
                        total={draft.features.length}
                        monster={draft}
                        glossary={glossary}
                        actions={{
                          ...actions,
                          // The writer follows its ability as it moves.
                          onMove: (delta) => {
                            movedBy.current = delta;
                            actions.onMove(delta);
                            setOpenIndex(index + delta);
                          },
                          onRemove: () => {
                            actions.onRemove();
                            setOpenIndex(null);
                          },
                        }}
                        onDone={closeAbility}
                      />
                    </div>
                  );
                }
                const printedFeature = printedFeatures[index] ?? null;
                const isNew = forked && !printedFeature;
                const rewritten =
                  forked && !!printedFeature && stripLinks(raw) !== stripLinks(printedFeature);
                const single: Monster = { ...monster, features: [feature] };
                if (printedFeature)
                  single.printed = { ...printMonster, features: [printedFeature] };
                else delete single.printed;
                const roll: PreviewRollController = {
                  results: remapRolls(previewRoll.results, monster.id, index),
                  onRollFeature: (_fi, effectIndex, edge) =>
                    previewRoll.onRollFeature(index, effectIndex, edge),
                  onRollChar: previewRoll.onRollChar,
                };
                return (
                  <div
                    class={`hb-pg-ability${rewritten || isNew ? " is-pen" : ""}${isStarter(raw) ? " is-starter" : ""}`}
                    key={`print-${index}`}
                    ref={(el) => {
                      if (el) abilityRefs.current.set(index, el);
                      else abilityRefs.current.delete(index);
                    }}
                    onClick={(e) => {
                      const t = e.target as HTMLElement;
                      if (t.closest("button, a, input, select, textarea, summary, .hb-pg-mark"))
                        return;
                      if (window.getSelection()?.toString()) return;
                      openAbility(index);
                    }}
                  >
                    <StatblockBody monster={single} interactive={false} previewRoll={roll} />
                    <div class="hb-pg-margin">
                      <button
                        type="button"
                        class="hb-pg-rewrite-btn"
                        aria-label={`Write over ${name}${isNew ? " (new)" : rewritten ? " (rewritten)" : isStarter(raw) ? " (starter)" : ""}`}
                        title={`Write over ${name}`}
                        onClick={() => openAbility(index)}
                      >
                        <PencilIcon />
                      </button>
                      <NoteMark notes={noteAt(`ability:${index}`)} />
                    </div>
                  </div>
                );
              })}

              <div class="hb-pg-add-row">
                <AddAbility
                  draftId={draft.id}
                  level={draft.level}
                  onTemplate={(kind, name) => openAbility(onAddAbility(kind, name))}
                  onCopy={onCopyAbility}
                />
                <button
                  ref={browseBtnRef}
                  type="button"
                  class="text-button hb-pg-browse-btn"

                  aria-expanded={browsing === "abilities"}
                  onClick={() =>
                    browsing === "abilities" ? closeBrowse() : openBrowse("abilities")
                  }
                >
                  Browse
                </button>
                <NoteMark notes={noteAt("abilities")} />
              </div>
              {browsing === "abilities" ? (
                <section
                  class="hb-pg-ideas"
                  aria-label="Browse abilities"
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && !e.defaultPrevented) {
                      e.preventDefault();
                      e.stopPropagation();
                      closeBrowse(browseBtnRef.current);
                    }
                  }}
                >
                  <header class="hb-pg-ideas-head">
                    <h3>
                      Browse abilities
                      {draft.name.trim() ? <small> for {draft.name.trim()}</small> : null}
                    </h3>
                    <button
                      type="button"
                      class="icon-button"
                      aria-label="Close browsing"
                      title="Close (Esc)"
                      onClick={() => closeBrowse(browseBtnRef.current)}
                    >
                      <CloseIcon />
                    </button>
                  </header>
                  <BrowseAbilities
                    draftId={draft.id}
                    level={draft.level}
                    role={draft.role}
                    focusKey={focusKey}
                    have={draft.features.map((f) => f.name ?? "")}
                    onAdd={onCopyAbility}
                    onOpen={onOpenSource}
                  />
                </section>
              ) : null}
            </div>

            <p class="source-link source-homebrew hb-pg-source">
              Homebrew statblock · By{" "}
              <PenSlot
                value={draft.origin?.author ?? ""}
                label="Author"
                placeholder="author"
                showPrint={false}
                width={14}
                onCommit={onAuthor}
              />
              {draft.origin?.sourceName ? ` · Forked from ${draft.origin.sourceName}` : ""}
            </p>
          </article>

          <PageMalice
            familyPath={draft.familyPath}
            level={draft.level}
            noteMark={<NoteMark notes={noteAt("malice")} />}
            preview={malice.preview}
            attachedIds={draft.maliceIds ?? []}
            onSetFamily={malice.onSetFamily}
            onToggleAttached={malice.onToggle}
            onAttach={malice.onAttach}
            onBrowse={() => (browsing === "malice" ? closeBrowse() : openBrowse("malice"))}
          />
          {browsing === "malice" ? (
            <section
              class="hb-pg-ideas is-malice"
              aria-label="Browse Malice"
              onKeyDown={(e) => {
                if (e.key === "Escape" && !e.defaultPrevented) {
                  e.preventDefault();
                  e.stopPropagation();
                  closeBrowse();
                }
              }}
            >
              <header class="hb-pg-ideas-head">
                <h3>Browse Malice</h3>
                <button
                  type="button"
                  class="icon-button"
                  aria-label="Close browsing"
                  title="Close (Esc)"
                  onClick={() => closeBrowse()}
                >
                  <CloseIcon />
                </button>
              </header>
              <BrowseMalice
                family={familyInfo(draft.familyPath)}
                focusKey={focusKey}
                onUseFamily={(slug, label) => malice.onSetFamily(slug, label)}
              />
            </section>
          ) : null}
          {facing ? <section class="hb-src-follow">{facing}</section> : null}
        </div>
      </div>
    </>
  );
}
