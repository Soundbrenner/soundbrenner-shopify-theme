(() => {
  const locale = window.SBKlaviyoReviewsLocale;
  if (!locale || typeof locale !== 'object') return;

  const ROOT_SELECTORS = [
    '#klaviyo-reviews-all',
    '#fulfilled-reviews-all',
    '#klaviyo-product-reviews-wrapper',
    '.kl_reviews__lightbox__container',
  ];

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const applyTemplate = (template, replacements = {}) => {
    let output = String(template || '');
    Object.entries(replacements).forEach(([key, value]) => {
      const replacementValue = String(value || '');
      output = output.replaceAll(`{{ ${key} }}`, replacementValue);
      output = output.replaceAll(`{{${key}}}`, replacementValue);
      output = output.replaceAll(`__${String(key).toUpperCase()}__`, replacementValue);
    });
    return output;
  };

  const getLocalizedTimeUnit = (unit, count) => {
    const normalizedUnit = normalizeText(unit).toLowerCase();
    const singular = count === 1;

    switch (normalizedUnit) {
      case 'minute':
      case 'minutes':
        return singular ? locale.minuteSingular : locale.minutePlural;
      case 'hour':
      case 'hours':
        return singular ? locale.hourSingular : locale.hourPlural;
      case 'day':
      case 'days':
        return singular ? locale.daySingular : locale.dayPlural;
      case 'week':
      case 'weeks':
        return singular ? locale.weekSingular : locale.weekPlural;
      case 'month':
      case 'months':
        return singular ? locale.monthSingular : locale.monthPlural;
      case 'year':
      case 'years':
        return singular ? locale.yearSingular : locale.yearPlural;
      default:
        return '';
    }
  };

  const localizeRelativeTime = (text) => {
    const normalizedText = normalizeText(text);
    if (!normalizedText) return '';

    const match = normalizedText.match(/(?:^|\b)(a|an|\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago(?:\b|$)/i);
    if (!match) return '';

    const [, countToken, unitToken] = match;
    const count = countToken === 'a' || countToken === 'an' ? 1 : Number.parseInt(countToken, 10);
    if (!Number.isFinite(count)) return '';

    const localizedUnit = getLocalizedTimeUnit(unitToken, count);
    if (!localizedUnit || !locale.relativeTimeAgo) return '';

    return applyTemplate(locale.relativeTimeAgo, {
      count,
      unit: localizedUnit,
    });
  };

  const setTextContent = (element, value) => {
    if (!(element instanceof HTMLElement)) return;
    const nextValue = normalizeText(value);
    if (!nextValue || normalizeText(element.textContent) === nextValue) return;
    element.textContent = nextValue;
  };

  const setAttribute = (element, attributeName, value) => {
    if (!(element instanceof HTMLElement)) return;
    const nextValue = normalizeText(value);
    if (!nextValue) return;
    if (normalizeText(element.getAttribute(attributeName)) === nextValue) return;
    element.setAttribute(attributeName, nextValue);
  };

  const setLeadingTextNode = (element, value) => {
    if (!(element instanceof HTMLElement)) return;
    const nextValue = normalizeText(value);
    if (!nextValue) return;

    const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) {
      if (normalizeText(textNode.textContent) !== nextValue) {
        textNode.textContent = nextValue;
      }
      return;
    }

    element.insertBefore(document.createTextNode(nextValue), element.firstChild);
  };

  const setTextPreservingChildren = (element, value) => {
    if (!(element instanceof HTMLElement)) return;
    const nextValue = normalizeText(value);
    if (!nextValue) return;

    const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) {
      if (normalizeText(textNode.textContent) !== nextValue) {
        textNode.textContent = nextValue;
      }
      return;
    }

    const nestedTextElement = element.querySelector('span, small, strong');
    if (nestedTextElement instanceof HTMLElement) {
      setTextContent(nestedTextElement, nextValue);
      return;
    }

    setLeadingTextNode(element, nextValue);
  };

  const optionCopy = {
    'all variants': () => locale.allVariants,
    'most recent': () => locale.mostRecent,
    'highest rating': () => locale.highestRating,
    'lowest rating': () => locale.lowestRating,
    'most relevant': () => locale.mostRelevant,
    'all ratings': () => locale.allRatings,
    '1 star': () => locale.oneStar,
    '2 stars': () => locale.twoStars,
    '3 stars': () => locale.threeStars,
    '4 stars': () => locale.fourStars,
    '5 stars': () => locale.fiveStars,
  };

  const inlineCopy = {
    'sound quality': () => locale.soundQuality,
    comfort: () => locale.comfort,
    poor: () => locale.poor,
    excellent: () => locale.excellent,
  };

  const localizeSelect = (select) => {
    if (!(select instanceof HTMLSelectElement)) return;

    const ariaLabel = normalizeText(select.getAttribute('aria-label')).toLowerCase();
    if (ariaLabel === 'sort by:') {
      setAttribute(select, 'aria-label', locale.sortBy);
    } else if (ariaLabel === 'filter by:') {
      setAttribute(select, 'aria-label', locale.filterBy);
    }

    Array.from(select.options).forEach((option) => {
      const replacement = optionCopy[normalizeText(option.textContent).toLowerCase()];
      if (typeof replacement !== 'function') return;
      const nextValue = normalizeText(replacement());
      if (!nextValue || normalizeText(option.textContent) === nextValue) return;
      option.textContent = nextValue;
    });
  };

  const localizePurchasedTimestamp = (element) => {
    if (!(element instanceof HTMLElement)) return;
    const text = normalizeText(element.textContent);
    const purchasedMatch = text.match(/purchased\s+((?:a|an|\d+)\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago)/i);
    if (!purchasedMatch) return;

    const relativeTime = purchasedMatch[1];
    const localizedRelativeTime = localizeRelativeTime(relativeTime);
    if (!localizedRelativeTime) return;
    const nextValue = applyTemplate(locale.purchasedRelativeTime, { relative_time: localizedRelativeTime });
    setTextContent(element, nextValue);
  };

  const localizeResponseTitle = (element) => {
    if (!(element instanceof HTMLElement)) return;
    const text = normalizeText(element.textContent);
    const englishMatch = text.match(/(.*?)\s+replied\s+((?:a|an|\d+)\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago)/i);

    if (englishMatch) {
      const [, brand, relativeTime] = englishMatch;
      const localizedRelativeTime = localizeRelativeTime(relativeTime);
      if (!localizedRelativeTime) return;
      const nextValue = applyTemplate(locale.responseTitle, {
        brand: normalizeText(brand),
        relative_time: localizedRelativeTime,
      });
      setTextContent(element, nextValue);
      return;
    }

    const trailingRelativeMatch = text.match(/((?:a|an|\d+)\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago)$/i);
    if (!trailingRelativeMatch) return;

    const relativeTime = trailingRelativeMatch[1];
    const localizedRelativeTime = localizeRelativeTime(relativeTime);
    if (!localizedRelativeTime) return;

    const responseTemplate = String(locale.responseTitle || '');
    const [beforeBrand = '', afterBrandToken = ''] = responseTemplate.split('__BRAND__');
    const [betweenBrandAndTime = '', afterTime = ''] = afterBrandToken.split('__RELATIVE_TIME__');

    const localizedPattern = new RegExp(
      `^${escapeRegExp(beforeBrand)}(.+?)${escapeRegExp(betweenBrandAndTime)}${escapeRegExp(localizedRelativeTime)}${escapeRegExp(afterTime)}\\s+${escapeRegExp(relativeTime)}$`,
      'i'
    );
    const localizedMatch = text.match(localizedPattern);
    if (!localizedMatch) return;

    const [, brand] = localizedMatch;
    const nextValue = applyTemplate(locale.responseTitle, {
      brand: normalizeText(brand),
      relative_time: localizedRelativeTime,
    });
    setTextContent(element, nextValue);
  };

  const localizeVariantLabel = (element) => {
    if (!(element instanceof HTMLElement)) return;
    const text = normalizeText(element.textContent);
    if (!text.toLowerCase().startsWith('variant:')) return;

    const variantValue = normalizeText(text.slice('Variant:'.length));
    if (!variantValue || !locale.variantLabel) return;
    setTextContent(element, `${locale.variantLabel}: ${variantValue}`);
  };

  const localizeWriteReviewButton = (button) => {
    if (!(button instanceof HTMLButtonElement)) return;

    const buttonText = normalizeText(button.textContent).toLowerCase();
    const buttonAria = normalizeText(button.getAttribute('aria-label')).toLowerCase();
    if (buttonText !== 'write a review' && !buttonAria.startsWith('write a review')) return;

    setTextContent(button, locale.writeAReview);
    setAttribute(button, 'aria-label', locale.writeAReviewAria);
  };

  const localizeTabButton = (button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const tabText = normalizeText(button.textContent);
    if (!tabText) return;

    if (tabText.startsWith('Reviews')) {
      setLeadingTextNode(button, locale.reviewsTab);
    } else if (tabText.startsWith('Questions')) {
      setLeadingTextNode(button, locale.questionsTab);
    }
  };

  const localizeInlineCopy = (root) => {
    if (!(root instanceof HTMLElement)) return;

    root.querySelectorAll('*').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      if (element.children.length > 0) return;

      const replacement = inlineCopy[normalizeText(element.textContent).toLowerCase()];
      if (typeof replacement !== 'function') return;

      setTextContent(element, replacement());
    });
  };

  const localizeRoot = (root) => {
    if (!(root instanceof HTMLElement)) return;

    root.querySelectorAll('.kl_reviews__input_with_search_icon').forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      setAttribute(input, 'placeholder', locale.searchPlaceholder);
      setAttribute(input, 'aria-label', locale.searchLabel);
    });

    root.querySelectorAll('select').forEach(localizeSelect);

    root.querySelectorAll('.kl_reviews__button_bar .kl_reviews__button').forEach((button) => {
      localizeWriteReviewButton(button);
    });

    root.querySelectorAll('.kl_reviews__load_more_button .kl_reviews__button').forEach((button) => {
      setTextContent(button, locale.showMore);
    });

    root.querySelectorAll("button[role='checkbox']").forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const text = normalizeText(button.textContent).toLowerCase();
      if (text !== 'with media') return;
      setTextPreservingChildren(button, locale.withMedia);
      setAttribute(button, 'aria-label', locale.withMedia);
    });

    root.querySelectorAll('.kl_reviews__review__verified').forEach((element) => {
      setTextPreservingChildren(element, locale.verifiedBuyer);
    });

    root.querySelectorAll('.kl_reviews__store_review_badge').forEach((element) => {
      setTextPreservingChildren(element, locale.storeReview);
    });

    root.querySelectorAll('.kl_reviews__review__order_timestamp').forEach(localizePurchasedTimestamp);
    root.querySelectorAll('.kl_reviews__review__timestamp, .kl_reviews__time_badge, .kl_reviews__lightbox__timestamp, .kl_reviews__lightbox__time_badge').forEach((element) => {
      const localized = localizeRelativeTime(element.textContent);
      if (!localized) return;
      setTextContent(element, localized);
    });
    root.querySelectorAll('.kl_reviews__review__response_title').forEach(localizeResponseTitle);
    root.querySelectorAll('.kl_reviews__review__variant').forEach(localizeVariantLabel);

    root.querySelectorAll('.kl_reviews__summary__header').forEach((element) => {
      const text = normalizeText(element.textContent).toLowerCase();
      if (text === 'customer reviews') {
        setTextContent(element, locale.customerReviews);
      }
    });

    root.querySelectorAll('.kl_reviews__list__tab_buttons').forEach((element) => {
      setAttribute(element, 'aria-label', locale.productTabsLabel);
    });

    root.querySelectorAll(".kl_reviews__list__tab[role='tab']").forEach(localizeTabButton);

    const emptyStateNodes = root.querySelectorAll('.kl_reviews__list_empty_state');
    if (emptyStateNodes[0] instanceof HTMLElement) {
      setTextContent(emptyStateNodes[0], locale.noMatchingReviews);
    }
    if (emptyStateNodes[1] instanceof HTMLElement) {
      setTextContent(emptyStateNodes[1], locale.tryAnotherSearch);
    }

    root.querySelectorAll('.kl_reviews__list_empty_state__container .kl_reviews__button').forEach((button) => {
      setTextPreservingChildren(button, locale.clearAll);
    });

    root.querySelectorAll('.kl_reviews__clear_filter__button').forEach((button) => {
      setTextPreservingChildren(button, locale.clearAllFilters);
      setAttribute(button, 'aria-label', locale.clearAllFilters);
    });

    localizeInlineCopy(root);
  };

  let scheduled = false;
  const initialRetryDelays = [150, 500, 1000, 2000, 4000];

  const applyLocalization = () => {
    ROOT_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach(localizeRoot);
    });
  };

  const scheduleLocalization = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      applyLocalization();
    });
  };

  const scheduleInitialRetries = () => {
    initialRetryDelays.forEach((delay) => {
      window.setTimeout(scheduleLocalization, delay);
    });
  };

  const observer = new MutationObserver(() => {
    scheduleLocalization();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scheduleLocalization();
      scheduleInitialRetries();
    }, { once: true });
  } else {
    scheduleLocalization();
    scheduleInitialRetries();
  }

  window.addEventListener('load', () => {
    scheduleLocalization();
    scheduleInitialRetries();
  }, { once: true });
  observer.observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
})();
