import {
  activeEncounter,
  activeNegotiation,
  activeSection,
  activeView,
  adjustMalice,
  canRedo,
  canUndo,
  closeQuickAdd,
  createEncounter,
  creatingNegotiation,
  customMaliceEditorState,
  encounterTotals,
  homebrewStudioState,
  importDialogState,
  mobileNavOpen,
  nextRound,
  openConditionPickerFor,
  openImportFromText,
  openNewNegotiation,
  previousRound,
  quickAddOpen,
  redoLabel,
  redoStep,
  selectEncounter,
  selectNegotiation,
  setMobileNav,
  setSection,
  setView,
  shareDialogState,
  state,
  toast,
  toggleQuickAdd,
  toggleSidebar,
  undoLabel,
  undoStep,
} from "../store.ts";
import { sourceSnapshot } from "../data.ts";
import type { ComponentType } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { installPhoneScroll } from "../lib/phoneScroll.ts";
import { difficultyFor, partyMath } from "../lib/rules.ts";
import { fmt } from "../lib/text.ts";
import type { SectionName } from "../types.ts";
import { BuilderView } from "./builder/BuilderView.tsx";
import { CombatView } from "./combat/CombatView.tsx";
import { EdgeMenu } from "./combat/EdgeMenu.tsx";
import { QuickAddDrawer } from "./combat/QuickAddDrawer.tsx";
import { EncounterSwitcher } from "./EncounterSwitcher.tsx";
import {
  ChevronLeftIcon,
  CloseIcon,
  CollapseIcon,
  MenuIcon,
  MinusIcon,
  PlusIcon,
  PrepIcon,
  RedoIcon,
  RunIcon,
  NegotiateIcon,
  UndoIcon,
} from "./Icons.tsx";
import { NegotiationSwitcher } from "./negotiation/NegotiationSwitcher.tsx";
import { negotiationSummary } from "./negotiation/NegotiationTracks.tsx";
import { NegotiationView } from "./negotiation/NegotiationView.tsx";
import {
  AppSettingsPanel,
  AppSettingsButton,
  OwlbearDiceButton,
  OwlbearSendButton,
  OwlbearSendMenu,
} from "./OwlbearLink.tsx";
import { PenRing } from "./Pen.tsx";
import { PreviewDrawer } from "./PreviewDrawer.tsx";
import { RulePreview } from "./RulePreview.tsx";
import { Toast } from "./Toast.tsx";

