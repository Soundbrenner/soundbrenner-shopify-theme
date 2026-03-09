(() => {
  window.SBHeaderInitializers = window.SBHeaderInitializers || [];

  window.SBHeaderInitializers.push((context) => {
    const { header, onAbort } = context;

    const announcementElement = document.querySelector('.header__announcement');
    const announcementTextElement = announcementElement instanceof HTMLElement
      ? announcementElement.querySelector('.header__announcement-text')
      : null;
    const sourceElement = document.querySelector('[data-header-announcement-source]') || header;
    const announcementStyleHost = announcementElement instanceof HTMLElement ? announcementElement : header;
    const announcementBackgroundDefault = announcementStyleHost.style.getPropertyValue('--sb-announcement-background');
    const announcementEmojiImages = announcementElement instanceof HTMLElement
      ? Array.from(announcementElement.querySelectorAll('.header__announcement-emoji img'))
      : [];
    const announcementEmojiDefaults = announcementEmojiImages.map((imageNode) => imageNode.getAttribute('src') || '');
    const announcementTextDefault = announcementTextElement ? announcementTextElement.textContent || '' : '';

    const affiliateAnnouncementCookieName = 'sb_affiliate_announcement_state';
    const affiliateHeroPendingClass = 'sb-affiliate-hero-pending';
    const affiliateNameToken = `${sourceElement.dataset.affiliateNameToken || ''}`;
    const freeShippingThresholdToken = `${sourceElement.dataset.freeShippingThresholdToken || ''}`;
    const affiliateAnnouncementTemplate = `${sourceElement.dataset.affiliateAnnouncementTemplate || ''}`;
    const seasonalAnnouncementTemplate = `${sourceElement.dataset.announcementTemplate || ''}`;
    const affiliateAnnouncementGradient = `${sourceElement.dataset.affiliateAnnouncementGradient || ''}`;
    const affiliateAnnouncementEmoji = `${sourceElement.dataset.affiliateAnnouncementEmoji || ''}`;
    const currencyCode = `${sourceElement.dataset.currency || ''}`.trim().toUpperCase();
    const freeShippingThresholdCents = Number.parseInt(`${sourceElement.dataset.freeShippingThresholdCents || ''}`, 10);
    const fallbackFreeShippingThresholdDisplay = `${sourceElement.dataset.freeShippingThresholdDisplay || ''}`;

    let affiliateAnnouncementActive = false;
    let affiliateAnnouncementSignature = '';
    let announcementCountdownTimer = null;

    const parseJson = (value) => {
      try {
        return JSON.parse(value);
      } catch (_) {
        return null;
      }
    };

    const readCookie = (name) => {
      const cookieSource = `${document.cookie || ''}`;
      if (!cookieSource) return '';
      const cookieParts = cookieSource.split(';');
      for (const cookiePart of cookieParts) {
        const trimmedPart = cookiePart.trim();
        if (!trimmedPart.startsWith(`${name}=`)) continue;
        return trimmedPart.slice(name.length + 1);
      }
      return '';
    };

    const clearAffiliateAnnouncementState = () => {
      document.cookie = `${affiliateAnnouncementCookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    };

    const setAffiliateHeroPendingState = (state) => {
      const rootNode = document.documentElement;
      if (!(rootNode instanceof HTMLElement)) return;

      if (state) {
        rootNode.classList.add(affiliateHeroPendingClass);
        window.SBAffiliateAnnouncementState = state;
        return;
      }

      rootNode.classList.remove(affiliateHeroPendingClass);
      if ('SBAffiliateAnnouncementState' in window) {
        delete window.SBAffiliateAnnouncementState;
      }
    };

    const getAffiliateAnnouncementState = () => {
      const rawCookieValue = readCookie(affiliateAnnouncementCookieName);
      if (!rawCookieValue) return null;

      const decodedCookieValue = (() => {
        try {
          return decodeURIComponent(rawCookieValue);
        } catch (_) {
          return rawCookieValue;
        }
      })();
      const parsedState = parseJson(decodedCookieValue);
      if (!parsedState || typeof parsedState !== 'object') return null;

      const discountCode = `${parsedState.discountCode || ''}`.trim();
      const affiliateName = `${parsedState.affiliateName || discountCode}`.trim();
      const heroDesktopImage = `${parsedState.heroDesktopImage || ''}`.trim();
      const heroMobileImage = `${parsedState.heroMobileImage || ''}`.trim();
      const expiresAt = Number.parseInt(`${parsedState.expiresAt || ''}`, 10);
      if (!discountCode || !affiliateName || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

      return {
        discountCode,
        affiliateName,
        heroDesktopImage,
        heroMobileImage,
        expiresAt,
      };
    };

    const replaceToken = (input, token, replacement) => {
      const source = `${input || ''}`;
      const target = `${token || ''}`;
      if (!target) return source;
      return source.split(target).join(`${replacement || ''}`);
    };

    const setAnnouncementText = (text) => {
      if (!announcementTextElement) return;
      const normalizedText = `${text || ''}`;
      const lines = normalizedText.split('\n');
      announcementTextElement.textContent = '';
      lines.forEach((line, index) => {
        if (index > 0) announcementTextElement.appendChild(document.createElement('br'));
        announcementTextElement.appendChild(document.createTextNode(line));
      });
    };

    const resolveFreeShippingThresholdDisplay = () => {
      if (!Number.isFinite(freeShippingThresholdCents) || freeShippingThresholdCents <= 0) {
        return fallbackFreeShippingThresholdDisplay;
      }

      const storefrontPricing = window.SBStorefrontPricing;
      if (storefrontPricing && typeof storefrontPricing.formatMoney === 'function') {
        const formatted = storefrontPricing.formatMoney(freeShippingThresholdCents, currencyCode, { context: 'storefront' });
        if (`${formatted || ''}`.trim() !== '') return formatted;
      }

      return fallbackFreeShippingThresholdDisplay;
    };

    const resolveAnnouncementTemplate = (templateText) => {
      const sourceText = `${templateText || ''}`;
      if (!sourceText) return '';
      const freeShippingThresholdDisplay = resolveFreeShippingThresholdDisplay();
      return replaceToken(sourceText, freeShippingThresholdToken, freeShippingThresholdDisplay);
    };

    const getSeasonalAnnouncementText = () => {
      const defaultRenderedText = `${announcementTextDefault || ''}`.trim();
      if (defaultRenderedText) {
        const currentThresholdDisplay = `${fallbackFreeShippingThresholdDisplay || ''}`.trim();
        const formattedThresholdDisplay = `${resolveFreeShippingThresholdDisplay() || ''}`.trim();
        if (
          currentThresholdDisplay
          && formattedThresholdDisplay
          && currentThresholdDisplay !== formattedThresholdDisplay
          && defaultRenderedText.includes(currentThresholdDisplay)
        ) {
          return defaultRenderedText.split(currentThresholdDisplay).join(formattedThresholdDisplay);
        }
        return defaultRenderedText;
      }

      const resolvedText = resolveAnnouncementTemplate(seasonalAnnouncementTemplate).trim();
      return resolvedText || announcementTextDefault;
    };

    const getAffiliateAnnouncementText = (state) => {
      if (!state) return getSeasonalAnnouncementText();
      const sourceText = affiliateAnnouncementTemplate.trim();
      if (!sourceText) return getSeasonalAnnouncementText();
      let announcementText = replaceToken(sourceText, affiliateNameToken, state.affiliateName);
      announcementText = resolveAnnouncementTemplate(announcementText);
      return announcementText.trim() || getSeasonalAnnouncementText();
    };

    const applyAffiliateAnnouncement = (state) => {
      const isActive = Boolean(state && announcementTextElement);
      const nextSignature = isActive ? `${state.discountCode}:${state.affiliateName}` : '';
      if (affiliateAnnouncementActive === isActive && affiliateAnnouncementSignature === nextSignature) return;

      affiliateAnnouncementActive = isActive;
      affiliateAnnouncementSignature = nextSignature;

      if (isActive) {
        if (affiliateAnnouncementGradient) {
          announcementStyleHost.style.setProperty('--sb-announcement-background', affiliateAnnouncementGradient);
        }
        announcementEmojiImages.forEach((imageNode) => {
          if (!affiliateAnnouncementEmoji) return;
          imageNode.setAttribute('src', affiliateAnnouncementEmoji);
        });
        setAnnouncementText(getAffiliateAnnouncementText(state));
        header.classList.add('is-affiliate-announcement-active');
        return;
      }

      header.classList.remove('is-affiliate-announcement-active');
      if (announcementBackgroundDefault) {
        announcementStyleHost.style.setProperty('--sb-announcement-background', announcementBackgroundDefault);
      } else {
        announcementStyleHost.style.removeProperty('--sb-announcement-background');
      }
      announcementEmojiImages.forEach((imageNode, index) => {
        const defaultSource = announcementEmojiDefaults[index] || '';
        if (!defaultSource) return;
        imageNode.setAttribute('src', defaultSource);
      });
      setAnnouncementText(getSeasonalAnnouncementText());
    };

    const syncAffiliateAnnouncementState = () => {
      const state = getAffiliateAnnouncementState();
      if (!state) {
        clearAffiliateAnnouncementState();
        applyAffiliateAnnouncement(null);
        setAffiliateHeroPendingState(null);
        return null;
      }

      applyAffiliateAnnouncement(state);
      setAffiliateHeroPendingState(state);
      return state;
    };

    syncAffiliateAnnouncementState();

    const countdownRoot = announcementElement instanceof HTMLElement
      ? announcementElement.querySelector('[data-announcement-countdown]')
      : document.querySelector('[data-announcement-countdown]');

    if (countdownRoot) {
      const endDateValue = countdownRoot.getAttribute('data-sale-end-date') || '';
      const parseSaleEndTimestamp = (value) => {
        const normalizedValue = `${value || ''}`.trim();
        if (!normalizedValue) return NaN;

        const dateOnlyMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateOnlyMatch) {
          const fallbackTimestamp = Date.parse(normalizedValue);
          return Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : NaN;
        }

        const year = Number.parseInt(dateOnlyMatch[1], 10);
        const monthIndex = Number.parseInt(dateOnlyMatch[2], 10) - 1;
        const day = Number.parseInt(dateOnlyMatch[3], 10);
        const parsedDate = new Date(Date.UTC(year, monthIndex, day));

        if (
          parsedDate.getUTCFullYear() !== year
          || parsedDate.getUTCMonth() !== monthIndex
          || parsedDate.getUTCDate() !== day
        ) {
          return NaN;
        }

        const endOfDayUtcGuess = Date.UTC(year, monthIndex, day, 23, 59, 59);
        if (!window.Intl || typeof Intl.DateTimeFormat !== 'function') {
          return Date.parse(`${normalizedValue}T23:59:59-08:00`);
        }

        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        });

        if (typeof formatter.formatToParts !== 'function') {
          return Date.parse(`${normalizedValue}T23:59:59-08:00`);
        }

        const getOffsetMs = (utcTimestamp) => {
          const parts = formatter.formatToParts(new Date(utcTimestamp));
          const timeParts = {};

          for (const part of parts) {
            if (part.type !== 'literal') timeParts[part.type] = Number.parseInt(part.value, 10);
          }

          const localTimeAsUtc = Date.UTC(
            timeParts.year,
            timeParts.month - 1,
            timeParts.day,
            timeParts.hour,
            timeParts.minute,
            timeParts.second
          );

          return localTimeAsUtc - utcTimestamp;
        };

        let resolvedTimestamp = endOfDayUtcGuess;
        for (let index = 0; index < 4; index += 1) {
          const nextTimestamp = endOfDayUtcGuess - getOffsetMs(resolvedTimestamp);
          if (Math.abs(nextTimestamp - resolvedTimestamp) < 1) break;
          resolvedTimestamp = nextTimestamp;
        }

        return resolvedTimestamp;
      };

      const endTimestamp = parseSaleEndTimestamp(endDateValue);
      const daysValue = countdownRoot.querySelector('[data-countdown-days]');
      const hoursValue = countdownRoot.querySelector('[data-countdown-hours]');
      const minsValue = countdownRoot.querySelector('[data-countdown-mins]');
      const secsValue = countdownRoot.querySelector('[data-countdown-secs]');

      if (!Number.isFinite(endTimestamp) || !daysValue || !hoursValue || !minsValue || !secsValue) {
        countdownRoot.setAttribute('hidden', '');
      } else {
        const formatCountdownValue = (value) => `${Math.min(99, Math.max(0, value))}`.padStart(2, '0');
        const countdownDisplayThresholdSeconds = 5 * 24 * 60 * 60;

        if (announcementCountdownTimer != null) {
          window.clearInterval(announcementCountdownTimer);
          announcementCountdownTimer = null;
        }

        const updateCountdown = () => {
          const remainingSeconds = Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000));
          const shouldShowCountdown = remainingSeconds > 0 && remainingSeconds <= countdownDisplayThresholdSeconds;
          const days = Math.floor(remainingSeconds / 86400);
          const hours = Math.floor((remainingSeconds % 86400) / 3600);
          const mins = Math.floor((remainingSeconds % 3600) / 60);
          const secs = remainingSeconds % 60;

          if (shouldShowCountdown) countdownRoot.removeAttribute('hidden');
          else countdownRoot.setAttribute('hidden', '');

          daysValue.textContent = formatCountdownValue(days);
          hoursValue.textContent = formatCountdownValue(hours);
          minsValue.textContent = formatCountdownValue(mins);
          secsValue.textContent = formatCountdownValue(secs);

          if (remainingSeconds <= 0 && announcementCountdownTimer != null) {
            window.clearInterval(announcementCountdownTimer);
            announcementCountdownTimer = null;
          }
        };

        updateCountdown();
        announcementCountdownTimer = window.setInterval(updateCountdown, 1000);
      }
    }

    onAbort(() => {
      if (announcementCountdownTimer != null) {
        window.clearInterval(announcementCountdownTimer);
        announcementCountdownTimer = null;
      }
    });
  });
})();
