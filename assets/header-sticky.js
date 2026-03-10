(() => {
  window.SBHeaderInitializers = window.SBHeaderInitializers || [];

  window.SBHeaderInitializers.push((context) => {
    const { header, addRuntimeEventListener, onAbort } = context;
    const { shared } = context;

    const announcementElement = document.querySelector('.header__announcement');
    const headerInnerElement = context.findHeaderRef(header, 'headerInner', '.header__inner');

    const getScrollTop = () => document.scrollingElement?.scrollTop ?? 0;
    const getMaxScrollTop = () => {
      const scrollingElement = document.scrollingElement;
      if (!(scrollingElement instanceof Element)) return 0;
      return Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
    };
    const clampViewportY = (value) => Math.max(0, Math.min(window.innerHeight, value));
    const bottomBounceThresholdPx = 16;
    const stickyHideThresholdPx = 4;
    const normalizeStickyMode = (value) => {
      const normalizedValue = `${value || ''}`.trim().toLowerCase();
      if (normalizedValue === 'always') return 'always';
      if (normalizedValue === 'none') return 'none';
      if (normalizedValue === 'scroll-up') return 'scroll-up';
      return 'always';
    };

    const isDesktopViewport = () => window.matchMedia('(min-width: 990px)').matches;
    const isMobileViewport = () => window.matchMedia('(max-width: 989px)').matches;
    const hasElement = (selector) => document.querySelector(selector) instanceof HTMLElement;
    const getProductRoot = () => document.querySelector('.sb-product-main');

    const resolveResponsiveStickyMode = () => {
      if (hasElement('.sb-blog-overview') || hasElement('.sb-blog-post')) {
        return 'scroll-up';
      }

      if (isDesktopViewport() && hasElement('.sb-metronome-app-sticky-nav')) {
        return 'scroll-up';
      }

      if (isMobileViewport() && hasElement('.sb-manual-chapters')) {
        return 'scroll-up';
      }

      const productRoot = getProductRoot();
      if (productRoot instanceof HTMLElement) {
        const hasSegmentedTopBar = !productRoot.classList.contains('sb-product-main--no-page-header');
        if (hasSegmentedTopBar) {
          return 'scroll-up';
        }

        if (isDesktopViewport()) {
          return 'scroll-up';
        }
      }

      return 'always';
    };

    let stickyMode = resolveResponsiveStickyMode();

    header.dataset.stickyMode = stickyMode;
    if (stickyMode === 'none') header.removeAttribute('sticky');
    else header.setAttribute('sticky', stickyMode);

    let lastY = getScrollTop();
    let offscreen = false;
    let isScrollSyncSuspended = false;
    let stickyIntersectionObserver = null;
    let topStackSyncRaf = null;
    let scrollRafId = null;
    let deferredTopStackSyncTimer = null;
    let headerHeightObserver = null;
    let lastStickyActiveScrollTop = getScrollTop();
    let lastViewportWidth = window.innerWidth;
    let lastViewportHeight = window.innerHeight;
    let lastObservedScrollDirection = 'none';
    let lastStickyDebugReason = 'init';
    let lastStickyDebugScrollTop = getScrollTop();
    let lastStickyDebugLastY = lastY;

    const syncStickyDebugState = (payload = {}) => {
      header.dataset.stickyDebugReason = `${payload.reason || lastStickyDebugReason || ''}`.trim() || 'unknown';
      header.dataset.stickyDebugScrollTop = String(Math.round(
        Number.isFinite(payload.scrollTop) ? payload.scrollTop : lastStickyDebugScrollTop
      ));
      header.dataset.stickyDebugLastY = String(Math.round(
        Number.isFinite(payload.lastY) ? payload.lastY : lastStickyDebugLastY
      ));
      if (Number.isFinite(payload.scrollTop)) lastStickyDebugScrollTop = payload.scrollTop;
      if (Number.isFinite(payload.lastY)) lastStickyDebugLastY = payload.lastY;
      if (payload.reason) lastStickyDebugReason = payload.reason;
    };

    const readHeaderSpacingVar = (propertyName, fallback = 0) => {
      const parsed = Number.parseFloat(getComputedStyle(header).getPropertyValue(propertyName));
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const minimumAnnouncementHeight = () => readHeaderSpacingVar('--sb-announcement-min-height', 0);
    const announcementHeight = () => {
      const measuredHeight = announcementElement ? announcementElement.getBoundingClientRect().height || 0 : 0;
      return Math.max(measuredHeight, minimumAnnouncementHeight(), 0);
    };

    const setStickyState = (nextState) => {
      const normalizedState = nextState === 'active' || nextState === 'idle' ? nextState : 'inactive';
      if (header.dataset.stickyState === normalizedState) return;
      header.dataset.stickyState = normalizedState;
    };

    const setScrollDirection = (nextDirection) => {
      const normalizedDirection = nextDirection === 'up' || nextDirection === 'down' ? nextDirection : 'none';
      if (header.dataset.scrollDirection !== normalizedDirection) {
        header.dataset.scrollDirection = normalizedDirection;
      }
    };

    const syncTopStackBottom = () => {
      const root = document.documentElement;
      if (!(root instanceof HTMLElement)) return;

      const nextAnnouncementHeight = announcementHeight();
      const nextAnnouncementHeightValue = `${nextAnnouncementHeight}px`;
      if (root.style.getPropertyValue('--sb-announcement-height') !== nextAnnouncementHeightValue) {
        root.style.setProperty('--sb-announcement-height', nextAnnouncementHeightValue);
      }

      const headerRect = header.getBoundingClientRect();
      const nextBottom = clampViewportY(headerRect.bottom);
      const nextBottomValue = `${nextBottom}px`;
      if (root.style.getPropertyValue('--sb-top-stack-bottom') !== nextBottomValue) {
        root.style.setProperty('--sb-top-stack-bottom', nextBottomValue);
      }

      let nextContentBottom = nextBottom;
      if (headerInnerElement instanceof HTMLElement) {
        const innerBottom = clampViewportY(headerInnerElement.getBoundingClientRect().bottom);
        const announcementBottom = announcementElement instanceof HTMLElement
          ? clampViewportY(announcementElement.getBoundingClientRect().bottom)
          : nextBottom;
        nextContentBottom = Math.max(announcementBottom, innerBottom);
      }
      const nextContentBottomValue = `${nextContentBottom}px`;
      if (root.style.getPropertyValue('--sb-top-stack-content-bottom') !== nextContentBottomValue) {
        root.style.setProperty('--sb-top-stack-content-bottom', nextContentBottomValue);
      }
    };

    const applyStickyVisualState = () => {
      syncTopStackBottom();
      if (typeof shared.syncPrimaryBackdropOnScroll === 'function') {
        shared.syncPrimaryBackdropOnScroll();
      }
    };

    const scheduleTopStackSync = () => {
      if (topStackSyncRaf != null) {
        window.cancelAnimationFrame(topStackSyncRaf);
      }
      topStackSyncRaf = window.requestAnimationFrame(() => {
        topStackSyncRaf = null;
        applyStickyVisualState();
      });
    };

    const syncStickyObserver = () => {
      if (stickyIntersectionObserver) {
        stickyIntersectionObserver.disconnect();
        stickyIntersectionObserver = null;
      }

      if (stickyMode === 'none') {
        offscreen = false;
        setStickyState('inactive');
        setScrollDirection('none');
        return;
      }

      const alwaysSticky = stickyMode === 'always';
      stickyIntersectionObserver = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return;
          if (alwaysSticky) {
            setStickyState(entry.isIntersecting ? 'inactive' : 'active');
            return;
          }
          offscreen = !entry.isIntersecting
            || header.dataset.stickyState === 'active'
            || header.dataset.stickyState === 'idle';
        },
        { threshold: alwaysSticky ? 1 : 0 }
      );
      stickyIntersectionObserver.observe(header);
    };

    const syncStickyState = ({ force = false } = {}) => {
      const scrollTop = getScrollTop();
      const maxScrollTop = getMaxScrollTop();
      const headerTop = header.getBoundingClientRect().top;
      const isNearBottom = maxScrollTop > 0 && scrollTop >= (maxScrollTop - bottomBounceThresholdPx);
      const wasNearBottom = maxScrollTop > 0 && lastY >= (maxScrollTop - bottomBounceThresholdPx);
      const isBottomBounce = stickyMode === 'scroll-up' && isNearBottom && wasNearBottom;
      const isAtTop = headerTop >= 0;
      const isScrollingUp = !isBottomBounce && scrollTop < lastY;
      const isScrollingDown = !isBottomBounce && scrollTop > lastY;
      let debugReason = force ? 'force' : 'scroll';

      if (isScrollingUp) {
        lastObservedScrollDirection = 'up';
      } else if (isScrollingDown) {
        lastObservedScrollDirection = 'down';
      }

      if (stickyMode === 'none') {
        offscreen = false;
        lastStickyActiveScrollTop = scrollTop;
        debugReason = 'mode-none';
        setStickyState('inactive');
        setScrollDirection('none');
        lastY = scrollTop;
        syncStickyDebugState({ reason: debugReason, scrollTop, lastY });
        applyStickyVisualState();
        return;
      }

      if (!offscreen && stickyMode !== 'always' && !force) {
        lastY = scrollTop;
        syncStickyDebugState({ reason: 'onscreen-skip', scrollTop, lastY });
        return;
      }

      if (stickyMode === 'always') {
        if (isAtTop) {
          lastStickyActiveScrollTop = scrollTop;
          debugReason = 'always-top';
          setScrollDirection('none');
        } else if (isScrollingUp) {
          lastStickyActiveScrollTop = scrollTop;
          debugReason = 'always-up';
          setScrollDirection('up');
        } else {
          debugReason = 'always-down';
          setScrollDirection('down');
        }
        lastY = scrollTop;
        syncStickyDebugState({ reason: debugReason, scrollTop, lastY });
        applyStickyVisualState();
        return;
      }

      if (force) {
        if (isAtTop) {
          offscreen = false;
          lastStickyActiveScrollTop = scrollTop;
          debugReason = 'force-top';
          setStickyState('inactive');
          setScrollDirection('none');
        } else if (stickyMode === 'scroll-up' && header.dataset.stickyState === 'active') {
          offscreen = true;
          lastStickyActiveScrollTop = scrollTop;
          debugReason = 'force-keep-active';
          setStickyState('active');
          setScrollDirection('up');
        } else {
          offscreen = true;
          debugReason = 'force-idle';
          setStickyState('idle');
          setScrollDirection('none');
        }
        lastY = scrollTop;
        syncStickyDebugState({ reason: debugReason, scrollTop, lastY });
        applyStickyVisualState();
        return;
      }

      if (isScrollingUp) {
        if (isAtTop) {
          offscreen = false;
          lastStickyActiveScrollTop = scrollTop;
          debugReason = 'scroll-up-top';
          setStickyState('inactive');
          setScrollDirection('none');
        } else {
          lastStickyActiveScrollTop = scrollTop;
          debugReason = 'scroll-up-show';
          setStickyState('active');
          setScrollDirection('up');
        }
      } else if (header.dataset.stickyState === 'active') {
        const hasScrolledDownEnoughToHide = scrollTop >= (lastStickyActiveScrollTop + stickyHideThresholdPx);
        if (hasScrolledDownEnoughToHide) {
          debugReason = 'scroll-down-hide';
          setScrollDirection('down');
          setStickyState('idle');
        } else {
          debugReason = 'hold-active';
          setScrollDirection('up');
        }
      } else {
        debugReason = 'idle-no-up';
        setStickyState('idle');
        setScrollDirection('none');
      }

      lastY = scrollTop;
      syncStickyDebugState({ reason: debugReason, scrollTop, lastY });
      applyStickyVisualState();
    };

    const refreshHeaderScrollMode = ({ forceSync = false } = {}) => {
      const nextStickyMode = normalizeStickyMode(resolveResponsiveStickyMode());
      stickyMode = nextStickyMode;
      header.dataset.stickyMode = stickyMode;
      if (stickyMode === 'none') header.removeAttribute('sticky');
      else header.setAttribute('sticky', stickyMode);
      syncStickyObserver();
      if (forceSync) syncStickyState({ force: true });
      else applyStickyVisualState();
      scheduleTopStackSync();
    };

    const setScrollSyncSuspended = (suspended) => {
      isScrollSyncSuspended = Boolean(suspended);
      lastY = getScrollTop();
    };

    const setLastScrollY = (value) => {
      lastY = Math.max(0, Number.isFinite(value) ? value : getScrollTop());
    };

    const captureVisualState = () => ({
      stickyMode,
      stickyState: header.dataset.stickyState || 'inactive',
      scrollDirection: header.dataset.scrollDirection || 'none',
      offscreen,
    });

    const restoreVisualState = (snapshot) => {
      if (!snapshot || snapshot.stickyMode !== stickyMode) return;
      offscreen = Boolean(snapshot.offscreen);
      setStickyState(snapshot.stickyState);
      setScrollDirection(snapshot.scrollDirection);
      setLastScrollY(getScrollTop());
      applyStickyVisualState();
    };

    shared.syncStickyState = syncStickyState;
    shared.scheduleTopStackSync = scheduleTopStackSync;
    shared.refreshHeaderScrollMode = refreshHeaderScrollMode;
    shared.setStickyLastY = setLastScrollY;

    window.SBHeaderNav = {
      ...(window.SBHeaderNav || {}),
      captureVisualState,
      refreshScrollMode: refreshHeaderScrollMode,
      restoreVisualState,
      setScrollSyncSuspended,
    };

    syncStickyObserver();
    syncStickyDebugState({ reason: 'init-sync', scrollTop: getScrollTop(), lastY });
    syncTopStackBottom();
    scheduleTopStackSync();

    const onWindowScroll = () => {
      if (typeof shared.isScrollLocked === 'function' && shared.isScrollLocked()) {
        const scrollLockY = typeof shared.getScrollLockY === 'function' ? shared.getScrollLockY() : 0;
        lastY = Number.isFinite(scrollLockY) ? scrollLockY : lastY;
        return;
      }
      if (isScrollSyncSuspended) {
        lastY = getScrollTop();
        return;
      }
      if (scrollRafId != null) return;
      scrollRafId = window.requestAnimationFrame(() => {
        scrollRafId = null;
        syncStickyState();
      });
    };

    addRuntimeEventListener(document, 'scroll', onWindowScroll, { passive: true });
    addRuntimeEventListener(window, 'resize', () => {
      const previousViewportWidth = lastViewportWidth;
      const nextViewportWidth = window.innerWidth;
      const previousViewportHeight = lastViewportHeight;
      const nextViewportHeight = window.innerHeight;
      const isViewportExpandingUpward = stickyMode === 'scroll-up'
        && isMobileViewport()
        && nextViewportWidth === previousViewportWidth
        && nextViewportHeight > previousViewportHeight
        && lastObservedScrollDirection === 'up';
      lastViewportWidth = nextViewportWidth;
      lastViewportHeight = nextViewportHeight;

      if (typeof shared.syncPageScrollLock === 'function') {
        shared.syncPageScrollLock();
      }
      refreshHeaderScrollMode();

      if (isViewportExpandingUpward && getScrollTop() > 0) {
        offscreen = true;
        lastStickyActiveScrollTop = getScrollTop();
        setStickyState('active');
        setScrollDirection('up');
        setLastScrollY(getScrollTop());
        syncStickyDebugState({ reason: 'resize-grow-show', scrollTop: getScrollTop(), lastY });
        applyStickyVisualState();
      } else if (stickyMode === 'scroll-up' && nextViewportWidth === previousViewportWidth) {
        syncStickyState();
      } else {
        syncStickyState({ force: true });
      }
      scheduleTopStackSync();
    }, { passive: true });

    window.requestAnimationFrame(() => {
      refreshHeaderScrollMode();
      syncStickyState({ force: true });
      scheduleTopStackSync();
    });

    deferredTopStackSyncTimer = window.setTimeout(scheduleTopStackSync, 300);
    addRuntimeEventListener(window, 'load', scheduleTopStackSync);

    if (document.fonts && typeof document.fonts.ready === 'object' && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(() => {
        scheduleTopStackSync();
      });
    }

    if (window.ResizeObserver) {
      headerHeightObserver = new ResizeObserver(() => {
        scheduleTopStackSync();
      });
      headerHeightObserver.observe(header);
      if (announcementElement instanceof HTMLElement) {
        headerHeightObserver.observe(announcementElement);
      }
    }

    addRuntimeEventListener(document, 'shopify:section:load', () => {
      refreshHeaderScrollMode({ forceSync: true });
      scheduleTopStackSync();
    });
    addRuntimeEventListener(document, 'shopify:section:unload', () => {
      refreshHeaderScrollMode({ forceSync: true });
      scheduleTopStackSync();
    });

    onAbort(() => {
      if (deferredTopStackSyncTimer != null) {
        window.clearTimeout(deferredTopStackSyncTimer);
        deferredTopStackSyncTimer = null;
      }

      if (topStackSyncRaf != null) {
        window.cancelAnimationFrame(topStackSyncRaf);
        topStackSyncRaf = null;
      }

      if (scrollRafId != null) {
        window.cancelAnimationFrame(scrollRafId);
        scrollRafId = null;
      }

      if (headerHeightObserver) {
        headerHeightObserver.disconnect();
        headerHeightObserver = null;
      }

      if (stickyIntersectionObserver) {
        stickyIntersectionObserver.disconnect();
        stickyIntersectionObserver = null;
      }
    });
  });
})();
