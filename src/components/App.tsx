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
import type { ViewName } from '../types.ts';
import { BuilderView } from './builder/BuilderView.tsx';
import { CombatView } from './combat/CombatView.tsx';
import { EncounterSwitcher } from './EncounterSwitcher.tsx';
import { PreviewDrawer } from './PreviewDrawer.tsx';
import { Toast } from './Toast.tsx';

type IconProps = { class?: string };

/** Prep = building the encounter: a pencil, editing the roster before combat. */
function PrepIcon({ class: cls }: IconProps) {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/** Run = running combat: a play triangle. */
function RunIcon({ class: cls }: IconProps) {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 4.5v15l13-7.5z" />
    </svg>
  );
}

function CollapseIcon({ class: cls }: IconProps) {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function MenuIcon({ class: cls }: IconProps) {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function CloseIcon({ class: cls }: IconProps) {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

function PlusIcon({ class: cls }: IconProps) {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** A slim vertical roster shown in the collapsed rail so encounters remain
    switchable without expanding. Each pill shows the encounter's initial. */
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
        <PlusIcon class="rail-plus" />
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

function Sidebar() {
  const collapsed = state.value.ui.sidebarCollapsed;
  return (
    <aside class={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div class="brand">
        <img class="brand-wordmark" src="/malice-menagerie-wordmark.svg" alt="Malice Menagerie" />
        <img class="brand-emblem" src="/malice-menagerie-teal.svg" alt="Malice Menagerie" />
      </div>
      <NavButtons collapsed={collapsed} />
      {collapsed ? <CollapsedEncounters /> : <EncounterSwitcher />}
      <button
        class="sidebar-collapse"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={toggleSidebar}
      >
        <CollapseIcon class="collapse-icon" />
        {!collapsed && <span>Collapse</span>}
      </button>
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
          <img class="brand-wordmark" src="/malice-menagerie-wordmark.svg" alt="Malice Menagerie" />
          <button class="icon-button mobile-nav-close" aria-label="Close menu" onClick={close}>
            <CloseIcon class="collapse-icon" />
          </button>
        </div>
        <NavButtons collapsed={false} onNavigate={close} />
        <EncounterSwitcher />
      </aside>
    </div>
  );
}

function CombatControls() {
  const combat = activeEncounter().combat;
  const acted = combat.instances.filter(instance => instance.acted).length;
  const total = combat.instances.length;
  const nextGain = activeEncounter().party.heroes + combat.round + 1;
  const undoGain = activeEncounter().party.heroes + combat.round;
  const atStart = combat.round <= 1;
  return (
    <div class="combat-controls">
      <button
        class="secondary compact-button"
        disabled={atStart}
        title={atStart ? 'Already on round 1' : `Undo last round · −${undoGain} Malice`}
        onClick={previousRound}
      >← Prev round</button>
      <div class="malice-counter" title={`Next round +${nextGain}`}>
        <span class="malice-counter-label">MALICE</span>
        <button class="square" aria-label="Decrease Malice" onClick={() => adjustMalice(-1)}>−</button>
        <strong>{combat.malice}</strong>
        <button class="square" aria-label="Increase Malice" onClick={() => adjustMalice(1)}>+</button>
      </div>
      <div class="round-progress">
        <div class={`acted-tally ${total > 0 && acted === total ? 'complete' : ''}`} title={`${acted} of ${total} creatures have acted`}>
          <span class="acted-tally-label">ACTED</span>
          <strong>{acted}<i>/{total}</i></strong>
        </div>
        <button class="primary" onClick={nextRound}>Next round →</button>
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
        <MenuIcon class="collapse-icon" />
      </button>
      <div class="topbar-title">
        <p class="eyebrow">{isBuilder ? enc.name.toUpperCase() : `COMBAT · +${enc.party.heroes + combat.round + 1} malice next round`}</p>
        <h1>{isBuilder ? 'Prep' : `Round ${combat.round}`}</h1>
      </div>
      <div class="top-actions">
        {isBuilder ? (
          combatActive ? (
            <>
              <button
                class="secondary"
                title="Rebuild the roster from Prep, discarding current stamina, conditions, and Malice"
                onClick={() => void startCombat()}
              >Restart</button>
              <button class="primary" onClick={resumeCombat}>Resume combat</button>
            </>
          ) : (
            <button class="primary" disabled={!activeEncounter().items.length} onClick={() => void startCombat()}>Run encounter</button>
          )
        ) : (
          <CombatControls />
        )}
      </div>
    </header>
  );
}

export function App() {
  const view = activeEncounter().view;
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
            <footer>
              Malice Menagerie is an independent product published under the DRAW STEEL Creator License and is not affiliated with
              MCDM Productions, LLC. DRAW STEEL © 2026 MCDM Productions, LLC. Game data is loaded from SteelCompendium/data-unified.
            </footer>
          </div>
        </main>
      </div>
      <PreviewDrawer />
      <Toast />
    </>
  );
}
