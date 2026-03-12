(() => {
  const ROOT_SELECTOR = '[data-sb-motion="reveal"]';
  const ITEM_SELECTOR = '[data-sb-motion-item]';
  const LINKED_ITEM_STATE_ATTR = 'data-sb-motion-linked-state';
  const REVIEWS_APP_LINK = 'next-reviews-app';
  const REVIEWS_APP_SELECTOR = ".shopify-app-block[id*='klaviyo_reviews_product_reviews'], .shopify-app-block[id*='klaviyo_reviews_all_reviews'], .shopify-app-block > #fulfilled-reviews-all, .shopify-app-block > #klaviyo-reviews-all, .shopify-app-block > #klaviyo-product-reviews-wrapper";
  const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
  const REVEAL_ROOT_MARGIN = '0px 0px -10% 0px';
  const DEFAULT_DISTANCE = 60;
  const SPRING_STIFFNESS = 100;
  const SPRING_DAMPING = 30;
  const SPRING_MASS = 1;
  const SPRING_FPS = 60;
  const SPRING_SETTLE_THRESHOLD = 0.001;
  const SPRING_MIN_FRAMES = 18;
  const SPRING_MAX_FRAMES = 90;
  const url = new URL(window.location.href);
  const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  const rootAnimations = new WeakMap();
  const springCache = new Map();
  let revealObserver = null;

  const getMatchingRoots = (scope, selector) => {
    if (!(scope instanceof Element || scope instanceof Document) || !selector) return [];
    const roots = Array.from(scope.querySelectorAll(selector));
    if (scope instanceof Element && scope.matches(selector)) {
      roots.unshift(scope);
    }
    return roots;
  };

  const motionIsDisabled = () =>
    reducedMotionQuery.matches
    || Boolean(window.Shopify && window.Shopify.designMode)
    || url.searchParams.get('sb-motion') === 'off';

  const getMotionItems = (root) => {
    if (!(root instanceof Element)) return [];
    const items = Array.from(root.querySelectorAll(ITEM_SELECTOR));
    if (root.matches(ITEM_SELECTOR)) {
      items.unshift(root);
    }
    getLinkedItems(root).forEach((item) => {
      items.push(item);
    });
    return Array.from(new Set(items));
  };

  const getLinkedItems = (root) => {
    if (!(root instanceof HTMLElement)) return [];
    if (root.dataset.sbMotionLink !== REVIEWS_APP_LINK) return [];

    const sectionWrapper = root.closest('.shopify-section');
    const nextSection = sectionWrapper?.nextElementSibling;
    if (!(nextSection instanceof HTMLElement) || !nextSection.matches('.shopify-section')) return [];
    if (!nextSection.querySelector(REVIEWS_APP_SELECTOR)) return [];
    return [nextSection];
  };

  const setLinkedItemsState = (root, state) => {
    getLinkedItems(root).forEach((item) => {
      item.setAttribute(LINKED_ITEM_STATE_ATTR, state);
    });
  };

  const getMotionDistance = (item) => {
    if (!(item instanceof Element)) return DEFAULT_DISTANCE;
    const rawValue = window.getComputedStyle(item).getPropertyValue('--sb-motion-distance').trim();
    const distance = parseFloat(rawValue);
    return Number.isFinite(distance) ? distance : DEFAULT_DISTANCE;
  };

  const getSpringPreset = (distance) => {
    const cacheKey = distance.toFixed(3);
    if (springCache.has(cacheKey)) return springCache.get(cacheKey);

    const frameDuration = 1 / SPRING_FPS;
    const samples = [{ time: 0, position: 0 }];
    let position = 0;
    let velocity = 0;
    let frame = 0;

    while (frame < SPRING_MAX_FRAMES) {
      const acceleration = ((SPRING_STIFFNESS * (1 - position)) - (SPRING_DAMPING * velocity)) / SPRING_MASS;
      velocity += acceleration * frameDuration;
      position += velocity * frameDuration;
      frame += 1;
      samples.push({
        time: frame * frameDuration,
        position,
      });

      if (
        frame >= SPRING_MIN_FRAMES
        && Math.abs(1 - position) <= SPRING_SETTLE_THRESHOLD
        && Math.abs(velocity) <= SPRING_SETTLE_THRESHOLD
      ) {
        break;
      }
    }

    const totalTime = samples.at(-1)?.time || frameDuration;
    const preset = {
      duration: Math.round(totalTime * 1000),
      keyframes: samples.map(({ time, position: samplePosition }) => {
        const clampedProgress = Math.max(0, Math.min(samplePosition, 1));
        const translateY = ((1 - clampedProgress) * distance).toFixed(3);
        return {
          offset: time / totalTime,
          opacity: clampedProgress,
          transform: `translateY(${translateY}px)`,
        };
      }),
    };

    preset.keyframes[0] = {
      ...preset.keyframes[0],
      offset: 0,
      opacity: 0,
      transform: `translateY(${distance}px)`,
    };
    preset.keyframes[preset.keyframes.length - 1] = {
      ...preset.keyframes[preset.keyframes.length - 1],
      offset: 1,
      opacity: 1,
      transform: 'translateY(0px)',
    };

    springCache.set(cacheKey, preset);
    return preset;
  };

  const cancelRootAnimations = (root) => {
    const animations = rootAnimations.get(root) || [];
    rootAnimations.delete(root);
    animations.forEach((animation) => {
      if (animation && typeof animation.cancel === 'function') {
        animation.cancel();
      }
    });
  };

  const setRootState = (root, state) => {
    if (!(root instanceof HTMLElement)) return;
    root.dataset.sbMotionState = state;
    setLinkedItemsState(root, state);
    if (revealObserver) revealObserver.unobserve(root);
  };

  const revealRoot = (root) => {
    if (!(root instanceof HTMLElement)) return;
    const items = getMotionItems(root);
    if (!items.length || typeof items[0]?.animate !== 'function') {
      setRootState(root, 'revealed');
      return;
    }

    cancelRootAnimations(root);
    root.dataset.sbMotionState = 'animating';
    if (revealObserver) revealObserver.unobserve(root);

    const animations = items.map((item) => {
      const springPreset = getSpringPreset(getMotionDistance(item));
      return item.animate(springPreset.keyframes, {
        duration: springPreset.duration,
        easing: 'linear',
        fill: 'both',
      });
    });

    rootAnimations.set(root, animations);

    let remainingAnimations = animations.length;
    const completeReveal = () => {
      remainingAnimations -= 1;
      if (remainingAnimations > 0) return;
      if (rootAnimations.get(root) !== animations) return;
      rootAnimations.delete(root);
      setRootState(root, 'revealed');
    };

    animations.forEach((animation) => {
      animation.onfinish = completeReveal;
      animation.oncancel = completeReveal;
    });
  };

  const showRootImmediately = (root) => {
    cancelRootAnimations(root);
    setRootState(root, 'static');
  };

  const setRootPending = (root) => {
    if (!(root instanceof HTMLElement)) return;
    root.dataset.sbMotionState = 'pending';
  };

  const shouldRevealImmediately = (root) => {
    if (!(root instanceof HTMLElement)) return true;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportHeight <= 0) return true;
    return root.getBoundingClientRect().top <= viewportHeight * 0.9;
  };

  const ensureObserver = () => {
    if (revealObserver || motionIsDisabled() || typeof IntersectionObserver !== 'function') return revealObserver;
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          revealRoot(entry.target);
        });
      },
      {
        rootMargin: REVEAL_ROOT_MARGIN,
        threshold: 0,
      }
    );
    return revealObserver;
  };

  const initRoot = (root) => {
    if (!(root instanceof HTMLElement)) return;
    if (root.dataset.sbMotionState === 'pending' || root.dataset.sbMotionState === 'animating' || root.dataset.sbMotionState === 'revealed' || root.dataset.sbMotionState === 'static') return;
    if (motionIsDisabled()) {
      showRootImmediately(root);
      return;
    }
    if (typeof IntersectionObserver !== 'function') {
      showRootImmediately(root);
      return;
    }
    if (shouldRevealImmediately(root)) {
      showRootImmediately(root);
      return;
    }
    setRootPending(root);
    ensureObserver()?.observe(root);
  };

  const initScope = (scope = document) => {
    getMatchingRoots(scope, ROOT_SELECTOR).forEach((root) => {
      initRoot(root);
    });
  };

  const revealAll = (scope = document) => {
    getMatchingRoots(scope, ROOT_SELECTOR).forEach((root) => {
      showRootImmediately(root);
    });
  };

  const initialize = () => {
    if (motionIsDisabled()) {
      revealAll(document);
      return;
    }
    initScope(document);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  document.addEventListener('shopify:section:load', (event) => {
    if (!event || !(event.target instanceof Element)) return;
    if (motionIsDisabled()) {
      revealAll(event.target);
      return;
    }
    initScope(event.target);
  });

  const handleReducedMotionChange = (event) => {
    if (!event.matches) return;
    revealAll(document);
  };

  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
  } else if (typeof reducedMotionQuery.addListener === 'function') {
    reducedMotionQuery.addListener(handleReducedMotionChange);
  }
})();
