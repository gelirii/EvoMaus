// EvoMaus v1.3 Algernon lifecycle safety patch.
// Generation summaries in app-18 advance through an older captured generation function,
// bypassing later wrappers. Ensure every post-Gen-1 simulation generation still gets
// exactly one Hall-of-Fame Algernon before play continues.
(() => {
  const ALGERNON = 'algernon';

  const lineageOf = mouse => mouse?.lineage || 'grey';

  function ensureRecord() {
    if (!state.v13CurrentMazeRecords) state.v13CurrentMazeRecords = {};
    if (!state.v13CurrentMazeRecords[ALGERNON]) {
      state.v13CurrentMazeRecords[ALGERNON] = {
        bestProgress: 0,
        firstSolveGeneration: null,
        bestTime: null,
        maxCheese: 0,
        championTrail: null,
        championMouseId: null,
        championGeneration: null
      };
    }
  }

  function weightedParentPool() {
    const bank = state.v137AlgernonBank;
    if (!bank) return [];
    const weighted = new Map();
    const add = (entry, weight) => {
      if (!entry?.genome) return;
      const key = entry.key || `${entry.generation || 0}:${entry.sourceId ?? Math.random()}`;
      const existing = weighted.get(key);
      if (existing) existing.weight += weight;
      else weighted.set(key, { entry, weight });
    };

    Object.values(bank.firstByMaze || {}).forEach(entry => add(entry, 5));
    Object.values(bank.fastestByMaze || {}).forEach(entry => add(entry, 5));
    Object.values(bank.bestProgressByMaze || {}).forEach(entry => add(entry, 3));
    (bank.recentSolvers || []).forEach(entry => add(entry, 2));
    (bank.successfulAlgernons || []).forEach(entry => add(entry, 4));
    return [...weighted.values()];
  }

  function weightedSample(pool, count) {
    const working = pool.slice();
    const chosen = [];
    while (working.length && chosen.length < count) {
      const total = working.reduce((sum, item) => sum + item.weight, 0);
      let r = Math.random() * Math.max(total, 1e-9);
      let index = 0;
      for (; index < working.length; index++) {
        r -= working[index].weight;
        if (r <= 0) break;
      }
      chosen.push(working.splice(Math.min(index, working.length - 1), 1)[0].entry);
    }
    return chosen;
  }

  function cloneFallback(mouse) {
    if (!mouse?.genome) return null;
    return {
      key: `fallback:${mouse.generation || state.generation}:${mouse.id}`,
      sourceId: mouse.id,
      generation: mouse.generation || state.generation,
      lineage: lineageOf(mouse),
      maze: state.v13MazeId || 1,
      role: 'fallback-champion',
      step: mouse.step || 0,
      progress: progressOf(mouse),
      cheese: mouse.cheeseCount || 0,
      genome: mouse.genome.slice()
    };
  }

  function breedFromBank(fallbackBest) {
    let pool = weightedParentPool();
    if (!pool.length) {
      const fallback = cloneFallback(fallbackBest);
      if (fallback) pool = [{ entry: fallback, weight: 1 }];
    }
    if (!pool.length) return { genome: randomGenome(), parents: [] };

    const parents = weightedSample(pool, Math.min(5, pool.length));
    if (parents.length === 1) {
      const genome = parents[0].genome.slice();
      for (let i = 0; i < genome.length; i++) {
        if (Math.random() < 0.012) {
          genome[i] = Math.max(-4, Math.min(4,
            genome[i] + (Math.random() + Math.random() - 1) * 0.24));
        }
      }
      return { genome, parents };
    }

    const length = parents[0].genome.length;
    const genome = new Float32Array(length);
    const blocks = Math.min(12, Math.max(5, parents.length * 2));
    const blockSize = Math.max(1, Math.ceil(length / blocks));

    for (let block = 0; block < blocks; block++) {
      const parent = parents[Math.floor(Math.random() * parents.length)];
      const start = block * blockSize;
      const end = Math.min(length, start + blockSize);
      for (let i = start; i < end; i++) genome[i] = parent.genome[i];
    }

    for (let i = 0; i < genome.length; i++) {
      if (Math.random() < 0.012) {
        if (Math.random() < 0.01) genome[i] = (Math.random() * 2 - 1) * 1.2;
        else genome[i] += (Math.random() + Math.random() - 1) * 0.24;
        genome[i] = Math.max(-4, Math.min(4, genome[i]));
      }
    }
    return { genome, parents };
  }

  function bestNaturalMouse() {
    let best = null;
    for (const mouse of state.mice) {
      if (lineageOf(mouse) === ALGERNON || !mouse?.genome) continue;
      if (!best || computeFitness(mouse) > computeFitness(best)) best = mouse;
    }
    return best;
  }

  function spawnMissingAlgernon() {
    if (state.mode !== 'sim' || state.generation < 2 || !state.mice.length) return null;
    if (state.mice.some(mouse => lineageOf(mouse) === ALGERNON)) return null;

    ensureRecord();
    const bred = breedFromBank(bestNaturalMouse());
    const parentIds = bred.parents.map(parent => parent.sourceId).filter(Number.isFinite);
    const mouse = makeMouse(bred.genome, state.generation, parentIds, ALGERNON);
    mouse.v137Algernon = true;
    mouse.v137ParentArchive = bred.parents.map(parent => ({
      lineage: parent.lineage,
      generation: parent.generation,
      maze: parent.maze,
      role: parent.role
    }));
    state.mice.push(mouse);

    // If the user had explicitly selected Algernon, keep that intention alive.
    if (state.v136ManualLineage === ALGERNON || state.v133SelectedLineage === ALGERNON) {
      state.trackedMouseId = mouse.id;
      state.v13SelectedMouseId = mouse.id;
      state.v133SelectedLineage = ALGERNON;
      state.v136ManualLineage = ALGERNON;
      state.freeCamera = false;
    }

    return mouse;
  }

  const previousUpdateStatsV138 = updateStats;
  updateStats = function () {
    previousUpdateStatsV138();
    const spawned = spawnMissingAlgernon();
    // app-25's HUD/cards ran before the repair mouse existed. Run that inner updater
    // once more so Algernon appears immediately rather than one frame later.
    if (spawned) previousUpdateStatsV138();
  };

  const previousSimulationTickV138 = simulationTick;
  simulationTick = function () {
    previousSimulationTickV138();
    // Defensive fallback for any other legacy generation path that replaces state.mice
    // without calling the current outer updateStats binding.
    if (spawnMissingAlgernon()) previousUpdateStatsV138();
  };

  document.body.classList.add('v138AlgernonLifecycleFixed');
})();
