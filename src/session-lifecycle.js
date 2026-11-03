// Keep financial reconciliation separate from availability of interview feedback.
export function canScore(record) {
  return (
    record.status === "complete" ||
    (record.status === "unconfirmed" &&
      record.remoteClosed === true &&
      !record.recoveryRequired)
  );
}
export function endReason(value) {
  return new Set([
    "manual",
    "page_left",
    "room_reconnecting",
    "room_disconnected",
    "ai_room_disconnected",
    "ai_track_ended",
    "provider_connection_failed",
    "audio_context_suspended",
    "heartbeat_failed",
    "audio_publish_failed",
    "startup_failed",
  ]).has(value)
    ? value
    : "manual";
}

// Provider final usage confirms billing, not successful completion of an interview.
export function providerClosure(record, event, stopping) {
  const known = new Set([
    "close_requested",
    "expired",
    "content",
    "remote_hangup",
    "connection_lost",
  ]);
  const reason = known.has(event.reason) ? event.reason : "unknown";
  record.providerCloseReason = reason;
  const expectedExpiry =
    reason === "expired" &&
    record.started &&
    Date.now() - record.started >= 600000;
  if (!stopping && !expectedExpiry) {
    record.interrupted = true;
    record.stopReason ||= "provider_" + reason;
    record.errors.push({ code: "unexpected_provider_close", reason });
  }
}
