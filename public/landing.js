// Old creator/room capability links must still resolve after the landing-page move.
if (location.hash) location.replace('/new' + location.hash);
else fetch('/stats', { signal: AbortSignal.timeout(5000) })
  .then(r => { if (!r.ok) throw Error(); return r.json(); })
  .then(({completedInterviews}) => {
    if (!Number.isSafeInteger(completedInterviews) || completedInterviews < 1) return;
    document.getElementById('interview-count-value').textContent = new Intl.NumberFormat().format(completedInterviews);
    document.getElementById('interview-count').hidden = false;
  }).catch(() => {});
