  // EvoMaus v1.1 frontier/dead-end shaping: reward purposeful exploration, punish known traps.
  (() => {
    const V16_FRONTIER_STEP_REWARD = 320;
    const V16_FRONTIER_BACKTRACK_PENALTY = 440;
    const V16_FRONTIER_RESOLVED_REWARD = 1400;
    const V16_KNOWN_DEAD_END_ENTRY_PENALTY = 2600;
    const V16_DEAD_END_LINGER_PENALTY = 420;
    const V16_DEAD_END_ESCAPE_REWARD = 900;

    // Cognitive-map codes from app-8.js. Re-declared here deliberately so this
    // balance layer can stay independent of the map implementation's private IIFE.
    const MEMORY_FLOOR = 1;
    const MEMORY_WALL = 2;
    const MEMORY_DANGER = 3;
    const MEMORY_CHEESE = 4;
    const MEMORY_GOAL = 5;

    function v16MemoryKey(x, y) {
      return y * GRID_W + x;
    }

    function v16MemorySafe(code) {
      return code === MEMORY_FLOOR || code === MEMORY_CHEESE || code === MEMORY_GOAL;
    }

    function v16UnknownNeighbourCount(map, x, y) {
      let unknown = 0;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny)) continue;
        if (!map.cells.has(v16MemoryKey(nx, ny))) unknown++;
      }
      return unknown;
    }

    function v16KnownSafeNeighbourCount(map, x, y) {
      let safe = 0;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny)) continue;
        if (v16MemorySafe(map.cells.get(v16MemoryKey(nx, ny)))) safe++;
      }
      return safe;
    }

    function v16ValuableCell(mouse, map, x, y) {
      const code = map.cells.get(v16MemoryKey(x, y));
      if (code === MEMORY_GOAL) return true;
      if (code === MEMORY_CHEESE && !mouse.cheeses.has(cellKey(x, y))) return true;
      return false;
    }

    function v16KnownDeadEnd(mouse, map, x, y) {
      if (!map || !inBounds(x, y)) return false;
      const key = v16MemoryKey(x, y);
      const code = map.cells.get(key);
      if (!v16MemorySafe(code)) return false;
      if (v16ValuableCell(mouse, map, x, y)) return false;
      if (map.frontiers?.has(key)) return false;
      if (v16UnknownNeighbourCount(map, x, y) > 0) return false;
      return v16KnownSafeNeighbourCount(map, x, y) <= 1;
    }

    function v16InitialiseMouse(mouse) {
      if (!Number.isFinite(mouse.frontierShaping)) mouse.frontierShaping = 0;
      if (!Number.isFinite(mouse.deadEndShaping)) mouse.deadEndShaping = 0;
      if (!mouse.frontierSample) mouse.frontierSample = null;
      return mouse;
    }

    const previousMakeMouseV16 = makeMouse;
    makeMouse = function (genome, generation, parentIds = [], lineage = null) {
      return v16InitialiseMouse(previousMakeMouseV16(genome, generation, parentIds, lineage));
    };

    const previousComputeFitnessV16 = computeFitness;
    computeFitness = function (mouse) {
      v16InitialiseMouse(mouse);
      const base = previousComputeFitnessV16(mouse);
      const score = base + mouse.frontierShaping + mouse.deadEndShaping;
      mouse.fitness = score;
      return score;
    };

    function v16CaptureAdjacentDeadEnds(mouse, map) {
      const knownDeadEnds = new Set();
      if (!map) return knownDeadEnds;
      for (const d of DIRS) {
        const x = mouse.x + d.x;
        const y = mouse.y + d.y;
        if (v16KnownDeadEnd(mouse, map, x, y)) knownDeadEnds.add(v16MemoryKey(x, y));
      }
      return knownDeadEnds;
    }

    function v16ScoreFrontierSample(mouse, map) {
      const navStep = map?.navStep;
      if (!Number.isFinite(navStep)) return 0;
      if (mouse.frontierSample?.navStep === navStep) return 0;

      const frontier = map.nav?.frontier || null;
      const previous = mouse.frontierSample;
      let distanceDelta = 0;

      if (previous && previous.key !== null && frontier && previous.key === frontier.key) {
        distanceDelta = previous.distance - frontier.distance;
        if (distanceDelta > 0) {
          mouse.frontierShaping += distanceDelta * V16_FRONTIER_STEP_REWARD;
        } else if (distanceDelta < 0) {
          // Moving away costs a little more than moving closer earns, preventing
          // a mouse from farming fitness by shuttling toward/away from one frontier.
          mouse.frontierShaping -= (-distanceDelta) * V16_FRONTIER_BACKTRACK_PENALTY;
        }
      } else if (previous && previous.key !== null && !map.frontiers?.has(previous.key)) {
        // The old frontier has been completely observed. This is a one-off reward:
        // once resolved, the same patch of map cannot pay out again for this mouse.
        mouse.frontierShaping += V16_FRONTIER_RESOLVED_REWARD;
      }

      mouse.frontierSample = frontier
        ? { key: frontier.key, distance: frontier.distance, navStep }
        : { key: null, distance: 0, navStep };

      return distanceDelta;
    }

    const previousTickMouseV16 = tickMouse;
    tickMouse = function (mouse) {
      if (!mouse.alive) return;
      v16InitialiseMouse(mouse);

      const beforeX = mouse.x;
      const beforeY = mouse.y;
      const beforeMap = mouse.cognitiveMap;
      const beforeDeadEnd = beforeMap ? v16KnownDeadEnd(mouse, beforeMap, beforeX, beforeY) : false;
      const adjacentKnownDeadEnds = v16CaptureAdjacentDeadEnds(mouse, beforeMap);

      previousTickMouseV16(mouse);

      const map = mouse.cognitiveMap;
      if (!map) return;

      const moved = mouse.x !== beforeX || mouse.y !== beforeY;
      const afterKey = v16MemoryKey(mouse.x, mouse.y);
      const afterDeadEnd = v16KnownDeadEnd(mouse, map, mouse.x, mouse.y);
      const enteredKnownDeadEnd = moved && adjacentKnownDeadEnds.has(afterKey) && afterDeadEnd;
      const escapedKnownDeadEnd = moved && beforeDeadEnd && !afterDeadEnd;

      if (enteredKnownDeadEnd) {
        mouse.deadEndShaping -= V16_KNOWN_DEAD_END_ENTRY_PENALTY;
      } else if (afterDeadEnd && !escapedKnownDeadEnd) {
        // Discovering a new dead end is not punished simply for being discovered.
        // The penalty starts when a mouse returns to, or hangs around in, one it
        // already knew was exhausted.
        if (!moved || beforeDeadEnd) mouse.deadEndShaping -= V16_DEAD_END_LINGER_PENALTY;
      }

      if (escapedKnownDeadEnd) {
        mouse.deadEndShaping += V16_DEAD_END_ESCAPE_REWARD;
      }

      const frontierDelta = v16ScoreFrontierSample(mouse, map);

      // Tie the same signals gently into the life-stagnation counter. This is not
      // a hard steering rule: evolution still decides strategy, but mice actively
      // approaching frontiers get patience while known-trap behaviour burns it.
      if (mouse.alive) {
        let stale = mouse.balanceStale ?? mouse.staleSteps ?? 0;

        if (frontierDelta > 0) {
          stale = Math.max(0, stale - Math.min(18, frontierDelta * 4));
        } else if (frontierDelta < 0) {
          stale += Math.min(10, (-frontierDelta) * 2);
        }

        if (enteredKnownDeadEnd) stale += 16;
        else if (escapedKnownDeadEnd) stale = Math.max(0, stale - 20);
        else if (afterDeadEnd && !moved) stale += 10;

        mouse.balanceStale = stale;
        mouse.staleSteps = stale;

        if (stale >= stagnationLimit()) {
          killMouse(mouse, 'stagnation');
          return;
        }
      }

      computeFitness(mouse);
      recordMilestones(mouse);
    };

    state.balanceV16 = {
      frontierStepReward: V16_FRONTIER_STEP_REWARD,
      frontierBacktrackPenalty: V16_FRONTIER_BACKTRACK_PENALTY,
      frontierResolvedReward: V16_FRONTIER_RESOLVED_REWARD,
      knownDeadEndEntryPenalty: V16_KNOWN_DEAD_END_ENTRY_PENALTY,
      deadEndLingerPenalty: V16_DEAD_END_LINGER_PENALTY,
      deadEndEscapeReward: V16_DEAD_END_ESCAPE_REWARD
    };
  })();
