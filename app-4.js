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

    for (let i = 0; i < eliteCount && i < ranked.length; i++) {
      next.push(makeMouse(ranked[i].genome.slice(), nextGeneration, [ranked[i].id]));
    }

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

  function prepareMazeForRun() {
    if (!state.goal) {
      showToast('Place one green goal before starting.', 'bad');
      return false;
    }
    if (state.start.x === state.goal.x && state.start.y === state.goal.y) {
      showToast('Move the start mouse away from the goal first.', 'bad');
      return false;
    }

    state.distanceMap = buildDistanceMap();
    const startDist = state.distanceMap[indexFor(state.start.x, state.start.y)];
    if (startDist < 0) {
      showToast('There is no safe route from the mouse to the goal. Open the maze or move the danger tiles.', 'bad');
      return false;
    }

    state.startDistance = startDist;
    state.maxSteps = Math.max(180, Math.min(1800, startDist * 5 + 140));
    return true;
  }

  function fitGenomeToMaze(genome, length) {
    if (genome.length === length) return genome.slice();
    const fitted = new Uint8Array(length);
    const copyLength = Math.min(genome.length, length);
    fitted.set(genome.subarray(0, copyLength));
    for (let i = copyLength; i < length; i++) fitted[i] = Math.floor(Math.random() * 4);
    return fitted;
  }

  function enterSimulationUi() {
    state.mode = 'sim';
    state.paused = false;
    pauseButton.textContent = '⏸ Pause';
    speedButton.textContent = `${state.speeds[state.speedIndex]}× Speed`;
    startButton.textContent = '▶ Start';
    populationInput.disabled = false;
    document.body.classList.add('simulating');
    document.body.classList.remove('paused', 'editing-run');
    state.view.scale = Math.max(23, Math.min(42, state.view.scale));
    centreOnStart();
    state.tickAccumulator = 0;
    state.lastFrameTime = performance.now();
  }

  function resumeEditedGeneration() {
    const suspended = state.suspendedRun;
    if (!suspended) return;

    state.generation = suspended.generation;
    state.populationSize = suspended.mice.length;
    populationInput.value = String(state.populationSize);
    populationValue.textContent = String(state.populationSize);

    state.mice = suspended.mice.map(saved => {
      const mouse = makeMouse(fitGenomeToMaze(saved.genome, state.maxSteps), state.generation, saved.parentIds);
      mouse.mutations = saved.mutations;
      return mouse;
    });

    state.trackedMouseId = state.mice[0]?.id ?? null;
    state.generationCooldown = 0;
    state.suspendedRun = null;
    enterSimulationUi();
    updateStats();
    showToast(`Generation ${state.generation} restarted with the same mice on the edited maze.`);
  }

  function startEvolution() {
    if (!prepareMazeForRun()) return;

    if (state.suspendedRun) {
      resumeEditedGeneration();
      return;
    }

    enterSimulationUi();
    initialiseGenerationOne();
    showToast(`Generation 1: ${state.populationSize} mice, absolutely no clue what they're doing.`);
  }

  function editMaze() {
    if (state.mode !== 'sim') return;

    state.suspendedRun = {
      generation: state.generation,
      mice: state.mice.map(mouse => ({
        genome: mouse.genome.slice(),
        parentIds: [...mouse.parentIds],
        mutations: mouse.mutations
      }))
    };

    // If this generation had just found the goal, editing means this generation
    // must prove itself again on the changed maze.
    if (state.firstGoalGeneration === state.generation) state.firstGoalGeneration = null;

    state.mode = 'edit';
    state.paused = false;
    state.mice = [];
    populationInput.disabled = true;
    startButton.textContent = `▶ Resume G${state.generation}`;
    document.body.classList.remove('simulating', 'paused');
    document.body.classList.add('editing-run');
    pauseButton.textContent = '⏸ Pause';
    centreOnStart();
    showToast(`Editing Generation ${state.generation}. Resume reruns the same genomes from the start.`);
  }

  function stopEvolution() {
    state.mode = 'edit';
    state.paused = false;
    state.mice = [];
    state.suspendedRun = null;
    state.distanceMap = null;
    state.startDistance = 0;
    state.maxSteps = 500;
    state.generation = 1;
    state.generationCooldown = 0;
    state.trackedMouseId = null;
    state.bestEver = null;
    state.stagnation = 0;
    state.lastBestProgress = -1;
    state.firstGoalGeneration = null;
    state.nextMouseId = 1;
    state.speedIndex = 0;
    state.tickAccumulator = 0;

    populationInput.disabled = false;
    startButton.textContent = '▶ Start';
    pauseButton.textContent = '⏸ Pause';
    speedButton.textContent = '1× Speed';
    document.body.classList.remove('simulating', 'paused', 'editing-run');
    centreOnStart();
    showToast('Evolution stopped. The maze stays; next Start begins again at Generation 1.');
  }

  startButton.addEventListener('click', startEvolution);
  editButton.addEventListener('click', editMaze);
  resetEvolutionButton.addEventListener('click', stopEvolution);
  stopEditButton.addEventListener('click', stopEvolution);

  pauseButton.addEventListener('click', () => {
    if (state.mode !== 'sim') return;
    state.paused = !state.paused;
    pauseButton.textContent = state.paused ? '▶ Resume' : '⏸ Pause';
    document.body.classList.toggle('paused', state.paused);
  });

  speedButton.addEventListener('click', () => {
    state.speedIndex = (state.speedIndex + 1) % state.speeds.length;
    speedButton.textContent = `${state.speeds[state.speedIndex]}× Speed`;
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
  }
