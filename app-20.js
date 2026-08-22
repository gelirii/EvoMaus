// EvoMaus v1.3 UI refinement: top pause drawer and editor-owned maze generation.
(() => {
  const pauseOverlay = document.getElementById('v13PauseOverlay');
  const sheet = pauseOverlay?.querySelector('.v13Sheet');
  const head = sheet?.querySelector('.v13SheetHead');
  const resume = document.getElementById('v13ResumeButton');
  const skip = document.getElementById('v13SkipButton');
  const toggles = sheet?.querySelector('.v13ToggleGrid');
  const edit = document.getElementById('v13EditMazeButton');
  const randomPause = document.getElementById('v13RandomMazeButton');
  const randomEditor = document.getElementById('v13RandomEditorButton');
  const reset = document.getElementById('v13ResetButton');

  if (!sheet || !head) return;

  // Resume and Skip are peer actions: one resumes normal playback, the other resumes
  // with a purpose. Keeping them together makes Pause read like a compact transport bar.
  let actions = head.querySelector('.v132PauseActions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'v132PauseActions';
    head.appendChild(actions);
  }
  if (resume) actions.appendChild(resume);
  if (skip) {
    skip.textContent = '⏩ Skip';
    skip.classList.remove('v13WideAction');
    skip.classList.add('v132SkipSmall');
    actions.appendChild(skip);
  }

  // Pause should control the experiment, not also be a second maze editor. A single
  // Edit button returns to the normal editor, where generation/drawing tools belong.
  const mazeSection = edit?.closest('.v13Section');
  if (edit) {
    edit.textContent = '✎ Edit';
    edit.className = 'v132EditButton';
    if (toggles) toggles.insertAdjacentElement('afterend', edit);
    else sheet.insertBefore(edit, reset || null);
  }
  if (mazeSection) mazeSection.classList.add('v132LegacyMazeSection');
  if (randomPause) randomPause.hidden = true;

  // Random-maze creation is part of the ordinary editor. Reuse the existing button
  // and listener rather than introducing a second code path.
  if (randomEditor) {
    randomEditor.textContent = '🎲 Random maze';
    randomEditor.title = 'Generate random maze';
    randomEditor.className = 'secondary v132RandomEditorAction';
    document.querySelector('.editorTitleActions')?.appendChild(randomEditor);
  }

  // The older Pause implementation labels the sheet as modal even though the maze
  // deliberately remains interactive for inspection. Keep the accessible semantics
  // aligned with the actual interaction model.
  sheet.setAttribute('aria-modal', 'false');

  document.body.classList.add('v132Ready');
})();
