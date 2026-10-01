import { maliceLoading } from '../../data.ts';
import { featureText } from '../../lib/malice.ts';
import { plainText, richText } from '../../lib/text.ts';
import {
  activeEncounter,
  addMaliceSelection,
  allRelevantMaliceFeatures,
  ensureMaliceSelection,
  expandedMaliceFeatures,
  lastMaliceRolls,
  relevantMaliceGroups,
  removeMaliceSelection,
  rollMaliceFeature,
  state,
  toggleMaliceExpanded,
  toggleMaliceLibrary,
  useMaliceFeature
} from '../../store.ts';
import type { EdgeState, FeatureEffect, MaliceFeature, MaliceGroup } from '../../types.ts';
import { rollPress } from './EdgeMenu.tsx';
import { FeatureGlyph, iconGlyph, PayMalice, RollTally, rollSerial, TierMark } from '../Statblock.tsx';
import { PenLoop } from '../Pen.tsx';
import { CaretIcon, CloseIcon, ExternalIcon, PlusIcon } from '../Icons.tsx';

function costLabel(feature: MaliceFeature): string {
  return (feature.costText || String(feature.cost || '—')).replace(/\s*Malice/i, '');
}

function MaliceEffect({ feature, effect, effectIndex }: { feature: MaliceFeature; effect: FeatureEffect; effectIndex: number }) {
  const tierKeys = (['tier1', 'tier2', 'tier3'] as const).filter(key => effect[key]);
  const lastRoll = lastMaliceRolls.value.get(`${feature.id}|${effectIndex}`);
  return (
    <div class="malice-effect">
      {effect.effect ? <p dangerouslySetInnerHTML={{ __html: richText(effect.effect) }} /> : null}
      {tierKeys.length ? (
        <div class="malice-roll-line">
          <button
            title="Roll — tap, or hold for edge/bane menu"
            {...rollPress(
              (event) => rollMaliceFeature(feature.id, effectIndex, event),
              (edge: EdgeState) => rollMaliceFeature(feature.id, effectIndex, edge),
            )}
          >
            Roll
          </button>
          <strong>{effect.roll || 'Power Roll'}</strong>
          {lastRoll ? <RollTally key={rollSerial(lastRoll)} roll={lastRoll} /> : null}
        </div>
      ) : null}
      {tierKeys.length ? (
        <div class="malice-tiers">
          {tierKeys.map((key, index) => (
            <div
              key={key}
              class={lastRoll?.tier === index + 1 ? 'rolled-tier' : ''}
              aria-current={lastRoll?.tier === index + 1 ? 'true' : undefined}
            >
              {lastRoll && lastRoll.tier === index + 1 ? <PenLoop key={rollSerial(lastRoll)} seed={rollSerial(lastRoll)} /> : null}
              <TierMark index={index} />
              <span dangerouslySetInnerHTML={{ __html: richText(effect[key]) }} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MaliceCard({ feature }: { feature: MaliceFeature }) {
  const expanded = expandedMaliceFeatures.value.has(feature.id);
  const meta = [feature.distance, feature.target].filter(Boolean).join(' · ');
  return (
    <article class={`malice-card ${expanded ? 'expanded' : 'collapsed'}`}>
      <div class="malice-card-head">
        <PayMalice
          class="malice-cost"
          cost={feature.cost}
          label={costLabel(feature)}
          name={feature.name}
          onPay={() => useMaliceFeature(feature.id)}
        />
        <button class="malice-toggle" aria-expanded={expanded} onClick={() => toggleMaliceExpanded(feature.id)}>
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
        <a href={feature.source} target="_blank" rel="noreferrer" aria-label={`Open ${feature.name} on SteelCompendium`} title="Open on SteelCompendium">
          <ExternalIcon />
        </a>
      </div>
      {expanded ? (
        <div class="malice-card-body">
          {meta ? <div class="malice-meta">{meta}</div> : null}
          <div class="malice-copy">
            {feature.effects.map((effect, effectIndex) => (
              <MaliceEffect key={effectIndex} feature={feature} effect={effect} effectIndex={effectIndex} />
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
      <a href={feature.source} target="_blank" rel="noreferrer" aria-label="Open source" title="Open on SteelCompendium">
        <ExternalIcon />
      </a>
    </div>
  );
}

export function MaliceDock() {
  if (maliceLoading.value) {
    return <span class="dock-loading">Loading SteelCompendium Malice…</span>;
  }
  const groups = relevantMaliceGroups();
  if (!groups.length) {
    return <span class="dock-loading">No matching Malice features found.</span>;
  }

  ensureMaliceSelection(groups);
  const selectedIds = activeEncounter().combat.selectedMaliceFeatureIds;
  const featureMap = new Map(allRelevantMaliceFeatures(groups).map(feature => [feature.id, feature]));
  const selected = selectedIds
    .map(id => featureMap.get(id))
    .filter((feature): feature is MaliceFeature => feature !== undefined);
  const selectedSet = new Set(selected.map(feature => feature.id));
  const availableGroups: MaliceGroup[] = groups
    .map(group => ({ ...group, features: group.features.filter(feature => !selectedSet.has(feature.id)) }))
    .filter(group => group.features.length);
  const availableCount = availableGroups.reduce((sum, group) => sum + group.features.length, 0);
  const libraryOpen = state.value.ui.maliceLibraryOpen;

  return (
    <>
      <section class="malice-selection-shell">
        {selected.length ? (
          <div class="malice-selected-grid">
            {selected.map(feature => <MaliceCard key={feature.id} feature={feature} />)}
          </div>
        ) : (
          <div class="malice-selection-empty">No Malice features selected.</div>
        )}
      </section>
      <section class={`malice-library-shell ${libraryOpen ? 'open' : ''}`}>
        <button class="malice-library-toggle" aria-expanded={libraryOpen} onClick={toggleMaliceLibrary}>
          <div>
            <strong>Available</strong>
            <span>{availableCount} more{availableGroups.length ? ` · ${availableGroups.map(group => group.label).join(', ')}` : ''}</span>
          </div>
          <CaretIcon class="malice-library-mark" />
        </button>
        {libraryOpen ? (
          <div class="malice-library-body">
            {availableGroups.length ? availableGroups.map(group => (
              <section class="malice-library-group" key={group.id}>
                <header><strong>{group.label}</strong><span>{group.features.length}</span></header>
                <div class="malice-library-list">
                  {group.features.map(feature => <AvailableItem key={feature.id} feature={feature} />)}
                </div>
              </section>
            )) : <div class="malice-selection-empty">All available features are selected.</div>}
          </div>
        ) : null}
      </section>
    </>
  );
}
