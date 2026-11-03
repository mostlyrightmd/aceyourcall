// Count substantive completed rehearsals, not research jobs or connection tests.
export function completedInterviews(records) {
  return records.filter(r => r.kind !== "research" && r.status === "complete" &&
    Number.isFinite(r.started) && Number.isFinite(r.ended) && r.ended - r.started >= 60000).length;
}
export function publicStats(pool, now = Date.now) {
  let cache, expires = 0, pending;
  return async () => {
    if (cache && now() < expires) return cache;
    if (!pending) pending = Promise.all(pool.workers.map(w => pool.call("/api/state?summary=1", undefined, w.id)))
      .then(states => {
        if (states.some(s => !Number.isSafeInteger(s.completedInterviews) || s.completedInterviews < 0)) throw Error("Count unavailable");
        cache = { completedInterviews: states.reduce((n, s) => n + s.completedInterviews, 0) };
        expires = now() + 60000;
        return cache;
      }).finally(() => { pending = null; });
    return pending;
  };
}
