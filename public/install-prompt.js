(function () {
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return; // already installed — never nag

  var DISMISS_KEY = 'dashspid_install_dismissed_at';
  var DISMISS_DAYS = 14;
  var dismissedAt = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
  var recentlyDismissed = dismissedAt && (Date.now() - dismissedAt) < DISMISS_DAYS * 24 * 60 * 60 * 1000;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var deferredPrompt = null;

  function showBanner(message, buttonText, onButtonClick) {
    var bar = document.createElement('div');
    bar.className = 'install-banner';
    bar.innerHTML =
      '<span class="install-banner-text">' + message + '</span>' +
      '<span class="install-banner-actions">' +
      (buttonText ? '<button type="button" class="install-banner-btn">' + buttonText + '</button>' : '') +
      '<button type="button" class="install-banner-close" aria-label="Dismiss">✕</button>' +
      '</span>';
    document.body.appendChild(bar);

    bar.querySelector('.install-banner-close').addEventListener('click', function () {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
      bar.remove();
    });
    if (buttonText && onButtonClick) {
      bar.querySelector('.install-banner-btn').addEventListener('click', function () {
        onButtonClick(bar);
      });
    }
    return bar;
  }

  if (!recentlyDismissed && isIOS) {
    showBanner('Install this app: tap Share, then "Add to Home Screen".', null, null);
  }

  if (!recentlyDismissed && !isIOS) {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      showBanner('Install Dashspid Ops for quick access.', 'Install', function (bar) {
        bar.remove();
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
      });
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/service-worker.js').catch(function () {});
    });
  }
})();
