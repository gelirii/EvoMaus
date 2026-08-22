  // EvoMaus v1.1 balance pass: purposeful movement survives; true loops still die quickly.
  (() => {
    const V15_PROGRESS_LINEAR = 160000;
    const V15_PROGRESS_NEAR_GOAL = 80000;
    const V15_CHEESE_REWARD = 6000;
    const V15_VISITED_REWARD = 22;
    const V15_KNOWN_CELL_REWARD = 2;
    const V15_KNOWN_CELL_CAP = 4000;
    const V15_WALL_HIT_PENALTY = 1200;
    const V15_DANGER_DEATH_PENALTY = 85000;
    const V15_WALL_DEATH_PENALTY = 22000;
    const V15_STAGNATION_DEATH_PENALTY = 30000;
    const V15_TIMEOUT_PENALTY = 4000;
    const V15_STALE_PENALTY = 20;
    const V15_STEP_TIEBREAK = 0.1;
    const V15_GOAL_REWARD = 1000000;
    const V15_GOAL_EFFICIENCY_REWARD = 220000;

    function v15StagnationLimit() {
      // A purposeful mouse may need to walk a long remembered route back to a fork.
      // Short repetitive loops accumulate stagnation much faster than this counter.
      return Math.max(180, Math.min(480, Math.round(150 + state.startDistance * 1.35)));
    }
    stagnationLimit = v15StagnationLimit;

    computeFitness = function (mouse) {
      const progress = progressOf(mouse);
      const knowledge = mouse.cognitiveMap?.cells?.size || mouse.visited?.size || 0;
      const stale = mouse.balanceStale ?? mouse.staleSteps ?? 0;

      // Linear progress keeps early evolution learnable; the cubic term makes the
      // last stretch toward the goal increasingly valuable once a lineage gets close.
      let score = progress * V15_PROGRESS_LINEAR;
      score += progress * progress * progress * V15_PROGRESS_NEAR_GOAL;
      score += (mouse.cheeseCount || 0) * V15_CHEESE_REWARD;
      score += Math.max(0, (mouse.visited?.size || 1) - 1) * V15_VISITED_REWARD;
      score += Math.min(V15_KNOWN_CELL_CAP, knowledge) * V15_KNOWN_CELL_REWARD;
      score -= (mouse.wallHits || 0) * V15_WALL_HIT_PENALTY;
      score -= stale * V15_STALE_PENALTY;
      score -= (mouse.step || 0) * V15_STEP_TIEBREAK;

      if (mouse.deathReason === 'danger') score -= V15_DANGER_DEATH_PENALTY;
      if (mouse.deathReason === 'walls') score -= V15_WALL_DEATH_PENALTY;
      if (mouse.deathReason === 'stagnation') score -= V15_STAGNATION_DEATH_PENALTY;
      if (mouse.deathReason === 'timeout') score -= V15_TIMEOUT_PENALTY;

      if (mouse.reachedGoal) {
        const shortest = Math.max(1, state.startDistance || 1);
        const steps = Math.max(shortest, mouse.step || shortest);
        const efficiency = shortest / steps;
        score += V15_GOAL_REWARD;
        score += efficiency * V15_GOAL_EFFICIENCY_REWARD;
      }

      mouse.fitness = score;
      return score;
    };

    // The old A-B-C-B-A rule was useful before cognitive maps, but a single such
    // sequence is also exactly what a sensible mouse does when exploring a dead end.
    // Only classify it as a loop once the same tiny patch is being repeated.
    wouldCompleteShortRetrace = function (mouse, dir) {
      const history = mouse.pathHistory || [];
      if (history.length < 6) return false;
      const target = targetKey(mouse, dir);
      const recent = history.slice(-9);
      recent.push(target);
      if (new Set(recent).size > 3) return false;
      let targetVisits = 0;
      for (const key of recent) if (key === target) targetVisits++;
      return targetVisits >= 3;
    };

    // Likewise, reversing direction along one corridor once is legitimate backtracking.
    // Axis oscillation now requires a sustained shuffle inside only 2-3 cells.
    wouldContinueAxisOscillation = function (mouse, dir) {
      const dirs = (mouse.dirHistory || []).slice(-6);
      dirs.push(dir);
      if (dirs.length < 6) return false;
      const axis = axisOfDir(dir);
      if (!dirs.every(d => axisOfDir(d) === axis)) return false;
      if (new Set(dirs).size < 2) return false;

      const history = (mouse.pathHistory || []).slice(-7);
      history.push(targetKey(mouse, dir));
      return new Set(history).size <= 3;
    };

    const previousPrepareMazeForRunV15 = prepareMazeForRun;
    prepareMazeForRun = function () {
      if (!previousPrepareMazeForRunV15()) return false;
      // Cognitive-map mice intentionally explore and revisit known forks. Give them
      // enough lifetime to finish that work; stagnation remains the fast loop-culler.
      state.maxSteps = Math.max(450, Math.min(3600, Math.round(state.startDistance * 10 + 320)));
      return true;
    };

    function recentTightLoop(mouse) {
      const recent = (mouse.pathHistory || []).slice(-8);
      return recent.length >= 6 && new Set(recent).size <= 3;
    }

    function followedRememberedRoute(mouse) {
      const nav = mouse.cognitiveMap?.nav;
      if (!nav || mouse.lastDir < 0) return false;
      return nav.goal?.firstDir === mouse.lastDir ||
        nav.cheese?.firstDir === mouse.lastDir ||
        nav.frontier?.firstDir === mouse.lastDir;
    }

    const previousTickMouseV15 = tickMouse;
    tickMouse = function (mouse) {
      if (!mouse.alive) return;

      const limit = v15StagnationLimit();
      const beforeBalanced = mouse.balanceStale ?? mouse.staleSteps ?? 0;
      const beforeX = mouse.x;
      const beforeY = mouse.y;
      const beforeVisited = mouse.visited?.size || 0;
      const beforeRevision = mouse.cognitiveMap?.revision || 0;
      const beforeCheese = mouse.cheeseCount || 0;
      const beforeBestDistance = mouse.bestDistance;
      const beforeCurrentDistance = mouse.currentDistance;
      const beforeWallHits = mouse.wallHits || 0;

      // Prevent the legacy stale counter from killing the mouse before we can judge
      // whether this particular move was purposeful. The balanced counter below owns death.
      mouse.staleSteps = Math.min(beforeBalanced, Math.max(0, limit - 24));
      previousTickMouseV15(mouse);

      if (!mouse.alive) {
        // Goal, danger, wall-death and timeout are final. A legacy stagnation death
        // should be practically unreachable because of the pre-tick safety margin.
        mouse.balanceStale = mouse.staleSteps;
        return;
      }

      const moved = mouse.x !== beforeX || mouse.y !== beforeY;
      const discovered = (mouse.cognitiveMap?.revision || 0) > beforeRevision;
      const newVisitedCell = (mouse.visited?.size || 0) > beforeVisited;
      const foundCheese = (mouse.cheeseCount || 0) > beforeCheese;
      const improvedBest = Number.isFinite(beforeBestDistance) && mouse.bestDistance < beforeBestDistance;
      const movedCloser = moved && Number.isFinite(beforeCurrentDistance) &&
        Number.isFinite(mouse.currentDistance) && mouse.currentDistance < beforeCurrentDistance;
      const hitWall = (mouse.wallHits || 0) > beforeWallHits;
      const onRememberedRoute = moved && followedRememberedRoute(mouse);
      const tightLoop = moved && recentTightLoop(mouse);

      let balanced = beforeBalanced;

      // New information or a genuine new achievement clears restlessness completely.
      if (discovered || newVisitedCell || foundCheese || improvedBest) {
        balanced = 0;
      } else if (movedCloser) {
        // Returning through known ground toward the goal is purposeful even when the
        // mouse has not yet beaten its previous all-time best position.
        balanced = Math.max(0, balanced - 10);
      } else if (onRememberedRoute) {
        // Walking back through known territory to a frontier/cheese/goal is exactly
        // what the cognitive map is for, so it should buy patience rather than death.
        balanced = Math.max(0, balanced - 6);
      } else if (hitWall) {
        balanced += 12;
      } else if (tightLoop) {
        balanced += 8;
      } else if (moved) {
        // A large unproductive loop will still eventually time out on stagnation,
        // but ordinary movement through old ground gets much more latitude.
        balanced += 1;
      } else {
        balanced += 4;
      }

      mouse.balanceStale = balanced;
      mouse.staleSteps = balanced;

      if (balanced >= limit) {
        killMouse(mouse, 'stagnation');
        return;
      }

      computeFitness(mouse);
      recordMilestones(mouse);
    };

    // Expose the reviewed constants for easy future tuning/debugging in the console.
    state.balanceV15 = {
      stagnationLimit: v15StagnationLimit,
      weights: {
        progressLinear: V15_PROGRESS_LINEAR,
        progressNearGoal: V15_PROGRESS_NEAR_GOAL,
        cheese: V15_CHEESE_REWARD,
        goal: V15_GOAL_REWARD,
        goalEfficiency: V15_GOAL_EFFICIENCY_REWARD,
        dangerDeath: V15_DANGER_DEATH_PENALTY,
        wallHit: V15_WALL_HIT_PENALTY,
        stagnationDeath: V15_STAGNATION_DEATH_PENALTY
      }
    };
  })();
