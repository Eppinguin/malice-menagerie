import { partyMath } from '../../lib/rules.ts';
import { activeEncounter, updateParty } from '../../store.ts';

export function PartyStrip() {
  const party = activeEncounter().party;
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
      <h2 class="party-copy">The party</h2>
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
      <div class="party-metric"><small>One hero ES</small><strong>{values.oneHeroES}</strong></div>
      <div class="party-metric"><small>Party ES</small><strong>{values.partyES}</strong></div>
      <div class="party-metric party-metric-malice"><small>Round 1 Malice</small><strong>{values.roundOne}</strong></div>
    </section>
  );
}
