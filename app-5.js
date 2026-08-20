  function drawGrid() {
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ece8dc';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const scale = state.view.scale;
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(rect.width, rect.height);
    const minX = Math.max(0, Math.floor(topLeft.x) - 1);
    const maxX = Math.min(GRID_W - 1, Math.ceil(bottomRight.x) + 1);
    const minY = Math.max(0, Math.floor(topLeft.y) - 1);
    const maxY = Math.min(GRID_H - 1, Math.ceil(bottomRight.y) + 1);

    // Outer world area shading.
    const worldA = worldToScreen(0, 0);
    const worldB = worldToScreen(GRID_W, GRID_H);
    ctx.fillStyle = '#f7f4eb';
    ctx.fillRect(worldA.x, worldA.y, worldB.x - worldA.x, worldB.y - worldA.y);

    if (scale >= 11) {
      ctx.beginPath();
      ctx.lineWidth = scale >= 25 ? 1 : 0.65;
      ctx.strokeStyle = scale >= 25 ? 'rgba(51,57,66,.16)' : 'rgba(51,57,66,.09)';
      for (let x = minX; x <= maxX + 1; x++) {
        const p = worldToScreen(x, 0);
        ctx.moveTo(Math.round(p.x) + .5, 0);
        ctx.lineTo(Math.round(p.x) + .5, rect.height);
      }
      for (let y = minY; y <= maxY + 1; y++) {
        const p = worldToScreen(0, y);
        ctx.moveTo(0, Math.round(p.y) + .5);
        ctx.lineTo(rect.width, Math.round(p.y) + .5);
      }
      ctx.stroke();
    }

    return { minX, maxX, minY, maxY, scale };
  }

  function drawCell(x, y, type, scale) {
    const p = worldToScreen(x, y);
    const pad = scale >= 18 ? 1 : 0;
    const size = scale - pad * 2;
    const px = p.x + pad;
    const py = p.y + pad;

    if (type === CELL.WALL) {
      ctx.fillStyle = '#101216';
      ctx.fillRect(px, py, size, size);
      if (scale > 25) {
        ctx.strokeStyle = 'rgba(255,255,255,.045)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + .5, py + .5, size - 1, size - 1);
      }
      return;
    }

    if (type === CELL.CHEESE) {
      ctx.fillStyle = '#ffd84a';
      ctx.fillRect(px, py, size, size);
      if (scale > 19) {
        ctx.fillStyle = 'rgba(181,130,0,.36)';
        ctx.beginPath();
        ctx.arc(px + size * .3, py + size * .34, Math.max(1.4, size * .07), 0, Math.PI * 2);
        ctx.arc(px + size * .7, py + size * .65, Math.max(1.2, size * .06), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    if (type === CELL.DANGER) {
      ctx.fillStyle = '#ec555b';
      ctx.fillRect(px, py, size, size);
      if (scale > 18) {
        ctx.strokeStyle = 'rgba(108,9,14,.55)';
        ctx.lineWidth = Math.max(1.5, size * .07);
        ctx.beginPath();
        ctx.moveTo(px + size * .27, py + size * .27);
        ctx.lineTo(px + size * .73, py + size * .73);
        ctx.moveTo(px + size * .73, py + size * .27);
        ctx.lineTo(px + size * .27, py + size * .73);
        ctx.stroke();
      }
    }
  }

  function drawGoal(scale) {
    if (!state.goal) return;
    const p = worldToScreen(state.goal.x, state.goal.y);
    const pad = scale >= 18 ? 1 : 0;
    const size = scale - pad * 2;
    ctx.fillStyle = '#4fc878';
    ctx.fillRect(p.x + pad, p.y + pad, size, size);
    if (scale > 20) {
      ctx.strokeStyle = 'rgba(18,96,49,.65)';
      ctx.lineWidth = Math.max(1, scale * .05);
      ctx.beginPath();
      ctx.moveTo(p.x + scale * .32, p.y + scale * .68);
      ctx.lineTo(p.x + scale * .32, p.y + scale * .27);
      ctx.lineTo(p.x + scale * .67, p.y + scale * .38);
      ctx.lineTo(p.x + scale * .32, p.y + scale * .48);
      ctx.stroke();
    }
  }

  function drawMouseSquare(wx, wy, scale, alpha = 1, tracked = false, startMarker = false) {
    const p = worldToScreen(wx, wy);
    const s = Math.max(6, scale * (startMarker ? .76 : .56));
    const x = p.x + scale / 2 - s / 2;
    const y = p.y + scale / 2 - s / 2;
    ctx.save();
    ctx.globalAlpha = alpha;

    if (tracked) {
      ctx.shadowColor = 'rgba(0,121,255,.48)';
      ctx.shadowBlur = Math.max(5, scale * .28);
    }

    ctx.fillStyle = startMarker ? '#747c88' : '#858c98';
    const r = Math.max(2, s * .16);
    roundRect(ctx, x, y, s, s, r);
    ctx.fill();

    // Ears.
    if (s > 8) {
      ctx.fillStyle = startMarker ? '#9299a4' : '#9ba1ab';
      ctx.beginPath();
      ctx.arc(x + s * .21, y + s * .12, s * .16, 0, Math.PI * 2);
      ctx.arc(x + s * .79, y + s * .12, s * .16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a3039';
      ctx.beginPath();
      ctx.arc(x + s * .31, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
      ctx.arc(x + s * .69, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e4939c';
      ctx.beginPath();
      ctx.arc(x + s * .5, y + s * .69, Math.max(1, s * .07), 0, Math.PI * 2);
      ctx.fill();
    }

    if (tracked) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#087dff';
      ctx.lineWidth = Math.max(1.4, scale * .055);
      ctx.strokeRect(x - 2, y - 2, s + 4, s + 4);
    }

    ctx.restore();
  }

  function roundRect(context, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function render() {
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
    } else {
      const tracked = chooseTrackedMouse();
      const trackedId = tracked?.id;
      for (const mouse of state.mice) {
        // Animate a short glide between grid cells without altering simulation state.
        mouse.renderX += (mouse.x - mouse.renderX) * .38;
        mouse.renderY += (mouse.y - mouse.renderY) * .38;
        if (!mouse.alive && !mouse.reachedGoal) continue;
        const isTracked = mouse.id === trackedId;
        drawMouseSquare(mouse.renderX, mouse.renderY, bounds.scale, isTracked ? 1 : .26, isTracked, false);
      }
    }
  }

  function followTrackedMouse() {
    if (state.mode !== 'sim') return;
    const mouse = chooseTrackedMouse();
    if (!mouse) return;
    const tx = mouse.renderX + .5;
    const ty = mouse.renderY + .5;
    state.view.cx += (tx - state.view.cx) * .095;
    state.view.cy += (ty - state.view.cy) * .095;
    clampView();
  }

  function frame(now) {
    const dt = Math.min(100, now - state.lastFrameTime);
    state.lastFrameTime = now;

    if (state.mode === 'sim' && !state.paused) {
      const ticksPerSecond = 9 * state.speeds[state.speedIndex];
      state.tickAccumulator += dt * ticksPerSecond / 1000;
      let guard = 0;
      while (state.tickAccumulator >= 1 && guard < 20) {
        simulationTick();
        state.tickAccumulator -= 1;
        guard++;
      }
      followTrackedMouse();
      updateStats();
    }

    render();
    requestAnimationFrame(frame);
  }

  // Small public debug surface used by automated smoke tests and useful during tuning.
  window.EvoMausDebug = Object.freeze({
    snapshot() {
      const best = state.mice.length ? [...state.mice].sort((a,b) => computeFitness(b) - computeFitness(a))[0] : null;
      return {
        mode: state.mode,
        generation: state.generation,
        populationSize: state.populationSize,
        start: { ...state.start },
        goal: state.goal ? { ...state.goal } : null,
        wallCount: [...state.cells.values()].filter(v => v === CELL.WALL).length,
        cheeseCount: [...state.cells.values()].filter(v => v === CELL.CHEESE).length,
        dangerCount: [...state.cells.values()].filter(v => v === CELL.DANGER).length,
        alive: state.mice.filter(m => m.alive).length,
        bestProgress: progressOf(best),
        firstGoalGeneration: state.firstGoalGeneration
      };
    },
    clearMaze() { state.cells.clear(); state.goal = null; },
    setStart(x, y) { if (inBounds(x,y)) state.start = {x,y}; },
    setGoal(x, y) { if (inBounds(x,y)) state.goal = {x,y}; },
    setCell(x, y, type) { if ([CELL.WALL, CELL.CHEESE, CELL.DANGER, 'eraser'].includes(type)) setCell(x,y,type); },
    startEvolution,
    step(count = 1) { for (let i = 0; i < count; i++) simulationTick(); },
    buildDistanceMap() { return buildDistanceMap(); }
  });

  loadMaze();
  populationInput.value = String(state.populationSize);
  populationValue.textContent = String(state.populationSize);
  centreOnStart();
  window.addEventListener('resize', resizeCanvas);
  requestAnimationFrame(frame);
