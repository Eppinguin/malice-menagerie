(() => {
  'use strict';

  const STORAGE_KEY = 'steel-table-v6';
  const REPO = {
    owner: 'SteelCompendium',
    name: 'data-unified',
    ref: 'main'
  };
  const API_ROOT = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;
  const RAW_ROOT = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.ref}/`;
  const BLOB_ROOT = `https://github.com/${REPO.owner}/${REPO.name}/blob/${REPO.ref}/`;
  const STATBLOCK_RE = /^en\/(unified)\/json\/monster\/(.+?)\/statblock\/([^/]+)\.json$/i;
  const CONDITION_RE = /^en\/unified\/json\/condition\/([^/]+)\.json$/i;
  const MAX_LIBRARY_RESULTS = 120;
  const CATALOG_CONCURRENCY = 12;
  const MALICE_CONCURRENCY = 8;
  const CONDITION_CONCURRENCY = 8;
  const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  const defaultState = () => ({
    party: { heroes: 5, level: 1, victories: 0, bonusMalice: 0 },
    groups: [
      { id: 'group-a', name: 'A' },
      { id: 'group-b', name: 'B' }
    ],
    activePrepGroupId: 'group-a',
    encounter: [],
    combat: {
      active: false,
      round: 1,
      malice: 0,
      instances: [],
      activeGroupFilter: null,
      activeEffects: [],
      selectedMaliceFeatureIds: [],
      maliceSelectionInitialized: false
    },
    ui: { view: 'builder', role: 'all', search: '', maliceLibraryOpen: false }
  });

  let state = loadState();
  let catalog = [];
  let catalogByPath = new Map();
  let maliceCandidates = [];
  let maliceFeatures = [];
  let conditionCatalog = [];
  let expandedMaliceFeatures = new Set();
  let openConditionPickerFor = null;
  let sourceLoading = true;
  let sourceError = '';
  let hydratedCount = 0;
  let hydrationErrors = 0;
  let maliceLoading = true;
  let renderLibraryQueued = false;
  let deferredLibraryRender = false;
  let prepDrag = null;
  let suppressPrepClickUntil = 0;
  let toastTimer;

  const monsterCache = new Map();
  const monsterPromises = new Map();
  const qtyDrafts = new Map();
  const lastRolls = new Map();
  const lastMaliceRolls = new Map();

  const $ = (id) => document.getElementById(id);
  const els = {
    navButtons: [...document.querySelectorAll('.nav-button')],
    views: [...document.querySelectorAll('.view')],
    pageEyebrow: $('pageEyebrow'),
    pageTitle: $('pageTitle'),
    clearEncounter: $('clearEncounter'),
    startCombat: $('startCombat'),
    startCombatInline: $('startCombatInline'),
    heroCount: $('heroCount'),
    heroLevel: $('heroLevel'),
    heroVictories: $('heroVictories'),
    bonusMalice: $('bonusMalice'),
    heroES: $('heroES'),
    partyES: $('partyES'),
    roundOneMalice: $('roundOneMalice'),
    monsterSearch: $('monsterSearch'),
    roleFilters: $('roleFilters'),
    dataStatus: $('dataStatus'),
    monsterLibrary: $('monsterLibrary'),
    addPrepGroup: $('addPrepGroup'),
    rosterGroups: $('rosterGroups'),
    prepNewGroupDrop: $('prepNewGroupDrop'),
    enemyCountPill: $('enemyCountPill'),
    currentEV: $('currentEV'),
    difficultyLabel: $('difficultyLabel'),
    budgetFill: $('budgetFill'),
    esMarker: $('esMarker'),
    difficultyHelp: $('difficultyHelp'),
    combatBadge: $('combatBadge'),
    backToBuilder: $('backToBuilder'),
    roundNumber: $('roundNumber'),
    maliceGainHint: $('maliceGainHint'),
    maliceMinus: $('maliceMinus'),
    maliceValue: $('maliceValue'),
    malicePlus: $('malicePlus'),
    actedSummary: $('actedSummary'),
    nextRound: $('nextRound'),
    combatGroupRail: $('combatGroupRail'),
    showAllGroups: $('showAllGroups'),
    maliceFeatures: $('maliceFeatures'),
    activeEffects: $('activeEffects'),
    combatBoard: $('combatBoard'),
    toast: $('toast'),
    resetApp: $('resetApp')
  };

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return parsed && typeof parsed === 'object' ? parsed : defaultState();
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    ensureStateIntegrity();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function ensureStateIntegrity() {
    if (!Array.isArray(state.groups) || !state.groups.length) state.groups = [{ id: uid('group'), name: 'A' }];
    if (!state.groups.some(g => g.id === state.activePrepGroupId)) state.activePrepGroupId = state.groups[0].id;
    if (!state.combat || typeof state.combat !== 'object') state.combat = defaultState().combat;
    if (!Array.isArray(state.combat.instances)) state.combat.instances = [];
    if (!Array.isArray(state.combat.activeEffects)) state.combat.activeEffects = [];
    if (!Array.isArray(state.combat.selectedMaliceFeatureIds)) state.combat.selectedMaliceFeatureIds = [];
    if (typeof state.combat.maliceSelectionInitialized !== 'boolean') state.combat.maliceSelectionInitialized = false;
    if (!state.ui) state.ui = defaultState().ui;
    if (typeof state.ui.maliceLibraryOpen !== 'boolean') state.ui.maliceLibraryOpen = false;
    if (!Array.isArray(state.encounter)) state.encounter = [];
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function richText(value) {
    let text = escapeHtml(value || '');
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return text.replace(/\n/g, '<br>');
  }

  function plainText(value) {
    return String(value || '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/[_`>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugToLabel(slug) {
    return String(slug || '')
      .split('-')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function familyLabel(path) {
    return path.split('/').filter(Boolean).map(slugToLabel).join(' · ');
  }

  function clampInt(value, min, max) {
    const n = Math.round(Number(value));
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
  }

  function fmt(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value ?? '—');
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  function signed(value) {
    const n = Number(value) || 0;
    return n > 0 ? `+${n}` : String(n);
  }

  function numberFrom(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : fallback;
  }

  function parseEv(value, organization) {
    if (typeof value === 'number') return { unit: value, label: fmt(value), suggestedQty: 1 };
    const text = String(value ?? '').trim();
    const total = numberFrom(text, 0);
    const minionMatch = text.match(/([\d.]+)\s+for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+minions?/i);
    if (minionMatch) {
      const countToken = minionMatch[2].toLowerCase();
      const count = Number(countToken) || WORD_NUMBERS[countToken] || 4;
      return { unit: Number(minionMatch[1]) / count, label: text, suggestedQty: count };
    }
    return { unit: total, label: text || fmt(total), suggestedQty: String(organization).toLowerCase() === 'minion' ? 4 : 1 };
  }

  function pathTokens(path) {
    return path.toLowerCase().split('/').filter(Boolean);
  }

  function sourceUrl(path) {
    return BLOB_ROOT + path.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/');
  }

  function rawUrl(path) {
    return RAW_ROOT + path.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/');
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json, application/json' } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function fetchRepositoryTree() {
    let response = await fetch(`${API_ROOT}/git/trees/${encodeURIComponent(REPO.ref)}?recursive=1`, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (response.ok) return response.json();

    const branch = await fetchJson(`${API_ROOT}/branches/${encodeURIComponent(REPO.ref)}`);
    const treeSha = branch?.commit?.commit?.tree?.sha;
    if (!treeSha) throw new Error('Could not resolve the SteelCompendium repository tree.');
    response = await fetch(`${API_ROOT}/git/trees/${treeSha}?recursive=1`, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error(`SteelCompendium tree request failed (${response.status}).`);
    return response.json();
  }

  function buildCatalogEntry(path) {
    const match = path.match(STATBLOCK_RE);
    if (!match) return null;
    return {
      path,
      book: match[1],
      familyPath: match[2],
      slug: match[3],
      derivedName: slugToLabel(match[3]),
      monster: null,
      error: false
    };
  }

  function isMaliceCandidatePath(path) {
    const lower = path.toLowerCase();
    if (lower === 'en/unified/json/rule/monster/malice.json') return true;
    return /^en\/unified\/json\/monster\/.+malice[^/]*\.json$/i.test(path);
  }

  async function loadSource() {
    sourceLoading = true;
    sourceError = '';
    renderSourceStatus();
    try {
      const tree = await fetchRepositoryTree();
      if (tree.truncated) throw new Error('The GitHub repository tree response was truncated.');
      const paths = (tree.tree || []).filter(item => item.type === 'blob' && typeof item.path === 'string').map(item => item.path);
      catalog = paths.map(buildCatalogEntry).filter(Boolean).sort((a, b) => a.derivedName.localeCompare(b.derivedName));
      catalogByPath = new Map(catalog.map(entry => [entry.path, entry]));
      maliceCandidates = paths.filter(isMaliceCandidatePath);
      conditionCatalog = paths
        .map(path => {
          const match = path.match(CONDITION_RE);
          return match ? { path, name: slugToLabel(match[1]), slug: match[1] } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      sourceLoading = false;
      renderSourceStatus();
      renderLibrary();
      hydrateCatalogInBackground();
      hydrateMaliceInBackground();
      hydrateConditionsInBackground();
      hydrateSavedStateSources();
    } catch (error) {
      sourceLoading = false;
      sourceError = error instanceof Error ? error.message : String(error);
      renderSourceStatus();
      renderLibrary();
    }
  }

  function normalizeMonster(raw, path) {
    const match = path.match(STATBLOCK_RE);
    const ev = parseEv(raw.ev, raw.organization);
    const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter(Boolean).map(String) : [];
    const features = Array.isArray(raw.features) ? raw.features.filter(Boolean) : [];
    return {
      id: path,
      path,
      book: match?.[1] || '',
      familyPath: match?.[2] || '',
      slug: match?.[3] || '',
      name: raw.name || slugToLabel(match?.[3] || ''),
      level: numberFrom(raw.level, 0),
      organization: raw.organization || '—',
      role: raw.role || '',
      ev: ev.unit,
      evLabel: ev.label,
      defaultQty: ev.suggestedQty,
      keywords,
      ancestry: keywords.join(', ') || familyLabel(match?.[2] || ''),
      size: raw.size ?? '—',
      speed: raw.speed ?? '—',
      stamina: Math.max(0, numberFrom(raw.stamina, 0)),
      stability: raw.stability ?? '—',
      freeStrike: raw.free_strike ?? raw.freeStrike ?? '—',
      movement: raw.movement || '—',
      chars: {
        M: raw.might ?? 0,
        A: raw.agility ?? 0,
        R: raw.reason ?? 0,
        I: raw.intuition ?? 0,
        P: raw.presence ?? 0
      },
      features,
      source: sourceUrl(path),
      raw
    };
  }

  async function loadMonster(path) {
    if (monsterCache.has(path)) return monsterCache.get(path);
    if (monsterPromises.has(path)) return monsterPromises.get(path);
    const promise = fetchJson(rawUrl(path))
      .then(raw => {
        const monster = normalizeMonster(raw, path);
        monsterCache.set(path, monster);
        const entry = catalogByPath.get(path);
        if (entry) entry.monster = monster;
        if (!qtyDrafts.has(path)) qtyDrafts.set(path, monster.defaultQty || 1);
        return monster;
      })
      .catch(error => {
        const entry = catalogByPath.get(path);
        if (entry) entry.error = true;
        throw error;
      })
      .finally(() => monsterPromises.delete(path));
    monsterPromises.set(path, promise);
    return promise;
  }

  async function runPool(items, limit, worker, onProgress) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
        if (onProgress) onProgress(index);
      }
    });
    await Promise.all(runners);
  }

  async function hydrateCatalogInBackground() {
    hydratedCount = 0;
    hydrationErrors = 0;
    renderSourceStatus();
    await runPool(catalog, CATALOG_CONCURRENCY, async entry => {
      if (monsterCache.has(entry.path)) {
        hydratedCount += 1;
        return;
      }
      try {
        await loadMonster(entry.path);
      } catch {
        hydrationErrors += 1;
      } finally {
        hydratedCount += 1;
        scheduleLibraryRender();
        renderSourceStatus();
      }
    });
    renderSourceStatus();
    renderLibrary();
    renderEncounter();
    renderCombat();
  }

  function maliceScope(path, raw) {
    const basic = /\/rule\/monster\/malice\.json$/i.test(path);
    if (basic) {
      return {
        scope: 'basic',
        family: 'basic',
        familyLabel: 'Basic Malice',
        minLevel: 0,
        blockName: raw?.name || 'Basic Malice'
      };
    }
    const match = path.match(/^en\/unified\/json\/monster\/([^/]+)/i);
    const family = match?.[1] || 'other';
    return {
      scope: 'family',
      family,
      familyLabel: slugToLabel(family),
      minLevel: Math.max(0, numberFrom(raw?.level, 0)),
      blockName: raw?.name || `${slugToLabel(family)} Malice`
    };
  }

  function maliceMetaFromDecoratedName(value) {
    const raw = String(value || '');
    if (!raw.includes('📏') && !raw.includes('🎯')) return {};
    const cleaned = raw.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    const parts = cleaned.split('|').map(part => part.trim());
    const distancePart = parts.find(part => part.includes('📏')) || '';
    const targetPart = parts.find(part => part.includes('🎯')) || '';
    return {
      distance: distancePart.replace(/^.*?📏\s*/, '').trim(),
      target: targetPart.replace(/^.*?🎯\s*/, '').trim()
    };
  }

  function mergeMaliceContinuation(previous, continuation) {
    const merged = { ...previous };
    const decorated = maliceMetaFromDecoratedName(continuation.name);
    for (const key of ['body', 'intro', 'power_roll', 'distance', 'target', 'usage']) {
      if ((merged[key] === undefined || merged[key] === null || merged[key] === '') && continuation[key] != null) merged[key] = continuation[key];
    }
    if (!merged.distance && decorated.distance) merged.distance = decorated.distance;
    if (!merged.target && decorated.target) merged.target = decorated.target;
    for (const key of ['effects', 'sections', 'keywords']) {
      const left = Array.isArray(merged[key]) ? merged[key] : [];
      const right = Array.isArray(continuation[key]) ? continuation[key] : [];
      if (left.length || right.length) merged[key] = [...left, ...right];
    }
    return merged;
  }

  function normalizeMaliceItems(items) {
    const merged = [];
    for (const rawItem of Array.isArray(items) ? items : []) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = { ...rawItem };
      const costText = String(item.cost || item.malice || '').trim();
      const hasContinuationContent = Boolean(
        item.power_roll || item.body || item.intro ||
        (Array.isArray(item.sections) && item.sections.length) ||
        (Array.isArray(item.effects) && item.effects.length)
      );
      // SteelCompendium occasionally emits the visual second row of a Malice feature
      // as a separate no-cost record. Treat it as continuation data for the priced row.
      if (!costText && hasContinuationContent && merged.length) {
        merged[merged.length - 1] = mergeMaliceContinuation(merged[merged.length - 1], item);
      } else {
        merged.push(item);
      }
    }
    return merged;
  }

  function labelledSection(section) {
    if (!section) return '';
    const text = section.text || section.body || section.effect || '';
    if (!text) return '';
    return section.label ? `**${section.label}:** ${text}` : text;
  }

  function inferMaliceRollLabel(item) {
    const searchable = [item.intro, item.body, ...(item.sections || []).map(labelledSection)].filter(Boolean).join(' ');
    const test = searchable.match(/\*\*(Might|Agility|Reason|Intuition|Presence) test\*\*/i);
    return test ? `${test[1]} test` : (item.power_roll?.roll || 'Power Roll');
  }

  function maliceEffectsFromItem(item) {
    const effects = Array.isArray(item.effects) ? item.effects.map(effect => ({ ...effect })) : [];
    const sections = Array.isArray(item.sections) ? item.sections.map(labelledSection).filter(Boolean) : [];
    const introText = [item.intro, item.body].filter(Boolean);

    if (item.power_roll?.tiers) {
      // A first section often contains the trigger/setup for the test and belongs before the tiers.
      if (sections.length && !introText.length) introText.push(sections.shift());
      introText.forEach(text => effects.push({ effect: text }));
      effects.push({
        roll: inferMaliceRollLabel(item),
        tier1: item.power_roll.tiers.low,
        tier2: item.power_roll.tiers.mid,
        tier3: item.power_roll.tiers.high
      });
      sections.forEach(text => effects.push({ effect: text }));
    } else {
      [...introText, ...sections].forEach(text => effects.push({ effect: text }));
    }
    return effects;
  }

  function flattenMalicePayload(raw, path) {
    const values = [];
    const scope = maliceScope(path, raw);
    const addFeature = (item, costText, effects) => {
      const cost = numberFrom(costText, 0);
      values.push({
        id: `${path}#${values.length}`,
        path,
        name: item.name,
        cost,
        costText: costText || (cost ? `${cost} Malice` : ''),
        effects,
        distance: item.distance || '',
        target: item.target || '',
        keywords: Array.isArray(item.keywords) ? item.keywords : [],
        source: sourceUrl(path),
        tokens: pathTokens(path),
        scope: scope.scope,
        family: scope.family,
        familyLabel: scope.familyLabel,
        minLevel: scope.minLevel,
        blockName: scope.blockName
      });
    };

    const parseMaliceMarkdown = (content) => {
      const pattern = />\s*\*\*([^*\n]+?)\s+\((\d+\+?)\s+Malice\)\*\*\s*\n>\s*\n>\s*([\s\S]*?)(?=\n>\s*\*\*[^*\n]+?\s+\(\d+\+?\s+Malice\)\*\*|\n#{3,6}\s+|$)/gi;
      let match;
      while ((match = pattern.exec(content))) {
        const body = match[3].replace(/^>\s?/gm, '').trim();
        addFeature({ name: match[1].trim() }, `${match[2]} Malice`, [{ effect: body }]);
      }
    };

    if (Array.isArray(raw?.features)) {
      normalizeMaliceItems(raw.features).forEach(item => {
        const costText = String(item.cost || item.malice || '');
        if (!item.name || !costText) return;
        addFeature(item, costText, maliceEffectsFromItem(item));
      });
    }
    if (typeof raw?.content === 'string') parseMaliceMarkdown(raw.content);
    return values;
  }

  async function hydrateMaliceInBackground() {
    maliceLoading = true;
    const collected = [];
    await runPool(maliceCandidates, MALICE_CONCURRENCY, async path => {
      try {
        const raw = await fetchJson(rawUrl(path));
        collected.push(...flattenMalicePayload(raw, path));
      } catch {
        // A broad path match can include non-feature documents. Ignore unreadable candidates.
      }
    });
    const seen = new Set();
    maliceFeatures = collected.filter(feature => {
      const key = `${feature.name}|${feature.cost}|${feature.path}`;
      const hasContent = Array.isArray(feature.effects) && feature.effects.some(effect => effect.effect || effect.roll || effect.tier1 || effect.tier2 || effect.tier3);
      if (!feature.name || !hasContent || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    expandedMaliceFeatures = new Set(maliceFeatures.map(feature => feature.id));
    maliceLoading = false;
    renderMaliceFeatures();
  }

  async function hydrateConditionsInBackground() {
    await runPool(conditionCatalog, CONDITION_CONCURRENCY, async condition => {
      try {
        const raw = await fetchJson(rawUrl(condition.path));
        condition.name = raw.name || condition.name;
        condition.description = plainText(raw.content || raw.description || raw.body || '');
      } catch {
        condition.description = '';
      }
    }, () => {
      if (openConditionPickerFor) renderCombatBoard();
    });
    if (openConditionPickerFor || state.combat.instances.some(instance => (instance.conditions || []).length)) renderCombatBoard();
  }

  function conditionInfo(name) {
    const normalized = String(name || '').trim().toLowerCase();
    return conditionCatalog.find(condition => condition.name.toLowerCase() === normalized) || null;
  }

  async function hydrateSavedStateSources() {
    const needed = new Set([
      ...state.encounter.map(item => item.sourcePath),
      ...state.combat.instances.map(item => item.sourcePath)
    ].filter(Boolean));
    await Promise.allSettled([...needed].map(loadMonster));
    renderEncounter();
    renderCombat();
  }

  function renderSourceStatus() {
    if (sourceError) {
      els.dataStatus.textContent = `Source unavailable · ${sourceError}`;
      els.dataStatus.classList.add('error');
      return;
    }
    els.dataStatus.classList.remove('error');
    if (sourceLoading) {
      els.dataStatus.textContent = 'Connecting to SteelCompendium…';
    } else if (!catalog.length) {
      els.dataStatus.textContent = 'No statblocks found';
    } else if (hydratedCount < catalog.length) {
      els.dataStatus.textContent = `${catalog.length} statblocks · loading details ${Math.min(hydratedCount, catalog.length)}/${catalog.length}`;
    } else {
      els.dataStatus.textContent = `${catalog.length - hydrationErrors} statblocks from SteelCompendium${hydrationErrors ? ` · ${hydrationErrors} unavailable` : ''}`;
    }
  }

  function scheduleLibraryRender() {
    if (prepDrag?.active) {
      deferredLibraryRender = true;
      return;
    }
    if (renderLibraryQueued) return;
    renderLibraryQueued = true;
    requestAnimationFrame(() => {
      renderLibraryQueued = false;
      renderLibrary();
    });
  }

  function setView(view) {
    state.ui.view = view;
    els.views.forEach(section => section.classList.toggle('active', section.id === `${view}-view`));
    els.navButtons.forEach(button => button.classList.toggle('active', button.dataset.viewButton === view));
    els.pageEyebrow.textContent = view === 'builder' ? 'ENCOUNTER' : 'COMBAT';
    els.pageTitle.textContent = view === 'builder' ? 'Prep' : `Round ${state.combat.round}`;
    els.clearEncounter.hidden = view !== 'builder';
    els.startCombat.hidden = view !== 'builder';
    saveState();
  }

  function partyMath() {
    const oneHeroES = state.party.level * 6;
    const partyES = oneHeroES * state.party.heroes;
    const roundOne = state.party.victories + state.party.heroes + 1 + state.party.bonusMalice;
    return { oneHeroES, partyES, roundOne };
  }

  function renderParty() {
    const values = partyMath();
    els.heroCount.value = state.party.heroes;
    els.heroLevel.value = state.party.level;
    els.heroVictories.value = state.party.victories;
    els.bonusMalice.value = state.party.bonusMalice;
    els.heroES.textContent = values.oneHeroES;
    els.partyES.textContent = values.partyES;
    els.roundOneMalice.textContent = values.roundOne;
  }

  function renderPrepGroups() {
    document.querySelectorAll('[data-select-prep-group]').forEach(groupEl => {
      groupEl.classList.toggle('selected', groupEl.dataset.selectPrepGroup === state.activePrepGroupId);
      groupEl.setAttribute('aria-selected', groupEl.dataset.selectPrepGroup === state.activePrepGroupId ? 'true' : 'false');
    });
  }

  function catalogSearchText(entry) {
    const m = entry.monster;
    return [
      entry.derivedName,
      entry.slug,
      entry.familyPath,
      entry.book,
      m?.name,
      m?.organization,
      m?.role,
      ...(m?.keywords || [])
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function filteredCatalog() {
    const search = state.ui.search.trim().toLowerCase();
    const role = state.ui.role;
    return catalog.filter(entry => {
      if (search && !catalogSearchText(entry).includes(search)) return false;
      if (role !== 'all') {
        if (!entry.monster) return false;
        if (String(entry.monster.organization).toLowerCase() !== role.toLowerCase()) return false;
      }
      return true;
    });
  }

  function renderLibrary() {
    renderPrepGroups();
    if (sourceError) {
      els.monsterLibrary.innerHTML = `<div class="source-error"><strong>Could not load SteelCompendium.</strong><span>${escapeHtml(sourceError)}</span><button class="secondary" data-retry-source>Retry</button></div>`;
      return;
    }
    if (sourceLoading && !catalog.length) {
      els.monsterLibrary.innerHTML = '<div class="library-loading">Loading source index…</div>';
      return;
    }

    const matches = filteredCatalog();
    const visible = matches.slice(0, MAX_LIBRARY_RESULTS);
    if (!visible.length) {
      const note = state.ui.role !== 'all' && hydratedCount < catalog.length
        ? 'Matching organization data is still loading.'
        : 'No matching monsters.';
      els.monsterLibrary.innerHTML = `<div class="empty-state">${note}</div>`;
      return;
    }

    els.monsterLibrary.innerHTML = `
      <div class="library-results-bar"><span>${matches.length} result${matches.length === 1 ? '' : 's'}</span>${matches.length > MAX_LIBRARY_RESULTS ? `<span>Showing first ${MAX_LIBRARY_RESULTS}</span>` : ''}</div>
      ${visible.map(entry => renderMonsterCard(entry)).join('')}
    `;
  }

  function renderMonsterCard(entry) {
    const m = entry.monster;
    const qty = qtyDrafts.get(entry.path) || m?.defaultQty || 1;
    if (!m) {
      return `<article class="monster-card loading-card" data-drag-source-path="${escapeHtml(entry.path)}">
        <div class="monster-main">
          <div class="monster-title-row"><span class="card-drag-handle" aria-hidden="true">⠿</span><h3>${escapeHtml(entry.derivedName)}</h3><span class="tag">${escapeHtml(familyLabel(entry.familyPath))}</span></div>
          <div class="monster-meta"><span>${entry.error ? 'Source file unavailable' : 'Loading statblock…'}</span></div>
        </div>
        <div class="add-controls">
          <div class="qty-control"><button data-qty-minus="${escapeHtml(entry.path)}">−</button><input data-qty-input="${escapeHtml(entry.path)}" value="${qty}" inputmode="numeric"><button data-qty-plus="${escapeHtml(entry.path)}">+</button></div>
          <button class="primary" data-add-monster="${escapeHtml(entry.path)}">Add</button>
        </div>
      </article>`;
    }

    const preview = m.features.slice(0, 3).map(feature => feature.name).filter(Boolean).join(' · ');
    return `<article class="monster-card" data-drag-source-path="${escapeHtml(entry.path)}">
      <div class="monster-main">
        <div class="monster-title-row"><span class="card-drag-handle" aria-hidden="true">⠿</span><h3>${escapeHtml(m.name)}</h3><span class="tag">${escapeHtml(m.organization)}</span></div>
        <div class="monster-meta"><span>Level <b>${fmt(m.level)}</b></span><span>${escapeHtml(m.role || '—')}</span><span>EV <b>${escapeHtml(m.evLabel)}</b></span><span>${escapeHtml(m.ancestry)}</span></div>
        <div class="monster-preview">${escapeHtml(preview || familyLabel(m.familyPath))}</div>
      </div>
      <div class="add-controls">
        <div class="qty-control"><button data-qty-minus="${escapeHtml(entry.path)}">−</button><input data-qty-input="${escapeHtml(entry.path)}" value="${qty}" inputmode="numeric"><button data-qty-plus="${escapeHtml(entry.path)}">+</button></div>
        <button class="primary" data-add-monster="${escapeHtml(entry.path)}">Add</button>
      </div>
    </article>`;
  }

  function encounterTotals() {
    let count = 0;
    let ev = 0;
    for (const item of state.encounter) {
      count += item.count;
      const monster = monsterCache.get(item.sourcePath);
      if (monster) ev += monster.ev * item.count;
    }
    return { count, ev };
  }

  function difficultyFor(ev, partyES) {
    if (!ev) return { label: 'Trivial', tier: 'trivial', help: 'Add monsters to build the encounter.' };
    const ratio = partyES ? ev / partyES : 0;
    if (ratio < 0.5) return { label: 'Easy', tier: 'easy', help: 'Well below the party encounter strength.' };
    if (ratio < 0.85) return { label: 'Standard', tier: 'standard', help: 'A moderate encounter for this party.' };
    if (ratio < 1.15) return { label: 'Hard', tier: 'hard', help: 'Near the party encounter strength.' };
    if (ratio < 1.5) return { label: 'Extreme', tier: 'extreme', help: 'Above the party encounter strength.' };
    return { label: 'Deadly', tier: 'deadly', help: 'Far above the party encounter strength.' };
  }

  function renderEncounter() {
    const totals = encounterTotals();
    const party = partyMath();
    const difficulty = difficultyFor(totals.ev, party.partyES);
    els.enemyCountPill.textContent = `${totals.count} ${totals.count === 1 ? 'enemy' : 'enemies'}`;
    els.currentEV.textContent = fmt(totals.ev);
    els.difficultyLabel.textContent = difficulty.label;
    els.difficultyLabel.dataset.tier = difficulty.tier;
    els.budgetFill.dataset.tier = difficulty.tier;
    els.difficultyHelp.textContent = difficulty.help;
    els.budgetFill.style.width = `${Math.min(100, party.partyES ? (totals.ev / (party.partyES * 1.5)) * 100 : 0)}%`;
    els.esMarker.style.left = `${Math.min(100, party.partyES ? (party.partyES / (party.partyES * 1.5)) * 100 : 0)}%`;

    els.rosterGroups.innerHTML = state.groups.map(group => {
      const items = state.encounter.filter(item => item.groupId === group.id);
      const selected = group.id === state.activePrepGroupId;
      return `<section class="prep-roster-group ${selected ? 'selected' : ''}" data-select-prep-group="${escapeHtml(group.id)}" data-drop-group="${escapeHtml(group.id)}" aria-selected="${selected}">
        <div class="prep-group-head">
          <input class="group-name-input" data-rename-group="${escapeHtml(group.id)}" value="${escapeHtml(group.name)}" aria-label="Group name">
          <div class="prep-group-head-actions">
            <span>${items.reduce((sum, item) => sum + item.count, 0)}</span>
            <button class="icon-button danger" data-remove-group="${escapeHtml(group.id)}" title="Remove group">×</button>
          </div>
        </div>
        <div class="prep-group-items">
          ${items.length ? items.map(item => {
            const m = monsterCache.get(item.sourcePath);
            const name = m?.name || catalogByPath.get(item.sourcePath)?.derivedName || slugToLabel(item.sourcePath.split('/').pop()?.replace(/\.json$/i, ''));
            const ev = m ? fmt(m.ev * item.count) : '…';
            return `<div class="roster-item" data-drag-encounter="${escapeHtml(item.id)}" title="Drag to move between groups or back to the monster list">
              <div class="roster-item-main"><span class="drag-grip" aria-hidden="true">⋮⋮</span><div><strong>${escapeHtml(name)}</strong><small>${item.count} × · EV ${ev}</small></div></div>
              <div class="group-actions">
                <button data-remove-one="${escapeHtml(item.id)}">−</button><b>${item.count}</b><button data-add-one="${escapeHtml(item.id)}">+</button><button class="remove-entry" data-remove-entry="${escapeHtml(item.id)}">×</button>
              </div>
            </div>`;
          }).join('') : '<div class="group-empty">Empty</div>'}
        </div>
      </section>`;
    }).join('');

    els.startCombat.disabled = state.encounter.length === 0;
    els.startCombatInline.disabled = state.encounter.length === 0;
    els.combatBadge.textContent = String(state.combat.instances.length || totals.count);
  }

  function createGroupRecord() {
    const used = new Set(state.groups.map(group => group.name.trim().toUpperCase()));
    let name = '';
    for (let code = 65; code <= 90; code += 1) {
      const candidate = String.fromCharCode(code);
      if (!used.has(candidate)) { name = candidate; break; }
    }
    if (!name) name = `Group ${state.groups.length + 1}`;
    const group = { id: uid('group'), name };
    state.groups.push(group);
    state.activePrepGroupId = group.id;
    return group;
  }

  function addGroup() {
    createGroupRecord();
    saveState();
    renderPrepGroups();
    renderEncounter();
  }

  function removeGroup(groupId) {
    if (state.groups.length === 1) {
      toast('At least one group is required.');
      return;
    }
    const remaining = state.groups.filter(group => group.id !== groupId);
    const fallbackId = remaining[0].id;
    state.groups = remaining;
    state.encounter.forEach(item => { if (item.groupId === groupId) item.groupId = fallbackId; });
    state.combat.instances.forEach(instance => { if (instance.groupId === groupId) instance.groupId = fallbackId; });
    if (state.activePrepGroupId === groupId) state.activePrepGroupId = fallbackId;
    if (state.combat.activeGroupFilter === groupId) state.combat.activeGroupFilter = null;
    saveState();
    renderAll();
  }

  async function addToEncounterInGroup(sourcePath, count, groupId, { announce = true } = {}) {
    const targetGroupId = state.groups.some(group => group.id === groupId) ? groupId : state.activePrepGroupId;
    const amount = Math.max(1, Math.min(30, Number(count) || 1));
    try {
      const monster = await loadMonster(sourcePath);
      const existing = state.encounter.find(item => item.sourcePath === sourcePath && item.groupId === targetGroupId);
      if (existing) existing.count += amount;
      else state.encounter.push({ id: uid('enc'), sourcePath, groupId: targetGroupId, count: amount });
      state.activePrepGroupId = targetGroupId;
      saveState();
      renderEncounter();
      if (announce) toast(`Added ${amount} × ${monster.name}`);
      return true;
    } catch {
      toast('Could not load that statblock.');
      return false;
    }
  }

  async function addToEncounter(sourcePath, count) {
    return addToEncounterInGroup(sourcePath, count, state.activePrepGroupId);
  }

  function changeEncounterCount(itemId, delta) {
    const item = state.encounter.find(entry => entry.id === itemId);
    if (!item) return;
    item.count += delta;
    if (item.count <= 0) state.encounter = state.encounter.filter(entry => entry.id !== itemId);
    saveState();
    renderEncounter();
  }

  function moveEncounterEntryToGroup(itemId, groupId) {
    const item = state.encounter.find(entry => entry.id === itemId);
    if (!item || !state.groups.some(group => group.id === groupId) || item.groupId === groupId) return;
    const existing = state.encounter.find(entry => entry.id !== item.id && entry.sourcePath === item.sourcePath && entry.groupId === groupId);
    if (existing) {
      existing.count += item.count;
      state.encounter = state.encounter.filter(entry => entry.id !== item.id);
    } else {
      item.groupId = groupId;
    }
    saveState();
    renderEncounter();
  }


  function isPrepDragInteractiveTarget(target) {
    return Boolean(target.closest('button, input, select, textarea, a, [contenteditable="true"]'));
  }

  function monsterNameForPath(sourcePath) {
    return monsterCache.get(sourcePath)?.name
      || catalogByPath.get(sourcePath)?.derivedName
      || slugToLabel(sourcePath.split('/').pop()?.replace(/\.json$/i, ''));
  }

  function beginPrepDrag(event, payload, sourceEl) {
    if (event.button !== 0 || prepDrag || isPrepDragInteractiveTarget(event.target)) return;
    prepDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      payload,
      sourceEl,
      ghost: null,
      target: null
    };
    sourceEl.setPointerCapture?.(event.pointerId);
  }

  function activatePrepDrag() {
    if (!prepDrag || prepDrag.active) return;
    prepDrag.active = true;
    const { payload, sourceEl } = prepDrag;
    const ghost = document.createElement('div');
    ghost.className = 'prep-drag-ghost';
    ghost.innerHTML = `<strong>${escapeHtml(payload.label)}</strong><span>${payload.count > 1 ? `${payload.count} ×` : payload.kind === 'library' ? 'Add to group' : 'Move'}</span>`;
    document.body.appendChild(ghost);
    prepDrag.ghost = ghost;
    sourceEl.classList.add('drag-source');
    document.body.classList.add('is-prep-dragging');
    document.body.classList.toggle('dragging-library-monster', payload.kind === 'library');
    document.body.classList.toggle('dragging-encounter-entry', payload.kind === 'encounter');
    updatePrepDragVisuals(prepDrag.x, prepDrag.y);
  }

  function pointInside(element, x, y) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function prepDropTargetAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const group = hit?.closest?.('[data-drop-group]');
    if (group) return { type: 'group', groupId: group.dataset.dropGroup, element: group };
    if (pointInside(els.prepNewGroupDrop, x, y)) return { type: 'new-group', element: els.prepNewGroupDrop };
    if (prepDrag?.payload.kind === 'encounter' && pointInside(els.monsterLibrary, x, y)) {
      return { type: 'remove', element: els.monsterLibrary };
    }
    return null;
  }

  function clearPrepDropHighlights() {
    els.rosterGroups.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
    els.prepNewGroupDrop?.classList.remove('drag-over');
    els.monsterLibrary.classList.remove('drop-remove-active');
  }

  function applyPrepDropHighlight(target) {
    clearPrepDropHighlights();
    if (!target) return;
    if (target.type === 'group') target.element.classList.add('drag-over');
    if (target.type === 'new-group') target.element.classList.add('drag-over');
    if (target.type === 'remove') target.element.classList.add('drop-remove-active');
  }

  function autoScrollPrepAt(x, y) {
    const scrollables = [els.monsterLibrary, els.rosterGroups];
    for (const element of scrollables) {
      if (!pointInside(element, x, y) || element.scrollHeight <= element.clientHeight) continue;
      const rect = element.getBoundingClientRect();
      const edge = Math.min(56, rect.height * 0.18);
      if (y < rect.top + edge) element.scrollTop -= 14;
      else if (y > rect.bottom - edge) element.scrollTop += 14;
    }
  }

  function updatePrepDragVisuals(x, y) {
    if (!prepDrag?.active) return;
    prepDrag.x = x;
    prepDrag.y = y;
    if (prepDrag.ghost) prepDrag.ghost.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
    const nextTarget = prepDropTargetAt(x, y);
    const sameTarget = prepDrag.target?.type === nextTarget?.type && prepDrag.target?.groupId === nextTarget?.groupId;
    if (!sameTarget) {
      prepDrag.target = nextTarget;
      applyPrepDropHighlight(nextTarget);
    }
    autoScrollPrepAt(x, y);
  }

  async function commitPrepDrop(target, payload) {
    if (!target) return;
    if (target.type === 'group') {
      state.activePrepGroupId = target.groupId;
      if (payload.kind === 'library') {
        await addToEncounterInGroup(payload.sourcePath, payload.count, target.groupId);
      } else {
        const item = state.encounter.find(entry => entry.id === payload.itemId);
        const changed = item && item.groupId !== target.groupId;
        if (changed) moveEncounterEntryToGroup(payload.itemId, target.groupId);
        else {
          saveState();
          renderEncounter();
        }
        const group = state.groups.find(entry => entry.id === target.groupId);
        if (changed) toast(`Moved to ${group?.name || 'group'}`);
      }
      return;
    }

    if (target.type === 'new-group') {
      const group = createGroupRecord();
      saveState();
      renderEncounter();
      if (payload.kind === 'library') await addToEncounterInGroup(payload.sourcePath, payload.count, group.id);
      else {
        moveEncounterEntryToGroup(payload.itemId, group.id);
        toast(`Moved to new group ${group.name}`);
      }
      return;
    }

    if (target.type === 'remove' && payload.kind === 'encounter') {
      state.encounter = state.encounter.filter(item => item.id !== payload.itemId);
      saveState();
      renderEncounter();
      toast('Removed from encounter');
    }
  }

  function finishPrepDragVisuals() {
    if (!prepDrag) return;
    prepDrag.sourceEl?.classList.remove('drag-source');
    prepDrag.ghost?.remove();
    clearPrepDropHighlights();
    document.body.classList.remove('is-prep-dragging', 'dragging-library-monster', 'dragging-encounter-entry');
  }

  async function endPrepDrag(event, cancelled = false) {
    if (!prepDrag || event.pointerId !== prepDrag.pointerId) return;
    const session = prepDrag;
    prepDrag = null;
    if (!session.active) return;
    suppressPrepClickUntil = Date.now() + 250;
    const target = cancelled ? null : session.target;
    session.sourceEl?.releasePointerCapture?.(event.pointerId);
    session.sourceEl?.classList.remove('drag-source');
    session.ghost?.remove();
    clearPrepDropHighlights();
    document.body.classList.remove('is-prep-dragging', 'dragging-library-monster', 'dragging-encounter-entry');
    await commitPrepDrop(target, session.payload);
    if (deferredLibraryRender) {
      deferredLibraryRender = false;
      renderLibrary();
    }
  }

  function handlePrepPointerMove(event) {
    if (!prepDrag || event.pointerId !== prepDrag.pointerId) return;
    prepDrag.x = event.clientX;
    prepDrag.y = event.clientY;
    if (!prepDrag.active) {
      const distance = Math.hypot(event.clientX - prepDrag.startX, event.clientY - prepDrag.startY);
      if (distance < 7) return;
      activatePrepDrag();
    }
    event.preventDefault();
    updatePrepDragVisuals(event.clientX, event.clientY);
  }

  async function startCombat() {
    if (!state.encounter.length) return;
    const paths = [...new Set(state.encounter.map(item => item.sourcePath))];
    const loaded = await Promise.allSettled(paths.map(loadMonster));
    if (loaded.some(result => result.status === 'rejected')) {
      toast('Some SteelCompendium statblocks could not be loaded.');
      return;
    }

    const counters = new Map();
    const instances = [];
    for (const entry of state.encounter) {
      const m = monsterCache.get(entry.sourcePath);
      if (!m) continue;
      if (String(m.organization).toLowerCase() === 'minion') {
        const current = (counters.get(entry.sourcePath) || 0) + 1;
        counters.set(entry.sourcePath, current);
        instances.push({
          id: uid('enemy'),
          sourcePath: entry.sourcePath,
          groupId: entry.groupId,
          kind: 'minion-squad',
          count: entry.count,
          name: `${m.name} Squad${current > 1 ? ` ${current}` : ''}`,
          currentStamina: m.stamina * entry.count,
          maxStamina: m.stamina * entry.count,
          acted: false,
          conditions: []
        });
      } else {
        for (let index = 0; index < entry.count; index += 1) {
          const current = (counters.get(entry.sourcePath) || 0) + 1;
          counters.set(entry.sourcePath, current);
          instances.push({
            id: uid('enemy'),
            sourcePath: entry.sourcePath,
            groupId: entry.groupId,
            kind: 'creature',
            count: 1,
            name: `${m.name}${current > 1 ? ` ${current}` : ''}`,
            currentStamina: m.stamina,
            maxStamina: m.stamina,
            acted: false,
            conditions: []
          });
        }
      }
    }

    state.combat = {
      active: true,
      round: 1,
      malice: partyMath().roundOne,
      instances,
      activeGroupFilter: null,
      activeEffects: [],
      selectedMaliceFeatureIds: [],
      maliceSelectionInitialized: false
    };
    saveState();
    renderCombat();
    setView('combat');
    toast(`Combat started · ${state.combat.malice} Malice`);
  }

  function effectiveSpeed(monster) {
    const goblinMode = state.combat.activeEffects.some(effect => effect.name.toLowerCase() === 'goblin mode');
    if (goblinMode && monster.keywords.some(keyword => keyword.toLowerCase() === 'goblin')) {
      const base = numberFrom(monster.speed, NaN);
      if (Number.isFinite(base)) return { value: base + 2, note: '+2' };
    }
    return { value: monster.speed, note: '' };
  }

  function renderCombat() {
    const combat = state.combat;
    els.roundNumber.textContent = combat.round;
    els.pageTitle.textContent = state.ui.view === 'combat' ? `Round ${combat.round}` : 'Prep';
    els.maliceValue.textContent = combat.malice;
    els.maliceGainHint.textContent = `Next round +${state.party.heroes + combat.round + 1}`;
    const acted = combat.instances.filter(instance => instance.acted).length;
    els.actedSummary.textContent = `${acted}/${combat.instances.length} marked`;
    els.combatBadge.textContent = String(combat.instances.length);
    renderCombatGroups();
    renderMaliceFeatures();
    renderActiveEffects();
    renderCombatBoard();
  }

  function renderCombatGroups() {
    els.combatGroupRail.innerHTML = state.groups.map(group => {
      const members = state.combat.instances.filter(instance => instance.groupId === group.id);
      const acted = members.filter(instance => instance.acted).length;
      const active = state.combat.activeGroupFilter === group.id;
      const complete = members.length > 0 && acted === members.length;
      return `<button class="combat-group-button ${active ? 'active' : ''} ${complete ? 'complete' : ''}" data-filter-group="${escapeHtml(group.id)}">
        <strong>${escapeHtml(group.name)}</strong><span>${acted}/${members.length}</span>
      </button>`;
    }).join('');
    els.showAllGroups.classList.toggle('active', !state.combat.activeGroupFilter);
  }

  function activeMonsterFamilies() {
    const families = new Map();
    for (const instance of state.combat.instances) {
      const monster = monsterCache.get(instance.sourcePath);
      if (!monster) continue;
      const family = monster.familyPath.toLowerCase().split('/').filter(Boolean)[0];
      if (!family) continue;
      const current = families.get(family) || { family, label: slugToLabel(family), maxLevel: 0, monsters: new Set() };
      current.maxLevel = Math.max(current.maxLevel, numberFrom(monster.level, 0));
      current.monsters.add(monster.name);
      families.set(family, current);
    }
    return families;
  }

  function featureText(feature) {
    return feature.effects.map(effect => effect.effect || [effect.roll, effect.tier1, effect.tier2, effect.tier3].filter(Boolean).join(' · ')).filter(Boolean).join(' ');
  }

  function isPriorMaliceGateway(feature) {
    return feature.name?.trim().toLowerCase() === 'prior malice features';
  }

  function dedupeMaliceFeatures(features) {
    const seen = new Set();
    return features.filter(feature => {
      const key = `${feature.name.toLowerCase()}|${feature.costText || feature.cost}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function relevantMaliceGroups() {
    if (!state.combat.instances.length) return [];
    const groups = [];
    const basic = dedupeMaliceFeatures(maliceFeatures.filter(feature => feature.scope === 'basic' && !isPriorMaliceGateway(feature)))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    if (basic.length) groups.push({ id: 'basic', label: 'Basic', subtitle: 'All monsters', features: basic });

    const activeFamilies = activeMonsterFamilies();
    for (const familyInfo of [...activeFamilies.values()].sort((a, b) => a.label.localeCompare(b.label))) {
      const available = maliceFeatures.filter(feature =>
        feature.scope === 'family' &&
        feature.family === familyInfo.family &&
        feature.minLevel <= familyInfo.maxLevel &&
        !isPriorMaliceGateway(feature)
      );
      const features = dedupeMaliceFeatures(available).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
      if (!features.length) continue;
      groups.push({
        id: familyInfo.family,
        label: familyInfo.label,
        subtitle: `Available through level ${familyInfo.maxLevel}`,
        features
      });
    }
    return groups;
  }

  function allRelevantMaliceFeatures(groups = relevantMaliceGroups()) {
    const seen = new Set();
    const values = [];
    for (const group of groups) {
      for (const feature of group.features) {
        if (seen.has(feature.id)) continue;
        seen.add(feature.id);
        values.push(feature);
      }
    }
    return values;
  }

  function suggestedMaliceFeatureIds(groups = relevantMaliceGroups()) {
    const all = allRelevantMaliceFeatures(groups);
    if (!all.length) return [];

    const selected = [];
    const selectedIds = new Set();
    const familyGroups = groups.filter(group => group.id !== 'basic');
    const targetCount = familyGroups.length > 1 ? 4 : 3;

    const ordered = [...all].sort((a, b) => {
      const scopeDelta = (a.scope === 'family' ? 0 : 1) - (b.scope === 'family' ? 0 : 1);
      return scopeDelta || a.cost - b.cost || a.name.localeCompare(b.name);
    });

    const addBest = candidates => {
      const feature = candidates.find(item => !selectedIds.has(item.id));
      if (!feature) return false;
      selected.push(feature);
      selectedIds.add(feature.id);
      return true;
    };

    addBest(ordered.filter(feature => feature.cost >= 2 && feature.cost <= 3));
    addBest(ordered.filter(feature => feature.cost >= 4 && feature.cost <= 6));
    addBest(ordered.filter(feature => feature.cost >= 7));

    if (targetCount > selected.length) {
      const representedFamilies = new Set(selected.filter(feature => feature.scope === 'family').map(feature => feature.family));
      for (const group of familyGroups) {
        if (selected.length >= targetCount) break;
        if (representedFamilies.has(group.id)) continue;
        if (addBest(group.features)) representedFamilies.add(group.id);
      }
    }

    while (selected.length < targetCount && addBest(ordered)) {
      // Fill any missing band from the remaining encounter-relevant options.
    }

    return selected.slice(0, targetCount).map(feature => feature.id);
  }

  function ensureMaliceSelection(groups) {
    const availableIds = new Set(allRelevantMaliceFeatures(groups).map(feature => feature.id));
    const current = Array.isArray(state.combat.selectedMaliceFeatureIds) ? state.combat.selectedMaliceFeatureIds : [];
    const filtered = current.filter(id => availableIds.has(id));
    let changed = filtered.length !== current.length;

    if (!state.combat.maliceSelectionInitialized && availableIds.size) {
      state.combat.selectedMaliceFeatureIds = suggestedMaliceFeatureIds(groups);
      state.combat.maliceSelectionInitialized = true;
      state.combat.selectedMaliceFeatureIds.forEach(id => expandedMaliceFeatures.add(id));
      changed = true;
    } else {
      state.combat.selectedMaliceFeatureIds = filtered;
    }

    if (changed) saveState();
    return state.combat.selectedMaliceFeatureIds;
  }

  function renderMaliceFeatureBody(feature) {
    const meta = [feature.distance, feature.target].filter(Boolean).join(' · ');
    const effects = (feature.effects || []).map((effect, effectIndex) => {
      const text = effect.effect ? `<p>${richText(effect.effect)}</p>` : '';
      const tierKeys = ['tier1', 'tier2', 'tier3'].filter(key => effect[key]);
      const rollKey = `${feature.id}|${effectIndex}`;
      const lastRoll = lastMaliceRolls.get(rollKey);
      const rollControl = tierKeys.length ? `<div class="malice-roll-line">
        <button data-roll-malice="${escapeHtml(feature.id)}" data-malice-effect-index="${effectIndex}">Roll</button>
        <strong>${escapeHtml(effect.roll || 'Power Roll')}</strong>
        ${lastRoll ? `<span>${escapeHtml(lastRoll.label)}</span>` : ''}
      </div>` : '';
      const tiers = tierKeys
        .map((key, index) => `<div class="${lastRoll?.tier === index + 1 ? 'rolled-tier' : ''}" ${lastRoll?.tier === index + 1 ? 'aria-current="true"' : ''}><b>${index + 1}</b><span>${richText(effect[key])}</span></div>`)
        .join('');
      return `<div class="malice-effect">${text}${rollControl}${tiers ? `<div class="malice-tiers">${tiers}</div>` : ''}</div>`;
    }).join('');
    return `${meta ? `<div class="malice-meta">${escapeHtml(meta)}</div>` : ''}<div class="malice-copy">${effects}</div>`;
  }

  function renderMaliceCard(feature) {
    const disabled = feature.cost > state.combat.malice;
    const expanded = expandedMaliceFeatures.has(feature.id);
    return `<article class="malice-card ${expanded ? 'expanded' : 'collapsed'}">
      <div class="malice-card-head">
        <button class="malice-toggle" data-toggle-malice="${escapeHtml(feature.id)}" aria-expanded="${expanded}">
          <span class="malice-cost">${escapeHtml((feature.costText || String(feature.cost || '—')).replace(/\s*Malice/i, ''))}</span>
          <strong>${escapeHtml(feature.name)}</strong>
          <i aria-hidden="true">${expanded ? '−' : '+'}</i>
        </button>
        <button class="malice-use" data-use-malice="${escapeHtml(feature.id)}" ${disabled ? 'disabled' : ''} title="Spend ${feature.cost} Malice">Use</button>
        <button class="malice-unpin" data-remove-malice-selection="${escapeHtml(feature.id)}" title="Remove from encounter Malice" aria-label="Remove ${escapeHtml(feature.name)} from encounter Malice">×</button>
        <a href="${escapeHtml(feature.source)}" target="_blank" rel="noreferrer" aria-label="Open source">↗</a>
      </div>
      ${expanded ? `<div class="malice-card-body">${renderMaliceFeatureBody(feature)}</div>` : ''}
    </article>`;
  }

  function renderAvailableMaliceItem(feature) {
    const preview = plainText(featureText(feature));
    const shortPreview = preview.length > 150 ? `${preview.slice(0, 147)}…` : preview;
    const cost = (feature.costText || String(feature.cost || '—')).replace(/\s*Malice/i, '');
    return `<div class="malice-library-item" title="${escapeHtml(preview)}">
      <span class="malice-library-cost">${escapeHtml(cost)}</span>
      <div class="malice-library-copy"><strong>${escapeHtml(feature.name)}</strong>${shortPreview ? `<span>${escapeHtml(shortPreview)}</span>` : ''}</div>
      <button class="malice-add" data-add-malice-selection="${escapeHtml(feature.id)}">+ Add</button>
      <a href="${escapeHtml(feature.source)}" target="_blank" rel="noreferrer" aria-label="Open source">↗</a>
    </div>`;
  }

  function renderMaliceFeatures() {
    if (!els.maliceFeatures) return;
    if (maliceLoading) {
      els.maliceFeatures.innerHTML = '<span class="dock-loading">Loading SteelCompendium Malice…</span>';
      return;
    }
    const groups = relevantMaliceGroups();
    if (!groups.length) {
      els.maliceFeatures.innerHTML = '<span class="dock-loading">No matching Malice features found.</span>';
      return;
    }

    const selectedIds = ensureMaliceSelection(groups);
    const featureMap = new Map(allRelevantMaliceFeatures(groups).map(feature => [feature.id, feature]));
    const selected = selectedIds.map(id => featureMap.get(id)).filter(Boolean);
    const selectedSet = new Set(selected.map(feature => feature.id));
    const availableGroups = groups
      .map(group => ({ ...group, features: group.features.filter(feature => !selectedSet.has(feature.id)) }))
      .filter(group => group.features.length);
    const availableCount = availableGroups.reduce((sum, group) => sum + group.features.length, 0);
    const libraryOpen = Boolean(state.ui.maliceLibraryOpen);

    const selectedMarkup = selected.length
      ? `<div class="malice-selected-grid">${selected.map(renderMaliceCard).join('')}</div>`
      : `<div class="malice-selection-empty">No Malice features selected.</div>`;

    const availableMarkup = libraryOpen ? `<div class="malice-library-body">${availableGroups.map(group => `
      <section class="malice-library-group">
        <header><strong>${escapeHtml(group.label)}</strong><span>${group.features.length}</span></header>
        <div class="malice-library-list">${group.features.map(renderAvailableMaliceItem).join('')}</div>
      </section>`).join('') || '<div class="malice-selection-empty">All available features are selected.</div>'}</div>` : '';

    els.maliceFeatures.innerHTML = `<section class="malice-selection-shell">
      <header class="malice-selection-heading">
        <div><strong>Encounter Malice</strong><span>${selected.length} selected</span></div>
        <button class="secondary compact-button" data-auto-pick-malice title="Choose a balanced 3–4 feature set">Auto pick 3–4</button>
      </header>
      ${selectedMarkup}
    </section>
    <section class="malice-library-shell ${libraryOpen ? 'open' : ''}">
      <button class="malice-library-toggle" data-toggle-malice-library aria-expanded="${libraryOpen}">
        <div><strong>Available</strong><span>${availableCount} more${availableGroups.length ? ` · ${availableGroups.map(group => group.label).join(', ')}` : ''}</span></div>
        <b aria-hidden="true">${libraryOpen ? '−' : '+'}</b>
      </button>
      ${availableMarkup}
    </section>`;
  }

  function renderActiveEffects() {
    els.activeEffects.innerHTML = state.combat.activeEffects.map(effect => `
      <span class="effect-chip"><strong>${escapeHtml(effect.name)}</strong><button data-remove-effect="${escapeHtml(effect.id)}">×</button></span>
    `).join('');
  }

  function groupInstancesByMonster() {
    const map = new Map();
    for (const instance of state.combat.instances) {
      if (!map.has(instance.sourcePath)) map.set(instance.sourcePath, []);
      map.get(instance.sourcePath).push(instance);
    }
    return [...map.entries()];
  }

  function renderCombatBoard() {
    if (!state.combat.instances.length) {
      els.combatBoard.innerHTML = '<div class="combat-empty panel">Build an encounter in Prep.</div>';
      return;
    }
    els.combatBoard.innerHTML = groupInstancesByMonster().map(([path, instances]) => {
      const m = monsterCache.get(path);
      if (!m) return `<section class="monster-lane panel"><div class="lane-loading">Loading statblock…</div></section>`;
      const filter = state.combat.activeGroupFilter;
      const laneRelevant = !filter || instances.some(instance => instance.groupId === filter);
      return `<section class="monster-lane panel ${laneRelevant ? '' : 'lane-dimmed'}">
        ${renderLaneHeader(m)}
        <div class="instance-stack">${instances.map(instance => renderInstance(instance, m, filter)).join('')}</div>
        ${renderStatblock(m)}
      </section>`;
    }).join('');
  }

  function renderLaneHeader(m) {
    const speed = effectiveSpeed(m);
    return `<header class="lane-header">
      <div><p class="eyebrow">${escapeHtml(m.ancestry.toUpperCase())}</p><h2>${escapeHtml(m.name)}</h2><p>Level ${fmt(m.level)} ${escapeHtml(m.organization)} ${escapeHtml(m.role)}</p></div>
      <div class="ev-badge">EV ${escapeHtml(m.evLabel)}</div>
      <div class="lane-core-stats">
        <span><small>SIZE</small><b>${escapeHtml(m.size)}</b></span>
        <span><small>SPEED</small><b>${escapeHtml(speed.value)}${speed.note ? `<em>${speed.note}</em>` : ''}</b></span>
        <span><small>STAMINA</small><b>${fmt(m.stamina)}</b></span>
        <span><small>STAB.</small><b>${escapeHtml(m.stability)}</b></span>
        <span><small>FREE</small><b>${escapeHtml(m.freeStrike)}</b></span>
      </div>
      <div class="lane-characteristics">${Object.entries(m.chars).map(([key, value]) => `<span><small>${key}</small><b>${signed(value)}</b></span>`).join('')}</div>
    </header>`;
  }

  function renderInstance(instance, m, filter) {
    const group = state.groups.find(item => item.id === instance.groupId);
    const dimmed = filter && filter !== instance.groupId;
    const pct = instance.maxStamina > 0 ? Math.max(0, Math.min(100, (instance.currentStamina / instance.maxStamina) * 100)) : 0;
    const remaining = instance.kind === 'minion-squad' && m.stamina > 0 ? Math.ceil(instance.currentStamina / m.stamina) : null;
    return `<article class="instance-card ${instance.acted ? 'acted' : ''} ${dimmed ? 'instance-dimmed' : ''}">
      <div class="instance-topline">
        <button class="acted-toggle" data-toggle-acted="${escapeHtml(instance.id)}" title="${instance.acted ? 'Mark not acted' : 'Mark acted'}">${instance.acted ? '✓' : ''}</button>
        <input class="instance-name" data-rename-instance="${escapeHtml(instance.id)}" value="${escapeHtml(instance.name)}" aria-label="Creature name">
        <select class="instance-group" data-instance-group="${escapeHtml(instance.id)}" aria-label="Activation group">${state.groups.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === instance.groupId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>
        <button class="icon-button" data-remove-instance="${escapeHtml(instance.id)}" title="Remove creature">×</button>
      </div>
      <div class="stamina-row">
        <div class="stamina-meter"><i style="width:${pct}%"></i></div>
        <label class="stamina-field"><input class="stamina-command" data-stamina="${escapeHtml(instance.id)}" value="${fmt(instance.currentStamina)}" inputmode="numeric" aria-label="Current stamina"><span>/ ${fmt(instance.maxStamina)}</span></label>
        ${remaining !== null ? `<strong class="minion-count">${remaining}/${instance.count}</strong>` : ''}
      </div>
      <div class="condition-row">
        ${(instance.conditions || []).map(condition => {
          const info = conditionInfo(condition);
          const description = info?.description || 'Loading condition description…';
          return `<button class="condition-chip" data-remove-condition="${escapeHtml(instance.id)}" data-condition="${escapeHtml(condition)}" title="${escapeHtml(description)}">${escapeHtml(condition)} ×</button>`;
        }).join('')}
        <button class="condition-add" data-add-condition="${escapeHtml(instance.id)}" aria-expanded="${openConditionPickerFor === instance.id}">+ condition</button>
      </div>
      ${openConditionPickerFor === instance.id ? `<div class="condition-picker">${conditionCatalog.map(condition => `<button data-pick-condition="${escapeHtml(instance.id)}" data-condition-name="${escapeHtml(condition.name)}" title="${escapeHtml(condition.description || 'Loading condition description…')}">${escapeHtml(condition.name)}</button>`).join('') || '<span>Loading conditions…</span>'}</div>` : ''}
      ${group ? `<span class="group-corner">${escapeHtml(group.name)}</span>` : ''}
    </article>`;
  }

  function featureLabel(feature) {
    return [feature.ability_type, feature.cost, feature.usage].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).join(' · ');
  }

  function featureMeta(feature) {
    return [
      Array.isArray(feature.keywords) ? feature.keywords.join(', ') : '',
      feature.distance,
      feature.target
    ].filter(Boolean).join(' · ');
  }

  function renderEffect(effect, feature, m, featureIndex, effectIndex) {
    const rollKey = `${m.id}|${featureIndex}|${effectIndex}`;
    const lastRoll = lastRolls.get(rollKey);
    const roll = effect.roll ? `<div class="roll-line"><strong>${escapeHtml(effect.roll)}</strong><button data-roll-feature="${escapeHtml(m.id)}" data-feature-index="${featureIndex}" data-effect-index="${effectIndex}">Roll</button>${lastRoll ? `<span>${escapeHtml(lastRoll.label)}</span>` : ''}</div>` : '';
    const tiers = ['tier1', 'tier2', 'tier3'].filter(key => effect[key]).map((key, index) => `<div class="${lastRoll?.tier === index + 1 ? 'rolled-tier' : ''}" ${lastRoll?.tier === index + 1 ? 'aria-current="true"' : ''}><b>${index + 1}</b><span>${richText(effect[key])}</span></div>`).join('');
    const text = effect.effect ? `<p>${richText(effect.effect)}</p>` : '';
    return `${roll}${tiers ? `<div class="tiers">${tiers}</div>` : ''}${text}`;
  }

  function renderStatblock(m) {
    return `<div class="statblock-body">
      ${m.features.map((feature, featureIndex) => {
        const isTrait = String(feature.feature_type || '').toLowerCase() === 'trait';
        const meta = featureMeta(feature);
        const cost = numberFrom(feature.cost, 0);
        if (isTrait) {
          return `<section class="trait-block"><div class="feature-title"><strong>${escapeHtml(feature.name || 'Trait')}</strong></div>${(feature.effects || []).map(effect => `<p>${richText(effect.effect || '')}</p>`).join('')}</section>`;
        }
        return `<section class="ability-block">
          <div class="feature-title"><strong>${escapeHtml(feature.name || 'Ability')}</strong><span>${escapeHtml(featureLabel(feature))}</span></div>
          ${meta ? `<div class="feature-meta">${escapeHtml(meta)}</div>` : ''}
          <div class="feature-effects">${(feature.effects || []).map((effect, effectIndex) => renderEffect(effect, feature, m, featureIndex, effectIndex)).join('')}</div>
          ${cost > 0 && String(feature.cost).toLowerCase().includes('malice') ? `<button class="ability-spend" data-spend-ability-malice="${cost}" data-ability-name="${escapeHtml(feature.name || 'Ability')}">Spend ${cost} Malice</button>` : ''}
        </section>`;
      }).join('')}
      <a class="source-link" href="${escapeHtml(m.source)}" target="_blank" rel="noreferrer">SteelCompendium source ↗</a>
    </div>`;
  }

  function useMaliceFeature(featureId) {
    const feature = maliceFeatures.find(item => item.id === featureId);
    if (!feature) return;
    if (feature.cost > state.combat.malice) {
      toast(`Need ${feature.cost} Malice.`);
      return;
    }
    state.combat.malice -= feature.cost;
    const text = featureText(feature).toLowerCase();
    if (text.includes('until the end of the round') || text.includes('until end of the round') || feature.name.toLowerCase() === 'goblin mode') {
      const existing = state.combat.activeEffects.find(effect => effect.name.toLowerCase() === feature.name.toLowerCase());
      if (!existing) state.combat.activeEffects.push({ id: uid('effect'), name: feature.name, expiresRound: state.combat.round, sourcePath: feature.path });
    }
    saveState();
    renderCombat();
    toast(`${feature.name} · −${feature.cost} Malice`);
  }

  function spendAbilityMalice(cost, name) {
    if (cost > state.combat.malice) {
      toast(`Need ${cost} Malice.`);
      return;
    }
    state.combat.malice -= cost;
    saveState();
    renderCombat();
    toast(`${name} · −${cost} Malice`);
  }

  function resolvePowerRollBonus(rollText, actor) {
    const text = String(rollText || '');
    const numeric = text.match(/([+-]\s*\d+)\s*$/);
    if (numeric) return Number(numeric[1].replace(/\s/g, ''));
    if (!actor?.chars) return 0;

    if (/\+\s*(?:the\s+)?highest\s+characteristic(?:\s+score)?/i.test(text)) {
      return Math.max(...Object.values(actor.chars).map(value => numberFrom(value, 0)));
    }

    const characteristicNames = { might: 'M', agility: 'A', reason: 'R', intuition: 'I', presence: 'P' };
    for (const [name, key] of Object.entries(characteristicNames)) {
      if (new RegExp(`\\+\\s*(?:the\\s+)?${name}(?:\\s+score)?\\b`, 'i').test(text)) return numberFrom(actor.chars[key], 0);
    }
    return 0;
  }

  function makePowerRoll(rollText = 'Power Roll', actor = null) {
    const bonus = resolvePowerRollBonus(rollText, actor);
    const d1 = 1 + Math.floor(Math.random() * 10);
    const d2 = 1 + Math.floor(Math.random() * 10);
    const total = d1 + d2 + bonus;
    const tier = total <= 11 ? 1 : total <= 16 ? 2 : 3;
    return {
      total,
      tier,
      bonus,
      label: `${d1}+${d2}${bonus ? signed(bonus) : ''} = ${total} · T${tier}`
    };
  }

  function rollFeature(monsterPath, featureIndex, effectIndex) {
    const m = monsterCache.get(monsterPath);
    const effect = m?.features?.[featureIndex]?.effects?.[effectIndex];
    if (!effect?.roll) return;
    lastRolls.set(`${m.id}|${featureIndex}|${effectIndex}`, makePowerRoll(effect.roll, m));
    renderCombatBoard();
  }

  function rollMaliceFeature(featureId, effectIndex) {
    const feature = maliceFeatures.find(item => item.id === featureId);
    const effect = feature?.effects?.[effectIndex];
    if (!effect || !['tier1', 'tier2', 'tier3'].some(key => effect[key])) return;
    lastMaliceRolls.set(`${feature.id}|${effectIndex}`, makePowerRoll(effect.roll || 'Power Roll'));
    renderMaliceFeatures();
  }

  function applyStaminaCommand(instanceId, rawValue) {
    const instance = state.combat.instances.find(item => item.id === instanceId);
    if (!instance) return;
    const raw = String(rawValue).trim();
    let next;
    if (/^[+-]\s*\d+(?:\.\d+)?$/.test(raw)) next = instance.currentStamina + Number(raw.replace(/\s/g, ''));
    else if(/^\d+(?:\.\d+)?$/.test(raw)) next = Number(raw);
    else return;
    instance.currentStamina = Math.max(0, Math.round(next));
    saveState();
    renderCombat();
  }

  function nextRound() {
    if (!state.combat.instances.length) return;
    const endingRound = state.combat.round;
    state.combat.activeEffects = state.combat.activeEffects.filter(effect => Number(effect.expiresRound) > endingRound);
    state.combat.round += 1;
    const gain = state.party.heroes + state.combat.round;
    state.combat.malice += gain;
    state.combat.instances.forEach(instance => { instance.acted = false; });
    saveState();
    renderCombat();
    toast(`Round ${state.combat.round} · +${gain} Malice`);
  }

  function updatePartyFromInputs() {
    state.party.heroes = clampInt(els.heroCount.value, 1, 12);
    state.party.level = clampInt(els.heroLevel.value, 1, 10);
    state.party.victories = clampInt(els.heroVictories.value, 0, 20);
    state.party.bonusMalice = clampInt(els.bonusMalice.value, 0, 99);
    saveState();
    renderParty();
    renderEncounter();
    renderCombat();
  }

  function toast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  function renderAll() {
    ensureStateIntegrity();
    renderParty();
    renderPrepGroups();
    renderLibrary();
    renderEncounter();
    renderCombat();
    setView(state.ui.view);
  }

  els.navButtons.forEach(button => button.addEventListener('click', () => setView(button.dataset.viewButton)));
  [els.heroCount, els.heroLevel, els.heroVictories, els.bonusMalice].forEach(input => input.addEventListener('change', updatePartyFromInputs));

  els.monsterSearch.addEventListener('input', event => {
    state.ui.search = event.target.value;
    saveState();
    renderLibrary();
  });

  els.roleFilters.addEventListener('click', event => {
    const button = event.target.closest('[data-role]');
    if (!button) return;
    state.ui.role = button.dataset.role;
    [...els.roleFilters.querySelectorAll('[data-role]')].forEach(item => item.classList.toggle('active', item === button));
    saveState();
    renderLibrary();
  });

  els.addPrepGroup.addEventListener('click', addGroup);

  els.monsterLibrary.addEventListener('pointerdown', event => {
    const card = event.target.closest('[data-drag-source-path]');
    if (!card) return;
    const sourcePath = card.dataset.dragSourcePath;
    beginPrepDrag(event, {
      kind: 'library',
      sourcePath,
      count: qtyDrafts.get(sourcePath) || 1,
      label: monsterNameForPath(sourcePath)
    }, card);
  });

  els.rosterGroups.addEventListener('pointerdown', event => {
    const row = event.target.closest('[data-drag-encounter]');
    if (!row) return;
    const item = state.encounter.find(entry => entry.id === row.dataset.dragEncounter);
    if (!item) return;
    beginPrepDrag(event, {
      kind: 'encounter',
      itemId: item.id,
      sourcePath: item.sourcePath,
      count: item.count,
      fromGroupId: item.groupId,
      label: monsterNameForPath(item.sourcePath)
    }, row);
  });

  window.addEventListener('pointermove', handlePrepPointerMove, { passive: false });
  window.addEventListener('pointerup', event => endPrepDrag(event));
  window.addEventListener('pointercancel', event => endPrepDrag(event, true));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && prepDrag?.active) {
      const pointerId = prepDrag.pointerId;
      endPrepDrag({ pointerId }, true);
    }
  });

  els.monsterLibrary.addEventListener('click', async event => {
    if (Date.now() < suppressPrepClickUntil) return;
    const retry = event.target.closest('[data-retry-source]');
    if (retry) { loadSource(); return; }
    const add = event.target.closest('[data-add-monster]');
    const plus = event.target.closest('[data-qty-plus]');
    const minus = event.target.closest('[data-qty-minus]');
    if (add) await addToEncounter(add.dataset.addMonster, qtyDrafts.get(add.dataset.addMonster) || 1);
    if (plus) {
      const path = plus.dataset.qtyPlus;
      qtyDrafts.set(path, Math.min(30, (qtyDrafts.get(path) || 1) + 1));
      renderLibrary();
    }
    if (minus) {
      const path = minus.dataset.qtyMinus;
      qtyDrafts.set(path, Math.max(1, (qtyDrafts.get(path) || 1) - 1));
      renderLibrary();
    }
  });

  els.monsterLibrary.addEventListener('change', event => {
    const input = event.target.closest('[data-qty-input]');
    if (!input) return;
    qtyDrafts.set(input.dataset.qtyInput, clampInt(input.value, 1, 30));
    renderLibrary();
  });

  els.rosterGroups.addEventListener('click', event => {
    if (Date.now() < suppressPrepClickUntil) return;
    const add = event.target.closest('[data-add-one]');
    const remove = event.target.closest('[data-remove-one]');
    const removeEntry = event.target.closest('[data-remove-entry]');
    const removeGroupButton = event.target.closest('[data-remove-group]');
    const group = event.target.closest('[data-select-prep-group]');
    if (add) { changeEncounterCount(add.dataset.addOne, 1); return; }
    if (remove) { changeEncounterCount(remove.dataset.removeOne, -1); return; }
    if (removeEntry) {
      state.encounter = state.encounter.filter(item => item.id !== removeEntry.dataset.removeEntry);
      saveState();
      renderEncounter();
      return;
    }
    if (removeGroupButton) { removeGroup(removeGroupButton.dataset.removeGroup); return; }
    if (group && !event.target.closest('input, button')) {
      state.activePrepGroupId = group.dataset.selectPrepGroup;
      saveState();
      renderEncounter();
    }
  });

  els.rosterGroups.addEventListener('change', event => {
    const input = event.target.closest('[data-rename-group]');
    if (!input) return;
    const group = state.groups.find(item => item.id === input.dataset.renameGroup);
    if (!group) return;
    group.name = input.value.trim() || group.name;
    saveState();
    renderPrepGroups();
    renderEncounter();
    renderCombat();
  });


  [els.startCombat, els.startCombatInline].forEach(button => button.addEventListener('click', startCombat));
  els.clearEncounter.addEventListener('click', () => {
    state.encounter = [];
    saveState();
    renderEncounter();
    toast('Encounter cleared');
  });
  els.backToBuilder.addEventListener('click', () => setView('builder'));
  els.nextRound.addEventListener('click', nextRound);
  els.maliceMinus.addEventListener('click', () => {
    state.combat.malice = Math.max(0, state.combat.malice - 1);
    saveState();
    renderCombat();
  });
  els.malicePlus.addEventListener('click', () => {
    state.combat.malice += 1;
    saveState();
    renderCombat();
  });

  els.combatGroupRail.addEventListener('click', event => {
    const button = event.target.closest('[data-filter-group]');
    if (!button) return;
    state.combat.activeGroupFilter = state.combat.activeGroupFilter === button.dataset.filterGroup ? null : button.dataset.filterGroup;
    saveState();
    renderCombat();
  });
  els.showAllGroups.addEventListener('click', () => {
    state.combat.activeGroupFilter = null;
    saveState();
    renderCombat();
  });

  els.maliceFeatures.addEventListener('click', event => {
    const libraryToggle = event.target.closest('[data-toggle-malice-library]');
    if (libraryToggle) {
      state.ui.maliceLibraryOpen = !state.ui.maliceLibraryOpen;
      saveState();
      renderMaliceFeatures();
      return;
    }

    const autoPick = event.target.closest('[data-auto-pick-malice]');
    if (autoPick) {
      const groups = relevantMaliceGroups();
      state.combat.selectedMaliceFeatureIds = suggestedMaliceFeatureIds(groups);
      state.combat.maliceSelectionInitialized = true;
      state.combat.selectedMaliceFeatureIds.forEach(id => expandedMaliceFeatures.add(id));
      saveState();
      renderMaliceFeatures();
      toast(`${state.combat.selectedMaliceFeatureIds.length} Malice features selected`);
      return;
    }

    const add = event.target.closest('[data-add-malice-selection]');
    if (add) {
      const featureId = add.dataset.addMaliceSelection;
      if (!state.combat.selectedMaliceFeatureIds.includes(featureId)) state.combat.selectedMaliceFeatureIds.push(featureId);
      state.combat.maliceSelectionInitialized = true;
      expandedMaliceFeatures.add(featureId);
      saveState();
      renderMaliceFeatures();
      return;
    }

    const remove = event.target.closest('[data-remove-malice-selection]');
    if (remove) {
      state.combat.selectedMaliceFeatureIds = state.combat.selectedMaliceFeatureIds.filter(id => id !== remove.dataset.removeMaliceSelection);
      state.combat.maliceSelectionInitialized = true;
      saveState();
      renderMaliceFeatures();
      return;
    }

    const toggle = event.target.closest('[data-toggle-malice]');
    if (toggle) {
      const featureId = toggle.dataset.toggleMalice;
      if (expandedMaliceFeatures.has(featureId)) expandedMaliceFeatures.delete(featureId);
      else expandedMaliceFeatures.add(featureId);
      renderMaliceFeatures();
      return;
    }
    const rollButton = event.target.closest('[data-roll-malice]');
    if (rollButton) {
      rollMaliceFeature(rollButton.dataset.rollMalice, Number(rollButton.dataset.maliceEffectIndex));
      return;
    }
    const button = event.target.closest('[data-use-malice]');
    if (button) useMaliceFeature(button.dataset.useMalice);
  });

  els.activeEffects.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-effect]');
    if (!button) return;
    state.combat.activeEffects = state.combat.activeEffects.filter(effect => effect.id !== button.dataset.removeEffect);
    saveState();
    renderCombat();
  });

  els.combatBoard.addEventListener('click', event => {
    const acted = event.target.closest('[data-toggle-acted]');
    const remove = event.target.closest('[data-remove-instance]');
    const addCondition = event.target.closest('[data-add-condition]');
    const pickCondition = event.target.closest('[data-pick-condition]');
    const removeCondition = event.target.closest('[data-remove-condition]');
    const roll = event.target.closest('[data-roll-feature]');
    const spend = event.target.closest('[data-spend-ability-malice]');

    if (acted) {
      const instance = state.combat.instances.find(item => item.id === acted.dataset.toggleActed);
      if (instance) instance.acted = !instance.acted;
      saveState(); renderCombat(); return;
    }
    if (remove) {
      state.combat.instances = state.combat.instances.filter(item => item.id !== remove.dataset.removeInstance);
      saveState(); renderCombat(); return;
    }
    if (addCondition) {
      const instanceId = addCondition.dataset.addCondition;
      openConditionPickerFor = openConditionPickerFor === instanceId ? null : instanceId;
      renderCombatBoard();
      return;
    }
    if (pickCondition) {
      const instance = state.combat.instances.find(item => item.id === pickCondition.dataset.pickCondition);
      const condition = pickCondition.dataset.conditionName;
      if (instance && condition) {
        instance.conditions = [...new Set([...(instance.conditions || []), condition])];
        openConditionPickerFor = null;
        saveState(); renderCombat();
      }
      return;
    }
    if (removeCondition) {
      const instance = state.combat.instances.find(item => item.id === removeCondition.dataset.removeCondition);
      if (instance) instance.conditions = (instance.conditions || []).filter(condition => condition !== removeCondition.dataset.condition);
      saveState(); renderCombat(); return;
    }
    if (roll) {
      rollFeature(roll.dataset.rollFeature, Number(roll.dataset.featureIndex), Number(roll.dataset.effectIndex));
      return;
    }
    if (spend) spendAbilityMalice(Number(spend.dataset.spendAbilityMalice), spend.dataset.abilityName || 'Ability');
  });

  els.combatBoard.addEventListener('focusin', event => {
    if (event.target.matches('.stamina-command')) event.target.select();
  });

  els.combatBoard.addEventListener('keydown', event => {
    const input = event.target.closest('[data-stamina]');
    if (input && event.key === 'Enter') {
      event.preventDefault();
      applyStaminaCommand(input.dataset.stamina, input.value);
    }
  });

  els.combatBoard.addEventListener('change', event => {
    const stamina = event.target.closest('[data-stamina]');
    const rename = event.target.closest('[data-rename-instance]');
    const groupSelect = event.target.closest('[data-instance-group]');
    if (stamina) {
      applyStaminaCommand(stamina.dataset.stamina, stamina.value);
      return;
    }
    if (rename) {
      const instance = state.combat.instances.find(item => item.id === rename.dataset.renameInstance);
      if (instance) instance.name = rename.value.trim() || instance.name;
      saveState(); renderCombat(); return;
    }
    if (groupSelect) {
      const instance = state.combat.instances.find(item => item.id === groupSelect.dataset.instanceGroup);
      if (instance) instance.groupId = groupSelect.value;
      saveState(); renderCombat();
    }
  });

  els.resetApp.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    renderAll();
    toast('Encounter reset');
  });

  els.monsterSearch.value = state.ui.search;
  [...els.roleFilters.querySelectorAll('[data-role]')].forEach(button => button.classList.toggle('active', button.dataset.role === state.ui.role));
  renderAll();
  loadSource();
})();
