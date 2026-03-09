(() => {
  window.SBHeaderInitializers = window.SBHeaderInitializers || [];

  window.SBHeaderInitializers.push((context) => {
    const { header, addRuntimeEventListener, findHeaderRef, onAbort, shared } = context;

    const isDesktopViewport = shared.isDesktopViewport || (() => window.matchMedia('(min-width: 990px)').matches);
    const headerInnerElement = findHeaderRef(header, 'headerInner', '.header__inner');
    const desktopMenu = findHeaderRef(header, 'headerMenu', '.header__menu');
    const desktopMenuItems = desktopMenu ? Array.from(desktopMenu.querySelectorAll('.header__menu-item')) : [];
    const desktopBrand = header.querySelector('.header__brand');
    const desktopRightIcons = header.querySelector('.header__icons--right');

    const navWrapSideGap = 24;
    let navLayoutRaf = null;
    let navLayoutObserver = null;

    const clearDesktopNavLayoutClasses = () => {
      header.classList.remove('is-nav-wrap');
    };

    const getDesktopNavRects = () => {
      if (!desktopMenu || !desktopBrand || !desktopRightIcons) return null;
      return {
        menuRect: desktopMenu.getBoundingClientRect(),
        brandRect: desktopBrand.getBoundingClientRect(),
        utilityRect: desktopRightIcons.getBoundingClientRect(),
      };
    };

    const hasDesktopNavOverlap = () => {
      const rects = getDesktopNavRects();
      if (!rects) return false;
      return (
        rects.menuRect.left < (rects.brandRect.right + navWrapSideGap)
        || rects.menuRect.right > (rects.utilityRect.left - navWrapSideGap)
      );
    };

    const applyDesktopNavLayout = () => {
      if (!isDesktopViewport() || !desktopMenu || desktopMenuItems.length === 0) {
        clearDesktopNavLayoutClasses();
        return;
      }

      clearDesktopNavLayoutClasses();
      if (!hasDesktopNavOverlap()) return;

      header.classList.add('is-nav-wrap');
    };

    const scheduleDesktopNavLayout = () => {
      if (navLayoutRaf) window.cancelAnimationFrame(navLayoutRaf);
      navLayoutRaf = window.requestAnimationFrame(() => {
        navLayoutRaf = null;
        applyDesktopNavLayout();
      });
    };

    addRuntimeEventListener(window, 'resize', scheduleDesktopNavLayout, { passive: true });
    window.requestAnimationFrame(scheduleDesktopNavLayout);

    if (document.fonts && typeof document.fonts.ready === 'object') {
      document.fonts.ready.then(() => {
        scheduleDesktopNavLayout();
      });
    }

    if (window.ResizeObserver && headerInnerElement) {
      navLayoutObserver = new ResizeObserver(() => {
        scheduleDesktopNavLayout();
      });
      navLayoutObserver.observe(headerInnerElement);
      if (desktopBrand) navLayoutObserver.observe(desktopBrand);
      if (desktopRightIcons) navLayoutObserver.observe(desktopRightIcons);
      if (desktopMenu) navLayoutObserver.observe(desktopMenu);
    }

    const dropdownMenuItems = header.querySelectorAll('.header__menu-item.has-dropdown');
    const plainMenuItems = header.querySelectorAll('.header__menu-item:not(.has-dropdown)');
    const primaryBackdrops = Array.from(document.querySelectorAll('[data-header-primary-backdrop]'));

    if (dropdownMenuItems.length > 0) {
      let activeDropdownItem = null;
      let localizationDropdownOpen = false;
      let searchShortcutOpen = false;
      let closeMenuTimer = null;
      let primarySwitchTimer = null;
      let primaryClosingTimer = null;
      let hoverOpenTimer = null;
      let hoverOpenCandidateItem = null;
      let hoverOpenPointerStartX = 0;
      let hoverOpenPointerStartY = 0;
      let lastMouseMoveAt = 0;
      let pointerX = 0;
      let pointerY = 0;
      let allowHoverPrimaryMenuOpen = false;

      const menuSafePadding = 8;
      const primaryHoverOpenDelayMs = 36;
      const primaryHoverSettleDelayMs = 34;
      const primaryHoverMoveThresholdPx = 10;

      const headerInner = header.querySelector('.header__inner');
      const headerMenu = header.querySelector('.header__menu');

      const dropdownMenuLinks = Array.from(dropdownMenuItems)
        .map((menuItem) => menuItem.querySelector('.header__menu-link'))
        .filter(Boolean);

      let hasTriggeredPrimaryMenuPreload = false;

      const triggerPrimaryMenuPreload = () => {
        if (hasTriggeredPrimaryMenuPreload) return;
        hasTriggeredPrimaryMenuPreload = true;
        if (typeof shared.preloadPrimaryMenuImages === 'function') {
          shared.preloadPrimaryMenuImages();
        }
      };

      const clearCloseMenuTimer = () => {
        if (!closeMenuTimer) return;
        window.clearTimeout(closeMenuTimer);
        closeMenuTimer = null;
      };

      const clearHoverOpenTimer = () => {
        if (hoverOpenTimer) window.clearTimeout(hoverOpenTimer);
        hoverOpenTimer = null;
        hoverOpenCandidateItem = null;
      };

      const clearPrimarySwitchTimer = () => {
        if (!primarySwitchTimer) return;
        window.clearTimeout(primarySwitchTimer);
        primarySwitchTimer = null;
      };

      const clearPrimaryClosingTimer = () => {
        if (!primaryClosingTimer) return;
        window.clearTimeout(primaryClosingTimer);
        primaryClosingTimer = null;
      };

      const clearPrimarySwitchInlineWidths = () => {
        dropdownMenuItems.forEach((menuItem) => {
          const menu = menuItem.querySelector('.header__primary-menu');
          if (!menu) return;
          menu.style.removeProperty('width');
        });
      };

      const endPrimarySwitchMode = () => {
        header.classList.remove('is-primary-switching');
        clearPrimarySwitchInlineWidths();
      };

      const triggerPrimarySwitchMode = (fromItem, toItem) => {
        if (!fromItem || !toItem) return;
        const fromMenu = fromItem.querySelector('.header__primary-menu');
        const toMenu = toItem.querySelector('.header__primary-menu');
        if (!fromMenu || !toMenu) return;
        clearPrimarySwitchTimer();
        header.classList.add('is-primary-switching');
        primarySwitchTimer = window.setTimeout(() => {
          endPrimarySwitchMode();
          primarySwitchTimer = null;
        }, 0);
      };

      const syncPrimaryBackdropTop = () => {
        if (!headerInner || primaryBackdrops.length === 0) return;
        const navRect = headerInner.getBoundingClientRect();
        const navTop = Math.max(0, navRect.top);
        const navBottom = Math.min(window.innerHeight, navRect.bottom);
        const visibleNavHeight = Math.max(0, navBottom - navTop);

        if (visibleNavHeight <= 1) {
          primaryBackdrops.forEach((backdrop) => {
            if (backdrop.dataset.headerPrimaryBackdrop === 'top') {
              backdrop.style.top = '0px';
              backdrop.style.bottom = '100%';
            } else {
              backdrop.style.top = '0px';
              backdrop.style.bottom = '0px';
            }
          });
          return;
        }

        primaryBackdrops.forEach((backdrop) => {
          if (backdrop.dataset.headerPrimaryBackdrop === 'top') {
            backdrop.style.top = '0px';
            backdrop.style.bottom = `${Math.max(0, window.innerHeight - navTop)}px`;
          } else {
            backdrop.style.top = `${navBottom}px`;
            backdrop.style.bottom = '0px';
          }
        });
      };

      shared.syncPrimaryBackdropOnScroll = () => {
        if (!header.classList.contains('is-primary-open')) return;
        syncPrimaryBackdropTop();
      };

      const updatePrimaryOpenState = () => {
        const isPrimaryOpen = Boolean(activeDropdownItem || localizationDropdownOpen || searchShortcutOpen);
        if (window.matchMedia('(max-width: 989px)').matches) {
          clearPrimaryClosingTimer();
          header.classList.remove('is-primary-closing');
          if (activeDropdownItem) activeDropdownItem.classList.remove('is-open');
          activeDropdownItem = null;
          localizationDropdownOpen = false;
          header.classList.remove('is-primary-open');
          clearPrimarySwitchTimer();
          header.classList.remove('is-primary-switching');
          clearPrimarySwitchInlineWidths();
          primaryBackdrops.forEach((backdrop) => backdrop.classList.remove('is-active'));
          if (typeof shared.syncPageScrollLock === 'function') shared.syncPageScrollLock();
          return;
        }

        if (isPrimaryOpen) {
          clearPrimaryClosingTimer();
          header.classList.remove('is-primary-closing');
          header.classList.add('is-primary-open');
          syncPrimaryBackdropTop();
          primaryBackdrops.forEach((backdrop) => backdrop.classList.add('is-active'));
        } else {
          header.classList.remove('is-primary-open');
          clearPrimaryClosingTimer();
          header.classList.add('is-primary-closing');
          primaryClosingTimer = window.setTimeout(() => {
            header.classList.remove('is-primary-closing');
            primaryClosingTimer = null;
          }, 180);
          primaryBackdrops.forEach((backdrop) => backdrop.classList.remove('is-active'));
        }

        if (typeof shared.syncPageScrollLock === 'function') shared.syncPageScrollLock();
      };

      const handleLocalizationDropdownToggle = (event) => {
        const nextOpen = Boolean(event && event.detail && event.detail.open);
        localizationDropdownOpen = nextOpen;

        if (localizationDropdownOpen && searchShortcutOpen) {
          document.dispatchEvent(new CustomEvent('sb:header-search-shortcut:request-close'));
        }

        if (localizationDropdownOpen && activeDropdownItem) {
          setActiveDropdownItem(null);
          return;
        }

        if (localizationDropdownOpen) syncPrimaryBackdropTop();
        updatePrimaryOpenState();
      };

      const handleSearchShortcutToggle = (event) => {
        const nextOpen = Boolean(event && event.detail && event.detail.open);
        searchShortcutOpen = nextOpen;

        if (searchShortcutOpen) {
          clearHoverOpenTimer();
          clearCloseMenuTimer();

          if (activeDropdownItem) setActiveDropdownItem(null);

          if (localizationDropdownOpen) {
            localizationDropdownOpen = false;
            document.dispatchEvent(new CustomEvent('sb:header-localization:request-close'));
          }

          syncPrimaryBackdropTop();
        }

        updatePrimaryOpenState();
      };

      addRuntimeEventListener(document, 'sb:header-localization:toggle', handleLocalizationDropdownToggle);
      addRuntimeEventListener(document, 'sb:header-search-shortcut:toggle', handleSearchShortcutToggle);

      const setActiveDropdownItem = (nextItem) => {
        if (activeDropdownItem === nextItem) return;
        if (nextItem) {
          localizationDropdownOpen = false;
          document.dispatchEvent(new CustomEvent('sb:header-localization:request-close'));
          if (searchShortcutOpen) {
            document.dispatchEvent(new CustomEvent('sb:header-search-shortcut:request-close'));
          }
          document.dispatchEvent(new CustomEvent('sb:blog-filter:request-close'));
        }
        if (activeDropdownItem && nextItem) triggerPrimarySwitchMode(activeDropdownItem, nextItem);
        else {
          clearPrimarySwitchTimer();
          header.classList.remove('is-primary-switching');
          clearPrimarySwitchInlineWidths();
        }
        if (activeDropdownItem) activeDropdownItem.classList.remove('is-open');
        activeDropdownItem = nextItem || null;
        if (activeDropdownItem) activeDropdownItem.classList.add('is-open');
        updatePrimaryOpenState();
      };

      const closeActiveDropdown = () => {
        clearHoverOpenTimer();
        setActiveDropdownItem(null);
      };

      const pointerStillCrossingMenuItem = () => {
        const moveAge = Date.now() - lastMouseMoveAt;
        const pointerTravel = Math.hypot(pointerX - hoverOpenPointerStartX, pointerY - hoverOpenPointerStartY);
        return moveAge < primaryHoverSettleDelayMs && pointerTravel > primaryHoverMoveThresholdPx;
      };

      const runHoverOpenIntent = () => {
        if (!hoverOpenCandidateItem) {
          clearHoverOpenTimer();
          return;
        }

        if (!hoverOpenCandidateItem.matches(':hover')) {
          clearHoverOpenTimer();
          return;
        }

        if (pointerStillCrossingMenuItem()) {
          hoverOpenTimer = window.setTimeout(runHoverOpenIntent, primaryHoverSettleDelayMs);
          return;
        }

        const targetItem = hoverOpenCandidateItem;
        clearHoverOpenTimer();
        clearCloseMenuTimer();
        setActiveDropdownItem(targetItem);
      };

      const scheduleHoverOpenIntent = (menuItem, event) => {
        if (!menuItem) return;
        clearHoverOpenTimer();
        clearCloseMenuTimer();
        if (activeDropdownItem) {
          setActiveDropdownItem(menuItem);
          return;
        }
        hoverOpenCandidateItem = menuItem;
        hoverOpenPointerStartX = event ? event.clientX : pointerX;
        hoverOpenPointerStartY = event ? event.clientY : pointerY;
        hoverOpenTimer = window.setTimeout(runHoverOpenIntent, primaryHoverOpenDelayMs);
      };

      const getDropdownTrackBounds = () => {
        if (!headerMenu || dropdownMenuLinks.length === 0) return null;
        const menuRect = headerMenu.getBoundingClientRect();
        const firstRect = dropdownMenuLinks[0].getBoundingClientRect();
        const lastRect = dropdownMenuLinks[dropdownMenuLinks.length - 1].getBoundingClientRect();
        return { left: firstRect.left, right: lastRect.right, top: menuRect.top, bottom: menuRect.bottom };
      };

      const pointerInSafeCorridor = (menuItem) => {
        if (!menuItem || !headerInner) return false;
        const primaryMenu = menuItem.querySelector('.header__primary-menu');
        if (!primaryMenu) return false;
        const headerInnerRect = headerInner.getBoundingClientRect();
        const menuRect = primaryMenu.getBoundingClientRect();
        const corridorTop = Math.min(headerInnerRect.bottom, menuRect.top);
        const corridorBottom = Math.max(headerInnerRect.bottom, menuRect.top);
        const corridorLeft = menuRect.left;
        const corridorRight = menuRect.right;

        return (
          pointerX >= corridorLeft
          && pointerX <= corridorRight
          && pointerY >= corridorTop
          && pointerY <= corridorBottom
        );
      };

      const pointerInMenuStrip = () => {
        const trackBounds = getDropdownTrackBounds();
        if (!trackBounds) return false;
        return (
          pointerY >= trackBounds.top
          && pointerY <= trackBounds.bottom
          && pointerX >= trackBounds.left - menuSafePadding
          && pointerX <= trackBounds.right + menuSafePadding
        );
      };

      const scheduleCloseActiveDropdown = () => {
        clearCloseMenuTimer();
        closeMenuTimer = window.setTimeout(() => {
          const activePrimaryMenu = activeDropdownItem && activeDropdownItem.querySelector('.header__primary-menu');
          const primaryMenuHovered = Boolean(activePrimaryMenu && activePrimaryMenu.matches(':hover'));
          const inSafeCorridor = pointerInSafeCorridor(activeDropdownItem);
          const inMenuStrip = pointerInMenuStrip();

          if (primaryMenuHovered || inSafeCorridor || inMenuStrip) {
            scheduleCloseActiveDropdown();
            return;
          }

          closeActiveDropdown();
        }, 120);
      };

      const isPointerInPrimaryHoverZone = () => Boolean(
        header.querySelector('.header__menu-item.has-dropdown:hover')
        || header.querySelector('.header__menu-item:not(.has-dropdown):hover')
        || header.querySelector('.header__primary-menu:hover')
      );

      dropdownMenuItems.forEach((menuItem) => {
        const menuLink = menuItem.querySelector('.header__menu-link');
        const primaryMenu = menuItem.querySelector('.header__primary-menu');

        if (menuLink) {
          addRuntimeEventListener(menuLink, 'mouseenter', (event) => {
            triggerPrimaryMenuPreload();
            if (!allowHoverPrimaryMenuOpen) return;
            scheduleHoverOpenIntent(menuItem, event);
          });
          addRuntimeEventListener(menuLink, 'focusin', triggerPrimaryMenuPreload);
          addRuntimeEventListener(menuLink, 'touchstart', triggerPrimaryMenuPreload, { passive: true });
        }

        addRuntimeEventListener(menuItem, 'focusin', () => {
          clearHoverOpenTimer();
          clearCloseMenuTimer();
          setActiveDropdownItem(menuItem);
        });

        addRuntimeEventListener(menuItem, 'focusout', (event) => {
          if (menuItem.contains(event.relatedTarget)) return;
          window.requestAnimationFrame(() => {
            if (!header.contains(document.activeElement)) closeActiveDropdown();
            else updatePrimaryOpenState();
          });
        });

        if (primaryMenu) {
          addRuntimeEventListener(primaryMenu, 'mouseenter', () => {
            if (!allowHoverPrimaryMenuOpen && !activeDropdownItem) return;
            clearHoverOpenTimer();
            clearCloseMenuTimer();
            setActiveDropdownItem(menuItem);
          });

          addRuntimeEventListener(primaryMenu, 'mouseleave', () => {
            scheduleCloseActiveDropdown();
          });
        }
      });

      plainMenuItems.forEach((menuItem) => {
        const menuLink = menuItem.querySelector('.header__menu-link');
        if (!menuLink) return;
        addRuntimeEventListener(menuLink, 'mouseenter', () => {
          clearHoverOpenTimer();
          clearCloseMenuTimer();
          closeActiveDropdown();
        });
      });

      addRuntimeEventListener(header, 'mouseenter', () => {
        clearCloseMenuTimer();
      });

      addRuntimeEventListener(header, 'mouseleave', () => {
        clearHoverOpenTimer();
        scheduleCloseActiveDropdown();
        allowHoverPrimaryMenuOpen = true;
      });

      if (headerInner) {
        addRuntimeEventListener(headerInner, 'mousemove', (event) => {
          if (!activeDropdownItem) return;
          if (window.matchMedia('(max-width: 989px)').matches) return;
          const trackBounds = getDropdownTrackBounds();
          if (!trackBounds) return;

          const aboveMenuStrip = event.clientY < (trackBounds.top - menuSafePadding);
          if (aboveMenuStrip) {
            clearCloseMenuTimer();
            closeActiveDropdown();
            return;
          }

          const withinMenuBand = event.clientY >= trackBounds.top && event.clientY <= trackBounds.bottom;
          const outsideMenuHorizontally = event.clientX < (trackBounds.left - menuSafePadding)
            || event.clientX > (trackBounds.right + menuSafePadding);
          if (!withinMenuBand || !outsideMenuHorizontally) return;
          clearCloseMenuTimer();
          closeActiveDropdown();
        });
      }

      addRuntimeEventListener(document, 'pointerdown', (event) => {
        if (header.contains(event.target)) return;
        clearHoverOpenTimer();
        clearCloseMenuTimer();
        closeActiveDropdown();
      });

      addRuntimeEventListener(document, 'pointermove', (event) => {
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (event.pointerType !== 'mouse') return;
        lastMouseMoveAt = Date.now();
        if (allowHoverPrimaryMenuOpen) return;
        if (isPointerInPrimaryHoverZone()) return;
        allowHoverPrimaryMenuOpen = true;
      }, { passive: true });

      addRuntimeEventListener(window, 'pageshow', () => {
        allowHoverPrimaryMenuOpen = false;
        clearHoverOpenTimer();
        clearCloseMenuTimer();
        closeActiveDropdown();
      });

      addRuntimeEventListener(window, 'resize', () => {
        clearHoverOpenTimer();
        clearCloseMenuTimer();
        closeActiveDropdown();
        syncPrimaryBackdropTop();
        updatePrimaryOpenState();
      }, { passive: true });

      syncPrimaryBackdropTop();
    }

    if (typeof shared.schedulePrimaryMenuPreload === 'function') {
      shared.schedulePrimaryMenuPreload();
    }

    onAbort(() => {
      if (navLayoutRaf != null) {
        window.cancelAnimationFrame(navLayoutRaf);
        navLayoutRaf = null;
      }

      if (navLayoutObserver) {
        navLayoutObserver.disconnect();
        navLayoutObserver = null;
      }
    });
  });
})();
