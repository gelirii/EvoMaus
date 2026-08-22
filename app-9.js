  // EvoMaus v1.1 camera pass: dead-zone follow with damped catch-up.
  (() => {
    const DEAD_ZONE_DIAMETER_RATIO = 1 / 3;
    const BASE_FOLLOW_RESPONSE = 7.5;
    const MAX_EXTRA_RESPONSE = 8;
    let lastFollowTime = performance.now();

    followTrackedMouse = function () {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - lastFollowTime) / 1000));
      lastFollowTime = now;

      if (state.mode !== 'sim') return;
      if (state.freeCamera || state.simPinching) return;

      const mouse = chooseTrackedMouse();
      if (!mouse) return;

      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || state.view.scale <= 0) return;

      const mouseCx = mouse.renderX + 0.5;
      const mouseCy = mouse.renderY + 0.5;
      const dxPx = (mouseCx - state.view.cx) * state.view.scale;
      const dyPx = (mouseCy - state.view.cy) * state.view.scale;
      const distancePx = Math.hypot(dxPx, dyPx);
      const deadZoneRadiusPx = rect.width * DEAD_ZONE_DIAMETER_RATIO * 0.5;

      // Inside the central dead-zone, the camera is completely still. This lets the
      // mouse make several grid moves without making the whole maze twitch with it.
      if (distancePx <= deadZoneRadiusPx || distancePx < 0.001) return;

      // Move only enough that the mouse would sit on the dead-zone boundary, then
      // approach that camera position with an exponential spring. The farther the
      // mouse gets outside the zone, the stronger the catch-up becomes.
      const excessPx = distancePx - deadZoneRadiusPx;
      const ux = dxPx / distancePx;
      const uy = dyPx / distancePx;
      const targetCx = state.view.cx + ux * (excessPx / state.view.scale);
      const targetCy = state.view.cy + uy * (excessPx / state.view.scale);
      const outsideRatio = Math.min(2, excessPx / Math.max(1, deadZoneRadiusPx));
      const response = BASE_FOLLOW_RESPONSE + outsideRatio * MAX_EXTRA_RESPONSE;
      const blend = 1 - Math.exp(-response * Math.max(dt, 1 / 120));

      state.view.cx += (targetCx - state.view.cx) * blend;
      state.view.cy += (targetCy - state.view.cy) * blend;
      clampView();
    };
  })();
