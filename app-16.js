  // EvoMaus v1.1 straggler pass: late survivors must still be doing something useful.
  (() => {
    const V21_SURVIVOR_FRACTION = 0.03;
    const V21_MAX_SURVIVORS = 12;
    const V21_MIN_SURVIVORS = 2;
    const V21_NORMAL_WINDOW = 36;
    const V21_TINY_GROUP_WINDOW = 28;
    const V21_LAST_MOUSE_WINDOW = 22;
    const V21_LOOP_MIN_STEPS = 18;
    const V21_LOOP_UNIQUE_CELLS = 4;
    const V21_ROUTE_PROGRESS_NORMAL = 4;
    const V21_ROUTE_PROGRESS_LAST = 3;
    const V21_CULL_PENALTY = 26000;

    function v21Threshold() {
      const proportional = Math.ceil(Math.max(1, state.populationSize || 1) * V21_SURVIVOR_FRACTION);
      return Math.max(V21_MIN_SURVIVORS, Math.min(V21_MAX_SURVIVORS, proportional));
    }

    function v21Target(mouse) {
      const nav = mouse.cognitiveMap?.nav;
      if (!nav) return null;
      if (nav.goal) return { kind: 'goal', key: nav.goal.key, distance: nav.goal.distance };
      if (nav.frontier) return { kind: 'frontier', key: nav.frontier.key, distance: nav.frontier.distance };
      if (nav.cheese) return { kind: 'cheese', key: nav.cheese.key, distance: nav.cheese.distance };
      return null;
    }

    function v21Init(mouse) {
      if (!Number.isFinite(mouse.stragglerShaping)) mouse.stragglerShaping = 0;
      if (!mouse.stragglerAudit) mouse.stragglerAudit = null;
      return mouse;
    }

    function v21Snapshot(mouse) {
      const target = v21Target(mouse);
      mouse.stragglerAudit = {
        step: mouse.step || 0,
        visited: mouse.visited?.size || 0,
        revision: mouse.cognitiveMap?.revision || 0,
        cheese: mouse.cheeseCount || 0,
        bestDistance: Number.isFinite(mouse.bestDistance) ? mouse.bestDistance : Infinity,
        targetKind: target?.kind || null,
        targetKey: target?.key ?? null,
        targetDistance: Number.isFinite(target?.distance) ? target.distance : null
      };
    }

    function v21RecentUniqueCells(mouse) {
      const recent = (mouse.pathHistory || []).slice(-12);
      return recent.length ? new Set(recent).size : Infinity;
    }

    function v21WindowFor(aliveCount) {
      if (aliveCount <= 1) return V21_LAST_MOUSE_WINDOW;
      if (aliveCount <= 3) return V21_TINY_GROUP_WINDOW;
      return V21_NORMAL_WINDOW;
    }

    function v21RouteProgress(mouse, audit, aliveCount) {
      const target = v21Target(mouse);
      if (!target || !Number.isFinite(audit.targetDistance) || !Number.isFinite(target.distance)) return 0;

      // Goal/frontier/cheese route distance is useful even if the nearest frontier
      // changed while the mouse moved. A straggler merely needs to demonstrate that
      // its remembered navigation problem is actually getting shorter.
      if (target.kind !== audit.targetKind) return 0;
      return Math.max(0, audit.targetDistance - target.distance);
    }

    function v21Productive(mouse, audit, aliveCount) {
      if ((mouse.visited?.size || 0) > audit.visited) return true;
      if ((mouse.cognitiveMap?.revision || 0) > audit.revision) return true;
      if ((mouse.cheeseCount || 0) > audit.cheese) return true;
      if (Number.isFinite(mouse.bestDistance) && mouse.bestDistance < audit.bestDistance) return true;

      const required = aliveCount <= 1 ? V21_ROUTE_PROGRESS_LAST : V21_ROUTE_PROGRESS_NORMAL;
      if (v21RouteProgress(mouse, audit, aliveCount) >= required) return true;

      // Resolving the frontier that existed at the start of the window is useful,
      // even if the next frontier is elsewhere and therefore has a larger distance.
      if (audit.targetKind === 'frontier' && audit.targetKey !== null &&
          !mouse.cognitiveMap?.frontiers?.has(audit.targetKey)) return true;

      return false;
    }

    function v21Cull(mouse) {
      if (!mouse.alive) return;
      mouse.stragglerShaping -= V21_CULL_PENALTY;
      killMouse(mouse, 'stagnation');
    }

    const previousComputeFitnessV21 = computeFitness;
    computeFitness = function (mouse) {
      v21Init(mouse);
      const base = previousComputeFitnessV21(mouse);
      const score = base + mouse.stragglerShaping;
      mouse.fitness = score;
      return score;
    };

    function v21AuditSurvivors() {
      if (state.mode !== 'sim' || state.paused || !state.mice.length) return;

      const alive = state.mice.filter(mouse => mouse.alive);
      const threshold = v21Threshold();

      if (alive.length > threshold) {
        // Do not carry a half-finished late-game audit across the normal part of a
        // generation. A fresh snapshot is taken only when straggler mode begins.
        if (state.stragglerAuditGeneration === state.generation) {
          state.stragglerAuditGeneration = null;
          for (const mouse of alive) mouse.stragglerAudit = null;
        }
        return;
      }

      if (!alive.length) return;

      if (state.stragglerAuditGeneration !== state.generation) {
        state.stragglerAuditGeneration = state.generation;
        state.stragglerAuditThreshold = threshold;
        for (const mouse of alive) {
          v21Init(mouse);
          v21Snapshot(mouse);
        }
        return;
      }

      const window = v21WindowFor(alive.length);
      let culled = 0;

      for (const mouse of alive) {
        v21Init(mouse);
        if (!mouse.stragglerAudit) {
          v21Snapshot(mouse);
          continue;
        }

        const audit = mouse.stragglerAudit;
        const elapsed = (mouse.step || 0) - audit.step;
        if (elapsed <= 0) continue;

        if (v21Productive(mouse, audit, alive.length)) {
          // Useful survivors receive a completely fresh window. We are not trying
          // to end the generation early; only to stop useless mice holding it open.
          v21Snapshot(mouse);
          continue;
        }

        const circling = elapsed >= V21_LOOP_MIN_STEPS &&
          v21RecentUniqueCells(mouse) <= V21_LOOP_UNIQUE_CELLS;
        const windowExpired = elapsed >= window;

        if (circling || windowExpired) {
          v21Cull(mouse);
          culled++;
        }
      }

      if (culled) {
        updateStats();
        if (generationFinished()) {
          // The ordinary generation transition waits five ticks after the final
          // death. Once the cleanup audit has conclusively removed the stragglers,
          // shorten that dead-air delay to one final tick.
          state.generationCooldown = Math.max(state.generationCooldown || 0, 4);
        }
      }
    }

    const previousSimulationTickV21 = simulationTick;
    simulationTick = function () {
      const generationBefore = state.generation;
      previousSimulationTickV21();

      // If the previous call advanced the generation, do not accidentally audit the
      // newborn population using the old generation's late-survivor state.
      if (state.generation !== generationBefore) {
        state.stragglerAuditGeneration = null;
        return;
      }

      v21AuditSurvivors();
    };

    state.balanceV21 = {
      survivorFraction: V21_SURVIVOR_FRACTION,
      maxSurvivors: V21_MAX_SURVIVORS,
      windows: {
        normal: V21_NORMAL_WINDOW,
        tinyGroup: V21_TINY_GROUP_WINDOW,
        lastMouse: V21_LAST_MOUSE_WINDOW
      },
      loopMinSteps: V21_LOOP_MIN_STEPS,
      loopUniqueCells: V21_LOOP_UNIQUE_CELLS,
      cullPenalty: V21_CULL_PENALTY
    };
  })();
