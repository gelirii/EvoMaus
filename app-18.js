// EvoMaus v1.3 experiment/UI pass: pause lab, lineage inspection, random mazes and transfer tests.
(() => {
  const V13_LINEAGES = ['white', 'grey', 'black'];
  const V13_SETTINGS_KEY = 'evomaus-v13-settings';
  const V13_PATH_CAP = 2400;
  const V13_MEMORY = { FLOOR: 1, WALL: 2, DANGER: 3, CHEESE: 4, GOAL: 5 };

  const v13Settings = {
    mouseView: false,
    generationSummary: false,
    championTrails: true
  };

  try {
    const saved = JSON.parse(localStorage.getItem(V13_SETTINGS_KEY) || 'null');
    if (saved && typeof saved === 'object') Object.assign(v13Settings, saved);
  } catch (_) {}

  function saveV13Settings() {
    try { localStorage.setItem(V13_SETTINGS_KEY, JSON.stringify(v13Settings)); } catch (_) {}
  }

  state.v13MazeId = state.v13MazeId || 1;
  state.v13SelectedMouseId = null;
  state.v13FirstSolveShownMaze = null;
  state.v13SummaryDismissedGeneration = null;
  state.v13Skip = null;
  state.v13LineageRecords = state.v13LineageRecords || {};

  function freshLineageRecords() {
    const result = {};
    for (const lineage of V13_LINEAGES) {
      result[lineage] = {
        bestProgress: 0,
        firstSolveGeneration: null,
        bestTime: null,
        maxCheese: 0,
        championTrail: null,
        championMouseId: null,
        championGeneration: null
      };
    }
    return result;
  }

  function ensureCurrentMazeRecords() {
    if (!state.v13CurrentMazeRecords) state.v13CurrentMazeRecords = freshLineageRecords();
    return state.v13CurrentMazeRecords;
  }
  ensureCurrentMazeRecords();

  function lineageColour(lineage, alpha = 1) {
    const colours = {
      white: `rgba(255,253,247,${alpha})`,
      grey: `rgba(170,177,189,${alpha})`,
      black: `rgba(61,68,80,${alpha})`
    };
    return colours[lineage] || colours.grey;
  }

  function mouseLineage(mouse) { return mouse?.lineage || 'grey'; }

  function v13InitMouse(mouse) {
    if (!mouse) return mouse;
    if (!Array.isArray(mouse.v13Trail)) mouse.v13Trail = [mouse.y * GRID_W + mouse.x];
    if (!Number.isFinite(mouse.v13TrailStride)) mouse.v13TrailStride = 1;
    return mouse;
  }

  const previousMakeMouseV13UI = makeMouse;
  makeMouse = function (genome, generation, parentIds = [], lineage = null) {
    return v13InitMouse(previousMakeMouseV13UI(genome, generation, parentIds, lineage));
  };

  function appendTrail(mouse, beforeX, beforeY) {
    if (!mouse || mouse.x === beforeX && mouse.y === beforeY) return;
    v13InitMouse(mouse);
    const key = mouse.y * GRID_W + mouse.x;
    if (mouse.v13Trail[mouse.v13Trail.length - 1] !== key) mouse.v13Trail.push(key);
    if (mouse.v13Trail.length > V13_PATH_CAP) {
      const compact = [];
      for (let i = 0; i < mouse.v13Trail.length; i += 2) compact.push(mouse.v13Trail[i]);
      mouse.v13Trail = compact;
      mouse.v13TrailStride *= 2;
    }
  }

  function updateLineageRecord(mouse) {
    if (!mouse) return;
    const records = ensureCurrentMazeRecords();
    const lineage = mouseLineage(mouse);
    const record = records[lineage];
    const progress = progressOf(mouse);
    record.maxCheese = Math.max(record.maxCheese, mouse.cheeseCount || 0);

    let improved = progress > record.bestProgress + 0.00001;
    if (mouse.reachedGoal) {
      improved = true;
      record.bestProgress = 1;
      if (record.firstSolveGeneration === null) record.firstSolveGeneration = mouse.generation || state.generation;
      if (record.bestTime === null || mouse.step < record.bestTime) record.bestTime = mouse.step;
    } else if (improved) {
      record.bestProgress = progress;
    }

    if (improved && mouse.v13Trail?.length) {
      record.championTrail = mouse.v13Trail.slice();
      record.championMouseId = mouse.id;
      record.championGeneration = mouse.generation || state.generation;
    }
  }

  function selectedMouse() {
    if (!state.v13SelectedMouseId) return null;
    return state.mice.find(mouse => mouse.id === state.v13SelectedMouseId) || null;
  }

  const pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'v13PauseOverlay';
  pauseOverlay.className = 'v13Overlay';
  pauseOverlay.innerHTML = `
    <section class="v13Sheet" role="dialog" aria-modal="true" aria-label="Pause menu">
      <div class="v13SheetHead">
        <div><strong>Paused</strong><span id="v13MazeLabel">Maze 1 · Gen 1</span></div>
        <button id="v13ResumeButton" class="primary">▶ Resume</button>
      </div>
      <div class="v13PauseLineages" id="v13PauseLineages"></div>
      <div class="v13Inspector" id="v13Inspector"><strong>Inspect a mouse</strong><span>Tap a mouse on the maze, or tap a lineage above.</span></div>
      <div class="v13ToggleGrid">
        <label><span>Mouse View</span><input id="v13MouseViewToggle" type="checkbox"></label>
        <label><span>Generation summaries</span><input id="v13SummaryToggle" type="checkbox"></label>
        <label><span>Champion trails</span><input id="v13TrailsToggle" type="checkbox"></label>
      </div>
      <button id="v13SkipButton" class="v13WideAction">⏩ Skip until improvement</button>
      <details class="v13Section" open>
        <summary>Maze</summary>
        <div class="v13ActionGrid">
          <button id="v13EditMazeButton">✎ Edit current maze</button>
          <button id="v13RandomMazeButton">🎲 Generate random maze</button>
        </div>
      </details>
      <details class="v13Section">
        <summary>Lineage records</summary>
        <div id="v13Records" class="v13Records"></div>
      </details>
      <button id="v13ResetButton" class="v13DangerWide">Reset everything…</button>
    </section>`;
  document.body.appendChild(pauseOverlay);

  const eventOverlay = document.createElement('div');
  eventOverlay.id = 'v13EventOverlay';
  eventOverlay.className = 'v13Overlay v13EventOverlay';
  eventOverlay.innerHTML = `
    <section class="v13EventCard" role="dialog" aria-modal="true">
      <div class="v13EventEyebrow" id="v13EventEyebrow">EvoMaus</div>
      <h2 id="v13EventTitle">Event</h2>
      <div id="v13EventBody"></div>
      <button id="v13EventContinue" class="primary">Continue</button>
    </section>`;
  document.body.appendChild(eventOverlay);

  const skipBadge = document.createElement('button');
  skipBadge.id = 'v13SkipBadge';
  skipBadge.type = 'button';
  skipBadge.textContent = '⏩ Skipping until improvement…';
  document.body.appendChild(skipBadge);

  const liveLineages = document.createElement('div');
  liveLineages.id = 'v13LiveLineages';
  liveLineages.className = 'v13LiveLineages';
  document.querySelector('.simControls')?.insertAdjacentElement('afterend', liveLineages);

  const randomEditorButton = document.createElement('button');
  randomEditorButton.id = 'v13RandomEditorButton';
  randomEditorButton.className = 'floatButton';
  randomEditorButton.title = 'Generate random maze';
  randomEditorButton.textContent = '🎲';
  document.querySelector('.floating')?.prepend(randomEditorButton);

  const pauseEls = {
    resume: document.getElementById('v13ResumeButton'), mazeLabel: document.getElementById('v13MazeLabel'),
    lineages: document.getElementById('v13PauseLineages'), inspector: document.getElementById('v13Inspector'),
    mouseView: document.getElementById('v13MouseViewToggle'), summary: document.getElementById('v13SummaryToggle'),
    trails: document.getElementById('v13TrailsToggle'), skip: document.getElementById('v13SkipButton'),
    editMaze: document.getElementById('v13EditMazeButton'), randomMaze: document.getElementById('v13RandomMazeButton'),
    records: document.getElementById('v13Records'), reset: document.getElementById('v13ResetButton')
  };

  pauseEls.mouseView.checked = !!v13Settings.mouseView;
  pauseEls.summary.checked = !!v13Settings.generationSummary;
  pauseEls.trails.checked = !!v13Settings.championTrails;

  function showOverlay(el) { el.classList.add('show'); }
  function hideOverlay(el) { el.classList.remove('show'); }

  function lineageStats(lineage) {
    const group = state.mice.filter(mouse => mouseLineage(mouse) === lineage);
    const alive = group.filter(mouse => mouse.alive);
    let best = null;
    for (const mouse of group) if (!best || computeFitness(mouse) > computeFitness(best)) best = mouse;
    return { group, alive, best, record: ensureCurrentMazeRecords()[lineage] };
  }

  function lineageCardHtml(lineage, compact = false) {
    const { group, alive, record } = lineageStats(lineage);
    const progress = Math.max(record.bestProgress || 0, group.length ? Math.max(...group.map(progressOf)) : 0);
    const cheese = Math.max(record.maxCheese || 0, group.length ? Math.max(...group.map(m => m.cheeseCount || 0)) : 0);
    const solved = record.firstSolveGeneration !== null;
    return `<button class="v13LineageCard lineage-${lineage}" data-v13-lineage="${lineage}">
      <span class="v13LineageName"><i></i>${lineage.toUpperCase()}</span><strong>${solved ? '✓ ' : ''}${Math.round(progress * 100)}%</strong>
      <small>🧀 ${cheese}${compact ? '' : ` · ${alive.length}/${group.length} alive`}</small></button>`;
  }

  function renderLineageBars() {
    liveLineages.innerHTML = V13_LINEAGES.map(lineage => lineageCardHtml(lineage, true)).join('');
    pauseEls.lineages.innerHTML = V13_LINEAGES.map(lineage => lineageCardHtml(lineage, false)).join('');
  }

  function inferredBehaviour(mouse) {
    if (!mouse) return '—';
    const hunger = Number.isFinite(mouse.energy) && Number.isFinite(mouse.maxEnergy) ? 1 - mouse.energy / Math.max(1, mouse.maxEnergy) : 0;
    const nav = mouse.cognitiveMap?.nav;
    const stale = mouse.balanceStale ?? mouse.staleSteps ?? 0;
    if (hunger > 0.86) return nav?.cheese ? 'Starving · food route known' : 'Starving · searching';
    if (nav?.goal) return hunger > 0.65 ? 'Goal known · hungry' : 'Goal seeking';
    if (nav?.cheese && hunger > 0.52) return 'Seeking remembered cheese';
    if (nav?.frontier) return 'Exploring frontier';
    if (stale > stagnationLimit() * 0.55) return 'Restless / backtracking';
    return 'Roaming';
  }

  function targetText(mouse) {
    const nav = mouse?.cognitiveMap?.nav;
    if (!nav) return 'No routed target';
    if (nav.goal) return `Goal · ${nav.goal.distance} cells`;
    if (nav.frontier) return `Frontier · ${nav.frontier.distance} cells`;
    if (nav.cheese) return `Cheese · ${nav.cheese.distance} cells`;
    return 'No routed target';
  }

  function updateInspector() {
    const mouse = selectedMouse();
    if (!mouse) {
      pauseEls.inspector.innerHTML = '<strong>Inspect a mouse</strong><span>Tap a mouse on the maze, or tap a lineage above.</span>';
      return;
    }
    const energy = Number.isFinite(mouse.energy) && Number.isFinite(mouse.maxEnergy) ? Math.round(mouse.energy / Math.max(1, mouse.maxEnergy) * 100) : null;
    pauseEls.inspector.innerHTML = `<div class="v13InspectorTitle"><strong>${mouseLineage(mouse).toUpperCase()} #${mouse.id}</strong><span>${mouse.alive ? 'Alive' : mouse.reachedGoal ? 'Solved' : mouse.deathReason || 'Dead'}</span></div>
      <div class="v13InspectorGrid"><span>Energy <b>${energy === null ? '—' : energy + '%'}</b></span><span>Step <b>${mouse.step || 0}</b></span><span>Cheese <b>${mouse.cheeseCount || 0}</b></span><span>Progress <b>${Math.round(progressOf(mouse) * 100)}%</b></span></div>
      <div class="v13Thought"><b>${inferredBehaviour(mouse)}</b><span>${targetText(mouse)}</span></div>`;
  }

  function renderRecords() {
    const records = ensureCurrentMazeRecords();
    pauseEls.records.innerHTML = V13_LINEAGES.map(lineage => {
      const r = records[lineage];
      return `<div class="v13RecordRow"><span>${lineage.toUpperCase()}</span><b>${Math.round(r.bestProgress * 100)}%</b><small>${r.firstSolveGeneration === null ? 'No solve yet' : `First solve G${r.firstSolveGeneration}${r.bestTime ? ` · best ${r.bestTime} steps` : ''}`}</small></div>`;
    }).join('');
  }

  function updatePauseMenu() {
    pauseEls.mazeLabel.textContent = `Maze ${state.v13MazeId} · Gen ${state.generation}`;
    renderLineageBars(); updateInspector(); renderRecords();
  }

  function openPauseMenu() {
    if (state.mode !== 'sim') return;
    state.paused = true; pauseButton.textContent = '▶ Resume';
    document.body.classList.add('paused', 'v13PauseOpen'); updatePauseMenu(); showOverlay(pauseOverlay);
  }

  function resumeFromPauseMenu() {
    hideOverlay(pauseOverlay); document.body.classList.remove('v13PauseOpen');
    state.paused = false; pauseButton.textContent = '⏸ Pause'; document.body.classList.remove('paused'); state.freeCamera = false;
  }

  pauseButton.addEventListener('click', (event) => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (state.mode !== 'sim') return;
    if (pauseOverlay.classList.contains('show')) resumeFromPauseMenu(); else openPauseMenu();
  }, true);
  pauseEls.resume.addEventListener('click', resumeFromPauseMenu);

  function chooseBestInLineage(lineage) {
    const alive = state.mice.filter(mouse => mouse.alive && mouseLineage(mouse) === lineage);
    const pool = alive.length ? alive : state.mice.filter(mouse => mouseLineage(mouse) === lineage);
    return pool.length ? [...pool].sort((a, b) => computeFitness(b) - computeFitness(a))[0] : null;
  }

  function selectMouse(mouse, centre = true) {
    if (!mouse || !state.paused) return;
    state.v13SelectedMouseId = mouse.id; state.trackedMouseId = mouse.id;
    if (centre) { state.view.cx = mouse.renderX + 0.5; state.view.cy = mouse.renderY + 0.5; clampView(); }
    updatePauseMenu();
  }

  function lineageClick(event) {
    if (!state.paused || state.mode !== 'sim') return;
    const card = event.target.closest('[data-v13-lineage]');
    if (card) selectMouse(chooseBestInLineage(card.dataset.v13Lineage));
  }
  pauseEls.lineages.addEventListener('click', lineageClick); liveLineages.addEventListener('click', lineageClick);

  let tapStart = null;
  canvas.addEventListener('pointerdown', event => {
    if (state.mode === 'sim' && state.paused && pauseOverlay.classList.contains('show')) tapStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', event => {
    if (!tapStart || tapStart.id !== event.pointerId || state.mode !== 'sim' || !state.paused) return;
    const moved = Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y); tapStart = null; if (moved > 12) return;
    const rect = canvas.getBoundingClientRect(); const px = event.clientX - rect.left, py = event.clientY - rect.top;
    let best = null, bestDist = 28;
    for (const mouse of state.mice) {
      if (!mouse.alive && !mouse.reachedGoal) continue;
      const p = worldToScreen(mouse.renderX + 0.5, mouse.renderY + 0.5); const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestDist) { best = mouse; bestDist = d; }
    }
    if (best) selectMouse(best, false);
  });

  for (const [el, settingKey] of [[pauseEls.mouseView, 'mouseView'], [pauseEls.summary, 'generationSummary'], [pauseEls.trails, 'championTrails']]) {
    el.addEventListener('change', () => { v13Settings[settingKey] = !!el.checked; saveV13Settings(); });
  }

  let eventContinueAction = null;
  function showEvent({ eyebrow, title, body, button = 'Continue', onContinue = null }) {
    document.getElementById('v13EventEyebrow').textContent = eyebrow || 'EvoMaus v1.3';
    document.getElementById('v13EventTitle').textContent = title;
    document.getElementById('v13EventBody').innerHTML = body;
    document.getElementById('v13EventContinue').textContent = button;
    eventContinueAction = onContinue; state.paused = true; showOverlay(eventOverlay);
  }

  document.getElementById('v13EventContinue').addEventListener('click', () => {
    hideOverlay(eventOverlay); const action = eventContinueAction; eventContinueAction = null;
    if (action) action(); else state.paused = false;
  });

  function generationSummaryHtml() {
    const counts = {};
    for (const mouse of state.mice) { const reason = mouse.reachedGoal ? 'goal' : mouse.deathReason || 'other'; counts[reason] = (counts[reason] || 0) + 1; }
    const lines = V13_LINEAGES.map(lineage => { const r = ensureCurrentMazeRecords()[lineage]; return `<div class="v13SummaryLine"><b>${lineage.toUpperCase()}</b><span>${Math.round(r.bestProgress * 100)}% · 🧀 ${r.maxCheese}${r.firstSolveGeneration !== null ? ' · SOLVED' : ''}</span></div>`; }).join('');
    const deaths = Object.entries(counts).filter(([key]) => key !== 'goal').map(([key, value]) => `${key} ${value}`).join(' · ');
    return `${lines}<p class="v13SummaryDeaths">${deaths || 'No deaths recorded'}</p>`;
  }

  const previousBeginNextGenerationV13 = beginNextGeneration;
  beginNextGeneration = function () {
    if (v13Settings.generationSummary && state.v13SummaryDismissedGeneration !== state.generation) {
      const gen = state.generation;
      showEvent({ eyebrow: `Maze ${state.v13MazeId}`, title: `Generation ${gen} complete`, body: generationSummaryHtml(), button: 'Next generation',
        onContinue: () => { state.v13SummaryDismissedGeneration = gen; state.paused = false; previousBeginNextGenerationV13(); } });
      return;
    }
    previousBeginNextGenerationV13();
  };

  function startSkip() {
    const records = ensureCurrentMazeRecords();
    state.v13Skip = { progress: state.allTimeBestProgress || 0, bestTime: state.bestTime,
      lineageSolved: Object.fromEntries(V13_LINEAGES.map(l => [l, records[l].firstSolveGeneration !== null])), previousSpeedIndex: state.speedIndex };
    hideOverlay(pauseOverlay); document.body.classList.remove('v13PauseOpen', 'paused'); state.paused = false;
    state.speedIndex = state.speeds.length - 1; speedButton.textContent = `${state.speeds[state.speedIndex]}× Speed`; skipBadge.classList.add('show');
  }

  function skipImproved() {
    const skip = state.v13Skip; if (!skip) return false; const records = ensureCurrentMazeRecords();
    if (skip.bestTime === null && state.bestTime !== null) return true;
    if (state.bestTime !== null && skip.bestTime !== null && state.bestTime < skip.bestTime) return true;
    if ((state.allTimeBestProgress || 0) > skip.progress + 0.0005) return true;
    for (const lineage of V13_LINEAGES) if (!skip.lineageSolved[lineage] && records[lineage].firstSolveGeneration !== null) return true;
    return false;
  }

  function stopSkip(openMenu = true) {
    const skip = state.v13Skip; if (!skip) return; state.v13Skip = null; skipBadge.classList.remove('show');
    state.speedIndex = skip.previousSpeedIndex; speedButton.textContent = `${state.speeds[state.speedIndex]}× Speed`;
    if (openMenu) { state.paused = true; showToast('Improvement found.'); openPauseMenu(); }
  }
  pauseEls.skip.addEventListener('click', startSkip); skipBadge.addEventListener('click', () => stopSkip(true));

  const previousSimulationTickV13 = simulationTick;
  simulationTick = function () {
    previousSimulationTickV13();
    if (state.v13Skip && !state.paused) { previousSimulationTickV13(); if (skipImproved()) stopSkip(true); }
  };

  let mazeChangedOnResume = false;
  startButton.addEventListener('click', () => {
    if (state.mode === 'edit' && state.suspendedRun) mazeChangedOnResume = state.suspendedRun.mazeSignature !== currentMazeSignature();
  }, true);

  const previousEnterSimulationUiV13 = enterSimulationUi;
  enterSimulationUi = function () {
    previousEnterSimulationUiV13();
    if (mazeChangedOnResume) { state.v13MazeId++; state.v13CurrentMazeRecords = freshLineageRecords(); state.v13FirstSolveShownMaze = null; mazeChangedOnResume = false; }
  };

  pauseEls.editMaze.addEventListener('click', () => { hideOverlay(pauseOverlay); document.body.classList.remove('v13PauseOpen'); editButton.click(); });

  function randomOdd(min, max) { let value = min + Math.floor(Math.random() * (max - min + 1)); if (value % 2 === 0) value += value < max ? 1 : -1; return value; }

  function generateRandomMaze() {
    const width = randomOdd(27, 41), height = randomOdd(27, 41);
    const ox = Math.max(2, Math.min(GRID_W - width - 2, Math.round(state.start.x - width / 2)));
    const oy = Math.max(2, Math.min(GRID_H - height - 2, Math.round(state.start.y - height / 2)));
    const walls = new Set(), key = (x, y) => `${x},${y}`;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) walls.add(key(x, y));
    const startLocal = { x: 1, y: 1 }, stack = [startLocal], visited = new Set([key(1, 1)]), dirs = [[0,-2],[2,0],[0,2],[-2,0]];
    walls.delete(key(1, 1));
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const options = dirs.map(([dx, dy]) => ({ x: cur.x + dx, y: cur.y + dy, dx, dy })).filter(n => n.x > 0 && n.y > 0 && n.x < width - 1 && n.y < height - 1 && !visited.has(key(n.x, n.y)));
      if (!options.length) { stack.pop(); continue; }
      const next = options[Math.floor(Math.random() * options.length)]; visited.add(key(next.x, next.y));
      walls.delete(key(cur.x + next.dx / 2, cur.y + next.dy / 2)); walls.delete(key(next.x, next.y)); stack.push({ x: next.x, y: next.y });
    }
    const interiorWalls = [...walls].filter(k => { const [x, y] = k.split(',').map(Number); return x > 1 && y > 1 && x < width - 2 && y < height - 2; });
    for (const k of interiorWalls) {
      if (Math.random() > 0.115) continue; const [x, y] = k.split(',').map(Number);
      const horizontal = !walls.has(key(x - 1, y)) && !walls.has(key(x + 1, y)); const vertical = !walls.has(key(x, y - 1)) && !walls.has(key(x, y + 1));
      if (horizontal || vertical) walls.delete(k);
    }
    for (let room = 0; room < 2 + Math.floor(Math.random() * 3); room++) {
      const rx = 2 + Math.floor(Math.random() * Math.max(1, width - 7)), ry = 2 + Math.floor(Math.random() * Math.max(1, height - 7));
      for (let y = ry; y < Math.min(height - 1, ry + 3); y++) for (let x = rx; x < Math.min(width - 1, rx + 3); x++) walls.delete(key(x, y));
    }
    state.cells.clear(); state.goal = null;
    for (const k of walls) { const [x, y] = k.split(',').map(Number); state.cells.set(cellKey(ox + x, oy + y), CELL.WALL); }
    state.start = { x: ox + startLocal.x, y: oy + startLocal.y };

    const queue = [[startLocal.x, startLocal.y]], dist = new Map([[key(startLocal.x, startLocal.y), 0]]); let far = startLocal;
    for (let head = 0; head < queue.length; head++) {
      const [x, y] = queue[head], d = dist.get(key(x, y)); if (d > dist.get(key(far.x, far.y))) far = { x, y };
      for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) { const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || walls.has(key(nx, ny)) || dist.has(key(nx, ny))) continue;
        dist.set(key(nx, ny), d + 1); queue.push([nx, ny]); }
    }
    state.goal = { x: ox + far.x, y: oy + far.y };

    const path = new Set(); let px = far.x, py = far.y; path.add(key(px, py));
    while (px !== startLocal.x || py !== startLocal.y) {
      const current = dist.get(key(px, py));
      const prev = [[0,-1],[1,0],[0,1],[-1,0]].map(([dx, dy]) => ({ x: px + dx, y: py + dy })).find(p => dist.get(key(p.x, p.y)) === current - 1);
      if (!prev) break; px = prev.x; py = prev.y; path.add(key(px, py));
    }

    const floorCells = [...dist.keys()].map(k => k.split(',').map(Number));
    const deadEnds = floorCells.filter(([x, y]) => {
      if (path.has(key(x, y))) return false; let exits = 0;
      for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) if (!walls.has(key(x + dx, y + dy)) && dist.has(key(x + dx, y + dy))) exits++;
      return exits <= 1;
    });

    const cheeseTarget = 8 + Math.floor(Math.random() * 9), shuffled = [...deadEnds, ...floorCells.sort(() => Math.random() - 0.5)]; let cheeses = 0;
    for (const [x, y] of shuffled) { if (cheeses >= cheeseTarget) break; if ((x === startLocal.x && y === startLocal.y) || (x === far.x && y === far.y)) continue;
      const worldKey = cellKey(ox + x, oy + y); if (state.cells.has(worldKey)) continue; state.cells.set(worldKey, CELL.CHEESE); cheeses++; }

    const dangerTarget = 2 + Math.floor(Math.random() * 6); let dangers = 0;
    for (const [x, y] of floorCells.sort(() => Math.random() - 0.5)) { if (dangers >= dangerTarget) break; if (path.has(key(x, y)) || (x === startLocal.x && y === startLocal.y) || (x === far.x && y === far.y)) continue;
      const worldKey = cellKey(ox + x, oy + y); if (state.cells.has(worldKey)) continue; state.cells.set(worldKey, CELL.DANGER); dangers++; }

    state.view.cx = state.start.x + 0.5; state.view.cy = state.start.y + 0.5; state.view.scale = Math.min(state.view.scale, 22); saveMaze();
    showToast(`Random maze: ${width}×${height}, ${cheeses} cheese, ${dangers} dangers.`);
  }

  function generateFromPause() { hideOverlay(pauseOverlay); document.body.classList.remove('v13PauseOpen'); editButton.click(); setTimeout(generateRandomMaze, 0); }
  pauseEls.randomMaze.addEventListener('click', generateFromPause); randomEditorButton.addEventListener('click', generateRandomMaze);

  function resetV13Records() { state.v13MazeId = 1; state.v13CurrentMazeRecords = freshLineageRecords(); state.v13FirstSolveShownMaze = null; state.v13SelectedMouseId = null; }
  function confirmFullReset() { return confirm('Reset EVERYTHING?\n\nThis will erase the maze, all evolved brains, generations, lineage records and current progress. This cannot be undone.'); }

  for (const button of [resetEvolutionButton, stopEditButton]) {
    button.addEventListener('click', event => {
      if (state.v13ResetApproved) { state.v13ResetApproved = false; return; }
      if (!confirmFullReset()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      state.cells.clear(); state.goal = null; saveMaze(); resetV13Records();
    }, true);
  }

  pauseEls.reset.addEventListener('click', () => {
    if (!confirmFullReset()) return; hideOverlay(pauseOverlay); state.cells.clear(); state.goal = null; saveMaze(); resetV13Records();
    state.v13ResetApproved = true; resetEvolutionButton.click();
  });

  function drawChampionTrails() {
    if (!v13Settings.championTrails || state.mode !== 'sim') return;
    const records = ensureCurrentMazeRecords(), rect = canvas.getBoundingClientRect();
    for (const lineage of V13_LINEAGES) {
      const trail = records[lineage].championTrail; if (!trail || trail.length < 2) continue;
      ctx.save(); ctx.strokeStyle = lineageColour(lineage, lineage === 'white' ? 0.34 : 0.28); ctx.lineWidth = Math.max(1.5, state.view.scale * 0.08); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false;
      for (const trailKey of trail) { const x = trailKey % GRID_W, y = Math.floor(trailKey / GRID_W), p = worldToScreen(x + 0.5, y + 0.5);
        if (p.x < -40 || p.y < -40 || p.x > rect.width + 40 || p.y > rect.height + 40) continue;
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); }
      if (started) ctx.stroke(); ctx.restore();
    }
  }

  function drawMouseView(mouse) {
    if (!v13Settings.mouseView || !mouse?.cognitiveMap || !state.paused) return;
    const rect = canvas.getBoundingClientRect(), scale = state.view.scale; ctx.save();
    for (const [memoryKey, code] of mouse.cognitiveMap.cells) {
      const x = memoryKey % GRID_W, y = Math.floor(memoryKey / GRID_W), p = worldToScreen(x, y);
      if (p.x + scale < 0 || p.y + scale < 0 || p.x > rect.width || p.y > rect.height) continue;
      if (code === V13_MEMORY.WALL) ctx.fillStyle = 'rgba(92,185,255,.16)'; else if (code === V13_MEMORY.DANGER) ctx.fillStyle = 'rgba(255,85,91,.22)';
      else if (code === V13_MEMORY.CHEESE) ctx.fillStyle = 'rgba(255,216,74,.20)'; else if (code === V13_MEMORY.GOAL) ctx.fillStyle = 'rgba(79,200,120,.26)'; else ctx.fillStyle = 'rgba(92,185,255,.075)';
      ctx.fillRect(p.x, p.y, scale, scale);
    }
    ctx.strokeStyle = 'rgba(80,210,255,.72)'; ctx.lineWidth = Math.max(1, scale * 0.06);
    for (const frontierKey of mouse.cognitiveMap.frontiers || []) { const x = frontierKey % GRID_W, y = Math.floor(frontierKey / GRID_W), p = worldToScreen(x, y);
      if (p.x + scale < 0 || p.y + scale < 0 || p.x > rect.width || p.y > rect.height) continue; ctx.strokeRect(p.x + 2, p.y + 2, Math.max(1, scale - 4), Math.max(1, scale - 4)); }
    const nav = mouse.cognitiveMap.nav, target = nav?.goal || nav?.frontier || nav?.cheese;
    if (target && target.firstDir >= 0) { const d = DIRS[target.firstDir], p = worldToScreen(mouse.renderX + 0.5, mouse.renderY + 0.5);
      ctx.strokeStyle = 'rgba(80,210,255,.92)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + d.x * Math.max(16, scale * 0.8), p.y + d.y * Math.max(16, scale * 0.8)); ctx.stroke(); }
    ctx.restore();
  }

  function drawSelectionGlow(mouse) {
    if (!mouse || !state.paused) return; const p = worldToScreen(mouse.renderX + 0.5, mouse.renderY + 0.5), radius = Math.max(12, state.view.scale * 0.72); ctx.save();
    const gradient = ctx.createRadialGradient(p.x, p.y, radius * 0.25, p.x, p.y, radius); gradient.addColorStop(0, 'rgba(67,191,255,.18)'); gradient.addColorStop(0.65, 'rgba(67,191,255,.12)'); gradient.addColorStop(1, 'rgba(67,191,255,0)');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(67,191,255,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, radius * 0.72, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  const previousRenderV13 = render; let v13RenderCounter = 0;
  render = function () { v13RenderCounter++; if (state.v13Skip && v13RenderCounter % 6 !== 0) return; previousRenderV13(); drawChampionTrails(); const mouse = selectedMouse(); drawMouseView(mouse); drawSelectionGlow(mouse); };

  const previousTickMouseV13UI = tickMouse;
  tickMouse = function (mouse) {
    if (!mouse.alive) return previousTickMouseV13UI(mouse);
    v13InitMouse(mouse); const beforeX = mouse.x, beforeY = mouse.y, hadAnySolve = state.bestTime !== null;
    previousTickMouseV13UI(mouse); appendTrail(mouse, beforeX, beforeY); updateLineageRecord(mouse);
    if (!hadAnySolve && state.bestTime !== null && state.v13FirstSolveShownMaze !== state.v13MazeId) {
      state.v13FirstSolveShownMaze = state.v13MazeId; const lineage = mouseLineage(mouse);
      showEvent({ eyebrow: `Maze ${state.v13MazeId} · Generation ${state.generation}`, title: `${lineage[0].toUpperCase() + lineage.slice(1)} found the goal!`,
        body: `<p>The first solve of this maze: <b>${mouse.step} steps</b> with <b>${mouse.cheeseCount || 0} cheese</b>.</p><p>Evolution is paused so you don't miss it.</p>`, button: 'Continue evolution', onContinue: () => { state.paused = false; } });
    }
  };

  const previousUpdateStatsV13 = updateStats;
  updateStats = function () { previousUpdateStatsV13(); renderLineageBars(); if (pauseOverlay.classList.contains('show')) { updateInspector(); renderRecords(); } };

  document.body.classList.add('v13Ready'); renderLineageBars();
})();
