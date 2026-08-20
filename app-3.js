  function indexFor(x, y) { return y * GRID_W + x; }

  function buildDistanceMap() {
    if (!state.goal) return null;
    const dist = new Int32Array(GRID_W * GRID_H);
    dist.fill(-1);
    const qx = new Int16Array(GRID_W * GRID_H);
    const qy = new Int16Array(GRID_W * GRID_H);
    let head = 0, tail = 0;
    qx[tail] = state.goal.x;
    qy[tail] = state.goal.y;
    tail++;
    dist[indexFor(state.goal.x, state.goal.y)] = 0;

    while (head < tail) {
      const x = qx[head];
      const y = qy[head];
      const base = dist[indexFor(x, y)];
      head++;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny)) continue;
        const idx = indexFor(nx, ny);
        if (dist[idx] !== -1) continue;
        const type = getCell(nx, ny);
        if (type === CELL.WALL || type === CELL.DANGER) continue;
        dist[idx] = base + 1;
        qx[tail] = nx;
        qy[tail] = ny;
        tail++;
      }
    }
    return dist;
  }

  function randomGenome(length) {
    const g = new Uint8Array(length);
    for (let i = 0; i < length; i++) g[i] = Math.floor(Math.random() * 4);
    return g;
  }

  function makeMouse(genome, generation, parentIds = []) {
    return {
      id: state.nextMouseId++,
      generation,
      parentIds,
      genome,
      x: state.start.x,
      y: state.start.y,
      renderX: state.start.x,
      renderY: state.start.y,
      alive: true,
      reachedGoal: false,
      deathReason: '',
      step: 0,
      wallHits: 0,
      cheeseCount: 0,
      cheeses: new Set(),
      bestDistance: state.startDistance,
      currentDistance: state.startDistance,
      fitness: 0,
      mutations: 0
    };
  }

  function initialiseGenerationOne() {
    state.generation = 1;
    state.nextMouseId = 1;
    state.mice = Array.from({ length: state.populationSize }, () => makeMouse(randomGenome(state.maxSteps), 1));
    state.trackedMouseId = state.mice[0]?.id ?? null;
    state.bestEver = null;
    state.stagnation = 0;
    state.lastBestProgress = -1;
    state.firstGoalGeneration = null;
    state.generationCooldown = 0;
    updateStats();
  }

  function computeFitness(mouse) {
    const progress = Math.max(0, state.startDistance - mouse.bestDistance);
    const progressNorm = state.startDistance > 0 ? progress / state.startDistance : 0;
    let score = progressNorm * 100000;
    score += mouse.cheeseCount * 9000;
    score -= mouse.wallHits * 240;
    score -= mouse.step * 1.4;
    if (mouse.deathReason === 'danger') score -= 1200;
    if (mouse.reachedGoal) {
      score += 1000000;
      score += Math.max(0, state.maxSteps - mouse.step) * 80;
    }
    mouse.fitness = score;
    return score;
  }

  function progressOf(mouse) {
    if (!mouse || state.startDistance <= 0) return mouse?.reachedGoal ? 1 : 0;
    return Math.max(0, Math.min(1, (state.startDistance - mouse.bestDistance) / state.startDistance));
  }

  function killMouse(mouse, reason) {
    mouse.alive = false;
    mouse.deathReason = reason;
    computeFitness(mouse);
  }

  function tickMouse(mouse) {
    if (!mouse.alive) return;
    if (mouse.step >= state.maxSteps) {
      killMouse(mouse, 'timeout');
      return;
    }

    const gene = mouse.genome[mouse.step] ?? Math.floor(Math.random() * 4);
    const d = DIRS[gene];
    mouse.step++;
    const nx = mouse.x + d.x;
    const ny = mouse.y + d.y;

    if (!inBounds(nx, ny) || getCell(nx, ny) === CELL.WALL) {
      mouse.wallHits++;
      if (mouse.wallHits >= WALL_DEATH_HITS) killMouse(mouse, 'walls');
      else computeFitness(mouse);
      return;
    }

    mouse.x = nx;
    mouse.y = ny;
    const type = getCell(nx, ny);

    if (type === CELL.DANGER) {
      killMouse(mouse, 'danger');
      return;
    }

    if (type === CELL.CHEESE) {
      const key = cellKey(nx, ny);
      if (!mouse.cheeses.has(key)) {
        mouse.cheeses.add(key);
        mouse.cheeseCount++;
      }
    }

    if (state.goal && nx === state.goal.x && ny === state.goal.y) {
      mouse.reachedGoal = true;
      killMouse(mouse, 'goal');
      if (state.firstGoalGeneration === null) {
        state.firstGoalGeneration = state.generation;
        showToast(`Goal reached! Generation ${state.generation} has cracked the maze.`, 'good');
      }
      return;
    }

    const dist = state.distanceMap[indexFor(nx, ny)];
    if (dist >= 0) {
      mouse.currentDistance = dist;
      if (dist < mouse.bestDistance) mouse.bestDistance = dist;
    }
    computeFitness(mouse);
  }
