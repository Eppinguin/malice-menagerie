import { describe, expect, it } from "vitest";
import {
  MERGE_MS,
  navigate,
  packHistory,
  record,
  redo,
  startHistory,
  undo,
  unpackHistory,
} from "./history.ts";

describe("session undo/redo history", () => {
  it("records steps, undoes, redoes, and clears future on a new edit", () => {
    let h = startHistory({ count: 1 });
    h = record(h, { count: 2 }, { id: "s1", label: "Count 2" }, 1000);
    h = record(h, { count: 3 }, { id: "s2", label: "Count 3" }, 2000);
    expect(h.present.count).toBe(3);
    expect(h.past).toHaveLength(2);

    h = undo(h);
    expect(h.present.count).toBe(2);
    expect(h.future).toHaveLength(1);

    h = redo(h);
    expect(h.present.count).toBe(3);
    expect(h.future).toHaveLength(0);

    h = undo(h);
    h = record(h, { count: 9 }, { id: "s3", label: "Count 9" }, 3000);
    expect(h.present.count).toBe(9);
    expect(h.future).toHaveLength(0);
  });

  it("coalesces rapid same-key edits within MERGE_MS and breaks after navigate/undo", () => {
    let h = startHistory({ malice: 5 });
    h = record(h, { malice: 6 }, { id: "m1", label: "+1 Malice", key: "malice" }, 1000);
    h = record(
      h,
      { malice: 7 },
      { id: "m2", label: "+2 Malice", key: "malice" },
      1000 + MERGE_MS - 10,
    );
    expect(h.past).toHaveLength(1);
    expect(h.past[0]?.before.malice).toBe(5);
    expect(h.present.malice).toBe(7);

    // Navigating closes the open merge window without pushing a step.
    h = navigate(h, { malice: 7 });
    h = record(h, { malice: 8 }, { id: "m3", label: "+1 Malice", key: "malice" }, 1000 + MERGE_MS);
    expect(h.past).toHaveLength(2);
  });

  it("packs and unpacks history only when stored state matches", () => {
    let h = startHistory({ n: 1 });
    h = record(h, { n: 2 }, { id: "s1", label: "Two" }, 100);
    const packed = packHistory(h);
    const rawStored = JSON.stringify(h.present);
    const restored = unpackHistory(packed, rawStored, (v) => v as { n: number });
    expect(restored?.present).toEqual({ n: 2 });
    expect(restored?.past).toHaveLength(1);
    expect(restored?.past[0]?.before).toEqual({ n: 1 });

    // Mismatched localStorage discards stale session history.
    expect(unpackHistory(packed, JSON.stringify({ n: 99 }), (v) => v as { n: number })).toBeNull();
  });
});
