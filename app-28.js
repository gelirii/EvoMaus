// EvoMaus v1.3 Algernon genetics lab: elitist base brains, diverse Hall of Fame,
// whole-neuron crossover and generation-end archive safety.
(() => {
  const ALGERNON = 'algernon';
  const NATURAL = ['white', 'grey', 'black'];
  const HIDDEN = 10;
  const OUTPUTS = 4;
  const CANDIDATES = 16;
  const RECENT_CAP = 24;
  const PER_MAZE_LINEAGE_RECENT_CAP = 2;

  const lineageOf = mouse => mouse?.lineage || 'grey';
  const mazeId = () => state.v13MazeId || 1;

  function freshLab() {
    return {
      firstByMaze: {},
      fastestByMaze: {},
      bestProgressByMaze: {},
      bestAlgernonByMaze: {},
      bestSolverByMazeLineage: {},
      recentSolvers: [],
      successfulAlgernons: [],
      archivedGenerationKeys: new Set(),
      latestChampion: null,
      engineeredGeneration: 0,
      candidateAudit: null
    };
  }

  state.v140AlgernonLab = state.v140AlgernonLab || freshLab();

  function lab() {
    if (!state.v140AlgernonLab) state.v140AlgernonLab = freshLab();
    return state.v140AlgernonLab;
  }

  function entryKey(mouse) {
    return `${mazeId()}:${mouse?.generation || state.generation}:${mouse?.id ?? 'x'}`;
  }

  function archiveEntry(mouse, role) {
    if (!mouse?.genome) return null;
    const progress = progressOf(mouse);
    return {
      key: entryKey(mouse),
      sourceId: mouse.id,
      generation: mouse.generation || state.generation,
      lineage: lineageOf(mouse),
      maze: mazeId(),
      role,
      reachedGoal: !!mouse.reachedGoal,
      step: mouse.step || 0,
      progress,
      cheese: mouse.cheeseCount || 0,
      fitness: Number.isFinite(mouse.fitness) ? mouse.fitness : computeFitness(mouse),
      genome: mouse.genome.slice()
    };
  }

  function betterRun(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (!!a.reachedGoal !== !!b.reachedGoal) return b.reachedGoal ? b : a;
    if (a.reachedGoal && b.reachedGoal) {
      if (b.step !== a.step) return b.step < a.step ? b : a;
      return b.fitness > a.fitness ? b : a;
    }
    if (Math.abs((b.progress || 0) - (a.progress || 0)) > 0.00001) {
      return b.progress > a.progress ? b : a;
    }
    return b.fitness > a.fitness ? b : a;
  }

  function pushRecentDiverse(entry) {
    if (!entry) return;
    const store = lab().recentSolvers;
    const sameKey = store.findIndex(item => item.key === entry.key);
    if (sameKey >= 0) store.splice(sameKey, 1);

    const group = `${entry.maze}:${entry.lineage}`;
    const sameGroup = store.filter(item => `${item.maze}:${item.lineage}` === group);
    if (sameGroup.length >= PER_MAZE_LINEAGE_RECENT_CAP) {
      const oldest = store.findIndex(item => `${item.maze}:${item.lineage}` === group);
      if (oldest >= 0) store.splice(oldest, 1);
    }

    store.push(entry);
    while (store.length > RECENT_CAP) store.shift();
  }

  function pushSuccessfulAlgernon(entry) {
    if (!entry) return;
    const store = lab().successfulAlgernons;
    const existing = store.findIndex(item => item.key === entry.key);
    if (existing >= 0) store.splice(existing, 1);
    store.push(entry);
    while (store.length > 16) store.shift();
  }

  function archiveGoal(mouse) {
    if (!mouse?.reachedGoal || !mouse.genome) return;
    const L = lab();
    const id = mazeId();
    const entry = archiveEntry(mouse, 'solver');
    if (!L.firstByMaze[id]) L.firstByMaze[id] = { ...entry, role: 'first-solver' };

    const fastest = L.fastestByMaze[id];
    if (!fastest || entry.step < fastest.step ||
        (entry.step === fastest.step && entry.fitness > fastest.fitness)) {
      L.fastestByMaze[id] = { ...entry, role: 'fastest-solver' };
    }

    if (!L.bestSolverByMazeLineage[id]) L.bestSolverByMazeLineage[id] = {};
    const lineageBest = L.bestSolverByMazeLineage[id][entry.lineage];
    if (!lineageBest || entry.step < lineageBest.step ||
        (entry.step === lineageBest.step && entry.fitness > lineageBest.fitness)) {
      L.bestSolverByMazeLineage[id][entry.lineage] = { ...entry, role: 'lineage-solver' };
    }

    delete L.bestProgressByMaze[id];
    pushRecentDiverse({ ...entry, role: 'recent-solver' });

    if (entry.lineage === ALGERNON) {
      const old = L.bestAlgernonByMaze[id];
      L.bestAlgernonByMaze[id] = betterRun(old, { ...entry, role: 'best-algernon' });
      pushSuccessfulAlgernon({ ...entry, role: 'successful-algernon' });
    }
  }

  function archiveGeneration(mice, generation) {
    if (!Array.isArray(mice) || !mice.length) return;
    const L = lab();
    const key = `${mazeId()}:${generation}`;
    if (L.archivedGenerationKeys.has(key)) return;

    const snapshots = [];
    let champion = null;
    let bestAlgernon = null;

    for (const mouse of mice) {
      if (!mouse?.genome) continue;
      if (mouse.reachedGoal) archiveGoal(mouse);

      const entry = archiveEntry(mouse, lineageOf(mouse) === ALGERNON ? 'algernon-run' : 'generation-run');
      if (!entry) continue;
      snapshots.push(entry);

      if (!champion) champion = entry;
      else champion = betterRun(champion, entry);

      if (lineageOf(mouse) === ALGERNON) {
        bestAlgernon = betterRun(bestAlgernon, { ...entry, role: 'best-algernon' });
      }
    }

    if (!snapshots.length) return;

    const id = mazeId();
    L.latestChampion = champion ? { ...champion, role: 'latest-champion' } : L.latestChampion;

    if (!L.firstByMaze[id] && champion) {
      const previous = L.bestProgressByMaze[id];
      L.bestProgressByMaze[id] = betterRun(previous, { ...champion, role: 'maze-best-progress' });
    }

    if (bestAlgernon) {
      const previous = L.bestAlgernonByMaze[id];
      L.bestAlgernonByMaze[id] = betterRun(previous, bestAlgernon);
      if (bestAlgernon.reachedGoal) pushSuccessfulAlgernon({ ...bestAlgernon, role: 'successful-algernon' });
    }

    L.archivedGenerationKeys.add(key);
  }

  function sourceQuality(entry) {
    if (!entry?.genome) return -Infinity;
    const current = entry.maze === mazeId();
    const role = {
      'best-algernon': 12,
      'fastest-solver': 11,
      'maze-best-progress': 10,
      'first-solver': 9,
      'lineage-solver': 8,
      'successful-algernon': 9,
      'latest-champion': 7,
      'recent-solver': 6,
      'solver': 6
    }[entry.role] || 4;

    let score = role;
    if (current) score += 5;
    if (entry.reachedGoal) score += 3;
    score += Math.max(0, Math.min(1, entry.progress || 0)) * 3;
    if (entry.lineage === ALGERNON) score += 1.5;
    return score;
  }

  function collectSources() {
    const L = lab();
    const id = mazeId();
    const map = new Map();

    function add(entry, bonus = 0) {
      if (!entry?.genome) return;
      const key = entry.key || `${entry.maze}:${entry.generation}:${entry.sourceId}`;
      const score = sourceQuality(entry) + bonus;
      const existing = map.get(key);
      if (!existing || score > existing.score) map.set(key, { entry, score });
    }

    add(L.bestAlgernonByMaze[id], 5);
    add(L.fastestByMaze[id], 5);
    add(L.firstByMaze[id], 3);
    add(L.bestProgressByMaze[id], 5);
    for (const entry of Object.values(L.bestSolverByMazeLineage[id] || {})) add(entry, 3);

    for (const [maze, entry] of Object.entries(L.bestAlgernonByMaze)) if (+maze !== id) add(entry, 2);
    for (const [maze, entry] of Object.entries(L.fastestByMaze)) if (+maze !== id) add(entry, 1.5);
    for (const [maze, entry] of Object.entries(L.firstByMaze)) if (+maze !== id) add(entry, 1);
    for (const [maze, byLineage] of Object.entries(L.bestSolverByMazeLineage)) {
      if (+maze === id) continue;
      for (const entry of Object.values(byLineage || {})) add(entry, 0.5);
    }

    L.recentSolvers.forEach(entry => add(entry, 0));
    L.successfulAlgernons.forEach(entry => add(entry, 2));
    add(L.latestChampion, L.latestChampion?.maze === id ? 3 : 0);

    return [...map.values()].sort((a, b) => b.score - a.score);
  }

  function weightedSource(sources, excludedKey = null) {
    const choices = sources.filter(item => item.entry.key !== excludedKey);
    if (!choices.length) return null;
    const floor = Math.min(...choices.map(item => item.score));
    const weights = choices.map(item => Math.max(0.25, item.score - floor + 1));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let r = Math.random() * total;
    for (let i = 0; i < choices.length; i++) {
      r -= weights[i];
      if (r <= 0) return choices[i];
    }
    return choices[0];
  }

  function layoutFor(genome) {
    const length = genome?.length || 0;
    const inputs = Math.round((length - OUTPUTS * (HIDDEN + 1)) / HIDDEN - 1);
    const expected = (inputs + 1) * HIDDEN + (HIDDEN + 1) * OUTPUTS;
    if (inputs < 1 || expected !== length) return null;
    return {
      inputs,
      hidden: HIDDEN,
      outputs: OUTPUTS,
      incomingStride: inputs + 1,
      outputBase: (inputs + 1) * HIDDEN,
      outputStride: HIDDEN + 1
    };
  }

  function transplantHiddenNeuron(target, donor, targetH, donorH) {
    const layout = layoutFor(target);
    if (!layout || donor?.length !== target.length) return false;

    const targetIncoming = targetH * layout.incomingStride;
    const donorIncoming = donorH * layout.incomingStride;
    for (let i = 0; i < layout.incomingStride; i++) {
      target[targetIncoming + i] = donor[donorIncoming + i];
    }

    for (let o = 0; o < layout.outputs; o++) {
      const targetOut = layout.outputBase + o * layout.outputStride + targetH;
      const donorOut = layout.outputBase + o * layout.outputStride + donorH;
      target[targetOut] = donor[donorOut];
    }
    return true;
  }

  function gentleMutation(genome, rate) {
    let count = 0;
    for (let i = 0; i < genome.length; i++) {
      if (Math.random() >= rate) continue;
      count++;
      if (Math.random() < 0.004) genome[i] = (Math.random() * 2 - 1) * 1.0;
      else genome[i] += (Math.random() + Math.random() - 1) * 0.16;
      genome[i] = Math.max(-4, Math.min(4, genome[i]));
    }
    return count;
  }

  function makeCandidate(sources, index) {
    const best = sources[0];
    if (!best) return null;

    if (index === 0) {
      return {
        genome: best.entry.genome.slice(),
        base: best,
        donors: [],
        transplants: 0,
        mutations: 0,
        score: best.score + 0.25,
        mode: 'elite-clone'
      };
    }

    const base = weightedSource(sources) || best;
    const genome = base.entry.genome.slice();
    const donors = [];
    const r = Math.random();
    const transplantCount = r < 0.60 ? 0 : r < 0.92 ? 1 : 2;

    for (let n = 0; n < transplantCount; n++) {
      const donor = weightedSource(sources, base.entry.key);
      if (!donor) break;
      const targetH = Math.floor(Math.random() * HIDDEN);
      const donorH = Math.floor(Math.random() * HIDDEN);
      if (transplantHiddenNeuron(genome, donor.entry.genome, targetH, donorH)) {
        donors.push(donor);
      }
    }

    const mutationRate = donors.length ? 0.0035 : 0.0055;
    const mutations = gentleMutation(genome, mutationRate);
    const donorQuality = donors.length
      ? donors.reduce((sum, donor) => sum + donor.score, 0) / donors.length
      : 0;

    const score =
      base.score +
      donorQuality * 0.16 +
      (donors.length ? 0.45 : 0.20) -
      Math.max(0, donors.length - 1) * 0.35 -
      mutations * 0.004 +
      Math.random() * 0.55;

    return {
      genome,
      base,
      donors,
      transplants: donors.length,
      mutations,
      score,
      mode: donors.length ? 'neuron-graft' : 'conservative-mutation'
    };
  }

  function engineerGenome(existingAlgernon = null) {
    let sources = collectSources();

    if (!sources.length && existingAlgernon?.genome) {
      const fallback = archiveEntry(existingAlgernon, 'algernon-fallback');
      sources = [{ entry: fallback, score: 1 };
    }
    if (!sources.length) return null;

    const candidates = [];
    for (let i = 0; i < CANDIDATES; i++) {
      const candidate = makeCandidate(sources, i);
      if (candidate) candidates.push(candidate);
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];

    lab().candidateAudit = {
      generation: state.generation,
      maze: mazeId(),
      candidates: candidates.length,
      mode: winner.mode,
      base: {
        lineage: winner.base.entry.lineage,
        generation: winner.base.entry.generation,
        maze: winner.base.entry.maze,
        role: winner.base.entry.role
      },
      donors: winner.donors.map(donor => ({
        lineage: donor.entry.lineage,
        generation: donor.entry.generation,
        maze: donor.entry.maze,
        role: donor.entry.role
      })),
      transplants: winner.transplants,
      mutations: winner.mutations,
      score: winner.score
    };

    return winner;
  }

  function currentAlgernon() {
    return state.mice.find(mouse => lineageOf(mouse) === ALGERNON) || null;
  }

  function engineerCurrentGeneration() {
    const L = lab();
    if (state.mode !== 'sim' || state.generation < 2 || !state.mice.length) return;
    if (L.engineeredGeneration === state.generation) return;

    const existing = currentAlgernon();
    const engineered = engineerGenome(existing);
    if (!engineered) {
      if (existing) L.engineeredGeneration = state.generation;
      return;
    }

    const oldIds = new Set(state.mice.filter(mouse => lineageOf(mouse) === ALGERNON).map(mouse => mouse.id));
    const wasTracked = oldIds.has(state.trackedMouseId) ||
      state.v136ManualLineage === ALGERNON ||
      state.v133SelectedLineage === ALGERNON;

    state.mice = state.mice.filter(mouse => lineageOf(mouse) !== ALGERNON);

    const parentEntries = [engineered.base.entry, ...engineered.donors.map(donor => donor.entry)];
    const parentIds = [...new Set(parentEntries.map(entry => entry.sourceId).filter(Number.isFinite))];
    const mouse = makeMouse(engineered.genome, state.generation, parentIds, ALGERNON);
    mouse.v137Algernon = true;
    mouse.v140Engineered = true;
    mouse.v137ParentArchive = parentEntries.map(entry => ({
      lineage: entry.lineage,
      generation: entry.generation,
      maze: entry.maze,
      role: entry.role
    }));
    mouse.v140Lab = {
      candidates: CANDIDATES,
      mode: engineered.mode,
      transplants: engineered.transplants,
      mutations: engineered.mutations
    };
    state.mice.push(mouse);

    if (wasTracked) {
      state.trackedMouseId = mouse.id;
      state.v13SelectedMouseId = mouse.id;
      state.v133SelectedLineage = ALGERNON;
      state.v136ManualLineage = ALGERNON;
      state.freeCamera = false;
    }

    L.engineeredGeneration = state.generation;
  }

  function archiveIfFinished() {
    if (state.mode !== 'sim' || !state.mice.length) return;
    if (generationFinished()) archiveGeneration(state.mice.slice(), state.generation);
  }

  const previousTickMouseV140 = tickMouse;
  tickMouse = function (mouse) {
    const wasGoal = !!mouse?.reachedGoal;
    const result = previousTickMouseV140(mouse);
    if (!wasGoal && mouse?.reachedGoal) archiveGoal(mouse);
    return result;
  };

  const previousSimulationTickV140 = simulationTick;
  simulationTick = function () {
    archiveIfFinished();
    const beforeGeneration = state.generation;
    const result = previousSimulationTickV140();
    if (state.generation === beforeGeneration) archiveIfFinished();
    else engineerCurrentGeneration();
    return result;
  };

  const previousUpdateStatsV140 = updateStats;
  updateStats = function () {
    previousUpdateStatsV140();
    archiveIfFinished();
    engineerCurrentGeneration();
  };

  const previousInitialiseGenerationOneV140 = initialiseGenerationOne;
  initialiseGenerationOne = function () {
    state.v140AlgernonLab = freshLab();
    const result = previousInitialiseGenerationOneV140();
    if (currentAlgernon()) state.v140AlgernonLab.engineeredGeneration = 1;
    return result;
  };

  window.EvoMausAlgernon = {
    audit() {
      const L = lab();
      return {
        maze: mazeId(),
        generation: state.generation,
        engineeredGeneration: L.engineeredGeneration,
        candidateAudit: L.candidateAudit,
        firstMazes: Object.keys(L.firstByMaze).length,
        fastestMazes: Object.keys(L.fastestByMaze).length,
        algernonEliteMazes: Object.keys(L.bestAlgernonByMaze).length,
        recentSolvers: L.recentSolvers.length,
        successfulAlgernons: L.successfulAlgernons.length
      };
    }
  };

  document.body.classList.add('v140AlgernonGenetics');
})();
