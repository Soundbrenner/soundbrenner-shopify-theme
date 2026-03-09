(() => {
  if (!customElements.get('localization-form-component')) {
    class LocalizationFormComponent extends HTMLElement {
      connectedCallback() {
        this.form = this.querySelector('form.localization-form');
        this.countryList = this.querySelector('[data-localization-ref="countryList"]');
        this.countryInput = this.querySelector('[data-localization-ref="countryInput"]');
        this.searchInput = this.querySelector('[data-localization-ref="search"]');
        this.liveRegion = this.querySelector('[data-localization-ref="liveRegion"]');
        this.noResultsMessage = this.querySelector('[data-localization-ref="noResultsMessage"]');
        this.languageInput = this.querySelector('[data-localization-ref="languageInput"]');
        this.countryItems = Array.from(this.querySelectorAll('[data-localization-ref="countryItem"]'));

        this.handleCountryClick = this.handleCountryClick.bind(this);
        this.handleCountryKeydown = this.handleCountryKeydown.bind(this);
        this.handleSearchKeydown = this.handleSearchKeydown.bind(this);
        this.handleSearchInput = this.handleSearchInput.bind(this);
        this.handleLanguageChange = this.handleLanguageChange.bind(this);
        this.handleCountryListScroll = this.handleCountryListScroll.bind(this);
        this.handleCountryListWheel = this.handleCountryListWheel.bind(this);
        this.handleCountryListTouchStart = this.handleCountryListTouchStart.bind(this);
        this.handleCountryListTouchMove = this.handleCountryListTouchMove.bind(this);
        this.touchStartY = 0;

        if (this.countryList) {
          this.countryList.addEventListener('click', this.handleCountryClick);
          this.countryList.addEventListener('keydown', this.handleCountryKeydown);
          this.countryList.addEventListener('scroll', this.handleCountryListScroll);
          this.countryList.addEventListener('wheel', this.handleCountryListWheel, { passive: false });
          this.countryList.addEventListener('touchstart', this.handleCountryListTouchStart, { passive: true });
          this.countryList.addEventListener('touchmove', this.handleCountryListTouchMove, { passive: false });
        }

        if (this.searchInput) {
          this.searchInput.addEventListener('input', this.handleSearchInput);
          this.searchInput.addEventListener('keydown', this.handleSearchKeydown);
        }

        if (this.languageInput) {
          this.languageInput.addEventListener('change', this.handleLanguageChange);
        }
      }

      disconnectedCallback() {
        if (this.countryList) {
          this.countryList.removeEventListener('click', this.handleCountryClick);
          this.countryList.removeEventListener('keydown', this.handleCountryKeydown);
          this.countryList.removeEventListener('scroll', this.handleCountryListScroll);
          this.countryList.removeEventListener('wheel', this.handleCountryListWheel);
          this.countryList.removeEventListener('touchstart', this.handleCountryListTouchStart);
          this.countryList.removeEventListener('touchmove', this.handleCountryListTouchMove);
        }

        if (this.searchInput) {
          this.searchInput.removeEventListener('input', this.handleSearchInput);
          this.searchInput.removeEventListener('keydown', this.handleSearchKeydown);
        }

        if (this.languageInput) {
          this.languageInput.removeEventListener('change', this.handleLanguageChange);
        }
      }

      normalizeString(value) {
        return String(value || '').trim().toLowerCase();
      }

      getVisibleItems() {
        return this.countryItems.filter((item) => !item.hasAttribute('hidden'));
      }

      setSelectedItem(item) {
        this.countryItems.forEach((countryItem) => {
          countryItem.setAttribute('aria-selected', countryItem === item ? 'true' : 'false');
        });

        if (this.searchInput) {
          const activeDescendant = item ? item.id : '';
          this.searchInput.setAttribute('aria-activedescendant', activeDescendant);
        }
      }

      changeCountryFocus(direction) {
        const visibleItems = this.getVisibleItems();
        if (!visibleItems.length) return;

        const selectedIndex = visibleItems.findIndex((item) => item.getAttribute('aria-selected') === 'true');
        const focusedIndex = selectedIndex >= 0 ? selectedIndex : visibleItems.findIndex((item) => item === document.activeElement);
        const baseIndex = focusedIndex >= 0 ? focusedIndex : 0;
        let nextIndex = baseIndex;

        if (direction === 'UP') {
          nextIndex = baseIndex > 0 ? baseIndex - 1 : visibleItems.length - 1;
        } else {
          nextIndex = baseIndex < visibleItems.length - 1 ? baseIndex + 1 : 0;
        }

        const nextItem = visibleItems[nextIndex];
        this.setSelectedItem(nextItem);
        nextItem.focus();
      }

      filterCountries() {
        if (!this.searchInput) return;

        const searchValue = this.normalizeString(this.searchInput.value);
        let visibleCount = 0;

        this.countryItems.forEach((item) => {
          const name = this.normalizeString(item.dataset.name);
          const aliases = this.normalizeString(item.dataset.aliases);
          const iso = this.normalizeString(item.dataset.iso);
          const currency = this.normalizeString(item.dataset.currency);

          const isMatch =
            searchValue === '' ||
            name.includes(searchValue) ||
            aliases.split(',').some((alias) => this.normalizeString(alias).includes(searchValue)) ||
            iso === searchValue ||
            currency.includes(searchValue);

          item.toggleAttribute('hidden', !isMatch);
          if (isMatch) visibleCount += 1;
        });

        const wrapper = this.querySelector('.country-selector-form__wrapper');
        if (wrapper) {
          wrapper.classList.toggle('is-searching', searchValue !== '');
        }

        const popularCountries = this.querySelector('.popular-countries');
        if (popularCountries) {
          popularCountries.toggleAttribute('hidden', searchValue !== '');
        }

        if (this.noResultsMessage) {
          this.noResultsMessage.toggleAttribute('hidden', visibleCount > 0);
        }

        if (this.liveRegion) {
          const labelTemplate = this.dataset.labelResultsCount || 'Found [count] country or region results.';
          this.liveRegion.textContent = labelTemplate.replace('[count]', String(visibleCount));
        }

        this.setSelectedItem(null);

        if (this.countryList) {
          this.countryList.scrollTop = 0;
        }
      }

      handleSearchInput() {
        this.filterCountries();
      }

      handleSearchKeydown(event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          return;
        }
        this.handleCountryKeydown(event);
      }

      handleCountryKeydown(event) {
        if (!this.countryList) return;

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          this.changeCountryFocus(event.key === 'ArrowUp' ? 'UP' : 'DOWN');
          return;
        }

        if (event.key === 'Enter') {
          const activeItem = this.countryItems.find((item) => item.getAttribute('aria-selected') === 'true');
          if (!activeItem) return;
          event.preventDefault();
          event.stopPropagation();
          this.selectCountry(activeItem.dataset.value);
        }
      }

      handleCountryListScroll(event) {
        const countryFilter = this.querySelector('.country-filter');
        if (!countryFilter) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        countryFilter.classList.toggle('is-scrolled', target.scrollTop > 0);
      }

      preventBoundaryScroll(event, deltaY) {
        if (!this.countryList) return;
        if (!Number.isFinite(deltaY) || deltaY === 0) return;

        const maxScrollTop = this.countryList.scrollHeight - this.countryList.clientHeight;
        if (maxScrollTop <= 0) {
          event.preventDefault();
          return;
        }

        const isAtTop = this.countryList.scrollTop <= 0;
        const isAtBottom = this.countryList.scrollTop >= maxScrollTop - 1;

        if ((deltaY < 0 && isAtTop) || (deltaY > 0 && isAtBottom)) {
          event.preventDefault();
        }
      }

      handleCountryListWheel(event) {
        this.preventBoundaryScroll(event, event.deltaY);
      }

      handleCountryListTouchStart(event) {
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        this.touchStartY = touch.clientY;
      }

      handleCountryListTouchMove(event) {
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        const deltaY = this.touchStartY - touch.clientY;
        this.preventBoundaryScroll(event, deltaY);
      }

      handleCountryClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const countryItem = target.closest('[data-localization-ref="countryItem"]');
        if (!countryItem || countryItem.hasAttribute('hidden')) return;
        this.selectCountry(countryItem.dataset.value);
      }

      selectCountry(countryCode) {
        if (!countryCode || !this.countryInput || !this.form) return;
        this.countryInput.value = countryCode;
        this.form.submit();
      }

      handleLanguageChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement) || !this.form || !this.languageInput) return;
        this.languageInput.value = target.value;
        this.form.submit();
      }

      focusSearchInput() {
        if (this.searchInput) {
          this.searchInput.focus();
          return;
        }

        const firstItem = this.getVisibleItems()[0];
        if (firstItem) {
          firstItem.focus();
        }
      }

      resetForm() {
        if (!this.searchInput || this.searchInput.value === '') return;
        this.searchInput.value = '';
        this.filterCountries();
      }
    }

    customElements.define('localization-form-component', LocalizationFormComponent);
  }

  if (!customElements.get('dropdown-localization-component')) {
    class DropdownLocalizationComponent extends HTMLElement {
      connectedCallback() {
        this.button = this.querySelector('[data-localization-ref="button"]');
        this.panel = this.querySelector('[data-localization-ref="panel"]');
        this.localizationForm = this.querySelector('localization-form-component');
        this.toggleSelector = this.toggleSelector.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleDocumentClick = this.handleDocumentClick.bind(this);
        this.handleRequestClose = this.handleRequestClose.bind(this);

        if (this.panel) {
          this.panel.classList.remove('is-active');
          this.panel.classList.remove('is-closing');
        }
        if (this.button) this.button.setAttribute('aria-expanded', 'false');
        this.removeAttribute('data-open');

        if (this.button) {
          this.button.addEventListener('click', this.toggleSelector);
        }

        document.addEventListener('sb:header-localization:request-close', this.handleRequestClose);
      }

      disconnectedCallback() {
        if (this.button) {
          this.button.removeEventListener('click', this.toggleSelector);
        }

        document.removeEventListener('click', this.handleDocumentClick);
        document.removeEventListener('keyup', this.handleKeyUp);
        document.removeEventListener('sb:header-localization:request-close', this.handleRequestClose);
      }

      get isOpen() {
        return this.getAttribute('data-open') === 'true';
      }

      dispatchToggleState(open) {
        document.dispatchEvent(
          new CustomEvent('sb:header-localization:toggle', {
            detail: { open: Boolean(open) }
          })
        );
      }

      toggleSelector(event) {
        event.preventDefault();
        if (this.isOpen) {
          this.hidePanel();
          return;
        }
        this.showPanel({ focusSearch: false });
      }

      showPanel({ focusSearch = true } = {}) {
        if (!this.panel || !this.button || this.isOpen) return;

        this.updatePanelWidth();
        this.button.setAttribute('aria-expanded', 'true');
        this.setAttribute('data-open', 'true');
        this.panel.classList.remove('is-closing');
        this.panel.classList.add('is-active');

        document.addEventListener('click', this.handleDocumentClick);
        document.addEventListener('keyup', this.handleKeyUp);

        if (focusSearch) {
          window.setTimeout(() => {
            if (this.localizationForm && typeof this.localizationForm.focusSearchInput === 'function') {
              this.localizationForm.focusSearchInput();
            }
          }, 0);
        }

        this.dispatchToggleState(true);
      }

      hidePanel() {
        if (!this.panel || !this.button || !this.isOpen) return;

        this.button.setAttribute('aria-expanded', 'false');
        this.removeAttribute('data-open');
        this.panel.classList.add('is-closing');
        this.panel.classList.remove('is-active');
        this.dispatchToggleState(false);
        let closeSettled = false;
        const finalizeClose = (event) => {
          if (event && event.target !== this.panel) return;
          if (event && event.propertyName !== 'grid-template-rows') return;
          if (closeSettled || this.isOpen || !this.panel) return;
          closeSettled = true;
          this.panel.classList.remove('is-closing');
        };
        this.panel.addEventListener('transitionend', finalizeClose, { once: true });
        window.setTimeout(finalizeClose, 620);

        if (this.localizationForm && typeof this.localizationForm.resetForm === 'function') {
          this.localizationForm.resetForm();
        }

        document.removeEventListener('click', this.handleDocumentClick);
        document.removeEventListener('keyup', this.handleKeyUp);

      }

      handleKeyUp(event) {
        if (event.key !== 'Escape') return;
        this.hidePanel();
        if (this.button) {
          this.button.focus();
        }
      }

      handleDocumentClick(event) {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (this.contains(target)) return;
        this.hidePanel();
      }

      handleRequestClose() {
        this.hidePanel();
      }

      updatePanelWidth() {
        if (!this.panel) return;

        this.panel.style.removeProperty('--header-localization-panel-width');
        const panelWidth = Math.ceil(this.panel.offsetWidth);

        if (panelWidth > 0) {
          this.panel.style.setProperty('--header-localization-panel-width', `${panelWidth}px`);
        }
      }
    }

    customElements.define('dropdown-localization-component', DropdownLocalizationComponent);
  }

  if (!customElements.get('drawer-localization-component')) {
    class DrawerLocalizationComponent extends HTMLElement {
      connectedCallback() {
        this.openButton = this.querySelector('[data-localization-ref="drawerOpenButton"]');
        this.backButton = this.querySelector('[data-localization-ref="drawerBackButton"]');
        this.page = this.querySelector('[data-localization-ref="drawerPage"]');
        this.menuDrawer = this.closest('.menu-drawer');
        this.localizationForm = this.querySelector('localization-form-component');
        this.handleOpenClick = this.handleOpenClick.bind(this);
        this.handleBackClick = this.handleBackClick.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);

        if (this.page) this.page.hidden = true;
        if (this.openButton) this.openButton.setAttribute('aria-expanded', 'false');
        this.classList.remove('menu-open');

        if (this.openButton) this.openButton.addEventListener('click', this.handleOpenClick);
        if (this.backButton) this.backButton.addEventListener('click', this.handleBackClick);
        this.addEventListener('keyup', this.handleKeyUp);
      }

      disconnectedCallback() {
        if (this.openButton) this.openButton.removeEventListener('click', this.handleOpenClick);
        if (this.backButton) this.backButton.removeEventListener('click', this.handleBackClick);
        this.removeEventListener('keyup', this.handleKeyUp);
      }

      get isOpen() {
        return this.classList.contains('menu-open');
      }

      handleOpenClick(event) {
        event.preventDefault();
        this.openDrawerPage();
      }

      handleBackClick(event) {
        event.preventDefault();
        this.closeDrawerPage();
      }

      handleKeyUp(event) {
        if (event.key !== 'Escape' || !this.isOpen) return;
        this.closeDrawerPage();
        if (this.openButton) this.openButton.focus();
      }

      openDrawerPage() {
        if (!this.page || this.isOpen) return;
        this.page.hidden = false;
        void this.page.offsetHeight;
        this.classList.add('menu-open');
        if (this.menuDrawer) this.menuDrawer.classList.add('menu-drawer--has-submenu-opened');
        if (this.openButton) this.openButton.setAttribute('aria-expanded', 'true');

        window.requestAnimationFrame(() => {
          if (this.localizationForm && typeof this.localizationForm.focusSearchInput === 'function') {
            this.localizationForm.focusSearchInput();
          }
        });
      }

      closeDrawerPage({ immediate = false } = {}) {
        if (!this.page) return;
        if (!this.isOpen) {
          if (immediate) this.page.hidden = true;
          return;
        }

        this.classList.remove('menu-open');
        if (this.menuDrawer) this.menuDrawer.classList.remove('menu-drawer--has-submenu-opened');
        if (this.openButton) this.openButton.setAttribute('aria-expanded', 'false');
        if (this.localizationForm && typeof this.localizationForm.resetForm === 'function') {
          this.localizationForm.resetForm();
        }

        const hidePage = () => {
          if (!this.isOpen && this.page) this.page.hidden = true;
        };

        if (immediate) {
          hidePage();
          return;
        }

        this.page.addEventListener('transitionend', hidePage, { once: true });
      }
    }

    customElements.define('drawer-localization-component', DrawerLocalizationComponent);
  }
})();
