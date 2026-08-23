// EvoMaus v1.3 skip/event state-machine repair.
// Generation summaries temporarily interrupt Skip Until Improvement; they do not cancel it.
// First-solve / completion events DO cancel Skip, restore the user's old speed, and stay blocking.
(() => {
  const eventOverlay = document.getElementById('v13EventOverlay');
  const eventTitle = document.getElementById('v13EventTitle');
  const eventContinue = document.getElementById('v13EventContinue');
  const pauseButton = document.getElementById('pauseButton');
  const pauseOverlay = document.getElementById('v13PauseOverlay');
  const skipBadge = document.getElementById('v13SkipBadge');
  const speedButton = document.getElementById('speedButton');

  let summarySkipSnapshot = null;
  let manualPauseSkipSnapshot = null;
  let lastEventWasSummary = false;

  function cloneSkip(skip) {
    if (!skip) return null;
    return {
      ...skip,
      lineageSolved: skip.lineageSolved ? { ...skip.lineageSolved } : skip.lineageSolved
    };
  }

  function restoreSpeedFrom(skip) {
    if (!skip || !Number.isFinite(skip.previousSpeedIndex)) return;
    state.speedIndex = Math.max(0, Math.min(state.speeds.length - 1, skip.previousSpeedIndex));
    if (speedButton) speedButton.textContent = `${state.speeds[state.speedIndex]}× Speed`;
  }

  function showSkipUi() {
    document.body.classList.add('v13Skipping');
    skipBadge?.classList.add('show');
    if (skipBadge) skipBadge.style.display = '';
  }

  function hideSkipUi() {
    document.body.classList.remove('v13Skipping');
    skipBadge?.classList.remove('show');
  }

  function terminateSkipForImportantEvent() {
    const skip = cloneSkip(state.v13Skip) || summarySkipSnapshot;
    if (!skip) return;
    restoreSpeedFrom(skip);
    state.v13Skip = null;
    summarySkipSnapshot = null;
    hideSkipUi();

    // The event card itself is the pause. Do not allow a stale Pause drawer to sit
    // underneath it and do not let play restart until the user acknowledges the card.
    pauseOverlay?.classList.remove('show');
    document.body.classList.remove('v13PauseOpen');
    state.paused = true;
    document.body.classList.add('paused');
    if (pauseButton) pauseButton.textContent = '▶ Resume';
  }

  function observeEventState() {
    if (!eventOverlay?.classList.contains('show')) return;
    const title = eventTitle?.textContent || '';
    const isSummary = /Generation\s+\d+\s+complete/i.test(title);
    lastEventWasSummary = isSummary;

    if (!state.v13Skip) return;

    if (isSummary) {
      // Keep a durable copy because app-25's generic Continue cleanup clears
      // state.v13Skip after the summary button is tapped.
      summarySkipSnapshot = cloneSkip(state.v13Skip);
      return;
    }

    // Any non-summary blocking event (most importantly first maze solve) outranks
    // Skip Until Improvement. Restore normal playback immediately and leave paused.
    terminateSkipForImportantEvent();
  }

  if (eventOverlay) {
    new MutationObserver(() => queueMicrotask(observeEventState)).observe(eventOverlay, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class']
    });
  }

  eventContinue?.addEventListener('click', () => {
    if (!lastEventWasSummary || !summarySkipSnapshot) return;
    const snapshot = cloneSkip(summarySkipSnapshot);

    // app-18 first advances the generation, then app-25 schedules its generic
    // cancelSkip cleanup. Run after both and reinstate the skip session.
    setTimeout(() => {
      if (!snapshot || state.mode !== 'sim') return;
      state.v13Skip = snapshot;
      summarySkipSnapshot = null;
      state.paused = false;
      document.body.classList.remove('paused', 'v13PauseOpen');
      pauseOverlay?.classList.remove('show');
      state.speedIndex = state.speeds.length - 1;
      if (speedButton) speedButton.textContent = `${state.speeds[state.speedIndex]}× Speed`;
      if (pauseButton) pauseButton.textContent = '⏸ Pause';
      showSkipUi();
      state.freeCamera = false;
    }, 0);
  });

  // app-25 cancels state.v13Skip on the Pause button's own capture listener before
  // our target listener can see it. Capture at document level first, remember the
  // old playback speed, then let the normal Pause UI open and restore that speed.
  document.addEventListener('click', event => {
    if (event.target.closest('#pauseButton') && state.v13Skip) {
      manualPauseSkipSnapshot = cloneSkip(state.v13Skip);
      setTimeout(() => {
        if (!manualPauseSkipSnapshot) return;
        restoreSpeedFrom(manualPauseSkipSnapshot);
        manualPauseSkipSnapshot = null;
        state.v13Skip = null;
        hideSkipUi();
      }, 0);
    }
  }, true);

  // Defensive check for a first-solve event created during the same simulation tick.
  // MutationObserver normally catches it first, but this makes the priority explicit.
  const previousUpdateStatsV139 = updateStats;
  updateStats = function () {
    previousUpdateStatsV139();
    observeEventState();
  };

  document.body.classList.add('v139SkipEventFixed');
})();
