import { disclosureDetails } from "../../lib/disclosure.ts";
import {
  ARCHETYPES,
  ATTITUDES,
  IMPRESSION_EXAMPLES,
  INTEREST_LADDER,
  TRAITS,
} from "../../lib/negotiation.ts";
import { TierMark } from "../Statblock.tsx";

const SAMPLE_RESPONSES = [
  {
    tone: "Positive",
    when: "interest rose",
    lines: [
      "“That's an excellent point.”",
      "“You've given me much to consider.”",
      "“Fair enough.”",
      "“Makes sense to me.”",
    ],
  },
  {
    tone: "Negative",
    when: "interest dropped",
    lines: [
      "“I don't buy that.”",
      "“Poppycock!”",
      "“I hear you, but I disagree.”",
      "“That's not going to sway me.”",
    ],
  },
  {
    tone: "Impatience",
    when: "interest unchanged",
    lines: [
      "“I've heard that before.”",
      "“Are you going to offer me anything real?”",
      "“This debate is tiresome.”",
      "“BORING!”",
    ],
  },
] as const;

/**
 * The book's negotiation rules, kept where the Director can reach them
 * while prepping an NPC or mid-argument. Closed by default so experienced
 * Directors stay straight in the live cockpit.
 */
export function NegotiationRules() {
  return (
    <details class="talk-rules" {...disclosureDetails("negotiation-rules")}>
      <summary>
        <span class="talk-rules-title">The rules</span>
        <span class="talk-block-note">
          Preparing, running, arguments, attitudes, Renown, traits &amp; archetypes
        </span>
      </summary>

      <div class="talk-rules-body">
        <h2 class="sr-only">The rules</h2>

        <div class="rules-overview">
          <section aria-labelledby="rules-prep-title">
            <div class="talk-block-head">
              <h3 id="rules-prep-title">Preparing an NPC</h3>
            </div>
            <ul class="rules-steps">
              <li>
                <strong>Motivations &amp; pitfalls.</strong> Pick at least 2 motivations and at
                least 1 pitfall (often 2+), never overlapping.
              </li>
              <li>
                <strong>Tracks &amp; Impression.</strong> Starting attitude sets{" "}
                <strong>Interest</strong> (0–5, what they'll offer) and <strong>Patience</strong>{" "}
                (0–5, arguments left). <strong>Impression</strong> (creature level, or 1–12 by
                standing) sets the Renown bar.
              </li>
              <li>
                <strong>Groups.</strong> Multiple NPCs share one track and trait list; different
                members speak up as their traits come into play.
              </li>
            </ul>
          </section>

          <section aria-labelledby="rules-flow-title">
            <div class="talk-block-head">
              <h3 id="rules-flow-title">How a parley runs</h3>
            </div>
            <ul class="rules-steps">
              <li>
                <strong>Opening.</strong> Heroes choose to negotiate. To halt combat, a hero uses a
                maneuver and a hard Presence (or Director-approved) test against a sapient, willing
                foe.
              </li>
              <li>
                <strong>Back and forth.</strong> Heroes read the NPC (once between arguments) or
                make an argument (one hero rolls; others may assist), then you react and update
                their offer.
              </li>
              <li>
                <strong>Keep going or stop.</strong> Heroes can accept the current offer and stop at
                any time. Talks end automatically at Interest 5, Interest 0, or Patience 0.
              </li>
            </ul>
          </section>

          <section aria-labelledby="rules-offers-title">
            <div class="talk-block-head">
              <h3 id="rules-offers-title">What Interest buys</h3>
            </div>
            <ol class="rules-ladder">
              {INTEREST_LADDER.map((step) => (
                <li key={step.value} class={step.terminal ? "terminal" : undefined}>
                  <b class="rules-ladder-num">{step.value}</b>
                  <div>
                    <strong>{step.label}</strong> <span>{step.summary}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div class="rules-spread">
          <div class="rules-col">
            <section aria-labelledby="rules-arguments-title">
              <div class="talk-block-head">
                <h3 id="rules-arguments-title">The four ways an argument goes</h3>
              </div>

              <ul class="rules-cases">
                <li class="rules-case">
                  <div class="rules-case-head">
                    <strong>Appeals to a fresh motivation</strong>
                    <span class="rules-case-kind">Medium test</span>
                  </div>
                  <ol class="rules-tiers">
                    <li>
                      <TierMark index={0} />
                      <span>Patience −1</span>
                    </li>
                    <li>
                      <TierMark index={1} />
                      <span>Interest +1, patience −1</span>
                    </li>
                    <li>
                      <TierMark index={2} />
                      <span>Interest +1, patience unchanged</span>
                    </li>
                  </ol>
                </li>

                <li class="rules-case">
                  <div class="rules-case-head">
                    <strong>Offers no motivation and no pitfall</strong>
                    <span class="rules-case-kind">More difficult test</span>
                  </div>
                  <ol class="rules-tiers">
                    <li>
                      <TierMark index={0} />
                      <span>Interest −1, patience −1</span>
                    </li>
                    <li>
                      <TierMark index={1} />
                      <span>Patience −1</span>
                    </li>
                    <li>
                      <TierMark index={2} />
                      <span>
                        Interest +1, patience −1{" "}
                        <em>(natural 19 or 20 keeps the NPC's patience)</em>
                      </span>
                    </li>
                  </ol>
                </li>

                <li class="rules-case">
                  <p>
                    <strong>Repeats an argument with no motivation behind it.</strong> A tier 1
                    outcome by rule (interest −1, patience −1).
                  </p>
                </li>

                <li class="rules-case">
                  <p>
                    <strong>Touches a pitfall.</strong> Fails outright: interest and patience each
                    drop by 1, and the NPC warns the heroes off.
                  </p>
                </li>
              </ul>

              <div class="rules-notes">
                <p>
                  Each motivation can only be appealed to once. Appealing to one that's already been
                  used leaves the NPC's interest where it is and costs a point of patience. If an
                  argument appeals to more than one motivation, name them and have the player pick
                  one.
                </p>
                <p>
                  A lie the NPC catches costs another point of interest — but only when the argument
                  failed to raise it. At the Director's discretion, a particularly well-roleplayed
                  argument counts as a tier 3 outcome without a test.
                </p>
                <p>
                  <strong>Tests and skills.</strong> Arguments use a Reason, Intuition or Presence
                  test with an applicable interpersonal skill: Brag, Empathize, Flirt, Gamble,
                  Interrogate, Intimidate, Lead, Lie, Music, Perform, Persuade or Read Person.
                </p>
              </div>
            </section>

            <section aria-labelledby="rules-responses-title">
              <div class="talk-block-head">
                <h3 id="rules-responses-title">Sample NPC responses</h3>
              </div>
              <dl class="rules-responses">
                {SAMPLE_RESPONSES.map((group) => (
                  <div key={group.tone} class="rules-response-row">
                    <dt>
                      <strong>{group.tone}</strong>
                      <span>({group.when})</span>
                    </dt>
                    <dd>
                      {group.lines.map((line) => (
                        <span key={line} class="rules-quote">
                          {line}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="rules-reading-title">
              <div class="talk-block-head">
                <h3 id="rules-reading-title">Reading the NPC</h3>
              </div>
              <p>
                A hero can ask outright what the NPC wants, or watch for what they reach for.
                Otherwise they can make a Reason, Intuition or Presence test:
              </p>
              <ol class="rules-tiers">
                <li>
                  <TierMark index={0} />
                  <span>Learns nothing; the NPC notices the probing (patience −1)</span>
                </li>
                <li>
                  <TierMark index={1} />
                  <span>Learns nothing</span>
                </li>
                <li>
                  <TierMark index={2} />
                  <span>Learns one motivation or pitfall of the hero's choice</span>
                </li>
              </ol>
              <p>After that test, no more reading until the heroes argue again.</p>
            </section>
          </div>

          <div class="rules-col">
            <section aria-labelledby="rules-opening-title">
              <div class="talk-block-head">
                <h3 id="rules-opening-title">Opening the negotiation</h3>
              </div>
              <table class="rules-table rules-table-attitudes">
                <thead>
                  <tr>
                    <th scope="col">Attitude</th>
                    <th scope="col" class="num">
                      Interest
                    </th>
                    <th scope="col" class="num">
                      Patience
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ATTITUDES.map((attitude) => (
                    <tr key={attitude.key}>
                      <th scope="row">
                        {attitude.label}
                        <span>{attitude.description}</span>
                      </th>
                      <td class="num">{attitude.interest}</td>
                      <td class="num">{attitude.patience}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div class="rules-notes">
                <p>
                  <strong>Native language.</strong> If one hero speaks the NPC's native language
                  (excluding Caelian), starting patience increases by 1; if three or more heroes
                  speak it, starting patience increases by 2 (to a maximum of 5).
                </p>
              </div>
            </section>

            <section aria-labelledby="rules-renown-title">
              <div class="talk-block-head">
                <h3 id="rules-renown-title">Renown and Impression</h3>
              </div>
              <p>
                An NPC only notices a hero's Renown if the hero's score is at least the NPC's
                Impression. A creature with a level has its level as its Impression. A hero who is{" "}
                <em>famous</em> to the NPC gains an edge on arguments where Flirt, Lead or Persuade
                could apply; one who is <em>infamous</em> gains an edge on arguments where Brag,
                Interrogate or Intimidate could apply.
              </p>
              <table class="rules-table rules-table-impression">
                <thead>
                  <tr>
                    <th scope="col" class="num">
                      Impression
                    </th>
                    <th scope="col">Example NPC</th>
                  </tr>
                </thead>
                <tbody>
                  {IMPRESSION_EXAMPLES.slice(1).map((example, index) => (
                    <tr key={example}>
                      <th scope="row" class="num">
                        {index + 1}
                      </th>
                      <td>{example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>

        <section class="rules-index" aria-labelledby="rules-motivations-title">
          <div class="talk-block-head">
            <h3 id="rules-motivations-title">The twelve motivations</h3>
            <span class="talk-block-note">
              Each is also a pitfall for the right NPC — what moves one leaves another cold.
            </span>
          </div>
          <ul class="rules-traits">
            {TRAITS.map((trait) => (
              <li key={trait.key}>
                <strong>{trait.label}</strong>
                <span>{trait.gloss}</span>
              </li>
            ))}
          </ul>
        </section>

        <section class="rules-index" aria-labelledby="rules-archetypes-title">
          <div class="talk-block-head">
            <h3 id="rules-archetypes-title">The archetypes</h3>
            <span class="talk-block-note">Ready-made NPCs from the Heroes book</span>
          </div>
          <ul class="rules-traits">
            {ARCHETYPES.map((archetype) => (
              <li key={archetype.key}>
                <div class="rules-trait-head">
                  <strong>{archetype.label}</strong>
                  <span class="rules-trait-meta">Impression {archetype.impression}</span>
                </div>
                <span>{archetype.note}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}
