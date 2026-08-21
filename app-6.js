  // EvoMaus v1.1 lineage layer: three equally capable, isolated evolutionary populations.
  (() => {
    const LINEAGES = ['grey', 'white', 'black'];
    const LINEAGE_STYLES = {
      grey: {
        body: '#858c98', ears: '#a7adb6', eyes: '#252a32', nose: '#e4939c', outline: '#626a76'
      },
      white: {
        body: '#f4f1e9', ears: '#ddd8ce', eyes: '#25282d', nose: '#d88994', outline: '#9c9a94'
      },
      black: {
        body: '#22262d', ears: '#3d434d', eyes: '#f2f0e9', nose: '#d88994', outline: '#090b0e'
      }
    };

    const originalMakeMouse = makeMouse;
    const originalDrawMouseSquare = drawMouseSquare;
    const originalUpdateStats = updateStats;

    function freshLineageEvolution() {
      const data = {};
      for (const lineage of LINEAGES) {
        data[lineage] = { stagnation: 0, lastMetric: -1 };
      }
      return data;
    }

    function ensureLineageEvolution() {
      if (!state.lineageEvolution) state.lineageEvolution = freshLineageEvolution();
      return state.lineageEvolution;
    }

    function lineageForIndex(index) {
      return LINEAGES[index % LINEAGES.length];
    }

    function countByLineage(mice = state.mice) {
      const counts = { grey: 0, white: 0, black: 0 };
      for (const mouse of mice) counts[mouse.lineage || 'grey']++;
      return counts;
    }

    // Existing edit/resume code recreates the same brains in the same order. Capture
    // their colour before editing, then feed it back through makeMouse during resume.
    editButton.addEventListener('click', () => {
      if (state.mode !== 'sim') return;
      state._lineagesBeforeEdit = state.mice.map((mouse, i) => mouse.lineage || lineageForIndex(i));
    }, true);

    startButton.addEventListener('click', () => {
      if (!state.suspendedRun || state.mode !== 'edit') return;
      state._resumeLineageQueue = Array.isArray(state._lineagesBeforeEdit)
        ? state._lineagesBeforeEdit.slice()
        : [];

      if (state.suspendedRun.mazeSignature !== currentMazeSignature()) {
        state.lineageEvolution = freshLineageEvolution();
      }
    }, true);

    function clearLineageEditState() {
      state._lineagesBeforeEdit = null;
      state._resumeLineageQueue = null;
      state.lineageEvolution = freshLineageEvolution();
    }
    resetEvolutionButton.addEventListener('click', clearLineageEditState);
    stopEditButton.addEventListener('click', clearLineageEditState);

    makeMouse = function (genome, generation, parentIds = [], lineage = null) {
      let resolvedLineage = lineage;
      if (!resolvedLineage && state.suspendedRun && state.mode === 'edit' && state._resumeLineageQueue?.length) {
        resolvedLineage = state._resumeLineageQueue.shift();
      }
      const mouse = originalMakeMouse(genome, generation, parentIds);
      mouse.lineage = resolvedLineage || 'grey';
      return mouse;
    };

    initialiseGenerationOne = function () {
      state.generation = 1;
      state.nextMouseId = 1;
      state.lineageEvolution = freshLineageEvolution();
      state.mice = [];

      // Round-robin allocation keeps the slider as a simple total population while
      // splitting it as evenly as possible: e.g. 80 => 27 grey, 27 white, 26 black.
      for (let i = 0; i < state.populationSize; i++) {
        state.mice.push(makeMouse(randomGenome(), 1, [], lineageForIndex(i)));
      }

      state.trackedMouseId = state.mice[0]?.id ?? null;
      state.bestEver = null;
      state.allTimeBestProgress = 0;
      state.bestTime = null;
      state.stagnation = 0;
      state.lastBestProgress = -1;
      state.firstGoalGeneration = null;
      state.generationCooldown = 0;
      updateStats();
    };

    function evolveLineage(lineage, nextGeneration) {
      const ranked = state.mice
        .filter(mouse => (mouse.lineage || 'grey') === lineage)
        .sort((a, b) => computeFitness(b) - computeFitness(a));
      if (!ranked.length) return [];

      const champion = ranked[0];
      const lineageState = ensureLineageEvolution()[lineage];
      const championProgress = progressOf(champion);
      const metric = champion.reachedGoal
        ? 1 + Math.max(0, state.maxSteps - champion.step) / Math.max(1, state.maxSteps)
        : championProgress;

      if (metric <= lineageState.lastMetric + 0.0005) lineageState.stagnation++;
      else {
        lineageState.stagnation = 0;
        lineageState.lastMetric = metric;
      }

      const targetCount = ranked.length;
      const poolSize = Math.max(1, Math.ceil(targetCount * 0.22));
      const pool = ranked.slice(0, poolSize);
      const eliteCount = Math.min(2, Math.max(1, Math.round(targetCount * 0.04)));
      const immigrantCount = targetCount >= 8 ? Math.max(1, Math.round(targetCount * 0.05)) : 0;
      const mutationRate = Math.min(0.12, 0.028 + Math.max(0, lineageState.stagnation - 3) * 0.006);
      const next = [];

      for (let i = 0; i < eliteCount && next.length < targetCount; i++) {
        next.push(makeMouse(ranked[i].genome.slice(), nextGeneration, [ranked[i].id], lineage));
      }

      for (let i = 0; i < immigrantCount && next.length < targetCount; i++) {
        next.push(makeMouse(randomGenome(), nextGeneration, [], lineage));
      }

      while (next.length < targetCount) {
        const a = selectParent(pool);
        const b = selectParent(pool);
        const bred = breedGenome(a, b, mutationRate);
        const child = makeMouse(bred.genome, nextGeneration, [a.id, b.id], lineage);
        child.mutations = bred.mutationCount;
        next.push(child);
      }

      return next;
    }

    beginNextGeneration = function () {
      if (!state.mice.length) return;

      const rankedOverall = [...state.mice].sort((a, b) => computeFitness(b) - computeFitness(a));
      const champion = rankedOverall[0];
      if (champion && (!state.bestEver || champion.fitness > state.bestEver.fitness)) {
        state.bestEver = {
          fitness: champion.fitness,
          progress: progressOf(champion),
          generation: state.generation,
          lineage: champion.lineage || 'grey',
          reachedGoal: champion.reachedGoal,
          cheeseCount: champion.cheeseCount,
          wallHits: champion.wallHits,
          steps: champion.step
        };
      }

      const nextGeneration = state.generation + 1;
      const evolved = {};
      for (const lineage of LINEAGES) evolved[lineage] = evolveLineage(lineage, nextGeneration);

      // Interleave colours so no lineage always renders on top when several mice
      // occupy the same square.
      const next = [];
      const longest = Math.max(...LINEAGES.map(lineage => evolved[lineage].length));
      for (let i = 0; i < longest; i++) {
        for (const lineage of LINEAGES) {
          if (evolved[lineage][i]) next.push(evolved[lineage][i]);
        }
      }

      const evolution = ensureLineageEvolution();
      state.stagnation = Math.max(...LINEAGES.map(lineage => evolution[lineage].stagnation));
      state.lastBestProgress = Math.max(...LINEAGES.map(lineage => evolution[lineage].lastMetric));
      state.generation = nextGeneration;
      state.mice = next;
      state.trackedMouseId = state.mice[0]?.id ?? null;
      state.generationCooldown = 0;
      updateStats();
    };

    function drawLineageMouseSquare(wx, wy, scale, alpha, tracked, lineage) {
      const style = LINEAGE_STYLES[lineage] || LINEAGE_STYLES.grey;
      const p = worldToScreen(wx, wy);
      const s = Math.max(6, scale * .56);
      const x = p.x + scale / 2 - s / 2;
      const y = p.y + scale / 2 - s / 2;
      const r = Math.max(2, s * .16);

      ctx.save();
      ctx.globalAlpha = alpha;
      if (tracked) {
        ctx.shadowColor = 'rgba(0,121,255,.52)';
        ctx.shadowBlur = Math.max(5, scale * .30);
      }

      ctx.fillStyle = style.body;
      ctx.strokeStyle = style.outline;
      ctx.lineWidth = Math.max(1, scale * .035);
      roundRect(ctx, x, y, s, s, r);
      ctx.fill();
      ctx.stroke();

      if (s > 8) {
        ctx.fillStyle = style.ears;
        ctx.beginPath();
        ctx.arc(x + s * .21, y + s * .12, s * .16, 0, Math.PI * 2);
        ctx.arc(x + s * .79, y + s * .12, s * .16, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = style.eyes;
        ctx.beginPath();
        ctx.arc(x + s * .31, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
        ctx.arc(x + s * .69, y + s * .43, Math.max(1, s * .06), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = style.nose;
        ctx.beginPath();
        ctx.arc(x + s * .5, y + s * .69, Math.max(1, s * .07), 0, Math.PI * 2);
        ctx.fill();
      }

      if (tracked) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#087dff';
        ctx.lineWidth = Math.max(1.4, scale * .055);
        ctx.strokeRect(x - 2, y - 2, s + 4, s + 4);
      }
      ctx.restore();
    }

    render = function () {
      resizeCanvas();
      const bounds = drawGrid();

      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const type = getCell(x, y);
          if (type) drawCell(x, y, type, bounds.scale);
        }
      }
      drawGoal(bounds.scale);

      if (state.mode === 'edit') {
        originalDrawMouseSquare(state.start.x, state.start.y, bounds.scale, 1, false, true);
        return;
      }

      const tracked = chooseTrackedMouse();
      const trackedId = tracked?.id;
      for (const mouse of state.mice) {
        if (!mouse.alive && !mouse.reachedGoal) continue;
        const isTracked = mouse.id === trackedId;
        drawLineageMouseSquare(
          mouse.renderX,
          mouse.renderY,
          bounds.scale,
          isTracked ? 1 : .38,
          isTracked,
          mouse.lineage || 'grey'
        );
      }
    };

    // Keep the existing compact HUD, but expose the colour split in the Alive value
    // while a run is active: total first, then G/W/B counts in the title tooltip.
    updateStats = function () {
      originalUpdateStats();
      if (state.mode !== 'sim') return;
      const alive = state.mice.filter(mouse => mouse.alive);
      const counts = countByLineage(alive);
      aliveStat.title = `Grey ${counts.grey} · White ${counts.white} · Black ${counts.black}`;
    };

    state.lineageEvolution = freshLineageEvolution();
  })();
