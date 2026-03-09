(() => {
  const modalRoot = document.querySelector('[data-search-shortcut-modal]');
  if (!(modalRoot instanceof HTMLElement)) return;

  const dialog = modalRoot.querySelector('[data-search-shortcut-dialog]');
  const form = modalRoot.querySelector('[data-search-shortcut-form]');
  const searchInput = modalRoot.querySelector('[data-search-shortcut-input]');
  const results = modalRoot.querySelector('[data-search-shortcut-results]');
  const body = results instanceof HTMLElement ? results.closest('.sb-search-shortcut__body') : null;
  const openButtons = document.querySelectorAll('[data-search-shortcut-open]');
  const closeButtons = modalRoot.querySelectorAll('[data-search-shortcut-close]');

  if (!(dialog instanceof HTMLElement)) return;
  if (!(form instanceof HTMLFormElement)) return;
  if (!(searchInput instanceof HTMLInputElement)) return;
  if (!(results instanceof HTMLElement)) return;
  if (!(body instanceof HTMLElement)) return;

  const predictiveSearchUrl = `${modalRoot.dataset.predictiveSearchUrl || ''}`;
  const predictiveSectionId = `${modalRoot.dataset.predictiveSectionId || 'predictive-search'}`;
  const errorText = `${modalRoot.dataset.errorText || ''}`.trim();
  const recentlyViewedTitle = `${modalRoot.dataset.recentlyViewedTitle || ''}`.trim();
  const searchBestsellersTitle = `${modalRoot.dataset.searchBestsellersTitle || ''}`.trim();
  const searchBestsellerIdsRaw = `${modalRoot.dataset.searchBestsellerIds || ''}`.trim();
  const recentlyViewedStorageKey = `${modalRoot.dataset.recentlyViewedStorageKey || 'viewedProducts'}`.trim()
    || 'viewedProducts';
  const desktopRecentlyViewedItemsPerRow = 4;
  const mobileRecentlyViewedItemsPerRow = 4;
  const bestsellersItemsLimit = 4;
  const emptyStateProductFetchChunkSize = 4;
  const maxRecentlyViewedItemsToPrefetch = Math.max(
    desktopRecentlyViewedItemsPerRow,
    mobileRecentlyViewedItemsPerRow
  );

  let activeFetchController = null;
  let selectedIndex = -1;
  let closeTimer = null;
  let emptyStateFetchPromise = null;
  let emptyStateFetchKey = '';
  const closeFallbackMs = 620;
  const emptyStateProductItemsCache = new Map();

  const parser = new DOMParser();
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const debounce = (fn, wait) => {
    let timer = null;

    return (...args) => {
      if (timer) window.clearTimeout(timer);

      timer = window.setTimeout(() => {
        timer = null;
        fn(...args);
      }, wait);
    };
  };

  const isPlainLeftClick = (event) => {
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    return true;
  };
  const notifyHeaderSearchState = (isOpen) => {
    document.dispatchEvent(
      new CustomEvent('sb:header-search-shortcut:toggle', {
        detail: {
          open: Boolean(isOpen),
        },
      })
    );
  };

  const isDialogOpen = () => !dialog.hasAttribute('hidden');
  const isDesktopSearchViewport = () => window.matchMedia('(min-width: 990px)').matches;
  const isMobileSearchDrawerViewport = () => window.matchMedia('(max-width: 989px)').matches;
  const getEmptyStateViewportMode = () => (window.matchMedia('(min-width: 990px)').matches ? 'desktop' : 'mobile');
  let lastEmptyStateViewportMode = getEmptyStateViewportMode();

  const getDesktopAnchorTrigger = () =>
    Array.from(openButtons).find(
      (button) =>
        button instanceof HTMLElement
        && button.getClientRects().length > 0
        && button.closest('.header__icons--right')
    );

  const getDesktopAnchorHeaderInner = () => {
    const anchorTrigger = getDesktopAnchorTrigger();
    if (!(anchorTrigger instanceof HTMLElement)) return null;

    const headerInner = anchorTrigger.closest('.header__inner');
    if (headerInner instanceof HTMLElement) return headerInner;

    const fallbackHeaderInner = document.querySelector('.header .header__inner');
    if (fallbackHeaderInner instanceof HTMLElement) return fallbackHeaderInner;

    return null;
  };

  const readRootSpacing = (name, fallback = 0) => {
    const parsed = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const clearDesktopDialogTop = () => {
    modalRoot.style.removeProperty('--sb-search-shortcut-desktop-top');
  };

  const syncDesktopDialogTop = () => {
    if (!isDesktopSearchViewport()) {
      clearDesktopDialogTop();
      return;
    }

    const anchorHeaderInner = getDesktopAnchorHeaderInner();
    if (!(anchorHeaderInner instanceof HTMLElement)) {
      clearDesktopDialogTop();
      return;
    }

    const headerInnerRect = anchorHeaderInner.getBoundingClientRect();
    const dropdownOffset = readRootSpacing('--sb-space-16', 16);
    const top = headerInnerRect.bottom + dropdownOffset;
    if (top > 0) {
      modalRoot.style.setProperty('--sb-search-shortcut-desktop-top', `${Math.round(top)}px`);
    } else {
      clearDesktopDialogTop();
    }
  };

  const sanitizeProductIds = (items) =>
    items
      .map((value) => `${value || ''}`.trim())
      .filter((value) => /^\d+$/.test(value));

  const chunkArray = (items, size) => {
    const safeSize = Math.max(1, Number.parseInt(`${size}`, 10) || 1);
    const chunks = [];
    for (let index = 0; index < items.length; index += safeSize) {
      chunks.push(items.slice(index, index + safeSize));
    }
    return chunks;
  };

  const getRecentlyViewedProductIds = () => {
    if (!recentlyViewedStorageKey) return [];

    try {
      const storedValue = window.localStorage.getItem(recentlyViewedStorageKey);
      if (!storedValue) return [];

      const parsedValue = JSON.parse(storedValue);
      if (!Array.isArray(parsedValue)) return [];

      const normalizedIds = sanitizeProductIds(parsedValue);
      if (normalizedIds.length === 0) return [];

      return Array.from(new Set(normalizedIds));
    } catch (_) {
      return [];
    }
  };

  const getRecentlyViewedItemsPerRow = () =>
    window.matchMedia('(min-width: 990px)').matches
      ? desktopRecentlyViewedItemsPerRow
      : mobileRecentlyViewedItemsPerRow;

  const getSearchBestsellerProductIds = () => {
    if (!searchBestsellerIdsRaw) return [];
    const parsedIds = sanitizeProductIds(searchBestsellerIdsRaw.split(','));
    if (parsedIds.length === 0) return [];
    return Array.from(new Set(parsedIds));
  };

  const getRecentlyViewedIdsForRender = () =>
    getRecentlyViewedProductIds().slice(0, getRecentlyViewedItemsPerRow());

  const getRecentlyViewedIdsForPrefetch = () =>
    getRecentlyViewedProductIds().slice(0, maxRecentlyViewedItemsToPrefetch);

  const normalizeExcludedProductIds = (excludedProductIds) => {
    if (excludedProductIds instanceof Set) {
      return sanitizeProductIds(Array.from(excludedProductIds));
    }
    if (Array.isArray(excludedProductIds)) {
      return sanitizeProductIds(excludedProductIds);
    }
    return [];
  };

  const getBestsellerIdsForRender = ({ excludedProductIds = [], limit = bestsellersItemsLimit } = {}) => {
    const safeLimit = Number.parseInt(`${limit}`, 10);
    if (!Number.isFinite(safeLimit) || safeLimit <= 0) return [];

    const excludedIdsSet = new Set(normalizeExcludedProductIds(excludedProductIds));
    const orderedBestsellerIds = getSearchBestsellerProductIds();
    if (orderedBestsellerIds.length === 0) return [];

    const idsToRender = [];
    for (const bestsellerId of orderedBestsellerIds) {
      if (excludedIdsSet.has(bestsellerId)) continue;
      idsToRender.push(bestsellerId);
      if (idsToRender.length >= safeLimit) break;
    }

    return idsToRender;
  };

  const getEmptyStateRequestIds = () => {
    const bestsellersIds = getSearchBestsellerProductIds();
    const recentlyViewedIds = getRecentlyViewedIdsForPrefetch();
    return Array.from(new Set([...recentlyViewedIds, ...bestsellersIds]));
  };

  const getMissingEmptyStateRequestIds = () =>
    getEmptyStateRequestIds().filter((productId) => !emptyStateProductItemsCache.has(productId));

  const buildProductItemsMap = (markupText) => {
    const parsed = parser.parseFromString(markupText, 'text/html');
    const fragment = parsed.querySelector('[data-search-shortcut-results-fragment]');
    if (!(fragment instanceof HTMLElement)) return new Map();

    const fetchedProductItems = Array.from(
      fragment.querySelectorAll('.sb-search-shortcut-results__group--products .sb-search-shortcut-results__item')
    ).filter((item) => item instanceof HTMLElement);

    const productItemsMap = new Map();

    fetchedProductItems.forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      const productId = `${item.dataset.productId || ''}`.trim();
      if (!productId) return;
      productItemsMap.set(productId, item);
    });

    return productItemsMap;
  };

  const buildEmptyStateProductsUrl = (productIds) => {
    const normalizedIds = sanitizeProductIds(productIds);
    if (normalizedIds.length === 0) return null;

    const url = new URL(predictiveSearchUrl, window.location.origin);
    url.searchParams.set('q', normalizedIds.map((productId) => `id:${productId}`).join(' OR '));
    url.searchParams.set('resources[type]', 'product');
    url.searchParams.set('resources[limit]', `${normalizedIds.length}`);
    url.searchParams.set('resources[limit_scope]', 'each');
    url.searchParams.set('section_id', predictiveSectionId);
    return url;
  };

  const buildProductSectionMarkup = ({ title, sectionClassName, orderedProductIds, maxItems, productItemsMap }) => {
    if (!title) return '';
    if (!(productItemsMap instanceof Map) || productItemsMap.size === 0) return '';

    const orderedItems = [];
    orderedProductIds.forEach((productId) => {
      const matchingItem = productItemsMap.get(productId);
      if (!(matchingItem instanceof HTMLElement)) return;
      orderedItems.push(matchingItem.cloneNode(true));
    });

    const itemsToRender = orderedItems.slice(0, Math.max(maxItems, 0));
    if (itemsToRender.length === 0) return '';

    const section = document.createElement('section');
    section.className = `sb-search-shortcut-results__group sb-search-shortcut-results__group--products ${sectionClassName || ''}`.trim();
    section.setAttribute('aria-label', title);

    const heading = document.createElement('h3');
    heading.className = 'sb-search-shortcut-results__heading font-caption weight-semibold';
    heading.textContent = title;
    section.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'sb-search-shortcut-results__grid';
    list.setAttribute('role', 'list');

    itemsToRender.forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      list.appendChild(item);
    });

    if (list.childElementCount === 0) return '';

    section.appendChild(list);
    return section.outerHTML;
  };

  const mergeEmptyStateProductItems = (productItemsMap) => {
    if (!(productItemsMap instanceof Map) || productItemsMap.size === 0) return;
    productItemsMap.forEach((item, productId) => {
      if (!(item instanceof HTMLElement)) return;
      if (!productId) return;
      emptyStateProductItemsCache.set(productId, item.cloneNode(true));
    });
  };

  const buildEmptyStateMarkupFromCache = () => {
    if (emptyStateProductItemsCache.size === 0) return '';

    const sections = [];
    const recentlyViewedIdsToRender = getRecentlyViewedIdsForRender();
    if (recentlyViewedTitle && recentlyViewedIdsToRender.length > 0) {
      const recentlyViewedSectionMarkup = buildProductSectionMarkup({
        title: recentlyViewedTitle,
        sectionClassName: 'sb-search-shortcut-results__group--recently-viewed',
        orderedProductIds: recentlyViewedIdsToRender,
        maxItems: recentlyViewedIdsToRender.length,
        productItemsMap: emptyStateProductItemsCache,
      });
      if (`${recentlyViewedSectionMarkup || ''}`.trim().length > 0) {
        sections.push(recentlyViewedSectionMarkup);
      }
    }

    const bestsellersIdsToRender = getBestsellerIdsForRender({
      excludedProductIds: recentlyViewedIdsToRender,
      limit: bestsellersItemsLimit,
    });
    if (searchBestsellersTitle && bestsellersIdsToRender.length > 0) {
      const bestsellersSectionMarkup = buildProductSectionMarkup({
        title: searchBestsellersTitle,
        sectionClassName: 'sb-search-shortcut-results__group--bestsellers',
        orderedProductIds: bestsellersIdsToRender,
        maxItems: bestsellersItemsLimit,
        productItemsMap: emptyStateProductItemsCache,
      });
      if (`${bestsellersSectionMarkup || ''}`.trim().length > 0) {
        sections.push(bestsellersSectionMarkup);
      }
    }

    return sections.join('');
  };

  const renderEmptyStateFromCache = () => {
    const emptyStateMarkup = buildEmptyStateMarkupFromCache();
    if (!emptyStateMarkup) return false;
    renderResultsMarkup(emptyStateMarkup, { searchContext: 'empty' });
    lastEmptyStateViewportMode = getEmptyStateViewportMode();
    return true;
  };

  const setSearchShortcutLoadingState = (loading) => {
    if (!isDialogOpen()) return;
    modalRoot.classList.toggle('is-loading', Boolean(loading));
  };

  const ensureEmptyStateProductsCached = async ({ abortExisting = false } = {}) => {
    if (!predictiveSearchUrl) return false;
    if (!recentlyViewedTitle && !searchBestsellersTitle) return false;

    const productIdsToRequest = getMissingEmptyStateRequestIds();
    if (productIdsToRequest.length === 0) return true;

    const requestKey = productIdsToRequest.join(',');
    if (emptyStateFetchPromise && emptyStateFetchKey === requestKey) {
      return emptyStateFetchPromise;
    }

    if (abortExisting) {
      abortActiveRequest();
    } else if (activeFetchController) {
      return false;
    }

    const controller = new AbortController();
    activeFetchController = controller;
    setSearchShortcutLoadingState(true);

    const fetchPromise = (async () => {
      const productIdChunks = chunkArray(productIdsToRequest, emptyStateProductFetchChunkSize);
      let hasCacheUpdates = false;

      for (const productIdChunk of productIdChunks) {
        if (controller.signal.aborted) return false;

        const chunkUrl = buildEmptyStateProductsUrl(productIdChunk);
        if (!chunkUrl) continue;

        const chunkMarkup = await fetchSectionMarkup(chunkUrl.toString(), controller);
        if (controller.signal.aborted) return false;

        const chunkProductItemsMap = buildProductItemsMap(chunkMarkup);
        if (chunkProductItemsMap.size > 0) {
          mergeEmptyStateProductItems(chunkProductItemsMap);
          hasCacheUpdates = true;
        }

        // Some predictive-search responses can drop IDs in batched OR queries.
        // Retry dropped IDs individually to guarantee deterministic backfill.
        const chunkResolvedIds = new Set(chunkProductItemsMap.keys());
        const chunkMissingIds = productIdChunk.filter((productId) => !chunkResolvedIds.has(productId));
        for (const missingId of chunkMissingIds) {
          if (controller.signal.aborted) return false;

          const singleUrl = buildEmptyStateProductsUrl([missingId]);
          if (!singleUrl) continue;

          const singleMarkup = await fetchSectionMarkup(singleUrl.toString(), controller);
          if (controller.signal.aborted) return false;

          const singleProductItemsMap = buildProductItemsMap(singleMarkup);
          if (singleProductItemsMap.size === 0) continue;
          mergeEmptyStateProductItems(singleProductItemsMap);
          hasCacheUpdates = true;
        }
      }

      return hasCacheUpdates;
    })()
      .catch((error) => {
        if (controller.signal.aborted) return false;
        throw error;
      })
      .finally(() => {
        if (activeFetchController === controller) {
          activeFetchController = null;
        }
        if (emptyStateFetchPromise === fetchPromise) {
          emptyStateFetchPromise = null;
          emptyStateFetchKey = '';
        }
        setSearchShortcutLoadingState(false);
      });

    emptyStateFetchPromise = fetchPromise;
    emptyStateFetchKey = requestKey;
    return fetchPromise;
  };

  const scheduleEmptyStatePrefetch = () => {
    const runPrefetch = () => {
      void ensureEmptyStateProductsCached({ abortExisting: false });
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runPrefetch, { timeout: 1200 });
      return;
    }

    window.setTimeout(runPrefetch, 160);
  };

  const abortActiveRequest = () => {
    if (!activeFetchController) return;
    activeFetchController.abort();
    activeFetchController = null;
  };

  const resultItems = () =>
    Array.from(results.querySelectorAll('[data-search-result-item]')).filter(
      (item) => item instanceof HTMLElement && item.getClientRects().length > 0
    );

  const setSelectedItem = (nextIndex) => {
    const items = resultItems();

    if (items.length === 0) {
      selectedIndex = -1;
      return;
    }

    if (nextIndex < 0 || nextIndex >= items.length) {
      selectedIndex = -1;
    } else {
      selectedIndex = nextIndex;
    }

    items.forEach((item, index) => {
      if (!(item instanceof HTMLElement)) return;

      const isSelected = index === selectedIndex;
      item.classList.toggle('is-keyboard-selected', isSelected);
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');

      if (isSelected) {
        item.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'nearest' });
      }
    });
  };

  const resetSelection = () => {
    setSelectedItem(-1);
  };

  const syncLayoutState = () => {
    const term = searchInput.value.trim();
    const hasNoResults = Boolean(results.querySelector('.sb-search-shortcut-results__no-results'));
    const hasResultGroups = Boolean(results.querySelector('.sb-search-shortcut-results__group'));
    const isSearchResultsContext = results.dataset.searchContext === 'search';
    const isPendingContext = results.dataset.searchContext === 'pending';
    const hasSearchResults = term.length > 0 && isSearchResultsContext && hasResultGroups && !hasNoResults;

    modalRoot.classList.toggle('is-empty-query', term.length === 0);
    if (isPendingContext && term.length > 0) {
      syncEmptyStateOverflowFade();
      return;
    }
    modalRoot.classList.toggle('has-search-results', hasSearchResults);
    syncEmptyStateOverflowFade();
  };

  const syncEmptyStateOverflowFade = () => {
    const canUseDrawerFade = isMobileSearchDrawerViewport() && modalRoot.classList.contains('is-empty-query');
    if (!canUseDrawerFade) {
      modalRoot.classList.remove('has-empty-overflow-fade');
      modalRoot.classList.remove('has-empty-overflow-space');
      return;
    }

    const hasVerticalOverflow = body.scrollHeight > body.clientHeight + 1;
    const hasMoreContentBelow = body.scrollTop + body.clientHeight < body.scrollHeight - 1;
    modalRoot.classList.toggle('has-empty-overflow-space', hasVerticalOverflow);
    modalRoot.classList.toggle('has-empty-overflow-fade', hasVerticalOverflow && hasMoreContentBelow);
  };

  const settleToContentHeight = () => {
    if (!isDialogOpen()) return;
    if (modalRoot.classList.contains('is-closing')) return;
    if (!modalRoot.classList.contains('is-open')) return;
  };

  const extractFragment = (markupText) => {
    const parsed = parser.parseFromString(markupText, 'text/html');
    const fragment = parsed.querySelector('[data-search-shortcut-results-fragment]');

    if (fragment instanceof HTMLElement) {
      return fragment.innerHTML;
    }

    return '';
  };

  const syncResultIndexes = () => {
    const items = Array.from(results.querySelectorAll('[data-search-result-item]'));
    items.forEach((item, index) => {
      if (!(item instanceof HTMLElement)) return;
      item.setAttribute('data-search-result-index', `${index}`);
    });
  };

  const syncEmptyStateAnimationIndexes = ({ searchContext = 'search' } = {}) => {
    results.querySelectorAll('.sb-search-shortcut__animated-element').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.classList.remove('sb-search-shortcut__animated-element');
      element.style.removeProperty('--menu-drawer-animation-index');
    });

    if (searchContext !== 'empty') return;
    if (!isMobileSearchDrawerViewport()) return;

    let animationIndex = 1;
    const mobileItemsPerRow = 2;
    const groups = Array.from(results.querySelectorAll('.sb-search-shortcut-results__group'));

    groups.forEach((group) => {
      if (!(group instanceof HTMLElement)) return;

      const heading = group.querySelector('.sb-search-shortcut-results__heading');
      if (heading instanceof HTMLElement) {
        heading.classList.add('sb-search-shortcut__animated-element');
        heading.style.setProperty('--menu-drawer-animation-index', `${animationIndex}`);
        animationIndex += 1;
      }

      const items = Array.from(group.querySelectorAll('.sb-search-shortcut-results__item'));
      items.forEach((item, itemIndex) => {
        if (!(item instanceof HTMLElement)) return;
        const rowIndex = Math.floor(itemIndex / mobileItemsPerRow);
        item.classList.add('sb-search-shortcut__animated-element');
        item.style.setProperty('--menu-drawer-animation-index', `${animationIndex + rowIndex}`);
      });

      if (items.length > 0) {
        animationIndex += Math.ceil(items.length / mobileItemsPerRow);
      }
    });
  };

  const renderResultsMarkup = (markupText, { searchContext = 'search' } = {}) => {
    results.dataset.searchContext = `${searchContext || ''}`.trim();
    results.innerHTML = markupText;
    const thumbnailEngine = window.SBProductThumbnail;
    if (thumbnailEngine && typeof thumbnailEngine.syncThumbnailDiscountPricingScope === 'function') {
      thumbnailEngine.syncThumbnailDiscountPricingScope(results);
    }
    syncResultIndexes();
    syncEmptyStateAnimationIndexes({ searchContext });
    results.scrollTop = 0;
    resetSelection();
    syncLayoutState();
    settleToContentHeight();
  };

  const renderMessage = (message, className = 'sb-search-shortcut-results__empty') => {
    results.dataset.searchContext = 'message';
    const paragraph = document.createElement('p');
    paragraph.className = `${className} font-body weight-regular`;
    paragraph.textContent = `${message || ''}`;
    results.innerHTML = '';
    results.appendChild(paragraph);
    resetSelection();
    syncLayoutState();
    settleToContentHeight();
  };

  const clearResults = () => {
    results.dataset.searchContext = 'empty';
    results.innerHTML = '';
    results.scrollTop = 0;
    resetSelection();
    syncLayoutState();
    settleToContentHeight();
  };

  const renderEmptyFallback = () => {
    const fallbackText = `${searchInput.dataset.emptyText || ''}`.trim();

    if (!fallbackText) {
      clearResults();
      return;
    }

    renderMessage(fallbackText);
  };

  const fetchSectionMarkup = async (url, controller) => {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }

    return response.text();
  };

  const loadEmptyState = async ({ fetchRecentlyViewed = isDialogOpen() } = {}) => {
    if (!fetchRecentlyViewed) {
      clearResults();
      return;
    }

    const renderedFromCache = renderEmptyStateFromCache();
    const requestIds = getEmptyStateRequestIds();

    if (requestIds.length === 0) {
      if (!renderedFromCache) {
        clearResults();
      }
      return;
    }

    const hasMissingIds = getMissingEmptyStateRequestIds().length > 0;
    if (!hasMissingIds) {
      if (!renderedFromCache) {
        renderEmptyStateFromCache();
      }
      return;
    }

    try {
      const cacheUpdated = await ensureEmptyStateProductsCached({ abortExisting: true });
      if (!cacheUpdated) return;

      if (searchInput.value.trim().length === 0) {
        const renderedAfterFetch = renderEmptyStateFromCache();
        if (!renderedAfterFetch && !renderedFromCache) {
          clearResults();
        }
      }
    } catch (_) {
      if (!renderedFromCache) {
        clearResults();
      }
    }
  };

  const showErrorState = () => {
    if (!errorText) {
      renderEmptyFallback();
      return;
    }

    renderMessage(errorText);
  };

  const performSearch = async (term) => {
    if (!predictiveSearchUrl) return;

    abortActiveRequest();

    const controller = new AbortController();
    activeFetchController = controller;
    results.dataset.searchContext = 'pending';
    syncLayoutState();

    modalRoot.classList.add('is-loading');

    try {
      const url = new URL(predictiveSearchUrl, window.location.origin);
      url.searchParams.set('q', term);
      url.searchParams.set('resources[type]', 'query,product,collection,page,article');
      url.searchParams.set('resources[limit]', '4');
      url.searchParams.set('resources[limit_scope]', 'each');
      url.searchParams.set('section_id', predictiveSectionId);

      const markup = await fetchSectionMarkup(url.toString(), controller);
      if (controller.signal.aborted) return;

      const fragmentMarkup = extractFragment(markup);
      if (!fragmentMarkup) {
        showErrorState();
        return;
      }

      renderResultsMarkup(fragmentMarkup, { searchContext: 'search' });
    } catch (error) {
      if (controller.signal.aborted) return;
      showErrorState();
    } finally {
      if (activeFetchController === controller) {
        activeFetchController = null;
      }
      modalRoot.classList.remove('is-loading');
    }
  };

  const debouncedSearch = debounce(() => {
    const term = searchInput.value.trim();

    if (!term) {
      loadEmptyState();
      return;
    }

    performSearch(term);
  }, 180);

  const resetSearch = () => {
    searchInput.value = '';

    const renderedFromCache = renderEmptyStateFromCache();
    if (!renderedFromCache) {
      clearResults();
    }
  };

  const stopCloseTimer = () => {
    if (!closeTimer) return;
    window.clearTimeout(closeTimer);
    closeTimer = null;
  };

  const getDialogSettleTransitionProperty = () =>
    window.matchMedia('(max-width: 989px)').matches ? 'transform' : 'grid-template-rows';

  const createDialogSettleHandler = (callback) => {
    const expectedProperty = getDialogSettleTransitionProperty();
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('transitionend', handleTransitionEnd);
      callback();
    };

    const handleTransitionEnd = (event) => {
      if (!event || event.target !== dialog) return;
      if (event.propertyName !== expectedProperty) return;
      settle();
    };

    dialog.addEventListener('transitionend', handleTransitionEnd);
    return settle;
  };

  const handleDocumentClick = (event) => {
    if (!isDialogOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target instanceof Element && target.closest('[data-search-shortcut-open]')) return;
    if (target instanceof Element && target.closest('[data-search-shortcut-dialog]')) return;
    closeDialog();
  };

  const handleDocumentKeyUp = (event) => {
    if (event.key !== 'Escape') return;
    if (!isDialogOpen()) return;
    closeDialog();
  };

  const stopDismissListeners = () => {
    document.removeEventListener('click', handleDocumentClick);
    document.removeEventListener('keyup', handleDocumentKeyUp);
  };

  const startDismissListeners = () => {
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keyup', handleDocumentKeyUp);
  };

  const finalizeClose = () => {
    stopCloseTimer();
    stopDismissListeners();

    if (isDialogOpen()) {
      dialog.setAttribute('hidden', '');
    }

    modalRoot.classList.remove('is-open');
    modalRoot.classList.remove('is-closing');
    modalRoot.classList.remove('is-loading');
    modalRoot.classList.remove('has-empty-overflow-fade');
    modalRoot.classList.remove('has-empty-overflow-space');
    document.documentElement.classList.remove('sb-search-shortcut-open');
    notifyHeaderSearchState(false);
    clearDesktopDialogTop();

    abortActiveRequest();
    resetSearch();
  };

  const closeDialog = () => {
    if (!isDialogOpen()) return;

    stopCloseTimer();
    const isDesktopClose = isDesktopSearchViewport();
    if (isDesktopClose) {
      // Match localization desktop unroll: never close with an inline locked height.
      dialog.style.removeProperty('height');
    }
    void dialog.offsetHeight;

    modalRoot.classList.add('is-closing');
    modalRoot.classList.remove('is-open');

    const settleClose = createDialogSettleHandler(() => {
      if (modalRoot.classList.contains('is-open')) return;
      finalizeClose();
    });
    closeTimer = window.setTimeout(settleClose, closeFallbackMs);
  };

  const openDialog = () => {
    stopCloseTimer();

    if (!isDialogOpen()) {
      dialog.removeAttribute('hidden');
    }

    modalRoot.classList.remove('is-closing');
    modalRoot.classList.remove('is-open');
    document.documentElement.classList.add('sb-search-shortcut-open');
    notifyHeaderSearchState(true);
    startDismissListeners();
    lastEmptyStateViewportMode = getEmptyStateViewportMode();

    if (isDesktopSearchViewport()) {
      syncDesktopDialogTop();
    }

    if (searchInput.value.trim().length > 0) {
      performSearch(searchInput.value.trim());
    } else {
      loadEmptyState();
    }

    void dialog.offsetHeight;
    modalRoot.classList.add('is-open');

    if (isMobileSearchDrawerViewport()) {
      searchInput.focus({ preventScroll: true });
      searchInput.select();
      return;
    }

    searchInput.focus({ preventScroll: true });
    searchInput.select();
  };

  const activateSelectedResult = () => {
    const items = resultItems();

    if (selectedIndex < 0 || selectedIndex >= items.length) return false;

    const selected = items[selectedIndex];
    if (!(selected instanceof HTMLElement)) return false;

    const link = selected.querySelector('a');
    if (!(link instanceof HTMLAnchorElement)) return false;

    link.click();
    return true;
  };

  const moveSelection = (direction) => {
    const items = resultItems();
    if (items.length === 0) return;

    if (selectedIndex < 0) {
      setSelectedItem(direction > 0 ? 0 : items.length - 1);
      return;
    }

    const nextIndex = (selectedIndex + direction + items.length) % items.length;
    setSelectedItem(nextIndex);
  };

  openButtons.forEach((button) => {
    const prefetchOnIntent = () => {
      void ensureEmptyStateProductsCached({ abortExisting: false });
    };

    button.addEventListener('mouseenter', prefetchOnIntent, { once: true, passive: true });
    button.addEventListener('focusin', prefetchOnIntent, { once: true });
    button.addEventListener('touchstart', prefetchOnIntent, { once: true, passive: true });

    button.addEventListener('click', (event) => {
      if (!(button instanceof HTMLAnchorElement)) {
        event.preventDefault();
        if (isDialogOpen()) {
          closeDialog();
          return;
        }
        openDialog();
        return;
      }

      if (!isPlainLeftClick(event)) return;

      event.preventDefault();
      if (isDialogOpen()) {
        closeDialog();
        return;
      }
      openDialog();
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      closeDialog();
    });
  });

  results.addEventListener('mousemove', () => {
    resetSelection();
  });

  body.addEventListener(
    'scroll',
    () => {
      syncEmptyStateOverflowFade();
    },
    { passive: true }
  );

  results.addEventListener(
    'load',
    (event) => {
      if (!(event.target instanceof HTMLImageElement)) return;
      syncEmptyStateOverflowFade();
    },
    true
  );

  results.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const interactiveTarget = target.closest('a, button, input, textarea, select');
    if (interactiveTarget) return;

    searchInput.focus();
  });

  searchInput.addEventListener('input', () => {
    const term = searchInput.value.trim();

    if (!term) {
      loadEmptyState();
      return;
    }

    results.dataset.searchContext = 'pending';
    syncLayoutState();
    debouncedSearch();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === 'Enter') {
      if (activateSelectedResult()) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    }
  });

  document.addEventListener('keydown', (event) => {
    const key = `${event.key || ''}`.toLowerCase();
    const isSearchShortcut = (event.metaKey || event.ctrlKey) && key === 'k';

    if (!isSearchShortcut) return;

    event.preventDefault();

    if (isDialogOpen()) {
      closeDialog();
      return;
    }

    openDialog();
  });

  form.addEventListener('submit', (event) => {
    if (!searchInput.value.trim()) {
      event.preventDefault();
      searchInput.focus();
      return;
    }

    closeDialog();
  });

  document.addEventListener('sb:header-search-shortcut:request-close', () => {
    closeDialog();
  });

  window.addEventListener('resize', () => {
    const nextEmptyStateViewportMode = getEmptyStateViewportMode();
    const emptyStateViewportChanged = nextEmptyStateViewportMode !== lastEmptyStateViewportMode;
    lastEmptyStateViewportMode = nextEmptyStateViewportMode;

    if (!isDialogOpen()) {
      clearDesktopDialogTop();
      syncEmptyStateOverflowFade();
      return;
    }

    if (isDesktopSearchViewport()) {
      syncDesktopDialogTop();
    } else {
      clearDesktopDialogTop();
    }

    if (!searchInput.value.trim()) {
      if (emptyStateViewportChanged) {
        const renderedFromCache = renderEmptyStateFromCache();
        if (!renderedFromCache) {
          loadEmptyState();
        }
      }
      syncEmptyStateOverflowFade();
      return;
    }

    syncEmptyStateOverflowFade();
  });

  window.addEventListener(
    'scroll',
    () => {
      if (!isDialogOpen()) return;
      if (!isDesktopSearchViewport()) return;
      syncDesktopDialogTop();
    },
    { passive: true }
  );

  syncLayoutState();
  scheduleEmptyStatePrefetch();
})();
