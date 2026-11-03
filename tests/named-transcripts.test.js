import test from "node:test";
import assert from "node:assert/strict";
import { attributedTranscript, groupTurns } from "../src/transcripts.js";
import { validateCaption, wav } from "../src/named-transcription.js";
const id = "10000000-0000-4000-8000-000000000001";
test("separate microphones preserve names and overlapping turns without merging people", () => {
  const turns = [
    {
      speaker: "founders",
      speakerId: "a",
      speakerName: "Alex",
      text: "Product.",
      start_ms: 0,
      end_ms: 500,
      segmentId: "1",
    },
    {
      speaker: "founders",
      speakerId: "b",
      speakerName: "Bea",
      text: "Customers.",
      start_ms: 200,
      end_ms: 600,
      segmentId: "2",
    },
  ];
  assert.equal(groupTurns(turns).length, 2);
  assert.equal(groupTurns(turns)[1].speakerName, "Bea");
  const r = {
    namedTranscription: true,
    transcript: [
      { speaker: "founders", text: "Mixed", start_ms: 0, end_ms: 500 },
      { speaker: "partner", text: "Next?", start_ms: 800, end_ms: 900 },
    ],
    namedTranscript: turns,
    captionChunks: [
      { status: "complete", hasText: true, start_ms: 0, end_ms: 600 },
    ],
  };
  assert.deepEqual(
    attributedTranscript(r).map((t) => t.text),
    ["Product.", "Customers.", "Next?"],
  );
  r.captionChunks.push({ status: "failed", start_ms: 0, end_ms: 600 });
  assert.ok(
    attributedTranscript(r).some(
      (t) => t.speakerName === "Unattributed microphone",
    ),
  );
});
test("missing and empty named captions preserve unattributed text; historical transcripts remain readable", () => {
  const transcript = [
    { speaker: "founders", text: "Keep this", start_ms: 100, end_ms: 300 },
  ];
  assert.equal(attributedTranscript({ transcript }), transcript);
  assert.equal(
    attributedTranscript({
      namedTranscription: true,
      transcript,
      namedTranscript: [],
      captionChunks: [
        { status: "complete", hasText: false, start_ms: 0, end_ms: 500 },
      ],
    }).length,
    1,
  );
});
test("caption validation bounds duration, timing, identity and PCM before any paid call", () => {
  const b = {
    chunkId: id,
    speakerId: id,
    speakerName: "Alex",
    start_ms: 0,
    end_ms: 1000,
    pcm: Buffer.alloc(32000).toString("base64"),
  };
  const result = validateCaption(b, 1000);
  assert.equal(result.cost, 0.0045 / 60);
  assert.equal(wav(result.pcm).length, 32044);
  assert.equal(wav(result.pcm).readUInt32LE(24), 16000);
  for (const change of [
    { end_ms: 100000 },
    { speakerId: "interviewer" },
    { pcm: "!bad" },
    { pcm: Buffer.alloc(400000).toString("base64") },
    { start_ms: -1 },
    { speakerName: "" },
  ])
    assert.throws(() => validateCaption({ ...b, ...change }, 1000));
});
