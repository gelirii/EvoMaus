  function chooseTrackedMouse() {
    let tracked = state.mice.find(m => m.id === state.trackedMouseId);
    if (tracked && tracked.alive) return tracked;
    const alive = state.mice.filter(m => m.alive);
    if (!alive.length) return tracked || null;
    alive.sort((a, b) => computeFitness(b) - computeFitness(a));
    tracked = alive[0];
    state.trackedMouseId = tracked.id;
    return tracked;
  }

  function generationFinished() {
    return state.mice.length > 0 && state.mice.every(m => !m.alive);
  }

  function selectParent(pool) {
    // Rank-weighted selection: the best mouse is much more likely, but diversity survives.
    const total = pool.length * (pool.length + 1) / 2;
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      const weight = pool.length - i;
      r -= weight;
      if (r <= 0) return pool[i];
    }
    return pool[0];
  }

  function breedGenome(a, b, mutationRate) {
    const length = state.maxSteps;
    const child = new Uint8Array(length);
    const split1 = Math.floor(Math.random() * length);
    const split2 = split1 + Math.floor(Math.random() * Math.max(1, length - split1));
    let mutationCount = 0;

    for (let i = 0; i < length; i++) {
      let gene = (i >= split1 && i < split2) ? b.genome[i] : a.genome[i];
      if (Math.random() < mutationRate) {
        const old = gene;
        do { gene = Math.floor(Math.random() * 4); } while (gene === old && Math.random() < .8);
        mutationCount++;
      }
      child[i] = gene;
    }
    return { genome: child, mutationCount };
  }

  function beginNextGeneration() {
    const ranked = [...state.mice].sort((a, b) => computeFitness(b) - computeFitness(a));
    const champion = ranked[0];
    if (!champion) return;

    const championProgress = progressOf(champion);
    if (championProgress <= state.lastBestProgress + 0.001) state.stagnation++;
    else {
      state.stagnation = 0;
      state.lastBestProgress = championProgress;
    }

    if (!state.bestEver || champion.fitness > state.bestEver.fitness) {
      state.bestEver = {
        fitness: champion.fitness,
        progress: championProgress,
        generation: state.generation,
        reachedGoal: champion.reachedGoal,
        cheeseCount: champion.cheeseCount,
        wallHits: champion.wallHits,
        steps: champion.step
      };
    }

    const poolSize = Math.max(2, Math.ceil(ranked.length * 0.2));
    const pool = ranked.slice(0, poolSize);
    const immigrantCount = Math.max(1, Math.round(state.populationSize * 0.05));
    const eliteCount = Math.min(3, Math.max(1, Math.round(state.populationSize * 0.02)));
    const mutationRate = Math.min(0.10, 0.024 + Math.max(0, state.stagnation - 3) * 0.008);
    const next = [];
    const nextGeneration = state.generation + 1;

    // Preserve a tiny elite set exactly. Mouse #1 is the previous champion's direct clone.
    for (let i = 0; i < eliteCount && i < ranked.length; i++) {
      next.push(makeMouse(ranked[i].genome.slice(), nextGeneration, [ranked[i].id]));
    }

    // Fresh random mice keep the gene pool from collapsing into one mediocre lineage.
    for (let i = 0; i < immigrantCount && next.length < state.populationSize; i++) {
      next.push(makeMouse(randomGenome(state.maxSteps), nextGeneration));
    }

    while (next.length < state.populationSize) {
      const a = selectParent(pool);
      const b = selectParent(pool);
      const bred = breedGenome(a, b, mutationRate);
      const child = makeMouse(bred.genome, nextGeneration, [a.id, b.id]);
      child.mutations = bred.mutationCount;
      next.push(child);
    }

    state.generation = nextGeneration;
    state.mice = next;
    state.trackedMouseId = state.mice[0].id;
    state.generationCooldown = 0;
    updateStats();
  }

  function simulationTick() {
    if (state.mode !== 'sim' || state.paused) return;
    for (const mouse of state.mice) tickMouse(mouse);

    if (generationFinished()) {
      state.generationCooldown += 1;
      if (state.generationCooldown >= 5) beginNextGeneration();
    }
  }

  function startEvolution() {
    if (!state.goal) {
      showToast('Place one green goal before starting.', 'bad');
      return;
    }
    if (state.start.x === state.goal.x && state.start.y === state.goal.y) {
      showToast('Move the start mouse away from the goal first.', 'bad');
      return;
    }

    state.distanceMap = buildDistanceMap();
    const startDist = state.distanceMap[indexFor(state.start.x, state.start.y)];
    if (startDist < 0) {
      showToast('There is no safe route from the mouse to the goal. Open the maze or move the danger tiles.', 'bad');
      return;
    }

    state.startDistance = startDist;
    state.maxSteps = Math.max(180, Math.min(1800, startDist * 5 + 140));
    state.mode = 'sim';
    state.paused = false;
    pauseButton.textContent = 'Pause';
    document.body.classList.add('simulating');
    initialiseGenerationOne();
    state.view.scale = Math.max(23, Math.min(42, state.view.scale));
    centreOnStart();
    state.tickAccumulator = 0;
    state.lastFrameTime = performance.now();
    showToast(`Generation 1: ${state.populationSize} mice, absolutely no clue what they're doing.`);
  }

  function editMaze() {
    state.mode = 'edit';
    state.paused = false;
    state.mice = [];
    document.body.classList.remove('simulating');
    centreOnStart();
    showToast('Evolution stopped. Maze editor restored.');
  }

  function resetEvolution() {
    if (state.mode !== 'sim') return;
    initialiseGenerationOne();
    state.paused = false;
    pauseButton.textContent = 'Pause';
    centreOnStart();
    showToast('Back to Generation 1. Ancestral wisdom deleted.');
  }

  startButton.addEventListener('click', startEvolution);
  editButton.addEventListener('click', editMaze);
  resetEvolutionButton.addEventListener('click', resetEvolution);
  pauseButton.addEventListener('click', () => {
    state.paused = !state.paused;
    pauseButton.textContent = state.paused ? 'Resume' : 'Pause';
  });
  speedButton.addEventListener('click', () => {
    state.speedIndex = (state.speedIndex + 1) % state.speeds.length;
    speedButton.textContent = `${state.speeds[state.speedIndex]}×`;
  });

  function updateStats() {
    if (state.mode !== 'sim') return;
    const alive = state.mice.filter(m => m.alive).length;
    const ranked = [...state.mice].sort((a, b) => computeFitness(b) - computeFitness(a));
    const best = ranked[0];
    genStat.textContent = String(state.generation);
    aliveStat.textContent = `${alive}/${state.populationSize}`;
    progressStat.textContent = `${Math.round(progressOf(best) * 100)}%`;
    cheeseStat.textContent = String(best?.cheeseCount ?? 0);
    wallStat.textContent = String(best?.wallHits ?? 0);
  }
