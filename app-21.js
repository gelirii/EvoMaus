// EvoMaus v1.3 UI refinement: lineage-only inspection and live fog-of-war mouse view.
(() => {
  const pauseOverlay = document.getElementById('v13PauseOverlay');
  const sheet = pauseOverlay?.querySelector('.v13Sheet');
  const head = sheet?.querySelector('.v13SheetHead');
  const actions = head?.querySelector('.v132PauseActions');
  const resume = document.getElementById('v13ResumeButton');
  const skip = document.getElementById('v13SkipButton');
  const edit = document.getElementById('v13EditMazeButton');
  const reset = document.getElementById('v13ResetButton');
  const mouseViewToggle = document.getElementById('v13MouseViewToggle');
  const liveLineages = document.getElementById('v13LiveLineages');
  const pauseLineages = document.getElementById('v13PauseLineages');
  const stopEditButton = document.getElementById('stopEditButton');

  if (!sheet || !head || !actions) return;

  // Pause has exactly three primary actions, all in one transport row.
  if (resume) actions.appendChild(resume);
  if (skip) actions.appendChild(skip);
  if (edit) {
    edit.textContent = '✎ Edit';
    edit.className = 'v133EditTop';
    actions.appendChild(edit);
  }

  // Full reset is deliberately an editor-only action. The existing editor reset
  // button already carries the destructive confirmation/reset behaviour from v1.3.
  if (reset) reset.remove();
  if (stopEditButton) {
    stopEditButton.textContent = '↺ Reset';
    stopEditButton.title = 'Reset everything';
  }

  function lineageOf(mouse) {
    return mouse?.lineage || 'grey';
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

  function trackedMouse() {
    return state.mice.find(mouse => mouse.id === state.trackedMouseId) || null;
  }

  function selectedLineage() {
    if (state.v133SelectedLineage) return state.v133SelectedLineage;
    const tracked = trackedMouse();
    return tracked ? lineageOf(tracked) : 'grey';
  }

  function commitLineageSelection(lineage) {
    const mouse = chooseBestInLineage(lineage);
    if (!mouse) return;
    state.v133SelectedLineage = lineage;
    state.trackedMouseId = mouse.id;
    state.v13SelectedMouseId = mouse.id;
    state.freeCamera = false;
    if (state.paused) {
      state.view.cx = mouse.renderX + 0.5;
      state.view.cy = mouse.renderY + 0.5;
      clampView();
    }
  }

  function lineageTap(event) {
    const button = event.target.closest('[data-v131-lineage],[data-v13-lineage]');
    if (!button) return;
    const lineage = button.dataset.v131Lineage || button.dataset.v13Lineage;
    if (!lineage) return;
    // Earlier v1.3 layers perform the visible card/follow update. This extra layer
    // persists the lineage identity so Mouse View and Inspector always use the same species.
    setTimeout(() => {
      commitLineageSelection(lineage);
      updateStats();
    }, 0);
  }
  liveLineages?.addEventListener('click', lineageTap);
  pauseLineages?.addEventListener('click', lineageTap);

  function ensureLineageMouse() {
    if (state.mode !== 'sim' || !state.mice.length) return null;
    const lineage = selectedLineage();
    let mouse = state.mice.find(m => m.id === state.v13SelectedMouseId) || trackedMouse();
    if (!mouse || lineageOf(mouse) !== lineage || (!mouse.alive && !mouse.reachedGoal)) {
      mouse = chooseBestInLineage(lineage);
      if (mouse) {
        state.v13SelectedMouseId = mouse.id;
        state.trackedMouseId = mouse.id;
      }
    }
    return mouse;
  }

  // Individual mouse taps are no longer a selection mechanism. If the older layer
  // briefly selects one, restore the chosen lineage's best mouse immediately after.
  canvas.addEventListener('pointerup', () => {
    if (state.mode !== 'sim' || !state.paused) return;
    setTimeout(() => {
      commitLineageSelection(selectedLineage());
      updateStats();
    }, 0);
  });

  const FOV_RADIUS = 16;
  let fovCacheKey = '';
  let fovCache = new Set();

  function fovKey(x, y) {
    return y * GRID_W + x;
  }

  function lineVisible(x0, y0, x1, y1) {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (x !== x1 || y !== y1) {
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }

      // A wall is itself visible, but it occludes everything behind it.
      if (x === x1 && y === y1) return true;
      if (getCell(x, y) === CELL.WALL) return false;
    }
    return true;
  }

  function currentVisibleCells(mouse) {
    const cacheKey = `${state.v13MazeId || 1}:${mouse.id}:${mouse.x},${mouse.y}`;
    if (cacheKey === fovCacheKey) return fovCache;

    const visible = new Set();
    const r2 = FOV_RADIUS * FOV_RADIUS;
    const minX = Math.max(0, mouse.x - FOV_RADIUS);
    const maxX = Math.min(GRID_W - 1, mouse.x + FOV_RADIUS);
    const minY = Math.max(0, mouse.y - FOV_RADIUS);
    const maxY = Math.min(GRID_H - 1, mouse.y + FOV_RADIUS);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - mouse.x;
        const dy = y - mouse.y;
        if (dx * dx + dy * dy > r2) continue;
        if (lineVisible(mouse.x, mouse.y, x, y)) visible.add(fovKey(x, y));
      }
    }

    fovCacheKey = cacheKey;
    fovCache = visible;
    return visible;
  }

  function drawFogOfWar(mouse) {
    if (!mouseViewToggle?.checked || state.mode !== 'sim' || !mouse) return;
    const visible = currentVisibleCells(mouse);
    const rect = canvas.getBoundingClientRect();
    const scale = state.view.scale;

    // Fill the whole viewport, then punch transparent cell-sized holes through the
    // overlay for the cells currently visible to this mouse. This is deliberately
    // current sight, not remembered sight: moving away makes an area dark again.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rect.width, rect.height);
    for (const key of visible) {
      const x = key % GRID_W;
      const y = Math.floor(key / GRID_W);
      const p = worldToScreen(x, y);
      if (p.x + scale < 0 || p.y + scale < 0 || p.x > rect.width || p.y > rect.height) continue;
      ctx.rect(p.x - 0.35, p.y - 0.35, scale + 0.7, scale + 0.7);
    }
    ctx.fillStyle = 'rgba(5, 8, 13, 0.78)';
    ctx.fill('evenodd');
    ctx.restore();
  }

  function drawSelectedGlow(mouse) {
    if (!mouse || !state.paused) return;
    const p = worldToScreen(mouse.renderX + 0.5, mouse.renderY + 0.5);
    const radius = Math.max(12, state.view.scale * 0.72);
    ctx.save();
    ctx.strokeStyle = 'rgba(67,191,255,.82)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Suppress the old paused-only blue memory highlight while Mouse View is enabled;
  // the new mode is darkness outside current line-of-sight and remains active live.
  const previousRenderV133 = render;
  render = function () {
    const wasPaused = state.paused;
    const suppressLegacyMouseView = !!mouseViewToggle?.checked && wasPaused;
    if (suppressLegacyMouseView) state.paused = false;
    previousRenderV133();
    if (suppressLegacyMouseView) state.paused = wasPaused;

    const mouse = ensureLineageMouse();
    drawFogOfWar(mouse);
    if (suppressLegacyMouseView) drawSelectedGlow(mouse);
  };

  document.body.classList.add('v133Ready');
})();
