  // EvoMaus v1.1 roaming pass: true field-of-view memory and no-target productivity pressure.
  (() => {
    const V20_RADIUS = 16;
    const V20_CHEESE_REDUCTION = 3000; // v15 awards 6000; subtracting leaves 3000 net.
    const V20_NO_TARGET_WARN = 32;
    const V20_NO_TARGET_SEVERE = 64;
    const V20_NO_TARGET_KILL = 96;
    const V20_WARN_PENALTY = 4500;
    const V20_SEVERE_PENALTY = 12000;
    const V20_WARN_STALE = 34;
    const V20_SEVERE_STALE = 82;

    const MEMORY_FLOOR = 1;
    const MEMORY_WALL = 2;
    const MEMORY_DANGER = 3;
    const MEMORY_CHEESE = 4;
    const MEMORY_GOAL = 5;

    const OCTANTS = [
      [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
      [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1]
    ];

    function v20Key(x, y) {
      return y * GRID_W + x;
    }

    function v20Safe(code) {
      return code === MEMORY_FLOOR || code === MEMORY_CHEESE || code === MEMORY_GOAL;
    }

    function v20ActualCode(x, y) {
      if (state.goal && x === state.goal.x && y === state.goal.y) return MEMORY_GOAL;
      const type = getCell(x, y);
      if (type === CELL.WALL) return MEMORY_WALL;
      if (type === CELL.DANGER) return MEMORY_DANGER;
      if (type === CELL.CHEESE) return MEMORY_CHEESE;
      return MEMORY_FLOOR;
    }

    function v20EnsureMap(mouse) {
      if (mouse.cognitiveMap) return mouse.cognitiveMap;
      mouse.cognitiveMap = {
        cells: new Map(),
        frontiers: new Set(),
        revision: 0,
        knownGoal: null,
        knownCheese: new Set(),
        nav: null,
        navStep: -Infinity
      };
      return mouse.cognitiveMap;
    }

    function v20Remember(mouse, x, y, touched) {
      if (!inBounds(x, y)) return false;
      const map = v20EnsureMap(mouse);
      const key = v20Key(x, y);
      const code = v20ActualCode(x, y);
      if (map.cells.get(key) === code) return false;

      map.cells.set(key, code);
      map.revision = (map.revision || 0) + 1;
      if (code === MEMORY_GOAL) map.knownGoal = key;
      if (code === MEMORY_CHEESE) map.knownCheese.add(key);
      else map.knownCheese.delete(key);

      touched.add(key);
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (inBounds(nx, ny)) touched.add(v20Key(nx, ny));
      }
      return true;
    }

    function v20RefreshFrontierKey(map, key) {
      const x = key % GRID_W;
      const y = Math.floor(key / GRID_W);
      const code = map.cells.get(key);
      const was = map.frontiers.has(key);
      let is = false;

      if (v20Safe(code)) {
        for (const d of DIRS) {
          const nx = x + d.x;
          const ny = y + d.y;
          if (!inBounds(nx, ny)) continue;
          if (!map.cells.has(v20Key(nx, ny))) {
            is = true;
            break;
          }
        }
      }

      if (is) map.frontiers.add(key);
      else map.frontiers.delete(key);
      return was !== is;
    }

    function v20RevealFov(mouse) {
      const map = v20EnsureMap(mouse);
      const originKey = v20Key(mouse.x, mouse.y);
      if (mouse.v20FovOrigin === originKey) return 0;
      mouse.v20FovOrigin = originKey;

      const touched = new Set();
      let learned = 0;
      if (v20Remember(mouse, mouse.x, mouse.y, touched)) learned++;

      function castLight(row, startSlope, endSlope, xx, xy, yx, yy) {
        if (startSlope < endSlope) return;
        let start = startSlope;

        for (let distance = row; distance <= V20_RADIUS; distance++) {
          let blocked = false;
          let newStart = start;
          let dx = -distance - 1;
          const dy = -distance;

          while (dx <= 0) {
            dx++;
            const x = mouse.x + dx * xx + dy * xy;
            const y = mouse.y + dx * yx + dy * yy;
            const leftSlope = (dx - 0.5) / (dy + 0.5);
            const rightSlope = (dx + 0.5) / (dy - 0.5);

            if (start < rightSlope) continue;
            if (endSlope > leftSlope) break;
            if (!inBounds(x, y)) continue;

            const withinRadius = dx * dx + dy * dy <= V20_RADIUS * V20_RADIUS;
            const wall = getCell(x, y) === CELL.WALL;
            if (withinRadius && v20Remember(mouse, x, y, touched)) learned++;

            if (blocked) {
              if (wall) {
                newStart = rightSlope;
                continue;
              }
              blocked = false;
              start = newStart;
            } else if (wall && distance < V20_RADIUS) {
              blocked = true;
              castLight(distance + 1, start, leftSlope, xx, xy, yx, yy);
              newStart = rightSlope;
            }
          }

          if (blocked) break;
        }
      }

      for (const [xx, xy, yx, yy] of OCTANTS) castLight(1, 1, 0, xx, xy, yx, yy);

      let frontierChanged = false;
      for (const key of touched) {
        if (v20RefreshFrontierKey(map, key)) frontierChanged = true;
      }

      if (learned || frontierChanged) {
        // app-8 caches known-map routes for a few steps. Full FOV can reveal a new
        // corridor immediately, so force the next brain decision to route against
        // the newly contiguous memory instead of an old ray-sampled route.
        map.nav = null;
        map.navStep = -Infinity;
      }

      return learned;
    }

    function v20InitRoaming(mouse) {
      if (!mouse.noTargetAudit) {
        mouse.noTargetAudit = {
          travel: 0,
          stage: 0,
          strikes: 0
        };
      }
      if (!Number.isFinite(mouse.noTargetShaping)) mouse.noTargetShaping = 0;
      return mouse;
    }

    function v20TargetFromNav(mouse) {
      const nav = mouse.cognitiveMap?.nav;
      if (!nav) return null;
      if (nav.goal) return { kind: 'goal', key: nav.goal.key, distance: nav.goal.distance };
      if (nav.frontier) return { kind: 'frontier', key: nav.frontier.key, distance: nav.frontier.distance };
      if (nav.cheese) return { kind: 'cheese', key: nav.cheese.key, distance: nav.cheese.distance };
      return null;
    }

    function v20ResetNoTarget(mouse) {
      const audit = mouse.noTargetAudit;
      audit.travel = 0;
      audit.stage = 0;
    }

    function v20ApplyNoTargetStage(mouse, stage) {
      const audit = mouse.noTargetAudit;
      if (stage <= audit.stage) return false;
      audit.stage = stage;
      audit.strikes++;

      if (stage === 1) {
        mouse.noTargetShaping -= V20_WARN_PENALTY;
        let stale = mouse.balanceStale ?? mouse.staleSteps ?? 0;
        stale += V20_WARN_STALE;
        mouse.balanceStale = stale;
        mouse.staleSteps = stale;
      } else if (stage === 2) {
        mouse.noTargetShaping -= V20_SEVERE_PENALTY;
        let stale = mouse.balanceStale ?? mouse.staleSteps ?? 0;
        stale += V20_SEVERE_STALE;
        mouse.balanceStale = stale;
        mouse.staleSteps = stale;
      } else {
        killMouse(mouse, 'stagnation');
        return true;
      }

      if ((mouse.balanceStale ?? mouse.staleSteps ?? 0) >= stagnationLimit()) {
        killMouse(mouse, 'stagnation');
        return true;
      }
      return false;
    }

    const previousMakeMouseV20 = makeMouse;
    makeMouse = function (genome, generation, parentIds = [], lineage = null) {
      const mouse = v20InitRoaming(previousMakeMouseV20(genome, generation, parentIds, lineage));
      v20RevealFov(mouse);
      return mouse;
    };

    const previousComputeFitnessV20 = computeFitness;
    computeFitness = function (mouse) {
      v20InitRoaming(mouse);
      const base = previousComputeFitnessV20(mouse);
      const score = base - (mouse.cheeseCount || 0) * V20_CHEESE_REDUCTION + mouse.noTargetShaping;
      mouse.fitness = score;
      return score;
    };

    const previousTickMouseV20 = tickMouse;
    tickMouse = function (mouse) {
      if (!mouse.alive) return;
      v20InitRoaming(mouse);

      const beforeX = mouse.x;
      const beforeY = mouse.y;
      const beforeRevision = mouse.cognitiveMap?.revision || 0;
      const beforeVisited = mouse.visited?.size || 0;
      const beforeCheese = mouse.cheeseCount || 0;
      const beforeBestDistance = mouse.bestDistance;

      previousTickMouseV20(mouse);
      if (!mouse.alive) return;

      // The brain has just made its move using the previous field of view. Now reveal
      // the complete visible floorplan from the new square for its next decision.
      const target = v20TargetFromNav(mouse);
      v20RevealFov(mouse);

      const moved = mouse.x !== beforeX || mouse.y !== beforeY;
      const learned = (mouse.cognitiveMap?.revision || 0) > beforeRevision;
      const newVisited = (mouse.visited?.size || 0) > beforeVisited;
      const newCheese = (mouse.cheeseCount || 0) > beforeCheese;
      const improvedGoal = Number.isFinite(beforeBestDistance) && mouse.bestDistance < beforeBestDistance;

      // app-13 already audits mice that have a real remembered route. This closes
      // the loophole seen in the recordings: no routable target is no longer an
      // exemption from proving that all this movement actually achieved something.
      if (target || learned || newVisited || newCheese || improvedGoal) {
        v20ResetNoTarget(mouse);
      } else if (moved) {
        const audit = mouse.noTargetAudit;
        audit.travel++;

        if (audit.travel >= V20_NO_TARGET_KILL) {
          if (v20ApplyNoTargetStage(mouse, 3)) return;
        } else if (audit.travel >= V20_NO_TARGET_SEVERE) {
          if (v20ApplyNoTargetStage(mouse, 2)) return;
        } else if (audit.travel >= V20_NO_TARGET_WARN) {
          if (v20ApplyNoTargetStage(mouse, 1)) return;
        }
      }

      computeFitness(mouse);
      recordMilestones(mouse);
    };

    state.balanceV20 = {
      visionRadius: V20_RADIUS,
      netCheeseReward: 3000,
      noTargetAudit: {
        warn: V20_NO_TARGET_WARN,
        severe: V20_NO_TARGET_SEVERE,
        kill: V20_NO_TARGET_KILL
      }
    };
  })();
