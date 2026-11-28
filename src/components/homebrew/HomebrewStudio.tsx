import "./homebrew.css";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { facetOptions } from "../../data.ts";
import { compendiumGlossary } from "../../lib/compendiumGlossary.ts";
import {
  autoLinkFeature,
  featureListMentionsName,
  replaceMonsterNameInFeature,
  stripCompendiumLinksFromFeature,
} from "../../lib/compendiumLinks.ts";
import {
  type AbilityTemplateKind,
  baselineMonsterStats,
  homebrewToMaliceFeature,
  homebrewToMonster,
  makeAbilityTemplate,
  nextVillainActionNumber,
  sanitizeHomebrewMonster,
} from "../../lib/homebrew.ts";
import { basePath } from "../../lib/levels.ts";
import { useModalFocusTrap } from "../../lib/modalFocus.ts";
import {
  analyzeMonsterSanity,
  type SanityNote,
  applySanityFix,
  buildRoleStarterFeatures,
} from "../../lib/monsterCraft.ts";
import { defenseSuggestions, mergeKeywordSuggestions } from "../../lib/monsterSuggestions.ts";
import { makeCharacteristicRoll, makePowerRoll, type CharacteristicKey } from "../../lib/rules.ts";
import {
  canRedoStudio,
  canUndoStudio,
  commitStudioEdit,
  createStudioHistory,
  redoStudio,
  type StudioHistory,
  type StudioSnapshot,
  type StudioStepMeta,
  studioRedoLabel,
  studioUndoLabel,
  undoStudio,
  updateStudioView,
} from "../../lib/studioHistory.ts";
import {
  closeHomebrewStudio,
  customMaliceEditorState,
  deleteHomebrewMonster,
  dismissToast,
  encountersUsingHomebrewMonster,
  homebrewStudioState,
  importDialogState,
  maliceFeaturesForMonster,
  openNewSiblingMonster,
  openShareDialog,
  saveHomebrewMonster,
  shareDialogState,
  state,
  toast,
} from "../../store.ts";
import type {
  EdgeState,
  HomebrewMonster,
  Monster,
  MonsterFeature,
  PowerRollResult,
} from "../../types.ts";
import { CloseIcon, PlusIcon, RedoIcon, ShareIcon, TrashIcon, UndoIcon } from "../Icons.tsx";
import { type PreviewRollController } from "../Statblock.tsx";
import { PersistentMaliceFeaturePreview } from "../combat/MaliceDock.tsx";
import { OnPageEditor, type PageNote } from "./OnPageEditor.tsx";
import {
  browseEverything,
  browseTo,
  type BrowserState,
  StatblockBrowser,
} from "./StatblockBrowser.tsx";
import { FACING_QUERY, FacingDock, useMediaQuery } from "./StatblockReader.tsx";
import { StartFromMenu } from "./StartFromMenu.tsx";

type ConfirmAction = "discard" | "delete" | "share-dirty" | "sibling-dirty";

function stripFeatures(features: readonly MonsterFeature[]): MonsterFeature[] {
  return features.map((f) => stripCompendiumLinksFromFeature(structuredClone(f)));
}

function draftRecoveryKey(mode: string, id: string): string {
  // Use a single recovery slot for `"create"` mode since new monsters get a fresh
  // UUID on every open; `"edit"` mode stays keyed by the existing monster's ID.
  return mode === "create" ? "mm:homebrew-draft:create" : `mm:homebrew-draft:${mode}:${id}`;
}

function readRecoveryDraft(key: string): HomebrewMonster | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeHomebrewMonster(parsed);
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeRecoveryDraft(key: string, draft: HomebrewMonster): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // ignore quota errors
  }
}

function clearRecoveryDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

export function HomebrewStudio() {
  const studio = homebrewStudioState.value;
  if (!studio) return null;
  return <HomebrewStudioInner key={studio.draft.id} studio={studio} />;
}

