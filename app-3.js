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

  // v2 brain: each mouse sees up to eight cells in eight directions and evolves
  // a tiny neural network rather than a fixed list of moves.
  const SIGHT_DISTANCE = 8;
  const SIGHT_DIRS = [
    { x: 0, y: -1 },  // N
    { x: 1, y: -1 },  // NE
    { x: 1, y: 0 },   // E
    { x: 1, y: 1 },   // SE
    { x: 0, y: 1 },   // S
    { x: -1, y: 1 },  // SW
    { x: -1, y: 0 },  // W
    { x: -1, y: -1 }  // NW
  ];
  const BRAIN_INPUTS = 44;
  const BRAIN_HIDDEN = 12;
  const BRAIN_OUTPUTS = 4;
  const BRAIN_WEIGHTS = (BRAIN_INPUTS + 1) * BRAIN_HIDDEN + (BRAIN_HIDDEN + 1) * BRAIN_OUTPUTS;

  function randomGenome() {
    const g = new Float32Array(BRAIN_WEIGHTS);
    for (let i = 0; i < g.length; i++) g[i] = (Math.random() * 2 - 1) * 0.85;
    return g;
  }

  function makeMouse(genome, generation, parentIds = []) {
    const startKey = cellKey(state.start.x, state.start.y);
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
      visited: new Set([startKey]),
      bestDistance: state.startDistance,
      currentDistance: state.startDistance,
      lastDir: -1,
      lastWallHit: 0,
      fitness: 0,
      mutations: 0
    };
  }

  function initialiseGenerationOne() {
    state.generation = 1;
    state.nextMouseId = 1;
    state.mice = Array.from({ length: state.populationSize }, () => makeMouse(randomGenome(), 1));
    state.trackedMouseId = state.mice[0]?.id ?? null;
    state.bestEver = null;
    state.allTimeBestProgress = 0;
    state.bestTime = null;
    state.stagnation = 0;
    state.lastBestProgress = -1;
    state.firstGoalGeneration = null;
    state.generationCooldown = 0;
    updateStats();
  }

  function currentProgressOf(mouse) {
    if (!mouse || state.startDistance <= 0) return mouse?.reachedGoal ? 1 : 0;
    return Math.max(0, Math.min(1, (state.startDistance - mouse.currentDistance) / state.startDistance));
  }

  function computeFitness(mouse) {
    const progressNorm = progressOf(mouse);
    let score = progressNorm * 140000;
    score += mouse.cheeseCount * 12000;
    score += Math.max(0, mouse.visited.size - 1) * 40;
    score -= mouse.wallHits * 800;
    score -= mouse.step * 1.2;
    if (mouse.deathReason === 'danger') score -= 8000;
    if (mouse.reachedGoal) {
      score += 1000000;
      score += Math.max(0, state.maxSteps - mouse.step) * 120;
    }
    mouse.fitness = score;
    return score;
  }

  function progressOf(mouse) {
    if (!mouse || state.startDistance <= 0) return mouse?.reachedGoal ? 1 : 0;
    return Math.max(0, Math.min(1, (state.startDistance - mouse.bestDistance) / state.startDistance));
  }

  function recordMilestones(mouse) {
    const progress = progressOf(mouse);
    if (progress > state.allTimeBestProgress) state.allTimeBestProgress = progress;
    if (mouse.reachedGoal) {
      state.allTimeBestProgress = 1;
      if (state.bestTime === null || mouse.step < state.bestTime) state.bestTime = mouse.step;
    }
  }

  function killMouse(mouse, reason) {
    mouse.alive = false;
    mouse.deathReason = reason;
    computeFitness(mouse);
    recordMilestones(mouse);
  }

  function closenessAt(distance) {
    return Math.max(0, (SIGHT_DISTANCE + 1 - distance) / SIGHT_DISTANCE);
  }

  function senseRay(mouse, direction) {
    let wall = 0;
    let danger = 0;
    let cheese = 0;
    let goal = 0;

    for (let step = 1; step <= SIGHT_DISTANCE; step++) {
      const x = mouse.x + direction.x * step;
      const y = mouse.y + direction.y * step;
      if (!inBounds(x, y)) {
        wall = closenessAt(step);
        break;
      }

      const type = getCell(x, y);
      if (type === CELL.WALL) {
        wall = closenessAt(step);
        break;
      }

      const closeness = closenessAt(step);
      if (!danger && type === CELL.DANGER) danger = closeness;
      if (!cheese && type === CELL.CHEESE) cheese = closeness;
      if (!goal && state.goal && x === state.goal.x && y === state.goal.y) goal = closeness;
    }

    return [wall, danger, cheese, goal];
  }

  function brainInputs(mouse) {
    const inputs = [];

    // 32 values: wall, danger, cheese and goal proximity along each of eight rays.
    for (const direction of SIGHT_DIRS) inputs.push(...senseRay(mouse, direction));

    // Loose goal bearing: direction only, deliberately no direct distance.
    const dx = state.goal.x - mouse.x;
    const dy = state.goal.y - mouse.y;
    const bearingScale = Math.max(1, Math.abs(dx), Math.abs(dy));
    inputs.push(dx / bearingScale, dy / bearingScale);

    // The mouse can feel how far around the safe route it currently is.
    // This is flood-fill progress, so sometimes moving geometrically away from the
    // goal correctly increases this value when the maze requires a detour.
    inputs.push(currentProgressOf(mouse));

    // Tiny memory: previous direction and whether the previous action hit a wall.
    for (let d = 0; d < 4; d++) inputs.push(mouse.lastDir === d ? 1 : 0);
    inputs.push(mouse.lastWallHit ? 1 : 0);

    // Local route memory: has this mouse already visited each adjacent cardinal cell?
    for (const d of DIRS) {
      const nx = mouse.x + d.x;
      const ny = mouse.y + d.y;
      inputs.push(!inBounds(nx, ny) || mouse.visited.has(cellKey(nx, ny)) ? 1 : 0);
    }

    return inputs;
  }

  function decideMove(mouse) {
    const inputs = brainInputs(mouse);
    const hidden = new Float32Array(BRAIN_HIDDEN);
    const g = mouse.genome;
    let wi = 0;

    for (let h = 0; h < BRAIN_HIDDEN; h++) {
      let sum = 0;
      for (let i = 0; i < BRAIN_INPUTS; i++) sum += inputs[i] * g[wi++];
      sum += g[wi++]; // bias
      hidden[h] = Math.tanh(sum);
    }

    let bestDir = 0;
    let bestScore = -Infinity;
    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      let sum = 0;
      for (let h = 0; h < BRAIN_HIDDEN; h++) sum += hidden[h] * g[wi++];
      sum += g[wi++]; // bias
      if (sum > bestScore) {
        bestScore = sum;
        bestDir = o;
      }
    }
    return bestDir;
  }

  function tickMouse(mouse) {
    if (!mouse.alive) return;
    if (mouse.step >= state.maxSteps) {
      killMouse(mouse, 'timeout');
      return;
    }

    const gene = decideMove(mouse);
    const d = DIRS[gene];
    mouse.step++;
    const nx = mouse.x + d.x;
    const ny = mouse.y + d.y;
    mouse.lastDir = gene;

    if (!inBounds(nx, ny) || getCell(nx, ny) === CELL.WALL) {
      mouse.wallHits++;
      mouse.lastWallHit = 1;
      if (mouse.wallHits >= WALL_DEATH_HITS) killMouse(mouse, 'walls');
      else {
        computeFitness(mouse);
        recordMilestones(mouse);
      }
      return;
    }

    mouse.lastWallHit = 0;
    mouse.x = nx;
    mouse.y = ny;
    mouse.visited.add(cellKey(nx, ny));
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

    const dist = state.distanceMap[indexFor(nx, ny)];
    if (dist >= 0) {
      mouse.currentDistance = dist;
      if (dist < mouse.bestDistance) mouse.bestDistance = dist;
    }

    if (state.goal && nx === state.goal.x && ny === state.goal.y) {
      mouse.reachedGoal = true;
      recordMilestones(mouse);
      killMouse(mouse, 'goal');
      if (state.firstGoalGeneration === null) {
        state.firstGoalGeneration = state.generation;
        showToast(`Goal reached! Gen ${state.generation} has cracked the maze.`, 'good');
      }
      return;
    }

    computeFitness(mouse);
    recordMilestones(mouse);
  }
