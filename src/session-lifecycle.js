// Keep financial reconciliation separate from availability of interview feedback.
export function canScore(record) {
  return record.status === "complete" ||
    (record.status === "unconfirmed" && record.remoteClosed === true && !record.recoveryRequired);
}
export function endReason(value) {
  return new Set(["manual", "page_left", "room_reconnecting", "room_disconnected",
    "ai_room_disconnected", "ai_track_ended", "provider_connection_failed",
    "audio_context_suspended", "heartbeat_failed", "audio_publish_failed", "startup_failed"])
    .has(value) ? value : "manual";
}
