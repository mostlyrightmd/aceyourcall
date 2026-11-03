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
        ? { ...t, speakerName: "Unattributed microphone" }
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
