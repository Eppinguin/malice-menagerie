import "./homebrew.css";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { officialFamilies } from "../../data.ts";
import { compendiumGlossary } from "../../lib/compendiumGlossary.ts";
import {
  autoLinkCompendiumText,
  stripCompendiumLinksFromEffects,
} from "../../lib/compendiumLinks.ts";
import { homebrewToMaliceFeature } from "../../lib/homebrew.ts";
import { useModalFocusTrap } from "../../lib/modalFocus.ts";
import {
  ABILITY_DISTANCE_SUGGESTIONS,
  ABILITY_TARGET_SUGGESTIONS,
  maliceCostLabelSuggestions,
} from "../../lib/monsterSuggestions.ts";
import { familyLabel, slugToLabel } from "../../lib/text.ts";
import {
  closeCustomMaliceEditor,
  customMaliceEditorState,
  deleteHomebrewMalice,
  importDialogState,
  openShareDialog,
  saveHomebrewMalice,
  shareDialogState,
} from "../../store.ts";
import type { FeatureEffect, HomebrewMalice } from "../../types.ts";
import { AlertIcon, CloseIcon, ShareIcon, TrashIcon } from "../Icons.tsx";
import { TierMark } from "../Statblock.tsx";
import { MaliceFeaturePreview } from "../combat/MaliceDock.tsx";
import { GlyphPicker } from "./GlyphPicker.tsx";
import { IntInput } from "./IntInput.tsx";
import { RuleInlineInput, RuleTextEditor } from "./RuleTextEditor.tsx";
import { SuggestInput } from "./SuggestInput.tsx";

function linkEffectsForOutput(
  effects: readonly FeatureEffect[],
  glossary: typeof compendiumGlossary.value,
): FeatureEffect[] {
  return effects.map((eff): FeatureEffect => {
    const copy: FeatureEffect = { ...eff };
    for (const key of ["effect", "tier1", "tier2", "tier3"] as const) {
      const val = copy[key];
      if (val) copy[key] = autoLinkCompendiumText(val, glossary).text;
    }
    return copy;
  });
}

export function CustomMaliceDialog() {
  const editor = customMaliceEditorState.value;
  if (!editor) return null;
  return <CustomMaliceDialogInner key={editor.draft.id} editor={editor} />;
}