/** Lazy-load heavy authoring/sharing modals on first open so initial load stays lean. */
function LazyModal({ open, load }: { open: boolean; load: () => Promise<ComponentType> }) {
  const [Comp, setComp] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!open || Comp) return;
    let cancelled = false;
    void load().then((loaded) => {
      if (!cancelled) setComp(() => loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [open, Comp, load]);
  if (!open || !Comp) return null;
  return <Comp />;
}

const loadHomebrewStudio = () =>
  import("./homebrew/HomebrewStudio.tsx").then((m) => m.HomebrewStudio);
const loadCustomMaliceDialog = () =>
  import("./homebrew/CustomMaliceDialog.tsx").then((m) => m.CustomMaliceDialog);
const loadShareDialog = () => import("./homebrew/ShareDialog.tsx").then((m) => m.ShareDialog);
const loadImportDialog = () => import("./homebrew/ImportDialog.tsx").then((m) => m.ImportDialog);

type IconProps = { class?: string };

/** The horned M: the original emblem's letter (shoulder spikes, flared
    feet) recut at a display weight that sits beside Poppins ExtraBold. Font
    units, baseline at y=0; horns tuck behind the shoulders, eyes glare from
    the notch. */
function BrandM({ class: cls }: IconProps) {
  return (
    <svg class={cls} viewBox="-12 -1018 868 1018" aria-hidden="true">
      <g class="brand-m-horns">
        <path d="M337-550C250-637 150-682 111-771C76-852 111-938 165-1018C89-979 25-912 4-831C-22-726 30-637 132-576C162-557 184-535 196-508C222-538 261-556 296-546L337-550Z" />
        <path d="M507-550C594-637 694-682 732-771C768-852 732-938 679-1018C755-979 820-912 840-831C866-726 814-637 713-576C683-557 661-535 647-508C621-538 583-556 547-546L507-550Z" />
      </g>
      <path
        fill="currentColor"
        d="M-12-716L160-630L422-233L683-630L856-716L763-581L763-128C763-62 788-25 837 0L541 0C591-25 615-62 615-128L615-243L455 0L388 0L228-243L228-128C228-62 253-25 302 0L6 0C55-25 80-62 80-128L80-581Z"
      />
      <g class="brand-m-eyes">
        <path d="M243-545C316-523 370-481 395-422C332-441 282-483 243-545Z" />
        <path d="M600-545C528-523 473-481 449-422C512-441 561-483 600-545Z" />
      </g>
    </svg>
  );
}

/** The title page: the horned M stands as the initial of "Malice", set on
    the same baseline as the rest of the word, with "Menagerie" beneath. */
function Wordmark() {
  return (
    <div class="wordmark" role="img" aria-label="Malice Menagerie">
      <span class="wordmark-malice" aria-hidden="true">
        <BrandM class="wordmark-m" />
        alice
      </span>
      <span class="wordmark-menagerie" aria-hidden="true">
        Menagerie
      </span>
    </div>
  );
}

/** A slim vertical roster shown in the collapsed rail so encounters remain
    switchable without expanding. Each tab shows the encounter's initial. */
function CollapsedEncounters() {
  const { encounters, activeEncounterId } = state.value;
  return (
    <div class="rail-encounters">
      {encounters.map((enc) => {
        const active = enc.id === activeEncounterId;
        const initial = enc.name.trim().charAt(0).toUpperCase() || "?";
        return (
          <button
            key={enc.id}
            class={`rail-encounter ${active ? "active" : ""}`}
            title={enc.name}
            aria-label={enc.name}
            aria-current={active ? "true" : undefined}
            onClick={() => selectEncounter(enc.id)}
          >
            {initial}
          </button>
        );
      })}
      <button
        class="rail-encounter rail-encounter-new"
        title="New encounter"
        aria-label="New encounter"
        onClick={() => createEncounter()}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function railLabel(name: string, collided: boolean): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (!collided) return trimmed.charAt(0).toUpperCase();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]!.charAt(0)}${words[1]!.charAt(0)}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

/** A slim vertical roster shown in the collapsed rail on the Talk page so
    NPCs stay switchable and Quick Create stays one tap away. */
function CollapsedNegotiations() {
  const { negotiations, activeNegotiationId } = state.value;
  const creating = creatingNegotiation.value;
  const counts = new Map<string, number>();
  for (const neg of negotiations) {
    const ch = neg.name.trim().charAt(0).toUpperCase() || "?";
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return (
    <div class="rail-encounters">
      {negotiations.map((neg) => {
        const active = !creating && neg.id === activeNegotiationId;
        const ch = neg.name.trim().charAt(0).toUpperCase() || "?";
        const label = railLabel(neg.name, (counts.get(ch) ?? 0) > 1);
        const full = `${neg.name || "Untitled NPC"} · ${negotiationSummary(neg)}`;
        return (
          <button
            key={neg.id}
            class={`rail-encounter ${active ? "active" : ""}`}
            title={full}
            aria-label={full}
            aria-current={active ? "true" : undefined}
            onClick={() => selectNegotiation(neg.id)}
          >
            {label}
          </button>
        );
      })}
      <button
        class={`rail-encounter rail-encounter-new ${creating ? "active" : ""}`}
        title="New NPC"
        aria-label="New NPC"
        onClick={openNewNegotiation}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

const NAV_ITEMS: {
  section: SectionName;
  label: string;
  icon: (props: IconProps) => preact.JSX.Element;
}[] = [
  { section: "encounters", label: "Encounters", icon: RunIcon },
  { section: "negotiations", label: "Negotiations", icon: NegotiateIcon },
];

function NavButtons({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const section = activeSection();
  const encounterCount = state.value.encounters.length;
  const talks = state.value.negotiations.length;
  return (
    <nav class="nav">
      {NAV_ITEMS.map(({ section: target, label, icon: Icon }) => {
        const active = section === target;
        const badge =
          target === "encounters" && encounterCount > 0
            ? encounterCount
            : target === "negotiations" && talks > 0
              ? talks
              : null;
        return (
          <button
            key={target}
            class={`nav-button ${active ? "active" : ""}`}
            aria-current={active ? "page" : undefined}
            aria-label={label}
            title={collapsed ? label : undefined}
            onClick={() => {
              setSection(target);
              onNavigate?.();
            }}
          >
            <Icon class="nav-icon" />
            <b>{label}</b>
            {badge !== null && <i>{badge}</i>}
          </button>
        );
      })}
    </nav>
  );
}

function Sidebar() {
  const collapsed = state.value.ui.sidebarCollapsed;
  const isTalk = activeSection() === "negotiations";
  return (
    <aside class={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div class="brand">
        {collapsed ? (
          <span class="brand-emblem" role="img" aria-label="Malice Menagerie">
            <BrandM class="wordmark-m" />
          </span>
        ) : (
          <Wordmark />
        )}
      </div>
      <NavButtons collapsed={collapsed} />
      {collapsed ? (
        isTalk ? (
          <CollapsedNegotiations />
        ) : (
          <CollapsedEncounters />
        )
      ) : isTalk ? (
        <NegotiationSwitcher />
      ) : (
        <EncounterSwitcher />
      )}
      <div class="spine-foot">
        <AppSettingsButton collapsed={collapsed} />
        <button
          class="spine-button sidebar-collapse"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleSidebar}
        >
          <CollapseIcon class="collapse-icon" />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function MobileNav() {
  const open = mobileNavOpen.value;
  const isTalk = activeSection() === "negotiations";
  const close = () => setMobileNav(false);
  return (
    <div class={`mobile-nav ${open ? "open" : ""}`}>
      <div class="mobile-nav-backdrop" onClick={close} />
      <aside class="mobile-nav-panel" role="dialog" aria-modal="true" aria-label="Navigation">
        <div class="mobile-nav-head">
          <Wordmark />
          <button class="icon-button mobile-nav-close" aria-label="Close menu" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        <NavButtons collapsed={false} onNavigate={close} />
        {isTalk ? (
          <NegotiationSwitcher onNavigate={close} />
        ) : (
          <EncounterSwitcher onNavigate={close} />
        )}
        <div class="spine-foot">
          <AppSettingsButton onOpen={close} />
        </div>
      </aside>
    </div>
  );
}

function CombatControls() {
  const enc = activeEncounter();
  const combat = enc.combat;
  // Counted in turns, so a solo's second turn keeps the round open.
  const acted = combat.instances.reduce((sum, instance) => sum + instance.turnsTaken, 0);
  const total = combat.instances.reduce((sum, instance) => sum + instance.turns, 0);
  const nextGain = enc.party.heroes + combat.round + 1;
  const undoGain = enc.party.heroes + combat.round;
  const atStart = combat.round <= 1;
  const complete = total > 0 && acted === total;
  return (
    <div class="combat-controls">
      <div
        class="malice-counter"
        title={`${combat.malice} Malice in the pool · next round adds ${nextGain}`}
      >
        <span class="malice-counter-label">Malice</span>
        <button class="square" aria-label="Decrease Malice" onClick={() => adjustMalice(-1)}>
          <MinusIcon />
        </button>
        <strong>{combat.malice}</strong>
        <button class="square" aria-label="Increase Malice" onClick={() => adjustMalice(1)}>
          <PlusIcon />
        </button>
        <span class="malice-next">+{nextGain} next</span>
      </div>
      <div class="round-progress">
        <div
          class={`acted-tally ${complete ? "complete" : ""}`}
          title={`${acted} of ${total} turns taken this round`}
        >
          <span class="acted-tally-label">Acted</span>
          <strong>
            {acted}
            <i>/{total}</i>
            {complete ? <PenRing key={combat.round} seed={`acted:${combat.round}`} /> : null}
          </strong>
        </div>
        <button
          class="secondary compact-button prev-round"
          disabled={atStart}
          aria-label={atStart ? "Previous round" : `Back to round ${combat.round - 1}`}
          title={
            atStart
              ? "Already on round 1"
              : `Step back to round ${combat.round - 1} · −${undoGain} Malice`
          }
          onClick={previousRound}
        >
          <ChevronLeftIcon />
        </button>
        <button class="primary" disabled={!combat.instances.length} onClick={nextRound}>
          Next round
        </button>
      </div>
    </div>
  );
}

/** Two-lens toggle anchored in the encounter running head: Prep (browse,
    balance, groups) and Run (live statblocks, Stamina, Malice). */
function EncounterLensSwitch() {
  const lens = activeEncounter().view;
  return (
    <div class="lens-switch" role="group" aria-label="Encounter view">
      <button
        type="button"
        class={lens === "builder" ? "active" : undefined}
        aria-pressed={lens === "builder"}
        title="Prep: browse library, balance EV, and arrange groups"
        onClick={() => setView("builder")}
      >
        <PrepIcon />
        <span>Prep</span>
      </button>
      <button
        type="button"
        class={lens === "combat" ? "active" : undefined}
        aria-pressed={lens === "combat"}
        title="Run: live combat board, Stamina, turns, and Malice"
        onClick={() => setView("combat")}
      >
        <RunIcon />
        <span>Run</span>
      </button>
    </div>
  );
}

function Topbar() {
  const enc = activeEncounter();
  const combat = enc.combat;
  const view = activeView();
  const isBuilder = view === "builder";
  const isTalk = view === "talk";
  const isCombat = view === "combat";
  const undoGain = enc.party.heroes + combat.round;
  const negotiation = activeNegotiation();
  const creating = creatingNegotiation.value;
  const totals = isBuilder ? encounterTotals() : null;
  const party = isBuilder ? partyMath(enc.party) : null;
  const difficulty =
    totals && party ? difficultyFor(totals.ev, party.partyES, party.oneHeroES) : null;
  const builderLegend =
    totals && difficulty && totals.count > 0
      ? `${totals.count} ${totals.count === 1 ? "enemy" : "enemies"} · EV ${fmt(totals.ev)} · ${difficulty.label}`
      : "Empty";
  const legend = isTalk
    ? creating
      ? "Quick create"
      : negotiation
        ? `${negotiation.name || "Untitled NPC"} · ${negotiationSummary(negotiation)}`
        : "No one to talk to"
    : isBuilder
      ? builderLegend
      : enc.name;
  return (
    <header class={`topbar${isTalk ? " topbar-talk" : " topbar-encounter"}`}>
      <button
        class="icon-button menu-toggle"
        aria-label="Open menu"
        onClick={() => setMobileNav(true)}
      >
        <MenuIcon />
      </button>
      <div class="topbar-title">
        <div class="topbar-heading">
          {isCombat && combat.round > 1 ? (
            <button
              class="icon-button round-back"
              aria-label={`Back to round ${combat.round - 1}`}
              title={`Step back to round ${combat.round - 1} · −${undoGain} Malice`}
              onClick={previousRound}
            >
              <ChevronLeftIcon />
            </button>
          ) : null}
          <h1 title={isBuilder ? enc.name : undefined}>
            {isTalk ? "Negotiation" : isBuilder ? enc.name : `Round ${combat.round}`}
          </h1>
        </div>
        {/* The running head carries the negotiation's state while the sheet
            is scrolled below it. When the tracks move, the pen writes the
            new line again — the key remounts the span so the stroke
            redraws, the way a mark is drawn when it lands. */}
        <span
          class={`topbar-legend${isTalk ? " legend-write" : ""}`}
          key={isTalk ? `talk:${legend}` : "legend"}
          title={isTalk ? (negotiation?.name ?? "") : isBuilder ? builderLegend : enc.name}
        >
          {legend}
        </span>
      </div>
      {!isTalk ? <EncounterLensSwitch /> : null}
      <div class="top-actions">
        <OwlbearDiceButton />
        {!isTalk ? <OwlbearSendButton /> : null}
        {isBuilder ? (
          <div class="history-controls" role="group" aria-label="Undo and redo">
            <button
              class="icon-button"
              disabled={!canUndo.value}
              aria-label={canUndo.value ? `Undo: ${undoLabel.value}` : "Nothing to undo"}
              title={canUndo.value ? `Undo: ${undoLabel.value} (Ctrl/Cmd+Z)` : "Nothing to undo"}
              onClick={undoStep}
            >
              <UndoIcon />
            </button>
            <button
              class="icon-button"
              disabled={!canRedo.value}
              aria-label={canRedo.value ? `Redo: ${redoLabel.value}` : "Nothing to redo"}
              title={canRedo.value ? `Redo: ${redoLabel.value} (Ctrl+Y)` : "Nothing to redo"}
              onClick={redoStep}
            >
              <RedoIcon />
            </button>
          </div>
        ) : isTalk ? (
          !creating && negotiation ? (
            <button class="primary talk-new-btn" aria-label="New NPC" onClick={openNewNegotiation}>
              <PlusIcon />
              <span>
                New<span class="talk-new-suffix"> NPC</span>
              </span>
            </button>
          ) : null
        ) : (
          <CombatControls />
        )}
      </div>
    </header>
  );
}

/** The colophon's backlist: sibling tools for other tables. */
const BACKLIST = [
  {
    title: "RED//OPS",
    blurb: "NPC generator and encounter tracker for Cyberpunk RED",
    href: "https://red-ops.pages.dev",
  },
  {
    title: "Legend Ledger",
    blurb: "Character sheet and play companion for Legend in the Mist",
    href: "https://legend-ledger.pages.dev",
  },
  {
    title: "Daggerheart Toolkit",
    blurb: "Obsidian plugin for Daggerheart statblocks, encounters and Fear",
    href: "https://github.com/Eppinguin/obsidian-daggerheart-toolkit",
  },
];

export function App() {
  const view = activeView();
  const activeNegId = state.value.activeNegotiationId;
  const creating = creatingNegotiation.value;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(installPhoneScroll, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (event.key === "Escape") {
        // Modals/popovers with their own Escape listeners close first; peel the
        // remaining board layers one at a time.
        if (
          document.querySelector(
            ".hb-modal-overlay, .hb-studio-overlay, .preview-drawer.open, .owlbear-panel, .edge-menu, .owlbear-send-menu",
          )
        ) {
          return;
        }
        if (mobileNavOpen.value) {
          setMobileNav(false);
          return;
        }
        if (openConditionPickerFor.value) {
          openConditionPickerFor.value = null;
          return;
        }
        if (quickAddOpen.value) {
          closeQuickAdd();
          return;
        }
      }

      // Do not fire global background shortcuts while a homebrew studio or modal is open.
      if (
        homebrewStudioState.value ||
        customMaliceEditorState.value ||
        shareDialogState.value ||
        importDialogState.value
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const pristineStamina =
        target instanceof HTMLInputElement && target.dataset["pristine"] === "true";

      // Ctrl/Cmd+Z undo, Ctrl+Y / Shift+Cmd+Z redo (Prep & Run views).
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (key === "z" || key === "y") &&
        (!typing || pristineStamina) &&
        activeView() !== "talk"
      ) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) redoStep();
        else undoStep();
        return;
      }

      // `/` or Ctrl/Cmd+K: in Run, toggle Quick-Add drawer; in Prep, focus search.
      const isQuickAddSearchEmpty =
        target instanceof HTMLInputElement && target.id === "quickAddSearch" && !target.value;
      const slashTrigger =
        event.key === "/" && !event.metaKey && !event.ctrlKey && (!typing || isQuickAddSearchEmpty);
      const kTrigger = (event.metaKey || event.ctrlKey) && !event.altKey && key === "k";
      if (slashTrigger || kTrigger) {
        const currentView = activeView();
        if (currentView === "combat") {
          event.preventDefault();
          toggleQuickAdd();
        } else if (currentView === "builder") {
          event.preventDefault();
          const input = document.getElementById("prepLibrarySearch") as HTMLInputElement | null;
          input?.focus();
          input?.select();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const hasJsonFile = (event: DragEvent) =>
      Boolean(event.dataTransfer?.types && Array.from(event.dataTransfer.types).includes("Files"));
    const onDragOver = (event: DragEvent) => {
      if (hasJsonFile(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasJsonFile(event)) return;
      event.preventDefault();
      const file = Array.from(event.dataTransfer?.files ?? []).find(
        (f) => f.name.toLowerCase().endsWith(".json") || f.type === "application/json",
      );
      if (!file) {
        toast("Drop a .json file to import.");
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        toast("That file is too large to import safely (4 MB limit).");
        return;
      }
      void file
        .text()
        .then((text) => openImportFromText(text, file.name.replace(/\.json$/i, "")))
        .catch(() => toast("Could not read that file."));
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
  useEffect(() => {
    if (view !== "talk") return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, [view, activeNegId, creating]);
  return (
    <>
      <div class={`app-shell ${quickAddOpen.value && view === "combat" ? "quick-add-open" : ""}`}>
        <Sidebar />
        <MobileNav />
        <main class="main">
          <Topbar />
          <div class="main-scroll" ref={scrollRef}>
            <BuilderView active={view === "builder"} />
            <CombatView active={view === "combat"} />
            <NegotiationView active={view === "talk"} />
            <footer class="colophon">
              <section class="backlist" aria-labelledby="backlist-title">
                <h2 id="backlist-title">More tools for the table</h2>
                <ul>
                  {BACKLIST.map((entry) => (
                    <li key={entry.href}>
                      <a href={entry.href} target="_blank" rel="noreferrer">
                        <strong>{entry.title}</strong>
                        <span>{entry.blurb}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
              <p class="imprint">
                Malice Menagerie <span aria-hidden="true">·</span> AGPL-3.0{" "}
                <span aria-hidden="true">·</span>{" "}
                <a
                  class="rule-link"
                  href="https://github.com/Eppinguin/malice-menagerie"
                  target="_blank"
                  rel="noreferrer"
                >
                  Source on GitHub
                </a>
              </p>
              <p>
                Malice Menagerie is an independent product published under the{" "}
                <a
                  class="rule-link"
                  href="https://www.mcdmproductions.com/draw-steel-creator-license"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span class="trademark">DRAW STEEL</span> Creator License
                </a>{" "}
                and is not affiliated with MCDM&nbsp;Productions,&nbsp;LLC.
              </p>
              <p>
                <a class="rule-link" href="https://drawsteel.com" target="_blank" rel="noreferrer">
                  <span class="trademark">DRAW STEEL</span>
                </a>{" "}
                © 2026 MCDM&nbsp;Productions,&nbsp;LLC.
              </p>
              <p>
                Game data is bundled from{" "}
                <a
                  class="rule-link"
                  href="https://github.com/SteelCompendium/data-unified"
                  target="_blank"
                  rel="noreferrer"
                >
                  SteelCompendium/data-unified
                </a>
                {sourceSnapshot.value
                  ? ` (snapshot ${sourceSnapshot.value.generatedAt.slice(0, 10)})`
                  : ""}
                . Draw Steel Glyphs font © 2025 MCDM&nbsp;Productions, licensed under{" "}
                <a
                  class="rule-link"
                  href="https://creativecommons.org/licenses/by-sa/4.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC&nbsp;BY-SA&nbsp;4.0
                </a>
                .
              </p>
              <p class="compat-badge">
                <a
                  href="https://www.mcdmproductions.com/draw-steel-creator-license"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Powered by Draw Steel — Draw Steel Creator License"
                >
                  <img
                    src="/powered-by-draw-steel.webp"
                    alt=""
                    width="1626"
                    height="318"
                    loading="lazy"
                  />
                </a>
              </p>
            </footer>
          </div>
        </main>
        <AppSettingsPanel />
      </div>
      <QuickAddDrawer />
      <PreviewDrawer />
      <RulePreview />
      <EdgeMenu />
      <OwlbearSendMenu />
      <LazyModal open={homebrewStudioState.value !== null} load={loadHomebrewStudio} />
      <LazyModal open={customMaliceEditorState.value !== null} load={loadCustomMaliceDialog} />
      <LazyModal open={shareDialogState.value !== null} load={loadShareDialog} />
      <LazyModal open={importDialogState.value !== null} load={loadImportDialog} />
      <Toast />
    </>
  );
}
