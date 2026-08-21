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

  // v1.1 brain: each mouse sees up to eight cells in eight directions and evolves
  // a tiny neural network rather than a fixed list of moves.
  const SIGHT_DISTANCE = 8;
  const SIGHT_DIRS = [
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 },
    { x: -1, y: -1 }
  ];
  const BRAIN_INPUTS = 45;
  const BRAIN_HIDDEN = 12;
  const BRAIN_OUTPUTS = 4;
  const BRAIN_WEIGHTS = (BRAIN_INPUTS + 1) * BRAIN_HIDDEN + (BRAIN_HIDDEN + 1) * BRAIN_OUTPUTS;
  const RECENT_MEMORY_STEPS = 10;
  const PATH_MEMORY_STEPS = 12;
  const AXIS_OSCILLATION_WINDOW = 4;

  function stagnationLimit() {
    return Math.max(48, Math.min(120, Math.round(42 + state.startDistance * 0.18)));
  }

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
      lastVisitStep: new Map([[startKey, 0]]),
      pathHistory: [startKey],
      dirHistory: [],
      bestDistance: state.startDistance,
      currentDistance: state.startDistance,
      lastDir: -1,
      lastWallHit: 0,
      previousX: null,
      previousY: null,
      reverseStreak: 0,
      staleSteps: 0,
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
    score -= mouse.staleSteps * 90;
    if (mouse.deathReason === 'danger') score -= 8000;
    if (mouse.deathReason === 'stagnation') score -= 10000;
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

  function recentnessOf(mouse, x, y) {
    if (!inBounds(x, y)) return 1;
    const lastStep = mouse.lastVisitStep.get(cellKey(x, y));
    if (lastStep === undefined) return 0;
    const age = Math.max(0, mouse.step - lastStep);
    return Math.max(0, 1 - age / RECENT_MEMORY_STEPS);
  }

  function brainInputs(mouse) {
    const inputs = [];

    for (const direction of SIGHT_DIRS) inputs.push(...senseRay(mouse, direction));

    const dx = state.goal.x - mouse.x;
    const dy = state.goal.y - mouse.y;
    const bearingScale = Math.max(1, Math.abs(dx), Math.abs(dy));
    inputs.push(dx / bearingScale, dy / bearingScale);

    inputs.push(currentProgressOf(mouse));

    for (let d = 0; d < 4; d++) inputs.push(mouse.lastDir === d ? 1 : 0);
    inputs.push(mouse.lastWallHit ? 1 : 0);

    for (const d of DIRS) {
      inputs.push(recentnessOf(mouse, mouse.x + d.x, mouse.y + d.y));
    }

    inputs.push(Math.min(1, mouse.staleSteps / stagnationLimit()));

    return inputs;
  }

  function isSafeMove(mouse, dir) {
    const d = DIRS[dir];
    const x = mouse.x + d.x;
    const y = mouse.y + d.y;
    if (!inBounds(x, y)) return false;
    const type = getCell(x, y);
    return type !== CELL.WALL && type !== CELL.DANGER;
  }

  function isImmediateReverse(mouse, dir) {
    if (mouse.previousX === null || mouse.previousY === null) return false;
    const d = DIRS[dir];
    return mouse.x + d.x === mouse.previousX && mouse.y + d.y === mouse.previousY;
  }

  function targetKey(mouse, dir) {
    const d = DIRS[dir];
    return cellKey(mouse.x + d.x, mouse.y + d.y);
  }

  function axisOfDir(dir) {
    return dir === 0 || dir === 2 ? 'vertical' : 'horizontal';
  }

  function isValuableImmediateTarget(mouse, dir) {
    const d = DIRS[dir];
    const x = mouse.x + d.x;
    const y = mouse.y + d.y;
    if (!inBounds(x, y)) return false;
    if (state.goal && x === state.goal.x && y === state.goal.y) return true;
    if (getCell(x, y) === CELL.CHEESE && !mouse.cheeses.has(cellKey(x, y))) return true;
    return false;
  }

  function wouldCompleteShortRetrace(mouse, dir) {
    // Detect A→B→C→B→A. The path must have A,B,C,B as its last four
    // successful positions and the proposed next square is A.
    const h = mouse.pathHistory;
    if (h.length < 4) return false;
    const target = targetKey(mouse, dir);
    return h[h.length - 4] === target && h[h.length - 3] === h[h.length - 1];
  }

  function wouldContinueAxisOscillation(mouse, dir) {
    // Look at the proposed move plus the previous three successful moves.
    // If all four are on one axis and include both directions, the mouse is
    // shuttling left/right or up/down rather than making a purposeful straight run.
    const prospective = mouse.dirHistory.slice(-(AXIS_OSCILLATION_WINDOW - 1));
    prospective.push(dir);
    if (prospective.length < AXIS_OSCILLATION_WINDOW) return false;
    const axis = axisOfDir(dir);
    if (!prospective.every(d => axisOfDir(d) === axis)) return false;
    return new Set(prospective).size > 1;
  }

  function bestSafeAlternative(mouse, outputs, excludedDir, requirePerpendicular = false) {
    const excludedAxis = axisOfDir(excludedDir);
    let alternative = -1;
    let alternativeScore = -Infinity;

    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      if (o === excludedDir || !isSafeMove(mouse, o)) continue;
      if (requirePerpendicular && axisOfDir(o) === excludedAxis) continue;

      const d = DIRS[o];
      const recency = recentnessOf(mouse, mouse.x + d.x, mouse.y + d.y);
      // Preserve the evolved preference but give genuinely less-recent ground a
      // modest advantage when the controller has decided it must break a loop.
      const score = outputs[o] + (1 - recency) * 0.7;
      if (score > alternativeScore) {
        alternativeScore = score;
        alternative = o;
      }
    }
    return alternative;
  }

  function decideMove(mouse) {
    const inputs = brainInputs(mouse);
    const hidden = new Float32Array(BRAIN_HIDDEN);
    const outputs = new Float32Array(BRAIN_OUTPUTS);
    const g = mouse.genome;
    let wi = 0;

    for (let h = 0; h < BRAIN_HIDDEN; h++) {
      let sum = 0;
      for (let i = 0; i < BRAIN_INPUTS; i++) sum += inputs[i] * g[wi++];
      sum += g[wi++];
      hidden[h] = Math.tanh(sum);
    }

    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      let sum = 0;
      for (let h = 0; h < BRAIN_HIDDEN; h++) sum += hidden[h] * g[wi++];
      outputs[o] = sum + g[wi++];
    }

    let bestDir = 0;
    for (let o = 1; o < BRAIN_OUTPUTS; o++) {
      if (outputs[o] > outputs[bestDir]) bestDir = o;
    }

    // A→B→A is permitted once, because real backtracking matters. Repeated
    // immediate reversal is redirected when another safe option exists.
    if (mouse.reverseStreak > 0 && isImmediateReverse(mouse, bestDir) && !isValuableImmediateTarget(mouse, bestDir)) {
      const alternative = bestSafeAlternative(mouse, outputs, bestDir, false);
      if (alternative >= 0) bestDir = alternative;
    }

    // Broader anti-vibration rule: catch A→B→C→B→A and sustained horizontal/
    // vertical shuttling. If a perpendicular safe turn exists during axis
    // oscillation, take the brain's favourite turn. This never forces a turn in
    // a corridor, dead end, or when the proposed square is goal/new cheese.
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

  function tickMouse(mouse) {
    if (!mouse.alive) return;
    if (mouse.step >= state.maxSteps) {
      killMouse(mouse, 'timeout');
      return;
    }

    const gene = decideMove(mouse);
    const d = DIRS[gene];
    mouse.step++;
    const fromX = mouse.x;
    const fromY = mouse.y;
    const nx = fromX + d.x;
    const ny = fromY + d.y;
    const reversing = nx === mouse.previousX && ny === mouse.previousY;
    mouse.lastDir = gene;

    if (!inBounds(nx, ny) || getCell(nx, ny) === CELL.WALL) {
      mouse.wallHits++;
      mouse.lastWallHit = 1;
      mouse.staleSteps++;
      if (mouse.wallHits >= WALL_DEATH_HITS) killMouse(mouse, 'walls');
      else if (mouse.staleSteps >= stagnationLimit()) killMouse(mouse, 'stagnation');
      else {
        computeFitness(mouse);
        recordMilestones(mouse);
      }
      return;
    }

    mouse.lastWallHit = 0;
    const key = cellKey(nx, ny);
    const foundNewCell = !mouse.visited.has(key);
    const previousBestDistance = mouse.bestDistance;
    const previousCheeseCount = mouse.cheeseCount;

    mouse.previousX = fromX;
    mouse.previousY = fromY;
    mouse.reverseStreak = reversing ? mouse.reverseStreak + 1 : 0;
    mouse.x = nx;
    mouse.y = ny;
    mouse.visited.add(key);
    mouse.lastVisitStep.set(key, mouse.step);
    mouse.pathHistory.push(key);
    if (mouse.pathHistory.length > PATH_MEMORY_STEPS) mouse.pathHistory.shift();
    mouse.dirHistory.push(gene);
    if (mouse.dirHistory.length > PATH_MEMORY_STEPS) mouse.dirHistory.shift();
    const type = getCell(nx, ny);

    if (type === CELL.DANGER) {
      killMouse(mouse, 'danger');
      return;
    }

    if (type === CELL.CHEESE && !mouse.cheeses.has(key)) {
      mouse.cheeses.add(key);
      mouse.cheeseCount++;
    }

    const dist = state.distanceMap[indexFor(nx, ny)];
    if (dist >= 0) {
      mouse.currentDistance = dist;
      if (dist < mouse.bestDistance) mouse.bestDistance = dist;
    }

    const improvedProgress = mouse.bestDistance < previousBestDistance;
    const foundCheese = mouse.cheeseCount > previousCheeseCount;
    if (foundNewCell || improvedProgress || foundCheese) mouse.staleSteps = 0;
    else mouse.staleSteps++;

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

    if (mouse.staleSteps >= stagnationLimit()) {
      killMouse(mouse, 'stagnation');
      return;
    }

    computeFitness(mouse);
    recordMilestones(mouse);
  }
