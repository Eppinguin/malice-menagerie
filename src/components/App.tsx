import {
  activeEncounter,
  adjustMalice,
  createEncounter,
  mobileNavOpen,
  nextRound,
  previousRound,
  resumeCombat,
  selectEncounter,
  setMobileNav,
  setView,
  startCombat,
  state,
  toggleSidebar,
} from '../store.ts';
import { useEffect } from 'preact/hooks';
import { installPhoneScroll } from '../lib/phoneScroll.ts';
import { pageTheme, togglePageTheme } from '../theme.ts';
import type { ViewName } from '../types.ts';
import { BuilderView } from './builder/BuilderView.tsx';
import { CombatView } from './combat/CombatView.tsx';
import { EdgeMenu } from './combat/EdgeMenu.tsx';
import { EncounterSwitcher } from './EncounterSwitcher.tsx';
import {
  CloseIcon,
  CollapseIcon,
  MenuIcon,
  MinusIcon,
  MoonIcon,
  PlusIcon,
  PrepIcon,
  RunIcon,
  SunIcon,
  UndoIcon,
} from './Icons.tsx';
import { PenRing } from './Pen.tsx';
import { PreviewDrawer } from './PreviewDrawer.tsx';
import { RulePreview } from './RulePreview.tsx';
import { Toast } from './Toast.tsx';

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
      <span class="wordmark-menagerie" aria-hidden="true">Menagerie</span>
    </div>
  );
}

/** A slim vertical roster shown in the collapsed rail so encounters remain
    switchable without expanding. Each tab shows the encounter's initial. */
function CollapsedEncounters() {
  const { encounters, activeEncounterId } = state.value;
  return (
    <div class="rail-encounters">
      {encounters.map(enc => {
        const active = enc.id === activeEncounterId;
        const initial = enc.name.trim().charAt(0).toUpperCase() || '?';
        return (
          <button
            key={enc.id}
            class={`rail-encounter ${active ? 'active' : ''}`}
            title={enc.name}
            aria-label={enc.name}
            aria-current={active ? 'true' : undefined}
            onClick={() => selectEncounter(enc.id)}
          >
            {initial}
          </button>
        );
      })}
      <button class="rail-encounter rail-encounter-new" title="New encounter" aria-label="New encounter" onClick={() => createEncounter()}>
        <PlusIcon />
      </button>
    </div>
  );
}

const NAV_ITEMS: { view: ViewName; label: string; icon: (props: IconProps) => preact.JSX.Element }[] = [
  { view: 'builder', label: 'Prep', icon: PrepIcon },
  { view: 'combat', label: 'Run', icon: RunIcon },
];

