import { PartyStrip } from './PartyStrip.tsx';
import { LibraryColumn } from './LibraryColumn.tsx';
import { EncounterColumn } from './EncounterColumn.tsx';

export function BuilderView({ active }: { active: boolean }) {
  return (
    <section class={`view ${active ? 'active' : ''}`}>
      <PartyStrip />
      <div class="builder-grid">
        <LibraryColumn />
        <EncounterColumn />
      </div>
    </section>
  );
}
