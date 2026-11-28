import { disclosure } from "../../lib/disclosure.ts";
import { useEffect } from "preact/hooks";
import { maliceLoadStatus } from "../../data.ts";
import { featureText } from "../../lib/malice.ts";
import { plainText, richText } from "../../lib/text.ts";
import {
  activeEncounter,
  addMaliceSelection,
  allRelevantMaliceFeatures,
  ensureMaliceSelection,
  maliceDisclosure,
  lastMaliceRolls,
  maliceSelectionReady,
  openEditCustomMalice,
  openNewCustomMalice,
  openShareDialog,
  relevantMaliceGroups,
  removeMaliceSelection,
  retryMalice,
  rollMaliceFeature,
  sharedRollActive,
  state,
  toggleMaliceLibrary,
  useMaliceFeature,
} from "../../store.ts";
import type { EdgeState, FeatureEffect, MaliceFeature, MaliceGroup } from "../../types.ts";
import { rollPress } from "./EdgeMenu.tsx";
import {
  FeatureGlyph,
  iconGlyph,
  PayMalice,
  RollTally,
  rollSerial,
  TierMark,
} from "../Statblock.tsx";
import { PenLoop } from "../Pen.tsx";
import { CaretIcon, CloseIcon, ExternalIcon, PencilIcon, PlusIcon, ShareIcon } from "../Icons.tsx";

function costLabel(feature: MaliceFeature): string {
  return (feature.costText || String(feature.cost || "—")).replace(/\s*Malice/i, "");
}

