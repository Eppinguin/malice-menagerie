import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadMonster, monstersVersion, monsterAt } from "../../data.ts";
import { atLevel } from "../../lib/levels.ts";
import { makeCharacteristicRoll, makePowerRoll, type CharacteristicKey } from "../../lib/rules.ts";
import type { EdgeState, Monster, MonsterFeature, PowerRollResult } from "../../types.ts";
import { CheckIcon, ExternalIcon, PlusIcon } from "../Icons.tsx";
import { LaneHeader, type PreviewRollController, StatblockBody } from "../Statblock.tsx";
import { familyInfo } from "./PageMalice.tsx";

/** Wide enough for the studio page and a statblock beside it. */
export const FACING_QUERY = "(min-width: 1280px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * Keeps the facing page on screen while it folds away, so it closes as
 * gently as it opened. Closing starts when `open` turns false; the page
 * leaves once its animation ends (at once when motion is reduced).
 */
export function FacingDock({ open, children }: { open: boolean; children: ComponentChildren }) {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
    } else if (shown) {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) setShown(false);
      else setLeaving(true);
    }
  }, [open]);
  if (!shown) return null;
  return (
    <div
      class={`hb-src-dock${leaving ? " is-leaving" : ""}`}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) {
          setShown(false);
          setLeaving(false);
        }
      }}
    >
      {children}
    </div>
  );
}

function familySlug(familyPath: string): string {
  return familyPath.toLowerCase().split("/").filter(Boolean)[0] ?? "";
}

/**
 * One statblock read in full before taking anything from it: all of it, its
 * numbers, its Malice family, or single abilities, each one undo step. It
 * prints at the monster's level unless the Director turns scaling off, with
 * scaled numbers in pen as on the board.
 */
export function StatblockReader({
  path,
  level,
  familyPath,
  have,
  bar,
  scale,
  onTakeAll,
  onTakeStats,
  onAdd,
  onUseFamily,
}: {
  path: string;
  /** The homebrew monster's level, which the source scales to. */
  level: number;
  familyPath: string;
  /** Lower-cased names of the abilities already on the page. */
  have: ReadonlySet<string>;
  /** The browser's navigation, above the statblock. */
  bar: ComponentChildren;
  /** Print it at the monster's level rather than its own. */
  scale: boolean;
  onTakeAll: (monster: Monster) => void;
  onTakeStats: (monster: Monster) => void;
  onAdd: (feature: MonsterFeature, sourceName: string) => void;
  onUseFamily: (slug: string, label: string) => void;
}) {
  void monstersVersion.value; // subscribe: the statblock may arrive after opening
  const raw = monsterAt(path);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [rolls, setRolls] = useState<Map<string, PowerRollResult>>(() => new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRolls(new Map());
    scrollRef.current?.scrollTo({ top: 0 });
    if (monsterAt(path)) return;
    let live = true;
    setError(false);
    loadMonster(path).catch(() => {
      if (live) setError(true);
    });
    return () => {
      live = false;
    };
  }, [path, retry]);

  const rescaled = Boolean(raw && scale && raw.level !== level);
  const shown = useMemo(
    () => (raw ? (rescaled ? atLevel(raw, level) : raw) : undefined),
    [raw, rescaled, level],
  );

  if (!raw || !shown) {
    return (
      <>
        <header class="hb-src-head">{bar}</header>
        <div class="hb-src-status" role={error ? "alert" : "status"}>
          {error ? (
            <>
              <p>That statblock didn't load.</p>
              <button
                type="button"
                class="secondary compact-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                Try again
              </button>
            </>
          ) : (
            <p>Opening the statblock…</p>
          )}
        </div>
      </>
    );
  }

  const slug = familySlug(raw.familyPath);
  const family = slug ? familyInfo(slug) : null;
  const sameFamily = slug !== "" && slug === familySlug(familyPath);

  const roll: PreviewRollController = {
    results: rolls,
    onRollFeature: (featureIndex, effectIndex, edge) => {
      const eff = shown.features[featureIndex]?.effects?.[effectIndex];
      const res = makePowerRoll(eff?.roll ?? "Power Roll", shown, edge ?? "normal");
      setRolls((prev) => new Map(prev).set(`${shown.id}|${featureIndex}|${effectIndex}`, res));
    },
    onRollChar: (key: CharacteristicKey, edge?: EdgeState) => {
      const res = makeCharacteristicRoll(shown, key, edge ?? "normal");
      const prefix = `${shown.id}|char|`;
      setRolls((prev) => {
        const next = new Map(prev);
        for (const k of next.keys()) if (k.startsWith(prefix)) next.delete(k);
        return next.set(`${prefix}${key}`, res);
      });
    },
  };

  return (
    <>
      <header class="hb-src-head">
        {bar}
        <div class="hb-src-take" role="group" aria-label={`Take from ${raw.name}`}>
          <button type="button" class="primary compact-button" onClick={() => onTakeAll(shown)}>
            Take all
          </button>
          <button
            type="button"
            class="secondary compact-button"
            title="Only its numbers: Stamina, Speed, characteristics, defenses"
            onClick={() => onTakeStats(shown)}
          >
            Stats only
          </button>
          {family ? (
            sameFamily ? (
              <span class="hb-src-has">
                <CheckIcon /> {family.label} Malice
              </span>
            ) : (
              <button
                type="button"
                class="secondary compact-button"
                onClick={() => onUseFamily(slug, family.label)}
              >
                Use {family.label} Malice
              </button>
            )
          ) : null}
        </div>
      </header>
      <div class="hb-src-scroll" ref={scrollRef}>
        <LaneHeader monster={shown} scope="studio-source" previewRoll={roll} />
        <div class="hb-src-abilities">
          {shown.features.map((feature, index) => {
            const name = feature.name?.trim() || "ability";
            const added = have.has(name.toLowerCase());
            const single: Monster = { ...shown, features: [feature] };
            const printed = shown.printed?.features[index];
            if (shown.printed && printed)
              single.printed = { ...shown.printed, features: [printed] };
            else delete single.printed;
            const results = new Map<string, PowerRollResult>();
            for (const [k, v] of rolls) {
              const prefix = `${shown.id}|${index}|`;
              if (k.startsWith(prefix)) results.set(`${shown.id}|0|${k.slice(prefix.length)}`, v);
            }
            return (
              <div class={`hb-src-ability${added ? " is-added" : ""}`} key={`${path}#${index}`}>
                <StatblockBody
                  monster={single}
                  interactive={false}
                  previewRoll={{
                    results,
                    onRollFeature: (_fi, effectIndex, edge) =>
                      roll.onRollFeature(index, effectIndex, edge),
                    onRollChar: roll.onRollChar,
                  }}
                />
                <button
                  type="button"
                  class="secondary compact-button hb-src-add"
                  title={added ? "On your page (adds another copy)" : "Add to your page"}
                  aria-label={
                    added
                      ? `${name} is on your page; add another copy`
                      : `Add ${name} to your page${rescaled ? `, scaled to level ${level}` : ""}`
                  }
                  onClick={() => onAdd(structuredClone(feature), raw.name)}
                >
                  {added ? <CheckIcon /> : <PlusIcon />}
                  <span>{added ? "On page" : "Add"}</span>
                </button>
              </div>
            );
          })}
        </div>
        {raw.source ? (
          <a class="source-link" href={raw.source} target="_blank" rel="noreferrer">
            SteelCompendium source
            <ExternalIcon />
          </a>
        ) : null}
      </div>
    </>
  );
}
