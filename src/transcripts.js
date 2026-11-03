// Authenticated microphone identities + live activity are independent of text
// transcription. Use a single unambiguous source only; never guess through overlap.
export function microphoneAt(record, turn) {
  const frames = record.speakerFrames || [];
  const offset = Math.max(
    0,
    (record.started || record.created || 0) - (record.created || 0),
  );
  turn = {
    ...turn,
    start_ms: turn.start_ms + offset,
    end_ms: turn.end_ms + offset,
  };
  const prior = frames.filter((f) => f.at <= turn.start_ms).at(-1);
  const during = frames.filter(
    (f) => f.at > turn.start_ms && f.at <= turn.end_ms,
  );
  const evidence = [...(prior ? [prior] : []), ...during];
  if (
    !prior ||
    turn.start_ms - prior.at > 3000 ||
    !evidence.length ||
    turn.end_ms - evidence.at(-1).at > 3000
  )
    return null;
  let identity;
  for (const f of evidence) {
    // Sampled speaking activity cannot identify brief handoffs between founders.
    // Multi-founder text waits for the per-microphone caption; solo fallback is safe.
    const ps = f.people.length === 1 ? f.people : [];
    if (ps.length !== 1 || (identity && identity.id !== ps[0].id)) return null;
    identity = ps[0];
  }
  return identity
    ? { speakerId: identity.id, speakerName: identity.name }
    : null;
}
export function speakerFrame(record, people, at) {
  record.speakerFrames ||= [];
  record.speakerFrames.push({ at, people });
  if (record.speakerFrames.length > 400) record.speakerFrames.shift();
}
export function attributedTranscript(record) {
  const named = record.namedTranscript || [];
  if (!record.namedTranscription) return record.transcript;
  const covered = (record.captionChunks || []).filter(
    (c) => c.status === "complete" && c.hasText,
  );
  const failed = (record.captionChunks || []).filter(
    (c) => c.status === "failed",
  );
  const mixed = record.transcript
    .filter(
      (t) =>
        t.speaker !== "founders" ||
        !covered.some((c) => {
          const midpoint = (t.start_ms + t.end_ms) / 2;
          return (
            midpoint >= c.start_ms &&
            midpoint <= c.end_ms &&
            !failed.some((f) => midpoint >= f.start_ms && midpoint <= f.end_ms)
          );
        }),
    )
    .map((t) =>
      t.speaker === "founders"
        ? {
            ...t,
            ...(microphoneAt(record, t) || {
              speakerName: "Unattributed microphone",
            }),
          }
        : t,
    );
  return [...mixed, ...named].sort(
    (a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms,
  );
}
export function groupTurns(items) {
  const turns = [];
  for (const item of items) {
    const last = turns.at(-1);
    if (
      last &&
      !item.segmentId &&
      !last.segmentId &&
      last.speaker === item.speaker &&
      last.speakerId === item.speakerId &&
      item.start_ms - last.end_ms < 4000
    ) {
      last.text += item.text;
      last.end_ms = Math.max(last.end_ms, item.end_ms);
    } else turns.push({ ...item });
  }
  return turns;
}
