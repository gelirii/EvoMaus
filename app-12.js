  // EvoMaus v1.1 relative selection pass: compare each mouse with peers in its own lineage.
  (() => {
    const V17_LINEAGES = ['grey', 'white', 'black'];
    const V17_PROGRESS_EPSILON = 0.005;
    const V17_MIN_BREEDING_WEIGHT = 0.02;
    const V17_MAX_BREEDING_WEIGHT = 2.25;

    function v17Metrics(mouse) {
      return {
        mouse,
        goal: mouse.reachedGoal ? 1 : 0,
        progress: progressOf(mouse),
        cheese: mouse.cheeseCount || 0,
        steps: Math.max(1, mouse.step || 1)
      };
    }

    function v17Dominates(a, b) {
      // Pareto-style comparison: a must be no worse on every outcome and use
      // no more steps. Trade-offs are deliberately preserved: more cheese but
      // less progress, for example, is a different tactic rather than "worse".
      const noWorseGoal = a.goal >= b.goal;
      const noWorseProgress = a.progress + V17_PROGRESS_EPSILON >= b.progress;
      const noWorseCheese = a.cheese >= b.cheese;
      const noMoreSteps = a.steps <= b.steps;

      if (!noWorseGoal || !noWorseProgress || !noWorseCheese || !noMoreSteps) return false;

      const clearlyBetter =
        a.goal > b.goal ||
        a.progress > b.progress + V17_PROGRESS_EPSILON ||
        a.cheese > b.cheese ||
        a.steps < b.steps * 0.98;

      return clearlyBetter;
    }

    function v17AnnotateLineage(lineage) {
      const group = state.mice
        .filter(mouse => (mouse.lineage || 'grey') === lineage)
        .map(v17Metrics);

      if (!group.length) return { count: 0, stronglyDominated: 0, meanWeight: 1 };

      const dominatesCounts = new Map(group.map(entry => [entry.mouse.id, 0]));
      const dominatorsByMouse = new Map(group.map(entry => [entry.mouse.id, []]));

      for (let i = 0; i < group.length; i++) {
        for (let j = 0; j < group.length; j++) {
          if (i === j) continue;
          const a = group[i];
          const b = group[j];
          if (!v17Dominates(a, b)) continue;
          dominatesCounts.set(a.mouse.id, (dominatesCounts.get(a.mouse.id) || 0) + 1);
          dominatorsByMouse.get(b.mouse.id).push(a);
        }
      }

      let totalWeight = 0;
      let stronglyDominated = 0;

      for (const entry of group) {
        const dominators = dominatorsByMouse.get(entry.mouse.id) || [];
        const dominatesCount = dominatesCounts.get(entry.mouse.id) || 0;
        let suppression = 1;
        let stepRatio = 1;

        if (dominators.length) {
          const bestEfficientPeer = dominators.reduce((best, peer) =>
            !best || peer.steps < best.steps ? peer : best, null);

          stepRatio = entry.steps / Math.max(1, bestEfficientPeer.steps);

          // Efficiency matters only when another mouse has already demonstrated
          // equal-or-better results. A 50x slower dominated mouse falls to roughly
          // five percent of ordinary breeding influence, without ever reaching zero.
          suppression = Math.pow(Math.max(1, stepRatio), -0.75);
          suppression /= 1 + Math.max(0, dominators.length - 1) * 0.18;
          suppression = Math.max(V17_MIN_BREEDING_WEIGHT, Math.min(1, suppression));

          if (stepRatio >= 5) stronglyDominated++;
        }

        // Efficient mice that dominate several peers receive a modest extra say.
        // This is capped so a single lucky mouse cannot erase lineage diversity.
        const competenceBoost = 1 + Math.min(1.25, Math.log2(1 + dominatesCount) * 0.22);
        const weight = Math.max(
          V17_MIN_BREEDING_WEIGHT,
          Math.min(V17_MAX_BREEDING_WEIGHT, suppression * competenceBoost)
        );

        entry.mouse.relativeBreedingWeight = weight;
        entry.mouse.relativeDominatedBy = dominators.length;
        entry.mouse.relativeStepRatio = stepRatio;
        entry.mouse.relativeDominates = dominatesCount;
        totalWeight += weight;
      }

      return {
        count: group.length,
        stronglyDominated,
        meanWeight: totalWeight / group.length
      };
    }

    function v17AnnotateGeneration() {
      const audit = {};
      for (const lineage of V17_LINEAGES) audit[lineage] = v17AnnotateLineage(lineage);
      state.selectionV17 = {
        generation: state.generation,
        lineages: audit
      };
    }

    // Preserve the existing rank-weighted parent lottery, then multiply that rank
    // weight by the mouse's relative competence. The top ~22% breeding pool and
    // mutation system remain unchanged; this only changes how much each qualifying
    // brain is trusted once its generation has actually demonstrated its results.
    selectParent = function (pool) {
      if (!pool?.length) return null;

      let total = 0;
      const weights = new Float64Array(pool.length);
      for (let i = 0; i < pool.length; i++) {
        const rankWeight = pool.length - i;
        const relativeWeight = Number.isFinite(pool[i].relativeBreedingWeight)
          ? pool[i].relativeBreedingWeight
          : 1;
        const weight = rankWeight * relativeWeight;
        weights[i] = weight;
        total += weight;
      }

      if (!(total > 0)) return pool[0];
      let roll = Math.random() * total;
      for (let i = 0; i < pool.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return pool[i];
      }
      return pool[0];
    };

    const previousBeginNextGenerationV17 = beginNextGeneration;
    beginNextGeneration = function () {
      // All mice are dead at this point, so this comparison cannot affect their
      // behaviour or camera tracking. It exists solely for inheritance pressure.
      v17AnnotateGeneration();
      return previousBeginNextGenerationV17();
    };
  })();
