(() => {
  window.SBHeaderInitializers = window.SBHeaderInitializers || [];

  window.SBHeaderInitializers.push((context) => {
    const { header, findHeaderRef, addRuntimeEventListener, onAbort, shared } = context;

    const mobileMenuDrawer = findHeaderRef(document, 'headerDrawerContainer', '[data-mobile-menu-drawer]');
    const mobileMenuToggle = header.querySelector('[data-mobile-menu-toggle]');
    const mobileMenuCloseControls = mobileMenuDrawer
      ? mobileMenuDrawer.querySelectorAll('[data-mobile-menu-close]')
      : [];
    const mobileMenuReview = mobileMenuDrawer
      ? mobileMenuDrawer.querySelector('[data-mobile-menu-review]')
      : null;
    const mobileMenuReviewName = mobileMenuReview
      ? mobileMenuReview.querySelector('[data-mobile-menu-review-name]')
      : null;
    const mobileMenuReviewText = mobileMenuReview
      ? mobileMenuReview.querySelector('[data-mobile-menu-review-text]')
      : null;
    const mobileMenuReviewDate = mobileMenuReview
      ? mobileMenuReview.querySelector('[data-mobile-menu-review-date]')
      : null;
    const mobileMenuTrustpilot = mobileMenuDrawer
      ? mobileMenuDrawer.querySelector('.menu-drawer__trustpilot')
      : null;

    const mobileMenuReviewStorageKey = 'sb-mobile-menu-review-index';
    const mobileMenuReviews = [
      { day: 8, name: 'Wesley G.', text: 'I have the in-ear monitors and the Pulse. They work exactly as promised. Shipping was good and without bad surprises. Thank you Soundbrenner!' },
      { day: 4, name: 'Rob M.', text: "I had questions about my purchase, and Ethan has been super attentive offering excellent explanations and suggestions. Services matters as much as the product you buy, and I'm impressed." },
      { day: 15, name: 'Lee K.', text: 'My initial order was delayed but the staff were super responsive to my emails and sorted it out without problem. Issues happen from time to time but I appreciate that they care about their customers and service.' },
      { day: 2, name: 'Samuel A.', text: 'Amazing customer service, great and quick service overall. I am really happy I purchased this product and I will be looking forward to future purchases.' },
      { day: 21, name: 'Nate L.', text: "Soundbrenner's customer service has been top notch. They helped me with a return for a bad adapter and made it right. Will gladly buy again from SB." },
      { day: 9, name: 'Christos T.', text: 'Incredible customer service experience: prompt and deliberate responses, and understanding of my needs. I am very pleased with how they handled my return process.' },
      { day: 12, name: 'Paul S.', text: 'Easy to shop for, shipping was fast, and the package presentation was much higher end than I expected.' },
      { day: 27, name: 'Mark C.', text: "This company is a breath of fresh air to deal with! I did have a problem with part of my order but it was resolved so quickly it really wasn't a problem. I genuinely look forward to using this company again." },
      { day: 18, name: 'Curtis E.', text: "One of the best customer support experiences I've ever had. I had one minor issue and they went above and beyond to correct it and emailed back within an hour. I don't see myself or my son buying from anyone else again." },
      { day: 5, name: 'Jerry W.', text: 'Easy checkout and fast shipping. These folks know how to treat a customer with respect and appreciation.' },
      { day: 24, name: 'Cymil M.', text: 'Shopping was seamless and easy. Customer service is very responsive and always presents options for whatever concern you may have. Five star.' },
    ];

    let mobileMenuCloseTimer = null;
    let pageScrollLockY = 0;
    let pageScrollLockMode = null;

    const mobileMenuPreloadedSources = new Set();
    const primaryMenuPreloadedSources = new Set();

    const isDesktopViewport = () => window.matchMedia('(min-width: 990px)').matches;
    const isMobileMenuOpen = () => Boolean(mobileMenuDrawer && mobileMenuDrawer.classList.contains('menu-open'));

    shared.isDesktopViewport = isDesktopViewport;
    shared.isMobileMenuOpen = isMobileMenuOpen;
    shared.getScrollLockY = () => pageScrollLockY;
    shared.isScrollLocked = () => document.body.dataset.sbScrollLocked === 'true';

    const setStickyLastY = (value) => {
      if (typeof shared.setStickyLastY === 'function') {
        shared.setStickyLastY(value);
      }
    };

    const clearMobileMenuCloseTimer = () => {
      if (!mobileMenuCloseTimer) return;
      window.clearTimeout(mobileMenuCloseTimer);
      mobileMenuCloseTimer = null;
    };

    const closeAllMobileAccordions = () => {
      if (!mobileMenuDrawer) return;
      mobileMenuDrawer.querySelectorAll('.menu-drawer__menu-container[open]').forEach((accordion) => {
        accordion.removeAttribute('open');
      });
      mobileMenuDrawer.querySelectorAll('drawer-localization-component').forEach((component) => {
        if (typeof component.closeDrawerPage === 'function') {
          component.closeDrawerPage({ immediate: true });
          return;
        }
        component.classList.remove('menu-open');
        const menuDrawerElement = component.closest('.menu-drawer');
        if (menuDrawerElement) menuDrawerElement.classList.remove('menu-drawer--has-submenu-opened');
        const panel = component.querySelector('[data-localization-ref="drawerPage"]');
        if (panel) panel.hidden = true;
      });
    };

    const shouldSkipDeferredImagePreload = () => {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!connection) return false;
      if (connection.saveData) return true;
      const effectiveType = `${connection.effectiveType || ''}`.toLowerCase();
      return effectiveType.includes('2g');
    };

    const preloadImageSource = (source, sourceCache) => {
      if (!source || sourceCache.has(source)) return;
      sourceCache.add(source);
      const preloadImage = new Image();
      preloadImage.decoding = 'async';
      preloadImage.src = source;
    };

    const preloadMobileMenuImages = () => {
      if (!mobileMenuDrawer || isDesktopViewport() || shouldSkipDeferredImagePreload()) return;
      const imageNodes = mobileMenuDrawer.querySelectorAll('.menu-drawer__submenu-image');
      imageNodes.forEach((imageNode) => {
        preloadImageSource(imageNode.getAttribute('src'), mobileMenuPreloadedSources);
      });
    };

    const scheduleMobileMenuPreload = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => preloadMobileMenuImages(), { timeout: 1200 });
        return;
      }
      window.setTimeout(preloadMobileMenuImages, 180);
    };

    const preloadPrimaryMenuImages = () => {
      if (!isDesktopViewport() || shouldSkipDeferredImagePreload()) return;
      const primaryImageNodes = header.querySelectorAll('.header__primary-card-image');
      primaryImageNodes.forEach((imageNode) => {
        preloadImageSource(imageNode.getAttribute('src'), primaryMenuPreloadedSources);
      });
    };

    const schedulePrimaryMenuPreload = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => preloadPrimaryMenuImages(), { timeout: 1200 });
        return;
      }
      window.setTimeout(preloadPrimaryMenuImages, 180);
    };

    shared.schedulePrimaryMenuPreload = schedulePrimaryMenuPreload;
    shared.preloadPrimaryMenuImages = preloadPrimaryMenuImages;

    const updateMobileMenuTrustpilotLayout = () => {
      if (!mobileMenuTrustpilot) return;
      mobileMenuTrustpilot.classList.remove('is-stacked');
      if (isDesktopViewport()) return;

      const trustpilotLinks = Array.from(mobileMenuTrustpilot.querySelectorAll('.menu-drawer__trustpilot-link'));
      if (trustpilotLinks.length <= 1) return;

      const trustpilotStyles = window.getComputedStyle(mobileMenuTrustpilot);
      const trustpilotGapValue = parseFloat(trustpilotStyles.columnGap || trustpilotStyles.gap || '0') || 0;
      const totalLinksWidth = trustpilotLinks.reduce((sum, linkElement) => sum + linkElement.getBoundingClientRect().width, 0);
      const requiredWidth = totalLinksWidth + trustpilotGapValue * (trustpilotLinks.length - 1);
      const availableWidth = Math.max(0, mobileMenuTrustpilot.clientWidth - 32);
      if (requiredWidth > availableWidth) mobileMenuTrustpilot.classList.add('is-stacked');
    };

    const getReviewMonthAndYear = () => {
      const now = new Date();
      const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return { month: monthLabels[previousMonthDate.getMonth()], year: previousMonthDate.getFullYear() };
    };

    const getStoredReviewIndex = () => {
      try {
        const storedValue = sessionStorage.getItem(mobileMenuReviewStorageKey);
        const parsedValue = Number.parseInt(`${storedValue}`, 10);
        if (!Number.isFinite(parsedValue)) return -1;
        if (parsedValue < 0 || parsedValue >= mobileMenuReviews.length) return -1;
        return parsedValue;
      } catch (_) {
        return -1;
      }
    };

    const storeReviewIndex = (index) => {
      try {
        sessionStorage.setItem(mobileMenuReviewStorageKey, `${index}`);
      } catch (_) {
        // Ignore storage failures (private mode, blocked storage, etc.)
      }
    };

    const pickReloadReviewIndex = () => {
      if (mobileMenuReviews.length <= 1) return 0;
      const previousIndex = getStoredReviewIndex();
      let nextIndex = Math.floor(Math.random() * mobileMenuReviews.length);
      if (nextIndex === previousIndex) {
        nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (mobileMenuReviews.length - 1))) % mobileMenuReviews.length;
      }
      storeReviewIndex(nextIndex);
      return nextIndex;
    };

    const renderMobileMenuReview = () => {
      if (!mobileMenuReviewName || !mobileMenuReviewText || !mobileMenuReviewDate) return;
      if (mobileMenuReviews.length === 0) return;
      const review = mobileMenuReviews[pickReloadReviewIndex()];
      const reviewDay = Number.parseInt(`${review.day}`, 10);
      const { month, year } = getReviewMonthAndYear();
      mobileMenuReviewName.textContent = review.name || '';
      mobileMenuReviewText.textContent = review.text || '';
      mobileMenuReviewDate.textContent = `${Number.isFinite(reviewDay) ? reviewDay : 8} ${month}, ${year}`;
    };

    const clearBodyFixedScrollLockStyles = () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
    };

    const releasePageScrollLock = ({ restoreScroll = true } = {}) => {
      if (document.body.dataset.sbScrollLocked !== 'true') {
        pageScrollLockMode = null;
        return;
      }

      const previousLockMode = pageScrollLockMode;
      document.documentElement.classList.remove('sb-scroll-locked');
      document.body.classList.remove('sb-scroll-locked');
      document.documentElement.style.overflow = '';
      clearBodyFixedScrollLockStyles();
      delete document.body.dataset.sbScrollLocked;
      pageScrollLockMode = null;

      if (restoreScroll && previousLockMode === 'fixed') {
        setStickyLastY(pageScrollLockY);
        window.scrollTo(0, pageScrollLockY);
        return;
      }

      setStickyLastY(window.scrollY || window.pageYOffset || 0);
    };

    const getPageScrollLockMode = () => {
      if (isMobileMenuOpen()) return 'fixed';

      const headerElement = document.querySelector('.header');
      const desktopPrimaryMenuOpen = isDesktopViewport()
        && headerElement
        && headerElement.classList.contains('is-primary-open');
      if (desktopPrimaryMenuOpen) return 'overflow';

      const mobileSearchShortcutOpen = window.matchMedia('(max-width: 989px)').matches
        && document.documentElement.classList.contains('sb-search-shortcut-open');
      if (mobileSearchShortcutOpen) return 'fixed';

      const cartDrawerElement = document.querySelector('[data-cart-drawer]');
      const cartOpen = Boolean(
        cartDrawerElement
        && !cartDrawerElement.hasAttribute('hidden')
        && cartDrawerElement.classList.contains('is-open')
      );

      if (!cartOpen) return null;
      return isDesktopViewport() ? 'overflow' : 'fixed';
    };

    const syncPageScrollLock = () => {
      const nextLockMode = getPageScrollLockMode();
      if (!nextLockMode) {
        releasePageScrollLock();
        return;
      }

      if (document.body.dataset.sbScrollLocked === 'true' && pageScrollLockMode === nextLockMode) return;
      if (document.body.dataset.sbScrollLocked === 'true') {
        releasePageScrollLock({ restoreScroll: false });
      }

      pageScrollLockY = window.scrollY || window.pageYOffset || 0;
      setStickyLastY(pageScrollLockY);
      document.documentElement.classList.add('sb-scroll-locked');
      document.body.classList.add('sb-scroll-locked');
      document.documentElement.style.overflow = 'hidden';

      if (nextLockMode === 'fixed') {
        document.body.style.position = 'fixed';
        document.body.style.top = `-${pageScrollLockY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
      } else {
        clearBodyFixedScrollLockStyles();
      }

      document.body.dataset.sbScrollLocked = 'true';
      pageScrollLockMode = nextLockMode;
    };

    shared.syncPageScrollLock = syncPageScrollLock;

    const openMobileMenu = () => {
      if (!mobileMenuDrawer || !mobileMenuToggle || isDesktopViewport()) return;
      clearMobileMenuCloseTimer();
      mobileMenuToggle.setAttribute('aria-expanded', 'true');
      scheduleMobileMenuPreload();
      mobileMenuDrawer.classList.add('menu-open');
      window.requestAnimationFrame(updateMobileMenuTrustpilotLayout);
      document.body.classList.add('is-mobile-menu-open');
      syncPageScrollLock();
    };

    const closeMobileMenu = ({ immediate = false, preserveHeaderState = false } = {}) => {
      if (!mobileMenuDrawer || !mobileMenuToggle) return;
      const wasMobileMenuOpen = isMobileMenuOpen();
      clearMobileMenuCloseTimer();
      mobileMenuDrawer.classList.remove('menu-open');
      mobileMenuToggle.setAttribute('aria-expanded', 'false');

      const finalizeClose = () => {
        closeAllMobileAccordions();
        document.body.classList.remove('is-mobile-menu-open');
        syncPageScrollLock();
        if (wasMobileMenuOpen && typeof shared.syncStickyState === 'function') {
          if (preserveHeaderState) shared.syncStickyState();
          else shared.syncStickyState({ force: true });
          if (typeof shared.syncPrimaryBackdropOnScroll === 'function') {
            shared.syncPrimaryBackdropOnScroll();
          }
        }
      };

      if (immediate) {
        finalizeClose();
        return;
      }
      finalizeClose();
    };

    shared.closeMobileMenu = closeMobileMenu;

    renderMobileMenuReview();

    if (mobileMenuDrawer && mobileMenuToggle) {
      addRuntimeEventListener(mobileMenuToggle, 'click', (event) => {
        event.preventDefault();
        if (isMobileMenuOpen()) closeMobileMenu();
        else openMobileMenu();
      });

      mobileMenuCloseControls.forEach((control) => {
        addRuntimeEventListener(control, 'click', () => closeMobileMenu());
      });

      mobileMenuDrawer.querySelectorAll('.menu-drawer__navigation a').forEach((link) => {
        addRuntimeEventListener(link, 'click', () => closeMobileMenu({ immediate: true }));
      });

      addRuntimeEventListener(mobileMenuDrawer, 'keyup', (event) => {
        if (event.key !== 'Escape') return;
        closeMobileMenu();
      });

      addRuntimeEventListener(window, 'resize', () => {
        if (isDesktopViewport()) {
          closeMobileMenu({ immediate: true, preserveHeaderState: true });
          if (typeof shared.schedulePrimaryMenuPreload === 'function') {
            shared.schedulePrimaryMenuPreload();
          }
          return;
        }

        scheduleMobileMenuPreload();
        window.requestAnimationFrame(updateMobileMenuTrustpilotLayout);
      }, { passive: true });

      scheduleMobileMenuPreload();
      window.requestAnimationFrame(updateMobileMenuTrustpilotLayout);
    }

    addRuntimeEventListener(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (isMobileMenuOpen()) closeMobileMenu();
    });

    addRuntimeEventListener(document, 'sb:cart-drawer:state-change', syncPageScrollLock);
    addRuntimeEventListener(document, 'sb:header-search-shortcut:toggle', syncPageScrollLock);

    onAbort(() => {
      clearMobileMenuCloseTimer();
      if (isMobileMenuOpen()) {
        mobileMenuDrawer?.classList.remove('menu-open');
        mobileMenuToggle?.setAttribute('aria-expanded', 'false');
        closeAllMobileAccordions();
        document.body.classList.remove('is-mobile-menu-open');
      }
      releasePageScrollLock({ restoreScroll: false });
    });
  });
})();
