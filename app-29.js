// EvoMaus v1.3 brain-capacity + structural-maze pass.
// 179 inputs -> 13 hidden neurons -> 4 outputs. Wall hits remain costly but non-terminal.
// Maze identity follows the structural shortest route (walls/start/goal), ignoring cheese/danger.
(() => {
  const INPUTS = 179;
  const HIDDEN = 13;
  const OUTPUTS = 4;
  const IN_STRIDE = INPUTS + 1;
  const OUT_STRIDE = HIDDEN + 1;
  const OUT_BASE = IN_STRIDE * HIDDEN;
  const WEIGHTS = OUT_BASE + OUT_STRIDE * OUTPUTS;

  const OLD_HIDDEN = 10;
  const OLD_IN_STRIDE = INPUTS + 1;
  const OLD_OUT_STRIDE = OLD_HIDDEN + 1;
  const OLD_OUT_BASE = OLD_IN_STRIDE * OLD_HIDDEN;
  const OLD_WEIGHTS = OLD_OUT_BASE + OLD_OUT_STRIDE * OUTPUTS;

  function clampWeight(value) {
    return Math.max(-4, Math.min(4, value));
  }

  function freshWeight(scale = 0.68) {
    return (Math.random() * 2 - 1) * scale;
  }

  function randomGenome13() {
    const genome = new Float32Array(WEIGHTS);
    for (let i = 0; i < genome.length; i++) genome[i] = freshWeight(0.68);
    return genome;
  }

  function migrate10to13(source) {
    const genome = new Float32Array(WEIGHTS);

    // Preserve the ten evolved hidden neurons exactly.
    for (let h = 0; h < OLD_HIDDEN; h++) {
      const oldStart = h * OLD_IN_STRIDE;
      const newStart = h * IN_STRIDE;
      for (let i = 0; i < IN_STRIDE; i++) genome[newStart + i] = source[oldStart + i] ?? 0;
    }

    // The three new neurons start quiet so an old proven brain is not destroyed.
    for (let h = OLD_HIDDEN; h < HIDDEN; h++) {
      const start = h * IN_STRIDE;
      for (let i = 0; i < INPUTS; i++) genome[start + i] = freshWeight(0.055);
      genome[start + INPUTS] = freshWeight(0.035);
    }

    // Preserve every old hidden->movement connection and output bias.
    for (let o = 0; o < OUTPUTS; o++) {
      const oldStart = OLD_OUT_BASE + o * OLD_OUT_STRIDE;
      const newStart = OUT_BASE + o * OUT_STRIDE;
      for (let h = 0; h < OLD_HIDDEN; h++) genome[newStart + h] = source[oldStart + h] ?? 0;
      for (let h = OLD_HIDDEN; h < HIDDEN; h++) genome[newStart + h] = freshWeight(0.055);
      genome[newStart + HIDDEN] = source[oldStart + OLD_HIDDEN] ?? 0;
    }

    return genome;
  }

  function normaliseGenome(source) {
    if (source?.length === WEIGHTS) return source;
    if (source?.length === OLD_WEIGHTS) return migrate10to13(source);
    return randomGenome13();
  }

  const previousMakeMouseV141 = makeMouse;
  makeMouse = function (genome, generation, parentIds = [], lineage = null) {
    return previousMakeMouseV141(normaliseGenome(genome), generation, parentIds, lineage);
  };

  function breedGenome13(a, b, mutationRate) {
    const ag = normaliseGenome(a?.genome);
    const bg = normaliseGenome(b?.genome);
    const child = new Float32Array(WEIGHTS);
    let mutationCount = 0;

    for (let i = 0; i < child.length; i++) {
      let gene = Math.random() < 0.5 ? ag[i] : bg[i];
      if (Math.random() < mutationRate) {
        mutationCount++;
        if (Math.random() < 0.035) gene = freshWeight(1.2);
        else gene += (Math.random() + Math.random() - 1) * 0.48;
      }
      child[i] = clampWeight(gene);
    }
    return { genome: child, mutationCount };
  }

  function decideMove13(mouse) {
    if (mouse.genome?.length !== WEIGHTS) mouse.genome = normaliseGenome(mouse.genome);
    const inputs = brainInputs(mouse);
    const hidden = new Float32Array(HIDDEN);
    const outputs = new Float32Array(OUTPUTS);
    const genome = mouse.genome;
    let wi = 0;

    for (let h = 0; h < HIDDEN; h++) {
      let sum = 0;
      for (let i = 0; i < INPUTS; i++) sum += (inputs[i] ?? 0) * (genome[wi++] ?? 0);
      sum += genome[wi++] ?? 0;
      hidden[h] = Math.tanh(sum);
    }

    for (let o = 0; o < OUTPUTS; o++) {
      let sum = 0;
      for (let h = 0; h < HIDDEN; h++) sum += hidden[h] * (genome[wi++] ?? 0);
      outputs[o] = sum + (genome[wi++] ?? 0);
    }

    let bestDir = 0;
    for (let o = 1; o < OUTPUTS; o++) if (outputs[o] > outputs[bestDir]) bestDir = o;

    // Keep the existing anti-vibration rails; the extra neurons only increase
    // representational capacity, they do not add a hand-coded behaviour.
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

  randomGenome = randomGenome13;
  breedGenome = breedGenome13;
  decideMove = decideMove13;

  if (state.balanceV22) {
    state.balanceV22.brainInputs = INPUTS;
    state.balanceV22.brainHidden = HIDDEN;
    state.balanceV22.brainWeights = WEIGHTS;
  }
  state.brainArchitecture = { inputs: INPUTS, hidden: HIDDEN, outputs: OUTPUTS, weights: WEIGHTS };

  // Wall hits already cost fitness, extra energy and stagnation. With metabolism
  // active, the arbitrary tenth-hit execution is redundant: repeated headbutting
  // now burns energy until hunger/stagnation/timeout ends the run naturally.
  const previousKillMouseV141 = killMouse;
  killMouse = function (mouse, reason) {
    if (reason === 'walls') {
      mouse.alive = true;
      mouse.deathReason = '';
      computeFitness(mouse);
      recordMilestones(mouse);
      return;
    }
    return previousKillMouseV141(mouse, reason);
  };

  // Build a deterministic shortest route using WALLS ONLY. Cheese and danger can
  // change the pressure inside a maze without turning it into a different maze.
  // Off-route wall edits are also ignored unless they actually alter the best route.
  function structuralRouteSignature() {
    const start = state.start;
    const goal = state.goal;
    if (!goal) return `${start.x},${start.y}|none|no-route`;

    const size = GRID_W * GRID_H;
    const dist = new Int32Array(size);
    dist.fill(-1);
    const qx = new Int16Array(size);
    const qy = new Int16Array(size);
    let head = 0, tail = 0;
    const idx = (x, y) => y * GRID_W + x;

    qx[tail] = goal.x;
    qy[tail] = goal.y;
    tail++;
    dist[idx(goal.x, goal.y)] = 0;

    while (head < tail) {
      const x = qx[head];
      const y = qy[head];
      const base = dist[idx(x, y)];
      head++;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (dist[ni] !== -1 || getCell(nx, ny) === CELL.WALL) continue;
        dist[ni] = base + 1;
        qx[tail] = nx;
        qy[tail] = ny;
        tail++;
      }
    }

    const startDistance = dist[idx(start.x, start.y)];
    const prefix = `${start.x},${start.y}|${goal.x},${goal.y}`;
    if (startDistance < 0) return `${prefix}|blocked`;

    let x = start.x;
    let y = start.y;
    let remaining = startDistance;
    const route = [`${x},${y}`];

    // DIRS order makes ties deterministic. If a newly placed wall forces another
    // equally-short path, this sequence changes and EvoMaus treats it as a new maze.
    while (remaining > 0) {
      let moved = false;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny) || getCell(nx, ny) === CELL.WALL) continue;
        if (dist[idx(nx, ny)] !== remaining - 1) continue;
        x = nx;
        y = ny;
        remaining--;
        route.push(`${x},${y}`);
        moved = true;
        break;
      }
      if (!moved) break;
    }

    return `${prefix}|d${startDistance}|${route.join('>')}`;
  }

  currentMazeSignature = structuralRouteSignature;

  document.body.classList.add('v141Brain13StructuralMaze');
})();
