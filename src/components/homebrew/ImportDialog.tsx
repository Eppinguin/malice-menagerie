import "./homebrew.css";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { homebrewToMaliceFeature, homebrewToMonster } from "../../lib/homebrew.ts";
import { useModalFocusTrap } from "../../lib/modalFocus.ts";
import {
  analyzeImportBundle,
  type AnalyzedImportItem,
  type ImportConflictStatus,
  type ImportDecision,
  MAX_IMPORT_BYTES,
  parseImportInput,
} from "../../lib/share.ts";
import { closeImportDialog, commitImportBundle, importDialogState, state } from "../../store.ts";
import { CloseIcon, EyeIcon, ImportIcon } from "../Icons.tsx";
import { LaneHeader, StatblockBody } from "../Statblock.tsx";
import { MaliceFeaturePreview } from "../combat/MaliceDock.tsx";

const STATUS_LABELS: Record<ImportConflictStatus, string> = {
  new: "New",
  identical: "Already in library (identical)",
  newer: "Newer revision",
  older: "Older revision",
  modified: "Different version exists",
};

export function ImportDialog() {
  const modal = importDialogState.value;
  if (!modal) return null;
  return <ImportDialogInner modal={modal} />;
}

function ImportDialogInner({ modal }: { modal: NonNullable<typeof importDialogState.value> }) {
  const [pasteText, setPasteText] = useState("");
  const [localError, setLocalError] = useState(modal.error);
  const [decisions, setDecisions] = useState<Map<string, ImportDecision>>(() => new Map());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap(sheetRef);

  useEffect(() => {
    setLocalError(modal.error);
  }, [modal.error]);

  const appState = state.value;
  const analysis = useMemo(
    () => (modal.bundle ? analyzeImportBundle(modal.bundle, appState) : null),
    [modal.bundle, appState],
  );

  useEffect(() => {
    if (!analysis) {
      setDecisions(new Map());
      setExpandedKey(null);
      return;
    }
    const next = new Map<string, ImportDecision>();
    for (const item of analysis.items) {
      next.set(item.key, item.defaultDecision);
    }
    setDecisions(next);
  }, [analysis]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeImportDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const inspectText = async (text: string, fallbackName?: string) => {
    const parsed = await parseImportInput(text, fallbackName);
    if (parsed.ok) {
      setLocalError("");
      importDialogState.value = { bundle: parsed.bundle, error: "", fromUrl: modal.fromUrl };
    } else {
      setLocalError(parsed.error);
    }
  };

  const handleFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      setLocalError("This file is too large to import safely (4 MB limit).");
      return;
    }
    try {
      const text = await file.text();
      await inspectText(text, file.name.replace(/\.json$/i, ""));
    } catch {
      setLocalError("Could not read that file.");
    }
  };

  const selectedCount = analysis
    ? analysis.items.filter((item) => (decisions.get(item.key) ?? item.defaultDecision) !== "skip")
        .length
    : 0;

  const renderPreview = (item: AnalyzedImportItem) => {
    if (!modal.bundle) return null;
    if (item.kind === "monster") {
      const raw = modal.bundle.monsters?.find((m) => m.id === item.id);
      if (!raw) return null;
      const monster = homebrewToMonster(raw);
      return (
        <div class="hb-import-statblock">
          <LaneHeader monster={monster} scope="import-preview" />
          <StatblockBody monster={monster} interactive={false} />
        </div>
      );
    }
    if (item.kind === "malice") {
      const raw = modal.bundle.malice?.find((m) => m.id === item.id);
      if (!raw) return null;
      const built = homebrewToMaliceFeature(raw);
      const { homebrewId: _omitId, ...previewRest } = built;
      return (
        <div class="hb-import-malice-preview">
          <MaliceFeaturePreview
            feature={{ ...previewRest, isHomebrew: false }}
            expanded={true}
            onToggle={() => {}}
          />
        </div>
      );
    }
    return null;
  };

  const bundleTitle = (() => {
    if (!modal.bundle) return "Import homebrew, encounters & NPCs";
    if (modal.bundle.kind === "encounter") return "Import shared encounter";
    if (modal.bundle.kind === "monster") return "Import homebrew monster";
    if (modal.bundle.kind === "malice") return "Import custom Malice";
    if (modal.bundle.kind === "negotiation") return "Import negotiation NPC";
    return "Import bundle";
  })();

  const bundleAuthor =
    modal.bundle?.monsters?.find((m) => m.origin?.author)?.origin?.author ??
    modal.bundle?.malice?.find((m) => m.origin?.author)?.origin?.author ??
    modal.bundle?.encounters?.find((e) => e.origin?.author)?.origin?.author ??
    modal.bundle?.negotiations?.find((n) => n.origin?.author)?.origin?.author;

  return (
    <div
      class="hb-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hb-import-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeImportDialog();
      }}
    >
      <div ref={sheetRef} class="hb-modal-sheet hb-import-sheet">
        <header class="hb-modal-head">
          <div>
            <h2 id="hb-import-title">{bundleTitle}</h2>
            {bundleAuthor ? <p class="hb-modal-sub">By {bundleAuthor}</p> : null}
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close import dialog"
            onClick={closeImportDialog}
          >
            <CloseIcon />
          </button>
        </header>

        <div class="hb-modal-body">
          {localError ? (
            <div class="hb-import-error" role="alert">
              <strong>Could not import</strong>
              <p>{localError}</p>
            </div>
          ) : null}

          {!analysis ? (
            <div class="hb-import-entry">
              <div class="hb-import-file-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) void handleFile(file);
                    e.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  class="secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImportIcon />
                  <span>Choose .json file…</span>
                </button>
                <span class="hb-hint">
                  Supports Malice Menagerie exports and SteelCompendium statblock JSON. You can also
                  drop a file anywhere on the page.
                </span>
              </div>

              <label class="hb-field">
                <span>Or paste a share link or JSON</span>
                <textarea
                  rows={5}
                  value={pasteText}
                  placeholder="Paste https://…/#s=1.… or JSON here"
                  onInput={(e) => setPasteText(e.currentTarget.value)}
                />
              </label>
            </div>
          ) : (
            <div class="hb-import-manifest">
              <p class="hb-hint">
                Review what is inside before saving to your library. Existing items matched by ID
                can be updated in place or saved as independent copies.
              </p>

              <ul class="hb-import-list">
                {analysis.items.map((item) => {
                  const decision = decisions.get(item.key) ?? item.defaultDecision;
                  const canPreview = item.kind === "monster" || item.kind === "malice";
                  const expanded = expandedKey === item.key;
                  const isExisting = item.status !== "new";
                  return (
                    <li
                      key={item.key}
                      class={`hb-import-row ${decision === "skip" ? "skipped" : ""}`}
                    >
                      <div class="hb-import-row-main">
                        <div class="hb-import-row-copy">
                          <div class="hb-import-row-title">
                            <span class="tag">{item.kind}</span>
                            <strong>{item.name}</strong>
                            <span class={`hb-status-pill status-${item.status}`}>
                              {STATUS_LABELS[item.status]}
                            </span>
                          </div>
                          <small>{item.subtitle}</small>
                        </div>

                        <div class="hb-import-row-controls">
                          {canPreview ? (
                            <button
                              type="button"
                              class={`icon-button ${expanded ? "active" : ""}`}
                              title={expanded ? "Hide preview" : "Preview"}
                              aria-label={`Preview ${item.name}`}
                              aria-expanded={expanded}
                              onClick={() => setExpandedKey(expanded ? null : item.key)}
                            >
                              <EyeIcon />
                            </button>
                          ) : null}

                          {isExisting ? (
                            <select
                              aria-label={`Import action for ${item.name}`}
                              value={decision}
                              onChange={(e) => {
                                const val = e.currentTarget.value as ImportDecision;
                                setDecisions((prev) => {
                                  const next = new Map(prev);
                                  next.set(item.key, val);
                                  return next;
                                });
                              }}
                            >
                              <option value="update">Update existing</option>
                              <option value="copy">Save as copy</option>
                              <option value="skip">Skip</option>
                            </select>
                          ) : (
                            <select
                              aria-label={`Import action for ${item.name}`}
                              value={decision}
                              onChange={(e) => {
                                const val = e.currentTarget.value as ImportDecision;
                                setDecisions((prev) => {
                                  const next = new Map(prev);
                                  next.set(item.key, val);
                                  return next;
                                });
                              }}
                            >
                              <option value="add">Import</option>
                              <option value="skip">Skip</option>
                            </select>
                          )}
                        </div>
                      </div>

                      {expanded ? renderPreview(item) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {analysis ? (
          <footer class="hb-modal-foot">
            <button
              type="button"
              class="text-button"
              onClick={() => {
                importDialogState.value = { bundle: null, error: "", fromUrl: false };
                setPasteText("");
              }}
            >
              Pick another file
            </button>
            <div class="hb-studio-foot-right">
              <button type="button" class="secondary" onClick={closeImportDialog}>
                Cancel
              </button>
              <button
                type="button"
                class="primary"
                disabled={selectedCount === 0}
                onClick={() => void commitImportBundle(analysis.bundle, decisions)}
              >
                Import {selectedCount} {selectedCount === 1 ? "item" : "items"}
              </button>
            </div>
          </footer>
        ) : (
          <footer class="hb-modal-foot">
            <span />
            <div class="hb-studio-foot-right">
              <button type="button" class="secondary" onClick={closeImportDialog}>
                Cancel
              </button>
              <button
                type="button"
                class="primary"
                disabled={!pasteText.trim()}
                onClick={() => void inspectText(pasteText)}
              >
                Preview import
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