function NavButtons({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const view = activeEncounter().view;
  const combatCount = activeEncounter().combat.instances.length;
  return (
    <nav class="nav">
      {NAV_ITEMS.map(({ view: target, label, icon: Icon }) => {
        const active = view === target;
        const badge = target === 'combat' && combatCount > 0 ? combatCount : null;
        return (
          <button
            key={target}
            class={`nav-button ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            title={collapsed ? label : undefined}
            onClick={() => {
              setView(target);
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

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const night = pageTheme.value === 'night';
  const label = night ? 'Day page' : 'Night page';
  return (
    <button class="spine-button" title={label} aria-label={`Switch to ${label.toLowerCase()}`} onClick={togglePageTheme}>
      {night ? <SunIcon /> : <MoonIcon />}
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

function Sidebar() {
  const collapsed = state.value.ui.sidebarCollapsed;
  return (
    <aside class={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div class="brand">
        {collapsed ? <span class="brand-emblem" role="img" aria-label="Malice Menagerie"><BrandM class="wordmark-m" /></span> : <Wordmark />}
      </div>
      <NavButtons collapsed={collapsed} />
      {collapsed ? <CollapsedEncounters /> : <EncounterSwitcher />}
      <div class="spine-foot">
        <ThemeToggle collapsed={collapsed} />
        <button
          class="spine-button sidebar-collapse"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
  const close = () => setMobileNav(false);
  return (
    <div class={`mobile-nav ${open ? 'open' : ''}`}>
      <div class="mobile-nav-backdrop" onClick={close} />
      <aside class="mobile-nav-panel" role="dialog" aria-modal="true" aria-label="Navigation">
        <div class="mobile-nav-head">
          <Wordmark />
          <button class="icon-button mobile-nav-close" aria-label="Close menu" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        <NavButtons collapsed={false} onNavigate={close} />
        <EncounterSwitcher />
        <div class="spine-foot">
          <ThemeToggle collapsed={false} />
        </div>
      </aside>
    </div>
  );
}

function CombatControls() {
  const combat = activeEncounter().combat;
  // Counted in turns, so a solo's second turn keeps the round open.
  const acted = combat.instances.reduce((sum, instance) => sum + instance.turnsTaken, 0);
  const total = combat.instances.reduce((sum, instance) => sum + instance.turns, 0);
  const nextGain = activeEncounter().party.heroes + combat.round + 1;
  const undoGain = activeEncounter().party.heroes + combat.round;
  const atStart = combat.round <= 1;
  const complete = total > 0 && acted === total;
  return (
    <div class="combat-controls">
      <button
        class="secondary compact-button prev-round"
        disabled={atStart}
        aria-label="Previous round"
        title={atStart ? 'Already on round 1' : `Undo last round · −${undoGain} Malice`}
        onClick={previousRound}
      >
        <UndoIcon />
        <span class="prev-round-label">Prev round</span>
      </button>
      <div class="malice-counter" title={`${combat.malice} Malice in the pool · next round adds ${nextGain}`}>
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
        <div class={`acted-tally ${complete ? 'complete' : ''}`} title={`${acted} of ${total} turns taken this round`}>
          <span class="acted-tally-label">Acted</span>
          <strong>
            {acted}
            <i>/{total}</i>
            {complete ? <PenRing key={combat.round} seed={`acted:${combat.round}`} /> : null}
          </strong>
        </div>
        <button class="primary" onClick={nextRound}>
          Next round
        </button>
      </div>
    </div>
  );
}

function Topbar() {
  const enc = activeEncounter();
  const combat = enc.combat;
  const isBuilder = enc.view === 'builder';
  const combatActive = combat.active && combat.instances.length > 0;
  return (
    <header class="topbar">
      <button class="icon-button menu-toggle" aria-label="Open menu" onClick={() => setMobileNav(true)}>
        <MenuIcon />
      </button>
      <div class="topbar-title">
        <h1>{isBuilder ? 'Prep' : `Round ${combat.round}`}</h1>
        <span class="topbar-legend" title={enc.name}>
          {enc.name}
        </span>
      </div>
      <div class="top-actions">
        {isBuilder ? (
          combatActive ? (
            <>
              <button
                class="secondary"
                title="Rebuild the roster from Prep, discarding current stamina, conditions, and Malice"
                onClick={() => void startCombat()}
              >
                Restart
              </button>
              <button class="primary" onClick={resumeCombat}>
                Resume combat
              </button>
            </>
          ) : (
            <button class="primary" disabled={!activeEncounter().items.length} onClick={() => void startCombat()}>
              Run encounter
            </button>
          )
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
    title: 'RED//OPS',
    blurb: 'NPC generator and encounter tracker for Cyberpunk RED',
    href: 'https://red-ops.pages.dev',
  },
  {
    title: 'Legend Ledger',
    blurb: 'Character sheet and play companion for Legend in the Mist',
    href: 'https://legend-ledger.pages.dev',
  },
  {
    title: 'Daggerheart Toolkit',
    blurb: 'Obsidian plugin for Daggerheart statblocks, encounters and Fear',
    href: 'https://github.com/Eppinguin/obsidian-daggerheart-toolkit',
  },
];

export function App() {
  const view = activeEncounter().view;
  useEffect(installPhoneScroll, []);
  return (
    <>
      <div class="app-shell">
        <Sidebar />
        <MobileNav />
        <main class="main">
          <Topbar />
          <div class="main-scroll">
            <BuilderView active={view === 'builder'} />
            <CombatView active={view === 'combat'} />
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
                Malice Menagerie <span aria-hidden="true">·</span> AGPL-3.0 <span aria-hidden="true">·</span>{' '}
                <a class="rule-link" href="https://github.com/Eppinguin/malice-menagerie" target="_blank" rel="noreferrer">
                  Source on GitHub
                </a>
              </p>
              <p>
                Malice Menagerie is an independent product published under the{' '}
                <a
                  class="rule-link"
                  href="https://www.mcdmproductions.com/draw-steel-creator-license"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span class="trademark">DRAW STEEL</span> Creator License
                </a>{' '}
                and is not affiliated with MCDM&nbsp;Productions,&nbsp;LLC.
              </p>
              <p>
                <a class="rule-link" href="https://drawsteel.com" target="_blank" rel="noreferrer">
                  <span class="trademark">DRAW STEEL</span>
                </a>{' '}
                © 2026 MCDM&nbsp;Productions,&nbsp;LLC.
              </p>
              <p>
                Game data is loaded from{' '}
                <a class="rule-link" href="https://github.com/SteelCompendium/data-unified" target="_blank" rel="noreferrer">
                  SteelCompendium/data-unified
                </a>
                . Draw Steel Glyphs font © 2025 MCDM&nbsp;Productions, licensed under{' '}
                <a class="rule-link" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
                  CC&nbsp;BY-SA&nbsp;4.0
                </a>
                .
              </p>
            </footer>
          </div>
        </main>
      </div>
      <PreviewDrawer />
      <RulePreview />
      <EdgeMenu />
      <Toast />
    </>
  );
}
