import { useEffect, useState } from "preact/hooks";
import { catalogByPath, maliceLoading, monsterAt, monstersVersion } from "../data.ts";
import {
  addToEncounter,
  closePreview,
  maliceFeaturesForMonster,
  previewPath,
  qtyFor,
  setPreviewLevel,
} from "../store.ts";
import { basePath } from "../lib/levels.ts";
import { familyLabel } from "../lib/text.ts";
import { LaneHeader, StatblockBody } from "./Statblock.tsx";
import { MaliceFeaturePreview } from "./combat/MaliceDock.tsx";
import { QtyControl } from "./QtyControl.tsx";
import { CloseIcon } from "./Icons.tsx";

function FamilyMalicePreview({ monster }: { monster: NonNullable<ReturnType<typeof monsterAt>> }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setOpenIds(new Set());
  }, [monster.path]);

  if (maliceLoading.value) return null;
  const features = maliceFeaturesForMonster(monster);
  if (!features.length) return null;

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section class="preview-family-malice" aria-label="Family Malice features">
      <header class="preview-malice-head">
        <span class="ds-glyph malice-skull" aria-hidden="true">
          d
        </span>
        <h3>{familyLabel(monster.familyPath)} Malice</h3>
        <span>
          {features.length} {features.length === 1 ? "feature" : "features"}
        </span>
      </header>
      <div class="preview-malice-list">
        {features.map((feature) => (
          <MaliceFeaturePreview
            key={feature.id}
            feature={feature}
            expanded={openIds.has(feature.id)}
            onToggle={() => toggle(feature.id)}
          />
        ))}
      </div>
    </section>
  );
}

export function PreviewDrawer() {
  const path = previewPath.value;
  void monstersVersion.value; // subscribe: re-render once the previewed statblock loads

  // The drawer content lags the signal so the slide-out transition can play:
  // renderedPath keeps the last path mounted while `open` animates to false.
  const [renderedPath, setRenderedPath] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (path) {
      setRenderedPath(path);
      document.body.classList.add("preview-open");
      const raf = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    setOpen(false);
    document.body.classList.remove("preview-open");
    const timer = setTimeout(() => setRenderedPath(null), 200);
    return () => clearTimeout(timer);
  }, [path]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && previewPath.value) closePreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const hidden = !renderedPath;
  // The live path while open, so a level change shows at once (the lagging
  // one would flash the old level and shut the level editor); the last one
  // only while the drawer slides out.
  const shownPath = path ?? renderedPath;
  const monster = shownPath ? monsterAt(shownPath) : undefined;
  const failed = Boolean(
    renderedPath && !monster && catalogByPath.get(basePath(shownPath ?? ""))?.error,
  );

  return (
    <>
      <div
        class={`preview-backdrop ${open ? "open" : ""}`}
        hidden={hidden}
        onClick={closePreview}
      />
      <aside
        class={`preview-drawer ${open ? "open" : ""}`}
        hidden={hidden}
        aria-hidden={open ? "false" : "true"}
        role="dialog"
        aria-modal="true"
        aria-label="Monster statblock preview"
      >
        <header class="preview-drawer-head">
          <h2 class="preview-drawer-title">Statblock preview</h2>
          <button
            class="icon-button"
            onClick={closePreview}
            title="Close preview"
            aria-label="Close preview"
          >
            <CloseIcon />
          </button>
        </header>
        <div class="preview-drawer-body">
          {monster ? (
            <section class="preview-statblock">
              <LaneHeader monster={monster} scope="preview" onLevel={setPreviewLevel} />
              <StatblockBody monster={monster} interactive={false} />
              <FamilyMalicePreview monster={monster} />
            </section>
          ) : failed ? (
            <div class="empty-state">Could not load this statblock.</div>
          ) : renderedPath ? (
            <div class="lane-loading">Loading statblock…</div>
          ) : null}
        </div>
        <footer class="preview-drawer-foot">
          {monster ? (
            <>
              <QtyControl path={monster.path} />
              <button
                class="primary wide"
                onClick={() => void addToEncounter(monster.path, qtyFor(monster.path))}
              >
                Add to encounter
              </button>
            </>
          ) : null}
        </footer>
      </aside>
    </>
  );
}
