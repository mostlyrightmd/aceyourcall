import test from "node:test";
import assert from "node:assert/strict";
import {
  groupTranscript,
  validateScorecard,
  scoreSchema,
  score,
  SCORE_RESERVE,
} from "../src/scorecard.js";
const transcript = [
  { speaker: "founders", text: "We have ", start_ms: 1000, end_ms: 1300 },
  { speaker: "founders", text: "three users.", start_ms: 1300, end_ms: 2000 },
];
const record = {
  application: "The company has three users.",
  facts: {},
  transcript,
};
function card() {
  return {
    scores: [
      "intro_clarity",
      "team_story",
      "slope",
      "traction_honesty",
      "market_depth",
      "chemistry",
      "concision",
      "candor",
    ].map((criterion) => ({
      criterion,
      score: 5,
      quote: "We have three users.",
    })),
    weakest_answers: [
      {
        timestamp_seconds: 1,
        quote: "We have three users.",
        better_answer: "We have three users.",
        evidence_quotes: ["three users."],
      },
    ],
    coverage: ["R1"],
    weak_ids: [],
  };
}
test("transcript preserves exact delta spacing while grouping utterances", () =>
  assert.equal(groupTranscript(transcript)[0].text, "We have three users."));
test("scorecard omits fabricated quotations without losing verified feedback", () => {
  const c = card();
  c.scores[0].quote = "We have a million users";
  assert.equal(
    validateScorecard(c, record, [{ id: "R1" }]).scores[0].quote,
    "",
  );
});
test("rewrites without verified evidence become FILL", () => {
  const c = card();
  c.weakest_answers[0].evidence_quotes = ["a million users"];
  assert.match(
    validateScorecard(c, record, [{ id: "R1" }]).weakest_answers[0]
      .better_answer,
    /FILL/,
  );
});
test("scorecard omits answers with unverified timestamps", () => {
  const c = card();
  c.weakest_answers[0].timestamp_seconds = 60;
  assert.deepEqual(
    validateScorecard(c, record, [{ id: "R1" }]).weakest_answers,
    [],
  );
});
test("scorecard requires all rubric dimensions and known coverage", () => {
  const c = card();
  c.coverage = ["invented"];
  assert.throws(() => validateScorecard(c, record, [{ id: "R1" }]));
});
test("model cannot smuggle unsupported claims into an evidence-backed answer", () => {
  const c = card();
  c.weakest_answers[0].better_answer =
    "We have three users and ten million in revenue.";
  assert.equal(
    validateScorecard(c, record, [{ id: "R1" }]).weakest_answers[0]
      .better_answer,
    "three users.",
  );
});

test("provider schema constrains question IDs while allowing an unlisted follow-up", () => {
  const a = scoreSchema([{ id: "R1" }]),
    b = scoreSchema([{ id: "R2" }]);
  assert.deepEqual(a.properties.coverage.items.enum, ["R1"]);
  assert.deepEqual(b.properties.weak_ids.items.enum, ["R2"]);
  assert.deepEqual(
    a.properties.weakest_answers.items.properties.question_id.enum,
    ["R1", "unlisted"],
  );
  assert.throws(() => scoreSchema([]));
});

test("scorecard retries truncated output once and accounts for both responses", async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  let calls = 0,
    mode = "recover";
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      calls++;
      assert.equal(body.max_output_tokens, calls === 1 ? 8000 : 12000);
      assert.equal(body.reasoning.effort, "low");
      assert.equal(body.store, false);
      if (mode === "http") return { ok: false, status: 429 };
      const complete = calls === 2 && mode === "recover";
      return {
        ok: true,
        json: async () => ({
          status: complete ? "completed" : "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          usage: {
            input_tokens: 1000,
            output_tokens: complete ? 1600 : body.max_output_tokens,
          },
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: complete ? JSON.stringify(card()) : '{"scores":[',
                },
              ],
            },
          ],
        }),
      };
    };
    const result = await score(record, [{ id: "R1" }]);
    assert.equal(calls, 2);
    assert.deepEqual(result.usage, { input_tokens: 2000, output_tokens: 9600 });
    assert.ok(Math.abs(result.cost - 0.005) < 1e-10);
    assert.ok((2 * 180000 * 0.1 + 20000 * 0.5) / 1e6 < SCORE_RESERVE);
    calls = 0;
    mode = "truncated";
    await assert.rejects(score(record, [{ id: "R1" }]), /output incomplete/);
    assert.equal(calls, 2);
    calls = 0;
    mode = "http";
    await assert.rejects(score(record, [{ id: "R1" }]), /HTTP 429/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
