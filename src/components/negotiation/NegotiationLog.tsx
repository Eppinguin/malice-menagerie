import { liveNegotiation, undoNegotiationArgument } from "../../store.ts";
import type { Negotiation } from "../../types.ts";

/**
 * What has been said, newest first, written in the Director's pen.
 * "Take it back" appears here only when the negotiation has ended (so the
 * active Resolver header owns the single live undo button without duplication).
 */
export function NegotiationLog({ negotiation: given }: { negotiation: Negotiation }) {
  const negotiation = liveNegotiation(given);
  const showUndo = negotiation.log.length > 0 && Boolean(negotiation.ended);
  return (
    <section class="talk-log" aria-labelledby="talk-log-title">
      <div class="talk-block-head">
        <h2 id="talk-log-title">What's been said</h2>
        {showUndo ? (
          <button
            class="text-button"
            onClick={undoNegotiationArgument}
            title="Take the last entry back"
          >
            Take it back
          </button>
        ) : null}
      </div>
      {negotiation.log.length ? (
        <ol class="log-entries">
          {negotiation.log.map((entry) => (
            <li key={entry.id} class={`log-entry ${entry.kind}`}>
              <div class="log-entry-head">
                <strong>{entry.title}</strong>
                <span class="log-result">{entry.result}</span>
              </div>
              {entry.memo ? <p class="log-memo">{entry.memo}</p> : null}
              {entry.roll ? <small>{entry.roll}</small> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p class="log-empty">Nothing yet. Tap a tier above to record the first argument.</p>
      )}
    </section>
  );
}
