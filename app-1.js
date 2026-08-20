  'use strict';

  const GRID_W = 256;
  const GRID_H = 256;
  const STORAGE_KEY = 'evomaus-v1-maze';
  const DIRS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 }
  ];
  const CELL = Object.freeze({ WALL: 'wall', CHEESE: 'cheese', DANGER: 'danger' });
  const WALL_DEATH_HITS = 10;

  const canvas = document.getElementById('mazeCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const stage = document.getElementById('stage');
  const toast = document.getElementById('toast');
  const toolButtons = [...document.querySelectorAll('.tool')];
  const populationInput = document.getElementById('population');
  const populationValue = document.getElementById('populationValue');
  const startButton = document.getElementById('startButton');
  const pauseButton = document.getElementById('pauseButton');
  const speedButton = document.getElementById('speedButton');
  const editButton = document.getElementById('editButton');
  const resetEvolutionButton = document.getElementById('resetEvolutionButton');
  const homeButton = document.getElementById('homeButton');
  const clearButton = document.getElementById('clearButton');
  const genStat = document.getElementById('genStat');
  const aliveStat = document.getElementById('aliveStat');
  const progressStat = document.getElementById('progressStat');
  const cheeseStat = document.getElementById('cheeseStat');
  const wallStat = document.getElementById('wallStat');

  const state = {
    mode: 'edit',
    tool: 'wall',
    cells: new Map(),
    start: { x: 8, y: 8 },
    goal: null,
    populationSize: 80,
    view: { cx: 8.5, cy: 8.5, scale: 31 },
    pointers: new Map(),
    gesture: null,
    drawing: false,
    draggingStart: false,
    lastPaintKey: null,
    pendingSingleTouch: null,
    distanceMap: null,
    startDistance: 0,
    maxSteps: 500,
    generation: 1,
    mice: [],
    paused: false,
    speedIndex: 0,
    speeds: [1, 2, 4, 8],
    tickAccumulator: 0,
    lastFrameTime: performance.now(),
    generationCooldown: 0,
    trackedMouseId: null,
    bestEver: null,
    stagnation: 0,
    lastBestProgress: -1,
    firstGoalGeneration: null,
    nextMouseId: 1,
    toastTimer: null
  };

  function cellKey(x, y) { return `${x},${y}`; }
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H; }
  function getCell(x, y) { return state.cells.get(cellKey(x, y)) || null; }
  function setCell(x, y, type) {
    if (!inBounds(x, y)) return;
    if (x === state.start.x && y === state.start.y) return;
    const key = cellKey(x, y);
    if (type === 'eraser') {
      state.cells.delete(key);
      if (state.goal && state.goal.x === x && state.goal.y === y) state.goal = null;
      saveMazeSoon();
      return;
    }
    if (type === 'goal') {
      if (state.goal) state.cells.delete(cellKey(state.goal.x, state.goal.y));
      state.goal = { x, y };
      state.cells.delete(key);
      saveMazeSoon();
      return;
    }
    if (state.goal && state.goal.x === x && state.goal.y === y) state.goal = null;
    state.cells.set(key, type);
    saveMazeSoon();
  }

  let saveTimer = null;
  function saveMazeSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveMaze, 100);
  }

  function saveMaze() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        start: state.start,
        goal: state.goal,
        populationSize: state.populationSize,
        cells: [...state.cells.entries()]
      }));
    } catch (_) {}
  }

  function loadMaze() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return;
      if (data.start && inBounds(data.start.x, data.start.y)) state.start = data.start;
      if (data.goal && inBounds(data.goal.x, data.goal.y)) state.goal = data.goal;
      if (Array.isArray(data.cells)) {
        state.cells = new Map(data.cells.filter(([key, type]) => {
          return typeof key === 'string' && [CELL.WALL, CELL.CHEESE, CELL.DANGER].includes(type);
        }));
      }
      if (Number.isFinite(data.populationSize)) {
        state.populationSize = Math.min(250, Math.max(5, Math.round(data.populationSize / 5) * 5));
      }
      state.view.cx = state.start.x + 0.5;
      state.view.cy = state.start.y + 0.5;
    } catch (_) {}
  }

  function showToast(message, tone = '') {
    clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.className = tone ? `show ${tone}` : 'show';
    state.toastTimer = setTimeout(() => { toast.className = ''; }, 2300);
  }

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function screenToWorld(px, py) {
    const rect = canvas.getBoundingClientRect();
    const x = state.view.cx + (px - rect.width / 2) / state.view.scale;
    const y = state.view.cy + (py - rect.height / 2) / state.view.scale;
    return { x, y };
  }

  function worldToScreen(wx, wy) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.width / 2 + (wx - state.view.cx) * state.view.scale,
      y: rect.height / 2 + (wy - state.view.cy) * state.view.scale
    };
  }

  function screenToCell(px, py) {
    const w = screenToWorld(px, py);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  function clampView() {
    state.view.cx = Math.max(-2, Math.min(GRID_W + 2, state.view.cx));
    state.view.cy = Math.max(-2, Math.min(GRID_H + 2, state.view.cy));
    state.view.scale = Math.max(7, Math.min(72, state.view.scale));
  }

  function centreOnStart() {
    state.view.cx = state.start.x + 0.5;
    state.view.cy = state.start.y + 0.5;
    if (state.mode === 'edit') state.view.scale = Math.max(state.view.scale, 26);
    clampView();
  }

  function paintAtPointer(pointer) {
    const cell = screenToCell(pointer.x, pointer.y);
    if (!inBounds(cell.x, cell.y)) return;
    const key = cellKey(cell.x, cell.y);
    if (state.lastPaintKey === key) return;
    state.lastPaintKey = key;
    setCell(cell.x, cell.y, state.tool);
  }

  function isPointerOnStart(pointer) {
    const w = screenToWorld(pointer.x, pointer.y);
    return Math.abs(w.x - (state.start.x + 0.5)) < 0.48 && Math.abs(w.y - (state.start.y + 0.5)) < 0.48;
  }

  function relocateStart(pointer) {
    const cell = screenToCell(pointer.x, pointer.y);
    if (!inBounds(cell.x, cell.y)) return;
    if (state.goal && cell.x === state.goal.x && cell.y === state.goal.y) return;
    state.start = { x: cell.x, y: cell.y };
    state.cells.delete(cellKey(cell.x, cell.y));
    saveMazeSoon();
  }

  function beginTwoFingerGesture() {
    const pts = [...state.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    state.gesture = {
      startScale: state.view.scale,
      startCx: state.view.cx,
      startCy: state.view.cy,
      startMid: mid,
      startDist: Math.max(1, dist),
      anchorWorld: screenToWorld(mid.x, mid.y)
    };
    state.drawing = false;
    state.draggingStart = false;
    state.lastPaintKey = null;
  }

  function updateTwoFingerGesture() {
    const pts = [...state.pointers.values()];
    if (pts.length < 2 || !state.gesture) return;
    const [a, b] = pts;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(7, Math.min(72, state.gesture.startScale * (dist / state.gesture.startDist)));
    state.view.scale = scale;
    state.view.cx = state.gesture.anchorWorld.x - (mid.x - rect.width / 2) / scale;
    state.view.cy = state.gesture.anchorWorld.y - (mid.y - rect.height / 2) / scale;
    clampView();
  }
