import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../src/store.js";
import {
  preparationCache,
  publicResearchInput,
} from "../src/business-preparation.js";
import { sessionCaption, validateCaption } from "../src/named-transcription.js";
import { microphoneAt } from "../src/transcripts.js";
import {
  questionHistory,
  remainingQuestions,
  phaseMessage,
} from "../src/interview.js";
test("caption origin tolerates 3.751 second provider startup and trims pre-start PCM", () => {
  const rec = { created: 1000, started: 4751 };
  const packet = {
    chunkId: randomUUID(),
    speakerId: randomUUID(),
    speakerName: "Alex",
    timebase: "created",
    start_ms: 5000,
    end_ms: 7000,
    pcm: Buffer.alloc(64000).toString("base64"),
  };
  const fixed = sessionCaption(packet, rec);
  assert.equal(fixed.start_ms, 1249);
  assert.equal(fixed.end_ms, 3249);
  assert.equal(validateCaption(fixed, 3500).pcm.length, 64000);
  assert.throws(() => validateCaption(packet, 3500), /timing/);
  const early = sessionCaption(
    { ...packet, start_ms: 3000, end_ms: 5000 },
    rec,
  );
  assert.equal(early.start_ms, 0);
  assert.equal(validateCaption(early, 1500).pcm.length, 39968);
  assert.equal(
    sessionCaption({ ...packet, start_ms: 0, end_ms: 2000 }, rec).beforeStart,
    true,
  );
  assert.throws(
    () => validateCaption({ ...fixed, end_ms: 620000 }, 620000),
    /timing/,
  );
});
test("speaker activity attributes a known solo speaker, but refuses overlap or stale evidence", () => {
  const alex = { id: "a", name: "Alex", speaking: true },
    bea = { id: "b", name: "Bea", speaking: true };
  const record = {
    speakerFrames: [
      { at: 0, people: [alex] },
      { at: 2000, people: [alex] },
    ],
  };
  assert.equal(
    microphoneAt(record, { start_ms: 500, end_ms: 2500 }).speakerName,
    "Alex",
  );
  assert.equal(microphoneAt(record, { start_ms: 10000, end_ms: 11000 }), null);
  record.speakerFrames[1].people = [alex, bea];
  assert.equal(microphoneAt(record, { start_ms: 500, end_ms: 2500 }), null);
});
test("backchannels do not split question coverage; covered candidates never return at a phase change", () => {
  const t = [
    { speaker: "partner", text: "What is your ", start_ms: 0, end_ms: 1000 },
    { speaker: "founders", text: "Yeah", start_ms: 500, end_ms: 900 },
    {
      speaker: "partner",
      text: "first milestone?",
      start_ms: 1000,
      end_ms: 2000,
    },
  ];
  assert.deepEqual(questionHistory(t), ["What is your first milestone?"]);
  const qs = [
    { id: "a", question: "What is your first milestone?" },
    { id: "b", question: "Who are your competitors?" },
    { id: "c", question: "How do you recruit engineers?" },
  ];
  assert.deepEqual(
    remainingQuestions(qs, t, ["b"]).map((q) => q.id),
    ["c"],
  );
  const msg = phaseMessage("L", 100, qs, t, ["b"]);
  assert.ok(!msg.content.includes("competitors"));
  assert.ok(msg.content.length < 1600);
});
test("preparation persists derived context, reuses cache and never persists raw application", async () => {
  const store = openStore(":memory:", { ephemeralApplications: true });
  let runs = 0,
    reserves = 0;
  const result = {
    brief: "Derived brief. ".repeat(20),
    questions: Array.from({ length: 24 }, (_, i) => ({
      phase: "P",
      facet: "facet " + i,
      question: "What is your distinct product angle " + i + "?",
      id: "B" + i,
    })),
  };
  const opts = {
    available: () => true,
    reserve: () => reserves++,
    run: async () => {
      runs++;
      return result;
    },
  };
  const cache = preparationCache(store, opts),
    room = randomUUID(),
    context = { application: "PRIVATE UNIQUE RAW APPLICATION", facts: {} };
  const job = cache.enqueue(room, context);
  await cache.tick();
  assert.equal(cache.get(job.id).status, "ready");
  const restored = preparationCache(store, opts);
  assert.equal(restored.enqueue(room, context).id, job.id);
  assert.equal(restored.enqueue(randomUUID(), context).id, job.id);
  await restored.tick();
  assert.equal(runs, 1);
  assert.equal(reserves, 1);
  const rows = store.db.prepare("SELECT data FROM business_preparation").all();
  assert.ok(!JSON.stringify(rows).includes(context.application));
  const changed = restored.enqueue(room, {
    ...context,
    application: context.application + " changed",
  });
  assert.notEqual(changed.id, job.id);
  assert.equal(restored.enqueue(randomUUID(), context).id, job.id);
  store.db.close();
});

test("public search cannot receive model-produced secrets or URL query/path data", () => {
  assert.deepEqual(
    publicResearchInput(
      "Our site is https://example.com/private?token=secret",
      {
        website: "https://example.com/private?token=secret",
        company: "private revenue",
        sector: "secret founder diagnosis",
      },
    ),
    { website: "https://example.com" },
  );
  assert.deepEqual(
    publicResearchInput("private application", {
      website: "https://secret.example.com",
      sector: "my private secret",
    }),
    { sector: "software" },
  );
});

test("speaker frames retain creation-time origin across delayed provider start", () => {
  const a = { id: "a", name: "Alex" },
    b = { id: "b", name: "Bea" };
  const record = {
    created: 1000,
    started: 4751,
    speakerFrames: [
      { at: 0, people: [a] },
      { at: 3000, people: [b] },
      { at: 5000, people: [b] },
    ],
  };
  assert.equal(
    microphoneAt(record, { start_ms: 100, end_ms: 1400 }).speakerName,
    "Bea",
  );
  record.speakerFrames[2].people = [a, b];
  assert.equal(microphoneAt(record, { start_ms: 100, end_ms: 1400 }), null);
});

test("preparation identity is stable for line endings and note order but changes with evidence", async () => {
  const { preparationIdentity } =
    await import("../src/preparation-identity.js");
  assert.equal(
    preparationIdentity({
      application: " hello\r\nworld ",
      facts: { b: 2, a: 1 },
    }),
    preparationIdentity({ application: "hello\nworld", facts: { a: 1, b: 2 } }),
  );
  assert.notEqual(
    preparationIdentity({ application: "hello", facts: { a: 1 } }),
    preparationIdentity({ application: "hello", facts: { a: 2 } }),
  );
});
