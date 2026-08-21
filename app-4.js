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
    const child = new Float32Array(BRAIN_WEIGHTS);
    let mutationCount = 0;

    for (let i = 0; i < child.length; i++) {
      let gene = Math.random() < 0.5 ? a.genome[i] : b.genome[i];
      if (Math.random() < mutationRate) {
        mutationCount++;
        if (Math.random() < 0.035) {
          gene = (Math.random() * 2 - 1) * 1.2;
        } else {
          gene += (Math.random() + Math.random() - 1) * 0.55;
        }
      }
      child[i] = Math.max(-4, Math.min(4, gene));
    }
    return { genome: child, mutationCount };
  }

  function beginNextGeneration() {
    const ranked = [...state.mice].sort((a, b) => computeFitness(b) - computeFitness(a));
    const champion = ranked[0];
    if (!champion) return;

    const championProgress = progressOf(champion);
    const evolutionMetric = champion.reachedGoal
      ? 1 + Math.max(0, state.maxSteps - champion.step) / Math.max(1, state.maxSteps)
      : championProgress;

    if (evolutionMetric <= state.lastBestProgress + 0.0005) state.stagnation++;
    else {
      state.stagnation = 0;
      state.lastBestProgress = evolutionMetric;
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
    const eliteCount = Math.min(4, Math.max(1, Math.round(state.populationSize * 0.02)));
    const mutationRate = Math.min(0.12, 0.028 + Math.max(0, state.stagnation - 3) * 0.006);
    const next = [];
    const nextGeneration = state.generation + 1;

    // Keep a few proven brains intact.
    for (let i = 0; i < eliteCount && i < ranked.length; i++) {
      next.push(makeMouse(ranked[i].genome.slice(), nextGeneration, [ranked[i].id]));
    }

    // A small immigrant population prevents one mediocre idea taking over forever.
    for (let i = 0; i < immigrantCount && next.length < state.populationSize; i++) {
      next.push(makeMouse(randomGenome(), nextGeneration));
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
    state.maxSteps = Math.max(220, Math.min(2200, startDist * 6 + 160));
    return true;
  }

  function currentMazeSignature() {
    const goal = state.goal ? `${state.goal.x},${state.goal.y}` : 'none';
    const cells = [...state.cells.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return `${state.start.x},${state.start.y}|${goal}|${cells.map(([key, type]) => `${key}:${type}`).join(';')}`;
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

    const mazeChanged = suspended.mazeSignature !== currentMazeSignature();
    state.generation = suspended.generation;
    state.populationSize = suspended.mice.length;
    populationInput.value = String(state.populationSize);
    populationValue.textContent = String(state.populationSize);

    state.mice = suspended.mice.map(saved => {
      const mouse = makeMouse(saved.genome.slice(), state.generation, saved.parentIds);
      mouse.mutations = saved.mutations;
      return mouse;
    });

    if (mazeChanged) {
      // Same evolved brains, new challenge: old progress/time is no longer comparable.
      state.allTimeBestProgress = 0;
      state.bestTime = null;
      state.bestEver = null;
      state.lastBestProgress = -1;
      state.stagnation = 0;
      state.firstGoalGeneration = null;
    }

    state.trackedMouseId = state.mice[0]?.id ?? null;
    state.generationCooldown = 0;
    state.suspendedRun = null;
    enterSimulationUi();
    updateStats();
    showToast(`Gen ${state.generation} restarted with the same evolved brains${mazeChanged ? ' on the edited maze' : ''}.`);
  }

  function startEvolution() {
    if (!prepareMazeForRun()) return;

    if (state.suspendedRun) {
      resumeEditedGeneration();
      return;
    }

    enterSimulationUi();
    initialiseGenerationOne();
    showToast(`Gen 1: ${state.populationSize} mice with random tiny brains. Expect nonsense.`);
  }

  function editMaze() {
    if (state.mode !== 'sim') return;

    state.suspendedRun = {
      generation: state.generation,
      mazeSignature: currentMazeSignature(),
      mice: state.mice.map(mouse => ({
        genome: mouse.genome.slice(),
        parentIds: [...mouse.parentIds],
        mutations: mouse.mutations
      }))
    };

    state.mode = 'edit';
    state.paused = false;
    state.mice = [];
    populationInput.disabled = true;
    startButton.textContent = `▶ Resume G${state.generation}`;
    document.body.classList.remove('simulating', 'paused');
    document.body.classList.add('editing-run');
    pauseButton.textContent = '⏸ Pause';
    centreOnStart();
    showToast(`Editing Gen ${state.generation}. Resume reruns these same evolved brains.`);
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
    state.allTimeBestProgress = 0;
    state.bestTime = null;
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
    progressLabel.textContent = 'Best Progress';
    progressStat.textContent = '0%';
    document.body.classList.remove('simulating', 'paused', 'editing-run');
    centreOnStart();
    showToast('Evolution stopped. The maze stays; next Start begins again at Gen 1.');
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

    if (state.bestTime !== null) {
      progressLabel.textContent = 'Best Time';
      progressStat.textContent = `${state.bestTime} steps`;
    } else {
      progressLabel.textContent = 'Best Progress';
      progressStat.textContent = `${Math.round(state.allTimeBestProgress * 100)}%`;
    }

    cheeseStat.textContent = String(best?.cheeseCount ?? 0);
  }
