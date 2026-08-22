// EvoMaus v1.1 metabolism pass: hunger changes the brain state and makes time costly.
(() => {
  const V22_BASE_INPUTS = 178;
  const V22_INPUTS = V22_BASE_INPUTS + 1; // hunger
  const V22_HIDDEN = 10;
  const V22_OUTPUTS = 4;
  const V22_WEIGHTS = (V22_INPUTS + 1) * V22_HIDDEN + (V22_HIDDEN + 1) * V22_OUTPUTS;

  const V22_START_ENERGY_FACTOR = 2.2;
  const V22_MIN_START_ENERGY = 120;
  const V22_CHEESE_REFILL_FRACTION = 0.75;
  const V22_MOVE_COST = 1;
  const V22_WALL_COST = 2.5;
  const V22_HUNGER_DEATH_PENALTY = 42000;

  function v22MaxEnergy() {
    const shortest = Math.max(1, state.startDistance || 1);
    return Math.max(V22_MIN_START_ENERGY, Math.round(shortest * V22_START_ENERGY_FACTOR));
  }

  function v22InitEnergy(mouse) {
    const maxEnergy = v22MaxEnergy();
    if (!Number.isFinite(mouse.maxEnergy) || mouse.maxEnergy <= 0) mouse.maxEnergy = maxEnergy;
    if (!Number.isFinite(mouse.energy)) mouse.energy = mouse.maxEnergy;
    mouse.energy = Math.max(0, Math.min(mouse.maxEnergy, mouse.energy));
    return mouse;
  }

  function v22Hunger(mouse) {
    v22InitEnergy(mouse);
    return Math.max(0, Math.min(1, 1 - mouse.energy / Math.max(1, mouse.maxEnergy)));
  }

  const previousMakeMouseV22 = makeMouse;
  makeMouse = function (genome, generation, parentIds = [], lineage = null) {
    return v22InitEnergy(previousMakeMouseV22(genome, generation, parentIds, lineage));
  };

  // Adding hunger as a real neural input changes the genome by ten input weights:
  // one extra connection into each hidden neuron. Strategy remains evolved, not hard-coded.
  function v22RandomGenome() {
    const genome = new Float32Array(V22_WEIGHTS);
    for (let i = 0; i < genome.length; i++) genome[i] = (Math.random() * 2 - 1) * 0.68;
    return genome;
  }

  function v22BreedGenome(a, b, mutationRate) {
    const child = new Float32Array(V22_WEIGHTS);
    let mutationCount = 0;

    for (let i = 0; i < child.length; i++) {
      const av = a.genome[i] ?? 0;
      const bv = b.genome[i] ?? 0;
      let gene = Math.random() < 0.5 ? av : bv;

      if (Math.random() < mutationRate) {
        mutationCount++;
        if (Math.random() < 0.035) gene = (Math.random() * 2 - 1) * 1.2;
        else gene += (Math.random() + Math.random() - 1) * 0.48;
      }

      child[i] = Math.max(-4, Math.min(4, gene));
    }

    return { genome: child, mutationCount };
  }

  const previousBrainInputsV22 = brainInputs;
  function v22BrainInputs(mouse) {
    const inputs = previousBrainInputsV22(mouse);
    inputs.push(v22Hunger(mouse));
    return inputs;
  }

  function v22DecideMove(mouse) {
    const inputs = v22BrainInputs(mouse);
    const hidden = new Float32Array(V22_HIDDEN);
    const outputs = new Float32Array(V22_OUTPUTS);
    const genome = mouse.genome;
    let wi = 0;

    for (let h = 0; h < V22_HIDDEN; h++) {
      let sum = 0;
      for (let i = 0; i < V22_INPUTS; i++) sum += inputs[i] * (genome[wi++] ?? 0);
      sum += genome[wi++] ?? 0;
      hidden[h] = Math.tanh(sum);
    }

    for (let o = 0; o < V22_OUTPUTS; o++) {
      let sum = 0;
      for (let h = 0; h < V22_HIDDEN; h++) sum += hidden[h] * (genome[wi++] ?? 0);
      outputs[o] = sum + (genome[wi++] ?? 0);
    }

    let bestDir = 0;
    for (let o = 1; o < V22_OUTPUTS; o++) {
      if (outputs[o] > outputs[bestDir]) bestDir = o;
    }

    // Retain the existing anti-vibration safety rails. Hunger is information for the
    // evolved brain; it does not forcibly steer the mouse toward cheese.
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

  randomGenome = v22RandomGenome;
  breedGenome = v22BreedGenome;
  brainInputs = v22BrainInputs;
  decideMove = v22DecideMove;

  const previousComputeFitnessV22 = computeFitness;
  computeFitness = function (mouse) {
    v22InitEnergy(mouse);
    const base = previousComputeFitnessV22(mouse);
    const hungerPenalty = mouse.deathReason === 'hunger' ? V22_HUNGER_DEATH_PENALTY : 0;
    const score = base - hungerPenalty;
    mouse.fitness = score;
    return score;
  };

  const previousTickMouseV22 = tickMouse;
  tickMouse = function (mouse) {
    if (!mouse.alive) return;
    v22InitEnergy(mouse);

    const beforeX = mouse.x;
    const beforeY = mouse.y;
    const beforeWallHits = mouse.wallHits || 0;
    const beforeCheese = mouse.cheeseCount || 0;

    previousTickMouseV22(mouse);

    // Other terminal outcomes win: reaching the goal, danger, timeout, wall death
    // or a stagnation audit should not be overwritten by hunger after the fact.
    if (!mouse.alive || mouse.reachedGoal) return;

    const moved = mouse.x !== beforeX || mouse.y !== beforeY;
    const hitWall = (mouse.wallHits || 0) > beforeWallHits;
    const foundCheese = (mouse.cheeseCount || 0) > beforeCheese;

    // Every attempted action costs metabolism. Bashing a wall costs extra, so a mouse
    // cannot conserve energy by repeatedly choosing an impossible move.
    const cost = hitWall ? V22_WALL_COST : V22_MOVE_COST;
    mouse.energy = Math.max(0, mouse.energy - cost);

    if (foundCheese) {
      mouse.energy = Math.min(
        mouse.maxEnergy,
        mouse.energy + mouse.maxEnergy * V22_CHEESE_REFILL_FRACTION
      );
    }

    if (mouse.energy <= 0) {
      killMouse(mouse, 'hunger');
      return;
    }

    computeFitness(mouse);
    recordMilestones(mouse);
  };

  // Testing HUD: show the followed mouse's remaining energy. This is deliberately
  // not a score; it is just visibility into the internal state driving its decisions.
  const simControls = document.querySelector('.simControls');
  let energyStat = document.getElementById('energyStat');
  if (simControls && !energyStat) {
    const chip = document.createElement('div');
    chip.className = 'statChip';
    chip.innerHTML = '<span>Energy</span><strong id="energyStat">—</strong>';
    simControls.appendChild(chip);
    energyStat = chip.querySelector('#energyStat');
  }

  const previousUpdateStatsV22 = updateStats;
  updateStats = function () {
    previousUpdateStatsV22();
    if (!energyStat || state.mode !== 'sim') return;

    let tracked = state.mice.find(mouse => mouse.id === state.trackedMouseId) || null;
    if (!tracked) tracked = state.mice.find(mouse => mouse.alive) || null;

    if (!tracked) {
      energyStat.textContent = '—';
      energyStat.title = '';
      return;
    }

    v22InitEnergy(tracked);
    const percent = Math.max(0, Math.min(100, Math.round(tracked.energy / tracked.maxEnergy * 100)));
    energyStat.textContent = `${percent}%`;
    energyStat.title = `Followed mouse: ${Math.round(tracked.energy)}/${Math.round(tracked.maxEnergy)} energy`;
  };

  state.balanceV22 = {
    startEnergyFactor: V22_START_ENERGY_FACTOR,
    minStartEnergy: V22_MIN_START_ENERGY,
    cheeseRefillFraction: V22_CHEESE_REFILL_FRACTION,
    moveCost: V22_MOVE_COST,
    wallCost: V22_WALL_COST,
    hungerDeathPenalty: V22_HUNGER_DEATH_PENALTY,
    brainInputs: V22_INPUTS,
    brainWeights: V22_WEIGHTS
  };
})();
