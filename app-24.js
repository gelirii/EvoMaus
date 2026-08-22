// EvoMaus v1.3 continuity pass: per-lineage population, consistent HUDs and inherited-champion camera.
(() => {
  const LINEAGES = ['white', 'grey', 'black'];
  const populationInput = document.getElementById('population');
  const populationValue = document.getElementById('populationValue');
  const populationBox = document.querySelector('.populationBox');
  const titleRow = document.querySelector('.titleRow');
  const titleActions = document.querySelector('.editorTitleActions');
  const secondaryRow = document.querySelector('.v135EditorSecondary');
  const startButton = document.getElementById('startButton');
  const resetButton = document.getElementById('stopEditButton');
  const clearButton = document.getElementById('clearButton');
  const randomButton = document.getElementById('v13RandomEditorButton');
  const genChip = document.getElementById('genStat')?.closest('.statChip');
  const pauseOverlay = document.getElementById('v13PauseOverlay');
  const pauseLineages = document.getElementById('v13PauseLineages');
  const liveLineages = document.getElementById('v13LiveLineages');
  const inspector = document.getElementById('v13Inspector');

  const lineageOf = mouse => mouse?.lineage || 'grey';
  const clampPerLineage = value => Math.max(5, Math.min(125, Math.round(value)));

  // ---------------------------------------------------------------------------
  // Population is now expressed in mice PER lineage. Internally EvoMaus still
  // keeps a single total so the evolution code remains unchanged and each colour
  // receives exactly the requested number of mice.
  function syncPopulationUiFromTotal(forceDefault = false) {
    if (!populationInput || !populationValue || !populationBox) return;
    let perLineage;
    if (forceDefault || state.populationSize === 80) perLineage = 25;
    else perLineage = clampPerLineage(state.populationSize / 3);

    state.populationSize = perLineage * 3;
    populationInput.min = '5';
    populationInput.max = '125';
    populationInput.step = '1';
    populationInput.value = String(perLineage);
    populationValue.textContent = String(perLineage);

    const label = populationBox.querySelector(':scope > span');
    if (label) label.textContent = 'Mice / species';

    let total = populationBox.querySelector('.v136PopulationTotal');
    if (!total) {
      total = document.createElement('small');
      total.className = 'v136PopulationTotal';
      populationBox.appendChild(total);
    }
    total.textContent = `${state.populationSize} total`;
  }

  syncPopulationUiFromTotal();
  saveMazeSoon();

  populationInput?.addEventListener('input', () => {
    const perLineage = clampPerLineage(Number(populationInput.value));
    state.populationSize = perLineage * 3;
    populationValue.textContent = String(perLineage);
    const total = populationBox?.querySelector('.v136PopulationTotal');
    if (total) total.textContent = `${state.populationSize} total`;
    saveMazeSoon();
  });

  // resumeEditedGeneration writes the legacy total back into the range control.
  // Correct only the presentation afterwards; the suspended population itself is
  // deliberately preserved exactly.
  const previousResumeEditedGenerationV136 = resumeEditedGeneration;
  resumeEditedGeneration = function () {
    previousResumeEditedGenerationV136();
    syncPopulationUiFromTotal();
  };

  // ---------------------------------------------------------------------------
  // One editor grammar: title+generation+primary action, then
  // Random | Clear | Reset, then the five drawing tools.
  if (titleRow && secondaryRow) {
    secondaryRow.classList.add('v136EditorSecondaryRow');
    titleRow.insertAdjacentElement('afterend', secondaryRow);
  }

  if (secondaryRow) {
    if (randomButton) secondaryRow.appendChild(randomButton);
    if (clearButton) secondaryRow.appendChild(clearButton);
    if (resetButton) secondaryRow.appendChild(resetButton);
  }

  function normaliseEditorPrimaryText() {
    if (!startButton) return;
    const wanted = state.suspendedRun || document.body.classList.contains('editing-run') ? '▶ Resume' : '▶ Start';
    if (startButton.textContent !== wanted) startButton.textContent = wanted;
  }

  if (startButton) {
    new MutationObserver(normaliseEditorPrimaryText).observe(startButton, { childList: true, characterData: true, subtree: true });
  }
  document.getElementById('editButton')?.addEventListener('click', () => setTimeout(normaliseEditorPrimaryText, 0));
  document.getElementById('resetEvolutionButton')?.addEventListener('click', () => setTimeout(normaliseEditorPrimaryText, 0));
  resetButton?.addEventListener('click', () => setTimeout(normaliseEditorPrimaryText, 0));
  normaliseEditorPrimaryText();

  // Generation belongs beside the product identity in every state, including the
  // fresh editor and suspended editor. It never migrates into a Resume button.
  if (genChip) genChip.classList.add('v136GenerationAlways');

  // ---------------------------------------------------------------------------
  // Pause stays compact until a lineage is explicitly tapped.
  let pauseWasOpen = false;
  let pauseHint = null;
  if (pauseLineages) {
    pauseHint = document.createElement('div');
    pauseHint.className = 'v136PauseHint';
    pauseHint.textContent = 'Tap a lineage above for leader details.';
    pauseLineages.insertAdjacentElement('afterend', pauseHint);
  }

  if (pauseOverlay) {
    new MutationObserver(() => {
      const open = pauseOverlay.classList.contains('show');
      if (open && !pauseWasOpen) document.body.classList.remove('v136PauseInspecting');
      if (!open) document.body.classList.remove('v136PauseInspecting');
      pauseWasOpen = open;
    }).observe(pauseOverlay, { attributes: true, attributeFilter: ['class'] });
  }

  pauseLineages?.addEventListener('click', event => {
    if (event.target.closest('[data-v131-lineage],[data-v13-lineage]')) {
      document.body.classList.add('v136PauseInspecting');
    }
  }, true);

  if (inspector) {
    for (const node of inspector.querySelectorAll('span')) {
      if (/tap a mouse/i.test(node.textContent || '')) node.textContent = 'Tap a lineage above.';
    }
  }

  // ---------------------------------------------------------------------------
  // Camera inheritance. Each lineage already copies its best one/two genomes
  // unchanged into the next generation. Record the overall winner before breeding,
  // then follow the exact elite child whose sole parent is that champion.
  function bestOverall(mice = state.mice) {
    let best = null;
    for (const mouse of mice) if (!best || computeFitness(mouse) > computeFitness(best)) best = mouse;
    return best;
  }

  function bestAliveInLineage(lineage) {
    let best = null;
    for (const mouse of state.mice) {
      if (!mouse.alive || lineageOf(mouse) !== lineage) continue;
      if (!best || computeFitness(mouse) > computeFitness(best)) best = mouse;
    }
    return best;
  }

  function setTracked(mouse, manualLineage = null) {
    if (!mouse) return;
    state.trackedMouseId = mouse.id;
    state.v13SelectedMouseId = mouse.id;
    state.v133SelectedLineage = lineageOf(mouse);
    state.v136ManualLineage = manualLineage;
    state.freeCamera = false;
  }

  state.v136CameraGeneration = state.generation;
  state.v136PendingChampion = null;
  state.v136ManualLineage = null;
  state.v136InitialAutoChosen = false;

  const previousBeginNextGenerationV136 = beginNextGeneration;
  beginNextGeneration = function () {
    const champion = bestOverall();
    if (champion) {
      state.v136PendingChampion = {
        id: champion.id,
        lineage: lineageOf(champion),
        generation: state.generation
      };
    }
    return previousBeginNextGenerationV136();
  };

  function activateInheritedChampion() {
    const previous = state.v136PendingChampion;
    let inherited = null;
    if (previous) {
      inherited = state.mice.find(mouse =>
        lineageOf(mouse) === previous.lineage &&
        Array.isArray(mouse.parentIds) &&
        mouse.parentIds.length === 1 &&
        mouse.parentIds[0] === previous.id
      ) || null;
    }

    if (!inherited && previous) inherited = bestAliveInLineage(previous.lineage);
    if (!inherited) inherited = bestOverall(state.mice.filter(mouse => mouse.alive));

    state.v136ManualLineage = null;
    if (inherited) setTracked(inherited, null);
    state.v136PendingChampion = null;
    state.v136InitialAutoChosen = true;
  }

  // Manual lineage selection deliberately lasts only for the current generation.
  function recordManualLineage(event) {
    const card = event.target.closest('[data-v131-lineage],[data-v13-lineage]');
    if (!card || state.mode !== 'sim') return;
    const lineage = card.dataset.v131Lineage || card.dataset.v13Lineage;
    if (!LINEAGES.includes(lineage)) return;
    state.v136ManualLineage = lineage;
    const leader = bestAliveInLineage(lineage);
    if (leader) setTracked(leader, lineage);
  }
  liveLineages?.addEventListener('click', recordManualLineage, true);
  pauseLineages?.addEventListener('click', recordManualLineage, true);

  // If a manually-followed leader dies, remain within that lineage until the next
  // generation instead of falling back to a global/grey mouse.
  const previousChooseTrackedMouseV136 = chooseTrackedMouse;
  chooseTrackedMouse = function () {
    const lineage = state.v136ManualLineage;
    if (lineage && state.mode === 'sim') {
      const tracked = state.mice.find(mouse => mouse.id === state.trackedMouseId);
      if (tracked?.alive && lineageOf(tracked) === lineage) return tracked;
      const replacement = bestAliveInLineage(lineage);
      if (replacement) {
        setTracked(replacement, lineage);
        return replacement;
      }
    }
    return previousChooseTrackedMouseV136();
  };

  const previousInitialiseGenerationOneV136 = initialiseGenerationOne;
  initialiseGenerationOne = function () {
    previousInitialiseGenerationOneV136();
    state.v136CameraGeneration = 1;
    state.v136PendingChampion = null;
    state.v136ManualLineage = null;
    state.v136InitialAutoChosen = false;
  };

  const previousUpdateStatsV136 = updateStats;
  updateStats = function () {
    previousUpdateStatsV136();

    if (state.mode === 'sim' && state.generation !== state.v136CameraGeneration) {
      activateInheritedChampion();
      state.v136CameraGeneration = state.generation;
    }

    // Gen 1 has no reigning champion. After a handful of actual decisions, select
    // the current overall leader once rather than permanently favouring array slot 0.
    if (state.mode === 'sim' && state.generation === 1 && !state.v136InitialAutoChosen && !state.v136ManualLineage) {
      const furthestStep = state.mice.reduce((max, mouse) => Math.max(max, mouse.step || 0), 0);
      if (furthestStep >= 6) {
        const current = bestOverall(state.mice.filter(mouse => mouse.alive));
        if (current) setTracked(current, null);
        state.v136InitialAutoChosen = true;
      }
    }

    normaliseEditorPrimaryText();
  };

  document.body.classList.add('v136Ready');
})();
