(() => {
  const ThemeEvents = {
    variantSelected: 'variant:selected',
    variantUpdate: 'variant:update',
  };

  const IGNORE_SOURCES = new Set([
    'product-thumbnail-swatch-hover',
    'product-thumbnail-swatch-focus',
  ]);

  const parseCents = (value) => {
    const nextValue = Number.parseInt(`${value ?? ''}`.trim(), 10);
    return Number.isFinite(nextValue) ? nextValue : null;
  };

  const parseBooleanFlag = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    const normalized = `${value ?? ''}`.trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
    return fallback;
  };

  const formatMoneyNoDecimals = (cents, currencyOverride = '') => {
    const normalizedCents = parseCents(cents);
    if (!Number.isFinite(normalizedCents)) return '';
    const storefrontPricing = window.SBStorefrontPricing;
    if (storefrontPricing && typeof storefrontPricing.formatMoney === 'function') {
      const formatted = storefrontPricing.formatMoney(normalizedCents, currencyOverride, { context: 'storefront' });
      if (`${formatted || ''}`.trim() !== '') return formatted;
    }
    return `${Math.round(normalizedCents / 100)}`;
  };

  const resolveStorefrontDisplayPricing = ({
    productId = '',
    priceCents = null,
    comparePriceCents = null,
  } = {}) => {
    const normalizedPriceCents = parseCents(priceCents);
    if (!Number.isFinite(normalizedPriceCents) || normalizedPriceCents <= 0) {
      return {
        currentPriceCents: null,
        comparePriceCents: null,
        hasComparePrice: false,
        discountRate: 0,
      };
    }

    const storefrontPricing = window.SBStorefrontPricing;
    if (storefrontPricing && typeof storefrontPricing.resolvePrice === 'function') {
      const resolved = storefrontPricing.resolvePrice({
        productId,
        priceCents: normalizedPriceCents,
        comparePriceCents,
      }) || {};
      const currentPriceCents = parseCents(resolved.currentPriceCents);
      const resolvedComparePriceCents = parseCents(resolved.comparePriceCents);
      const safeCurrentPriceCents = Number.isFinite(currentPriceCents)
        ? currentPriceCents
        : normalizedPriceCents;
      const hasComparePrice = Boolean(
        resolved.hasComparePrice
        && Number.isFinite(resolvedComparePriceCents)
        && resolvedComparePriceCents > safeCurrentPriceCents
      );
      return {
        currentPriceCents: safeCurrentPriceCents,
        comparePriceCents: hasComparePrice ? resolvedComparePriceCents : null,
        hasComparePrice,
        discountRate: Number.isFinite(Number(resolved.discountRate))
          ? Number(resolved.discountRate)
          : 0,
      };
    }

    const normalizedComparePriceCents = parseCents(comparePriceCents);
    if (Number.isFinite(normalizedComparePriceCents) && normalizedComparePriceCents > normalizedPriceCents) {
      return {
        currentPriceCents: normalizedPriceCents,
        comparePriceCents: normalizedComparePriceCents,
        hasComparePrice: true,
        discountRate: 0,
      };
    }

    return {
      currentPriceCents: normalizedPriceCents,
      comparePriceCents: null,
      hasComparePrice: false,
      discountRate: 0,
    };
  };

  const imageFrameSelector = '[data-image-frame]';
  const imageFrameLeadImageSelectors = [
    'img.sb-cart-line__image--primary:not(.sb-cart-line__image--placeholder)',
    'img.sb-search-shortcut-card__image--primary',
    'img.sb-product-thumbnail__media-item',
    'img',
  ];
  const boundImageFrames = new WeakSet();

  const getImageFrameLeadImage = (frame) => {
    if (!(frame instanceof HTMLElement)) return null;

    for (const selector of imageFrameLeadImageSelectors) {
      const image = frame.querySelector(selector);
      if (image instanceof HTMLImageElement) return image;
    }

    return null;
  };

  const syncImageFrameState = (frame) => {
    if (!(frame instanceof HTMLElement)) return;

    const leadImage = getImageFrameLeadImage(frame);
    const hasLoadedImage = Boolean(
      leadImage instanceof HTMLImageElement
      && leadImage.complete
      && leadImage.naturalWidth > 0
    );

    frame.dataset.imageLoaded = hasLoadedImage ? 'true' : 'false';
  };

  const bindImageFrame = (image) => {
    if (!(image instanceof HTMLImageElement)) return;
    if (image.classList.contains('sb-cart-line__image--placeholder')) return;
    if (boundImageFrames.has(image)) return;

    const frame = image.closest(imageFrameSelector);
    if (!(frame instanceof HTMLElement)) return;

    boundImageFrames.add(image);
    image.addEventListener('load', () => syncImageFrameState(frame));
    image.addEventListener('error', () => syncImageFrameState(frame));
  };

  const syncImageFrameScope = (scope = document) => {
    if (!(scope instanceof Element || scope instanceof Document)) return;

    const frames = [];
    if (scope instanceof Element && scope.matches(imageFrameSelector)) {
      frames.push(scope);
    }
    scope.querySelectorAll(imageFrameSelector).forEach((frame) => frames.push(frame));

    frames.forEach((frame) => {
      frame.querySelectorAll('img').forEach((image) => bindImageFrame(image));
      syncImageFrameState(frame);
    });
  };

  const observeImageFrames = () => {
    if (!(document.body instanceof HTMLElement) || window.__sbImageFrameObserverInitialized) return;
    window.__sbImageFrameObserverInitialized = true;

    const observer = new MutationObserver((mutations) => {
      const scopes = new Set();

      mutations.forEach((mutation) => {
        if (mutation.target instanceof Element) {
          const targetFrame = mutation.target.closest(imageFrameSelector);
          scopes.add(targetFrame || mutation.target);
        }

        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) scopes.add(node);
        });
      });

      scopes.forEach((scope) => syncImageFrameScope(scope));
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  const applyThumbnailDiscountPricing = (thumbnail, purchaseState = {}) => {
    if (!(thumbnail instanceof HTMLElement)) return;

    const priceRow = thumbnail.querySelector('[data-thumbnail-price-row]');
    const currentPriceElement = thumbnail.querySelector('[data-thumbnail-price-current]');
    const comparePriceElement = thumbnail.querySelector('[data-thumbnail-price-compare]');
    if (!priceRow || !currentPriceElement || !comparePriceElement) return;

    const nextProductId = `${purchaseState.productId || thumbnail.dataset.thumbnailProductId || ''}`.trim();
    const currentPriceCents = parseCents(
      purchaseState.currentPriceCents ?? thumbnail.dataset.thumbnailPriceCents
    );
    const comparePriceCents = parseCents(
      purchaseState.comparePriceCents ?? thumbnail.dataset.thumbnailComparePriceCents
    );
    const hideDiscounts = parseBooleanFlag(
      purchaseState.hideDiscounts ?? thumbnail.dataset.thumbnailHideDiscounts,
      false
    );

    const currentPriceText = `${purchaseState.currentPriceText || ''}`.trim();
    const comparePriceText = `${purchaseState.comparePriceText || ''}`.trim();

    if (Number.isFinite(currentPriceCents) && currentPriceCents > 0) {
      if (hideDiscounts) {
        comparePriceElement.textContent = '';
        comparePriceElement.hidden = true;
        currentPriceElement.textContent = formatMoneyNoDecimals(currentPriceCents);
        currentPriceElement.hidden = false;
        priceRow.hidden = false;
        return;
      }

      const resolvedPricing = resolveStorefrontDisplayPricing({
        productId: nextProductId,
        priceCents: currentPriceCents,
        comparePriceCents,
      });
      const hasComparePrice = Boolean(
        resolvedPricing.hasComparePrice
        && Number.isFinite(resolvedPricing.comparePriceCents)
        && resolvedPricing.comparePriceCents > 0
      );

      if (hasComparePrice) {
        comparePriceElement.textContent = formatMoneyNoDecimals(resolvedPricing.comparePriceCents);
        comparePriceElement.hidden = false;
      } else {
        comparePriceElement.textContent = '';
        comparePriceElement.hidden = true;
      }

      currentPriceElement.textContent = formatMoneyNoDecimals(resolvedPricing.currentPriceCents);
      currentPriceElement.hidden = false;

      priceRow.hidden = false;
      return;
    }

    if (currentPriceText) {
      currentPriceElement.textContent = currentPriceText;
      currentPriceElement.hidden = false;
    } else {
      currentPriceElement.textContent = '';
      currentPriceElement.hidden = true;
    }

    if (!hideDiscounts && comparePriceText) {
      comparePriceElement.textContent = comparePriceText;
      comparePriceElement.hidden = false;
    } else {
      comparePriceElement.textContent = '';
      comparePriceElement.hidden = true;
    }

    priceRow.hidden = currentPriceElement.hidden && comparePriceElement.hidden;
  };

  const syncThumbnailDiscountPricingScope = (scope = document) => {
    if (!(scope instanceof Element || scope instanceof Document)) return;
    scope.querySelectorAll('.sb-product-thumbnail, [data-search-shortcut-product-card]').forEach((thumbnail) => {
      applyThumbnailDiscountPricing(thumbnail);
    });
  };

  const localizedCountFormatter = new Intl.NumberFormat(document.documentElement.lang || undefined, {
    maximumFractionDigits: 0,
  });

  const syncThumbnailReviewCountScope = (scope = document) => {
    if (!(scope instanceof Element || scope instanceof Document)) return;

    scope.querySelectorAll('[data-thumbnail-reviews-count][data-count-template][data-count-value]').forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      const template = `${node.dataset.countTemplate || ''}`.trim();
      if (!template) return;

      const parsedCount = Number.parseInt(`${node.dataset.countValue || ''}`.replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(parsedCount)) return;

      const formattedCount = localizedCountFormatter.format(parsedCount);
      const nextText = template.replace(/__COUNT__/g, formattedCount);
      if (nextText && node.textContent !== nextText) {
        node.textContent = nextText;
      }
    });
  };

  const getSelectedSwatch = (row) =>
    row.querySelector('.sb-product-thumbnail__swatch.is-selected') || row.querySelector('.sb-product-thumbnail__swatch');

  const supportsThumbnailHoverPreview = () =>
    typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const normalizeBaseUrl = (href) => {
    const raw = String(href || '').trim();
    if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('javascript:')) return raw;

    try {
      const url = new URL(raw, window.location.origin);
      const isProductPath = url.pathname.includes('/products/');
      if (isProductPath) {
        // Keep product links canonical; swatch selection appends variant explicitly.
        url.search = '';
      } else {
        url.searchParams.delete('variant');
        Array.from(url.searchParams.keys()).forEach((key) => {
          if (key.startsWith('pr_')) url.searchParams.delete(key);
        });
      }
      if (url.origin === window.location.origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
      return url.toString();
    } catch (_) {
      return raw;
    }
  };

  const buildVariantUrl = (baseHref, variantId) => {
    const normalizedBase = normalizeBaseUrl(baseHref);
    if (!normalizedBase || normalizedBase.startsWith('#') || normalizedBase.toLowerCase().startsWith('javascript:')) {
      return normalizedBase;
    }

    try {
      const url = new URL(normalizedBase, window.location.origin);
      const normalizedVariantId = String(variantId || '').trim();
      if (normalizedVariantId) {
        url.searchParams.set('variant', normalizedVariantId);
      }
      if (url.origin === window.location.origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
      return url.toString();
    } catch (_) {
      return normalizedBase;
    }
  };

  const syncThumbnailPurchaseState = (button) => {
    if (!(button instanceof HTMLElement)) return;
    const thumbnail = button.closest('.sb-product-thumbnail');
    if (!thumbnail) return;

    const nextVariantId =
      String(button.dataset.thumbnailVariantId || '').trim() ||
      String(thumbnail.dataset.thumbnailVariantId || '').trim() ||
      String(thumbnail.querySelector('[data-add-to-cart]')?.dataset.variantId || '').trim();

    if (nextVariantId) {
      thumbnail.dataset.thumbnailVariantId = nextVariantId;
      thumbnail.querySelectorAll('[data-add-to-cart]').forEach((addButton) => {
        addButton.dataset.variantId = nextVariantId;
      });
    }

    const priceRow = thumbnail.querySelector('[data-thumbnail-price-row]');
    const currentPriceElement = thumbnail.querySelector('[data-thumbnail-price-current]');
    const comparePriceElement = thumbnail.querySelector('[data-thumbnail-price-compare]');
    const nextCurrentPrice = String(button.dataset.thumbnailPrice || '').trim();
    const nextComparePrice = String(button.dataset.thumbnailComparePrice || '').trim();
    const nextCurrentPriceCents = parseCents(button.dataset.thumbnailPriceCents);
    const nextComparePriceCents = parseCents(button.dataset.thumbnailComparePriceCents);
    const thumbnailHideDiscounts = parseBooleanFlag(thumbnail.dataset.thumbnailHideDiscounts, false);

    if (Number.isFinite(nextCurrentPriceCents) && nextCurrentPriceCents > 0) {
      thumbnail.dataset.thumbnailPriceCents = `${nextCurrentPriceCents}`;
    } else {
      delete thumbnail.dataset.thumbnailPriceCents;
    }

    if (!thumbnailHideDiscounts && Number.isFinite(nextComparePriceCents) && nextComparePriceCents > 0) {
      thumbnail.dataset.thumbnailComparePriceCents = `${nextComparePriceCents}`;
    } else {
      delete thumbnail.dataset.thumbnailComparePriceCents;
    }

    if (priceRow || currentPriceElement || comparePriceElement) {
      applyThumbnailDiscountPricing(thumbnail, {
        variantId: nextVariantId,
        currentPriceCents: nextCurrentPriceCents,
        comparePriceCents: thumbnailHideDiscounts ? null : nextComparePriceCents,
        currentPriceText: nextCurrentPrice,
        comparePriceText: thumbnailHideDiscounts ? '' : nextComparePrice,
        hideDiscounts: thumbnailHideDiscounts,
      });
    }

    const linkNodes = thumbnail.querySelectorAll('[data-thumbnail-link]');
    linkNodes.forEach((linkNode) => {
      const fallbackBase = thumbnail.dataset.thumbnailBaseUrl || linkNode.getAttribute('href') || '';
      const existingBase = linkNode.dataset.thumbnailBaseUrl || fallbackBase;
      const normalizedBase = normalizeBaseUrl(existingBase);
      linkNode.dataset.thumbnailBaseUrl = normalizedBase;
      const nextHref = buildVariantUrl(normalizedBase, nextVariantId);
      if (nextHref) linkNode.setAttribute('href', nextHref);
    });

    thumbnail.dispatchEvent(
      new CustomEvent('sb:thumbnail-purchase-state', {
        bubbles: true,
        detail: {
          variantId: nextVariantId,
        },
      })
    );
  };

  const dispatchSwatchVariantEvents = (button, sourceId) => {
    if (!(button instanceof HTMLElement)) return;
    const thumbnail = button.closest('.sb-product-thumbnail');
    if (!thumbnail) return;

    const variantId =
      String(button.dataset.thumbnailVariantId || '').trim() ||
      String(thumbnail.dataset.thumbnailVariantId || '').trim() ||
      String(thumbnail.querySelector('[data-add-to-cart]')?.dataset.variantId || '').trim();

    const selectedDetail = {
      resource: { id: `${variantId}` },
      sourceId,
    };

    button.dispatchEvent(
      new CustomEvent(ThemeEvents.variantSelected, {
        bubbles: true,
        detail: selectedDetail,
      })
    );

    button.dispatchEvent(
      new CustomEvent(ThemeEvents.variantUpdate, {
        bubbles: true,
        detail: {
          ...selectedDetail,
          data: {
            swatchButton: button,
          },
        },
      })
    );
  };

  const initSwatchInteractionScope = (scope = document) => {
    if (!(scope instanceof Element || scope instanceof Document)) return;

    scope.querySelectorAll('.sb-product-thumbnail__swatches').forEach((row) => {
      if (row.dataset.sbSwatchInteractionsInitialized === 'true') return;

      const swatches = Array.from(row.querySelectorAll('.sb-product-thumbnail__swatch'));
      if (!swatches.length) return;

      row.dataset.sbSwatchInteractionsInitialized = 'true';

      const getSelectedInRow = () => getSelectedSwatch(row);
      const resetRowPreview = () => {
        const selectedSwatch = getSelectedInRow();
        if (!selectedSwatch) return;
        dispatchSwatchVariantEvents(selectedSwatch, 'product-thumbnail-swatch-reset');
      };

      swatches.forEach((swatchButton) => {
        swatchButton.addEventListener('mouseenter', () => {
          if (!supportsThumbnailHoverPreview()) return;
          dispatchSwatchVariantEvents(swatchButton, 'product-thumbnail-swatch-hover');
        });

        swatchButton.addEventListener('focusin', () => {
          dispatchSwatchVariantEvents(swatchButton, 'product-thumbnail-swatch-focus');
        });
      });

      row.addEventListener('mousemove', (event) => {
        if (!supportsThumbnailHoverPreview()) return;
        const hoveredSwatch =
          event.target instanceof HTMLElement && event.target.closest('.sb-product-thumbnail__swatch');
        if (hoveredSwatch && row.contains(hoveredSwatch)) return;
        resetRowPreview();
      });

      row.addEventListener('mouseleave', () => {
        if (!supportsThumbnailHoverPreview()) return;
        resetRowPreview();
      });

      row.addEventListener('focusout', (event) => {
        const nextFocusedElement = event.relatedTarget;
        if (nextFocusedElement && row.contains(nextFocusedElement)) return;
        resetRowPreview();
      });

      row.addEventListener('click', (event) => {
        const swatchButton =
          event.target instanceof HTMLElement && event.target.closest('.sb-product-thumbnail__swatch');
        if (!swatchButton || !row.contains(swatchButton)) return;

        swatches.forEach((item) => item.classList.remove('is-selected'));
        swatchButton.classList.add('is-selected');

        syncThumbnailPurchaseState(swatchButton);
        dispatchSwatchVariantEvents(swatchButton, 'product-thumbnail-swatch-select');
      });

      const initialSwatch = getSelectedInRow();
      if (!initialSwatch) return;
      syncThumbnailPurchaseState(initialSwatch);
      dispatchSwatchVariantEvents(initialSwatch, 'product-thumbnail-swatch-initial');
    });
  };

  const parseGalleryToken = (token) => {
    const raw = String(token || '').trim();
    if (!raw) return null;
    const parts = raw.split('::');
    if (parts.length > 1) {
      const type = parts[0] === 'video' ? 'video' : 'image';
      const src = String(parts[1] || '').trim();
      const poster = String(parts[2] || '').trim();
      if (!src) return null;
      return { type, src, poster };
    }

    const lowerRaw = raw.toLowerCase();
    if (lowerRaw.includes('.mp4') || lowerRaw.includes('.webm') || lowerRaw.includes('.m3u8')) {
      return { type: 'video', src: raw, poster: '' };
    }
    return { type: 'image', src: raw, poster: '' };
  };

  const normalizeGalleryItem = (item) => {
    if (!item || typeof item !== 'object') return null;
    const src = String(item.src || '').trim();
    if (!src) return null;
    const type = item.type === 'video' ? 'video' : 'image';
    const poster = String(item.poster || '').trim();
    return { type, src, poster };
  };

  const toGalleryToken = (item) => {
    if (!item || !item.src) return '';
    if (item.type === 'video') return item.poster ? `video::${item.src}::${item.poster}` : `video::${item.src}`;
    return `image::${item.src}`;
  };

  const getMediaLink = (mediaWrap) => mediaWrap.querySelector('.sb-product-thumbnail__media');
  const getCarouselTrack = (mediaWrap) => mediaWrap.querySelector('.sb-product-thumbnail__carousel-track');
  const getCarouselSlides = (mediaWrap, { includeClones = false } = {}) =>
    Array.from(mediaWrap.querySelectorAll('.sb-product-thumbnail__carousel-slide')).filter(
      (slide) => includeClones || slide.dataset.galleryClone !== 'true'
    );
  const isStaticMediaThumbnail = (mediaWrap) =>
    parseBooleanFlag(mediaWrap?.dataset?.thumbnailStaticMedia, false);
  const isInteractiveGalleryActive = (mediaWrap) =>
    parseBooleanFlag(mediaWrap?.dataset?.galleryActive, false);
  const canUseInteractiveGallery = (mediaWrap) =>
    !isStaticMediaThumbnail(mediaWrap) && supportsThumbnailHoverPreview();
  const getStaticMediaNode = (mediaWrap) => {
    const mediaLink = getMediaLink(mediaWrap);
    if (!mediaLink) return null;
    return mediaLink.querySelector(':scope > .sb-product-thumbnail__media-item, :scope > .sb-product-thumbnail__image-placeholder');
  };
  const getAnyMediaNode = (mediaWrap) =>
    mediaWrap.querySelector('.sb-product-thumbnail__media-item, .sb-product-thumbnail__image-placeholder');
  const insertStaticMediaNode = (mediaLink, mediaNode) => {
    const badge = mediaLink.querySelector('.sb-product-thumbnail__badge');
    if (badge && badge.nextSibling) {
      mediaLink.insertBefore(mediaNode, badge.nextSibling);
      return;
    }
    mediaLink.appendChild(mediaNode);
  };

  const getGalleryItems = (mediaWrap) => {
    const galleryJson = mediaWrap.querySelector('[data-thumbnail-gallery-json]');
    if (galleryJson) {
      try {
        const parsedItems = JSON.parse(galleryJson.textContent || '[]');
        if (Array.isArray(parsedItems)) {
          return parsedItems.map((item) => normalizeGalleryItem(item)).filter(Boolean);
        }
      } catch (_) {}
    }

    return Array.from(mediaWrap.querySelectorAll('.sb-product-thumbnail__gallery-image-source'))
      .map((node) => parseGalleryToken(node.dataset.galleryImage || ''))
      .filter(Boolean);
  };

  const getRenderedGalleryItems = (mediaWrap) => {
    const renderedItems = String(mediaWrap.dataset.renderedGalleryItems || '').trim();
    if (!renderedItems) return [];

    return renderedItems
      .split('||')
      .map((item) => parseGalleryToken(item))
      .filter(Boolean);
  };

  const setRenderedGalleryItems = (mediaWrap, galleryItems) => {
    const serializedItems = Array.isArray(galleryItems)
      ? galleryItems.map((item) => toGalleryToken(item)).filter(Boolean).join('||')
      : '';

    if (serializedItems) {
      mediaWrap.dataset.renderedGalleryItems = serializedItems;
      return;
    }

    delete mediaWrap.dataset.renderedGalleryItems;
  };

  const setGalleryItems = (mediaWrap, galleryValue) => {
    const parsedItems = Array.isArray(galleryValue)
      ? galleryValue.map((item) => normalizeGalleryItem(item)).filter(Boolean)
      : String(galleryValue || '')
          .split('||')
          .map((item) => parseGalleryToken(item))
          .filter(Boolean);

    let galleryJson = mediaWrap.querySelector('[data-thumbnail-gallery-json]');
    if (!galleryJson) {
      galleryJson = document.createElement('script');
      galleryJson.type = 'application/json';
      galleryJson.dataset.thumbnailGalleryJson = '';
      mediaWrap.appendChild(galleryJson);
    }

    galleryJson.textContent = JSON.stringify(parsedItems.map((item) => normalizeGalleryItem(item)).filter(Boolean));

    return parsedItems;
  };

  const mediaLoadPromiseCache = new Map();
  const ensureMediaReady = (item) => {
    if (!item || !item.src) return Promise.resolve();
    if (mediaLoadPromiseCache.has(item.src)) return mediaLoadPromiseCache.get(item.src);

    const mediaReadyPromise = new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      if (item.type === 'video') {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.src = item.src;
        if (item.poster) video.poster = item.poster;
        video.addEventListener('loadeddata', done, { once: true });
        video.addEventListener('canplay', done, { once: true });
        video.addEventListener('error', done, { once: true });
        video.load();
        return;
      }

      const image = new Image();
      const decodeAndDone = () => {
        if (typeof image.decode === 'function') {
          image.decode().then(done).catch(done);
          return;
        }

        done();
      };
      image.decoding = 'async';
      image.onload = decodeAndDone;
      image.onerror = done;
      image.src = item.src;
      if (image.complete) decodeAndDone();
    });

    mediaLoadPromiseCache.set(item.src, mediaReadyPromise);
    return mediaReadyPromise;
  };

  const waitForMediaElementReady = (mediaElement) =>
    new Promise((resolve) => {
      if (!mediaElement) {
        resolve();
        return;
      }

      if (mediaElement.tagName.toLowerCase() === 'img') {
        if (mediaElement.complete && mediaElement.naturalWidth > 0) {
          resolve();
          return;
        }
        const done = () => resolve();
        mediaElement.addEventListener('load', done, { once: true });
        mediaElement.addEventListener('error', done, { once: true });
        return;
      }

      if (mediaElement.tagName.toLowerCase() === 'video') {
        if (mediaElement.readyState >= 2) {
          resolve();
          return;
        }
        const done = () => resolve();
        mediaElement.addEventListener('loadeddata', done, { once: true });
        mediaElement.addEventListener('canplay', done, { once: true });
        mediaElement.addEventListener('error', done, { once: true });
        return;
      }

      resolve();
    });

  const preloadMediaItem = (item) => {
    void ensureMediaReady(item);
  };

  const warmThumbnailHoverMedia = (mediaWrap) => {
    if (!supportsThumbnailHoverPreview()) return;
    const carouselItems = getCarouselGalleryItems(mediaWrap);
    preloadMediaItem(carouselItems[getHoverSlideIndex(mediaWrap)]);
  };

  const scheduleHoverMediaWarmup = (mediaWrap) => {
    if (!supportsThumbnailHoverPreview()) return;
    const warm = () => warmThumbnailHoverMedia(mediaWrap);

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(warm, { timeout: 1500 });
      return;
    }

    window.setTimeout(warm, 250);
  };

  const buildReadyImageElement = (src, referenceElement, { loading = 'eager' } = {}) =>
    new Promise((resolve) => {
      const image = new Image();
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        image.className = 'sb-product-thumbnail__media-item sb-product-thumbnail__image';
        image.loading = loading;
        image.decoding = 'async';
        image.alt =
          referenceElement?.getAttribute('alt') ||
          referenceElement?.getAttribute('aria-label') ||
          referenceElement?.getAttribute('title') ||
          '';
        resolve(image);
      };

      const decodeAndFinish = () => {
        if (typeof image.decode === 'function') {
          image.decode().then(finish).catch(finish);
          return;
        }

        finish();
      };

      image.onload = decodeAndFinish;
      image.onerror = finish;
      image.decoding = 'async';
      image.src = src;

      if (image.complete) {
        decodeAndFinish();
      }
    });

  const ensureDefaultMediaData = (mediaWrap) => {
    const mediaLink = getMediaLink(mediaWrap);
    if (!mediaLink) return;

    const currentImage = mediaLink.querySelector('.sb-product-thumbnail__media-item');
    const sourceItems = getGalleryItems(mediaWrap);

    if (!mediaWrap.dataset.defaultImage) {
      mediaWrap.dataset.defaultImage =
        (sourceItems[0] && sourceItems[0].src) ||
        (currentImage ? currentImage.currentSrc || currentImage.getAttribute('src') || '' : '');
    }

    if (!mediaWrap.dataset.primaryImage) {
      mediaWrap.dataset.primaryImage = mediaWrap.dataset.defaultImage || '';
    }

    if (typeof mediaWrap.dataset.defaultHoverImage === 'undefined') {
      mediaWrap.dataset.defaultHoverImage = mediaWrap.dataset.hoverImage || '';
    }

    if (typeof mediaWrap.dataset.isHovering === 'undefined') {
      mediaWrap.dataset.isHovering = 'false';
    }
  };

  const getConfiguredHoverMediaIndex = (mediaWrap) => {
    const parsedIndex = Number.parseInt(String(mediaWrap.dataset.hoverMediaIndex || '').trim(), 10);
    return Number.isFinite(parsedIndex) ? parsedIndex : 0;
  };

  const normalizeGalleryItems = (mediaWrap) => {
    ensureDefaultMediaData(mediaWrap);
    const sourceItems = getGalleryItems(mediaWrap);
    const primaryImage = String(mediaWrap.dataset.primaryImage || mediaWrap.dataset.defaultImage || '').trim();

    let items = sourceItems.slice();
    if (primaryImage) {
      if (!items.length) {
        items = [{ type: 'image', src: primaryImage, poster: '' }];
      } else {
        items[0] = { type: 'image', src: primaryImage, poster: '' };
      }
    }

    if (!items.length) {
      const fallbackImage = String(mediaWrap.dataset.defaultImage || '').trim();
      if (fallbackImage) items = [{ type: 'image', src: fallbackImage, poster: '' }];
    }

    return items;
  };

  const getHoverGalleryItems = (mediaWrap) => {
    const normalizedItems = normalizeGalleryItems(mediaWrap);
    if (normalizedItems.length <= 1) return [];

    const configuredHoverIndex = getConfiguredHoverMediaIndex(mediaWrap);
    let resolvedHoverIndex = configuredHoverIndex;
    if (!Number.isFinite(resolvedHoverIndex) || resolvedHoverIndex <= 1 || resolvedHoverIndex > normalizedItems.length) {
      resolvedHoverIndex = normalizedItems.length > 1 ? 2 : 0;
    }
    if (!Number.isFinite(resolvedHoverIndex) || resolvedHoverIndex <= 1 || resolvedHoverIndex > normalizedItems.length) {
      return [];
    }

    const hoverTargetIndex = resolvedHoverIndex - 1;
    const hoverItems = normalizedItems.slice(1);
    const prioritizedItem = normalizedItems[hoverTargetIndex];
    if (!prioritizedItem || !prioritizedItem.src) return hoverItems;

    return [prioritizedItem].concat(
      hoverItems.filter((item, itemIndex) => itemIndex !== hoverTargetIndex - 1)
    );
  };

  const getCarouselGalleryItems = (mediaWrap) => {
    const normalizedItems = normalizeGalleryItems(mediaWrap);
    if (!normalizedItems.length) return [];

    const hoverItems = getHoverGalleryItems(mediaWrap);
    if (hoverItems.length) {
      return [normalizedItems[0]].concat(hoverItems);
    }

    return normalizedItems;
  };

  const getHoverSlideIndex = (mediaWrap) => {
    const carouselItems = getCarouselGalleryItems(mediaWrap);
    return carouselItems.length > 1 ? 1 : 0;
  };

  const getNavigationSlideIndices = (mediaWrap) => {
    const carouselItems = getCarouselGalleryItems(mediaWrap);
    if (carouselItems.length <= 1) return [];

    return carouselItems.slice(1).map((_, index) => index + 1);
  };

  const hasInteractiveGalleryItems = (mediaWrap) => getCarouselGalleryItems(mediaWrap).length > 1;
  const shouldUseInteractiveGallery = (mediaWrap) =>
    isInteractiveGalleryActive(mediaWrap) && canUseInteractiveGallery(mediaWrap) && hasInteractiveGalleryItems(mediaWrap);

  const updateNavButtonsVisibility = (mediaWrap, count) => {
    const slideCount = Number.isFinite(count) ? count : getNavigationSlideIndices(mediaWrap).length;
    mediaWrap.querySelectorAll('[data-gallery-nav]').forEach((navButton) => {
      navButton.style.display = slideCount > 1 ? '' : 'none';
    });
  };

  const getDisplaySourceForMediaItem = (mediaWrap, item) => {
    if (!item) return '';
    if (item.type === 'video') return String(item.poster || mediaWrap.dataset.primaryImage || mediaWrap.dataset.defaultImage || '').trim();
    return String(item.src || '').trim();
  };

  const createMediaElement = (mediaItem, referenceElement, loading = 'lazy') => {
    if (!mediaItem || !mediaItem.src) return null;
    const baseClassName = 'sb-product-thumbnail__media-item';

    if (mediaItem.type === 'video') {
      const video = document.createElement('video');
      video.className = `${baseClassName} sb-product-thumbnail__video`;
      video.autoplay = true;
      video.controls = false;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = mediaItem.src;
      video.setAttribute('autoplay', '');
      video.setAttribute('muted', '');
      video.setAttribute('loop', '');
      video.setAttribute('playsinline', '');
      if (mediaItem.poster) video.poster = mediaItem.poster;
      return video;
    }

    const image = document.createElement('img');
    image.className = `${baseClassName} sb-product-thumbnail__image`;
    image.loading = loading;
    image.decoding = 'async';
    image.src = mediaItem.src;
    image.alt = referenceElement?.getAttribute('aria-label') || referenceElement?.getAttribute('title') || '';
    return image;
  };

  const pauseInactiveVideos = (mediaWrap, activeIndex) => {
    getCarouselSlides(mediaWrap, { includeClones: true }).forEach((slide, index) => {
      const video = slide.querySelector('video');
      if (!video || index === activeIndex) return;
      try {
        video.pause();
      } catch (_) {}
    });
  };

  const updateRenderedSlideState = (mediaWrap, activeRealIndex) => {
    getCarouselSlides(mediaWrap, { includeClones: true }).forEach((slide) => {
      if (slide.dataset.galleryClone === 'true') {
        slide.setAttribute('aria-hidden', 'true');
        return;
      }
      const slideRealIndex = Number.parseInt(slide.dataset.galleryRealIndex || '-1', 10);
      slide.setAttribute('aria-hidden', `${slideRealIndex !== activeRealIndex}`);
    });
  };

  const getCurrentIndex = (mediaWrap) => {
    const slideCount = getCarouselSlides(mediaWrap).length;
    if (!slideCount) return 0;

    let currentIndex = Number.parseInt(mediaWrap.dataset.galleryIndex || '0', 10);
    if (!Number.isFinite(currentIndex)) currentIndex = 0;
    if (currentIndex < 0 || currentIndex >= slideCount) currentIndex = 0;
    return currentIndex;
  };

  const getRenderedSlideOffset = (mediaWrap, index) => {
    const renderedSlides = getCarouselSlides(mediaWrap, { includeClones: true });
    const hasLeadingClone = renderedSlides[0]?.dataset.galleryClone === 'true';
    return hasLeadingClone ? index + 1 : index;
  };

  const setStaticMedia = (mediaWrap, nextSource) => {
    if (!nextSource) return;
    const mediaLink = getMediaLink(mediaWrap);
    if (!mediaLink) return;

    const currentMedia = getStaticMediaNode(mediaWrap);
    const currentSrc =
      currentMedia && currentMedia.tagName.toLowerCase() === 'img'
        ? currentMedia.currentSrc || currentMedia.getAttribute('src') || ''
        : '';
    if (currentSrc === nextSource) return;

    const token = String((Number(mediaWrap.dataset.staticMediaSwapToken || '0') || 0) + 1);
    mediaWrap.dataset.staticMediaSwapToken = token;

    buildReadyImageElement(nextSource, getAnyMediaNode(mediaWrap) || mediaLink, { loading: 'eager' }).then((replacement) => {
      if (mediaWrap.dataset.staticMediaSwapToken !== token) return;

      const liveMediaLink = getMediaLink(mediaWrap);
      if (!liveMediaLink) return;

      liveMediaLink.querySelectorAll(':scope > .sb-product-thumbnail__carousel').forEach((node) => node.remove());

      const currentStaticMedia = getStaticMediaNode(mediaWrap);
      if (currentStaticMedia) {
        currentStaticMedia.replaceWith(replacement);
        return;
      }

      insertStaticMediaNode(liveMediaLink, replacement);
    });
  };

  const getStaticDisplaySource = (mediaWrap) => {
    const normalizedItems = normalizeGalleryItems(mediaWrap);
    if (!normalizedItems.length) return String(mediaWrap.dataset.primaryImage || mediaWrap.dataset.defaultImage || '').trim();

    const imageItem = normalizedItems.find((item) => item.type === 'image' && item.src);
    if (imageItem) return imageItem.src;

    const firstItem = normalizedItems[0];
    if (!firstItem) return '';
    if (firstItem.type === 'video') return String(firstItem.poster || mediaWrap.dataset.primaryImage || mediaWrap.dataset.defaultImage || '').trim();
    return String(firstItem.src || '').trim();
  };

  const renderStaticMedia = (mediaWrap) => {
    const mediaLink = getMediaLink(mediaWrap);
    if (!mediaLink) return;

    mediaWrap.dataset.galleryIndex = '0';
    setRenderedGalleryItems(mediaWrap, []);
    const staticNavCount = canUseInteractiveGallery(mediaWrap) ? getNavigationSlideIndices(mediaWrap).length : 1;
    updateNavButtonsVisibility(mediaWrap, staticNavCount);

    const staticDisplaySource = getStaticDisplaySource(mediaWrap);
    if (!staticDisplaySource) return;
    setStaticMedia(mediaWrap, staticDisplaySource);
  };

  const ensureInteractiveGallery = (mediaWrap, { preferredIndex = 0, instant = true } = {}) => {
    if (!canUseInteractiveGallery(mediaWrap)) return false;

    const displayItems = getCarouselGalleryItems(mediaWrap);
    if (displayItems.length <= 1) return false;

    const renderedItems = getRenderedGalleryItems(mediaWrap);
    const displayToken = displayItems.map((item) => toGalleryToken(item)).join('||');
    const renderedToken = renderedItems.map((item) => toGalleryToken(item)).join('||');
    if (!isInteractiveGalleryActive(mediaWrap) || displayToken !== renderedToken) {
      mediaWrap.dataset.galleryActive = 'true';
      renderCarousel(mediaWrap, { preferredIndex, instant, items: displayItems });
      return true;
    }

    selectSlide(mediaWrap, preferredIndex, { instant });
    updateNavButtonsVisibility(mediaWrap, getNavigationSlideIndices(mediaWrap).length);
    return true;
  };

  const preloadInteractionMedia = (mediaWrap) => {
    const carouselItems = getCarouselGalleryItems(mediaWrap);
    const hoverSlideIndex = getHoverSlideIndex(mediaWrap);
    preloadMediaItem(carouselItems[0]);
    preloadMediaItem(carouselItems[hoverSlideIndex]);
  };

  const prepareHoverPreview = async (mediaWrap) => {
    const carouselItems = getCarouselGalleryItems(mediaWrap);
    const hoverSlideIndex = getHoverSlideIndex(mediaWrap);
    const hoverItem = carouselItems[hoverSlideIndex];
    preloadMediaItem(carouselItems[0]);
    await ensureMediaReady(hoverItem);
    return {
      hoverItem,
      hoverSlideIndex,
    };
  };

  const selectSlide = (mediaWrap, requestedIndex, { instant = false } = {}) => {
    const track = getCarouselTrack(mediaWrap);
    const slides = getCarouselSlides(mediaWrap);
    if (!track || !slides.length) return 0;

    let index = Number.parseInt(`${requestedIndex}`, 10);
    if (!Number.isFinite(index)) index = 0;
    index = (index + slides.length) % slides.length;

    track.classList.toggle('is-instant', instant);
    track.classList.toggle('is-animating', !instant);
    const renderedOffset = getRenderedSlideOffset(mediaWrap, index);
    track.style.transform = `translateX(-${renderedOffset * 100}%)`;
    mediaWrap.dataset.galleryIndex = String(index);

    updateRenderedSlideState(mediaWrap, index);

    const renderedSlides = getCarouselSlides(mediaWrap, { includeClones: true });
    const activeRenderedIndex = getRenderedSlideOffset(mediaWrap, index);
    pauseInactiveVideos(mediaWrap, activeRenderedIndex);
    const activeVideo = renderedSlides[activeRenderedIndex]?.querySelector('video');
    if (activeVideo) {
      const playPromise = activeVideo.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    }

    const galleryItems = getRenderedGalleryItems(mediaWrap);
    if (galleryItems.length > 1) {
      preloadMediaItem(galleryItems[(index + 1) % galleryItems.length]);
      preloadMediaItem(galleryItems[(index - 1 + galleryItems.length) % galleryItems.length]);
    }

    return index;
  };

  const renderCarousel = (mediaWrap, { preferredIndex = 0, instant = true, items = null } = {}) => {
    const mediaLink = getMediaLink(mediaWrap);
    if (!mediaLink) return;

    const normalizedItems = Array.isArray(items) && items.length ? items : getCarouselGalleryItems(mediaWrap);
    if (!normalizedItems.length) return;
    setRenderedGalleryItems(mediaWrap, normalizedItems);

    const previousVisualNodes = Array.from(
      mediaLink.querySelectorAll(
        ':scope > .sb-product-thumbnail__media-item, :scope > .sb-product-thumbnail__image-placeholder, :scope > .sb-product-thumbnail__carousel'
      )
    );
    previousVisualNodes
      .filter((node) => node.classList.contains('sb-product-thumbnail__carousel'))
      .forEach((node) => node.remove());

    const carousel = document.createElement('div');
    carousel.className = 'sb-product-thumbnail__carousel';

    const track = document.createElement('div');
    track.className = 'sb-product-thumbnail__carousel-track';

    const navigationIndices = getNavigationSlideIndices(mediaWrap);
    if (navigationIndices.length > 1) {
      const leadingCloneIndex = navigationIndices[navigationIndices.length - 1];
      const leadingClone = document.createElement('div');
      leadingClone.className = 'sb-product-thumbnail__carousel-slide';
      leadingClone.dataset.galleryClone = 'true';
      leadingClone.dataset.galleryRealIndex = String(leadingCloneIndex);
      const leadingCloneMedia = createMediaElement(normalizedItems[leadingCloneIndex], mediaLink, 'lazy');
      if (leadingCloneMedia) leadingClone.appendChild(leadingCloneMedia);
      track.appendChild(leadingClone);
    }

    normalizedItems.forEach((item, index) => {
      const slide = document.createElement('div');
      slide.className = 'sb-product-thumbnail__carousel-slide';
      slide.dataset.galleryRealIndex = String(index);
      slide.setAttribute('aria-hidden', `${index !== 0}`);
      const mediaElement = createMediaElement(item, mediaLink, index === 0 ? 'eager' : 'lazy');
      if (mediaElement) slide.appendChild(mediaElement);
      track.appendChild(slide);
    });

    if (navigationIndices.length > 1) {
      const trailingCloneIndex = navigationIndices[0];
      const trailingClone = document.createElement('div');
      trailingClone.className = 'sb-product-thumbnail__carousel-slide';
      trailingClone.dataset.galleryClone = 'true';
      trailingClone.dataset.galleryRealIndex = String(trailingCloneIndex);
      const trailingCloneMedia = createMediaElement(normalizedItems[trailingCloneIndex], mediaLink, 'lazy');
      if (trailingCloneMedia) trailingClone.appendChild(trailingCloneMedia);
      track.appendChild(trailingClone);
    }

    carousel.appendChild(track);
    mediaLink.appendChild(carousel);

    updateNavButtonsVisibility(mediaWrap, navigationIndices.length);
    selectSlide(mediaWrap, preferredIndex, { instant });
    preloadMediaItem(normalizedItems[0]);
    preloadMediaItem(normalizedItems[1]);

    const activeSlide = getCarouselSlides(mediaWrap)[getCurrentIndex(mediaWrap)];
    const activeMedia = activeSlide?.querySelector('.sb-product-thumbnail__media-item');
    waitForMediaElementReady(activeMedia)
      .then(() => {
        if (!carousel.isConnected) return;
        previousVisualNodes
          .filter((node) => node.isConnected && node !== carousel)
          .forEach((node) => node.remove());
      });
  };

  const initThumbnailMediaScope = (scope = document, options = {}) => {
    if (!(scope instanceof Element || scope instanceof Document)) return;
    const { initSwatchInteractions = true } = options;
    if (initSwatchInteractions) {
      initSwatchInteractionScope(scope);
    }

    scope.querySelectorAll('.sb-product-thumbnail__media-wrap').forEach((mediaWrap) => {
      if (mediaWrap.dataset.sbThumbnailMediaInitialized === 'true') return;
      mediaWrap.dataset.sbThumbnailMediaInitialized = 'true';

      ensureDefaultMediaData(mediaWrap);
      if (typeof mediaWrap.dataset.galleryActive === 'undefined') {
        mediaWrap.dataset.galleryActive = 'false';
      }
      renderStaticMedia(mediaWrap);
      scheduleHoverMediaWarmup(mediaWrap);

      mediaWrap.addEventListener('mouseenter', async () => {
        if (!supportsThumbnailHoverPreview()) return;
        const hoverToken = String((Number(mediaWrap.dataset.hoverPreviewToken || '0') || 0) + 1);
        mediaWrap.dataset.hoverPreviewToken = hoverToken;
        mediaWrap.dataset.isHovering = 'true';
        const { hoverSlideIndex } = await prepareHoverPreview(mediaWrap);
        if (mediaWrap.dataset.hoverPreviewToken !== hoverToken || mediaWrap.dataset.isHovering !== 'true') return;
        if (!ensureInteractiveGallery(mediaWrap, { preferredIndex: hoverSlideIndex, instant: true })) {
          const hoverItems = getHoverGalleryItems(mediaWrap);
          updateNavButtonsVisibility(mediaWrap, hoverItems.length);
          const hoverDisplaySource = getDisplaySourceForMediaItem(mediaWrap, hoverItems[0]);
          if (hoverDisplaySource) setStaticMedia(mediaWrap, hoverDisplaySource);
        }
      });

      mediaWrap.addEventListener('mouseleave', () => {
        if (!supportsThumbnailHoverPreview()) return;
        mediaWrap.dataset.hoverPreviewToken = String((Number(mediaWrap.dataset.hoverPreviewToken || '0') || 0) + 1);
        mediaWrap.dataset.isHovering = 'false';
        mediaWrap.dataset.galleryIndex = '0';
        if (isInteractiveGalleryActive(mediaWrap) && canUseInteractiveGallery(mediaWrap)) {
          ensureInteractiveGallery(mediaWrap, { preferredIndex: 0, instant: true });
        } else {
          renderStaticMedia(mediaWrap);
        }
      });

      mediaWrap.addEventListener('focusin', () => {
        if (!supportsThumbnailHoverPreview()) return;
        preloadInteractionMedia(mediaWrap);
        ensureInteractiveGallery(mediaWrap, { preferredIndex: getCurrentIndex(mediaWrap), instant: true });
      });
    });

    scope.querySelectorAll('.sb-product-thumbnail__swatches').forEach((row) => {
      if (row.dataset.sbThumbnailMediaRowInitialized === 'true') return;
      row.dataset.sbThumbnailMediaRowInitialized = 'true';

      const applySwatchImage = async (button, sourceId = '') => {
        if (!button) return;

        const nextImage = String(button.dataset.thumbnailImage || '').trim();
        const nextHoverMediaIndex = String(button.dataset.thumbnailHoverMediaIndex || '').trim();
        const nextGallery = String(button.dataset.thumbnailGallery || '').trim();
        const thumbnail = button.closest('.sb-product-thumbnail');
        const mediaWrap = thumbnail ? thumbnail.querySelector('.sb-product-thumbnail__media-wrap') : null;
        if (!mediaWrap) return;
        const swatchSwapToken = String((Number(mediaWrap.dataset.swatchSwapToken || '0') || 0) + 1);
        mediaWrap.dataset.swatchSwapToken = swatchSwapToken;

        if (nextImage) {
          mediaWrap.dataset.primaryImage = nextImage;
        }
        if (nextHoverMediaIndex) {
          mediaWrap.dataset.hoverMediaIndex = nextHoverMediaIndex;
        } else {
          delete mediaWrap.dataset.hoverMediaIndex;
        }

        const isPreviewSource =
          sourceId === 'product-thumbnail-swatch-hover' || sourceId === 'product-thumbnail-swatch-focus';

        if (isPreviewSource) {
          if (nextImage) {
            await ensureMediaReady({ type: 'image', src: nextImage, poster: '' });
            if (mediaWrap.dataset.swatchSwapToken !== swatchSwapToken) return;
            mediaWrap.dataset.galleryIndex = '0';
            if (!ensureInteractiveGallery(mediaWrap, { preferredIndex: 0, instant: true })) {
              setStaticMedia(mediaWrap, nextImage);
            }
          } else {
            if (isInteractiveGalleryActive(mediaWrap)) {
              ensureInteractiveGallery(mediaWrap, { preferredIndex: 0, instant: true });
            } else {
              renderStaticMedia(mediaWrap);
            }
          }
          return;
        }

        const galleryPayload = nextGallery || (nextImage ? `image::${nextImage}` : '');
        if (galleryPayload) {
          setGalleryItems(mediaWrap, galleryPayload);
        }

        const normalizedItems = normalizeGalleryItems(mediaWrap);
        await ensureMediaReady(normalizedItems[0]);
        if (mediaWrap.dataset.swatchSwapToken !== swatchSwapToken) return;

        mediaWrap.dataset.galleryIndex = '0';
        if (mediaWrap.dataset.isHovering === 'true' && canUseInteractiveGallery(mediaWrap)) {
          ensureInteractiveGallery(mediaWrap, { preferredIndex: getHoverSlideIndex(mediaWrap), instant: true });
        } else if (isInteractiveGalleryActive(mediaWrap) && canUseInteractiveGallery(mediaWrap)) {
          ensureInteractiveGallery(mediaWrap, { preferredIndex: 0, instant: true });
        } else {
          renderStaticMedia(mediaWrap);
        }
      };

      row.addEventListener(ThemeEvents.variantUpdate, (event) => {
        const swatchButton = event?.detail?.data?.swatchButton;
        if (!(swatchButton instanceof HTMLElement)) return;
        if (!row.contains(swatchButton)) return;
        applySwatchImage(swatchButton, String(event?.detail?.sourceId || ''));
      });
    });

    scope.querySelectorAll('[data-gallery-nav]').forEach((button) => {
      if (button.dataset.sbThumbnailGalleryNavInitialized === 'true') return;
      button.dataset.sbThumbnailGalleryNavInitialized = 'true';

      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const direction = Number.parseInt(button.dataset.galleryNav || '0', 10);
        if (!direction) return;

        const mediaWrap = button.closest('.sb-product-thumbnail__media-wrap');
        if (!mediaWrap || mediaWrap.dataset.galleryAnimating === 'true') return;

        const currentIndexBeforeActivation = shouldUseInteractiveGallery(mediaWrap) ? getCurrentIndex(mediaWrap) : 0;
        if (!ensureInteractiveGallery(mediaWrap, { preferredIndex: currentIndexBeforeActivation, instant: true })) return;

        const navigationIndices = getNavigationSlideIndices(mediaWrap);
        if (navigationIndices.length < 2) return;

        const currentIndex = getCurrentIndex(mediaWrap);
        const currentNavigationIndex = navigationIndices.indexOf(currentIndex);
        let nextNavigationIndex = currentNavigationIndex;
        if (currentNavigationIndex < 0) {
          nextNavigationIndex = direction > 0 ? 0 : navigationIndices.length - 1;
        } else {
          nextNavigationIndex = (currentNavigationIndex + direction + navigationIndices.length) % navigationIndices.length;
        }
        const nextIndex = navigationIndices[nextNavigationIndex];
        const galleryItems = getRenderedGalleryItems(mediaWrap);
        const isWrapForward = direction > 0 && currentNavigationIndex === navigationIndices.length - 1;
        const isWrapBackward = direction < 0 && currentNavigationIndex === 0;
        const navigationToken = String((Number(mediaWrap.dataset.galleryNavigationToken || '0') || 0) + 1);
        mediaWrap.dataset.galleryNavigationToken = navigationToken;
        mediaWrap.dataset.galleryAnimating = 'true';
        if (isWrapForward || isWrapBackward) {
          const track = getCarouselTrack(mediaWrap);
          const slides = getCarouselSlides(mediaWrap);
          const cloneRenderedIndex = isWrapForward ? slides.length + 1 : 0;
          if (track) {
            track.classList.toggle('is-instant', false);
            track.classList.add('is-animating');
            track.style.transform = `translateX(-${cloneRenderedIndex * 100}%)`;
          }
          mediaWrap.dataset.galleryIndex = String(nextIndex);
          updateRenderedSlideState(mediaWrap, nextIndex);
        } else {
          selectSlide(mediaWrap, nextIndex, { instant: false });
        }
        preloadMediaItem(galleryItems[nextIndex]);

        const track = getCarouselTrack(mediaWrap);
        let cleared = false;
        const clearAnimating = () => {
          if (cleared) return;
          cleared = true;
                if (mediaWrap.dataset.galleryNavigationToken === navigationToken && (isWrapForward || isWrapBackward)) {
                  selectSlide(mediaWrap, nextIndex, { instant: true });
                }
                getCarouselTrack(mediaWrap)?.classList.remove('is-animating');
                mediaWrap.dataset.galleryAnimating = 'false';
              };

        if (track) {
          track.addEventListener('transitionend', clearAnimating, { once: true });
          setTimeout(clearAnimating, 220);
        } else {
          clearAnimating();
        }
      });
    });

    syncThumbnailDiscountPricingScope(scope);
    syncThumbnailReviewCountScope(scope);
  };

  document.addEventListener(ThemeEvents.variantUpdate, (event) => {
    const sourceId = String(event?.detail?.sourceId || '');
    if (IGNORE_SOURCES.has(sourceId)) return;

    const swatchFromDetail = event?.detail?.data?.swatchButton;
    const swatchFromTarget =
      event.target instanceof HTMLElement && event.target.closest('.sb-product-thumbnail__swatch');
    const button = swatchFromDetail instanceof HTMLElement ? swatchFromDetail : swatchFromTarget;
    if (!button) return;
    syncThumbnailPurchaseState(button);
  });

  window.SBProductThumbnail = {
    ThemeEvents,
    dispatchSwatchVariantEvents,
    getSelectedSwatch,
    initSwatchInteractionScope,
    initThumbnailMediaScope,
    syncThumbnailPurchaseState,
    syncThumbnailDiscountPricingScope,
    syncThumbnailReviewCountScope,
  };

  document.dispatchEvent(new CustomEvent('sb:product-thumbnail:ready'));
  syncImageFrameScope(document);
  observeImageFrames();
  initThumbnailMediaScope(document, { initSwatchInteractions: true });
  document.addEventListener('shopify:section:load', (event) => {
    initThumbnailMediaScope(event.target, { initSwatchInteractions: true });
    syncImageFrameScope(event.target);
  });
})();
