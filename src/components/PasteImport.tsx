import { useEffect, useMemo, useState } from "preact/hooks";
import { homebrewCatalogByPath } from "../data.ts";
import { homebrewMonsterPath } from "../lib/id.ts";
import { isShareLinkText } from "../lib/importSniff.ts";
import type {
  ImportConflictStatus,
  ImportDecision,
  ShareBundleV1,
  ShareBundleKind,
} from "../lib/share.ts";
import {
  addToEncounterInGroup,
  commitImportBundle,
  openPreview,
  reviewImportBundle,
  state,
} from "../store.ts";
import { ImportIcon } from "./Icons.tsx";

type ShareModule = typeof import("../lib/share.ts");

type Parsed =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ok"; bundle: ShareBundleV1; share: ShareModule };

const KIND_LABEL: Record<ShareBundleKind, string> = {
  monster: "homebrew monster",
  malice: "Malice feature",
  encounter: "encounter",
  negotiation: "NPC negotiation",
  pack: "homebrew pack",
};

const STATUS_LABEL: Record<ImportConflictStatus, string> = {
  new: "New",
  identical: "In your library",
  newer: "Newer version",
  older: "Older version",
  modified: "Edited version",
};

const MAX_ROWS = 4;

/**
 * Stands in for library results when the search field holds a pasted share
 * link, share code, or exported JSON. One Enter imports when nothing clashes;
 * anything that would overwrite or fork existing homebrew goes to review.
 */
