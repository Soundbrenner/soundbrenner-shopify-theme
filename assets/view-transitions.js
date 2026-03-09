(function () {
  const viewTransitionRenderBlocker = document.getElementById('view-transition-render-blocker');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || isLowPowerDevice()) {
    viewTransitionRenderBlocker?.remove();
  } else {
    const renderBlockerTimeoutMs = Math.max(0, 1800 - performance.now());

    setTimeout(() => {
      viewTransitionRenderBlocker?.remove();
    }, renderBlockerTimeoutMs);
  }

  const idleCallback = typeof requestIdleCallback === 'function' ? requestIdleCallback : setTimeout;

  window.addEventListener('pageswap', (event) => {
    const { viewTransition } = event;

    if (shouldSkipViewTransition(viewTransition)) {
      viewTransition?.skipTransition();
      return;
    }

    ['pointerdown', 'keydown'].forEach((eventName) => {
      document.addEventListener(
        eventName,
        () => {
          viewTransition.skipTransition();
        },
        { once: true }
      );
    });

    document
      .querySelectorAll('[data-view-transition-type]:not([data-view-transition-triggered])')
      .forEach((element) => {
        element.removeAttribute('data-view-transition-type');
      });

    const transitionTriggered = document.querySelector('[data-view-transition-triggered]');
    const transitionType = transitionTriggered?.getAttribute('data-view-transition-type');

    if (transitionType) {
      viewTransition.types.clear();
      viewTransition.types.add(transitionType);
      sessionStorage.setItem('custom-transition-type', transitionType);
    } else {
      viewTransition.types.clear();
      viewTransition.types.add('page-navigation');
      sessionStorage.removeItem('custom-transition-type');
    }
  });

  window.addEventListener('pagereveal', async (event) => {
    const { viewTransition } = event;

    if (shouldSkipViewTransition(viewTransition)) {
      viewTransition?.skipTransition();
      return;
    }

    const customTransitionType = sessionStorage.getItem('custom-transition-type');

    if (customTransitionType) {
      viewTransition.types.clear();
      viewTransition.types.add(customTransitionType);

      await viewTransition.finished;

      viewTransition.types.clear();
      viewTransition.types.add('page-navigation');

      idleCallback(() => {
        sessionStorage.removeItem('custom-transition-type');
        document.querySelectorAll('[data-view-transition-type]').forEach((element) => {
          element.removeAttribute('data-view-transition-type');
        });
      });
    } else {
      viewTransition.types.clear();
      viewTransition.types.add('page-navigation');
    }
  });

  function shouldSkipViewTransition(viewTransition) {
    return !(viewTransition instanceof ViewTransition) || isLowPowerDevice();
  }

  function isLowPowerDevice() {
    return Number(navigator.hardwareConcurrency) <= 2 || Number(navigator.deviceMemory) <= 2;
  }
})();
