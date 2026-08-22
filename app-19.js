// EvoMaus v1.3 UI refinement: lineage-first HUD, usable pause inspector and visible white trails.
(() => {
  const V131_LINEAGES = ['white', 'grey', 'black'];
  const V131_UI_INTERVAL = 120;

  const liveLineages = document.getElementById('v13LiveLineages');
  const pauseLineages = document.getElementById('v13PauseLineages');
  const pauseOverlayEl = document.getElementById('v13PauseOverlay');
  const recordsEl = document.getElementById('v13Records');

  function lineageOf(mouse) {
    return mouse?.lineage || 'grey';
  }

  function recordsFor(lineage) {
    const records = state.v13CurrentMazeRecords || {};
    return records[lineage] || {
      bestProgress: 0,
      firstSolveGeneration: null,
      bestTime: null,
      maxCheese: 0,
      championTrail: null
    };
  }

  function lineageStats(lineage) {
    const group = state.mice.filter(mouse => lineageOf(mouse) === lineage);
    const alive = group.filter(mouse => mouse.alive);
    const record = recordsFor(lineage);

    let currentBestProgress = 0;
    let currentBestCheese = 0;
    for (const mouse of group) {
      currentBestProgress = Math.max(currentBestProgress, progressOf(mouse));
      currentBestCheese = Math.max(currentBestCheese, mouse.cheeseCount || 0);
    }

    return {
      group,
      alive,
      record,
      progress: Math.max(record.bestProgress || 0, currentBestProgress),
      cheese: Math.max(record.maxCheese || 0, currentBestCheese)
    };
  }

  function liveCardHtml(lineage) {
    const stats = lineageStats(lineage);
    const tracked = state.mice.find(mouse => mouse.id === state.trackedMouseId);
    const following = tracked && lineageOf(tracked) === lineage;
    const solved = stats.record.firstSolveGeneration !== null;
    return `<button class="v131LiveCard lineage-${lineage}${following ? ' following' : ''}" data-v131-lineage="${lineage}" aria-label="Follow best ${lineage} mouse">
      <span class="v131LiveName"><i></i>${lineage.toUpperCase()}</span>
      <strong>${stats.alive.length}/${stats.group.length}</strong>
      <small>🧀 ${stats.cheese} · best ${solved ? '✓ ' : ''}${Math.round(stats.progress * 100)}%</small>
    </button>`;
  }

  function recordText(record) {
    if (record.firstSolveGeneration === null) return 'Record · no solve yet';
    const best = Number.isFinite(record.bestTime) ? ` · best ${record.bestTime} steps` : '';
    return `Record · first solve G${record.firstSolveGeneration}${best}`;
  }

  function pauseCardHtml(lineage) {
    const stats = lineageStats(lineage);
    const tracked = state.mice.find(mouse => mouse.id === state.trackedMouseId);
    const following = tracked && lineageOf(tracked) === lineage;
    return `<button class="v131PauseCard lineage-${lineage}${following ? ' following' : ''}" data-v131-lineage="${lineage}">
      <span class="v131PauseName"><i></i>${lineage.toUpperCase()}</span>
      <b>${stats.alive.length}/${stats.group.length} alive</b>
      <strong>${Math.round(stats.progress * 100)}%</strong>
      <span class="v131PauseCheese">🧀 ${stats.cheese}</span>
      <small>${recordText(stats.record)}</small>
    </button>`;
  }

  function renderLiveCards() {
    if (!liveLineages) return;
    liveLineages.innerHTML = V131_LINEAGES.map(liveCardHtml).join('');
  }

  function renderPauseCards() {
    if (!pauseLineages) return;
    pauseLineages.innerHTML = V131_LINEAGES.map(pauseCardHtml).join('');
  }

  function chooseBestInLineage(lineage) {
    const alive = state.mice.filter(mouse => mouse.alive && lineageOf(mouse) === lineage);
    const pool = alive.length ? alive : state.mice.filter(mouse => lineageOf(mouse) === lineage);
    let best = null;
    for (const mouse of pool) {
      if (!best || computeFitness(mouse) > computeFitness(best)) best = mouse;
    }
    return best;
  }

  function followLineage(lineage) {
    if (state.mode !== 'sim') return;
    const mouse = chooseBestInLineage(lineage);
    if (!mouse) return;

    state.trackedMouseId = mouse.id;
    state.freeCamera = false;

    // The live cards are always a follow control. Only a paused game promotes the
    // followed mouse into the detailed inspector selection.
    if (state.paused) {
      state.v13SelectedMouseId = mouse.id;
      state.view.cx = mouse.renderX + 0.5;
      state.view.cy = mouse.renderY + 0.5;
      clampView();
    }

    renderLiveCards();
    renderPauseCards();
    if (!state.paused) showToast(`Following ${lineage[0].toUpperCase() + lineage.slice(1)}'s best mouse.`);
  }

  function lineageButtonHandler(event) {
    const button = event.target.closest('[data-v131-lineage]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    followLineage(button.dataset.v131Lineage);

    // app-18 refreshes its inspector in a separate pause-menu pass. An ordinary
    // updateStats call refreshes it immediately without waiting for another frame.
    if (state.paused) setTimeout(() => updateStats(), 0);
  }

  liveLineages?.addEventListener('click', lineageButtonHandler, true);
  pauseLineages?.addEventListener('click', lineageButtonHandler, true);

  // The older v1.3 layer sometimes rebuilds these containers from private helpers
  // (e.g. after tapping a mouse on the canvas). Restore the lineage-first cards when
  // that happens, without creating a MutationObserver loop on our own markup.
  if (liveLineages) {
    new MutationObserver(() => {
      if (!liveLineages.querySelector('.v131LiveCard')) renderLiveCards();
    }).observe(liveLineages, { childList: true });
  }
  if (pauseLineages) {
    new MutationObserver(() => {
      if (!pauseLineages.querySelector('.v131PauseCard')) renderPauseCards();
    }).observe(pauseLineages, { childList: true });
  }

  // The current-maze records are now integrated directly into the three species
  // cards, so the old collapsed duplicate records section only wastes pause space.
  recordsEl?.closest('.v13Section')?.classList.add('v131LegacyRecords');

  // Live HUD: generation plus the three species cards. Generic Alive/Cheese/Progress
  // and Energy chips are intentionally removed; per-mouse energy belongs in Inspector.
  for (const id of ['aliveStat', 'progressStat', 'cheeseStat', 'energyStat']) {
    document.getElementById(id)?.closest('.statChip')?.classList.add('v131HiddenStat');
  }
  document.getElementById('genStat')?.closest('.statChip')?.classList.add('v131GenStat');

  // app-18 refreshes lineage HTML on every updateStats call. Throttle the visual HUD
  // work to ~8fps; the simulation itself still ticks at full requested speed.
  const previousUpdateStatsV131 = updateStats;
  let lastUiAt = -Infinity;
  let lastGeneration = -1;
  let lastMode = null;
  updateStats = function () {
    const now = performance.now();
    const force = state.generation !== lastGeneration || state.mode !== lastMode || state.paused || now - lastUiAt >= V131_UI_INTERVAL;
    if (!force) return;
    previousUpdateStatsV131();
    renderLiveCards();
    if (pauseOverlayEl?.classList.contains('show')) renderPauseCards();
    lastUiAt = now;
    lastGeneration = state.generation;
    lastMode = state.mode;
  };

  function drawWhiteChampionTrail() {
    const trailsToggle = document.getElementById('v13TrailsToggle');
    if (state.mode !== 'sim' || trailsToggle?.checked === false) return;
    const trail = state.v13CurrentMazeRecords?.white?.championTrail;
    if (!trail || trail.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < trail.length; i++) {
      const key = trail[i];
      const x = key % GRID_W;
      const y = Math.floor(key / GRID_W);
      const p = worldToScreen(x + 0.5, y + 0.5);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }

    // A dark under-stroke gives the white lineage a visible edge on EvoMaus' cream
    // maze background, followed by the actual white trail on top.
    ctx.strokeStyle = 'rgba(27,32,41,.58)';
    ctx.lineWidth = Math.max(3.5, state.view.scale * 0.16);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = Math.max(1.7, state.view.scale * 0.075);
    ctx.stroke();
    ctx.restore();
  }

  const previousRenderV131 = render;
  render = function () {
    previousRenderV131();
    drawWhiteChampionTrail();
  };

  renderLiveCards();
  renderPauseCards();
})();
