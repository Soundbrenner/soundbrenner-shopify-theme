(() => {
  if (window.__sbCartSystemInitialized) return;
  window.__sbCartSystemInitialized = true;

  const EVENTS = {
    cartChanged: 'sb:cart:changed',
    drawerState: 'sb:cart-drawer:state-change',
  };

  const CART_OPEN_CLASS = 'is-open';
  const CART_ROW_REMOVE_DELAY = 170;
  const CART_ROW_REMOVE_FALLBACK = 360;
  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supportsViewTransitions = () =>
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    typeof document.startViewTransition === 'function';

  const startViewTransition = (callback, types = []) => {
    if (!supportsViewTransitions() || prefersReducedMotion()) {
      callback();
      return;
    }

    const transition = document.startViewTransition(callback);
    if (transition && transition.types && Array.isArray(types)) {
      types.forEach((type) => {
        if (type) transition.types.add(type);
      });
    }
  };

  const shopRoot = (() => {
    const root =
      window.Shopify && window.Shopify.routes && typeof window.Shopify.routes.root === 'string'
        ? window.Shopify.routes.root
        : '/';
    return root.endsWith('/') ? root : `${root}/`;
  })();

  const cartUrl = (path) => `${shopRoot}${path}`;
  const normalizePathname = (pathname) => {
    const value = `${pathname || '/'}`;
    const trimmed = value.replace(/\/+$/, '');
    return trimmed === '' ? '/' : trimmed;
  };
  const isOnCartPage = (() => {
    try {
      const cartPathname = normalizePathname(new URL(cartUrl('cart'), window.location.origin).pathname);
      const currentPathname = normalizePathname(window.location.pathname);
      return currentPathname === cartPathname;
    } catch (_) {
      return false;
    }
  })();

  const headerCartCountNode = document.querySelector('[data-header-cart-count]');
  let previousCartCount = (() => {
    if (!headerCartCountNode) return 0;
    const parsed = Number.parseInt(`${headerCartCountNode.textContent || '0'}`, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  })();

  const clampCount = (count) => {
    const parsed = Number.parseInt(`${count}`, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };

  const triggerBadgeBump = () => {
    if (!headerCartCountNode || headerCartCountNode.hidden) return;
    headerCartCountNode.classList.remove('is-bump');
    void headerCartCountNode.offsetWidth;
    headerCartCountNode.classList.add('is-bump');
  };

  const setHeaderCartCount = (count, { animate = true } = {}) => {
    if (!headerCartCountNode) return;
    const normalized = clampCount(count);
    const wasHidden = headerCartCountNode.hidden;

    if (normalized <= 0) {
      headerCartCountNode.textContent = '';
      headerCartCountNode.hidden = true;
      headerCartCountNode.classList.remove('is-double-digit', 'is-bump');
      previousCartCount = 0;
      return;
    }

    const displayCount = normalized > 99 ? '99+' : `${normalized}`;
    headerCartCountNode.hidden = false;
    headerCartCountNode.textContent = displayCount;
    headerCartCountNode.classList.toggle('is-double-digit', displayCount.length > 1);

    const shouldAnimate =
      animate && normalized > 0 && (wasHidden || normalized !== previousCartCount);
    previousCartCount = normalized;

    if (shouldAnimate) triggerBadgeBump();
  };

  setHeaderCartCount(previousCartCount, { animate: false });

  if (headerCartCountNode) {
    headerCartCountNode.addEventListener('animationend', () => {
      headerCartCountNode.classList.remove('is-bump');
    });
  }

  const formatMoney = (cents, currency = 'USD') => {
    const amount = Number.isFinite(Number(cents)) ? Number(cents) : 0;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
      }).format(amount / 100);
    } catch (_) {
      return `${(amount / 100).toFixed(2)} ${currency}`;
    }
  };

  const escapeHtml = (value) => {
    const text = `${value == null ? '' : value}`;
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const normalizeStringArray = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => `${entry}`.trim())
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }

    return [];
  };

  const getAppliedDiscountCodes = (cart) => {
    const codes = [];

    if (cart && Array.isArray(cart.discount_codes)) {
      cart.discount_codes.forEach((entry) => {
        if (!entry) return;
        if (typeof entry === 'string') {
          const code = entry.trim();
          if (code) codes.push(code);
          return;
        }

        const code = `${entry.code || ''}`.trim();
        const applicable = entry.applicable !== false;
        if (code && applicable) codes.push(code);
      });
    }

    if (cart && Array.isArray(cart.cart_level_discount_applications)) {
      cart.cart_level_discount_applications.forEach((discount) => {
        const type = `${discount && discount.type ? discount.type : ''}`.toLowerCase();
        const title = `${discount && discount.title ? discount.title : ''}`.trim();
        if (title && type === 'discount_code') {
          codes.push(title);
        }
      });
    }

    if (cart && Array.isArray(cart.items)) {
      cart.items.forEach((item) => {
        if (!item || !Array.isArray(item.line_level_discount_allocations)) return;
        item.line_level_discount_allocations.forEach((allocation) => {
          const application = allocation && allocation.discount_application ? allocation.discount_application : null;
          const type = `${application && application.type ? application.type : ''}`.toLowerCase();
          const title = `${application && application.title ? application.title : ''}`.trim();
          if (title && type === 'discount_code') {
            codes.push(title);
          }
        });
      });
    }

    return [...new Set(codes)];
  };

  const getCartDiscountSummary = (cart, currency = 'USD') => {
    const originalSubtotalCents = Number.isFinite(Number(cart && cart.original_total_price))
      ? Number(cart.original_total_price)
      : Number(cart && cart.items_subtotal_price) || 0;
    const finalTotalCents = Number.isFinite(Number(cart && cart.total_price))
      ? Number(cart.total_price)
      : 0;
    const combinedSavingsCents = Math.max(0, originalSubtotalCents - finalTotalCents);
    const explicitDiscountCents = Number.isFinite(Number(cart && cart.total_discount))
      ? Math.max(0, Number(cart.total_discount))
      : 0;
    const discountAmountCents = Math.max(combinedSavingsCents, explicitDiscountCents);
    const hasDiscount = discountAmountCents > 0;

    const appliedCodes = getAppliedDiscountCodes(cart || {});
    const applications = Array.isArray(cart && cart.cart_level_discount_applications)
      ? cart.cart_level_discount_applications
      : [];
    let code = `${appliedCodes[0] || ''}`.trim();

    // If no manual discount code is active, use the first active cart discount title
    // (automatic discounts included) instead of falling back to a generic label.
    if (!code) {
      for (const application of applications) {
        if (!application || typeof application !== 'object') continue;
        const title = `${application.title || ''}`.trim();
        if (title) {
          code = title;
          break;
        }
      }
    }

    if (!code && cart && Array.isArray(cart.items)) {
      for (const item of cart.items) {
        if (!item || !Array.isArray(item.line_level_discount_allocations)) continue;
        for (const allocation of item.line_level_discount_allocations) {
          const application =
            allocation && allocation.discount_application ? allocation.discount_application : null;
          const title = `${application && application.title ? application.title : ''}`.trim();
          if (title) {
            code = title;
            break;
          }
        }
        if (code) break;
      }
    }

    if (!code) code = 'DISCOUNT';
    code = code.toUpperCase();

    let percentage = null;
    for (const application of applications) {
      if (!application || typeof application !== 'object') continue;
      const title = `${application.title || ''}`.trim().toUpperCase();
      const appType = `${application.type || ''}`.trim().toLowerCase();
      const isMatch = title === code || (!title && appType === 'discount_code') || appType === 'discount_code';
      if (!isMatch) continue;
      const valueType = `${application.value_type || ''}`.trim().toLowerCase();
      if (valueType === 'percentage') {
        const value = Number(application.value);
        if (Number.isFinite(value)) {
          percentage = Math.round(value);
          break;
        }
      }
    }

    if (!Number.isFinite(percentage)) {
      if (originalSubtotalCents > 0 && explicitDiscountCents > 0) {
        percentage = Math.round((explicitDiscountCents / originalSubtotalCents) * 100);
      }
    }

    const text = Number.isFinite(percentage)
      ? `${code} (${percentage}% OFF)`
      : code;

    return {
      hasDiscount,
      amountCents: discountAmountCents,
      amountText: `-${formatMoney(discountAmountCents, currency)}`,
      text,
    };
  };

  const getItemVariantTitle = (item) => {
    if (!item) return '';
    const value = `${item.variant_title || ''}`.trim();
    if (!value || value === 'Default Title') return '';
    return value;
  };

  const getItemImageUrl = (item) => {
    if (item && item.featured_image && typeof item.featured_image.url === 'string') {
      return item.featured_image.url;
    }

    if (item && typeof item.image === 'string' && item.image.trim() !== '') {
      return item.image;
    }

    return '';
  };

  const setShimmerValue = (node, value = '') => {
    if (!(node instanceof HTMLElement)) return;
    node.setAttribute('data-shimmer-value', `${value == null ? '' : value}`);
  };

  const startTextShimmer = (node) => {
    if (!(node instanceof HTMLElement)) return;
    setShimmerValue(node, `${node.textContent || ''}`.trim());
    node.setAttribute('shimmer', '');
  };

  const resetTextShimmer = (container = document.body) => {
    if (!(container instanceof Element || container instanceof Document || container instanceof DocumentFragment)) {
      return;
    }
    container.querySelectorAll('[shimmer]').forEach((node) => {
      if (node instanceof HTMLElement) node.removeAttribute('shimmer');
    });
  };

  const CART_ICON_PLUS_SVG =
    '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.3571 22.6429H0V17.3571H17.3571V0H22.6429V17.3571H40V22.6429H22.6429V40H17.3571V22.6429Z" fill="white"/></svg>';
  const CART_ICON_MINUS_SVG =
    '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 23.1429V17.8571H40V23.1429H0Z" fill="white"/></svg>';
  const CART_ICON_REMOVE_SVG =
    '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.5555 40C7.44439 40 6.48143 39.6111 5.66661 38.8333C4.8518 38.0185 4.44439 37.0556 4.44439 35.9444V6.11111H2.22217V2.05556H13.1111V0H26.8888V2.05556H37.7777V6.11111H35.5555V35.9444C35.5555 37.0556 35.1481 38.0185 34.3333 38.8333C33.5185 39.6111 32.5555 40 31.4444 40H8.5555ZM13.4444 31.3889H17.5555V10.6667H13.4444V31.3889ZM22.4444 31.3889H26.5555V10.6667H22.4444V31.3889Z" fill="white"/></svg>';
  const CART_ICON_CANCEL_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.4964 16L0 14.5036L6.53237 8L0 1.4964L1.4964 0L8 6.53237L14.5036 0L16 1.4964L9.46763 8L16 14.5036L14.5036 16L8 9.46763L1.4964 16Z" fill="white"/></svg>';

  const dispatchCartEvents = (cart, source = 'unknown', itemCount = 0) => {
    const detail = {
      cart,
      source,
      itemCount,
    };

    document.dispatchEvent(new CustomEvent(EVENTS.cartChanged, { detail }));
    document.dispatchEvent(new CustomEvent('cart:updated', { detail }));
    document.dispatchEvent(
      new CustomEvent('cart:update', {
        bubbles: true,
        detail: {
          resource: cart,
          sourceId: 'sb-cart-system',
          data: {
            source,
            itemCount,
          },
        },
      })
    );
  };

  let cachedCart = null;
  let fetchInFlight = null;
  const isCartLikePayload = (value) => {
    if (!value || typeof value !== 'object') return false;
    if (!Array.isArray(value.items)) return false;
    return Number.isFinite(Number(value.item_count));
  };

  const fetchCart = async () => {
    const response = await fetch(cartUrl('cart.js'), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error('Cart fetch failed');
    }

    return response.json();
  };

  const updateCartAndDispatch = (cart, source, { animateBadge = true, itemCount = 0 } = {}) => {
    cachedCart = cart;
    setHeaderCartCount(cart && cart.item_count ? cart.item_count : 0, { animate: animateBadge });
    dispatchCartEvents(cart, source, itemCount);
    return cart;
  };

  const refreshCart = async ({ source = 'refresh', animateBadge = false } = {}) => {
    if (fetchInFlight) {
      return fetchInFlight;
    }

    fetchInFlight = fetchCart()
      .then((cart) => updateCartAndDispatch(cart, source, { animateBadge }))
      .finally(() => {
        fetchInFlight = null;
      });

    return fetchInFlight;
  };

  const animateFlyToCart = ({ sourceElement, imageSrc }) => {
    if (!sourceElement || !imageSrc) return;

    const cartTrigger = document.querySelector('[data-header-cart-link]');
    if (!cartTrigger) return;

    const sourceRect = sourceElement.getBoundingClientRect();
    const targetRect = cartTrigger.getBoundingClientRect();

    if (!sourceRect.width || !sourceRect.height || !targetRect.width || !targetRect.height) {
      return;
    }

    const imageNode = document.createElement('img');
    imageNode.src = imageSrc;
    imageNode.alt = '';
    imageNode.setAttribute('aria-hidden', 'true');
    imageNode.style.position = 'fixed';
    imageNode.style.left = `${sourceRect.left + sourceRect.width / 2 - 24}px`;
    imageNode.style.top = `${sourceRect.top + sourceRect.height / 2 - 24}px`;
    imageNode.style.width = `${Math.max(48, Math.min(96, sourceRect.width * 0.35))}px`;
    imageNode.style.height = imageNode.style.width;
    imageNode.style.borderRadius = '999px';
    imageNode.style.objectFit = 'cover';
    imageNode.style.pointerEvents = 'none';
    imageNode.style.zIndex = '120';
    imageNode.style.boxShadow = '0 0 var(--sb-space-24) 0 var(--sb-color-always-black-25)';
    document.body.appendChild(imageNode);

    const deltaX = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
    const deltaY = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);

    const animation = imageNode.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
        {
          transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.2)`,
          opacity: 0.2,
        },
      ],
      {
        duration: 420,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      }
    );

    const cleanup = () => {
      imageNode.remove();
    };

    animation.addEventListener('finish', cleanup, { once: true });
    animation.addEventListener('cancel', cleanup, { once: true });
  };

  const addToCart = async (
    variantId,
    {
      quantity = 1,
      sourceElement = null,
      imageSrc = '',
    } = {}
  ) => {
    const variantIdValue = `${variantId || ''}`.trim();
    const normalizedQuantity = clampCount(quantity);

    if (!variantIdValue) {
      throw new Error('Invalid variant id');
    }

    if (normalizedQuantity <= 0) {
      throw new Error('Invalid quantity');
    }

    const formData = new FormData();
    formData.append('id', variantIdValue);
    formData.append('quantity', `${normalizedQuantity}`);

    const response = await fetch(cartUrl('cart/add.js'), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Add to cart failed: ${body || response.status}`);
    }

    const cart = await fetchCart();
    updateCartAndDispatch(cart, 'add', {
      animateBadge: true,
      itemCount: normalizedQuantity,
    });

    animateFlyToCart({ sourceElement, imageSrc });

    const drawer = document.querySelector('cart-drawer-component');
    if (drawer && typeof drawer.open === 'function') {
      drawer.open();
    }

    return cart;
  };

  const changeLine = async (line, quantity, { source = 'change', animateBadge = false } = {}) => {
    const normalizedLine = Number.parseInt(`${line}`, 10);
    const normalizedQuantity = clampCount(quantity);

    if (!Number.isFinite(normalizedLine) || normalizedLine <= 0) {
      throw new Error('Invalid line');
    }

    const response = await fetch(cartUrl('cart/change.js'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        line: normalizedLine,
        quantity: normalizedQuantity,
      }),
    });

    if (!response.ok) {
      throw new Error('Cart change failed');
    }

    const cart = await response.json();
    return updateCartAndDispatch(cart, source, {
      animateBadge,
      itemCount: cart.item_count || 0,
    });
  };

  const clearCart = async ({ source = 'clear' } = {}) => {
    const response = await fetch(cartUrl('cart/clear.js'), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error('Cart clear failed');
    }

    const cart = await fetchCart();
    return updateCartAndDispatch(cart, source, {
      animateBadge: false,
      itemCount: 0,
    });
  };

  const applyDiscount = async (discountCodes, { source = 'discount' } = {}) => {
    const normalizedCodes = normalizeStringArray(discountCodes);

    const response = await fetch(cartUrl('cart/update.js'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        discount: normalizedCodes.join(','),
      }),
    });

    if (!response.ok) {
      throw new Error('Cart discount update failed');
    }

    const cart = await response.json();
    return updateCartAndDispatch(cart, source, {
      animateBadge: false,
      itemCount: cart.item_count || 0,
    });
  };

  class CartDrawerComponent extends HTMLElement {
    connectedCallback() {
      this.drawer = this.querySelector('[data-cart-drawer]');
      this.panel = this.querySelector('[data-cart-drawer-panel]');
      this.closeControls = this.querySelectorAll('[data-cart-drawer-close]');
      this.trigger = document.querySelector('[data-header-cart-link]');
      this.historyAbortController = null;
      this.closeTimer = null;
      this.isCartPage = this.trigger
        ? this.trigger.dataset.headerCartPage === 'true'
        : isOnCartPage;

      if (!this.drawer || !this.panel) return;
      if (this.isCartPage) return;

      this.boundHandleTriggerClick = this.handleTriggerClick.bind(this);
      this.boundHandleCloseClick = this.handleCloseClick.bind(this);
      this.boundHandleEscape = this.handleEscape.bind(this);
      this.boundHandleCartChange = this.handleCartChange.bind(this);
      this.boundHandleResize = this.handleResize.bind(this);
      this.boundHandlePopState = this.handlePopState.bind(this);

      if (this.trigger) {
        this.trigger.addEventListener('click', this.boundHandleTriggerClick);
      }

      this.closeControls.forEach((node) => {
        node.addEventListener('click', this.boundHandleCloseClick);
      });

      document.addEventListener('keydown', this.boundHandleEscape);
      document.addEventListener(EVENTS.cartChanged, this.boundHandleCartChange);
      window.addEventListener('resize', this.boundHandleResize, { passive: true });
    }

    disconnectedCallback() {
      if (this.trigger && this.boundHandleTriggerClick) {
        this.trigger.removeEventListener('click', this.boundHandleTriggerClick);
      }

      if (this.closeControls && this.boundHandleCloseClick) {
        this.closeControls.forEach((node) => {
          node.removeEventListener('click', this.boundHandleCloseClick);
        });
      }

      if (this.boundHandleEscape) {
        document.removeEventListener('keydown', this.boundHandleEscape);
      }

      if (this.boundHandleCartChange) {
        document.removeEventListener(EVENTS.cartChanged, this.boundHandleCartChange);
      }

      if (this.boundHandleResize) {
        window.removeEventListener('resize', this.boundHandleResize);
      }

      this.teardownHistoryListener();

      if (this.closeTimer) {
        window.clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
    }

    get isOpen() {
      return this.drawer && !this.drawer.hasAttribute('hidden') && this.drawer.classList.contains(CART_OPEN_CLASS);
    }

    isMobileBreakpoint() {
      return window.matchMedia('(max-width: 989px)').matches;
    }

    handleTriggerClick(event) {
      if (this.isCartPage) return;
      if (event) event.preventDefault();
      if (this.isOpen) {
        this.close();
        return;
      }
      this.open();
    }

    handleCloseClick(event) {
      if (event) event.preventDefault();
      this.close();
    }

    handleEscape(event) {
      if (event.key !== 'Escape') return;
      if (!this.isOpen) return;
      this.close();
    }

    handleCartChange(event) {
      if (!event || !event.detail) return;
      if (event.detail.source === 'add' && this.hasAttribute('auto-open')) {
        this.open();
      }
      this.updateStickyState();
    }

    handleResize() {
      if (!this.isOpen) return;
      this.updateStickyState();
    }

    dispatchStateChange() {
      document.dispatchEvent(new CustomEvent(EVENTS.drawerState));
    }

    setupHistoryListener() {
      if (!this.isMobileBreakpoint()) return;

      if (!history.state || !history.state.sbCartDrawerOpen) {
        history.pushState({ ...(history.state || {}), sbCartDrawerOpen: true }, '');
      }

      this.historyAbortController = new AbortController();
      window.addEventListener('popstate', this.boundHandlePopState, {
        signal: this.historyAbortController.signal,
      });
    }

    teardownHistoryListener() {
      if (!this.historyAbortController) return;
      this.historyAbortController.abort();
      this.historyAbortController = null;
    }

    handlePopState() {
      if (!this.isOpen) return;
      this.close({ immediate: true, skipHistory: true });
    }

    open() {
      if (this.isCartPage) return;
      if (!this.drawer || !this.panel || this.isOpen) return;

      if (this.closeTimer) {
        window.clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }

      this.drawer.removeAttribute('hidden');
      window.requestAnimationFrame(() => {
        this.drawer.classList.add(CART_OPEN_CLASS);
        this.updateStickyState();
      });

      if (this.trigger) {
        this.trigger.setAttribute('aria-expanded', 'true');
      }

      this.setupHistoryListener();
      this.dispatchStateChange();

      this.querySelectorAll('cart-items-component').forEach((component) => {
        if (component && typeof component.hideDiscountError === 'function') {
          component.hideDiscountError();
        }
      });

      refreshCart({ source: 'drawer-open', animateBadge: false }).catch(() => {
        // no-op
      });
    }

    close({ immediate = false, skipHistory = false } = {}) {
      if (!this.drawer || this.drawer.hasAttribute('hidden')) return;

      this.drawer.classList.remove(CART_OPEN_CLASS);

      const finalizeClose = () => {
        if (!this.drawer) return;
        this.drawer.setAttribute('hidden', '');
        if (this.trigger) {
          this.trigger.setAttribute('aria-expanded', 'false');
        }
        this.dispatchStateChange();
      };

      if (this.closeTimer) {
        window.clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }

      if (immediate) {
        finalizeClose();
      } else {
        this.closeTimer = window.setTimeout(finalizeClose, 480);
      }

      this.teardownHistoryListener();

      if (!skipHistory && this.isMobileBreakpoint() && history.state && history.state.sbCartDrawerOpen) {
        history.back();
      }
    }

    updateStickyState() {
      if (!this.panel) return;

      const summary = this.panel.querySelector('[data-cart-summary]');
      if (!(summary instanceof HTMLElement) || summary.hidden) {
        this.panel.setAttribute('cart-summary-sticky', 'false');
        return;
      }

      const panelHeight = this.panel.getBoundingClientRect().height;
      const summaryHeight = summary.getBoundingClientRect().height;

      if (!panelHeight || !summaryHeight) {
        this.panel.setAttribute('cart-summary-sticky', 'false');
        return;
      }

      const ratio = summaryHeight / panelHeight;
      this.panel.setAttribute('cart-summary-sticky', ratio > 0.5 ? 'false' : 'true');
    }
  }

  class CartItemsComponent extends HTMLElement {
    connectedCallback() {
      this.context = this.dataset.context || 'drawer';
      this.pendingLines = new Set();
      this.renderedDiscountError = false;
      this.removalTimers = new Map();
      this.lastRenderedItemsSignature = '';
      this.messageScopeNode =
        this.context === 'drawer'
          ? this.closest('[data-cart-drawer-panel]') || this
          : this;

      this.statusNode = this.messageScopeNode.querySelector('[data-cart-status]');
      this.pageHeaderNode = this.messageScopeNode.querySelector('[data-cart-page-header]');
      this.emptyMessageNodes = this.messageScopeNode.querySelectorAll('[data-cart-empty-message]');
      this.filledMessageNodes = this.messageScopeNode.querySelectorAll('[data-cart-filled-message]');
      this.itemListNode = this.querySelector('[data-cart-item-list]');
      this.emptyNode = this.querySelector('[data-cart-empty]');
      this.summaryNode = this.querySelector('[data-cart-summary]');
      this.summaryDividerNode = this.querySelector('[data-cart-summary-divider]');
      this.subtotalNode = this.querySelector('[data-cart-subtotal]');
      this.totalNode = this.querySelector('[data-cart-total]');
      this.discountForm = this.querySelector('[data-cart-discount-form]');
      this.discountInput = this.querySelector('[data-cart-discount-input]');
      this.discountListNode = this.querySelector('[data-cart-discount-list]');
      this.discountErrorNode = this.querySelector('[data-cart-discount-error]');
      this.discountErrorTextNode = this.querySelector('[data-cart-discount-error-text]');
      this.discountErrorIconNode = this.querySelector('[data-cart-discount-error-icon]');
      this.discountCodeErrorMessage =
        (this.discountErrorNode && this.discountErrorNode.dataset.discountCodeError) ||
        'Discount code cannot be applied to your cart';
      this.shippingDiscountErrorMessage =
        (this.discountErrorNode && this.discountErrorNode.dataset.shippingDiscountError) ||
        'Shipping discounts are shown at checkout after adding an address';
      this.autoDiscountRowNode = this.querySelector('[data-cart-auto-discount-row]');
      this.autoDiscountTextNode = this.querySelector('[data-cart-auto-discount-text]');
      this.autoDiscountAmountNode = this.querySelector('[data-cart-auto-discount-amount]');
      this.autoDiscountDividerNode = this.querySelector('[data-cart-auto-discount-divider]');
      this.drawerCountNode = this.messageScopeNode.querySelector('[data-cart-drawer-count]');
      this.pageCountNode = this.messageScopeNode.querySelector('[data-cart-page-count]');
      this.freeShippingNode = this.messageScopeNode.querySelector('[data-cart-free-shipping]');
      this.freeShippingMessageNode = this.messageScopeNode.querySelector('[data-cart-free-shipping-message]');
      this.freeShippingIntroFillNode = this.messageScopeNode.querySelector('[data-cart-free-shipping-intro-fill]');
      this.freeShippingOutroFillNode = this.messageScopeNode.querySelector('[data-cart-free-shipping-outro-fill]');
      this.checkoutButtons = this.querySelectorAll('[data-cart-checkout-button]');
      this.clearButtons = this.querySelectorAll('[data-cart-clear]');
      this.placeholderImage = this.dataset.placeholderImage || '';

      this.boundHandleCartChanged = this.handleCartChanged.bind(this);
      this.boundHandleClick = this.handleClick.bind(this);
      this.boundHandleChange = this.handleChange.bind(this);
      this.boundHandleSubmit = this.handleSubmit.bind(this);

      document.addEventListener(EVENTS.cartChanged, this.boundHandleCartChanged);
      this.addEventListener('click', this.boundHandleClick);
      this.addEventListener('change', this.boundHandleChange);
      this.addEventListener('submit', this.boundHandleSubmit);

      if (cachedCart) {
        this.render(cachedCart);
      }
    }

    disconnectedCallback() {
      if (this.boundHandleCartChanged) {
        document.removeEventListener(EVENTS.cartChanged, this.boundHandleCartChanged);
      }
      if (this.boundHandleClick) {
        this.removeEventListener('click', this.boundHandleClick);
      }
      if (this.boundHandleChange) {
        this.removeEventListener('change', this.boundHandleChange);
      }
      if (this.boundHandleSubmit) {
        this.removeEventListener('submit', this.boundHandleSubmit);
      }

      this.removalTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      this.removalTimers.clear();
    }

    handleCartChanged(event) {
      if (!event || !event.detail || !event.detail.cart) return;
      this.render(event.detail.cart);
    }

    handleClick(event) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const removeButton = target.closest('[data-cart-remove]');
      if (removeButton) {
        event.preventDefault();
        const line = this.getLineFromNode(removeButton);
        if (!line) return;
        const row = removeButton.closest('[data-cart-line]');
        this.removeLine(line, row);
        return;
      }

      const minusButton = target.closest('[data-cart-qty-minus]');
      if (minusButton) {
        event.preventDefault();
        const line = this.getLineFromNode(minusButton);
        if (!line) return;
        const input = this.querySelector(`[data-cart-line="${line}"] [data-cart-qty-input]`);
        if (!(input instanceof HTMLInputElement)) return;
        const currentValue = Math.max(1, clampCount(input.value));
        if (currentValue <= 1) return;
        const nextValue = currentValue - 1;
        this.updateLine(line, nextValue);
        return;
      }

      const plusButton = target.closest('[data-cart-qty-plus]');
      if (plusButton) {
        event.preventDefault();
        const line = this.getLineFromNode(plusButton);
        if (!line) return;
        const input = this.querySelector(`[data-cart-line="${line}"] [data-cart-qty-input]`);
        if (!(input instanceof HTMLInputElement)) return;
        const currentValue = clampCount(input.value);
        this.updateLine(line, currentValue + 1);
        return;
      }

      const discountRemoveButton = target.closest('[data-cart-discount-remove]');
      if (discountRemoveButton) {
        event.preventDefault();
        const code = `${discountRemoveButton.getAttribute('data-cart-discount-remove') || ''}`.trim();
        this.removeDiscount(code);
        return;
      }

      const clearButton = target.closest('[data-cart-clear]');
      if (clearButton) {
        event.preventDefault();
        clearCart({ source: `${this.context}-clear` }).catch(() => {
          this.showStatus('Unable to clear cart.');
        });
      }
    }

    handleChange(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.matches('[data-cart-qty-input]')) return;

      const line = this.getLineFromNode(target);
      if (!line) return;

      const nextValue = Math.max(1, clampCount(target.value));
      target.value = `${nextValue}`;
      this.updateLine(line, nextValue);
    }

    handleSubmit(event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.matches('[data-cart-discount-form]')) return;

      event.preventDefault();

      if (!(this.discountInput instanceof HTMLInputElement)) return;

      const nextCode = this.discountInput.value.trim().toUpperCase();
      if (!nextCode) return;
      this.discountInput.value = nextCode;

      const existingCodes = getAppliedDiscountCodes(cachedCart || {});
      const normalizedExisting = new Set(existingCodes.map((code) => code.toLowerCase()));

      if (normalizedExisting.has(nextCode.toLowerCase())) {
        this.discountInput.value = '';
        this.hideDiscountError();
        return;
      }

      const nextCodes = [...existingCodes, nextCode];
      applyDiscount(nextCodes, { source: `${this.context}-discount-add` })
        .then((cart) => {
          const appliedCodes = getAppliedDiscountCodes(cart).map((code) => code.toLowerCase());
          if (!appliedCodes.includes(nextCode.toLowerCase())) {
            const discountCodes = Array.isArray(cart && cart.discount_codes) ? cart.discount_codes : [];
            const attemptedCode = nextCode.toLowerCase();
            const attemptedEntry = discountCodes.find((entry) => {
              if (!entry || typeof entry !== 'object') return false;
              const code = `${entry.code || ''}`.trim().toLowerCase();
              return code === attemptedCode;
            });
            if (attemptedEntry && attemptedEntry.applicable === true) {
              this.showDiscountError(this.shippingDiscountErrorMessage);
            } else {
              this.showDiscountError(this.discountCodeErrorMessage);
            }
            return;
          }

          this.discountInput.value = '';
          this.hideDiscountError();
        })
        .catch(() => {
          this.showDiscountError(this.discountCodeErrorMessage);
        });
    }

    getLineFromNode(node) {
      const row = node.closest('[data-cart-line]');
      if (!row) return 0;
      return Number.parseInt(`${row.getAttribute('data-cart-line') || ''}`, 10);
    }

    setLinePending(line, pending) {
      if (pending) {
        this.pendingLines.add(line);
      } else {
        this.pendingLines.delete(line);
      }

      const row = this.querySelector(`[data-cart-line="${line}"]`);
      if (!(row instanceof HTMLElement)) return;
      row.classList.toggle('is-updating', pending);

      row.querySelectorAll('button, input').forEach((control) => {
        if (!(control instanceof HTMLButtonElement || control instanceof HTMLInputElement)) return;
        control.disabled = pending;
      });
    }

    updateLine(line, quantity) {
      if (this.pendingLines.has(line)) return;

      this.setLinePending(line, true);
      hideAnyDiscountError(this);
      this.startPriceShimmer(line);

      changeLine(line, quantity, {
        source: `${this.context}-line-change`,
      }).catch(() => {
        this.stopPriceShimmer();
        this.showStatus('Unable to update quantity.');
      }).finally(() => {
        this.stopPriceShimmer();
        this.setLinePending(line, false);
      });
    }

    startPriceShimmer(line) {
      const row = this.querySelector(`[data-cart-line="${line}"]`);
      if (row instanceof HTMLElement) {
        row.querySelectorAll('[data-cart-line-price], [data-cart-line-discount-price]').forEach((node) => {
          startTextShimmer(node);
        });
      }

      startTextShimmer(this.subtotalNode);
      startTextShimmer(this.totalNode);
      startTextShimmer(this.autoDiscountAmountNode);
    }

    stopPriceShimmer() {
      resetTextShimmer(this);
    }

    removeLine(line, rowNode) {
      if (this.pendingLines.has(line)) return;

      this.setLinePending(line, true);
      hideAnyDiscountError(this);
      this.startPriceShimmer(line);

      const row = rowNode instanceof HTMLElement ? rowNode : this.querySelector(`[data-cart-line="${line}"]`);
      if (row instanceof HTMLElement) {
        row.style.setProperty('--sb-cart-row-height', `${row.offsetHeight}px`);
        row.classList.add('is-removing');
      }

      const clearRemovalState = () => {
        if (!(row instanceof HTMLElement)) return;
        row.classList.remove('is-removing');
        row.style.removeProperty('--sb-cart-row-height');
      };

      const timerId = window.setTimeout(() => {
        this.removalTimers.delete(line);
        changeLine(line, 0, {
          source: `${this.context}-line-remove`,
        })
          .catch(() => {
            this.stopPriceShimmer();
            clearRemovalState();
            this.showStatus('Unable to remove item.');
          })
          .finally(() => {
            this.stopPriceShimmer();
            this.setLinePending(line, false);
          });
      }, CART_ROW_REMOVE_DELAY);

      this.removalTimers.set(line, timerId);

      if (row instanceof HTMLElement) {
        window.setTimeout(() => {
          if (!this.removalTimers.has(line)) return;
          clearRemovalState();
        }, CART_ROW_REMOVE_FALLBACK);
      }
    }

    removeDiscount(code) {
      const nextCode = `${code || ''}`.trim();
      if (!nextCode) return;

      const existingCodes = getAppliedDiscountCodes(cachedCart || {});
      const normalizedToRemove = nextCode.toLowerCase();
      const filteredCodes = existingCodes.filter((entry) => entry.toLowerCase() !== normalizedToRemove);

      applyDiscount(filteredCodes, { source: `${this.context}-discount-remove` }).catch(() => {
        this.showDiscountError(this.discountCodeErrorMessage);
      });
    }

    render(cart) {
      const itemCount = clampCount(cart && cart.item_count ? cart.item_count : 0);
      const isEmpty = itemCount === 0;
      const currency = `${cart && cart.currency ? cart.currency : 'USD'}`;
      const wasEmpty = this.classList.contains('is-empty');
      const shouldAnimateToEmpty = !wasEmpty && isEmpty;

      const applyRenderState = () => {
        this.classList.toggle('is-empty', isEmpty);

        if (this.statusNode) {
          this.statusNode.hidden = true;
          this.statusNode.textContent = '';
        }

        if (this.pageHeaderNode) {
          this.pageHeaderNode.hidden = isEmpty;
        }

        this.emptyMessageNodes.forEach((node) => {
          node.hidden = !isEmpty;
        });

        this.filledMessageNodes.forEach((node) => {
          node.hidden = isEmpty;
        });

        if (this.drawerCountNode) {
          if (isEmpty) {
            this.drawerCountNode.textContent = '';
            this.drawerCountNode.hidden = true;
          } else {
            this.drawerCountNode.textContent = itemCount > 99 ? '99+' : `${itemCount}`;
            this.drawerCountNode.hidden = false;
          }
        }

        if (this.pageCountNode) {
          if (isEmpty) {
            this.pageCountNode.textContent = '';
            this.pageCountNode.hidden = true;
          } else {
            this.pageCountNode.textContent = `${itemCount}`;
            this.pageCountNode.hidden = false;
          }
        }

        if (this.emptyNode) {
          this.emptyNode.hidden = !isEmpty;
        }

        if (this.itemListNode) {
          this.itemListNode.hidden = isEmpty;
        }

        if (this.summaryNode) {
          this.summaryNode.hidden = isEmpty;
        }

        if (this.summaryDividerNode) {
          this.summaryDividerNode.hidden = isEmpty;
        }

        this.checkoutButtons.forEach((button) => {
          button.toggleAttribute('aria-disabled', isEmpty);
          if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) {
            button.disabled = isEmpty;
          }
        });

        this.clearButtons.forEach((button) => {
          if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) {
            button.disabled = isEmpty;
          }
        });

        if (this.subtotalNode) {
          const subtotalCents = Number.isFinite(Number(cart && cart.original_total_price))
            ? Number(cart.original_total_price)
            : (cart && cart.items_subtotal_price ? cart.items_subtotal_price : 0);
          const subtotalText = formatMoney(
            subtotalCents,
            currency
          );
          this.subtotalNode.textContent = subtotalText;
          setShimmerValue(this.subtotalNode, subtotalText);
        }

        if (this.totalNode) {
          const totalText = formatMoney(
            cart && cart.total_price ? cart.total_price : 0,
            currency
          );
          this.totalNode.textContent = totalText;
          setShimmerValue(this.totalNode, totalText);
        }

        this.renderFreeShipping(cart || {}, currency, isEmpty);
        this.renderDiscounts(cart || {}, currency);
        this.renderItems(cart || {}, currency);

        const drawer = this.closest('cart-drawer-component');
        if (drawer && typeof drawer.updateStickyState === 'function') {
          drawer.updateStickyState();
        }
      };

      if (shouldAnimateToEmpty) {
        const transitionType = this.context === 'drawer' ? 'empty-cart-drawer' : 'empty-cart-page';
        startViewTransition(applyRenderState, [transitionType]);
        return;
      }

      applyRenderState();
    }

    renderDiscounts(cart, currency = 'USD') {
      const summary = getCartDiscountSummary(cart || {}, currency);

      if (this.autoDiscountRowNode) {
        this.autoDiscountRowNode.hidden = !summary.hasDiscount;
      }

      if (this.autoDiscountDividerNode) {
        this.autoDiscountDividerNode.hidden = !summary.hasDiscount;
      }

      if (this.autoDiscountTextNode) {
        this.autoDiscountTextNode.textContent = summary.text;
      }

      if (this.autoDiscountAmountNode) {
        this.autoDiscountAmountNode.textContent = summary.amountText;
        setShimmerValue(this.autoDiscountAmountNode, summary.amountText);
      }

      if (!this.discountListNode) return;

      const discountCodes = getAppliedDiscountCodes(cart);
      const fragment = document.createDocumentFragment();

      discountCodes.forEach((code) => {
        const codeUpper = `${code || ''}`.trim().toUpperCase();
        const item = document.createElement('li');
        item.className = 'sb-cart-discount-pill font-caption weight-bold';
        item.innerHTML = `
          <span>${escapeHtml(codeUpper)}</span>
          <button type="button" class="sb-cart-discount-pill__remove" data-cart-discount-remove="${escapeHtml(
            codeUpper
          )}" aria-label="Remove ${escapeHtml(codeUpper)}">
            <span class="sb-cart-discount-pill__remove-icon" aria-hidden="true">${CART_ICON_CANCEL_SVG}</span>
          </button>
        `;
        fragment.appendChild(item);
      });

      this.discountListNode.innerHTML = '';
      this.discountListNode.appendChild(fragment);
    }

    renderItems(cart, currency) {
      if (!this.itemListNode) return;

      const items = Array.isArray(cart.items) ? cart.items : [];
      const nextItemsSignature = items
        .map((item) => {
          const key = `${item && item.key ? item.key : ''}`;
          const quantity = clampCount(item && item.quantity ? item.quantity : 0);
          const image = `${getItemImageUrl(item) || this.placeholderImage}`;
          return [key, quantity, image].join('|');
        })
        .join('||');

      // Prevent unnecessary full list re-renders (image flash) when only price state changes.
      // For discount changes we patch line-item prices in place.
      if (nextItemsSignature === this.lastRenderedItemsSignature) {
        items.forEach((item, index) => {
          const line = index + 1;
          const row = this.itemListNode.querySelector(`[data-cart-line="${line}"]`);
          if (!(row instanceof HTMLElement)) return;

          const originalLinePriceCents = Number.isFinite(Number(item.original_line_price))
            ? Number(item.original_line_price)
            : 0;
          const finalLinePriceCents = Number.isFinite(Number(item.final_line_price))
            ? Number(item.final_line_price)
            : 0;
          const hasDiscount = originalLinePriceCents > finalLinePriceCents;
          const regularLinePrice = formatMoney(hasDiscount ? originalLinePriceCents : finalLinePriceCents, currency);
          const discountedLinePrice = hasDiscount ? formatMoney(finalLinePriceCents, currency) : '';

          const priceGroup = row.querySelector('.sb-cart-line__price-group');
          if (!(priceGroup instanceof HTMLElement)) return;

          priceGroup.innerHTML = `
            <p
              class="sb-cart-line__price sb-cart-shimmer-text font-caption weight-regular"
              data-cart-line-price
              data-shimmer-value="${escapeHtml(regularLinePrice)}"
            >
              ${escapeHtml(regularLinePrice)}
            </p>
            ${
              hasDiscount
                ? `<p
                    class="sb-cart-line__discount-price sb-cart-shimmer-text font-caption weight-regular"
                    data-cart-line-discount-price
                    data-shimmer-value="${escapeHtml(discountedLinePrice)}"
                  >${escapeHtml(discountedLinePrice)}</p>`
                : ''
            }
          `;
        });
        return;
      }

      const fragment = document.createDocumentFragment();

      items.forEach((item, index) => {
        const line = index + 1;
        const lineItem = document.createElement('li');
        lineItem.className = 'sb-cart-line';
        lineItem.setAttribute('data-cart-line', `${line}`);

        const title = escapeHtml(item.product_title || item.title || 'Product');
        const productUrl = escapeHtml(item.url || '#');
        const variantTitle = escapeHtml(getItemVariantTitle(item));
        const imageUrl = escapeHtml(getItemImageUrl(item) || this.placeholderImage);
        const quantity = clampCount(item.quantity || 0);
        const effectiveQuantity = Math.max(1, quantity);
        const originalLinePriceCents = Number.isFinite(Number(item.original_line_price))
          ? Number(item.original_line_price)
          : 0;
        const finalLinePriceCents = Number.isFinite(Number(item.final_line_price))
          ? Number(item.final_line_price)
          : 0;
        const hasDiscount = originalLinePriceCents > finalLinePriceCents;
        const regularLinePrice = formatMoney(hasDiscount ? originalLinePriceCents : finalLinePriceCents, currency);
        const discountedLinePrice = hasDiscount ? formatMoney(finalLinePriceCents, currency) : '';
        const minusButtonAttributes = effectiveQuantity <= 1 ? 'disabled aria-disabled="true"' : '';

        lineItem.innerHTML = `
          <a class="sb-cart-line__media" href="${productUrl}">
            <img class="sb-cart-line__image" src="${imageUrl}" alt="${title}" loading="eager" width="128" height="128">
          </a>
          <div class="sb-cart-line__content">
            <div class="sb-cart-line__meta">
              <a class="sb-cart-line__title font-caption weight-bold" href="${productUrl}">${title}</a>
              ${
                variantTitle
                  ? `<p class="sb-cart-line__variant font-caption weight-regular">${variantTitle}</p>`
                  : ''
              }
              <div class="sb-cart-line__price-group">
                <p
                  class="sb-cart-line__price sb-cart-shimmer-text font-caption weight-regular"
                  data-cart-line-price
                  data-shimmer-value="${escapeHtml(regularLinePrice)}"
                >
                  ${escapeHtml(regularLinePrice)}
                </p>
                ${
                  hasDiscount
                    ? `<p
                        class="sb-cart-line__discount-price sb-cart-shimmer-text font-caption weight-regular"
                        data-cart-line-discount-price
                        data-shimmer-value="${escapeHtml(discountedLinePrice)}"
                      >${escapeHtml(discountedLinePrice)}</p>`
                    : ''
                }
              </div>
            </div>
            <div class="sb-cart-line__controls">
              <div class="sb-cart-quantity" role="group" aria-label="Quantity">
                <button
                  type="button"
                  class="sb-cart-quantity__button"
                  data-cart-qty-minus
                  aria-label="Decrease quantity"
                  ${minusButtonAttributes}
                >
                  <span class="sb-cart-quantity__icon sb-cart-quantity__icon--minus" aria-hidden="true">${CART_ICON_MINUS_SVG}</span>
                </button>
                <input
                  class="sb-cart-quantity__input font-caption weight-bold"
                  data-cart-qty-input
                  type="number"
                  min="1"
                  step="1"
                  inputmode="numeric"
                  value="${effectiveQuantity}"
                  aria-label="Quantity"
                >
                <button type="button" class="sb-cart-quantity__button" data-cart-qty-plus aria-label="Increase quantity">
                  <span class="sb-cart-quantity__icon sb-cart-quantity__icon--plus" aria-hidden="true">${CART_ICON_PLUS_SVG}</span>
                </button>
              </div>
              <button type="button" class="sb-cart-line__remove" data-cart-remove aria-label="Remove item">
                <span class="sb-cart-line__remove-icon" aria-hidden="true">${CART_ICON_REMOVE_SVG}</span>
              </button>
            </div>
          </div>
        `;

        if (this.pendingLines.has(line)) {
          lineItem.classList.add('is-updating');
          lineItem.querySelectorAll('button, input').forEach((control) => {
            if (
              control instanceof HTMLButtonElement ||
              control instanceof HTMLInputElement
            ) {
              control.disabled = true;
            }
          });
        }

        fragment.appendChild(lineItem);
      });

      this.itemListNode.innerHTML = '';
      this.itemListNode.appendChild(fragment);
      this.lastRenderedItemsSignature = nextItemsSignature;
    }

    renderFreeShipping(cart, currency, isEmpty) {
      if (!this.freeShippingNode) return;
      if (isEmpty) {
        this.freeShippingNode.hidden = true;
        return;
      }

      const isAvailable = `${this.freeShippingNode.dataset.freeShippingAvailable || ''}`.toLowerCase() === 'true';
      const thresholdCents = Number.parseInt(`${this.freeShippingNode.dataset.freeShippingThresholdCents || '0'}`, 10);
      const subtotalCents = Number(cart && Number.isFinite(Number(cart.total_price)) ? cart.total_price : 0);
      const shouldShow = isAvailable && Number.isFinite(thresholdCents) && thresholdCents > 0;

      if (!shouldShow) {
        this.freeShippingNode.hidden = true;
        return;
      }

      const remainingCents = Math.max(0, thresholdCents - subtotalCents);
      const reached = remainingCents <= 0;
      const progressPercent = Math.max(0, Math.min(100, (subtotalCents / thresholdCents) * 100));

      if (this.freeShippingMessageNode) {
        if (reached) {
          this.freeShippingMessageNode.innerHTML = "🥳 You've unlocked <strong>free shipping</strong>.";
        } else {
          this.freeShippingMessageNode.innerHTML = `👉 You're only <strong>${escapeHtml(
            formatMoney(remainingCents, currency)
          )}</strong> away from <strong>free shipping</strong>.`;
        }
      }

      if (this.freeShippingIntroFillNode) {
        this.freeShippingIntroFillNode.style.width = `${progressPercent}%`;
        this.freeShippingIntroFillNode.classList.toggle('is-reached', reached);
      }

      if (this.freeShippingOutroFillNode) {
        this.freeShippingOutroFillNode.style.width = reached ? '100%' : '0';
        this.freeShippingOutroFillNode.classList.toggle('is-reached', reached);
      }

      this.freeShippingNode.classList.toggle('is-reached', reached);
      this.freeShippingNode.hidden = false;
    }

    showStatus(message) {
      if (!this.statusNode) return;
      this.statusNode.textContent = message;
    }

    showDiscountError(message) {
      if (!this.discountErrorNode) return;
      const normalizedMessage = `${message || ''}`.trim();
      if (!normalizedMessage) {
        this.hideDiscountError();
        return;
      }
      if (this.discountErrorTextNode) {
        this.discountErrorTextNode.textContent = normalizedMessage;
      } else {
        this.discountErrorNode.textContent = normalizedMessage;
      }
      if (this.discountErrorIconNode) {
        this.discountErrorIconNode.hidden = false;
      }
      this.discountErrorNode.hidden = false;
      this.renderedDiscountError = true;
    }

    hideDiscountError() {
      if (!this.discountErrorNode) return;
      this.discountErrorNode.hidden = true;
      if (this.discountErrorIconNode) {
        this.discountErrorIconNode.hidden = true;
      }
      if (this.discountErrorTextNode) {
        this.discountErrorTextNode.textContent = '';
      } else {
        this.discountErrorNode.textContent = '';
      }
      this.renderedDiscountError = false;
    }
  }

  const hideAnyDiscountError = (component) => {
    if (!(component instanceof CartItemsComponent)) return;
    if (!component.renderedDiscountError) return;
    component.hideDiscountError();
  };

  if (!customElements.get('cart-drawer-component')) {
    customElements.define('cart-drawer-component', CartDrawerComponent);
  }

  if (!customElements.get('cart-items-component')) {
    customElements.define('cart-items-component', CartItemsComponent);
  }

  window.SBCart = {
    ...(window.SBCart || {}),
    fetch: fetchCart,
    refresh: refreshCart,
    add: addToCart,
    clear: clearCart,
    changeLine,
    applyDiscount,
    getCart: () => cachedCart,
    open: () => {
      if (isOnCartPage) return;
      const drawer = document.querySelector('cart-drawer-component');
      if (drawer && typeof drawer.open === 'function') {
        drawer.open();
      }
    },
    close: () => {
      const drawer = document.querySelector('cart-drawer-component');
      if (drawer && typeof drawer.close === 'function') {
        drawer.close();
      }
    },
  };

  document.addEventListener('cart:update', (event) => {
    const detail = event && event.detail ? event.detail : null;
    if (detail && detail.sourceId === 'sb-cart-system') return;

    if (detail && detail.resource && isCartLikePayload(detail.resource)) {
      const source = detail.data && detail.data.source ? detail.data.source : 'external';
      updateCartAndDispatch(detail.resource, source, {
        animateBadge: false,
        itemCount: detail.data && Number.isFinite(Number(detail.data.itemCount)) ? Number(detail.data.itemCount) : 0,
      });
      const drawer = document.querySelector('cart-drawer-component');
      if (!isOnCartPage && drawer && typeof drawer.open === 'function' && source !== 'header-cart') {
        drawer.open();
      }
      return;
    }

    refreshCart({ source: 'external', animateBadge: false }).catch(() => {
      // no-op
    });
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (event.defaultPrevented) return;

    const action = `${form.getAttribute('action') || ''}`.trim();
    if (!action) return;
    if (!/\/cart\/add(?:\.js)?(?:\?|$)/.test(action)) return;
    if (form.hasAttribute('data-no-ajax-cart-add')) return;

    event.preventDefault();

    const formData = new FormData(form);
    const variantId = `${formData.get('id') || ''}`.trim();
    const quantityRaw = `${formData.get('quantity') || '1'}`.trim();
    const quantity = clampCount(quantityRaw || 1) || 1;

    if (!variantId) return;

    const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
    if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
      submitter.disabled = true;
    }

    addToCart(variantId, {
      quantity,
      sourceElement: submitter || form,
    })
      .catch(() => {
        // no-op
      })
      .finally(() => {
        if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
          submitter.disabled = false;
        }
      });
  });

  refreshCart({ source: 'initial', animateBadge: false }).catch(() => {
    // no-op
  });
})();
