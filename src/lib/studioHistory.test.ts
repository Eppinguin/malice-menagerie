import { describe, expect, it } from "vitest";
import { blankHomebrewMonster } from "./homebrew.ts";
import { MERGE_MS } from "./history.ts";
import {
  canRedoStudio,
  canUndoStudio,
  closeStudioMergeWindow,
  commitStudioEdit,
  createStudioHistory,
  redoStudio,
  type StudioSnapshot,
  studioRedoLabel,
  studioUndoLabel,
  undoStudio,
  updateStudioView,
} from "./studioHistory.ts";

function makeSnapshot(overrides?: Partial<StudioSnapshot>): StudioSnapshot {
  const draft = blankHomebrewMonster(1, "Platoon", "Brute");
  draft.name = "Ashbone";
  return {
    draft,
    manualStats: false,
    manualAbilities: false,
    copiedSourceNames: [],
    syncedName: "Ashbone",
    ...overrides,
  };
}

describe("HomebrewStudio undo/redo history", () => {
  it("records edits, undoes, redoes, and clears redo stack on new edits", () => {
    const initial = makeSnapshot();
    let h = createStudioHistory(initial);
    expect(canUndoStudio(h)).toBe(false);
    expect(canRedoStudio(h)).toBe(false);

    const step1 = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, stamina: 50 }, manualStats: true },
      { label: "Edit Stamina" },
      1000,
    );
    h = step1.history;
    expect(step1.stepId).toBeTruthy();
    expect(canUndoStudio(h)).toBe(true);
    expect(studioUndoLabel(h)).toBe("Edit Stamina");

    const step2 = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, speed: "7" }, manualStats: true },
      { label: "Edit Speed" },
      2000,
    );
    h = step2.history;
    expect(h.past).toHaveLength(2);
    expect(h.present.draft.stamina).toBe(50);
    expect(h.present.draft.speed).toBe("7");

    const u1 = undoStudio(h);
    h = u1.history;
    expect(u1.undone?.label).toBe("Edit Speed");
    expect(h.present.draft.speed).toBe(initial.draft.speed);
    expect(h.present.draft.stamina).toBe(50);
    expect(canRedoStudio(h)).toBe(true);
    expect(studioRedoLabel(h)).toBe("Edit Speed");

    const r1 = redoStudio(h);
    h = r1.history;
    expect(r1.redone?.label).toBe("Edit Speed");
    expect(h.present.draft.speed).toBe("7");
    expect(canRedoStudio(h)).toBe(false);

    // Undoing and making a new edit clears the redo branch.
    h = undoStudio(h).history;
    expect(canRedoStudio(h)).toBe(true);
    h = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, stability: "3" } },
      { label: "Edit Stability" },
      3000,
    ).history;
    expect(canRedoStudio(h)).toBe(false);
    expect(h.present.draft.stability).toBe("3");
  });

  it("coalesces rapid same-key edits and splits across blur, pause, or different fields", () => {
    let h = createStudioHistory(makeSnapshot());

    h = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, name: "Ashbone S" } },
      { label: "Edit name", key: "field:name" },
      1000,
    ).history;
    h = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, name: "Ashbone Stalker" } },
      { label: "Edit name", key: "field:name" },
      1000 + MERGE_MS - 100,
    ).history;
    expect(h.past).toHaveLength(1);
    expect(h.past[0]?.before.draft.name).toBe("Ashbone");
    expect(h.present.draft.name).toBe("Ashbone Stalker");

    // Closing the merge window (e.g. on blur) forces the next edit into a new step.
    h = closeStudioMergeWindow(h);
    h = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, name: "Ashbone Stalker King" } },
      { label: "Edit name", key: "field:name" },
      1000 + MERGE_MS - 50,
    ).history;
    expect(h.past).toHaveLength(2);

    // Waiting past MERGE_MS also starts a new step.
    h = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, name: "Ashbone Stalker King!" } },
      { label: "Edit name", key: "field:name" },
      1000 + MERGE_MS * 3,
    ).history;
    expect(h.past).toHaveLength(3);
  });

  it("skips no-op edits and collapses a coalesced burst that returns to its starting state", () => {
    let h = createStudioHistory(makeSnapshot());

    // Identical edit is ignored.
    const noop = commitStudioEdit(h, { ...h.present }, { label: "No-op" }, 1000);
    expect(noop.stepId).toBeNull();
    expect(noop.history.past).toHaveLength(0);

    // Typing and immediately backspacing back to original collapses the step.
    h = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, name: "Ashbones" } },
      { label: "Edit name", key: "field:name" },
      1000,
    ).history;
    expect(h.past).toHaveLength(1);

    const collapsed = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, name: "Ashbone" } },
      { label: "Edit name", key: "field:name" },
      1200,
    );
    expect(collapsed.stepId).toBeNull();
    expect(collapsed.history.past).toHaveLength(0);
    expect(collapsed.history.present.draft.name).toBe("Ashbone");
  });

  it("preserves redo history across view-only updates like synced-name bookkeeping", () => {
    let h = createStudioHistory(makeSnapshot());
    h = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, stamina: 77 } },
      { label: "Edit Stamina" },
      1000,
    ).history;
    h = undoStudio(h).history;
    expect(canRedoStudio(h)).toBe(true);

    h = updateStudioView(h, { syncedName: "Renamed" });
    expect(h.present.syncedName).toBe("Renamed");
    expect(canRedoStudio(h)).toBe(true);
    expect(h.past).toHaveLength(0);
  });

  it("guards step-bound toast undo/redo against stale clicks", () => {
    let h = createStudioHistory(makeSnapshot());
    const s1 = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, stamina: 60 } },
      { label: "Step 1" },
      1000,
    );
    h = s1.history;
    const s2 = commitStudioEdit(
      h,
      { ...h.present, draft: { ...h.present.draft, stamina: 70 } },
      { label: "Step 2" },
      2000,
    );
    h = s2.history;

    // Stale toast for Step 1 must not undo Step 2.
    const staleUndo = undoStudio(h, s1.stepId!);
    expect(staleUndo.undone).toBeNull();
    expect(staleUndo.history.present.draft.stamina).toBe(70);

    // Matching toast for Step 2 succeeds.
    const validUndo = undoStudio(h, s2.stepId!);
    expect(validUndo.undone?.id).toBe(s2.stepId);
    h = validUndo.history;
    expect(h.present.draft.stamina).toBe(60);

    // Stale redo id does not redo Step 2.
    const staleRedo = redoStudio(h, s1.stepId!);
    expect(staleRedo.redone).toBeNull();

    // Matching redo id redoes Step 2.
    const validRedo = redoStudio(h, s2.stepId!);
    expect(validRedo.redone?.id).toBe(s2.stepId);
    expect(validRedo.history.present.draft.stamina).toBe(70);
  });

  it("deep-clones snapshots so later mutations cannot corrupt past or future entries", () => {
    const initial = makeSnapshot();
    let h = createStudioHistory(initial);
    initial.draft.keywords.push("MutatedOutside");
    expect(h.present.draft.keywords).not.toContain("MutatedOutside");

    const nextDraft = structuredClone(h.present.draft);
    nextDraft.keywords = ["Undead"];
    h = commitStudioEdit(h, { ...h.present, draft: nextDraft }, { label: "Edit keywords" }).history;
    nextDraft.keywords.push("MutatedAfterCommit");
    expect(h.present.draft.keywords).toEqual(["Undead"]);
  });
});
