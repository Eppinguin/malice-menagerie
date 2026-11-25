import "./homebrew.css";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useModalFocusTrap } from "../../lib/modalFocus.ts";
import {
  buildEncounterBundle,
  buildMaliceBundle,
  buildMonsterBundle,
  buildNegotiationBundle,
  buildShareUrl,
  downloadBundleJson,
  SHARE_URL_MAX_LENGTH,
  type ShareBundleV1,
} from "../../lib/share.ts";
import {
  closeShareDialog,
  hasCombatProgress,
  shareDialogState,
  state,
  toast,
} from "../../store.ts";
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon, LinkIcon } from "../Icons.tsx";

export function ShareDialog() {
  const target = shareDialogState.value;
  if (!target) return null;
  return <ShareDialogInner key={`${target.kind}:${target.id}`} target={target} />;
}

function ShareDialogInner({ target }: { target: NonNullable<typeof shareDialogState.value> }) {
  const [includeProgress, setIncludeProgress] = useState(false);
  const [linkState, setLinkState] = useState<{
    url: string;
    length: number;
    tooLong: boolean;
  } | null>(null);
  const [linkError, setLinkError] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const copyLinkTimer = useRef<number | null>(null);
  const copyJsonTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyLinkTimer.current !== null) window.clearTimeout(copyLinkTimer.current);
      if (copyJsonTimer.current !== null) window.clearTimeout(copyJsonTimer.current);
    };
  }, []);

  useModalFocusTrap(sheetRef, { isSubdialog: true });

  const app = state.value;

  const resolved = useMemo<{
    title: string;
    canIncludeProgress: boolean;
    progressLabel: string;
    bundle: ShareBundleV1 | null;
  }>(() => {
    if (target.kind === "monster") {
      const monster = app.homebrewMonsters.find((m) => m.id === target.id);
      if (!monster)
        return { title: "", canIncludeProgress: false, progressLabel: "", bundle: null };
      return {
        title: monster.name,
        canIncludeProgress: false,
        progressLabel: "",
        bundle: buildMonsterBundle(monster, app.homebrewMalice),
      };
    }
    if (target.kind === "malice") {
      const mal = app.homebrewMalice.find((m) => m.id === target.id);
      if (!mal) return { title: "", canIncludeProgress: false, progressLabel: "", bundle: null };
      return {
        title: mal.name,
        canIncludeProgress: false,
        progressLabel: "",
        bundle: buildMaliceBundle(mal),
      };
    }
    if (target.kind === "encounter") {
      const enc = app.encounters.find((e) => e.id === target.id);
      if (!enc) return { title: "", canIncludeProgress: false, progressLabel: "", bundle: null };
      const inProgress = hasCombatProgress(enc);
      return {
        title: enc.name,
        canIncludeProgress: inProgress,
        progressLabel: `Include live combat progress (Round ${enc.combat.round}, Stamina & conditions)`,
        bundle: buildEncounterBundle(enc, app.homebrewMonsters, app.homebrewMalice, {
          includeCombat: includeProgress,
        }),
      };
    }
    const neg = app.negotiations.find((n) => n.id === target.id);
    if (!neg) return { title: "", canIncludeProgress: false, progressLabel: "", bundle: null };
    const hasLog = neg.log.length > 0;
    return {
      title: neg.name || "Untitled NPC",
      canIncludeProgress: hasLog,
      progressLabel: `Include live track progress & argument log (${neg.log.length} entries)`,
      bundle: buildNegotiationBundle(neg, { includeProgress }),
    };
  }, [target.kind, target.id, app, includeProgress]);

  useEffect(() => {
    let cancelled = false;
    setCopiedLink(false);
    setLinkError("");
    if (!resolved.bundle) {
      setLinkState(null);
      return;
    }
    void buildShareUrl(resolved.bundle)
      .then((res) => {
        if (!cancelled) setLinkState({ url: res.url, length: res.length, tooLong: res.tooLong });
      })
      .catch(() => {
        if (!cancelled) {
          setLinkState(null);
          setLinkError("Could not encode a share link. Download the .json file instead.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resolved.bundle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeShareDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!resolved.bundle) closeShareDialog();
  }, [resolved.bundle]);

  if (!resolved.bundle) {
    return null;
  }

  const bundle = resolved.bundle;
  const manifestParts: string[] = [];
  if (bundle.encounters?.length) manifestParts.push("1 encounter");
  if (bundle.negotiations?.length) manifestParts.push("1 negotiation");
  if (bundle.monsters?.length) {
    manifestParts.push(
      `${bundle.monsters.length} homebrew ${bundle.monsters.length === 1 ? "monster" : "monsters"}`,
    );
  }
  if (bundle.malice?.length) {
    manifestParts.push(`${bundle.malice.length} custom Malice`);
  }

  const copyLink = async () => {
    if (!linkState || linkState.tooLong) return;
    try {
      await navigator.clipboard.writeText(linkState.url);
      setCopiedLink(true);
      toast("Share link copied to clipboard");
      if (copyLinkTimer.current !== null) window.clearTimeout(copyLinkTimer.current);
      copyLinkTimer.current = window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast("Could not copy automatically — select the link below.");
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setCopiedJson(true);
      toast("JSON copied to clipboard");
      if (copyJsonTimer.current !== null) window.clearTimeout(copyJsonTimer.current);
      copyJsonTimer.current = window.setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      toast("Could not access clipboard.");
    }
  };

  return (
    <div
      class="hb-modal-overlay hb-subdialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hb-share-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeShareDialog();
      }}
    >
      <div ref={sheetRef} class="hb-modal-sheet hb-share-sheet">
        <header class="hb-modal-head">
          <div>
            <h2 id="hb-share-title">Share &amp; export</h2>
            <p class="hb-modal-sub">{resolved.title}</p>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close share dialog"
            onClick={closeShareDialog}
          >
            <CloseIcon />
          </button>
        </header>

        <div class="hb-modal-body">
          <div class="hb-share-manifest">
            <span class="hb-field-label">Bundle contents</span>
            <p>{manifestParts.join(" · ")}</p>
            {target.kind === "encounter" ? (
              <small>
                Official SteelCompendium monsters stay lightweight links; homebrew monsters and
                custom Malice used by this encounter are bundled automatically.
              </small>
            ) : null}
          </div>

          {resolved.canIncludeProgress ? (
            <label class="hb-check-row">
              <input
                type="checkbox"
                checked={includeProgress}
                onChange={(e) => setIncludeProgress(e.currentTarget.checked)}
              />
              <span>{resolved.progressLabel}</span>
            </label>
          ) : null}

          <div class="hb-share-link-box">
            <div class="hb-share-link-head">
              <span class="hb-field-label">Encoded link</span>
              {linkState ? (
                <span class={`hb-share-size ${linkState.tooLong ? "over" : ""}`}>
                  {linkState.length.toLocaleString()} chars
                </span>
              ) : null}
            </div>

            {linkError ? (
              <p class="hb-share-warn" role="status">
                {linkError}
              </p>
            ) : linkState?.tooLong ? (
              <p class="hb-share-warn" role="status">
                This bundle exceeds the safe link length ({SHARE_URL_MAX_LENGTH.toLocaleString()}{" "}
                chars) for Discord and browsers. Download the <code>.json</code> file instead
                {includeProgress ? ", or uncheck live progress above." : "."}
              </p>
            ) : (
              <>
                <input
                  class="hb-share-url-input"
                  readOnly
                  aria-label="Encoded share URL"
                  value={linkState?.url ?? "Encoding…"}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  class="primary wide"
                  disabled={!linkState}
                  onClick={() => void copyLink()}
                >
                  {copiedLink ? <CheckIcon /> : <LinkIcon />}
                  <span>{copiedLink ? "Copied link" : "Copy share link"}</span>
                </button>
              </>
            )}
          </div>

          <div class="hb-share-file-row">
            <button
              type="button"
              class={linkState?.tooLong ? "primary wide" : "secondary"}
              onClick={() => {
                downloadBundleJson(bundle, resolved.title);
                toast(`Downloaded ${resolved.title}.json`);
              }}
            >
              <DownloadIcon />
              <span>Download .json</span>
            </button>
            <button type="button" class="secondary" onClick={() => void copyJson()}>
              {copiedJson ? <CheckIcon /> : <CopyIcon />}
              <span>{copiedJson ? "Copied JSON" : "Copy JSON"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
