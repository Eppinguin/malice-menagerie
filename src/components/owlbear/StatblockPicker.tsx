import { useMemo, useState } from "preact/hooks";
import { setManualStatblock } from "../../integration/controller.ts";
import { normalizeName } from "../../integration/statblocks.ts";
import type { StatblockRef } from "../../../shared/obr/protocol.ts";
import { STATBLOCK_INDEX } from "../../../shared/obr/statblockIndex.generated.ts";

export function StatblockPicker({
  entry,
}: {
  entry: {
    key: string;
    name: string;
    level: number;
    candidates: { resourceId: string; name: string; level: number }[];
  };
}) {
  const [query, setQuery] = useState("");
  const { matches, total } = useMemo(() => {
    if (!query.trim()) {
      return { matches: entry.candidates.slice(0, 6), total: entry.candidates.length };
    }
    const wanted = normalizeName(query);
    const all = STATBLOCK_INDEX.filter((candidate) =>
      normalizeName(candidate.name).includes(wanted),
    );
    return {
      total: all.length,
      matches: all.slice(0, 6).map((candidate) => ({
        resourceId: candidate.id,
        name: candidate.name,
        level: candidate.level,
      })),
    };
  }, [entry.candidates, query]);
  const choose = (ref: { resourceId: string; name: string }) => {
    const chosen: StatblockRef = { resourceId: ref.resourceId, name: ref.name };
    setManualStatblock(entry.key, chosen);
  };
  return (
    <li class="owlbear-unresolved">
      <div class="owlbear-unresolved-head">
        <strong>{entry.name}</strong>
        <span>Level {entry.level}</span>
      </div>
      <input
        class="owlbear-search"
        placeholder="Search statblocks…"
        value={query}
        aria-label={`Search a statblock for ${entry.name}`}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <div class="owlbear-candidates">
        {matches.length ? (
          matches.map((candidate) => (
            <button
              type="button"
              key={candidate.resourceId}
              class="secondary compact-button"
              title={`Use ${candidate.name} (level ${candidate.level})`}
              onClick={() => choose(candidate)}
            >
              {candidate.name} · {candidate.level}
            </button>
          ))
        ) : (
          <small>
            {query.trim()
              ? "No statblock matches that search."
              : "Type a monster name above to search Draw Steel Tools statblocks."}
          </small>
        )}
      </div>
      {total > 6 ? (
        <small class="owlbear-hint small">Showing 6 of {total} — keep typing to narrow.</small>
      ) : null}
    </li>
  );
}
