import { useEffect, useState } from "preact/hooks";
import { catalogByPath, maliceLoading, monsterAt, monstersVersion } from "../data.ts";
import {
  addToEncounter,
  closePreview,
  customMaliceEditorState,
  duplicateHomebrewMonster,
  homebrewStudioState,
  importDialogState,
  maliceFeaturesForMonster,
  openCloneMonster,
  openEditHomebrewMonster,
  openNewSiblingMonster,
  openShareDialog,
  previewPath,
  qtyFor,
  setPreviewLevel,
  shareDialogState,
} from "../store.ts";
import { isHomebrewMonsterPath } from "../lib/id.ts";
import { basePath } from "../lib/levels.ts";
import { familyLabel } from "../lib/text.ts";
import { LaneHeader, StatblockBody } from "./Statblock.tsx";
import { PersistentMaliceFeaturePreview } from "./combat/MaliceDock.tsx";
import { QtyControl } from "./QtyControl.tsx";
import { CloseIcon, CopyIcon, PencilIcon, PlusIcon, ShareIcon } from "./Icons.tsx";

function FamilyMalicePreview({ monster }: { monster: NonNullable<ReturnType<typeof monsterAt>> }) {
  if (maliceLoading.value && !monster.customMaliceIds?.length) return null;
  const features = maliceFeaturesForMonster(monster);
  if (!features.length) return null;

  return (
    <section class="preview-family-malice" aria-label="Family Malice features">
      <header class="preview-malice-head">
        <span class="ds-glyph malice-skull" aria-hidden="true">
          d
        </span>
        <h3>
          {monster.familyPath ? `${familyLabel(monster.familyPath)} Malice` : "Encounter Malice"}
        </h3>
        <span>
          {features.length} {features.length === 1 ? "feature" : "features"}
        </span>
      </header>
      <div class="preview-malice-list">
        {features.map((feature) => (
          <PersistentMaliceFeaturePreview
            key={feature.id}
            feature={feature}
            scope={`library/${monster.path}`}
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
      if (event.defaultPrevented) return;
      if (
        homebrewStudioState.value ||
        customMaliceEditorState.value ||
        shareDialogState.value ||
        importDialogState.value
      ) {
        return;
      }
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
    renderedPath &&
    !monster &&
    (isHomebrewMonsterPath(shownPath ?? "") || catalogByPath.get(basePath(shownPath ?? ""))?.error),
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
          <div>
            <h2 class="preview-drawer-title">
              {monster?.isHomebrew ? "Homebrew statblock" : "Statblock preview"}
            </h2>
            {monster?.origin?.sourceName || monster?.origin?.author ? (
              <p class="preview-drawer-origin">
                {monster.origin.sourceName
                  ? `${monster.origin.kind === "official-fork" ? "Forked from" : "From"} ${monster.origin.sourceName}`
                  : ""}
                {monster.origin.sourceName && monster.origin.author ? " · " : ""}
                {monster.origin.author ? `By ${monster.origin.author}` : ""}
              </p>
            ) : null}
          </div>
          <div class="preview-drawer-head-actions">
            {monster ? (
              monster.isHomebrew && monster.homebrewId ? (
                <>
                  <button
                    type="button"
                    class="secondary compact-button"
                    title="Edit homebrew statblock"
                    onClick={() => openEditHomebrewMonster(monster.homebrewId!)}
                  >
                    <PencilIcon />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    title="Create another monster in this family"
                    aria-label={`New monster in ${monster.name}'s family`}
                    onClick={() => openNewSiblingMonster(monster.homebrewId!)}
                  >
                    <PlusIcon />
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    title="Duplicate homebrew monster"
                    aria-label={`Duplicate ${monster.name}`}
                    onClick={() => duplicateHomebrewMonster(monster.homebrewId!)}
                  >
                    <CopyIcon />
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    title="Share link or export JSON"
                    aria-label={`Share ${monster.name}`}
                    onClick={() => openShareDialog("monster", monster.homebrewId!)}
                  >
                    <ShareIcon />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  class="secondary compact-button"
                  title="Fork this official statblock into an editable homebrew monster"
                  onClick={() => openCloneMonster(monster.path)}
                >
                  <CopyIcon />
                  <span>Clone &amp; edit</span>
                </button>
              )
            ) : null}
            <button
              class="icon-button"
              onClick={closePreview}
              title="Close preview"
              aria-label="Close preview"
            >
              <CloseIcon />
            </button>
          </div>
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
