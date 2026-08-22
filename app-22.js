// EvoMaus v1.3 visual clarity pass: true fog-of-war, richer summaries and stronger lineage identity.
(() => {
  const LINEAGES = ['white', 'grey', 'black'];
  const FOV_RADIUS = 16;
  const mouseViewToggle = document.getElementById('v13MouseViewToggle');
  const pauseLineages = document.getElementById('v13PauseLineages');
  const eventOverlay = document.getElementById('v13EventOverlay');

  // Keep the product identity and generation together during play. The older layout
  // put Gen on its own row and hid the version while simulating, wasting vertical room.
  const brand = document.querySelector('.brand');
  const genChip = document.getElementById('genStat')?.closest('.statChip');
  if (brand && genChip) {
    genChip.classList.add('v134GenInline');
    brand.appendChild(genChip);
  }

  // The old centre/home affordance is no longer part of the game UI. Removing it here
  // (after all legacy scripts have attached their listeners) avoids breaking startup.
  document.getElementById('homeButton')?.remove();

  function lineageOf(mouse) {
    return mouse?.lineage || 'grey';
  }

  function bestInLineage(lineage) {
    const alive = state.mice.filter(m => m.alive && lineageOf(m) === lineage);
    const pool = alive.length ? alive : state.mice.filter(m => lineageOf(m) === lineage);
    let best = null;
    for (const mouse of pool) if (!best || computeFitness(mouse) > computeFitness(best)) best = mouse;
    return best;
  }

  function selectedMouse() {
    let mouse = state.mice.find(m => m.id === state.v13SelectedMouseId) ||
      state.mice.find(m => m.id === state.trackedMouseId) || null;
    const lineage = state.v133SelectedLineage || lineageOf(mouse);
    if (!mouse || lineageOf(mouse) !== lineage || (!mouse.alive && !mouse.reachedGoal)) {
      mouse = bestInLineage(lineage || 'grey');
      if (mouse) {
        state.v13SelectedMouseId = mouse.id;
        state.trackedMouseId = mouse.id;
      }
    }
    return mouse;
  }

  // ---- True three-state fog of war -------------------------------------------------
  let fovCacheKey = '';
  let fovCache = new Set();
  const numericKey = (x, y) => y * GRID_W + x;

  function lineVisible(x0, y0, x1, y1) {
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (x !== x1 || y !== y1) {
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return true; // the blocking wall itself is visible
      if (getCell(x, y) === CELL.WALL) return false;
    }
    return true;
  }

  function currentVisible(mouse) {
    const key = `${state.v13MazeId || 1}:${mouse.id}:${mouse.x},${mouse.y}`;
    if (key === fovCacheKey) return fovCache;

    const result = new Set();
    const r2 = FOV_RADIUS * FOV_RADIUS;
    const minX = Math.max(0, mouse.x - FOV_RADIUS), maxX = Math.min(GRID_W - 1, mouse.x + FOV_RADIUS);
    const minY = Math.max(0, mouse.y - FOV_RADIUS), maxY = Math.min(GRID_H - 1, mouse.y + FOV_RADIUS);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - mouse.x, dy = y - mouse.y;
        if (dx * dx + dy * dy > r2) continue;
        if (lineVisible(mouse.x, mouse.y, x, y)) result.add(numericKey(x, y));
      }
    }

    fovCacheKey = key;
    fovCache = result;
    return result;
  }

  function drawTrueFog(mouse) {
    // Edit mode is intentionally omniscient even if Mouse View remains enabled.
    if (!mouseViewToggle?.checked || state.mode !== 'sim' || !mouse) return;

    const visible = currentVisible(mouse);
    const memory = mouse.cognitiveMap?.cells || new Map();
    const rect = canvas.getBoundingClientRect();
    const scale = state.view.scale;
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(rect.width, rect.height);
    const minX = Math.max(0, Math.floor(topLeft.x) - 1);
    const maxX = Math.min(GRID_W - 1, Math.ceil(bottomRight.x) + 1);
    const minY = Math.max(0, Math.floor(topLeft.y) - 1);
    const maxY = Math.min(GRID_H - 1, Math.ceil(bottomRight.y) + 1);

    ctx.save();
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const key = numericKey(x, y);
        if (visible.has(key)) continue;
        const p = worldToScreen(x, y);
        // Never-seen space is effectively black. Remembered space remains readable
        // as a dim mental map, but is clearly not part of the mouse's current sight.
        ctx.fillStyle = memory.has(key) ? 'rgba(3,6,10,.64)' : 'rgba(2,3,5,.97)';
        ctx.fillRect(p.x - .4, p.y - .4, scale + .8, scale + .8);
      }
    }
    ctx.restore();
  }

  // ---- Lineage visuals -------------------------------------------------------------
  const MOUSE_STYLE = {
    white: { body: '#fffef8', ears: '#eeeae1', eye: '#15191f', nose: '#ef91a0', outline: '#737b87' },
    grey:  { body: '#909aa8', ears: '#b2bac5', eye: '#15191f', nose: '#ef91a0', outline: '#4d5664' },
    black: { body: '#171b22', ears: '#343b47', eye: '#fffdf5', nose: '#f19aa7', outline: '#aeb7c4' }
  };

  function drawDistinctMouse(mouse) {
    const style = MOUSE_STYLE[lineageOf(mouse)] || MOUSE_STYLE.grey;
    const scale = state.view.scale;
    const p = worldToScreen(mouse.renderX, mouse.renderY);
    const s = Math.max(6, scale * .58);
    const x = p.x + scale / 2 - s / 2;
    const y = p.y + scale / 2 - s / 2;
    const r = Math.max(2, s * .16);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = style.body;
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = Math.max(1.2, scale * .045);
    roundRect(ctx, x, y, s, s, r);
    ctx.fill();
    ctx.stroke();

    if (s > 8) {
      ctx.fillStyle = style.ears;
      ctx.beginPath();
      ctx.arc(x + s * .21, y + s * .12, s * .16, 0, Math.PI * 2);
      ctx.arc(x + s * .79, y + s * .12, s * .16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = style.outline;
      ctx.lineWidth = Math.max(.8, scale * .025);
      ctx.stroke();

      ctx.fillStyle = style.eye;
      ctx.beginPath();
      ctx.arc(x + s * .31, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
      ctx.arc(x + s * .69, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = style.nose;
      ctx.beginPath();
      ctx.arc(x + s * .5, y + s * .69, Math.max(1, s * .075), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawAllMiceDistinctly() {
    if (state.mode !== 'sim') return;
    for (const mouse of state.mice) {
      if (!mouse.alive && !mouse.reachedGoal) continue;
      drawDistinctMouse(mouse);
    }
  }

  function drawTargetGlow(mouse) {
    if (!mouse || state.mode !== 'sim') return;
    const p = worldToScreen(mouse.renderX + .5, mouse.renderY + .5);
    const radius = Math.max(13, state.view.scale * .72);
    ctx.save();
    const glow = ctx.createRadialGradient(p.x, p.y, radius * .28, p.x, p.y, radius);
    glow.addColorStop(0, 'rgba(45,174,255,.22)');
    glow.addColorStop(.62, 'rgba(45,174,255,.13)');
    glow.addColorStop(1, 'rgba(45,174,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(42,174,255,.95)';
    ctx.lineWidth = Math.max(2, state.view.scale * .055);
    ctx.beginPath(); ctx.arc(p.x, p.y, radius * .72, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawChampionTrail(lineage, trail) {
    if (!trail || trail.length < 2) return;
    const style = {
      white: { under: 'rgba(18,22,29,.84)', main: 'rgba(255,255,255,.96)' },
      grey:  { under: 'rgba(22,27,34,.82)', main: 'rgba(176,185,197,.96)' },
      black: { under: 'rgba(235,238,242,.82)', main: 'rgba(20,24,31,.98)' }
    }[lineage];
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let i = 0; i < trail.length; i++) {
      const key = trail[i], x = key % GRID_W, y = Math.floor(key / GRID_W);
      const p = worldToScreen(x + .5, y + .5);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = style.under;
    ctx.lineWidth = Math.max(4, state.view.scale * .16);
    ctx.stroke();
    ctx.strokeStyle = style.main;
    ctx.lineWidth = Math.max(1.8, state.view.scale * .075);
    ctx.stroke();
    ctx.restore();
  }

  function drawStrongChampionTrails() {
    const trailsToggle = document.getElementById('v13TrailsToggle');
    if (state.mode !== 'sim' || trailsToggle?.checked === false) return;
    const records = state.v13CurrentMazeRecords || {};
    for (const lineage of LINEAGES) drawChampionTrail(lineage, records[lineage]?.championTrail);
  }

  // Render without any legacy tracked square / paused-only selection marker / old
  // mouse-view shading. Then redraw the lineage sprites, proper fog and one circular target glow.
  const previousRenderV134 = render;
  render = function () {
    const oldPaused = state.paused;
    const oldMouseView = mouseViewToggle?.checked;
    const oldChooseTrackedMouse = chooseTrackedMouse;

    if (state.mode === 'sim') state.paused = false;
    if (mouseViewToggle && oldMouseView) mouseViewToggle.checked = false;
    chooseTrackedMouse = () => null;

    previousRenderV134();

    chooseTrackedMouse = oldChooseTrackedMouse;
    if (mouseViewToggle && oldMouseView) mouseViewToggle.checked = true;
    state.paused = oldPaused;

    drawStrongChampionTrails();
    drawAllMiceDistinctly();
    const mouse = selectedMouse();
    drawTrueFog(mouse);
    drawTargetGlow(mouse);
  };

  // ---- Richer generation summary --------------------------------------------------
  function generationSpeciesSummary(lineage) {
    const group = state.mice.filter(m => lineageOf(m) === lineage);
    if (!group.length) return null;

    let bestProgress = 0;
    for (const mouse of group) bestProgress = Math.max(bestProgress, progressOf(mouse));
    const contenders = group.filter(m => Math.abs(progressOf(m) - bestProgress) < .00001);
    const bestSteps = contenders.length ? Math.min(...contenders.map(m => m.step || 0)) : 0;
    const cheese = Math.max(...group.map(m => m.cheeseCount || 0));
    const danger = group.filter(m => m.deathReason === 'danger').length;
    const goals = group.filter(m => m.reachedGoal).length;
    const died = group.length - goals;

    return { lineage, total: group.length, bestProgress, bestSteps, cheese, danger, goals, died };
  }

  function richerSummaryHtml() {
    return `<div class="v134SummaryRows">${LINEAGES.map(lineage => {
      const s = generationSpeciesSummary(lineage);
      if (!s) return '';
      const solved = s.bestProgress >= .99999;
      return `<div class="v134SpeciesSummary lineage-${lineage}">
        <div class="v134SummaryHead"><b><i></i>${lineage.toUpperCase()}</b><strong>${Math.round(s.bestProgress * 100)}%</strong></div>
        <div class="v134SummaryMeta"><span>🧀 ${s.cheese}</span><span>Best ${s.bestSteps} steps</span><span>☠ Danger ${s.danger}</span></div>
        ${solved ? `<div class="v134GoalResult"><b>${s.goals}</b> reached goal · <b>${s.died}</b> died</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  const previousBeginNextGenerationV134 = beginNextGeneration;
  beginNextGeneration = function () {
    previousBeginNextGenerationV134();
    const title = document.getElementById('v13EventTitle');
    const body = document.getElementById('v13EventBody');
    if (eventOverlay?.classList.contains('show') && title?.textContent?.startsWith('Generation ') && title.textContent.includes('complete') && body) {
      body.innerHTML = richerSummaryHtml();
    }
  };

  // ---- Compact pause lineage cards ------------------------------------------------
  function compactPauseCards() {
    if (!pauseLineages) return;
    for (const card of pauseLineages.querySelectorAll('.v131PauseCard')) {
      const alive = card.querySelector(':scope > b');
      const record = card.querySelector(':scope > small');
      if (alive) alive.textContent = alive.textContent.replace(/\s*alive\s*$/i, '');
      if (record) record.textContent = record.textContent.replace(/^Record\s*·\s*/i, '');
    }
  }

  if (pauseLineages) {
    new MutationObserver(compactPauseCards).observe(pauseLineages, { childList: true, subtree: true });
    compactPauseCards();
  }

  const previousUpdateStatsV134 = updateStats;
  updateStats = function () {
    previousUpdateStatsV134();
    compactPauseCards();
  };

  document.body.classList.add('v134Ready');
})();
