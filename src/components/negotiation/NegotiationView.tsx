import { disclosure } from "../../lib/disclosure.ts";
import { useEffect, useState } from "preact/hooks";
import {
  activeNegotiation,
  creatingNegotiation,
  editNegotiation,
  liveNegotiation,
  openShareDialog,
  reopenNegotiation,
  resetNegotiation,
  setNegotiationArchetype,
  setNegotiationAttitude,
  setNegotiationLanguageBonus,
} from "../../store.ts";
import { ShareIcon } from "../Icons.tsx";
import {
  ARCHETYPES,
  ATTITUDES,
  IMPRESSION_EXAMPLES,
  archetypeOf,
  attitudeOf,
  endingText,
} from "../../lib/negotiation.ts";
import type { AttitudeKey, LanguageBonus, Negotiation, Renown } from "../../types.ts";
import { NegotiationCreate } from "./NegotiationCreate.tsx";
import { NegotiationLog } from "./NegotiationLog.tsx";
import { NegotiationRules } from "./NegotiationRules.tsx";
import { InterestLadder, PatienceClock } from "./NegotiationTracks.tsx";
import { RENOWN_LABELS, ResolverPanel } from "./ResolverPanel.tsx";
import { TraitLists } from "./TraitLists.tsx";

const LANGUAGE_OPTIONS: readonly { value: LanguageBonus; label: string; title: string }[] = [
  { value: 0, label: "None", title: "No native language bonus (Caelian does not count)" },
  {
    value: 1,
    label: "One hero +1",
    title: "One hero speaks their non-Caelian native language: patience +1 at start",
  },
  {
    value: 2,
    label: "Three+ +2",
    title: "Three or more heroes speak their non-Caelian native language: patience +2 at start",
  },
];

/**
 * The negotiation page: either Quick Create (empty state or "+ New NPC") or
 * the one-screen live cockpit for the active NPC.
 */
export function NegotiationView({ active }: { active: boolean }) {
  const negotiation = activeNegotiation();
  const creating = creatingNegotiation.value;
  return (
    <section class={`view talk-view ${active ? "active" : ""}`}>
      {!negotiation || creating ? (
        <NegotiationCreate canCancel={Boolean(negotiation)} />
      ) : (
        <NegotiationSheet key={negotiation.id} negotiation={negotiation} />
      )}
    </section>
  );
}

function NegotiationSheet({ negotiation: given }: { negotiation: Negotiation }) {
  const negotiation = liveNegotiation(given);
  const ended = endingText(negotiation.ended);

  return (
    <article class="talk-sheet">
      <TalkHead negotiation={negotiation} />

      <div class="talk-cockpit">
        <div class="talk-state-col">
          <InterestLadder negotiation={negotiation} />
          <PatienceClock negotiation={negotiation} />
        </div>
        <div class="talk-action-col">
          <TraitLists />
          {ended ? (
            <aside class="talk-closed" role="status">
              <div>
                <strong>{ended.label}</strong>
                <p>{ended.detail}</p>
              </div>
              <div class="talk-closed-actions">
                <button
                  class="secondary compact-button"
                  onClick={reopenNegotiation}
                  title="Keep arguing past this terminal value"
                >
                  Keep talking
                </button>
                <button
                  class="secondary compact-button"
                  onClick={resetNegotiation}
                  title="Reset tracks, spent motivations, and log (undoable)"
                >
                  Reset
                </button>
              </div>
            </aside>
          ) : (
            <ResolverPanel negotiation={negotiation} />
          )}
        </div>
      </div>

      <NegotiationLog negotiation={negotiation} />
      <NegotiationRules />
    </article>
  );
}

/** Compact sheet head + collapsible one-time Setup tray.
    Starts collapsed on Quick Improv and Archetype NPCs so Directors land
    straight in the live cockpit; starts open only for Blank NPCs and
    auto-collapses once the first argument lands. */
