export function track(event: string) {
  window.dispatchEvent(new CustomEvent('practice-analytics', {detail:event}));
}
