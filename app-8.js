  // EvoMaus v1.1 cognitive-map pass: private sparse memory, frontiers and remembered routes.
  (() => {
    const V13_VISION_RAYS = 32;
    const V13_SIGHT_DISTANCE = 16;
    const V13_HIDDEN = 10;
    const V13_OUTPUTS = 4;
    const V13_NAV_REFRESH_STEPS = 4;

    const V13_MEMORY = Object.freeze({
      FLOOR: 1,
      WALL: 2,
      DANGER: 3,
      CHEESE: 4,
      GOAL: 5
    });

    const V13_VISION_DIRS = Array.from({ length: V13_VISION_RAYS }, (_, index) => {
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / V13_VISION_RAYS);
      return { x: Math.cos(angle), y: Math.sin(angle) };
    });

    // Base senses (141): 32 rays x 4 channels, loose goal bearing, progress,
    // previous direction, wall hit, recent adjacent visits and restlessness.
    // Cognitive-map senses (+37): four adjacent remembered states x 4 channels,
    // routes to frontier/cheese/goal (6 each), plus frontier-here, local-exhausted
    // and remembered-dead-end flags.
    const V13_BASE_INPUTS = V13_VISION_RAYS * 4 + 2 + 1 + 4 + 1 + 4 + 1;
    const V13_MEMORY_INPUTS = 16 + 18 + 3;
    const V13_INPUTS = V13_BASE_INPUTS + V13_MEMORY_INPUTS;
    const V13_WEIGHTS = (V13_INPUTS + 1) * V13_HIDDEN + (V13_HIDDEN + 1) * V13_OUTPUTS;

    function v13RandomGenome() {
      const genome = new Float32Array(V13_WEIGHTS);
      for (let i = 0; i < genome.length; i++) genome[i] = (Math.random() * 2 - 1) * 0.68;
      return genome;
    }

    function v13BreedGenome(a, b, mutationRate) {
      const child = new Float32Array(V13_WEIGHTS);
      let mutationCount = 0;
      for (let i = 0; i < child.length; i++) {
        const av = a.genome[i] ?? 0;
        const bv = b.genome[i] ?? 0;
        let gene = Math.random() < 0.5 ? av : bv;
        if (Math.random() < mutationRate) {
          mutationCount++;
          if (Math.random() < 0.035) gene = (Math.random() * 2 - 1) * 1.2;
          else gene += (Math.random() + Math.random() - 1) * 0.48;
        }
        child[i] = Math.max(-4, Math.min(4, gene));
      }
      return { genome: child, mutationCount };
    }

    function memoryKey(x, y) {
      return y * GRID_W + x;
    }

    function keyX(key) {
      return key % GRID_W;
    }

    function keyY(key) {
      return Math.floor(key / GRID_W);
    }

    function actualMemoryCode(x, y) {
      if (state.goal && x === state.goal.x && y === state.goal.y) return V13_MEMORY.GOAL;
      const type = getCell(x, y);
      if (type === CELL.WALL) return V13_MEMORY.WALL;
      if (type === CELL.DANGER) return V13_MEMORY.DANGER;
      if (type === CELL.CHEESE) return V13_MEMORY.CHEESE;
      return V13_MEMORY.FLOOR;
    }

    function memoryIsSafe(code) {
      return code === V13_MEMORY.FLOOR || code === V13_MEMORY.CHEESE || code === V13_MEMORY.GOAL;
    }

    function ensureCognitiveMap(mouse) {
      if (mouse.cognitiveMap) return mouse.cognitiveMap;
      const map = {
        cells: new Map(),
        frontiers: new Set(),
        revision: 0,
        knownGoal: null,
        knownCheese: new Set(),
        nav: null,
        navStep: -Infinity
      };
      mouse.cognitiveMap = map;
      rememberCell(mouse, mouse.x, mouse.y, V13_MEMORY.FLOOR);
      return map;
    }

    function refreshFrontier(mouse, x, y) {
      if (!inBounds(x, y)) return;
      const map = mouse.cognitiveMap;
      const key = memoryKey(x, y);
      const code = map.cells.get(key);
      if (!memoryIsSafe(code)) {
        map.frontiers.delete(key);
        return;
      }

      let bordersUnknown = false;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!inBounds(nx, ny)) continue;
        if (!map.cells.has(memoryKey(nx, ny))) {
          bordersUnknown = true;
          break;
        }
      }
      if (bordersUnknown) map.frontiers.add(key);
      else map.frontiers.delete(key);
    }

    function refreshFrontierAround(mouse, x, y) {
      refreshFrontier(mouse, x, y);
      for (const d of DIRS) refreshFrontier(mouse, x + d.x, y + d.y);
    }

    function rememberCell(mouse, x, y, code = actualMemoryCode(x, y)) {
      if (!inBounds(x, y)) return false;
      const map = mouse.cognitiveMap || ensureCognitiveMap(mouse);
      const key = memoryKey(x, y);
      if (map.cells.get(key) === code) return false;
      map.cells.set(key, code);
      map.revision++;
      if (code === V13_MEMORY.GOAL) map.knownGoal = key;
      if (code === V13_MEMORY.CHEESE) map.knownCheese.add(key);
      else map.knownCheese.delete(key);
      refreshFrontierAround(mouse, x, y);
      return true;
    }

    const previousMakeMouse = makeMouse;
    makeMouse = function (genome, generation, parentIds = [], lineage = null) {
      const mouse = previousMakeMouse(genome, generation, parentIds, lineage);
      ensureCognitiveMap(mouse);
      return mouse;
    };

    function v13Closeness(distance) {
      return Math.max(0, (V13_SIGHT_DISTANCE + 1 - distance) / V13_SIGHT_DISTANCE);
    }

    function observeVision(mouse) {
      ensureCognitiveMap(mouse);
      const sensors = [];

      for (const direction of V13_VISION_DIRS) {
        let wall = 0;
        let danger = 0;
        let cheese = 0;
        let goal = 0;
        let lastKey = -1;

        for (let step = 1; step <= V13_SIGHT_DISTANCE; step++) {
          const x = Math.round(mouse.x + direction.x * step);
          const y = Math.round(mouse.y + direction.y * step);
          if (!inBounds(x, y)) {
            wall = v13Closeness(step);
            break;
          }

          const key = memoryKey(x, y);
          if (key === lastKey) continue;
          lastKey = key;

          const code = actualMemoryCode(x, y);
          rememberCell(mouse, x, y, code);
          const closeness = v13Closeness(step);

          // Walls are opaque. Cheese, danger and the goal are remembered but do
          // not stop the ray, so mice can learn about space beyond them.
          if (code === V13_MEMORY.WALL) {
            wall = closeness;
            break;
          }
          if (!danger && code === V13_MEMORY.DANGER) danger = closeness;
          if (!cheese && code === V13_MEMORY.CHEESE && !mouse.cheeses.has(cellKey(x, y))) cheese = closeness;
          if (!goal && code === V13_MEMORY.GOAL) goal = closeness;
        }

        sensors.push(wall, danger, cheese, goal);
      }
      return sensors;
    }

    function adjacentMemoryInputs(mouse) {
      const map = ensureCognitiveMap(mouse);
      const values = [];
      for (const d of DIRS) {
        const x = mouse.x + d.x;
        const y = mouse.y + d.y;
        const code = inBounds(x, y) ? map.cells.get(memoryKey(x, y)) : V13_MEMORY.WALL;
        const unknown = code === undefined ? 1 : 0;
        const wall = code === V13_MEMORY.WALL ? 1 : 0;
        const danger = code === V13_MEMORY.DANGER ? 1 : 0;
        const reward = code === V13_MEMORY.GOAL ||
          (code === V13_MEMORY.CHEESE && !mouse.cheeses.has(cellKey(x, y))) ? 1 : 0;
        values.push(unknown, wall, danger, reward);
      }
      return values;
    }

    function localKnowledge(mouse) {
      const map = ensureCognitiveMap(mouse);
      let unknown = 0;
      let knownSafe = 0;
      for (const d of DIRS) {
        const x = mouse.x + d.x;
        const y = mouse.y + d.y;
        if (!inBounds(x, y)) continue;
        const code = map.cells.get(memoryKey(x, y));
        if (code === undefined) unknown++;
        else if (memoryIsSafe(code)) knownSafe++;
      }
      return {
        frontierHere: unknown > 0 ? 1 : 0,
        exhausted: unknown === 0 ? 1 : 0,
        deadEnd: unknown === 0 && knownSafe <= 1 ? 1 : 0
      };
    }

    function routeSignal(route) {
      const values = [0, 0, 0, 0];
      if (route && route.firstDir >= 0) values[route.firstDir] = 1;
      const proximity = route ? 1 / (1 + route.distance / 8) : 0;
      values.push(proximity, route ? 1 : 0);
      return values;
    }

    function scanKnownRoutes(mouse) {
      const map = ensureCognitiveMap(mouse);
      if (map.nav && mouse.step - map.navStep < V13_NAV_REFRESH_STEPS) return map.nav;

      const start = memoryKey(mouse.x, mouse.y);
      const queueKeys = [start];
      const queueFirst = [-1];
      const queueDistance = [0];
      const seen = new Set([start]);
      let head = 0;
      let frontier = null;
      let cheese = null;
      let goal = null;

      const needFrontier = map.frontiers.size > (map.frontiers.has(start) ? 1 : 0);
      let needCheese = false;
      for (const key of map.knownCheese) {
        if (!mouse.cheeses.has(cellKey(keyX(key), keyY(key)))) {
          needCheese = true;
          break;
        }
      }
      const needGoal = map.knownGoal !== null;

      while (head < queueKeys.length &&
        ((!frontier && needFrontier) || (!cheese && needCheese) || (!goal && needGoal))) {
        const key = queueKeys[head];
        const firstDir = queueFirst[head];
        const distance = queueDistance[head];
        head++;

        const x = keyX(key);
        const y = keyY(key);
        const code = map.cells.get(key);

        if (!frontier && key !== start && map.frontiers.has(key)) {
          frontier = { firstDir, distance, key };
        }
        if (!cheese && code === V13_MEMORY.CHEESE && !mouse.cheeses.has(cellKey(x, y))) {
          cheese = { firstDir, distance, key };
        }
        if (!goal && code === V13_MEMORY.GOAL) {
          goal = { firstDir, distance, key };
        }

        for (let dir = 0; dir < DIRS.length; dir++) {
          const d = DIRS[dir];
          const nx = x + d.x;
          const ny = y + d.y;
          if (!inBounds(nx, ny)) continue;
          const nkey = memoryKey(nx, ny);
          if (seen.has(nkey)) continue;
          const ncode = map.cells.get(nkey);
          if (!memoryIsSafe(ncode)) continue;
          seen.add(nkey);
          queueKeys.push(nkey);
          queueFirst.push(firstDir < 0 ? dir : firstDir);
          queueDistance.push(distance + 1);
        }
      }

      map.nav = { frontier, cheese, goal };
      map.navStep = mouse.step;
      return map.nav;
    }

    function v13BrainInputs(mouse) {
      const inputs = observeVision(mouse);

      const dx = state.goal.x - mouse.x;
      const dy = state.goal.y - mouse.y;
      const bearingScale = Math.max(1, Math.abs(dx), Math.abs(dy));
      inputs.push(dx / bearingScale, dy / bearingScale);
      inputs.push(currentProgressOf(mouse));

      for (let d = 0; d < 4; d++) inputs.push(mouse.lastDir === d ? 1 : 0);
      inputs.push(mouse.lastWallHit ? 1 : 0);
      for (const d of DIRS) inputs.push(recentnessOf(mouse, mouse.x + d.x, mouse.y + d.y));
      inputs.push(Math.min(1, mouse.staleSteps / stagnationLimit()));

      inputs.push(...adjacentMemoryInputs(mouse));
      const routes = scanKnownRoutes(mouse);
      inputs.push(...routeSignal(routes.frontier));
      inputs.push(...routeSignal(routes.cheese));
      inputs.push(...routeSignal(routes.goal));

      const local = localKnowledge(mouse);
      inputs.push(local.frontierHere, local.exhausted, local.deadEnd);
      return inputs;
    }

    function v13DecideMove(mouse) {
      const inputs = v13BrainInputs(mouse);
      const hidden = new Float32Array(V13_HIDDEN);
      const outputs = new Float32Array(V13_OUTPUTS);
      const genome = mouse.genome;
      let wi = 0;

      for (let h = 0; h < V13_HIDDEN; h++) {
        let sum = 0;
        for (let i = 0; i < V13_INPUTS; i++) sum += inputs[i] * (genome[wi++] ?? 0);
        sum += genome[wi++] ?? 0;
        hidden[h] = Math.tanh(sum);
      }

      for (let o = 0; o < V13_OUTPUTS; o++) {
        let sum = 0;
        for (let h = 0; h < V13_HIDDEN; h++) sum += hidden[h] * (genome[wi++] ?? 0);
        outputs[o] = sum + (genome[wi++] ?? 0);
      }

      let bestDir = 0;
      for (let o = 1; o < V13_OUTPUTS; o++) {
        if (outputs[o] > outputs[bestDir]) bestDir = o;
      }

      // Keep the existing anti-vibration guardrails. The cognitive map gives the
      // brain a better reason to choose alternatives; these remain only a UX safety net.
      if (mouse.reverseStreak > 0 && isImmediateReverse(mouse, bestDir) && !isValuableImmediateTarget(mouse, bestDir)) {
        const alternative = bestSafeAlternative(mouse, outputs, bestDir, false);
        if (alternative >= 0) bestDir = alternative;
      }

      const shortRetrace = wouldCompleteShortRetrace(mouse, bestDir);
      const axisOscillation = wouldContinueAxisOscillation(mouse, bestDir);
      if ((shortRetrace || axisOscillation) && !isValuableImmediateTarget(mouse, bestDir)) {
        let alternative = -1;
        if (axisOscillation) alternative = bestSafeAlternative(mouse, outputs, bestDir, true);
        if (alternative < 0) alternative = bestSafeAlternative(mouse, outputs, bestDir, false);
        if (alternative >= 0) bestDir = alternative;
      }
      return bestDir;
    }

    const previousTickMouse = tickMouse;
    tickMouse = function (mouse) {
      const beforeX = mouse.x;
      const beforeY = mouse.y;
      previousTickMouse(mouse);
      if (!mouse.cognitiveMap) return;
      if (mouse.x !== beforeX || mouse.y !== beforeY) {
        rememberCell(mouse, mouse.x, mouse.y, actualMemoryCode(mouse.x, mouse.y));
      }
    };

    randomGenome = v13RandomGenome;
    breedGenome = v13BreedGenome;
    brainInputs = v13BrainInputs;
    decideMove = v13DecideMove;
  })();
