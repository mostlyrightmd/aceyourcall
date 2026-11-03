// No cookies, storage, auto-capture, replay, URLs, referrers or form contents.
(() => {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;
  const id = crypto.randomUUID();
  const track = event => { void fetch('/analytics', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,id}),keepalive:true}).catch(()=>{}); };
  window.addEventListener('practice-analytics', e => track(e.detail));
  if (location.pathname === '/') track('landing_viewed');
  if (location.pathname === '/new') track(new URLSearchParams(location.search).get('mode') === 'join' ? 'join_opened' : 'create_opened');
  document.querySelector('.landing-cta')?.addEventListener('click', () => track('start_practice_clicked'));
})();
