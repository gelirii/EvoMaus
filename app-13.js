  // EvoMaus v1.1 productivity pass: moving a lot must achieve something useful.
  (() => {
    const V18_TRAVEL_WINDOW = 96;
    const V18_REQUIRED_PROGRESS = 8;
    const V18_MICRO_LOOP_WINDOW = 48;
    const V18_MICRO_LOOP_REQUIRED_PROGRESS = 4;
    const V18_BASE_PENALTY = 9000;
    const V18_ESCALATION_PENALTY = 4500;
    const V18_BASE_STALE_BURST = 72;
    const V18_ESCALATION_STALE = 22;
    const V18_PRODUCTIVE_RECOVERY = 1;
    const V18_MIN_PARENT_FACTOR = 0.08;

    function v18Initialise(mouse) {
      if (!Number.isFinite(mouse.productivityShaping)) mouse.productivityShaping = 0;
      if (!mouse.productivityAudit) {
        mouse.productivityAudit = {
          travel: 0,
          targetKind: null,
          targetKey: null,
          startDistance: null,
          bestDistance: null,
          lastNavStep: -Infinity,
          strikes: 0,
          totalStrikes: 0
        };
      }
      return mouse;
    }

    const previousMakeMouseV18 = makeMouse;
    makeMouse = function (genome, generation, parentIds = [], lineage = null) {
      return v18Initialise(previousMakeMouseV18(genome, generation, parentIds, lineage));
    };

    const previousComputeFitnessV18 = computeFitness;
    computeFitness = function (mouse) {
      v18Initialise(mouse);
      const base = previousComputeFitnessV18(mouse);
      const score = base + mouse.productivityShaping;
      mouse.fitness = score;
      return score;
    };

    function v18Target(mouse) {
      const map = mouse.cognitiveMap;
      const nav = map?.nav;
      if (!nav) return null;

      // Once the goal is known, reaching it is the productive task. Before that,
      // unexplored frontier beats optional cheese because exploration grows knowledge.
      if (nav.goal) {
        return { kind: 'goal', key: nav.goal.key, distance: nav.goal.distance, navStep: map.navStep };
      }
      if (nav.frontier) {
        return { kind: 'frontier', key: nav.frontier.key, distance: nav.frontier.distance, navStep: map.navStep };
      }
      if (nav.cheese) {
        return { kind: 'cheese', key: nav.cheese.key, distance: nav.cheese.distance, navStep: map.navStep };
      }
      return null;
    }

    function v18ResetWindow(mouse, target, rewardRecovery = false) {
      const audit = mouse.productivityAudit;
      audit.travel = 0;
      audit.targetKind = target?.kind || null;
      audit.targetKey = target?.key ?? null;
      audit.startDistance = Number.isFinite(target?.distance) ? target.distance : null;
      audit.bestDistance = Number.isFinite(target?.distance) ? target.distance : null;
      audit.lastNavStep = Number.isFinite(target?.navStep) ? target.navStep : -Infinity;
      if (rewardRecovery && audit.strikes > 0) {
        audit.strikes = Math.max(0, audit.strikes - V18_PRODUCTIVE_RECOVERY);
      }
    }

    function v18RequiredProgress(audit, normalRequired) {
      if (!Number.isFinite(audit.startDistance)) return normalRequired;
      // If the frontier is only 2 blocks away, failing to cover those 2 blocks for
      // 96 moves is even more damning than failing an 8-block target farther away.
      return Math.max(1, Math.min(normalRequired, audit.startDistance));
    }

    function v18ProgressMade(audit) {
      if (!Number.isFinite(audit.startDistance) || !Number.isFinite(audit.bestDistance)) return 0;
      return Math.max(0, audit.startDistance - audit.bestDistance);
    }

    function v18TinyPatch(mouse) {
      const recent = (mouse.pathHistory || []).slice(-12);
      return recent.length >= 10 && new Set(recent).size <= 3;
    }

    function v18ApplyStrike(mouse, target, earlyLoop = false) {
      const audit = mouse.productivityAudit;
      audit.strikes++;
      audit.totalStrikes++;

      const severity = Math.min(4, audit.strikes);
      const fitnessPenalty = V18_BASE_PENALTY + (severity - 1) * V18_ESCALATION_PENALTY;
      mouse.productivityShaping -= fitnessPenalty;

      let stale = mouse.balanceStale ?? mouse.staleSteps ?? 0;
      stale += V18_BASE_STALE_BURST + (severity - 1) * V18_ESCALATION_STALE;
      if (earlyLoop) stale += 24;
      mouse.balanceStale = stale;
      mouse.staleSteps = stale;

      // Start a fresh audit from wherever the mouse currently is. Repeating the same
      // wasteful behaviour therefore earns another, larger strike rather than one
      // enormous historical window that can never recover.
      v18ResetWindow(mouse, target, false);
      audit.strikes = severity;

      if (stale >= stagnationLimit()) {
        killMouse(mouse, 'stagnation');
        return true;
      }
      return false;
    }

    const previousTickMouseV18 = tickMouse;
    tickMouse = function (mouse) {
      if (!mouse.alive) return;
      v18Initialise(mouse);

      const beforeX = mouse.x;
      const beforeY = mouse.y;
      const beforeVisited = mouse.visited?.size || 0;
      const beforeCheese = mouse.cheeseCount || 0;
      const beforeBestDistance = mouse.bestDistance;

      previousTickMouseV18(mouse);
      if (!mouse.alive) return;

      const moved = mouse.x !== beforeX || mouse.y !== beforeY;
      const newVisited = (mouse.visited?.size || 0) > beforeVisited;
      const newCheese = (mouse.cheeseCount || 0) > beforeCheese;
      const improvedGoalProgress = Number.isFinite(beforeBestDistance) && mouse.bestDistance < beforeBestDistance;
      const target = v18Target(mouse);
      const audit = mouse.productivityAudit;

      if (moved) audit.travel++;

      // Reaching genuinely new ground, collecting cheese or establishing a new best
      // goal position is productive by definition. It clears the current travel debt.
      if (newVisited || newCheese || improvedGoalProgress) {
        v18ResetWindow(mouse, target, true);
        computeFitness(mouse);
        recordMilestones(mouse);
        return;
      }

      if (!target) {
        // No remembered goal/frontier/cheese means there is no honest navigation
        // target against which to judge movement yet.
        v18ResetWindow(mouse, null, false);
        computeFitness(mouse);
        recordMilestones(mouse);
        return;
      }

      const targetChanged = audit.targetKind !== target.kind || audit.targetKey !== target.key;
      if (targetChanged) {
        // If the previous frontier disappeared from the frontier set, the mouse
        // actually resolved it: that is productive, so forgive one strike. If the
        // target merely changed because another frontier became nearer, keep the
        // travel debt but establish a sensible new distance baseline.
        const previousResolved = audit.targetKind === 'frontier' && audit.targetKey !== null &&
          !mouse.cognitiveMap?.frontiers?.has(audit.targetKey);

        if (previousResolved) {
          v18ResetWindow(mouse, target, true);
          computeFitness(mouse);
          recordMilestones(mouse);
          return;
        }

        audit.targetKind = target.kind;
        audit.targetKey = target.key;
        audit.startDistance = target.distance;
        audit.bestDistance = target.distance;
        audit.lastNavStep = target.navStep;
      } else if (target.navStep !== audit.lastNavStep) {
        audit.lastNavStep = target.navStep;
        if (Number.isFinite(target.distance)) {
          if (!Number.isFinite(audit.startDistance)) audit.startDistance = target.distance;
          if (!Number.isFinite(audit.bestDistance)) audit.bestDistance = target.distance;
          audit.bestDistance = Math.min(audit.bestDistance, target.distance);
        }
      }

      const made = v18ProgressMade(audit);
      const required = v18RequiredProgress(audit, V18_REQUIRED_PROGRESS);

      // Once the mouse has genuinely advanced enough, begin a fresh 96-block audit
      // from the new position instead of letting old good work excuse future dithering.
      if (made >= required) {
        v18ResetWindow(mouse, target, true);
        let stale = mouse.balanceStale ?? mouse.staleSteps ?? 0;
        stale = Math.max(0, stale - 24);
        mouse.balanceStale = stale;
        mouse.staleSteps = stale;
        computeFitness(mouse);
        recordMilestones(mouse);
        return;
      }

      const tinyPatch = v18TinyPatch(mouse);
      const earlyRequired = v18RequiredProgress(audit, V18_MICRO_LOOP_REQUIRED_PROGRESS);
      const earlyFailure = tinyPatch && audit.travel >= V18_MICRO_LOOP_WINDOW && made < earlyRequired;
      const fullFailure = audit.travel >= V18_TRAVEL_WINDOW && made < required;

      if (earlyFailure || fullFailure) {
        if (v18ApplyStrike(mouse, target, earlyFailure)) return;
      }

      computeFitness(mouse);
      recordMilestones(mouse);
    };

    // v17 already compares mice relative to peers. Keep that logic, but add an
    // explicit inheritance tax for brains that repeatedly failed the productivity
    // audit so corner-vibrating ideas do not survive just because they happened to
    // start near a high-progress location.
    selectParent = function (pool) {
      if (!pool?.length) return null;

      let total = 0;
      const weights = new Float64Array(pool.length);
      for (let i = 0; i < pool.length; i++) {
        const mouse = pool[i];
        const rankWeight = pool.length - i;
        const relativeWeight = Number.isFinite(mouse.relativeBreedingWeight)
          ? mouse.relativeBreedingWeight
          : 1;
        const strikes = mouse.productivityAudit?.totalStrikes || 0;
        const productivityFactor = Math.max(V18_MIN_PARENT_FACTOR, Math.pow(0.52, strikes));
        const weight = rankWeight * relativeWeight * productivityFactor;
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

    state.balanceV18 = {
      travelWindow: V18_TRAVEL_WINDOW,
      requiredProgress: V18_REQUIRED_PROGRESS,
      microLoopWindow: V18_MICRO_LOOP_WINDOW,
      microLoopRequiredProgress: V18_MICRO_LOOP_REQUIRED_PROGRESS,
      basePenalty: V18_BASE_PENALTY,
      escalationPenalty: V18_ESCALATION_PENALTY,
      baseStaleBurst: V18_BASE_STALE_BURST
    };
  })();