function TalkHead({ negotiation: given }: { negotiation: Negotiation }) {
  const negotiation = liveNegotiation(given);
  const {
    open: setupOpen,
    setOpen: setSetupOpen,
    toggle: toggleSetup,
  } = disclosure(`negotiation-setup/${negotiation.id}`);
  const [hadLog, setHadLog] = useState(negotiation.log.length > 0);

  useEffect(() => {
    const nowHasLog = negotiation.log.length > 0;
    if (nowHasLog && !hadLog) {
      setSetupOpen(false);
    }
    setHadLog(nowHasLog);
  }, [negotiation.log.length, hadLog]);

  const archetype = archetypeOf(negotiation.archetype);
  const archLabel = archetype?.label ?? "Custom";
  const attLabel = attitudeOf(negotiation.attitude).label;
  const langLabel =
    negotiation.languageBonus === 2
      ? "+2 language"
      : negotiation.languageBonus === 1
        ? "+1 language"
        : null;
  const summaryParts = [
    archLabel,
    `Impression ${negotiation.impression}`,
    RENOWN_LABELS[negotiation.renown],
    attLabel,
    ...(langLabel ? [langLabel] : []),
  ];

  return (
    <header class={`talk-head${setupOpen ? " setup-open" : ""}`}>
      <div class="talk-head-top">
        <input
          class="talk-name"
          value={negotiation.name}
          placeholder="NPC name"
          aria-label="NPC name"
          onInput={(event) => editNegotiation({ name: event.currentTarget.value })}
        />
        <input
          class="talk-ask-inline"
          value={negotiation.ask}
          placeholder="What the heroes want (e.g. passage, aid, a truce)"
          aria-label="What the heroes want"
          onInput={(event) => editNegotiation({ ask: event.currentTarget.value })}
        />
        <button
          type="button"
          class="icon-button"
          title="Share NPC link or export JSON"
          aria-label={`Share ${negotiation.name || "NPC"}`}
          onClick={() => openShareDialog("negotiation", negotiation.id)}
        >
          <ShareIcon />
        </button>
        <button
          class={`chip talk-setup-toggle${setupOpen ? " active" : ""}`}
          aria-expanded={setupOpen}
          onClick={toggleSetup}
        >
          {setupOpen ? "Hide setup" : "Edit setup"}
        </button>
      </div>

      {!setupOpen ? (
        <button
          class="talk-setup-summary"
          title="Open setup (archetype, Impression, Renown, attitude, language)"
          onClick={() => setSetupOpen(true)}
        >
          {summaryParts.join(" · ")}
        </button>
      ) : null}

      {archetype ? (
        <p class="talk-archetype-brief">
          <em>{archetype.summary}</em> {archetype.usedFor}
        </p>
      ) : null}

      {setupOpen ? (
        <div class="talk-setup-tray">
          <div class="talk-setup-row">
            <label class="talk-archetype">
              <span>Archetype</span>
              <select
                value={negotiation.archetype}
                onChange={(event) => {
                  setNegotiationArchetype(event.currentTarget.value);
                  event.currentTarget.value = activeNegotiation()?.archetype ?? "";
                }}
              >
                <option value="">Custom</option>
                {ARCHETYPES.map((archetype) => (
                  <option key={archetype.key} value={archetype.key}>
                    {archetype.label} (Impression {archetype.impression})
                  </option>
                ))}
              </select>
            </label>

            <label class="talk-impression">
              <span>Impression</span>
              <select
                value={negotiation.impression}
                onChange={(event) =>
                  editNegotiation({ impression: Number(event.currentTarget.value) })
                }
              >
                {IMPRESSION_EXAMPLES.slice(1).map((example, index) => (
                  <option key={example} value={index + 1}>
                    {index + 1} · {example}
                  </option>
                ))}
              </select>
            </label>

            <div class="talk-renown">
              <span>Renown</span>
              <div
                class="talk-renown-chips"
                role="group"
                aria-label="How the heroes are known to this NPC"
              >
                {(Object.keys(RENOWN_LABELS) as Renown[]).map((key) => (
                  <button
                    key={key}
                    class={`chip${negotiation.renown === key ? " active" : ""}`}
                    aria-pressed={negotiation.renown === key}
                    title={renownTitle(key, negotiation.impression)}
                    onClick={() => editNegotiation({ renown: key })}
                  >
                    {RENOWN_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div class="talk-setup-row talk-setup-opening">
            <div class="talk-setup-group">
              <span>Starting attitude</span>
              <div class="attitude-chips" role="group" aria-label="Starting attitude">
                {ATTITUDES.map((attitude) => (
                  <button
                    key={attitude.key}
                    class={`chip${negotiation.attitude === attitude.key ? " active" : ""}`}
                    aria-pressed={negotiation.attitude === attitude.key}
                    title={`${attitude.description} · Interest ${attitude.interest}, patience ${attitude.patience}`}
                    onClick={() => setNegotiationAttitude(attitude.key as AttitudeKey)}
                  >
                    {attitude.label}
                  </button>
                ))}
              </div>
            </div>

            <div class="talk-setup-group">
              <span>Native language (non-Caelian)</span>
              <div class="language-chips" role="group" aria-label="Native language patience bonus">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    class={`chip${negotiation.languageBonus === opt.value ? " active" : ""}`}
                    aria-pressed={negotiation.languageBonus === opt.value}
                    title={opt.title}
                    onClick={() => setNegotiationLanguageBonus(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {negotiation.log.length > 0 || negotiation.overrideEnded ? (
              <button
                class="secondary compact-button talk-reset-btn"
                title="Reset Interest, Patience, spent motivations, and log (undoable)"
                onClick={resetNegotiation}
              >
                Reset negotiation
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}

function renownTitle(key: Renown, impression: number): string {
  if (key === "unknown") return "The NPC has never heard of the heroes.";
  return `Applies when a hero's Renown is ${impression}+. ${
    key === "famous"
      ? "Edge on Flirt, Lead or Persuade arguments."
      : "Edge on Brag, Interrogate or Intimidate arguments."
  }`;
}