function MaliceEffect({
  feature,
  effect,
  effectIndex,
  interactive = true,
}: {
  feature: MaliceFeature;
  effect: FeatureEffect;
  effectIndex: number;
  interactive?: boolean;
}) {
  const tierKeys = (["tier1", "tier2", "tier3"] as const).filter((key) => effect[key]);
  const lastRoll = interactive
    ? lastMaliceRolls.value.get(`${feature.id}|${effectIndex}`)
    : undefined;
  return (
    <div class="malice-effect">
      {effect.effect ? <p dangerouslySetInnerHTML={{ __html: richText(effect.effect) }} /> : null}
      {tierKeys.length ? (
        <div class="malice-roll-line">
          {interactive ? (
            <button
              aria-busy={sharedRollActive.value}
              title={
                sharedRollActive.value
                  ? "Waiting for Connected Dice roll in Owlbear Rodeo…"
                  : "Roll — tap, or hold for edge/bane menu"
              }
              {...rollPress(
                (event) => rollMaliceFeature(feature.id, effectIndex, event),
                (edge: EdgeState) => rollMaliceFeature(feature.id, effectIndex, edge),
              )}
            >
              {sharedRollActive.value ? "Rolling…" : "Roll"}
            </button>
          ) : null}
          <strong>{effect.roll || "Power Roll"}</strong>
          {lastRoll ? <RollTally key={rollSerial(lastRoll)} roll={lastRoll} /> : null}
        </div>
      ) : null}
      {tierKeys.length ? (
        <div class="malice-tiers">
          {tierKeys.map((key, index) => (
            <div
              key={key}
              class={lastRoll?.tier === index + 1 ? "rolled-tier" : ""}
              aria-current={lastRoll?.tier === index + 1 ? "true" : undefined}
            >
              {lastRoll && lastRoll.tier === index + 1 ? (
                <PenLoop key={rollSerial(lastRoll)} seed={rollSerial(lastRoll)} />
              ) : null}
              <TierMark index={index} />
              <span dangerouslySetInnerHTML={{ __html: richText(effect[key]) }} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Read-only collapsible Malice entry used in PreviewDrawer to inspire while browsing. */
export function PersistentMaliceFeaturePreview({
  feature,
  scope,
}: {
  feature: MaliceFeature;
  scope: string;
}) {
  const { open, toggle } = disclosure(`malice-preview/${scope}/${feature.id}`);
  return <MaliceFeaturePreview feature={feature} expanded={open} onToggle={toggle} />;
}

export function MaliceFeaturePreview({
  feature,
  expanded,
  onToggle,
}: {
  feature: MaliceFeature;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = [feature.distance, feature.target].filter(Boolean).join(" · ");
  return (
    <article class={`malice-card malice-card-readonly ${expanded ? "expanded" : "collapsed"}`}>
      <div class="malice-card-head malice-card-head-readonly">
        <span
          class="malice-cost malice-cost-static"
          title={feature.costText || `${feature.cost} Malice`}
        >
          {costLabel(feature)}
        </span>
        <button type="button" class="malice-toggle" aria-expanded={expanded} onClick={onToggle}>
          <strong>
            <FeatureGlyph glyph={iconGlyph(feature.icon)} />
            {feature.name}
            <CaretIcon class="malice-toggle-mark" />
          </strong>
        </button>
        {feature.isHomebrew && feature.homebrewId ? (
          <>
            <button
              type="button"
              class="icon-button"
              title="Edit custom Malice"
              aria-label={`Edit ${feature.name}`}
              onClick={() => openEditCustomMalice(feature.homebrewId!)}
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              class="icon-button"
              title="Share custom Malice"
              aria-label={`Share ${feature.name}`}
              onClick={() => openShareDialog("malice", feature.homebrewId!)}
            >
              <ShareIcon />
            </button>
          </>
        ) : feature.source ? (
          <a
            href={feature.source}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${feature.name} on SteelCompendium`}
            title="Open on SteelCompendium"
          >
            <ExternalIcon />
          </a>
        ) : null}
      </div>
      {expanded ? (
        <div class="malice-card-body">
          {meta ? <div class="malice-meta">{meta}</div> : null}
          <div class="malice-copy">
            {feature.effects.map((effect, effectIndex) => (
              <MaliceEffect
                key={effectIndex}
                feature={feature}
                effect={effect}
                effectIndex={effectIndex}
                interactive={false}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MaliceCard({ feature, interactive }: { feature: MaliceFeature; interactive: boolean }) {
  const { open: expanded, toggle } = maliceDisclosure(feature.id);
  const meta = [feature.distance, feature.target].filter(Boolean).join(" · ");
  return (
    <article class={`malice-card ${expanded ? "expanded" : "collapsed"}`}>
      <div class="malice-card-head">
        {interactive ? (
          <PayMalice
            class="malice-cost"
            cost={feature.cost}
            label={costLabel(feature)}
            name={feature.name}
            onPay={() => useMaliceFeature(feature.id)}
          />
        ) : (
          <span
            class="malice-cost malice-cost-static"
            title={feature.costText || `${feature.cost} Malice`}
          >
            {costLabel(feature)}
          </span>
        )}
        <button class="malice-toggle" aria-expanded={expanded} onClick={toggle}>
          <strong>
            <FeatureGlyph glyph={iconGlyph(feature.icon)} />
            {feature.name}
            <CaretIcon class="malice-toggle-mark" />
          </strong>
        </button>
        <button
          class="malice-unpin"
          title="Remove from encounter Malice"
          aria-label={`Remove ${feature.name} from encounter Malice`}
          onClick={() => removeMaliceSelection(feature.id)}
        >
          <CloseIcon />
        </button>
        {feature.isHomebrew && feature.homebrewId ? (
          <>
            <button
              type="button"
              class="icon-button"
              title="Edit custom Malice"
              aria-label={`Edit ${feature.name}`}
              onClick={() => openEditCustomMalice(feature.homebrewId!)}
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              class="icon-button"
              title="Share custom Malice"
              aria-label={`Share ${feature.name}`}
              onClick={() => openShareDialog("malice", feature.homebrewId!)}
            >
              <ShareIcon />
            </button>
          </>
        ) : feature.source ? (
          <a
            href={feature.source}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${feature.name} on SteelCompendium`}
            title="Open on SteelCompendium"
          >
            <ExternalIcon />
          </a>
        ) : null}
      </div>
      {expanded ? (
        <div class="malice-card-body">
          {meta ? <div class="malice-meta">{meta}</div> : null}
          <div class="malice-copy">
            {feature.effects.map((effect, effectIndex) => (
              <MaliceEffect
                key={effectIndex}
                feature={feature}
                effect={effect}
                effectIndex={effectIndex}
                interactive={interactive}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function AvailableItem({ feature }: { feature: MaliceFeature }) {
  const preview = plainText(featureText(feature));
  const shortPreview = preview.length > 150 ? `${preview.slice(0, 147)}…` : preview;
  return (
    <div class="malice-library-item" title={preview}>
      <span class="malice-library-cost">{costLabel(feature)}</span>
      <div class="malice-library-copy">
        <strong>{feature.name}</strong>
        {shortPreview ? <span>{shortPreview}</span> : null}
      </div>
      <button class="malice-add" onClick={() => addMaliceSelection(feature.id)}>
        <PlusIcon />
        Add
      </button>
      {feature.isHomebrew && feature.homebrewId ? (
        <button
          type="button"
          class="icon-button"
          title="Edit custom Malice"
          aria-label={`Edit ${feature.name}`}
          onClick={() => openEditCustomMalice(feature.homebrewId!)}
        >
          <PencilIcon />
        </button>
      ) : feature.source ? (
        <a
          href={feature.source}
          target="_blank"
          rel="noreferrer"
          aria-label="Open source"
          title="Open on SteelCompendium"
        >
          <ExternalIcon />
        </a>
      ) : null}
    </div>
  );
}

export function MaliceDock({ mode = "combat" }: { mode?: "combat" | "prep" } = {}) {
  const groups = relevantMaliceGroups();
  const status = maliceLoadStatus.value;
  const selectionReady = maliceSelectionReady.value;
  useEffect(() => {
    if (selectionReady) ensureMaliceSelection();
  }, [selectionReady, groups]);
  const notice =
    !selectionReady || !groups.length ? (
      <div class="malice-empty-bar">
        <span class="dock-loading" role="status">
          {status === "loading"
            ? "Loading official Malice…"
            : status === "failed"
              ? "Could not load official Malice."
              : !selectionReady
                ? "Auto pick requires all encounter statblocks to be available."
                : "No matching Malice features found."}
        </span>
        {status === "failed" ? (
          <button type="button" class="secondary compact-button" onClick={retryMalice}>
            Retry Malice
          </button>
        ) : null}
        {!groups.length ? (
          <button
            type="button"
            class="secondary compact-button"
            onClick={() => openNewCustomMalice({ pinOnSave: true })}
          >
            <PlusIcon />
            <span>Custom Malice</span>
          </button>
        ) : null}
      </div>
    ) : null;
  if (!groups.length) return notice;

  const interactive = mode === "combat";
  const selectedIds = activeEncounter().combat.selectedMaliceFeatureIds;
  const featureMap = new Map(
    allRelevantMaliceFeatures(groups).map((feature) => [feature.id, feature]),
  );
  const selected = selectedIds
    .map((id) => featureMap.get(id))
    .filter((feature): feature is MaliceFeature => feature !== undefined);
  const selectedSet = new Set(selected.map((feature) => feature.id));
  const availableGroups: MaliceGroup[] = groups
    .map((group) => ({
      ...group,
      features: group.features.filter((feature) => !selectedSet.has(feature.id)),
    }))
    .filter((group) => group.features.length);
  const availableCount = availableGroups.reduce((sum, group) => sum + group.features.length, 0);
  const libraryOpen = state.value.ui.maliceLibraryOpen;

  return (
    <>
      {notice}
      <section class="malice-selection-shell">
        {selected.length ? (
          <div class={`malice-selected-grid ${mode === "prep" ? "malice-selected-stack" : ""}`}>
            {selected.map((feature) => (
              <MaliceCard key={feature.id} feature={feature} interactive={interactive} />
            ))}
          </div>
        ) : (
          <div class="malice-selection-empty">No Malice features selected.</div>
        )}
      </section>
      <section class={`malice-library-shell ${libraryOpen ? "open" : ""}`}>
        <div class="malice-library-head-bar">
          <button
            class="malice-library-toggle"
            aria-expanded={libraryOpen}
            onClick={toggleMaliceLibrary}
          >
            <div>
              <strong>Available</strong>
              <span>
                {availableCount} more
                {availableGroups.length
                  ? ` · ${availableGroups.map((group) => group.label).join(", ")}`
                  : ""}
              </span>
            </div>
            <CaretIcon class="malice-library-mark" />
          </button>
          <button
            type="button"
            class="secondary compact-button malice-new-custom"
            title="Author a custom Malice feature and pin it to this encounter"
            onClick={() => openNewCustomMalice({ pinOnSave: true })}
          >
            <PlusIcon />
            <span>Custom Malice</span>
          </button>
        </div>
        {libraryOpen ? (
          <div class="malice-library-body">
            {availableGroups.length ? (
              availableGroups.map((group) => (
                <section class="malice-library-group" key={group.id}>
                  <header>
                    <strong>{group.label}</strong>
                    <span>{group.features.length}</span>
                  </header>
                  <div class="malice-library-list">
                    {group.features.map((feature) => (
                      <AvailableItem key={feature.id} feature={feature} />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div class="malice-selection-empty">All available features are selected.</div>
            )}
          </div>
        ) : null}
      </section>
    </>
  );
}