export function PasteImport({
  text,
  onDone,
  addTo,
}: {
  text: string;
  /** Clears the search field once the paste has been acted on. */
  onDone: () => void;
  /** In combat quick-add: also field an imported monster in this group. */
  addTo?: { groupId: string; groupName: string };
}) {
  const [parsed, setParsed] = useState<Parsed>({ status: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setParsed({ status: "loading" });
    void import("../lib/share.ts").then(async (share) => {
      const result = await share.parseImportInput(text);
      if (!live) return;
      setParsed(
        result.ok
          ? { status: "ok", bundle: result.bundle, share }
          : { status: "error", error: result.error },
      );
    });
    return () => {
      live = false;
    };
  }, [text]);

  const appState = state.value;
  const analysis = useMemo(
    () =>
      parsed.status === "ok" ? parsed.share.analyzeImportBundle(parsed.bundle, appState) : null,
    [parsed, appState],
  );

  const source = isShareLinkText(text) ? "share link" : "pasted JSON";
  const quick = Boolean(addTo);

  if (parsed.status === "loading") {
    return <div class="library-loading">Reading {source}…</div>;
  }

  if (parsed.status === "error" || !analysis) {
    return (
      <div class="source-error paste-import-error" role="alert">
        <strong>Can’t import this {source}.</strong>
        <span>{parsed.status === "error" ? parsed.error : "There’s nothing in it to import."}</span>
        <small class="paste-import-keys">
          <kbd>Esc</kbd> clears the search
        </small>
      </div>
    );
  }

  const { bundle } = parsed;
  const items = analysis.items;
  const conflicts = items.some((item) => item.status !== "new" && item.status !== "identical");
  const allIdentical = items.length > 0 && items.every((item) => item.status === "identical");
  const primaryMonster =
    bundle.kind === "monster"
      ? items.find((item) => item.kind === "monster" && item.id === bundle.primaryId)
      : undefined;
  // Fielding in combat only makes sense for a single shared monster.
  const fieldMonster = addTo && primaryMonster ? primaryMonster : undefined;
  const kindLabel =
    bundle.kind === "pack"
      ? `${items.length} item${items.length === 1 ? "" : "s"}`
      : KIND_LABEL[bundle.kind];
  const rawMonsters = new Map((bundle.monsters ?? []).map((m) => [m.id, m]));

  const review = () => {
    reviewImportBundle(bundle);
    onDone();
  };

  const field = async (monsterId: string) => {
    if (!addTo) return;
    const path = homebrewMonsterPath(monsterId);
    const qty = homebrewCatalogByPath.get(path)?.monster?.defaultQty ?? 1;
    await addToEncounterInGroup(path, Math.max(1, qty), addTo.groupId);
  };

  const run = async (action: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const importAll = async () => {
    const decisions = new Map<string, ImportDecision>(
      items.map((item) => [item.key, item.defaultDecision]),
    );
    const target = await commitImportBundle(bundle, decisions);
    if (fieldMonster && target?.kind === "monster") await field(target.id);
  };

  const group = addTo ? `Group ${addTo.groupName}` : "";
  let primary: { label: string; title: string; onClick: () => void } | null;
  let note = "";
  if (conflicts) {
    primary = { label: "Review", title: "Choose what to update, copy or skip", onClick: review };
    note = "You have another version of this. Review before anything is overwritten.";
  } else if (allIdentical) {
    note = "Already in your library.";
    if (fieldMonster) {
      primary = {
        label: "Add",
        title: `Add ${fieldMonster.name} to ${group}`,
        onClick: () => void run(() => field(fieldMonster.id)),
      };
    } else if (primaryMonster) {
      primary = {
        label: "Show",
        title: `Preview ${primaryMonster.name}`,
        onClick: () => void run(() => openPreview(homebrewMonsterPath(primaryMonster.id))),
      };
    } else {
      primary = null;
    }
  } else {
    primary = fieldMonster
      ? {
          label: "Import & add",
          title: `Import ${fieldMonster.name} and add it to ${group}`,
          onClick: () => void run(importAll),
        }
      : {
          label: "Import",
          title: `Import ${items.length === 1 ? items[0]!.name : `${items.length} items`} into your library`,
          onClick: () => void run(importAll),
        };
  }

  const single = items.length === 1;
  const noteLine = note ? <p class="paste-import-note">{note}</p> : null;
  const actions = (
    <div class="add-controls paste-import-actions">
      {primary?.onClick !== review && !(quick && single) ? (
        <button
          type="button"
          class="text-button"
          title="Choose item by item in the import dialog"
          onClick={review}
        >
          Review…
        </button>
      ) : null}
      {primary ? (
        <button
          type="button"
          class="primary paste-import-primary"
          title={primary.title}
          disabled={busy}
          onClick={primary.onClick}
        >
          {primary.label}
        </button>
      ) : null}
    </div>
  );

  return (
    <div class={`paste-import ${quick ? "paste-import-quick" : ""}`}>
      <div class="library-results-bar paste-import-bar">
        <span role="status">
          <ImportIcon />
          {source === "share link" ? "Share link" : "Pasted JSON"} · {kindLabel}
        </span>
        <span class="paste-import-keys" aria-hidden="true">
          {primary ? (
            <>
              <kbd>Enter</kbd> {primary.label.toLowerCase()}
            </>
          ) : null}
          <kbd>Esc</kbd> clear
        </span>
      </div>
      {items.slice(0, MAX_ROWS).map((item) => {
        const raw = item.kind === "monster" ? rawMonsters.get(item.id) : undefined;
        const status =
          item.status === "new" || item.status === "identical" ? null : (
            <span class="tag paste-import-status">{STATUS_LABEL[item.status]}</span>
          );
        if (quick) {
          return (
            <div class="qa-row paste-import-row" key={item.key}>
              <div class="qa-row-main">
                <span class="qa-row-title">
                  <strong>{item.name}</strong>
                  {raw ? <span class="tag">{raw.organization}</span> : null}
                  {status}
                </span>
                <span class="qa-row-meta">
                  {raw ? (
                    <>
                      <span>Lv {raw.level}</span>
                      {raw.role ? <span>{raw.role}</span> : null}
                      <span>EV {raw.ev}</span>
                    </>
                  ) : (
                    <span>{item.subtitle}</span>
                  )}
                </span>
                {single ? noteLine : null}
              </div>
              {single ? actions : null}
            </div>
          );
        }
        return (
          <article class="monster-card paste-import-row" key={item.key}>
            <div class="monster-main">
              <div class="monster-title-row">
                <h3>{item.name}</h3>
                {raw ? <span class="tag">{raw.organization}</span> : null}
                {item.kind === "monster" ? <span class="tag tag-homebrew">Homebrew</span> : null}
                {status}
              </div>
              <div class="monster-meta">
                {raw ? (
                  <>
                    <span>
                      Level <b>{raw.level}</b>
                    </span>
                    <span>{raw.role || "—"}</span>
                    <span>
                      EV <b>{raw.ev}</b>
                    </span>
                    {raw.size ? <span>{raw.size}</span> : null}
                  </>
                ) : (
                  <span>{item.subtitle}</span>
                )}
              </div>
              {single ? noteLine : null}
            </div>
            {single ? actions : null}
          </article>
        );
      })}
      {items.length > MAX_ROWS ? (
        <p class="paste-import-more">and {items.length - MAX_ROWS} more</p>
      ) : null}
      {single ? null : (
        <div class="paste-import-footer">
          {noteLine}
          {actions}
        </div>
      )}
    </div>
  );
}

/** Shared search-field keys while it holds a paste: Enter acts, Esc clears. */
export function pasteImportKeyDown(
  event: KeyboardEvent,
  scope: HTMLElement | null,
  clear: () => void,
): boolean {
  if (event.key === "Enter") {
    const button = scope?.querySelector<HTMLButtonElement>(".paste-import-primary:not(:disabled)");
    if (button) {
      event.preventDefault();
      button.click();
    }
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    clear();
    return true;
  }
  return event.key === "ArrowDown";
}
