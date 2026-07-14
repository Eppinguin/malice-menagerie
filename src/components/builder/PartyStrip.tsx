import { partyMath } from '../../lib/rules.ts';
import { state, updateParty } from '../../store.ts';

export function PartyStrip() {
  const party = state.value.party;
  const values = partyMath(party);
  const commit = (patch: Partial<Record<'heroes' | 'level' | 'victories' | 'bonusMalice', unknown>>) => {
    updateParty({
      heroes: patch.heroes ?? party.heroes,
      level: patch.level ?? party.level,
      victories: patch.victories ?? party.victories,
      bonusMalice: patch.bonusMalice ?? party.bonusMalice
    });
  };
  return (
    <section class="party-strip panel">
      <div class="party-copy"><p class="eyebrow">PARTY</p><h2>Encounter parameters</h2></div>
      <label>
        <span>Heroes</span>
        <input type="number" min={1} max={12} value={party.heroes} onChange={event => commit({ heroes: event.currentTarget.value })} />
      </label>
      <label>
        <span>Level</span>
        <input type="number" min={1} max={10} value={party.level} onChange={event => commit({ level: event.currentTarget.value })} />
      </label>
      <label>
        <span>Avg. Victories</span>
        <input type="number" min={0} max={20} value={party.victories} onChange={event => commit({ victories: event.currentTarget.value })} />
      </label>
      <label>
        <span>Bonus Malice</span>
        <input type="number" min={0} max={99} value={party.bonusMalice} onChange={event => commit({ bonusMalice: event.currentTarget.value })} />
      </label>
      <div class="party-metric"><small>ONE HERO ES</small><strong>{values.oneHeroES}</strong></div>
      <div class="party-metric"><small>PARTY ES</small><strong>{values.partyES}</strong></div>
      <div class="party-metric"><small>ROUND 1 MALICE</small><strong>{values.roundOne}</strong></div>
    </section>
  );
}
