// EvoMaus v1.3 editor continuity pass: consistent start/edit controls and leader-only inspection.
(() => {
  const titleRow = document.querySelector('.titleRow');
  const titleActions = document.querySelector('.editorTitleActions');
  const editorControls = document.querySelector('.editorControls');
  const stage = document.getElementById('stage');
  const startButton = document.getElementById('startButton');
  const resetButton = document.getElementById('stopEditButton');
  const randomButton = document.getElementById('v13RandomEditorButton');
  const clearButton = document.getElementById('clearButton');
  const populationBox = document.querySelector('.populationBox');
  const lineageStats = document.querySelector('.lineageEditStats');
  const inspector = document.getElementById('v13Inspector');

  if (titleRow && titleActions && startButton) {
    titleActions.classList.add('v135EditorHeaderActions');

    const primary = document.createElement('div');
    primary.className = 'v135EditorPrimary';
    const secondary = document.createElement('div');
    secondary.className = 'v135EditorSecondary';

    primary.appendChild(startButton);

    if (randomButton) {
      randomButton.textContent = '🎲 Random';
      randomButton.title = 'Generate random maze';
      randomButton.classList.remove('v132RandomEditorAction');
      randomButton.classList.add('secondary', 'v135RandomButton');
      secondary.appendChild(randomButton);
    }

    if (clearButton) {
      clearButton.textContent = '⌫ Clear';
      clearButton.title = 'Clear maze';
      clearButton.classList.remove('floatButton');
      clearButton.classList.add('secondary', 'v135ClearButton');
      secondary.appendChild(clearButton);
    }

    if (resetButton) {
      resetButton.textContent = '↺ Reset';
      resetButton.title = 'Reset everything';
      resetButton.classList.add('v135ResetButton');
      secondary.appendChild(resetButton);
    }

    titleActions.replaceChildren(primary, secondary);
  }

  // Population control and the suspended-run lineage snapshot are both editor status,
  // so keep them in the same bottom dock rather than consuming header height.
  if (stage && (populationBox || lineageStats)) {
    const dock = document.createElement('div');
    dock.id = 'v135EditorBottom';
    dock.className = 'v135EditorBottom';
    if (populationBox) dock.appendChild(populationBox);
    if (lineageStats) dock.appendChild(lineageStats);
    stage.appendChild(dock);
  }

  // If the legacy floating container is empty after moving Clear (Home was already
  // removed by the previous pass), remove the container as well.
  document.querySelector('.floating:empty')?.remove();

  const lineageOf = mouse => mouse?.lineage || 'grey';

  function currentLeader() {
    const selected = state.mice.find(mouse => mouse.id === state.v13SelectedMouseId);
    const tracked = state.mice.find(mouse => mouse.id === state.trackedMouseId);
    return selected || tracked || null;
  }

  function rewriteInspector() {
    if (!inspector) return;
    const leader = currentLeader();
    const title = inspector.querySelector('.v13InspectorTitle strong');

    if (title && leader) {
      const wanted = `${lineageOf(leader).toUpperCase()} LEADER`;
      if (title.textContent !== wanted) title.textContent = wanted;
      return;
    }

    if (!title) {
      const strong = inspector.querySelector(':scope > strong');
      const hint = inspector.querySelector(':scope > span');
      if (strong && strong.textContent !== 'Inspect a leader') strong.textContent = 'Inspect a leader';
      if (hint && hint.textContent !== 'Tap a lineage above.') hint.textContent = 'Tap a lineage above.';
    }
  }

  if (inspector) {
    new MutationObserver(() => requestAnimationFrame(rewriteInspector)).observe(inspector, { childList: true, subtree: true });
    rewriteInspector();
  }

  const previousUpdateStatsV135 = updateStats;
  updateStats = function () {
    previousUpdateStatsV135();
    rewriteInspector();
  };

  // The old pause copy still refers to tapping arbitrary mice. Lineage cards are now
  // the sole selection model, so correct any remaining stale instructional text.
  for (const node of document.querySelectorAll('#v13PauseOverlay span')) {
    if (/tap a mouse/i.test(node.textContent || '')) node.textContent = 'Tap a lineage above.';
  }

  document.body.classList.add('v135Ready');
})();
