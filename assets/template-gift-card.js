(function () {
  const root = document.documentElement;
  const qrCodeNode = document.querySelector('[data-gift-card-qr-code]');
  const copyButton = document.querySelector('[data-gift-card-copy-button]');
  const copyFeedback = document.querySelector('[data-gift-card-copy-feedback]');

  const fallbackCopyText = (text) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'absolute';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  };

  if (qrCodeNode instanceof HTMLElement && typeof window.QRCode === 'function') {
    const styles = getComputedStyle(root);
    const colorDark = styles.getPropertyValue('--color-foreground').trim() || styles.color;
    const colorLight = styles.getPropertyValue('--color-background').trim() || styles.backgroundColor;
    const text = qrCodeNode.dataset.identifier || '';

    if (text) {
      new window.QRCode(qrCodeNode, {
        colorDark,
        colorLight,
        correctLevel: window.QRCode.CorrectLevel.H,
        height: 72,
        text,
        width: 72,
      });
    }
  }

  if (!(copyButton instanceof HTMLElement)) return;

  copyButton.addEventListener('click', async () => {
    const code = copyButton.dataset.giftCardCode || '';
    if (!code) return;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(code);
      } else {
        fallbackCopyText(code);
      }

      if (copyFeedback instanceof HTMLElement) {
        copyFeedback.classList.remove('visually-hidden');
        copyFeedback.classList.add('is-visible');
      }
    } catch (_) {
      fallbackCopyText(code);
      if (copyFeedback instanceof HTMLElement) {
        copyFeedback.classList.remove('visually-hidden');
        copyFeedback.classList.add('is-visible');
      }
    }
  });
})();
