import { clearEncounter, resetApp, setView, startCombat, state } from '../store.ts';
import { BuilderView } from './builder/BuilderView.tsx';
import { CombatView } from './combat/CombatView.tsx';
import { PreviewDrawer } from './PreviewDrawer.tsx';
import { Toast } from './Toast.tsx';

function Sidebar() {
  const view = state.value.ui.view;
  const combatCount = state.value.combat.instances.length;
  return (
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-wordmark" src="/malice-menagerie-wordmark.svg" alt="Malice Menagerie" />
      </div>
      <nav>
        <button class={`nav-button ${view === 'builder' ? 'active' : ''}`} onClick={() => setView('builder')}>
          <span>01</span><b>Prep</b>
        </button>
        <button class={`nav-button ${view === 'combat' ? 'active' : ''}`} onClick={() => setView('combat')}>
          <span>02</span><b>Run</b><i>{combatCount}</i>
        </button>
      </nav>
      <button class="text-button" onClick={resetApp}>Reset encounter</button>
    </aside>
  );
}

function Topbar() {
  const combat = state.value.combat;
  const isBuilder = state.value.ui.view === 'builder';
  return (
    <header class="topbar">
      <div>
        <p class="eyebrow">{isBuilder ? 'ENCOUNTER' : 'COMBAT'}</p>
        <h1>{isBuilder ? 'Prep' : `Round ${combat.round}`}</h1>
      </div>
      <div class="top-actions">
        {isBuilder ? (
          <>
            <button class="secondary" onClick={clearEncounter}>Clear</button>
            <button class="primary" disabled={!state.value.encounter.length} onClick={() => void startCombat()}>Run encounter</button>
          </>
        ) : null}
      </div>
    </header>
  );
}

export function App() {
  const view = state.value.ui.view;
  return (
    <>
      <div class="app-shell">
        <Sidebar />
        <main class="main">
          <Topbar />
          <BuilderView active={view === 'builder'} />
          <CombatView active={view === 'combat'} />
        </main>
      </div>
      <PreviewDrawer />
      <Toast />
      <footer>
        Malice Menagerie is an independent product published under the DRAW STEEL Creator License and is not affiliated with
        MCDM Productions, LLC. DRAW STEEL © 2026 MCDM Productions, LLC. Game data is loaded from SteelCompendium/data-unified.
      </footer>
    </>
  );
}