function HomebrewStudioInner({
  studio,
}: {
  studio: NonNullable<typeof homebrewStudioState.value>;
}) {
  const storageKey = draftRecoveryKey(studio.mode, studio.draft.id);

  const [initialState] = useState(() => {
    const cleaned: HomebrewMonster = {
      ...structuredClone(studio.draft),
      features: stripFeatures(studio.draft.features),
    };
    const cleanedJson = JSON.stringify(cleaned);
    const saved = readRecoveryDraft(storageKey);
    const hasRecovery = saved !== null && JSON.stringify(saved) !== cleanedJson;
    const startsManual = studio.mode === "edit" || Boolean(studio.draft.origin?.sourceId);
    const snapshot: StudioSnapshot = {
      draft: cleaned,
      manualStats: startsManual,
      manualAbilities: startsManual,
      copiedSourceNames: studio.draft.origin?.sourceName ? [studio.draft.origin.sourceName] : [],
      syncedName: studio.draft.name.trim(),
    };
    return { snapshot, cleanedJson, recovery: hasRecovery ? saved : null };
  });

  const [history, setHistory] = useState<StudioHistory>(() =>
    createStudioHistory(initialState.snapshot),
  );
  const [nameError, setNameError] = useState("");
  const [recoveryDraft, setRecoveryDraft] = useState<HomebrewMonster | null>(initialState.recovery);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [studioRolls, setStudioRolls] = useState<Map<string, PowerRollResult>>(() => new Map());
  // A statblock opened to read before copying from it: beside the page when
  // the screen has room, after it otherwise.
  const [browsing, setBrowsing] = useState(false);
  const [browser, setBrowser] = useState<BrowserState>(browseEverything);
  const wide = useMediaQuery(FACING_QUERY);
  const sheetRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const mountedRef = useRef(true);
  const activeStudioToastRef = useRef(false);

  const { draft, copiedSourceNames } = history.present;
  const dirty = useMemo(
    () => JSON.stringify(draft) !== initialState.cleanedJson,
    [draft, initialState.cleanedJson],
  );
  const canUndo = canUndoStudio(history);
  const canRedo = canRedoStudio(history);
  const undoLabel = studioUndoLabel(history);
  const redoLabel = studioRedoLabel(history);

  useModalFocusTrap(frameRef);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Debounced localStorage draft autosave while dirty; pause while recovery banner
  // is still awaiting Restore/Dismiss so we don't overwrite the saved recovery draft.
  useEffect(() => {
    if (recoveryDraft) return;
    if (!dirty) {
      clearRecoveryDraft(storageKey);
      return;
    }
    const timer = window.setTimeout(() => {
      writeRecoveryDraft(storageKey, draft);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, storageKey, recoveryDraft]);

  useEffect(() => {
    document.body.classList.add("studio-open");
    // A new monster starts on its name: the slot takes typing straight away.
    if (studio.mode === "create") {
      sheetRef.current
        ?.querySelector<HTMLElement>(".hb-pg-name .hb-pg-slot")
        ?.focus({ preventScroll: true });
    }
    return () => document.body.classList.remove("studio-open");
  }, [studio.mode]);

  const showStudioToast = (message: string, action?: { label: string; onClick: () => void }) => {
    activeStudioToastRef.current = true;
    toast(message, action ? { action } : undefined);
  };

  const commitSnapshot = (
    buildNext: (cur: StudioSnapshot) => StudioSnapshot,
    meta: StudioStepMeta,
  ): string | null => {
    const curHistory = historyRef.current;
    const nextSnapshot = buildNext(curHistory.present);
    const { history: nextHistory, stepId } = commitStudioEdit(curHistory, nextSnapshot, meta);
    if (nextHistory === curHistory) return null;
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    setConfirmAction(null);
    return stepId;
  };

  const commitDraft = (
    fn: (prev: HomebrewMonster) => HomebrewMonster,
    meta: StudioStepMeta,
    extra?: Partial<Omit<StudioSnapshot, "draft">>,
  ): string | null =>
    commitSnapshot(
      (cur) => ({
        ...cur,
        ...extra,
        draft: fn(cur.draft),
      }),
      meta,
    );

  const updateView = (patch: Partial<Pick<StudioSnapshot, "syncedName" | "copiedSourceNames">>) => {
    const curHistory = historyRef.current;
    const nextHistory = updateStudioView(curHistory, patch);
    if (nextHistory === curHistory) return;
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  };

  const undoLast = (expectedStepId?: string) => {
    if (!mountedRef.current) return;
    const curHistory = historyRef.current;
    const { history: nextHistory, undone } = undoStudio(curHistory, expectedStepId);
    if (!undone) {
      if (!expectedStepId) showStudioToast("Nothing to undo");
      return;
    }
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    setConfirmAction(null);
    if (nextHistory.present.draft.name.trim()) setNameError("");
    showStudioToast(`Undone: ${undone.label}`, {
      label: "Redo",
      onClick: () => redoLast(undone.id),
    });
  };

  const redoLast = (expectedStepId?: string) => {
    if (!mountedRef.current) return;
    const curHistory = historyRef.current;
    const { history: nextHistory, redone } = redoStudio(curHistory, expectedStepId);
    if (!redone) {
      if (!expectedStepId) showStudioToast("Nothing to redo");
      return;
    }
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    setConfirmAction(null);
    if (nextHistory.present.draft.name.trim()) setNameError("");
    showStudioToast(`Redone: ${redone.label}`, {
      label: "Undo",
      onClick: () => undoLast(redone.id),
    });
  };

  const closeWithoutSaving = () => {
    if (activeStudioToastRef.current) {
      activeStudioToastRef.current = false;
      dismissToast();
    }
    clearRecoveryDraft(storageKey);
    closeHomebrewStudio();
  };

  const attemptClose = () => {
    if (dirty && confirmAction !== "discard") {
      setConfirmAction("discard");
      return;
    }
    closeWithoutSaving();
  };

  const baseline = useMemo(
    () => baselineMonsterStats(draft.level, draft.organization, draft.role),
    [draft.level, draft.organization, draft.role],
  );

  const statsMatchBaseline =
    draft.ev === baseline.ev &&
    draft.stamina === baseline.stamina &&
    draft.freeStrike === baseline.freeStrike &&
    draft.speed === baseline.speed &&
    draft.stability === baseline.stability &&
    draft.size === baseline.size &&
    (draft.turnsPerRound ?? 1) === baseline.turnsPerRound &&
    draft.chars.M === baseline.chars.M &&
    draft.chars.A === baseline.chars.A &&
    draft.chars.R === baseline.chars.R &&
    draft.chars.I === baseline.chars.I &&
    draft.chars.P === baseline.chars.P;

  const applyBaseline = (target: HomebrewMonster): HomebrewMonster => {
    const b = baselineMonsterStats(target.level, target.organization, target.role);
    const next: HomebrewMonster = {
      ...target,
      ev: b.ev,
      stamina: b.stamina,
      freeStrike: b.freeStrike,
      speed: b.speed,
      stability: b.stability,
      size: b.size,
      chars: b.chars,
      withCaptain:
        target.organization.toLowerCase() === "minion"
          ? target.withCaptain || "+2 damage bonus to strikes"
          : target.withCaptain,
    };
    if (b.turnsPerRound > 1) next.turnsPerRound = b.turnsPerRound;
    else delete next.turnsPerRound;
    return next;
  };

  const changeIdentityMath = (
    patch: Partial<Pick<HomebrewMonster, "level" | "organization" | "role">>,
    meta: StudioStepMeta,
    toastMsg?: string,
  ) => {
    const stepId = commitSnapshot((cur) => {
      let nextDraft = { ...cur.draft, ...patch };
      if (
        nextDraft.level === cur.draft.level &&
        nextDraft.organization === cur.draft.organization &&
        nextDraft.role === cur.draft.role
      ) {
        return cur;
      }
      if (!cur.manualStats) nextDraft = applyBaseline(nextDraft);
      if (!cur.manualAbilities) {
        const starters = stripFeatures(
          buildRoleStarterFeatures(
            nextDraft.level,
            nextDraft.organization,
            nextDraft.role,
            nextDraft.chars,
            compendiumGlossary.value,
          ),
        );
        nextDraft = { ...nextDraft, features: starters };
      }
      return { ...cur, draft: nextDraft };
    }, meta);
    if (stepId && toastMsg) {
      showStudioToast(toastMsg, {
        label: "Undo",
        onClick: () => undoLast(stepId),
      });
    }
  };

  const glossary = compendiumGlossary.value;

  const linkedFeaturesForOutput = useMemo(
    () => draft.features.map((f) => autoLinkFeature(f, glossary).feature),
    [draft.features, glossary],
  );

  const previewMonster = useMemo(
    () => homebrewToMonster({ ...draft, features: linkedFeaturesForOutput }),
    [draft, linkedFeaturesForOutput],
  );
  const sanityNotes = useMemo(() => analyzeMonsterSanity(draft), [draft]);

  // What the On-the-page view writes over: the statblock a fork was taken
  // from, as it was when the studio opened, or the book's baseline math for
  // this level, organization and role when there is no source statblock.
  const forkPrint =
    studio.mode === "create" && studio.draft.origin?.sourceId ? initialState.snapshot.draft : null;
  const printDraft = useMemo<HomebrewMonster>(
    () =>
      forkPrint ?? {
        ...applyBaseline(draft),
        name: "",
        keywords: [],
        movement: "",
        immunities: [],
        weaknesses: [],
        features: draft.features,
      },
    [forkPrint, draft],
  );
  const printMonster = useMemo(
    () =>
      homebrewToMonster({
        ...printDraft,
        features: printDraft.features.map((f) => autoLinkFeature(f, glossary).feature),
      }),
    [printDraft, glossary],
  );

  const previewRoll: PreviewRollController = {
    results: studioRolls,
    onRollFeature: (featureIndex, effectIndex, edge) => {
      const eff = previewMonster.features[featureIndex]?.effects?.[effectIndex];
      const res = makePowerRoll(eff?.roll ?? "Power Roll", previewMonster, edge ?? "normal");
      const key = `${previewMonster.id}|${featureIndex}|${effectIndex}`;
      setStudioRolls((prev) => {
        const next = new Map(prev);
        next.set(key, res);
        return next;
      });
    },
    onRollChar: (charKey: CharacteristicKey, edge?: EdgeState) => {
      const res = makeCharacteristicRoll(previewMonster, charKey, edge ?? "normal");
      const prefix = `${previewMonster.id}|char|`;
      setStudioRolls((prev) => {
        const next = new Map(prev);
        for (const existingKey of next.keys()) {
          if (existingKey.startsWith(prefix)) next.delete(existingKey);
        }
        next.set(`${prefix}${charKey}`, res);
        return next;
      });
    },
  };

  const mergeSourceNames = (existing: readonly string[], incoming: readonly string[]): string[] => {
    const result = [...existing];
    for (const raw of incoming) {
      const clean = raw.trim();
      if (clean && !result.some((n) => n.toLowerCase() === clean.toLowerCase())) {
        result.push(clean);
      }
    }
    return result;
  };

  const allCustomMalice = state.value.homebrewMalice;
  const attachedMaliceSet = new Set(draft.maliceIds ?? []);
  const previewMalice = useMemo(() => {
    const fromMonster = maliceFeaturesForMonster(previewMonster);
    const byId = new Map(fromMonster.map((f) => [f.id, f]));
    for (const cm of allCustomMalice) {
      if (attachedMaliceSet.has(cm.id)) {
        const feat = homebrewToMaliceFeature(cm);
        byId.set(feat.id, feat);
      }
    }
    return [...byId.values()].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }, [previewMonster, allCustomMalice, draft.maliceIds]);

  const keywordOptions = useMemo(
    () => mergeKeywordSuggestions(facetOptions.value.keywords),
    [facetOptions.value.keywords],
  );
  const defenseOptions = useMemo(() => defenseSuggestions(draft.level), [draft.level]);
  const refEncounters = studio.mode === "edit" ? encountersUsingHomebrewMonster(draft.id) : [];

  const applyCommittedNameToFeatures = (
    features: readonly MonsterFeature[],
    nextNameRaw: string,
    prevSyncedName: string,
    sourceNames: readonly string[],
  ): { features: MonsterFeature[]; count: number; fromName: string } => {
    const nextName = nextNameRaw.trim();
    if (nextName.length < 2) return { features: [...features], count: 0, fromName: "" };
    const candidates: string[] = [];
    const pushCandidate = (candidate: string) => {
      const clean = candidate.trim();
      if (clean.length < 3) return;
      if (clean.toLowerCase() === nextName.toLowerCase()) return;
      if (!candidates.some((c) => c.toLowerCase() === clean.toLowerCase())) {
        candidates.push(clean);
      }
    };
    pushCandidate(prevSyncedName);
    for (const src of sourceNames) pushCandidate(src);
    if (!candidates.length) return { features: [...features], count: 0, fromName: "" };

    let total = 0;
    let firstFrom = "";
    const updated = features.map((feat) => {
      let cur = feat;
      for (const oldName of candidates) {
        const res = replaceMonsterNameInFeature(cur, oldName, nextName);
        if (res.count > 0) {
          if (!firstFrom) firstFrom = oldName;
          total += res.count;
          cur = res.feature;
        }
      }
      return cur;
    });
    return { features: updated, count: total, fromName: firstFrom };
  };

  const commitNameSync = (nextNameRaw: string) => {
    const nextName = nextNameRaw.trim();
    if (!nextName) return;
    const cur = historyRef.current.present;
    const {
      features: updated,
      count,
      fromName,
    } = applyCommittedNameToFeatures(
      cur.draft.features,
      nextName,
      cur.syncedName,
      cur.copiedSourceNames,
    );
    if (count > 0) {
      const stepId = commitSnapshot(
        (snap) => ({
          ...snap,
          draft: { ...snap.draft, features: updated },
          syncedName: nextName,
        }),
        { label: "Sync name in abilities" },
      );
      if (stepId) {
        showStudioToast(`Updated “${fromName}” → “${nextName}” in ability text (${count})`, {
          label: "Undo",
          onClick: () => undoLast(stepId),
        });
      }
    } else if (cur.syncedName !== nextName) {
      updateView({ syncedName: nextName });
    }
  };

  const handleSave = (addToEnc = false): boolean => {
    // Commit any active field (e.g. IntInput clamping on blur) before reading draft.
    if (
      document.activeElement instanceof HTMLInputElement &&
      sheetRef.current?.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
    const cur = historyRef.current.present;
    const trimmed = cur.draft.name.trim();
    if (!trimmed) {
      setConfirmAction(null);
      setNameError("Give this monster a name before saving.");
      requestAnimationFrame(() => {
        const slot = sheetRef.current?.querySelector<HTMLElement>(".hb-pg-name .hb-pg-slot");
        slot?.scrollIntoView({ behavior: "smooth", block: "center" });
        slot?.focus({ preventScroll: true });
      });
      return false;
    }
    setNameError("");
    const { features: syncedFeatures, count } = applyCommittedNameToFeatures(
      cur.draft.features,
      trimmed,
      cur.syncedName,
      cur.copiedSourceNames,
    );
    const finalFeatures = (count > 0 ? syncedFeatures : cur.draft.features).map(
      (f) => autoLinkFeature(f, compendiumGlossary.value).feature,
    );
    activeStudioToastRef.current = false;
    clearRecoveryDraft(storageKey);
    saveHomebrewMonster(
      { ...cur.draft, name: trimmed, features: finalFeatures },
      { addToEncounter: addToEnc },
    );
    return true;
  };

  // Auto-focus first action when an in-world confirmation bar opens
  useEffect(() => {
    if (confirmAction) confirmCancelRef.current?.focus();
  }, [confirmAction]);

  // Global keyboard shortcuts (bubble phase so nested popovers, comboboxes,
  // GlyphPicker, EdgeMenu, and RulePreview handle Escape first).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (customMaliceEditorState.value || shareDialogState.value || importDialogState.value)
        return;
      if (event.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (confirmAction) {
          setConfirmAction(null);
          return;
        }
        if (browsing) {
          closeSource();
          return;
        }
        attemptClose();
        return;
      }

      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "s") {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleSave(false);
        return;
      }

      const isUndoKey =
        (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "z";
      const isRedoKey =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        ((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey));

      if (isUndoKey || isRedoKey) {
        const target = event.target as HTMLElement | null;
        const isTextInput =
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLInputElement &&
            target.type !== "checkbox" &&
            target.type !== "radio" &&
            target.type !== "button");
        // Let right-pane search boxes use native text undo/redo without undoing monster edits.
        if (isTextInput && target?.closest(".hb-start, .hb-browse")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (isRedoKey) redoLast();
        else undoLast();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, confirmAction, browsing]);

  const addTemplate = (kind: AbilityTemplateKind, name?: string) => {
    const cur = historyRef.current.present;
    const created = makeAbilityTemplate(kind, cur.draft);
    if (name?.trim()) created.name = name.trim();
    commitSnapshot(
      (snap) => ({
        ...snap,
        draft: { ...snap.draft, features: [...snap.draft.features, created] },
        manualAbilities: true,
      }),
      { label: `Add ${created.name || kind}` },
    );
    return cur.draft.features.length;
  };

  const abilityActions = (index: number, feature: MonsterFeature) => ({
    onChange: (next: MonsterFeature, meta: StudioStepMeta) => {
      commitDraft(
        (prev) => ({
          ...prev,
          features: prev.features.map((item, i) => (i === index ? next : item)),
        }),
        meta,
        { manualAbilities: true },
      );
    },
    onMove: (delta: -1 | 1) => {
      const target = index + delta;
      if (target < 0 || target >= draft.features.length) return;
      const movedName = feature.name?.trim() || "ability";
      commitSnapshot(
        (snap) => {
          const nextFeatures = [...snap.draft.features];
          const [movedFeat] = nextFeatures.splice(index, 1);
          if (movedFeat) nextFeatures.splice(target, 0, movedFeat);
          return {
            ...snap,
            draft: { ...snap.draft, features: nextFeatures },
            manualAbilities: true,
          };
        },
        { label: `Move ${movedName} ${delta < 0 ? "up" : "down"}` },
      );
    },
    onDuplicate: () => {
      const dupName = feature.name?.trim() || "ability";
      commitSnapshot(
        (snap) => {
          const nextFeatures = [...snap.draft.features];
          const dup = structuredClone(snap.draft.features[index] ?? feature);
          if (/villain\s*action\s*\d+/i.test(String(dup.cost ?? ""))) {
            dup.cost = `Villain Action ${nextVillainActionNumber(snap.draft.features)}`;
          }
          nextFeatures.splice(index + 1, 0, dup);
          return {
            ...snap,
            draft: { ...snap.draft, features: nextFeatures },
            manualAbilities: true,
          };
        },
        { label: `Duplicate ${dupName}` },
      );
    },
    onRemove: () => {
      const removedName = feature.name?.trim() || "ability";
      const stepId = commitSnapshot(
        (snap) => ({
          ...snap,
          draft: {
            ...snap.draft,
            features: snap.draft.features.filter((_, i) => i !== index),
          },
          manualAbilities: true,
        }),
        { label: `Remove ${removedName}` },
      );
      if (stepId) {
        showStudioToast(`Removed ${removedName}`, {
          label: "Undo",
          onClick: () => undoLast(stepId),
        });
      }
    },
  });

  const resetToRoleKit = () => {
    const cur = historyRef.current.present;
    const starters = stripFeatures(
      buildRoleStarterFeatures(
        cur.draft.level,
        cur.draft.organization,
        cur.draft.role,
        cur.draft.chars,
        compendiumGlossary.value,
      ),
    );
    const stepId = commitSnapshot(
      (snap) => ({
        ...snap,
        draft: { ...snap.draft, features: starters },
        manualAbilities: false,
      }),
      { label: "Reset to role kit" },
    );
    if (stepId) {
      showStudioToast(`Loaded ${cur.draft.role || cur.draft.organization} starter kit`, {
        label: "Undo",
        onClick: () => undoLast(stepId),
      });
    }
  };

  const toggleAttachedMalice = (maliceId: string, maliceName: string) => {
    const currentlyAttached = (historyRef.current.present.draft.maliceIds ?? []).includes(maliceId);
    commitDraft(
      (prev) => {
        const current = prev.maliceIds ?? [];
        const next = current.includes(maliceId)
          ? current.filter((id) => id !== maliceId)
          : [...current, maliceId];
        return { ...prev, maliceIds: next };
      },
      { label: currentlyAttached ? `Detach ${maliceName}` : `Attach ${maliceName}` },
    );
  };

  const staleSourceNames = useMemo(() => {
    const target = draft.name.trim();
    if (!target) return [];
    return copiedSourceNames.filter(
      (src) =>
        src.toLowerCase() !== target.toLowerCase() && featureListMentionsName(draft.features, src),
    );
  }, [copiedSourceNames, draft.name, draft.features]);

  const handleReplaceSourceName = (sourceName: string) => {
    const cur = historyRef.current.present;
    const target = cur.draft.name.trim();
    if (!target) return;
    let total = 0;
    const replaced = cur.draft.features.map((f) => {
      const res = replaceMonsterNameInFeature(f, sourceName, target);
      total += res.count;
      return res.feature;
    });
    if (total === 0) return;
    const stepId = commitDraft((prev) => ({ ...prev, features: replaced }), {
      label: `Replace “${sourceName}”`,
    });
    if (stepId) {
      showStudioToast(`Replaced “${sourceName}” with “${target}” (${total})`, {
        label: "Undo",
        onClick: () => undoLast(stepId),
      });
    }
  };

  const handleCopyWholeBlock = (source: Monster) => {
    const cur = historyRef.current.present;
    setStudioRolls(new Map());
    const targetName = cur.draft.name.trim();
    const clonedFeatures = stripFeatures(source.features).map((feat) =>
      targetName ? replaceMonsterNameInFeature(feat, source.name, targetName).feature : feat,
    );
    const stepId = commitSnapshot(
      (snap) => {
        const prev = snap.draft;
        const next: HomebrewMonster = {
          ...prev,
          name: prev.name.trim() ? prev.name : `${source.name} (Custom)`,
          level: source.level,
          organization: source.organization === "—" ? prev.organization : source.organization,
          role: source.role,
          ev: source.evLabel || String(source.ev),
          size: String(source.size === "—" ? "1M" : source.size),
          speed: String(source.speed === "—" ? "5" : source.speed),
          movement: source.movement,
          stamina: source.stamina,
          stability: String(source.stability === "—" ? "0" : source.stability),
          freeStrike: String(source.freeStrike === "—" ? "2" : source.freeStrike),
          immunities: [...source.immunities],
          weaknesses: [...source.weaknesses],
          withCaptain: source.withCaptain,
          chars: { ...source.chars },
          keywords: [...source.keywords],
          familyPath: source.familyPath,
          features: clonedFeatures,
          origin: prev.origin?.sourceId
            ? prev.origin
            : {
                kind: source.isHomebrew ? "local" : "official-fork",
                sourceId: source.homebrewId ?? basePath(source.path),
                sourceName: source.name,
                ...(prev.origin?.author ? { author: prev.origin.author } : {}),
              },
        };
        if (source.turnsPerRound > 1) next.turnsPerRound = source.turnsPerRound;
        else delete next.turnsPerRound;
        return {
          ...snap,
          draft: next,
          manualStats: true,
          manualAbilities: true,
          copiedSourceNames: mergeSourceNames(snap.copiedSourceNames, [source.name]),
        };
      },
      { label: `Copy ${source.name}` },
    );
    if (nameError) setNameError("");
    if (stepId) {
      showStudioToast(`Copied statblock from ${source.name}`, {
        label: "Undo",
        onClick: () => undoLast(stepId),
      });
    }
  };

  const handleCopyStatsOnly = (source: Monster) => {
    const stepId = commitDraft(
      (prev) => {
        const next: HomebrewMonster = {
          ...prev,
          organization: source.organization === "—" ? prev.organization : source.organization,
          role: source.role,
          ev: source.evLabel || String(source.ev),
          size: String(source.size === "—" ? "1M" : source.size),
          speed: String(source.speed === "—" ? "5" : source.speed),
          movement: source.movement,
          stamina: source.stamina,
          stability: String(source.stability === "—" ? "0" : source.stability),
          freeStrike: String(source.freeStrike === "—" ? "2" : source.freeStrike),
          immunities: [...source.immunities],
          weaknesses: [...source.weaknesses],
          withCaptain: source.withCaptain,
          chars: { ...source.chars },
        };
        if (source.turnsPerRound > 1) next.turnsPerRound = source.turnsPerRound;
        else delete next.turnsPerRound;
        return next;
      },
      { label: `Copy stats from ${source.name}` },
      { manualStats: true },
    );
    if (stepId) {
      showStudioToast(`Copied stats from ${source.name}`, {
        label: "Undo",
        onClick: () => undoLast(stepId),
      });
    }
  };

  const handleCopyFeature = (feature: MonsterFeature, sourceName: string) => {
    const cur = historyRef.current.present;
    const targetName = cur.draft.name.trim();
    const stripped = stripCompendiumLinksFromFeature(feature);
    const { feature: finalFeature, count: renamedCount } = targetName
      ? replaceMonsterNameInFeature(stripped, sourceName, targetName)
      : { feature: stripped, count: 0 };
    const stepId = commitSnapshot(
      (snap) => ({
        ...snap,
        draft: { ...snap.draft, features: [...snap.draft.features, finalFeature] },
        manualAbilities: true,
        copiedSourceNames: mergeSourceNames(snap.copiedSourceNames, [sourceName]),
        syncedName: targetName || snap.syncedName,
      }),
      { label: `Add ${feature.name || "ability"}` },
    );
    if (stepId) {
      showStudioToast(
        renamedCount > 0
          ? `Added ${feature.name || "ability"} (updated ${sourceName} → ${targetName})`
          : `Added ${feature.name || "ability"} from ${sourceName}`,
        { label: "Undo", onClick: () => undoLast(stepId) },
      );
    }
  };

  const applyBookBaseline = () => {
    const cur = historyRef.current.present.draft;
    const stepId = commitDraft(
      (prev) => applyBaseline(prev),
      { label: "Apply baseline" },
      { manualStats: false },
    );
    if (stepId) {
      showStudioToast(`Applied Level ${cur.level} ${cur.organization} ${cur.role} baseline`, {
        label: "Undo",
        onClick: () => undoLast(stepId),
      });
    }
  };

  const fixSanityNote = (note: SanityNote) => {
    const stepId = commitSnapshot(
      (snap) => {
        const fixed = applySanityFix(snap.draft, note.fixKind!, glossary);
        const cleaned = stripFeatures(fixed.features);
        const touchesAbilities =
          note.fixKind === "add-villain-actions" || note.fixKind === "add-signature";
        return {
          ...snap,
          draft: { ...fixed, features: cleaned },
          manualAbilities: touchesAbilities ? true : snap.manualAbilities,
        };
      },
      { label: note.fixLabel! },
    );
    if (stepId) {
      showStudioToast(note.fixLabel!, {
        label: "Undo",
        onClick: () => undoLast(stepId),
      });
    }
  };

  const malicePreviewNode = previewMalice.length ? (
    <section class="preview-family-malice" aria-label="Attached Malice preview">
      <header class="preview-malice-head">
        <span class="ds-glyph malice-skull" aria-hidden="true">
          d
        </span>
        <h3>Encounter Malice</h3>
        <span>
          {previewMalice.length} {previewMalice.length === 1 ? "feature" : "features"}
        </span>
      </header>
      <div class="preview-malice-list">
        {previewMalice.map((feature) => (
          <PersistentMaliceFeaturePreview
            key={feature.id}
            feature={feature}
            scope="studio-attached"
          />
        ))}
      </div>
    </section>
  ) : null;

  const haveNames = useMemo(
    () => new Set(draft.features.map((f) => (f.name?.trim() || "ability").toLowerCase())),
    [draft.features],
  );

  const showBrowser = (next: BrowserState) => {
    setBrowser(next);
    setBrowsing(true);
    if (!wide) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          frameRef.current
            ?.querySelector(".hb-src")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        ),
      );
    }
  };
  const openSource = (path: string, query?: string) => showBrowser(browseTo(path, query));
  // Browsing picks up where it was left, unless a search says where to start.
  const browseAll = (query: string) =>
    showBrowser(
      query.trim()
        ? { ...browseTo("", query), path: null }
        : browsing
          ? browser
          : { ...browser, path: null },
    );

  const closeSource = () => {
    const inside = frameRef.current?.querySelector(".hb-src")?.contains(document.activeElement);
    setBrowsing(false);
    if (inside) frameRef.current?.querySelector<HTMLElement>(".hb-start-btn")?.focus();
  };

  const browserNode = (
    <StatblockBrowser
      draftId={draft.id}
      level={draft.level}
      familyPath={draft.familyPath}
      have={haveNames}
      state={browser}
      onState={setBrowser}
      onClose={closeSource}
      onTakeAll={(monster) => {
        handleCopyWholeBlock(monster);
        closeSource();
      }}
      onTakeStats={handleCopyStatsOnly}
      onAdd={handleCopyFeature}
      onUseFamily={(slug, label) => {
        const stepId = commitDraft((prev) => ({ ...prev, familyPath: slug }), {
          label: `Malice family: ${label}`,
        });
        if (stepId) {
          showStudioToast(`Inherited ${label} Malice`, {
            label: "Undo",
            onClick: () => undoLast(stepId),
          });
        }
      }}
    />
  );

  const pageNotes: PageNote[] = [
    ...staleSourceNames.map((srcName) => ({
      id: `rename:${srcName}`,
      message: `Ability text still mentions “${srcName}”.`,
      fixLabel: `Replace with “${draft.name.trim()}”`,
      onFix: () => handleReplaceSourceName(srcName),
    })),
    ...sanityNotes.map((note) => ({
      id: note.id,
      message: note.message,
      fixLabel: note.fixKind ? note.fixLabel : undefined,
      onFix: note.fixKind ? () => fixSanityNote(note) : undefined,
    })),
  ];

  return (
    <div
      class="hb-studio-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hb-studio-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) attemptClose();
      }}
    >
      <div ref={frameRef} class="hb-studio-frame">
        <div ref={sheetRef} class="hb-studio-sheet is-page">
          <header class="hb-studio-head">
            <div class="hb-studio-title-wrap">
              <div class="hb-studio-title-line">
                <h2 id="hb-studio-title">
                  {studio.mode === "edit"
                    ? "Edit homebrew monster"
                    : draft.origin?.sourceName
                      ? `New from ${draft.origin.sourceName}`
                      : "New homebrew monster"}
                </h2>
                {dirty ? <span class="hb-dirty-pill">Unsaved</span> : null}
              </div>
              {studio.mode === "edit" && draft.origin?.sourceName ? (
                <span class="hb-studio-origin">
                  {draft.origin.kind === "official-fork" ? "Forked from " : "Based on "}
                  {draft.origin.sourceName}
                </span>
              ) : null}
            </div>

            <StartFromMenu
              draftId={draft.id}
              identity={`Level ${draft.level} ${draft.organization}${draft.role ? ` ${draft.role}` : ""}`}
              statsMatchBook={statsMatchBaseline}
              onBookStats={applyBookBaseline}
              onRoleKit={resetToRoleKit}
              onStatblock={(monster, statsOnly) =>
                statsOnly ? handleCopyStatsOnly(monster) : handleCopyWholeBlock(monster)
              }
              onOpen={openSource}
              onBrowse={browseAll}
            />

            <div class="hb-studio-head-actions">
              {studioRolls.size > 0 ? (
                <button
                  type="button"
                  class="text-button hb-clear-rolls"
                  title="Clear the test rolls on the page"
                  onClick={() => setStudioRolls(new Map())}
                >
                  Clear rolls
                </button>
              ) : null}
              <div class="history-controls" role="group" aria-label="Undo and redo">
                <button
                  type="button"
                  class="icon-button"
                  disabled={!canUndo}
                  aria-label={canUndo ? `Undo: ${undoLabel}` : "Nothing to undo"}
                  title={canUndo ? `Undo: ${undoLabel} (Ctrl/Cmd+Z)` : "Nothing to undo"}
                  onClick={() => undoLast()}
                >
                  <UndoIcon />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  disabled={!canRedo}
                  aria-label={canRedo ? `Redo: ${redoLabel}` : "Nothing to redo"}
                  title={canRedo ? `Redo: ${redoLabel} (Ctrl/Cmd+Shift+Z)` : "Nothing to redo"}
                  onClick={() => redoLast()}
                >
                  <RedoIcon />
                </button>
              </div>
              {studio.mode === "edit" ? (
                <button
                  type="button"
                  class="secondary compact-button"
                  title="Share link or export JSON"
                  onClick={() => {
                    if (dirty) setConfirmAction("share-dirty");
                    else openShareDialog("monster", draft.id);
                  }}
                >
                  <ShareIcon />
                  <span>Share</span>
                </button>
              ) : null}
              <button
                type="button"
                class="icon-button"
                aria-label="Close studio"
                title="Close (Esc)"
                onClick={attemptClose}
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          {recoveryDraft ? (
            <div class="hb-recovery-bar" role="status">
              <span>Recovered an unsaved draft from earlier.</span>
              <div class="hb-confirm-bar-actions">
                <button
                  type="button"
                  class="secondary compact-button"
                  onClick={() => {
                    const cleaned: HomebrewMonster = {
                      ...recoveryDraft,
                      features: stripFeatures(recoveryDraft.features),
                    };
                    const stepId = commitSnapshot(
                      (snap) => ({
                        ...snap,
                        draft: cleaned,
                        manualStats: true,
                        manualAbilities: true,
                        syncedName: cleaned.name.trim(),
                      }),
                      { label: "Restore unsaved draft" },
                    );
                    setRecoveryDraft(null);
                    if (stepId) {
                      showStudioToast("Restored unsaved draft", {
                        label: "Undo",
                        onClick: () => undoLast(stepId),
                      });
                    }
                  }}
                >
                  Restore draft
                </button>
                <button
                  type="button"
                  class="text-button"
                  onClick={() => {
                    clearRecoveryDraft(storageKey);
                    setRecoveryDraft(null);
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          {confirmAction ? (
            <div class="hb-confirm-bar" role="alert">
              <span>
                {confirmAction === "discard"
                  ? `Discard unsaved changes to ${draft.name.trim() ? `“${draft.name.trim()}”` : "this monster"}?`
                  : confirmAction === "delete"
                    ? refEncounters.length
                      ? `Delete “${draft.name}”? It will be removed from ${refEncounters.length} ${refEncounters.length === 1 ? "encounter" : "encounters"} (Undo available).`
                      : `Delete “${draft.name}”? (Undo available)`
                    : confirmAction === "share-dirty"
                      ? "You have unsaved edits. Save before sharing so your link includes them?"
                      : "Save your current edits before creating a sibling monster in this family?"}
              </span>
              <div class="hb-confirm-bar-actions">
                <button
                  ref={confirmCancelRef}
                  type="button"
                  class="secondary compact-button"
                  onClick={() => setConfirmAction(null)}
                >
                  {confirmAction === "discard" ? "Keep editing" : "Cancel"}
                </button>
                {confirmAction === "discard" ? (
                  <button
                    type="button"
                    class="secondary compact-button hb-danger-btn"
                    onClick={closeWithoutSaving}
                  >
                    Discard changes
                  </button>
                ) : confirmAction === "delete" ? (
                  <button
                    type="button"
                    class="secondary compact-button hb-danger-btn"
                    onClick={() => {
                      clearRecoveryDraft(storageKey);
                      deleteHomebrewMonster(draft.id);
                    }}
                  >
                    Delete monster
                  </button>
                ) : confirmAction === "share-dirty" ? (
                  <>
                    <button
                      type="button"
                      class="secondary compact-button"
                      onClick={() => {
                        setConfirmAction(null);
                        openShareDialog("monster", draft.id);
                      }}
                    >
                      Share last saved
                    </button>
                    <button
                      type="button"
                      class="primary compact-button"
                      onClick={() => {
                        const savedId = draft.id;
                        if (handleSave(false)) {
                          openShareDialog("monster", savedId);
                        }
                      }}
                    >
                      Save &amp; share
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    class="primary compact-button"
                    onClick={() => {
                      const savedId = draft.id;
                      if (handleSave(false)) {
                        openNewSiblingMonster(savedId);
                      }
                    }}
                  >
                    Save &amp; continue
                  </button>
                )}
              </div>
            </div>
          ) : null}

          <div class="hb-studio-body hb-studio-body-page">
            <OnPageEditor
              draft={draft}
              monster={previewMonster}
              printMonster={printMonster}
              printDraft={printDraft}
              forked={forkPrint !== null}
              baseline={baseline}
              previewRoll={previewRoll}
              glossary={glossary}
              keywordOptions={keywordOptions}
              defenseOptions={defenseOptions}
              notes={pageNotes}
              malice={{
                onSetFamily: (slug, label) =>
                  commitDraft((prev) => ({ ...prev, familyPath: slug }), {
                    label: slug ? `Malice family: ${label}` : "No Malice family",
                  }),
                onToggle: toggleAttachedMalice,
                onAttach: (id) =>
                  commitDraft(
                    (prev) => ({
                      ...prev,
                      maliceIds: [...new Set([...(prev.maliceIds ?? []), id])],
                    }),
                    { label: "Attach custom Malice" },
                  ),
                preview: malicePreviewNode,
              }}
              abilityActions={(index) => {
                const feature = draft.features[index];
                if (!feature) return null;
                return abilityActions(index, feature);
              }}
              onField={(patch, label, stats) =>
                commitDraft(
                  (prev) => {
                    const next = { ...prev, ...patch };
                    if ((next.turnsPerRound ?? 1) <= 1) delete next.turnsPerRound;
                    return next;
                  },
                  { label },
                  stats ? { manualStats: true } : undefined,
                )
              }
              onIdentity={(patch) => {
                const [key, value] = Object.entries(patch)[0] ?? [];
                if (!key) return;
                const label =
                  key === "level"
                    ? `Level ${String(value)}`
                    : key === "organization"
                      ? `Organization: ${String(value)}`
                      : `Role: ${String(value) || "None / Boss"}`;
                changeIdentityMath(patch, { label });
              }}
              nameError={nameError}
              showHint={studio.mode === "create" && !studio.draft.origin?.sourceId && !dirty}
              onNameCommit={(name) => {
                if (nameError && name.trim()) setNameError("");
                commitNameSync(name);
              }}
              onAuthor={(author) =>
                commitDraft(
                  (prev) => {
                    const nextOrigin = { ...(prev.origin ?? { kind: "local" as const }) };
                    if (author.trim()) nextOrigin.author = author.trim();
                    else delete nextOrigin.author;
                    return { ...prev, origin: nextOrigin };
                  },
                  { label: "Edit author" },
                )
              }
              onAddAbility={addTemplate}
              onCopyAbility={handleCopyFeature}
              onOpenSource={openSource}
              facing={!wide && browsing ? browserNode : undefined}
            />
          </div>

          <footer class="hb-studio-foot">
            <div class="hb-studio-foot-left">
              {studio.mode === "edit" ? (
                <>
                  <button
                    type="button"
                    class="secondary compact-button hb-danger-btn"
                    onClick={() => setConfirmAction("delete")}
                  >
                    <TrashIcon />
                    <span>Delete</span>
                  </button>
                  <button
                    type="button"
                    class="secondary compact-button"
                    title="Create a sibling monster inheriting this family, keywords, defenses & custom Malice"
                    onClick={() => {
                      if (dirty) {
                        setConfirmAction("sibling-dirty");
                        return;
                      }
                      openNewSiblingMonster(draft.id);
                    }}
                  >
                    <PlusIcon />
                    <span>New in family</span>
                  </button>
                </>
              ) : null}
            </div>
            <div class="hb-studio-foot-right">
              <button type="button" class="secondary" onClick={attemptClose}>
                Cancel
              </button>
              {studio.allowAddOnSave ? (
                <button
                  type="button"
                  class="secondary hb-save-lib-btn"
                  onClick={() => handleSave(false)}
                >
                  Save to library
                </button>
              ) : null}
              <button
                type="button"
                class="primary"
                onClick={() => handleSave(studio.allowAddOnSave)}
              >
                {studio.allowAddOnSave ? "Save & add to encounter" : "Save changes"}
              </button>
            </div>
          </footer>
        </div>
        {wide ? <FacingDock open={browsing}>{browserNode}</FacingDock> : null}
      </div>
    </div>
  );
}
