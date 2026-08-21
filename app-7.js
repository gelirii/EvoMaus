  // EvoMaus v1.1 sensory/camera pass: wider vision, exact three-way populations,
  // brighter lineages, free paused camera, and lineage stats while editing a live generation.
  (() => {
    const V12_LINEAGES = ['grey', 'white', 'black'];
    const V12_DISPLAY_ORDER = ['white', 'grey', 'black'];
    const V12_VISION_RAYS = 32;
    const V12_SIGHT_DISTANCE = 16;
    const V12_HIDDEN = 10;
    const V12_OUTPUTS = 4;
    const V12_MIN_POPULATION = 15;
    const V12_MAX_POPULATION = 375;

    const V12_VISION_DIRS = Array.from({ length: V12_VISION_RAYS }, (_, index) => {
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / V12_VISION_RAYS);
      return { x: Math.cos(angle), y: Math.sin(angle) };
    });

    // 32 rays × 4 channels (wall, danger, cheese, goal), plus loose goal bearing,
    // flood-fill progress, previous direction, last wall hit, 4-cell recency and restlessness.
    const V12_INPUTS = V12_VISION_RAYS * 4 + 2 + 1 + 4 + 1 + 4 + 1;
    const V12_WEIGHTS = (V12_INPUTS + 1) * V12_HIDDEN + (V12_HIDDEN + 1) * V12_OUTPUTS;

    function v12RandomGenome() {
      const genome = new Float32Array(V12_WEIGHTS);
      for (let i = 0; i < genome.length; i++) genome[i] = (Math.random() * 2 - 1) * 0.72;
      return genome;
    }

    function v12BreedGenome(a, b, mutationRate) {
      const child = new Float32Array(V12_WEIGHTS);
      let mutationCount = 0;
      for (let i = 0; i < child.length; i++) {
        const av = a.genome[i] ?? 0;
        const bv = b.genome[i] ?? 0;
        let gene = Math.random() < 0.5 ? av : bv;
        if (Math.random() < mutationRate) {
          mutationCount++;
          if (Math.random() < 0.035) gene = (Math.random() * 2 - 1) * 1.2;
          else gene += (Math.random() + Math.random() - 1) * 0.5;
        }
        child[i] = Math.max(-4, Math.min(4, gene));
      }
      return { genome: child, mutationCount };
    }

    function v12Closeness(distance) {
      return Math.max(0, (V12_SIGHT_DISTANCE + 1 - distance) / V12_SIGHT_DISTANCE);
    }

    function v12SenseRay(mouse, direction) {
      let wall = 0;
      let danger = 0;
      let cheese = 0;
      let goal = 0;
      let lastKey = '';

      for (let step = 1; step <= V12_SIGHT_DISTANCE; step++) {
        const x = Math.round(mouse.x + direction.x * step);
        const y = Math.round(mouse.y + direction.y * step);
        const key = `${x},${y}`;
        if (key === lastKey) continue;
        lastKey = key;

        if (!inBounds(x, y)) {
          wall = v12Closeness(step);
          break;
        }

        const type = getCell(x, y);
        if (type === CELL.WALL) {
          wall = v12Closeness(step);
          break;
        }

        const closeness = v12Closeness(step);
        if (!danger && type === CELL.DANGER) danger = closeness;
        if (!cheese && type === CELL.CHEESE) cheese = closeness;
        if (!goal && state.goal && x === state.goal.x && y === state.goal.y) goal = closeness;
      }
      return [wall, danger, cheese, goal];
    }

    function v12BrainInputs(mouse) {
      const inputs = [];
      for (const direction of V12_VISION_DIRS) inputs.push(...v12SenseRay(mouse, direction));

      const dx = state.goal.x - mouse.x;
      const dy = state.goal.y - mouse.y;
      const bearingScale = Math.max(1, Math.abs(dx), Math.abs(dy));
      inputs.push(dx / bearingScale, dy / bearingScale);
      inputs.push(currentProgressOf(mouse));

      for (let d = 0; d < 4; d++) inputs.push(mouse.lastDir === d ? 1 : 0);
      inputs.push(mouse.lastWallHit ? 1 : 0);

      for (const d of DIRS) inputs.push(recentnessOf(mouse, mouse.x + d.x, mouse.y + d.y));
      inputs.push(Math.min(1, mouse.staleSteps / stagnationLimit()));
      return inputs;
    }

    function v12DecideMove(mouse) {
      const inputs = v12BrainInputs(mouse);
      const hidden = new Float32Array(V12_HIDDEN);
      const outputs = new Float32Array(V12_OUTPUTS);
      const genome = mouse.genome;
      let wi = 0;

      for (let h = 0; h < V12_HIDDEN; h++) {
        let sum = 0;
        for (let i = 0; i < V12_INPUTS; i++) sum += inputs[i] * (genome[wi++] ?? 0);
        sum += genome[wi++] ?? 0;
        hidden[h] = Math.tanh(sum);
      }

      for (let o = 0; o < V12_OUTPUTS; o++) {
        let sum = 0;
        for (let h = 0; h < V12_HIDDEN; h++) sum += hidden[h] * (genome[wi++] ?? 0);
        outputs[o] = sum + (genome[wi++] ?? 0);
      }

      let bestDir = 0;
      for (let o = 1; o < V12_OUTPUTS; o++) {
        if (outputs[o] > outputs[bestDir]) bestDir = o;
      }

      // Preserve the existing anti-vibration safeguards after the richer brain has voted.
      if (mouse.reverseStreak > 0 && isImmediateReverse(mouse, bestDir) && !isValuableImmediateTarget(mouse, bestDir)) {
        const alternative = bestSafeAlternative(mouse, outputs, bestDir, false);
        if (alternative >= 0) bestDir = alternative;
      }

      const shortRetrace = wouldCompleteShortRetrace(mouse, bestDir);
      const axisOscillation = wouldContinueAxisOscillation(mouse, bestDir);
      if ((shortRetrace || axisOscillation) && !isValuableImmediateTarget(mouse, bestDir)) {
        let alternative = -1;
        if (axisOscillation) alternative = bestSafeAlternative(mouse, outputs, bestDir, true);
        if (alternative < 0) alternative = bestSafeAlternative(mouse, outputs, bestDir, false);
        if (alternative >= 0) bestDir = alternative;
      }
      return bestDir;
    }

    randomGenome = v12RandomGenome;
    breedGenome = v12BreedGenome;
    brainInputs = v12BrainInputs;
    decideMove = v12DecideMove;

    function normalisePopulation(value) {
      const numeric = Number.isFinite(Number(value)) ? Number(value) : 81;
      const snapped = Math.round(numeric / 3) * 3;
      return Math.max(V12_MIN_POPULATION, Math.min(V12_MAX_POPULATION, snapped));
    }

    populationInput.min = String(V12_MIN_POPULATION);
    populationInput.max = String(V12_MAX_POPULATION);
    populationInput.step = '3';

    // app-1's older loader capped values at 250. Recover the persisted value directly
    // so v1.1 can genuinely remember populations all the way up to 375.
    let persistedPopulation = state.populationSize;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (Number.isFinite(saved?.populationSize)) persistedPopulation = saved.populationSize;
    } catch (_) {}
    state.populationSize = normalisePopulation(persistedPopulation);
    populationInput.value = String(state.populationSize);
    populationValue.textContent = String(state.populationSize);

    populationInput.addEventListener('input', () => {
      const snapped = normalisePopulation(populationInput.value);
      if (Number(populationInput.value) !== snapped) populationInput.value = String(snapped);
      state.populationSize = snapped;
      populationValue.textContent = String(snapped);
    });

    const statPanel = document.createElement('div');
    statPanel.className = 'lineageEditStats';
    statPanel.setAttribute('aria-label', 'Lineage statistics for this generation');
    statPanel.innerHTML = V12_DISPLAY_ORDER.map(lineage => `
      <div class="lineageEditStat lineage-${lineage}" data-lineage="${lineage}">
        <span class="lineageName"><i></i>${lineage[0].toUpperCase() + lineage.slice(1)}</span>
        <strong class="lineageProgress">0%</strong>
        <span class="lineageCheese">🧀 0</span>
      </div>
    `).join('');
    populationInput.closest('.populationBox')?.insertAdjacentElement('afterend', statPanel);

    function lineageSnapshot(mice) {
      const snapshot = {};
      for (const lineage of V12_LINEAGES) {
        const group = mice.filter(mouse => (mouse.lineage || 'grey') === lineage);
        snapshot[lineage] = {
          progress: group.length ? Math.max(...group.map(mouse => progressOf(mouse))) : 0,
          cheese: group.length ? Math.max(...group.map(mouse => mouse.cheeseCount || 0)) : 0
        };
      }
      return snapshot;
    }

    function renderLineageEditStats(snapshot = state.lineageEditSnapshot) {
      if (!snapshot) return;
      for (const lineage of V12_DISPLAY_ORDER) {
        const row = statPanel.querySelector(`[data-lineage="${lineage}"]`);
        if (!row) continue;
        const data = snapshot[lineage] || { progress: 0, cheese: 0 };
        row.querySelector('.lineageProgress').textContent = `${Math.round(data.progress * 100)}%`;
        row.querySelector('.lineageCheese').textContent = `🧀 ${data.cheese}`;
      }
    }

    editButton.addEventListener('click', () => {
      if (state.mode !== 'sim') return;
      state.lineageEditSnapshot = lineageSnapshot(state.mice);
      renderLineageEditStats();
    }, true);

    resetEvolutionButton.addEventListener('click', () => { state.lineageEditSnapshot = null; });
    stopEditButton.addEventListener('click', () => { state.lineageEditSnapshot = null; });

    const V12_MOUSE_STYLES = {
      grey: { body: '#aab1bd', ears: '#c5cad2', eyes: '#252a32', nose: '#f0a0aa', outline: '#747d8a' },
      white: { body: '#fffdf7', ears: '#f0ebe2', eyes: '#20242a', nose: '#ef9aa7', outline: '#aaa79f' },
      black: { body: '#3d4450', ears: '#697382', eyes: '#fffdf6', nose: '#f09aa7', outline: '#171b21' }
    };

    function drawV12LineageMouse(wx, wy, scale, alpha, tracked, lineage) {
      const style = V12_MOUSE_STYLES[lineage] || V12_MOUSE_STYLES.grey;
      const p = worldToScreen(wx, wy);
      const s = Math.max(6, scale * .58);
      const x = p.x + scale / 2 - s / 2;
      const y = p.y + scale / 2 - s / 2;
      const r = Math.max(2, s * .16);

      ctx.save();
      ctx.globalAlpha = alpha;
      if (tracked) {
        ctx.shadowColor = 'rgba(0,121,255,.58)';
        ctx.shadowBlur = Math.max(6, scale * .32);
      }

      ctx.fillStyle = style.body;
      ctx.strokeStyle = style.outline;
      ctx.lineWidth = Math.max(1, scale * .038);
      roundRect(ctx, x, y, s, s, r);
      ctx.fill();
      ctx.stroke();

      if (s > 8) {
        ctx.fillStyle = style.ears;
        ctx.beginPath();
        ctx.arc(x + s * .21, y + s * .12, s * .16, 0, Math.PI * 2);
        ctx.arc(x + s * .79, y + s * .12, s * .16, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = style.eyes;
        ctx.beginPath();
        ctx.arc(x + s * .31, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
        ctx.arc(x + s * .69, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = style.nose;
        ctx.beginPath();
        ctx.arc(x + s * .5, y + s * .69, Math.max(1, s * .075), 0, Math.PI * 2);
        ctx.fill();
      }

      if (tracked) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#087dff';
        ctx.lineWidth = Math.max(1.5, scale * .06);
        ctx.strokeRect(x - 2, y - 2, s + 4, s + 4);
      }
      ctx.restore();
    }

    render = function () {
      resizeCanvas();
      const bounds = drawGrid();
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const type = getCell(x, y);
          if (type) drawCell(x, y, type, bounds.scale);
        }
      }
      drawGoal(bounds.scale);

      if (state.mode === 'edit') {
        drawMouseSquare(state.start.x, state.start.y, bounds.scale, 1, false, true);
        return;
      }

      const tracked = chooseTrackedMouse();
      const trackedId = tracked?.id;
      for (const mouse of state.mice) {
        if (!mouse.alive && !mouse.reachedGoal) continue;
        const isTracked = mouse.id === trackedId;
        drawV12LineageMouse(mouse.renderX, mouse.renderY, bounds.scale, isTracked ? 1 : .58, isTracked, mouse.lineage || 'grey');
      }
    };

    // Simulation camera controls. One-finger drag is intentionally paused-only so it
    // never fights the followed mouse during a live run. Two-finger pinch works at all times.
    const simPointers = new Map();
    let simGesture = null;
    let simPan = null;
    state.freeCamera = false;
    state.simPinching = false;

    const previousFollowTrackedMouse = followTrackedMouse;
    followTrackedMouse = function () {
      if (state.mode === 'sim' && (state.freeCamera || state.simPinching)) return;
      previousFollowTrackedMouse();
    };

    function pointerPosition(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function beginSimPinch() {
      const points = [...simPointers.values()];
      if (points.length < 2) return;
      const [a, b] = points;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      simGesture = {
        startScale: state.view.scale,
        startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        anchorWorld: screenToWorld(mid.x, mid.y)
      };
      simPan = null;
      state.simPinching = true;
      if (state.paused) state.freeCamera = true;
    }

    function updateSimPinch() {
      const points = [...simPointers.values()];
      if (points.length < 2 || !simGesture) return;
      const [a, b] = points;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const rect = canvas.getBoundingClientRect();
      const scale = Math.max(7, Math.min(72, simGesture.startScale * dist / simGesture.startDist));
      state.view.scale = scale;
      state.view.cx = simGesture.anchorWorld.x - (mid.x - rect.width / 2) / scale;
      state.view.cy = simGesture.anchorWorld.y - (mid.y - rect.height / 2) / scale;
      clampView();
    }

    canvas.addEventListener('pointerdown', e => {
      if (state.mode !== 'sim') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      canvas.setPointerCapture?.(e.pointerId);
      simPointers.set(e.pointerId, pointerPosition(e));

      if (simPointers.size >= 2) beginSimPinch();
      else if (state.paused) {
        const point = simPointers.get(e.pointerId);
        simPan = { pointerId: e.pointerId, x: point.x, y: point.y, cx: state.view.cx, cy: state.view.cy };
      }
    }, true);

    canvas.addEventListener('pointermove', e => {
      if (state.mode !== 'sim' || !simPointers.has(e.pointerId)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      simPointers.set(e.pointerId, pointerPosition(e));

      if (simPointers.size >= 2) {
        if (!simGesture) beginSimPinch();
        updateSimPinch();
        return;
      }

      if (state.paused && simPan?.pointerId === e.pointerId) {
        const point = simPointers.get(e.pointerId);
        state.freeCamera = true;
        state.view.cx = simPan.cx - (point.x - simPan.x) / state.view.scale;
        state.view.cy = simPan.cy - (point.y - simPan.y) / state.view.scale;
        clampView();
      }
    }, true);

    function endSimPointer(e) {
      if (state.mode !== 'sim' || !simPointers.has(e.pointerId)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      simPointers.delete(e.pointerId);

      if (simPointers.size < 2) {
        simGesture = null;
        state.simPinching = false;
      }

      if (state.paused && simPointers.size === 1) {
        const [pointerId, point] = [...simPointers.entries()][0];
        simPan = { pointerId, x: point.x, y: point.y, cx: state.view.cx, cy: state.view.cy };
      } else if (!simPointers.size) {
        simPan = null;
      }
    }
    canvas.addEventListener('pointerup', endSimPointer, true);
    canvas.addEventListener('pointercancel', endSimPointer, true);

    canvas.addEventListener('wheel', e => {
      if (state.mode !== 'sim') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const before = screenToWorld(px, py);
      const factor = Math.exp(-e.deltaY * 0.0012);
      state.view.scale = Math.max(7, Math.min(72, state.view.scale * factor));
      const after = screenToWorld(px, py);
      state.view.cx += before.x - after.x;
      state.view.cy += before.y - after.y;
      if (state.paused) state.freeCamera = true;
      clampView();
    }, { passive: false, capture: true });

    pauseButton.addEventListener('click', () => {
      if (state.mode !== 'sim') return;
      if (!state.paused) state.freeCamera = false;
    });

    homeButton.addEventListener('click', e => {
      if (state.mode !== 'sim') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      state.freeCamera = false;
      const tracked = chooseTrackedMouse();
      if (tracked) {
        state.view.cx = tracked.renderX + .5;
        state.view.cy = tracked.renderY + .5;
        clampView();
      }
    }, true);
  })();
