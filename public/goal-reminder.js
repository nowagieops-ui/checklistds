// Periodic nudge while she's working the queue — asks whether she's taken
// a moment to refocus on her goals today. Timing lives in localStorage
// (per device) rather than the server, since this is just a self-check,
// not something management needs to see.
(function () {
  var INTERVAL_MS = 2 * 60 * 60 * 1000; // ask again every 2 hours
  var SNOOZE_MS = 20 * 60 * 1000; // "not yet" asks again sooner
  var STORAGE_KEY = 'goalReminderNextAt';
  var RECHECK_MS = 5 * 60 * 1000; // catches long single-page sessions

  function readNextAt() {
    try { return parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0; } catch (e) { return 0; }
  }

  function writeNextAt(delayMs) {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now() + delayMs)); } catch (e) {}
  }

  function showPopup() {
    if (document.querySelector('.goal-reminder-overlay')) return;

    var overlay = document.createElement('div');
    overlay.className = 'goal-reminder-overlay';
    overlay.innerHTML =
      '<div class="goal-reminder-box">' +
        '<div class="goal-reminder-title">Quick check-in</div>' +
        '<div class="goal-reminder-body">Have you taken a moment to meditate on your goals today — prayer, meditation, or just a quiet minute to refocus on your call target?</div>' +
        '<button type="button" class="btn" id="goalReminderYes">Yes, I have</button>' +
        '<button type="button" class="btn btn-outline" id="goalReminderLater">Not yet — ask me later</button>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#goalReminderYes').addEventListener('click', function () {
      writeNextAt(INTERVAL_MS);
      overlay.remove();
    });
    overlay.querySelector('#goalReminderLater').addEventListener('click', function () {
      writeNextAt(SNOOZE_MS);
      overlay.remove();
    });
  }

  function maybeShow() {
    if (Date.now() >= readNextAt()) showPopup();
  }

  // First popup lands a full interval after she starts working, not the
  // instant a page loads.
  if (!readNextAt()) writeNextAt(INTERVAL_MS);

  maybeShow();
  setInterval(maybeShow, RECHECK_MS);
})();
