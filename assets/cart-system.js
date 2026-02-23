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

    if (codes.length > 0) {
      return [...new Set(codes)];
    }

    if (cart && Array.isArray(cart.cart_level_discount_applications)) {
      cart.cart_level_discount_applications.forEach((discount) => {
        const type = `${discount && discount.type ? discount.type : ''}`.toLowerCase();
        const title = `${discount && discount.title ? discount.title : ''}`.trim();
        if (title && (type === 'discount_code' || !type)) {
          codes.push(title);
        }
      });
    }

    return [...new Set(codes)];
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
      this.subtotalNode = this.querySelector('[data-cart-subtotal]');
      this.totalNode = this.querySelector('[data-cart-total]');
      this.discountForm = this.querySelector('[data-cart-discount-form]');
      this.discountInput = this.querySelector('[data-cart-discount-input]');
      this.discountListNode = this.querySelector('[data-cart-discount-list]');
      this.discountErrorNode = this.querySelector('[data-cart-discount-error]');
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
        const nextValue = Math.max(0, clampCount(input.value) - 1);
        if (nextValue === 0) {
          const row = minusButton.closest('[data-cart-line]');
          this.removeLine(line, row);
          return;
        }
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

      const nextValue = clampCount(target.value);
      if (nextValue <= 0) {
        const row = target.closest('[data-cart-line]');
        this.removeLine(line, row);
        return;
      }

      this.updateLine(line, nextValue);
    }

    handleSubmit(event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.matches('[data-cart-discount-form]')) return;

      event.preventDefault();

      if (!(this.discountInput instanceof HTMLInputElement)) return;

      const nextCode = this.discountInput.value.trim();
      if (!nextCode) return;

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
            this.showDiscountError('Discount code could not be applied.');
            return;
          }

          this.discountInput.value = '';
          this.hideDiscountError();
        })
        .catch(() => {
          this.showDiscountError('Discount code could not be applied.');
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

      changeLine(line, quantity, {
        source: `${this.context}-line-change`,
      }).catch(() => {
        this.showStatus('Unable to update quantity.');
      }).finally(() => {
        this.setLinePending(line, false);
      });
    }

    removeLine(line, rowNode) {
      if (this.pendingLines.has(line)) return;

      this.setLinePending(line, true);

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
            clearRemovalState();
            this.showStatus('Unable to remove item.');
          })
          .finally(() => {
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
        this.showDiscountError('Discount code could not be removed.');
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
          this.subtotalNode.textContent = formatMoney(
            cart && cart.items_subtotal_price ? cart.items_subtotal_price : 0,
            currency
          );
        }

        if (this.totalNode) {
          this.totalNode.textContent = formatMoney(
            cart && cart.total_price ? cart.total_price : 0,
            currency
          );
        }

        this.renderFreeShipping(cart || {}, currency, isEmpty);
        this.renderDiscounts(cart || {});
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

    renderDiscounts(cart) {
      if (!this.discountListNode) return;

      const discountCodes = getAppliedDiscountCodes(cart);
      const fragment = document.createDocumentFragment();

      discountCodes.forEach((code) => {
        const item = document.createElement('li');
        item.className = 'sb-cart-discount-pill font-caption weight-semibold';
        item.innerHTML = `
          <span>${escapeHtml(code)}</span>
          <button type="button" class="sb-cart-discount-pill__remove" data-cart-discount-remove="${escapeHtml(
            code
          )}" aria-label="Remove ${escapeHtml(code)}">
            <span aria-hidden="true">&times;</span>
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
        const linePrice = formatMoney(item.final_line_price || 0, currency);
        const quantity = clampCount(item.quantity || 0);

        lineItem.innerHTML = `
          <a class="sb-cart-line__media" href="${productUrl}">
            <img class="sb-cart-line__image" src="${imageUrl}" alt="${title}" loading="lazy" width="112" height="112">
          </a>
          <div class="sb-cart-line__content">
            <a class="sb-cart-line__title font-body weight-bold" href="${productUrl}">${title}</a>
            ${
              variantTitle
                ? `<p class="sb-cart-line__variant font-caption weight-regular">${variantTitle}</p>`
                : ''
            }
            <p class="sb-cart-line__price font-caption weight-semibold">${escapeHtml(linePrice)}</p>
            <div class="sb-cart-line__controls">
              <div class="sb-cart-quantity" role="group" aria-label="Quantity">
                <button type="button" class="sb-cart-quantity__button" data-cart-qty-minus aria-label="Decrease quantity">-</button>
                <input
                  class="sb-cart-quantity__input"
                  data-cart-qty-input
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  value="${quantity}"
                  aria-label="Quantity"
                >
                <button type="button" class="sb-cart-quantity__button" data-cart-qty-plus aria-label="Increase quantity">+</button>
              </div>
              <button type="button" class="sb-cart-line__remove font-caption2 weight-semibold" data-cart-remove>Remove</button>
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
      this.discountErrorNode.textContent = message;
      this.discountErrorNode.hidden = false;
      this.renderedDiscountError = true;
    }

    hideDiscountError() {
      if (!this.discountErrorNode) return;
      this.discountErrorNode.hidden = true;
      this.discountErrorNode.textContent = '';
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

  document.addEventListener('sb:cart-badge:debug-bump', (event) => {
    const requestedCount = event && event.detail ? Number.parseInt(`${event.detail.count}`, 10) : NaN;
    const nextCount = Number.isFinite(requestedCount) ? Math.max(0, requestedCount) : Math.max(1, previousCartCount + 1);
    setHeaderCartCount(nextCount, { animate: true });
  });

  refreshCart({ source: 'initial', animateBadge: false }).catch(() => {
    // no-op
  });
})();
