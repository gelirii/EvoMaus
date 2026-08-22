  // EvoMaus v1.1 pacing pass: early generations are short, useful mice earn more life.
  (() => {
    const V19_PHASES = [
      {
        through: 3,
        label: 'sprint',
        baseFraction: 0.12,
        baseMin: 110,
        baseMax: 220,
        productiveFraction: 0.55,
        strikeStale: 65,
        strikePenalty: 12000
      },
      {
        through: 7,
        label: 'short',
        baseFraction: 0.24,
        baseMin: 200,
        baseMax: 480,
        productiveFraction: 0.72,
        strikeStale: 35,
        strikePenalty: 6500
      },
      {
        through: 12,
        label: 'medium',
        baseFraction: 0.42,
        baseMin: 360,
        baseMax: 900,
        productiveFraction: 0.88,
        strikeStale: 15,
        strikePenalty: 2500
      },
      {
        through: Infinity,
        label: 'full',
        baseFraction: 1,
        baseMin: 0,
        baseMax: Infinity,
        productiveFraction: 1,
        strikeStale: 0,
        strikePenalty: 0
      }
    ];

    function v19Phase(generation = state.generation) {
      return V19_PHASES.find(phase => generation <= phase.through) || V19_PHASES[V19_PHASES.length - 1];
    }

    function v19Initialise(mouse) {
      if (!Number.isFinite(mouse.generationPaceShaping)) mouse.generationPaceShaping = 0;
      if (!Number.isFinite(mouse.pacingLastStrikeCount)) {
        mouse.pacingLastStrikeCount = mouse.productivityAudit?.totalStrikes || 0;
      }
      return mouse;
    }

    const previousMakeMouseV19 = makeMouse;
    makeMouse = function (genome, generation, parentIds = [], lineage = null) {
      return v19Initialise(previousMakeMouseV19(genome, generation, parentIds, lineage));
    };

    const previousComputeFitnessV19 = computeFitness;
    computeFitness = function (mouse) {
      v19Initialise(mouse);
      const base = previousComputeFitnessV19(mouse);
      const score = base + mouse.generationPaceShaping;
      mouse.fitness = score;
      return score;
    };

    function v19BaseLife(fullLife, phase) {
      if (phase.label === 'full') return fullLife;
      const scaled = Math.round(fullLife * phase.baseFraction);
      return Math.min(fullLife, Math.max(phase.baseMin, Math.min(phase.baseMax, scaled)));
    }

    function v19LifeCap(mouse) {
      const fullLife = Math.max(1, state.maxSteps || 1);
      const phase = v19Phase(mouse.generation || state.generation);
      if (phase.label === 'full') return fullLife;

      const baseLife = v19BaseLife(fullLife, phase);
      const productiveCeiling = Math.max(baseLife, Math.min(fullLife, Math.round(fullLife * phase.productiveFraction)));
      const extensionBudget = Math.max(0, productiveCeiling - baseLife);

      // Goal progress is the strongest way to earn extra life. The exponent gives
      // even modest early progress a useful extension without instantly granting
      // the entire late-generation lifespan.
      const progress = Math.max(0, Math.min(1, progressOf(mouse)));
      const progressExtension = extensionBudget * Math.pow(progress, 0.82) * 0.72;

      // Actually walking into new cells also earns time. Merely seeing lots of cells
      // with 32-ray vision does not: the mouse has to physically explore them.
      const visited = Math.max(0, (mouse.visited?.size || 1) - 1);
      const explorationExtension = Math.min(extensionBudget * 0.34, visited * 1.65);

      // Cheese is useful evidence of purposeful behaviour, but cannot by itself buy
      // an effectively unlimited early life.
      const cheeseExtension = Math.min(extensionBudget * 0.18, (mouse.cheeseCount || 0) * 65);

      return Math.max(
        1,
        Math.min(productiveCeiling, Math.round(baseLife + progressExtension + explorationExtension + cheeseExtension))
      );
    }

    function v19ApplyEarlyStrikePressure(mouse, previousStrikeCount) {
      const phase = v19Phase(mouse.generation || state.generation);
      if (!phase.strikeStale && !phase.strikePenalty) return false;

      const currentStrikes = mouse.productivityAudit?.totalStrikes || 0;
      const newStrikes = Math.max(0, currentStrikes - previousStrikeCount);
      if (!newStrikes) return false;

      mouse.generationPaceShaping -= phase.strikePenalty * newStrikes;

      let stale = mouse.balanceStale ?? mouse.staleSteps ?? 0;
      stale += phase.strikeStale * newStrikes;
      mouse.balanceStale = stale;
      mouse.staleSteps = stale;

      if (stale >= stagnationLimit()) {
        killMouse(mouse, 'stagnation');
        return true;
      }
      return false;
    }

    const previousTickMouseV19 = tickMouse;
    tickMouse = function (mouse) {
      if (!mouse.alive) return;
      v19Initialise(mouse);

      // Early generations do not get the full exploratory lifetime for free. A mouse
      // that is genuinely useful continuously pushes this cap outward by progressing,
      // exploring new cells and collecting cheese.
      const capBeforeMove = v19LifeCap(mouse);
      if (mouse.step >= capBeforeMove) {
        killMouse(mouse, 'timeout');
        return;
      }

      const strikesBefore = mouse.productivityAudit?.totalStrikes || 0;
      previousTickMouseV19(mouse);
      if (!mouse.alive) return;

      if (v19ApplyEarlyStrikePressure(mouse, strikesBefore)) return;
      mouse.pacingLastStrikeCount = mouse.productivityAudit?.totalStrikes || 0;

      computeFitness(mouse);
      recordMilestones(mouse);
    };

    state.balanceV19 = {
      phases: V19_PHASES.map(phase => ({
        through: Number.isFinite(phase.through) ? phase.through : 'full',
        label: phase.label,
        baseFraction: phase.baseFraction,
        productiveFraction: phase.productiveFraction,
        strikeStale: phase.strikeStale,
        strikePenalty: phase.strikePenalty
      })),
      lifeCap: v19LifeCap
    };
  })();