function CustomMaliceDialogInner({
  editor,
}: {
  editor: NonNullable<typeof customMaliceEditorState.value>;
}) {
  const [draft, setDraft] = useState<HomebrewMalice>(() => {
    const cloned = structuredClone(editor.draft);
    cloned.effects = stripCompendiumLinksFromEffects(cloned.effects);
    return cloned;
  });
  const [dirty, setDirty] = useState(false);
  const [nameError, setNameError] = useState("");
  const [confirmKind, setConfirmKind] = useState<"discard" | "delete" | "share-dirty" | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useModalFocusTrap(dialogRef, { isSubdialog: true });

  useEffect(() => {
    if (confirmKind) confirmCancelRef.current?.focus();
  }, [confirmKind]);

  const updateDraft = (fn: (prev: HomebrewMalice) => HomebrewMalice) => {
    setDirty(true);
    setConfirmKind(null);
    setDraft(fn);
  };

  const attemptClose = () => {
    if (dirty && confirmKind !== "discard") {
      setConfirmKind("discard");
      return;
    }
    closeCustomMaliceEditor();
  };

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shareDialogState.value || importDialogState.value) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (confirmKind) {
          setConfirmKind(null);
          return;
        }
        attemptClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, confirmKind]);

  const effect: FeatureEffect = draft.effects[0] ?? {};
  const hasTiers = Boolean(effect.roll || effect.tier1 || effect.tier2 || effect.tier3);

  const updateEffect = (patch: Partial<FeatureEffect>) => {
    const merged: FeatureEffect = { ...effect, ...patch };
    for (const key of ["effect", "roll", "tier1", "tier2", "tier3"] as const) {
      if (merged[key] === "") delete merged[key];
    }
    updateDraft((prev) => ({ ...prev, effects: [merged, ...prev.effects.slice(1)] }));
  };

  const toggleTiers = (enabled: boolean) => {
    if (enabled) {
      updateEffect({
        roll: effect.roll || "Power Roll + 2",
        tier1: effect.tier1 || "4 damage",
        tier2: effect.tier2 || "7 damage",
        tier3: effect.tier3 || "10 damage",
      });
    } else {
      const next: FeatureEffect = {};
      if (effect.effect) next.effect = effect.effect;
      updateDraft((prev) => ({ ...prev, effects: [next, ...prev.effects.slice(1)] }));
    }
  };

  const glossary = compendiumGlossary.value;
  const previewFeature = useMemo(() => {
    const built = homebrewToMaliceFeature({
      ...draft,
      effects: linkEffectsForOutput(draft.effects, glossary),
    });
    // Strip homebrew edit/share chrome inside the editor's own Live Preview
    const { homebrewId: _omitId, ...rest } = built;
    return { ...rest, isHomebrew: false };
  }, [draft, glossary]);
  const families = officialFamilies.value;
  const familyOptions = useMemo(
    () =>
      families.map((fam) => ({
        value: fam.label,
        label: fam.label,
        hint: fam.maliceCount ? `${fam.maliceCount} Malice` : "Monster family",
      })),
    [families],
  );
  const familyDisplay = useMemo(() => {
    if (!draft.family) return "";
    const found = families.find((f) => f.slug.toLowerCase() === draft.family.toLowerCase());
    return found ? found.label : familyLabel(draft.family);
  }, [draft.family, families]);

  const costLabelOptions = useMemo(() => maliceCostLabelSuggestions(draft.cost), [draft.cost]);

  const handleSave = (): boolean => {
    const trimmed = draft.name.trim();
    if (!trimmed) {
      setConfirmKind(null);
      setNameError("Give this Malice feature a name before saving.");
      nameRef.current?.focus();
      return false;
    }
    setNameError("");
    saveHomebrewMalice(
      {
        ...draft,
        name: trimmed,
        costText: draft.costText.trim() || `${draft.cost} Malice`,
        effects: linkEffectsForOutput(draft.effects, glossary),
      },
      {
        ...(editor.pinOnSave !== undefined ? { pinToEncounter: editor.pinOnSave } : {}),
        ...(editor.onSaved ? { onSaved: editor.onSaved } : {}),
      },
    );
    return true;
  };

  return (
    <div
      class="hb-modal-overlay hb-subdialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hb-malice-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) attemptClose();
      }}
    >
      <div ref={dialogRef} class="hb-modal-sheet hb-malice-sheet">
        <header class="hb-modal-head hb-malice-modal-head">
          <div class="hb-modal-title-row">
            <span class="ds-glyph malice-skull" aria-hidden="true">
              d
            </span>
            <h2 id="hb-malice-title">
              {editor.mode === "edit" ? "Edit custom Malice" : "New custom Malice"}
            </h2>
          </div>
          <div class="hb-studio-head-actions">
            {editor.mode === "edit" ? (
              <button
                type="button"
                class="secondary compact-button"
                onClick={() => {
                  if (dirty) setConfirmKind("share-dirty");
                  else openShareDialog("malice", draft.id);
                }}
              >
                <ShareIcon />
                <span>Share</span>
              </button>
            ) : null}
            <button
              type="button"
              class="icon-button"
              aria-label="Close Malice editor"
              onClick={attemptClose}
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        {confirmKind ? (
          <div class="hb-confirm-bar" role="alert">
            <span>
              {confirmKind === "discard"
                ? "Discard unsaved changes to this Malice feature?"
                : confirmKind === "share-dirty"
                  ? "Save your changes before sharing?"
                  : `Delete “${draft.name || "this Malice feature"}”? (Undo available)`}
            </span>
            <div class="hb-confirm-bar-actions">
              <button
                ref={confirmCancelRef}
                type="button"
                class="secondary compact-button"
                onClick={() => setConfirmKind(null)}
              >
                {confirmKind === "share-dirty" ? "Cancel" : "Keep editing"}
              </button>
              {confirmKind === "share-dirty" ? (
                <>
                  <button
                    type="button"
                    class="secondary compact-button"
                    onClick={() => {
                      setConfirmKind(null);
                      openShareDialog("malice", draft.id);
                    }}
                  >
                    Share last saved
                  </button>
                  <button
                    type="button"
                    class="primary compact-button"
                    onClick={() => {
                      const savedId = draft.id;
                      if (handleSave()) openShareDialog("malice", savedId);
                    }}
                  >
                    Save &amp; share
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  class="secondary compact-button hb-danger-btn"
                  onClick={() => {
                    if (confirmKind === "discard") {
                      closeCustomMaliceEditor();
                    } else {
                      deleteHomebrewMalice(draft.id);
                    }
                  }}
                >
                  {confirmKind === "discard" ? "Discard" : "Delete"}
                </button>
              )}
            </div>
          </div>
        ) : null}

        <div class="hb-modal-body">
          <div class="hb-grid hb-grid-malice-top">
            <div class="hb-field">
              <span class="hb-field-label">Glyph</span>
              <GlyphPicker
                value={draft.icon}
                fallback="d"
                ariaLabel="Malice glyph"
                onChange={(emoji) => updateDraft((prev) => ({ ...prev, icon: emoji }))}
              />
            </div>
            <label class="hb-field">
              <span>Feature name</span>
              <input
                ref={nameRef}
                class="hb-input-pen"
                value={draft.name}
                placeholder="e.g. Blood-Crazed Frenzy"
                aria-invalid={nameError ? "true" : undefined}
                aria-describedby={nameError ? "hb-malice-name-error" : undefined}
                onInput={(e) => {
                  const val = e.currentTarget.value;
                  if (nameError && val.trim()) setNameError("");
                  updateDraft((prev) => ({ ...prev, name: val }));
                }}
              />
              {nameError ? (
                <span id="hb-malice-name-error" class="hb-field-error" role="alert">
                  <AlertIcon />
                  <span>{nameError}</span>
                </span>
              ) : null}
            </label>
            <label class="hb-field">
              <span>Malice cost</span>
              <IntInput
                min={0}
                max={99}
                value={draft.cost}
                onChange={(cost) => {
                  updateDraft((prev) => {
                    const trimmedLabel = prev.costText.trim();
                    const isDefaultLabel = !trimmedLabel || trimmedLabel === `${prev.cost} Malice`;
                    return {
                      ...prev,
                      cost,
                      costText: isDefaultLabel ? `${cost} Malice` : prev.costText,
                    };
                  });
                }}
              />
            </label>
          </div>

          <div class="hb-grid hb-grid-3">
            <label class="hb-field">
              <span>Family</span>
              <SuggestInput
                value={familyDisplay}
                placeholder="Any encounter"
                options={familyOptions}
                dropdownIndicator
                onChange={(val) => {
                  const clean = val.trim();
                  const matched = families.find(
                    (f) =>
                      f.label.toLowerCase() === clean.toLowerCase() ||
                      f.slug.toLowerCase() === clean.toLowerCase(),
                  );
                  const family = matched ? matched.slug : clean.toLowerCase().replace(/\s+/g, "-");
                  updateDraft((prev) => ({
                    ...prev,
                    family,
                    familyLabel: matched ? matched.label : family ? slugToLabel(family) : "Custom",
                  }));
                }}
              />
            </label>
            <label class="hb-field">
              <span>Min level</span>
              <IntInput
                min={0}
                max={11}
                value={draft.minLevel}
                onChange={(minLevel) => updateDraft((prev) => ({ ...prev, minLevel }))}
              />
            </label>
            <label class="hb-field">
              <span>Cost label</span>
              <SuggestInput
                value={draft.costText}
                placeholder="3 Malice or 3+ Malice"
                options={costLabelOptions}
                dropdownIndicator
                onChange={(val) => updateDraft((prev) => ({ ...prev, costText: val }))}
              />
            </label>
          </div>

          <div class="hb-grid hb-grid-2">
            <label class="hb-field">
              <span>Distance</span>
              <SuggestInput
                value={draft.distance}
                placeholder="5 burst, Ranged 10…"
                options={ABILITY_DISTANCE_SUGGESTIONS}
                dropdownIndicator
                onChange={(val) => updateDraft((prev) => ({ ...prev, distance: val }))}
              />
            </label>
            <label class="hb-field">
              <span>Target</span>
              <SuggestInput
                value={draft.target}
                placeholder="Each enemy in the area…"
                options={ABILITY_TARGET_SUGGESTIONS}
                dropdownIndicator
                onChange={(val) => updateDraft((prev) => ({ ...prev, target: val }))}
              />
            </label>
          </div>

          <div class="hb-field">
            <span>Effect text</span>
            <RuleTextEditor
              rows={3}
              value={effect.effect ?? ""}
              glossary={glossary}
              ariaLabel="Malice effect text"
              placeholder="Until the end of the round, each monster in the encounter gains an edge on strikes."
              onChange={(val) => updateEffect({ effect: val })}
            />
          </div>

          <label class="hb-check-row">
            <input
              type="checkbox"
              checked={hasTiers}
              onChange={(e) => toggleTiers(e.currentTarget.checked)}
            />
            <span>Includes Power Roll &amp; tier outcomes</span>
          </label>

          {hasTiers ? (
            <div class="hb-tiers-editor">
              <label class="hb-field">
                <span>Roll heading</span>
                <input
                  value={effect.roll ?? ""}
                  placeholder="Agility test or Power Roll + 2"
                  onInput={(e) => updateEffect({ roll: e.currentTarget.value })}
                />
              </label>
              <div class="hb-tier-input-row">
                <TierMark index={0} />
                <RuleInlineInput
                  ariaLabel="Tier 1"
                  glossary={glossary}
                  value={effect.tier1 ?? ""}
                  onChange={(val) => updateEffect({ tier1: val })}
                />
              </div>
              <div class="hb-tier-input-row">
                <TierMark index={1} />
                <RuleInlineInput
                  ariaLabel="Tier 2"
                  glossary={glossary}
                  value={effect.tier2 ?? ""}
                  onChange={(val) => updateEffect({ tier2: val })}
                />
              </div>
              <div class="hb-tier-input-row">
                <TierMark index={2} />
                <RuleInlineInput
                  ariaLabel="Tier 3"
                  glossary={glossary}
                  value={effect.tier3 ?? ""}
                  onChange={(val) => updateEffect({ tier3: val })}
                />
              </div>
            </div>
          ) : null}

          <div class="hb-malice-preview-wrap">
            <span class="hb-field-label">Live preview</span>
            <MaliceFeaturePreview feature={previewFeature} expanded={true} onToggle={() => {}} />
          </div>
        </div>

        <footer class="hb-modal-foot">
          <div class="hb-modal-foot-left">
            {editor.mode === "edit" ? (
              <button
                type="button"
                class="secondary compact-button hb-danger-btn"
                onClick={() => setConfirmKind("delete")}
              >
                <TrashIcon />
                <span>Delete</span>
              </button>
            ) : null}
          </div>
          <div class="hb-studio-foot-right">
            <button type="button" class="secondary" onClick={attemptClose}>
              Cancel
            </button>
            <button type="button" class="primary" onClick={handleSave}>
              {editor.mode === "edit" ? "Save Malice" : "Create Malice"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
