(() => {
  if (window.SBStickyStack && window.SBStickyStack.__initialized) return;

  const root = document.documentElement;
  const TOP_ACCESSORY_SELECTOR = '[data-sb-sticky-top-navigation]';
  const BOTTOM_ACCESSORY_SELECTOR = '[data-sb-sticky-bottom-navigation]';
  const HEADER_SELECTOR = '.header';

  let animationFrameId = 0;
  let resizeObserver = null;
  let mutationObserver = null;
  let pendingScrollJobId = 0;
  let currentState = {
    headerBottom: 0,
    topStackBottom: 0,
    bottomStackHeight: 0,
    scrollTargetOffset: 0,
    activeTopAccessoryCount: 0
  };

  const parsePx = (value, fallback = 0) => {
    const parsed = Number.parseFloat(`${value || ''}`.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const isVisibleElement = (element) => {
    if (!(element instanceof Element)) return false;
    if (element.hidden) return false;
    if (!element.getClientRects().length) return false;
    const styles = window.getComputedStyle(element);
    if (styles.display === 'none' || styles.visibility === 'hidden') return false;
    return true;
  };

  const isActiveAccessory = (element) => {
    const explicit = `${element.getAttribute('data-sb-sticky-active') || ''}`.trim().toLowerCase();
    if (explicit === 'false' || explicit === '0' || explicit === 'no') return false;
    if (explicit === 'true' || explicit === '1' || explicit === 'yes') return isVisibleElement(element);
    return isVisibleElement(element);
  };

  const getScale96 = () => {
    const value = window.getComputedStyle(root).getPropertyValue('--sb-space-96');
    return parsePx(value, 96);
  };

  const getHeaderBottom = () => {
    const header = document.querySelector(HEADER_SELECTOR);
    if (!(header instanceof Element) || !isVisibleElement(header)) return 0;
    const styles = window.getComputedStyle(header);
    const borderBottom = parsePx(styles.borderBottomWidth, 0);
    return Math.max((header.getBoundingClientRect().bottom || 0) - borderBottom, 0);
  };

  const getTopAccessoryGap = (element) => {
    const explicit = parsePx(element.getAttribute('data-sb-sticky-gap'), Number.NaN);
    if (Number.isFinite(explicit)) return explicit;

    const styles = window.getComputedStyle(element);
    const candidates = [
      '--sb-supplementary-sticky-top-gap',
      '--sb-metronome-app-sticky-top-gap',
      '--sb-sticky-top-gap'
    ];

    for (const candidate of candidates) {
      const value = parsePx(styles.getPropertyValue(candidate), Number.NaN);
      if (Number.isFinite(value)) return value;
    }

    return 0;
  };

  const syncTopAccessoryPositions = (headerBottom) => {
    const activeTopAccessories = [];
    const accessories = Array.from(document.querySelectorAll(TOP_ACCESSORY_SELECTOR));

    accessories.forEach((accessory) => {
      if (!isActiveAccessory(accessory)) return;
      const gap = getTopAccessoryGap(accessory);
      const nextTop = Math.max(headerBottom + gap, gap);
      const nextTopValue = `${Math.floor(nextTop)}px`;
      if (accessory.style.top !== nextTopValue) {
        accessory.style.top = nextTopValue;
      }
      activeTopAccessories.push(accessory);
    });

    return activeTopAccessories;
  };

  const getTopStackBottom = (headerBottom, activeTopAccessories) => {
    let topStackBottom = Math.max(headerBottom, 0);
    activeTopAccessories.forEach((accessory) => {
      const rect = accessory.getBoundingClientRect();
      if (!Number.isFinite(rect.bottom) || rect.height <= 0) return;
      topStackBottom = Math.max(topStackBottom, rect.bottom);
    });
    return Math.max(topStackBottom, 0);
  };

  const getBottomStackHeight = () => {
    let bottomStackHeight = 0;
    const accessories = Array.from(document.querySelectorAll(BOTTOM_ACCESSORY_SELECTOR));

    accessories.forEach((accessory) => {
      if (!isActiveAccessory(accessory)) return;
      const rect = accessory.getBoundingClientRect();
      if (rect.height <= 0) return;
      const occupiedViewportHeight = Math.max(rect.height, window.innerHeight - rect.top);
      bottomStackHeight = Math.max(bottomStackHeight, occupiedViewportHeight);
    });

    return Math.max(0, Math.round(bottomStackHeight));
  };

  const setRootVar = (name, value) => {
    const next = `${value}px`;
    if (root.style.getPropertyValue(name) !== next) {
      root.style.setProperty(name, next);
    }
  };

  const sync = () => {
    const headerBottom = Math.round(getHeaderBottom());
    const activeTopAccessories = syncTopAccessoryPositions(headerBottom);
    const topStackBottom = Math.round(getTopStackBottom(headerBottom, activeTopAccessories));
    const bottomStackHeight = getBottomStackHeight();
    const scrollTargetOffset = Math.round(topStackBottom + getScale96());

    const nextState = {
      headerBottom,
      topStackBottom,
      bottomStackHeight,
      scrollTargetOffset,
      activeTopAccessoryCount: activeTopAccessories.length
    };

    setRootVar('--sb-sticky-header-bottom', nextState.headerBottom);
    setRootVar('--sb-sticky-top-stack-bottom', nextState.topStackBottom);
    setRootVar('--sb-sticky-bottom-stack-height', nextState.bottomStackHeight);
    setRootVar('--sb-sticky-scroll-target-offset', nextState.scrollTargetOffset);

    const changed =
      nextState.headerBottom !== currentState.headerBottom ||
      nextState.topStackBottom !== currentState.topStackBottom ||
      nextState.bottomStackHeight !== currentState.bottomStackHeight ||
      nextState.scrollTargetOffset !== currentState.scrollTargetOffset ||
      nextState.activeTopAccessoryCount !== currentState.activeTopAccessoryCount;

    currentState = nextState;

    if (changed) {
      document.dispatchEvent(new CustomEvent('sb:sticky-stack:change', {
        detail: {
          headerBottom: nextState.headerBottom,
          topStackBottom: nextState.topStackBottom,
          bottomStackHeight: nextState.bottomStackHeight,
          scrollTargetOffset: nextState.scrollTargetOffset,
          activeTopAccessoryCount: nextState.activeTopAccessoryCount
        }
      }));
    }
  };

  const requestSync = () => {
    if (animationFrameId) return;
    animationFrameId = window.requestAnimationFrame(() => {
      animationFrameId = 0;
      sync();
    });
  };

  const getScrollY = () => window.scrollY || window.pageYOffset || 0;

  const getAnnouncementHeight = () => {
    const announcement = document.querySelector('.header__announcement');
    if (!(announcement instanceof Element) || !isVisibleElement(announcement)) return 0;
    return Math.max(announcement.getBoundingClientRect().height || 0, 0);
  };

  const parseTranslateY = (transformValue) => {
    const raw = `${transformValue || ''}`.trim();
    if (!raw || raw === 'none') return 0;

    if (raw.startsWith('matrix3d(') && raw.endsWith(')')) {
      const values = raw.slice(9, -1).split(',').map((part) => Number.parseFloat(part.trim()));
      if (values.length === 16 && Number.isFinite(values[13])) return values[13];
      return 0;
    }

    if (raw.startsWith('matrix(') && raw.endsWith(')')) {
      const values = raw.slice(7, -1).split(',').map((part) => Number.parseFloat(part.trim()));
      if (values.length >= 6 && Number.isFinite(values[5])) return values[5];
      return 0;
    }

    const translateYMatch = raw.match(/translateY\(([-0-9.]+)px\)/i);
    if (translateYMatch) {
      const parsed = Number.parseFloat(translateYMatch[1]);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  };

  const getHeaderExpandedBottom = () => {
    const header = document.querySelector(HEADER_SELECTOR);
    if (!(header instanceof Element) || !isVisibleElement(header)) return 0;

    const styles = window.getComputedStyle(header);
    const translateY = parseTranslateY(styles.transform);
    const borderBottom = parsePx(styles.borderBottomWidth, 0);
    const rect = header.getBoundingClientRect();
    return Math.max(rect.bottom - translateY - borderBottom, 0);
  };

  const getProjectedTopStackBottom = (direction = 'down') => {
    const activeAccessories = Array.from(document.querySelectorAll(TOP_ACCESSORY_SELECTOR)).filter(isActiveAccessory);
    const expandedHeaderBottom = getHeaderExpandedBottom();

    let projectedHeaderBottom = expandedHeaderBottom;
    if (direction === 'down') {
      if (activeAccessories.length > 0) {
        projectedHeaderBottom = 0;
      } else {
        projectedHeaderBottom = Math.max(expandedHeaderBottom - getAnnouncementHeight(), 0);
      }
    }

    let projectedTopStackBottom = Math.max(projectedHeaderBottom, 0);
    activeAccessories.forEach((accessory) => {
      const rect = accessory.getBoundingClientRect();
      if (!Number.isFinite(rect.height) || rect.height <= 0) return;
      const gap = getTopAccessoryGap(accessory);
      const accessoryBottom = projectedHeaderBottom + gap + rect.height;
      projectedTopStackBottom = Math.max(projectedTopStackBottom, accessoryBottom);
    });

    return Math.max(Math.round(projectedTopStackBottom), 0);
  };

  const resolveScrollTargetOffset = (direction = 'down') => {
    const projectedTopStackBottom = getProjectedTopStackBottom(direction);
    if (projectedTopStackBottom > 0) {
      return projectedTopStackBottom + getScale96();
    }
    const fallbackOffset = Math.round(getHeaderBottom() + getScale96());
    const resolvedOffset = parsePx(
      window.getComputedStyle(root).getPropertyValue('--sb-sticky-scroll-target-offset'),
      fallbackOffset
    );
    return currentState.scrollTargetOffset || resolvedOffset || fallbackOffset;
  };

  const getAlignedTopForElement = (element, offsetOverride) => {
    const absoluteTop = element.getBoundingClientRect().top + getScrollY();
    const currentY = getScrollY();
    const direction = absoluteTop > currentY ? 'down' : 'up';
    const offset = Number.isFinite(offsetOverride) ? offsetOverride : resolveScrollTargetOffset(direction);
    return Math.max(Math.round(absoluteTop - offset), 0);
  };

  const alignElementToCurrentOffset = (element, behavior = 'auto') => {
    if (!(element instanceof Element)) return 0;
    const nextTop = getAlignedTopForElement(element);
    const currentY = getScrollY();
    const delta = nextTop - currentY;
    if (Math.abs(delta) <= 1) return delta;
    window.scrollTo({
      top: nextTop,
      behavior
    });
    return delta;
  };

  const scrollToElementAfterLayoutSettles = (element, behavior, jobId) => {
    const startedAt = Date.now();
    let lastTop = null;
    let stableTicks = 0;

    const tick = () => {
      if (jobId !== pendingScrollJobId) return;
      requestSync();

      const nextTop = getAlignedTopForElement(element);
      if (lastTop != null && Math.abs(nextTop - lastTop) <= 1) {
        stableTicks += 1;
      } else {
        stableTicks = 0;
      }
      lastTop = nextTop;

      const elapsed = Date.now() - startedAt;
      if (stableTicks >= 2 || elapsed >= 320) {
        if (jobId !== pendingScrollJobId) return;
        const currentY = getScrollY();
        if (Math.abs(nextTop - currentY) <= 1) return;
        window.scrollTo({ top: nextTop, behavior });
        return;
      }

      window.setTimeout(tick, 40);
    };

    window.requestAnimationFrame(tick);
  };

  const scrollToElement = (element, options = {}) => {
    if (!(element instanceof Element)) return;
    const behavior = options.behavior === 'auto' ? 'auto' : 'smooth';
    pendingScrollJobId += 1;
    const jobId = pendingScrollJobId;

    const shouldWaitForLayoutSettle = behavior === 'smooth' && options.waitForLayout !== false;
    if (shouldWaitForLayoutSettle) {
      scrollToElementAfterLayoutSettles(element, behavior, jobId);
      return;
    }

    requestSync();
    alignElementToCurrentOffset(element, behavior);
  };

  const getHashTarget = () => {
    const rawHash = `${window.location.hash || ''}`.trim();
    if (!rawHash || rawHash === '#') return null;
    const decodedHash = window.decodeURIComponent(rawHash.slice(1));
    if (!decodedHash) return null;
    const direct = document.getElementById(decodedHash);
    if (direct) return direct;
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return document.querySelector(`#${window.CSS.escape(decodedHash)}`);
    }
    return null;
  };

  const syncHashTarget = () => {
    const target = getHashTarget();
    if (!target) return;
    scrollToElement(target, { behavior: 'auto' });
  };

  const handleSyncEvent = () => requestSync();

  window.addEventListener('scroll', handleSyncEvent, { passive: true });
  window.addEventListener('resize', handleSyncEvent, { passive: true });
  window.addEventListener('load', () => {
    handleSyncEvent();
    window.setTimeout(syncHashTarget, 40);
    window.setTimeout(syncHashTarget, 220);
  });
  window.addEventListener('hashchange', () => {
    requestSync();
    window.setTimeout(syncHashTarget, 20);
  });
  document.addEventListener('sb:cart-drawer:state-change', handleSyncEvent);
  document.addEventListener('shopify:section:load', handleSyncEvent);
  document.addEventListener('shopify:section:unload', handleSyncEvent);

  if (document.fonts && typeof document.fonts.ready === 'object' && typeof document.fonts.ready.then === 'function') {
    document.fonts.ready.then(handleSyncEvent).catch(() => {});
  }

  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      requestSync();
    });
    const startResizeObserver = () => {
      if (!document.body) return;
      resizeObserver.observe(document.body);
    };
    if (document.body) startResizeObserver();
    else document.addEventListener('DOMContentLoaded', startResizeObserver, { once: true });
    const header = document.querySelector(HEADER_SELECTOR);
    if (header) resizeObserver.observe(header);
  }

  if (window.MutationObserver) {
    mutationObserver = new MutationObserver(() => {
      requestSync();
    });
    const startMutationObserver = () => {
      if (!document.body) return;
      mutationObserver.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class', 'style', 'hidden', 'data-sb-sticky-active']
      });
    };
    if (document.body) startMutationObserver();
    else document.addEventListener('DOMContentLoaded', startMutationObserver, { once: true });
  }

  window.SBStickyStack = {
    __initialized: true,
    getState: () => ({ ...currentState }),
    requestSync,
    scrollToElement,
    hasActiveTopAccessory: () => currentState.activeTopAccessoryCount > 0
  };

  requestSync();
  window.setTimeout(requestSync, 80);
  window.setTimeout(requestSync, 300);
})();
