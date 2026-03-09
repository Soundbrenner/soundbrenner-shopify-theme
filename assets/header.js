(() => {
  window.SBHeaderInitializers = window.SBHeaderInitializers || [];

  const initializeHeader = (headerElement = null) => {
    const header = headerElement instanceof HTMLElement
      ? headerElement
      : document.querySelector('header-component.header, .header');
    if (!header || header.dataset.headerInit === 'true') return;
    header.dataset.headerInit = 'true';

    const previousAbortController = header.sbHeaderAbortController;
    if (previousAbortController instanceof AbortController) {
      previousAbortController.abort();
    }

    const runtimeAbortController = new AbortController();
    const runtimeSignal = runtimeAbortController.signal;
    header.sbHeaderAbortController = runtimeAbortController;

    const legacyListenerCleanups = [];
    const abortCleanups = [];

    const addRuntimeEventListener = (target, eventName, handler, options) => {
      if (!target || typeof target.addEventListener !== 'function') return;

      let listenerOptions = options;
      if (typeof options === 'boolean') {
        listenerOptions = { capture: options };
      } else if (options && typeof options === 'object') {
        listenerOptions = { ...options };
      }

      if (!listenerOptions || typeof listenerOptions !== 'object') {
        listenerOptions = {};
      }

      listenerOptions.signal = runtimeSignal;

      try {
        target.addEventListener(eventName, handler, listenerOptions);
      } catch (_) {
        delete listenerOptions.signal;
        target.addEventListener(eventName, handler, listenerOptions);
        legacyListenerCleanups.push(() => {
          target.removeEventListener(eventName, handler, listenerOptions);
        });
      }
    };

    const onAbort = (cleanup) => {
      if (typeof cleanup !== 'function') return;
      abortCleanups.push(cleanup);
    };

    const findHeaderRef = (scope, refName, fallbackSelector) => {
      if (scope && typeof scope.querySelector === 'function') {
        const scopedMatch = scope.querySelector(`[data-header-ref="${refName}"]`);
        if (scopedMatch instanceof HTMLElement) return scopedMatch;
        if (fallbackSelector) {
          const scopedFallback = scope.querySelector(fallbackSelector);
          if (scopedFallback instanceof HTMLElement) return scopedFallback;
        }
      }

      if (fallbackSelector) {
        const fallbackMatch = document.querySelector(fallbackSelector);
        if (fallbackMatch instanceof HTMLElement) return fallbackMatch;
      }

      return null;
    };

    runtimeSignal.addEventListener(
      'abort',
      () => {
        legacyListenerCleanups.forEach((cleanup) => cleanup());
        legacyListenerCleanups.length = 0;
        abortCleanups.forEach((cleanup) => cleanup());
        abortCleanups.length = 0;
      },
      { once: true }
    );

    const context = {
      header,
      signal: runtimeSignal,
      addRuntimeEventListener,
      findHeaderRef,
      onAbort,
      shared: {},
    };

    window.SBHeaderInitializers.forEach((initializeController) => {
      if (typeof initializeController !== 'function') return;
      initializeController(context);
    });
  };

  class HeaderComponentElement extends HTMLElement {
    connectedCallback() {
      initializeHeader(this);
    }

    disconnectedCallback() {
      const abortController = this.sbHeaderAbortController;
      if (abortController instanceof AbortController) {
        abortController.abort();
      }
      this.sbHeaderAbortController = null;
      delete this.dataset.headerInit;
    }
  }

  if (!customElements.get('header-component')) {
    customElements.define('header-component', HeaderComponentElement);
  }

  const initializeFallbackHeader = () => {
    const fallbackHeader = document.querySelector('.header:not(header-component)');
    if (fallbackHeader instanceof HTMLElement) {
      initializeHeader(fallbackHeader);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFallbackHeader, { once: true });
  } else {
    initializeFallbackHeader();
  }

  document.addEventListener('shopify:section:load', initializeFallbackHeader);
})();
