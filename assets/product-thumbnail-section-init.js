(() => {
  const SECTIONS_READY_EVENT = 'sb:product-thumbnail-sections:ready';
  const DECLARATIVE_ROOT_SELECTOR = '[data-sb-thumbnail-section]';

  const getMatchingRoots = (scope, selector) => {
    if (!(scope instanceof Element || scope instanceof Document) || !selector) return [];
    const roots = Array.from(scope.querySelectorAll(selector));
    if (scope instanceof Element && scope.matches(selector)) {
      roots.unshift(scope);
    }
    return roots;
  };

  const whenThumbnailEngineReady = (callback) => {
    if (
      window.SBProductThumbnail &&
      typeof window.SBProductThumbnail.initThumbnailMediaScope === 'function'
    ) {
      callback();
      return;
    }

    document.addEventListener('sb:product-thumbnail:ready', callback, { once: true });
  };

  const ensureThumbnailMediaScope = (scope = document) => {
    whenThumbnailEngineReady(() => {
      if (
        window.SBProductThumbnail &&
        typeof window.SBProductThumbnail.initThumbnailMediaScope === 'function'
      ) {
        window.SBProductThumbnail.initThumbnailMediaScope(scope, {
          initSwatchInteractions: true,
        });
      }
    });
  };

  const applyReviewFormatting = (scope = document) => {
    if (!(scope instanceof Element || scope instanceof Document)) return;
    scope.querySelectorAll('.sb-product-thumbnail__reviews[data-review-count]').forEach((node) => {
      const rawValue = Number.parseInt(node.dataset.reviewCount || '0', 10);
      if (!Number.isFinite(rawValue)) return;
      node.textContent = `${rawValue.toLocaleString()} reviews`;
    });
  };

  const getShopRoot = () => {
    const rootPath =
      window.Shopify &&
      window.Shopify.routes &&
      typeof window.Shopify.routes.root === 'string'
        ? window.Shopify.routes.root
        : '/';
    return rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
  };

  const addToCartNative = async (
    variantId,
    quantity = 1,
    {
      source = 'product-thumbnail',
      sourceIdPrefix = 'product-thumbnail',
    } = {}
  ) => {
    const parsedVariantId = Number.parseInt(`${variantId}`, 10);
    const parsedQuantity = Number.parseInt(`${quantity}`, 10);
    if (!Number.isFinite(parsedVariantId) || parsedVariantId <= 0) {
      throw new Error('Invalid variant id');
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      throw new Error('Invalid quantity');
    }

    const shopRoot = getShopRoot();
    const cartUrl = (path) => `${shopRoot}${path}`;
    const formData = new FormData();
    formData.append('id', `${parsedVariantId}`);
    formData.append('quantity', `${parsedQuantity}`);

    const addResponse = await fetch(cartUrl('cart/add.js'), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      body: formData,
    });
    if (!addResponse.ok) {
      throw new Error('Add to cart failed');
    }

    const cartResponse = await fetch(cartUrl('cart.js'), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!cartResponse.ok) {
      throw new Error('Cart refresh failed');
    }
    const cart = await cartResponse.json();

    document.dispatchEvent(
      new CustomEvent('cart:update', {
        bubbles: true,
        detail: {
          resource: cart,
          sourceId: `${sourceIdPrefix}-${parsedVariantId}`,
          data: {
            source,
            itemCount: parsedQuantity,
            variantId: parsedVariantId,
          },
        },
      })
    );

    return cart;
  };

  const shouldResetAddedClass = (button, mode) => {
    if (mode === 'none') return false;
    if (mode === 'small-only') {
      return button.classList.contains('sb-product-thumbnail__add-to-cart');
    }
    return true;
  };

  const bindAddToCartButtons = (scope = document, options = {}) => {
    if (!(scope instanceof Element || scope instanceof Document)) return;

    const {
      boundFlag = 'sbThumbnailAtcBound',
      source = 'product-thumbnail',
      sourceIdPrefix = 'product-thumbnail',
      resetAddedClassMode = 'small-only',
    } = options;

    scope.querySelectorAll('[data-add-to-cart]').forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      if (button.dataset[boundFlag] === 'true') return;
      button.dataset[boundFlag] = 'true';

      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button instanceof HTMLButtonElement && button.disabled) return;

        const variantId = Number.parseInt(button.dataset.variantId || '', 10);
        if (!Number.isFinite(variantId) || variantId <= 0) return;

        if (button instanceof HTMLButtonElement) {
          button.disabled = true;
        }

        try {
          if (window.SBCart && typeof window.SBCart.add === 'function') {
            await window.SBCart.add(variantId, {
              quantity: 1,
              sourceElement: button,
            });
          } else {
            await addToCartNative(variantId, 1, {
              source,
              sourceIdPrefix,
            });
          }

          if (shouldResetAddedClass(button, resetAddedClassMode)) {
            button.classList.remove('is-added');
          }
        } catch (_) {
          button.classList.remove('is-added');
        } finally {
          if (button instanceof HTMLButtonElement) {
            button.disabled = false;
          }
        }
      });
    });
  };

  const initRoot = (root, options = {}) => {
    if (!(root instanceof HTMLElement)) return;

    const {
      rootInitializedDataKey = 'sbThumbnailSectionInitialized',
      initMedia = true,
      formatReviews = true,
      bindAddToCart = true,
      addToCartBoundFlag = 'sbThumbnailAtcBound',
      addToCartSource = 'product-thumbnail',
      addToCartSourceIdPrefix = 'product-thumbnail',
      resetAddedClassMode = 'small-only',
    } = options;

    if (root.dataset[rootInitializedDataKey] === 'true') return;
    root.dataset[rootInitializedDataKey] = 'true';

    if (initMedia) {
      ensureThumbnailMediaScope(root);
    }

    if (bindAddToCart) {
      bindAddToCartButtons(root, {
        boundFlag: addToCartBoundFlag,
        source: addToCartSource,
        sourceIdPrefix: addToCartSourceIdPrefix,
        resetAddedClassMode,
      });
    }

    if (formatReviews) {
      applyReviewFormatting(root);
    }
  };

  const initSection = (scope = document, options = {}) => {
    const {
      rootSelector,
      ...rootOptions
    } = options;

    if (!rootSelector) return;
    getMatchingRoots(scope, rootSelector).forEach((root) => {
      initRoot(root, rootOptions);
    });
  };

  const parseBooleanDataAttribute = (value, fallback) => {
    if (typeof value !== 'string' || value.trim() === '') return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off')
      return false;
    return fallback;
  };

  const parseStringDataAttribute = (value, fallback) => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized === '' ? fallback : normalized;
  };

  const getDeclarativeRootOptions = (root) => {
    if (!(root instanceof HTMLElement)) return {};
    const {
      sbThumbnailInitKey,
      sbThumbnailInitMedia,
      sbThumbnailFormatReviews,
      sbThumbnailBindAddToCart,
      sbThumbnailAtcBoundFlag,
      sbThumbnailAtcSource,
      sbThumbnailAtcSourceIdPrefix,
      sbThumbnailResetAddedClassMode,
    } = root.dataset;

    return {
      rootInitializedDataKey: parseStringDataAttribute(sbThumbnailInitKey, 'sbThumbnailSectionInitialized'),
      initMedia: parseBooleanDataAttribute(sbThumbnailInitMedia, true),
      formatReviews: parseBooleanDataAttribute(sbThumbnailFormatReviews, true),
      bindAddToCart: parseBooleanDataAttribute(sbThumbnailBindAddToCart, true),
      addToCartBoundFlag: parseStringDataAttribute(sbThumbnailAtcBoundFlag, 'sbThumbnailAtcBound'),
      addToCartSource: parseStringDataAttribute(sbThumbnailAtcSource, 'product-thumbnail'),
      addToCartSourceIdPrefix: parseStringDataAttribute(
        sbThumbnailAtcSourceIdPrefix,
        'product-thumbnail'
      ),
      resetAddedClassMode: parseStringDataAttribute(sbThumbnailResetAddedClassMode, 'small-only'),
    };
  };

  const initDeclarativeSections = (scope = document) => {
    getMatchingRoots(scope, DECLARATIVE_ROOT_SELECTOR).forEach((root) => {
      if (!(root instanceof HTMLElement)) return;
      initRoot(root, getDeclarativeRootOptions(root));
    });
  };

  window.SBProductThumbnailSections = {
    applyReviewFormatting,
    bindAddToCartButtons,
    ensureThumbnailMediaScope,
    initDeclarativeSections,
    initRoot,
    initSection,
  };

  const initializeInitialDeclarativeSections = () => {
    initDeclarativeSections(document);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeInitialDeclarativeSections, { once: true });
  } else {
    initializeInitialDeclarativeSections();
  }

  document.addEventListener('shopify:section:load', (event) => {
    if (!event || !(event.target instanceof Element)) return;
    initDeclarativeSections(event.target);
  });

  document.dispatchEvent(new CustomEvent(SECTIONS_READY_EVENT));
})();
