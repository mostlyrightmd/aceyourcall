import test from "node:test";
import assert from "node:assert/strict";
import {
  groupTranscript,
  validateScorecard,
  scoreSchema,
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
