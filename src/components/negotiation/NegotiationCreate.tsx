import { useEffect } from "preact/hooks";
import { ARCHETYPES, IMPRESSION_BANDS, traitOf } from "../../lib/negotiation.ts";
import {
  activeNegotiation,
  closeNewNegotiation,
  createNegotiation,
  createRandomNegotiation,
} from "../../store.ts";
import { NegotiationRules } from "./NegotiationRules.tsx";

/**
 * Quick Create: always reachable from empty state OR "+ New NPC".
 *
 * Built for 5-second mid-session improvisation:
 * 1. Quick Improv band: 1 tap deals a ready-to-run Neutral NPC (3 motivations
 *    + 2 non-overlapping pitfalls) at Local, Civic, or Mythic Impression.
 * 2. Blank NPC right beside it (no scrolling past 12 archetypes).
 * 3. Official Archetypes grouped by Impression band with Moves / Avoid previews.
 */
export function NegotiationCreate({ canCancel = false }: { canCancel?: boolean }) {
  const current = activeNegotiation();

  useEffect(() => {
    if (!canCancel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNewNegotiation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCancel]);

  return (
    <div class="talk-opening">
      <div class="talk-opening-head">
        <div class="talk-opening-copy">
          <h2>{canCancel ? "New negotiation" : "No one to talk to yet"}</h2>
          <p>
            Deal a random NPC in one tap, pick one of the Heroes book's twelve archetypes, or start
            blank with the trait deck.
          </p>
        </div>
        <div class="talk-opening-actions">
          <button
            class="secondary compact-button"
            title="Start with a blank NPC and pick traits from the 12-chip deck"
            onClick={() => createNegotiation("")}
          >
            Blank NPC
          </button>
          {canCancel ? (
            <button class="secondary compact-button" onClick={closeNewNegotiation}>
              Back to {current?.name || "negotiation"}
            </button>
          ) : null}
        </div>
      </div>

      <section class="improv-section" aria-labelledby="improv-title">
        <div class="talk-block-head">
          <h3 id="improv-title">Quick improv — 1 tap</h3>
          <span class="talk-block-note">Deals 3 motivations + 2 pitfalls at Neutral</span>
        </div>
        <div class="improv-grid">
          {IMPRESSION_BANDS.map((band) => (
            <button
              key={band.key}
              class="improv-button"
              onClick={() => createRandomNegotiation(band.key)}
            >
              <span class="improv-button-head">
                <strong>{band.label}</strong>
                <span>{band.range}</span>
              </span>
              <span class="improv-button-hint">{band.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section class="archetype-groups" aria-label="Heroes book archetypes">
        {IMPRESSION_BANDS.map((band) => {
          const group = ARCHETYPES.filter(
            (arch) => arch.impression >= band.min && arch.impression <= band.max,
          );
          return (
            <div key={band.key} class="archetype-band">
              <div class="talk-block-head">
                <h3>{band.label} archetypes</h3>
                <span class="talk-block-note">{band.range}</span>
              </div>
              <div class="archetype-index">
                {group.map((archetype) => {
                  const mot = archetype.motivations.map((k) => traitOf(k).label).join(", ");
                  const pit = archetype.pitfalls.map((k) => traitOf(k).label).join(", ");
                  return (
                    <button
                      key={archetype.key}
                      class="archetype-entry"
                      onClick={() => createNegotiation(archetype.key)}
                    >
                      <span class="archetype-entry-main">
                        <strong>{archetype.label}</strong>
                        <span class="archetype-entry-note">{archetype.note}</span>
                        <span class="archetype-entry-traits">
                          <em>Moves:</em> {mot} · <em>Avoid:</em> {pit}
                        </span>
                      </span>
                      <span class="archetype-entry-meta">Impression {archetype.impression}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <NegotiationRules />
    </div>
  );
}
