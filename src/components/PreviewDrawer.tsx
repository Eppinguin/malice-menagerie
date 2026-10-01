import { useEffect, useState } from "preact/hooks";
import { catalogByPath, monsterCache, monstersVersion } from "../data.ts";
import { addToEncounter, closePreview, previewPath, qtyFor } from "../store.ts";
import { LaneHeader, StatblockBody } from "./Statblock.tsx";
import { QtyControl } from "./QtyControl.tsx";
import { CloseIcon } from "./Icons.tsx";

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
  const monster = renderedPath ? monsterCache.get(renderedPath) : undefined;
  const failed = Boolean(renderedPath && !monster && catalogByPath.get(renderedPath)?.error);

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
              <LaneHeader monster={monster} />
              <StatblockBody monster={monster} interactive={false} />
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
