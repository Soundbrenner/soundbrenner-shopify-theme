(function () {
  const dialog = document.querySelector('[data-password-dialog]');
  const openButtons = document.querySelectorAll('[data-password-dialog-open], .sb-password-button--enter');
  const closeButtons = document.querySelectorAll('[data-password-dialog-close]');

  if (!(dialog instanceof HTMLDialogElement)) return;

  const openDialog = () => {
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
      return;
    }
    dialog.setAttribute('open', '');
  };

  const closeDialog = () => {
    if (!dialog.open) return;
    if (typeof dialog.close === 'function') {
      dialog.close();
      return;
    }
    dialog.removeAttribute('open');
  };

  openButtons.forEach((button) => {
    button.addEventListener('click', openDialog);
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', closeDialog);
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });

  if (dialog.hasAttribute('open')) {
    dialog.removeAttribute('open');
    openDialog();
  }
})();
