  const toolHelp = document.getElementById('toolHelp');
  const TOOL_HELP = Object.freeze({
    wall: 'Tap or drag to place walls.',
    cheese: 'Place cheese to reward useful routes.',
    danger: 'Danger kills mice instantly.',
    goal: 'Place the finish. Only one goal can exist.',
    eraser: 'Tap or drag to erase blocks.'
  });

  function updateToolHelp(message = null) {
    if (!toolHelp) return;
    toolHelp.textContent = message || TOOL_HELP[state.tool] || '';
  }

  function activateSinglePointer(pointer) {
    if (!pointer || state.mode !== 'edit' || state.pointers.size > 1) return;
    state.lastPaintKey = null;
    if (isPointerOnStart(pointer)) {
      state.draggingStart = true;
      updateToolHelp('Drag the mouse to move the start point.');
      relocateStart(pointer);
    } else {
      state.drawing = true;
      paintAtPointer(pointer);
    }
  }

  function cancelPendingSingleTouch() {
    if (!state.pendingSingleTouch) return;
    clearTimeout(state.pendingSingleTouch.timer);
    state.pendingSingleTouch = null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    state.pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (state.mode !== 'edit') return;

    if (state.pointers.size === 1) {
      const pointer = state.pointers.get(e.pointerId);
      if (e.pointerType === 'touch') {
        cancelPendingSingleTouch();
        const timer = setTimeout(() => {
          if (state.pendingSingleTouch?.pointerId !== e.pointerId) return;
          state.pendingSingleTouch = null;
          activateSinglePointer(state.pointers.get(e.pointerId));
        }, 85);
        state.pendingSingleTouch = { pointerId: e.pointerId, timer };
      } else {
        activateSinglePointer(pointer);
      }
    } else if (state.pointers.size === 2) {
      cancelPendingSingleTouch();
      beginTwoFingerGesture();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.pointers.has(e.pointerId)) return;
    const rect = canvas.getBoundingClientRect();
    state.pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (state.mode !== 'edit') return;
    if (state.pointers.size >= 2) {
      if (!state.gesture) beginTwoFingerGesture();
      updateTwoFingerGesture();
      return;
    }

    const pointer = state.pointers.get(e.pointerId);
    if (state.draggingStart) relocateStart(pointer);
    else if (state.drawing) paintAtPointer(pointer);
  });

  function endPointer(e) {
    // A very quick one-finger tap may end before the short gesture-disambiguation delay.
    // Treat it as a paint/drag tap unless a second finger turned it into a pan/pinch.
    if (state.pendingSingleTouch?.pointerId === e.pointerId && state.pointers.size === 1) {
      clearTimeout(state.pendingSingleTouch.timer);
      state.pendingSingleTouch = null;
      activateSinglePointer(state.pointers.get(e.pointerId));
    } else if (state.pendingSingleTouch?.pointerId === e.pointerId) {
      cancelPendingSingleTouch();
    }

    state.pointers.delete(e.pointerId);
    if (state.pointers.size < 2) state.gesture = null;
    if (state.pointers.size === 0) {
      state.drawing = false;
      state.draggingStart = false;
      state.lastPaintKey = null;
      updateToolHelp();
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    if (state.mode !== 'edit') return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const before = screenToWorld(px, py);
    const factor = Math.exp(-e.deltaY * 0.0012);
    state.view.scale = Math.max(7, Math.min(72, state.view.scale * factor));
    const after = screenToWorld(px, py);
    state.view.cx += before.x - after.x;
    state.view.cy += before.y - after.y;
    clampView();
  }, { passive: false });

  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool;
      toolButtons.forEach(b => b.classList.toggle('active', b === btn));
      updateToolHelp();
    });
  });

  populationInput.addEventListener('input', () => {
    state.populationSize = Number(populationInput.value);
    populationValue.textContent = String(state.populationSize);
    saveMazeSoon();
  });

  clearButton.addEventListener('click', () => {
    if (!confirm('Clear every wall, cheese, danger tile and the goal? The start mouse stays put.')) return;
    state.cells.clear();
    state.goal = null;
    saveMaze();
    showToast('Maze cleared. The mouse survives another day.');
  });

  homeButton.addEventListener('click', centreOnStart);
  updateToolHelp();
