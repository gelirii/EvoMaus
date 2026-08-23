// EvoMaus v1.3 Algernon + state-fix pass.
(() => {
  const NATURAL = ['white', 'grey', 'black'];
  const ALGERNON = 'algernon';
  const RECENT_SOLVER_CAP = 24;
  const ALGERNON_SUCCESS_CAP = 16;
  const SUMMARY_MIGRATION_KEY = 'evomaus-v13-summary-default-v33';
  const SETTINGS_KEY = 'evomaus-v13-settings';

  const pauseOverlay = document.getElementById('v13PauseOverlay');
  const eventOverlay = document.getElementById('v13EventOverlay');
  const eventEyebrow = document.getElementById('v13EventEyebrow');
  const eventTitle = document.getElementById('v13EventTitle');
  const eventBody = document.getElementById('v13EventBody');
  const eventContinue = document.getElementById('v13EventContinue');
  const pauseButtonEl = document.getElementById('pauseButton');
  const resumeButton = document.getElementById('v13ResumeButton');
  const skipBadge = document.getElementById('v13SkipBadge');
  const summaryToggle = document.getElementById('v13SummaryToggle');
  const trailsToggle = document.getElementById('v13TrailsToggle');
  const mouseViewToggle = document.getElementById('v13MouseViewToggle');
  const liveLineages = document.getElementById('v13LiveLineages');
  const pauseLineages = document.getElementById('v13PauseLineages');
  const mazeLabel = document.getElementById('v13MazeLabel');
  const mainEdit = document.getElementById('editButton');
  const pauseEdit = document.getElementById('v13EditMazeButton');
  const startButtonEl = document.getElementById('startButton');

  const lineageOf = mouse => mouse?.lineage || 'grey';
  const archiveKey = mouse => `${mouse?.generation || state.generation}:${mouse?.id ?? 'x'}`;

  function emptyBank() {
    return {
      firstByMaze: {},
      fastestByMaze: {},
      bestProgressByMaze: {},
      recentSolvers: [],
      successfulAlgernons: [],
      seenSolvers: new Set()
    };
  }

  state.v137AlgernonBank = state.v137AlgernonBank || emptyBank();
  state.v137ObservedMazeId = state.v13MazeId || 1;
  state.v137MazeStartGeneration = state.generation || 1;
  state.v137SuspendedAlgernon = null;
  state.v137LastAlgernonSummary = null;

  function mazeId() { return state.v13MazeId || 1; }

  function syncMazeRun() {
    const id = mazeId();
    if (state.v137ObservedMazeId !== id) {
      state.v137ObservedMazeId = id;
      state.v137MazeStartGeneration = state.generation || 1;
    }
    return Math.max(1, (state.generation || 1) - (state.v137MazeStartGeneration || 1) + 1);
  }

  function ensureAlgernonRecord() {
    if (!state.v13CurrentMazeRecords) state.v13CurrentMazeRecords = {};
    if (!state.v13CurrentMazeRecords[ALGERNON]) {
      state.v13CurrentMazeRecords[ALGERNON] = {
        bestProgress: 0,
        firstSolveGeneration: null,
        bestTime: null,
        maxCheese: 0,
        championTrail: null,
        championMouseId: null,
        championGeneration: null
      };
    }
    return state.v13CurrentMazeRecords[ALGERNON];
  }
  ensureAlgernonRecord();

  try {
    if (!localStorage.getItem(SUMMARY_MIGRATION_KEY)) {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
      settings.generationSummary = true;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      localStorage.setItem(SUMMARY_MIGRATION_KEY, '1');
      if (summaryToggle) {
        summaryToggle.checked = true;
        summaryToggle.dispatchEvent(new Event('input', { bubbles: true }));
        summaryToggle.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  } catch (_) {
    if (summaryToggle) summaryToggle.checked = true;
  }

  function cancelSkip() {
    state.v13Skip = null;
    document.body.classList.remove('v13Skipping');
    skipBadge?.classList.remove('show');
    if (skipBadge) skipBadge.style.display = '';
  }

  pauseButtonEl?.addEventListener('click', cancelSkip, true);
  resumeButton?.addEventListener('click', cancelSkip, true);

  function normaliseAfterEventContinue() {
    cancelSkip();
    pauseOverlay?.classList.remove('show');
    document.body.classList.remove('v13PauseOpen', 'paused');
    state.paused = false;
    if (pauseButtonEl) pauseButtonEl.textContent = '⏸ Pause';
    state.freeCamera = false;
  }

  eventContinue?.addEventListener('click', () => setTimeout(normaliseAfterEventContinue, 0));

  function cloneArchive(mouse, role = '') {
    if (!mouse?.genome) return null;
    return {
      key: archiveKey(mouse),
      sourceId: mouse.id,
      generation: mouse.generation || state.generation,
      lineage: lineageOf(mouse),
      maze: mazeId(),
      role,
      step: mouse.step || 0,
      progress: progressOf(mouse),
      cheese: mouse.cheeseCount || 0,
      genome: mouse.genome.slice()
    };
  }

  function pushCapped(array, entry, cap) {
    if (!entry) return;
    const idx = array.findIndex(item => item.key === entry.key);
    if (idx >= 0) array.splice(idx, 1);
    array.push(entry);
    while (array.length > cap) array.shift();
  }

  function archiveSolver(mouse) {
    if (!mouse?.reachedGoal) return;
    const bank = state.v137AlgernonBank;
    const key = archiveKey(mouse);
    if (bank.seenSolvers.has(key)) return;
    bank.seenSolvers.add(key);

    const id = mazeId();
    const entry = cloneArchive(mouse, 'solver');
    if (!bank.firstByMaze[id]) bank.firstByMaze[id] = { ...entry, role: 'first-solver' };
    if (!bank.fastestByMaze[id] || entry.step < bank.fastestByMaze[id].step) {
      bank.fastestByMaze[id] = { ...entry, role: 'fastest-solver' };
    }
    delete bank.bestProgressByMaze[id];
    pushCapped(bank.recentSolvers, { ...entry, role: 'recent-solver' }, RECENT_SOLVER_CAP);
    if (lineageOf(mouse) === ALGERNON) {
      pushCapped(bank.successfulAlgernons, { ...entry, role: 'successful-algernon' }, ALGERNON_SUCCESS_CAP);
    }
  }

  function archiveBestProgress(mice) {
    const id = mazeId();
    const bank = state.v137AlgernonBank;
    if (bank.firstByMaze[id]) return;
    let best = null;
    for (const mouse of mice || []) {
      if (!mouse?.genome) continue;
      if (!best || computeFitness(mouse) > computeFitness(best)) best = mouse;
    }
    if (!best) return;
    const entry = cloneArchive(best, 'maze-best-progress');
    const existing = bank.bestProgressByMaze[id];
    if (!existing || entry.progress > existing.progress + 0.00001 ||
        Math.abs(entry.progress - existing.progress) < 0.00001 && computeFitness(best) > (existing.fitness || -Infinity)) {
      entry.fitness = computeFitness(best);
      bank.bestProgressByMaze[id] = entry;
    }
  }

  function weightedParentPool() {
    const bank = state.v137AlgernonBank;
    const weighted = new Map();
    const add = (entry, weight) => {
      if (!entry?.genome) return;
      const existing = weighted.get(entry.key);
      if (existing) existing.weight += weight;
      else weighted.set(entry.key, { entry, weight });
    };
    Object.values(bank.firstByMaze).forEach(entry => add(entry, 5));
    Object.values(bank.fastestByMaze).forEach(entry => add(entry, 5));
    Object.values(bank.bestProgressByMaze).forEach(entry => add(entry, 3));
    bank.recentSolvers.forEach(entry => add(entry, 2));
    bank.successfulAlgernons.forEach(entry => add(entry, 4));
    return [...weighted.values()];
  }

  function weightedSampleWithoutReplacement(pool, count) {
    const working = pool.slice();
    const chosen = [];
    while (working.length && chosen.length < count) {
      const total = working.reduce((sum, item) => sum + item.weight, 0);
      let r = Math.random() * total;
      let index = 0;
      for (; index < working.length; index++) {
        r -= working[index].weight;
        if (r <= 0) break;
      }
      chosen.push(working.splice(Math.min(index, working.length - 1), 1)[0].entry);
    }
    return chosen;
  }

  function breedAlgernonGenome(fallbackBest = null) {
    let pool = weightedParentPool();
    if (!pool.length && fallbackBest?.genome) {
      const fallback = cloneArchive(fallbackBest, 'fallback-champion');
      pool = [{ entry: fallback, weight: 1 }];
    }
    if (!pool.length) return { genome: randomGenome(), parents: [] };

    const parents = weightedSampleWithoutReplacement(pool, Math.min(pool.length, 5));
    if (parents.length === 1) {
      const genome = parents[0].genome.slice();
      for (let i = 0; i < genome.length; i++) {
        if (Math.random() < 0.012) genome[i] = Math.max(-4, Math.min(4, genome[i] + (Math.random() + Math.random() - 1) * 0.24));
      }
      return { genome, parents };
    }

    const length = parents[0].genome.length;
    const genome = new Float32Array(length);
    const blocks = Math.min(12, Math.max(5, parents.length * 2));
    const blockSize = Math.max(1, Math.ceil(length / blocks));
    for (let block = 0; block < blocks; block++) {
      const parent = parents[Math.floor(Math.random() * parents.length)];
      const start = block * blockSize;
      const end = Math.min(length, start + blockSize);
      for (let i = start; i < end; i++) genome[i] = parent.genome[i];
    }

    for (let i = 0; i < genome.length; i++) {
      if (Math.random() < 0.012) {
        if (Math.random() < 0.01) genome[i] = (Math.random() * 2 - 1) * 1.2;
        else genome[i] += (Math.random() + Math.random() - 1) * 0.24;
        genome[i] = Math.max(-4, Math.min(4, genome[i]));
      }
    }
    return { genome, parents };
  }

  function createAlgernon(generation, fallbackBest = null, forcedGenome = null, forcedParents = null) {
    ensureAlgernonRecord();
    const bred = forcedGenome
      ? { genome: forcedGenome.slice(), parents: forcedParents || [] }
      : generation === 1
        ? { genome: randomGenome(), parents: [] }
        : breedAlgernonGenome(fallbackBest);
    const parentIds = bred.parents.map(parent => parent.sourceId).filter(Number.isFinite);
    const mouse = makeMouse(bred.genome, generation, parentIds, ALGERNON);
    mouse.v137Algernon = true;
    mouse.v137ParentArchive = bred.parents.map(parent => ({
      lineage: parent.lineage,
      generation: parent.generation,
      maze: parent.maze,
      role: parent.role
    }));
    state.mice.push(mouse);
    return mouse;
  }

  function algernonMouse() {
    return state.mice.find(mouse => lineageOf(mouse) === ALGERNON) || null;
  }

  const previousTickMouseV137 = tickMouse;
  tickMouse = function (mouse) {
    ensureAlgernonRecord();
    const protect = lineageOf(mouse) === ALGERNON && state.generation === 1 && mazeId() === 1 && syncMazeRun() === 1;
    const before = protect ? {
      x: mouse.x, y: mouse.y, renderX: mouse.renderX, renderY: mouse.renderY,
      alive: mouse.alive, deathReason: mouse.deathReason
    } : null;
    const wasGoal = !!mouse.reachedGoal;
    previousTickMouseV137(mouse);

    if (protect && !mouse.alive && mouse.deathReason === 'danger') {
      mouse.x = before.x; mouse.y = before.y;
      mouse.renderX = before.renderX; mouse.renderY = before.renderY;
      mouse.alive = true; mouse.deathReason = before.deathReason || null;
      mouse.v137ProtectedDangerTurns = (mouse.v137ProtectedDangerTurns || 0) + 1;
      if (Number.isFinite(mouse.fitness)) mouse.fitness = computeFitness(mouse);
    }

    if (!wasGoal && mouse.reachedGoal) archiveSolver(mouse);
  };

  function stripAlgernonForEdit() {
    if (state.mode !== 'sim') return;
    const mouse = algernonMouse();
    if (!mouse) return;
    state.v137SuspendedAlgernon = {
      genome: mouse.genome.slice(),
      parentArchive: mouse.v137ParentArchive ? mouse.v137ParentArchive.slice() : [],
      parentIds: Array.isArray(mouse.parentIds) ? mouse.parentIds.slice() : []
    };
    state.mice = state.mice.filter(item => item !== mouse);
  }
  mainEdit?.addEventListener('click', stripAlgernonForEdit, true);
  pauseEdit?.addEventListener('click', stripAlgernonForEdit, true);

  startButtonEl?.addEventListener('click', () => {
    if (state.mode !== 'sim' || algernonMouse() || !state.v137SuspendedAlgernon) return;
    const saved = state.v137SuspendedAlgernon;
    const mouse = createAlgernon(state.generation, null, saved.genome, []);
    mouse.parentIds = saved.parentIds || [];
    mouse.v137ParentArchive = saved.parentArchive || [];
    state.v137SuspendedAlgernon = null;
    updateStats();
  });

  const previousInitialiseGenerationOneV137 = initialiseGenerationOne;
  initialiseGenerationOne = function () {
    previousInitialiseGenerationOneV137();
    state.v137AlgernonBank = emptyBank();
    state.v137ObservedMazeId = mazeId();
    state.v137MazeStartGeneration = 1;
    state.v137LastAlgernonSummary = null;
    ensureAlgernonRecord();
    createAlgernon(1);
    updateStats();
  };

  function snapshotAlgernonSummary(mouse) {
    if (!mouse) return null;
    return {
      progress: progressOf(mouse),
      step: mouse.step || 0,
      cheese: mouse.cheeseCount || 0,
      reachedGoal: !!mouse.reachedGoal,
      deathReason: mouse.deathReason || '',
      generation: mouse.generation || state.generation
    };
  }

  const previousBeginNextGenerationV137 = beginNextGeneration;
  beginNextGeneration = function () {
    const beforeGeneration = state.generation;
    const oldMice = state.mice.slice();
    const oldAlgernon = oldMice.find(mouse => lineageOf(mouse) === ALGERNON) || null;
    const fallbackBest = oldMice.reduce((best, mouse) => !best || computeFitness(mouse) > computeFitness(best) ? mouse : best, null);
    archiveBestProgress(oldMice);
    oldMice.forEach(mouse => { if (mouse.reachedGoal) archiveSolver(mouse); });
    state.v137LastAlgernonSummary = snapshotAlgernonSummary(oldAlgernon);

    const result = previousBeginNextGenerationV137();

    if (state.generation !== beforeGeneration) {
      ensureAlgernonRecord();
      const nextAlgernon = createAlgernon(state.generation, fallbackBest);
      if (fallbackBest && lineageOf(fallbackBest) === ALGERNON) {
        state.trackedMouseId = nextAlgernon.id;
        state.v13SelectedMouseId = nextAlgernon.id;
        state.v133SelectedLineage = ALGERNON;
        state.v136ManualLineage = null;
      }
      updateStats();
    }
    return result;
  };

  function algernonStats() {
    ensureAlgernonRecord();
    const mouse = algernonMouse();
    const record = state.v13CurrentMazeRecords[ALGERNON];
    const progress = Math.max(record.bestProgress || 0, mouse ? progressOf(mouse) : 0);
    const cheese = Math.max(record.maxCheese || 0, mouse?.cheeseCount || 0);
    return { mouse, record, progress, cheese };
  }

  function ensureAlgernonCards() {
    const { mouse, record, progress, cheese } = algernonStats();
    if (!mouse && state.mode !== 'sim') return;
    const following = mouse && state.trackedMouseId === mouse.id;

    if (liveLineages) {
      let card = liveLineages.querySelector('[data-v137-algernon]');
      if (!card) {
        card = document.createElement('button');
        card.className = 'v131LiveCard lineage-algernon v137AlgernonCard';
        card.dataset.v137Algernon = '1';
        card.dataset.v13Lineage = ALGERNON;
        liveLineages.appendChild(card);
      }
      card.classList.toggle('following', !!following);
      card.innerHTML = `<span class="v131LiveName"><i></i>ALGERNON</span><strong>${mouse?.alive ? '1/1' : '0/1'}</strong><small>🧀 ${cheese} · ${record.firstSolveGeneration !== null ? 'solved' : `best ${Math.round(progress * 100)}%`}</small>`;
    }

    if (pauseLineages) {
      let card = pauseLineages.querySelector('[data-v137-algernon]');
      if (!card) {
        card = document.createElement('button');
        card.className = 'v131PauseCard lineage-algernon v137AlgernonCard';
        card.dataset.v137Algernon = '1';
        card.dataset.v13Lineage = ALGERNON;
        pauseLineages.appendChild(card);
      }
      card.classList.toggle('following', !!following);
      card.innerHTML = `<span class="v131PauseName"><i></i>ALGERNON</span><b>${mouse?.alive ? '1/1' : '0/1'}</b><strong>${Math.round(progress * 100)}%</strong><span class="v131PauseCheese">🧀 ${cheese}</span><small>${record.firstSolveGeneration === null ? 'no solve yet' : `first G${record.firstSolveGeneration}${record.bestTime ? ` · best ${record.bestTime}` : ''}`}</small>`;
    }
  }

  function selectAlgernon(event) {
    const card = event.target.closest('[data-v137-algernon]');
    if (!card || state.mode !== 'sim') return;
    const mouse = algernonMouse();
    if (!mouse) return;
    state.v136ManualLineage = ALGERNON;
    state.v133SelectedLineage = ALGERNON;
    state.v13SelectedMouseId = mouse.id;
    state.trackedMouseId = mouse.id;
    state.freeCamera = false;
    if (state.paused) {
      state.view.cx = mouse.renderX + .5;
      state.view.cy = mouse.renderY + .5;
      clampView();
      document.body.classList.add('v136PauseInspecting');
    }
    setTimeout(updateStats, 0);
  }
  liveLineages?.addEventListener('click', selectAlgernon, true);
  pauseLineages?.addEventListener('click', selectAlgernon, true);

  function updateRunLabels() {
    const run = syncMazeRun();
    if (mazeLabel) mazeLabel.textContent = `Maze ${mazeId()} · Run ${run} · Gen ${state.generation}`;
    if (eventOverlay?.classList.contains('show') && eventEyebrow) {
      eventEyebrow.textContent = `MAZE ${mazeId()} · RUN ${run}`;
    }
  }

  function algernonSummaryHtml(summary) {
    if (!summary) return '';
    const danger = summary.deathReason === 'danger' ? 1 : 0;
    return `<div class="v134SpeciesSummary lineage-algernon v137AlgernonSummary">
      <div class="v134SummaryHead"><b><i></i>ALGERNON</b><strong>${Math.round(summary.progress * 100)}%</strong></div>
      <div class="v134SummaryMeta"><span>🧀 ${summary.cheese}</span><span>Best ${summary.step} steps</span><span>☠ Danger ${danger}</span></div>
      ${summary.reachedGoal ? '<div class="v134GoalResult"><b>Reached goal</b> · experimental lineage survives in the gene bank</div>' : `<div class="v137AlgernonOutcome">${summary.deathReason ? `Died: ${summary.deathReason}` : 'Run complete'}</div>`}
    </div>`;
  }

  function decorateEvent() {
    if (!eventOverlay?.classList.contains('show')) return;
    updateRunLabels();
    const title = eventTitle?.textContent || '';
    if (/Generation\s+\d+\s+complete/i.test(title) && eventBody && !eventBody.querySelector('.v137AlgernonSummary')) {
      let rows = eventBody.querySelector('.v134SummaryRows');
      if (!rows) {
        rows = document.createElement('div');
        rows.className = 'v134SummaryRows';
        eventBody.appendChild(rows);
      }
      rows.insertAdjacentHTML('beforeend', algernonSummaryHtml(state.v137LastAlgernonSummary || snapshotAlgernonSummary(algernonMouse())));
    }
  }

  if (eventOverlay) {
    new MutationObserver(() => requestAnimationFrame(decorateEvent)).observe(eventOverlay, { attributes: true, childList: true, subtree: true, attributeFilter: ['class'] });
  }

  function lineVisible(x0, y0, x1, y1) {
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (x !== x1 || y !== y1) {
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return true;
      if (getCell(x, y) === CELL.WALL) return false;
    }
    return true;
  }

  function visibleToSelected(mouse) {
    if (!mouseViewToggle?.checked) return true;
    const selected = state.mice.find(item => item.id === state.v13SelectedMouseId) || state.mice.find(item => item.id === state.trackedMouseId);
    if (!selected) return false;
    if (selected.id === mouse.id) return true;
    const dx = mouse.x - selected.x, dy = mouse.y - selected.y;
    return dx * dx + dy * dy <= 16 * 16 && lineVisible(selected.x, selected.y, mouse.x, mouse.y);
  }

  function drawAlgernon(mouse) {
    if (!mouse || (!mouse.alive && !mouse.reachedGoal) || !visibleToSelected(mouse)) return;
    const scale = state.view.scale;
    const p = worldToScreen(mouse.renderX, mouse.renderY);
    const s = Math.max(6, scale * .58);
    const x = p.x + scale / 2 - s / 2, y = p.y + scale / 2 - s / 2;
    ctx.save();
    ctx.fillStyle = '#b9f2c8';
    ctx.strokeStyle = '#4fa96d';
    ctx.lineWidth = Math.max(1.2, scale * .045);
    roundRect(ctx, x, y, s, s, Math.max(2, s * .16));
    ctx.fill(); ctx.stroke();
    if (s > 8) {
      ctx.fillStyle = '#d7f8df';
      ctx.beginPath();
      ctx.arc(x + s * .21, y + s * .12, s * .16, 0, Math.PI * 2);
      ctx.arc(x + s * .79, y + s * .12, s * .16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#193522';
      ctx.beginPath();
      ctx.arc(x + s * .31, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
      ctx.arc(x + s * .69, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ee8f9e';
      ctx.beginPath(); ctx.arc(x + s * .5, y + s * .69, Math.max(1, s * .075), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawAlgernonTrail() {
    if (mouseViewToggle?.checked || trailsToggle?.checked === false) return;
    const trail = ensureAlgernonRecord().championTrail;
    if (!trail || trail.length < 2) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    trail.forEach((key, index) => {
      const p = worldToScreen(key % GRID_W + .5, Math.floor(key / GRID_W) + .5);
      if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    });
    ctx.strokeStyle = 'rgba(30,74,45,.84)'; ctx.lineWidth = Math.max(4, state.view.scale * .16); ctx.stroke();
    ctx.strokeStyle = 'rgba(185,242,200,.96)'; ctx.lineWidth = Math.max(1.8, state.view.scale * .075); ctx.stroke();
    ctx.restore();
  }

  const previousRenderV137 = render;
  render = function () {
    previousRenderV137();
    if (state.mode === 'sim') {
      drawAlgernonTrail();
      drawAlgernon(algernonMouse());
    }
  };

  const previousUpdateStatsV137 = updateStats;
  updateStats = function () {
    ensureAlgernonRecord();
    previousUpdateStatsV137();
    updateRunLabels();
    ensureAlgernonCards();
  };

  document.body.classList.add('v137Ready');
  updateRunLabels();
  ensureAlgernonCards();
})();
