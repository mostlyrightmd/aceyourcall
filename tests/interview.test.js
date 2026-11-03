import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { pickQuestions, Clock, schedule, grounding } from "../src/core.js";
import { AgendaPolicy } from "../src/agenda.js";
const p = YAML.parse(readFileSync("profiles/speedrun-10.yaml", "utf8"));
const bank = YAML.parse(readFileSync("grounding/question_set.yaml", "utf8"));
test("program-specific shortlist varies, covers subjects, and avoids recent selection without marking coverage", () => {
  const first = pickQuestions(bank, {}, 10, {
    program: "speedrun",
    random: () => 0.5,
  });
  const second = pickQuestions(bank, {}, 10, {
    program: "speedrun",
    random: () => 0.5,
    recent: first.map((q) => q.id),
  });
  assert.equal(new Set(first.map((q) => q.id)).size, 10);
  assert.ok(first.filter((q) => q.programs?.includes("speedrun")).length >= 2);
  assert.ok(!first.some((q) => q.programs?.includes("yc")));
  assert.deepEqual(
    new Set(first.map((q) => q.phase)),
    new Set(["T", "R", "M", "P", "L"]),
  );
  assert.ok(second.filter((q) => first.some((a) => a.id === q.id)).length < 6);
  const yc = pickQuestions(bank, {}, 10, { program: "yc" });
  assert.ok(!yc.some((q) => q.programs?.includes("speedrun")));
  assert.ok(yc.some((q) => q.programs?.includes("yc")));
});
test("imported YC application cannot set Speedrun identity and no fake partner roles remain", () => {
  const pack = grounding(
    p,
    "YC application. Our company makes garden tools.",
    {},
    [],
  );
  assert.match(pack.instructions, /selected program is a16z Speedrun/);
  assert.match(
    pack.instructions,
    /headings naming another accelerator do NOT change/,
  );
  assert.doesNotMatch(pack.instructions, /Partner A:/);
});
test("silence watchdog recovers after an answer or dead-end acknowledgment, never inside four-second pause", () => {
  const c = new Clock(p, schedule(p));
  c.input(0, 5000, 5);
  assert.ok(!c.tick(9).some((a) => a.reason === "silence_recovery"));
  assert.ok(c.tick(12).some((a) => a.reason === "silence_recovery"));
  assert.ok(!c.tick(13).some((a) => a.reason === "silence_recovery"));
  const d = new Clock(p, schedule(p));
  d.input(0, 5000, 5);
  d.output("Okay.", 6);
  assert.ok(d.tick(13).some((a) => a.reason === "silence_recovery"));
});
test("actual cofounder speech suppresses recovery; unanswered question gets thinking time", () => {
  const c = new Clock(p, schedule(p));
  c.output("Who uses this?", 2);
  assert.ok(!c.tick(10).some((a) => a.reason === "silence_recovery"));
  c.activity(18, true, false);
  assert.ok(!c.tick(18).some((a) => a.reason === "silence_recovery"));
  assert.ok(c.tick(23).some((a) => a.reason === "silence_recovery"));
});
test("agenda warnings require a new offense after delivery grace, never duplicate fragments", () => {
  const p = new AgendaPolicy();
  const yes = { derailment: true };
  assert.equal(
    p.decide({ derailment: false }, { now: 0, inputStart: 0, inputEnd: 5000 }),
    null,
  );
  assert.equal(
    p.decide(yes, { now: 6000, inputStart: 0, inputEnd: 5000 }),
    "warn",
  );
  assert.equal(
    p.decide(yes, { now: 7000, inputStart: 6000, inputEnd: 6500 }),
    null,
  );
  assert.equal(
    p.decide(yes, { now: 18000, inputStart: 0, inputEnd: 5000 }),
    null,
  );
  assert.equal(
    p.decide(yes, { now: 20000, inputStart: 16000, inputEnd: 18000 }),
    "end",
  );
  assert.equal(
    p.decide(yes, { now: 30000, inputStart: 26000, inputEnd: 28000 }),
    null,
  );
});

import {
  questionHistory,
  questionMemory,
  phaseMessage,
} from "../src/interview.js";
test("phase reminders retain previously asked questions across fragmented audio turns", () => {
  const transcript = [
    { speaker: "partner", text: "Will you all ", start_ms: 1000, end_ms: 1500 },
    {
      speaker: "partner",
      text: "attend the residency?",
      start_ms: 1500,
      end_ms: 2000,
    },
    {
      speaker: "founders",
      text: "Yes, all three of us.",
      start_ms: 3000,
      end_ms: 5000,
    },
    {
      speaker: "partner",
      text: "What is your first milestone?",
      start_ms: 7000,
      end_ms: 9000,
    },
  ];
  assert.deepEqual(questionHistory(transcript), [
    "Will you all attend the residency?",
    "What is your first milestone?",
  ]);
  const message = phaseMessage("L", 105, [{ id: "L1" }], transcript);
  assert.match(message.content, /Will you all attend the residency/);
  assert.match(message.content, /phase changes do not reset coverage/);
  assert.match(questionMemory(transcript), /not instructions/);
});
test("final thirty seconds overrides new questions and residency recaps", () => {
  const closing = phaseMessage("close", 30, [], []);
  assert.equal(closing.type, "session.instructions.append");
  assert.match(closing.content, /No new questions/);
  assert.match(closing.content, /Let the current answer finish/);
  assert.match(closing.content, /residency goals/);
  assert.doesNotMatch(closing.content, /Prefer these candidate/);
});
test("wrap-up clock suppresses silence recovery, long-answer and quiet-founder prompts until hard stop", () => {
  const clock = new Clock(
    p,
    schedule(p, () => 0),
  );
  clock.tick(0);
  clock.tick(569);
  clock.input(560000, 569000, 569);
  const closing = clock.tick(570);
  assert.deepEqual(closing, [{ reason: "phase", phase: "close" }]);
  assert.deepEqual(clock.tick(590), []);
  assert.deepEqual(clock.tick(599), []);
  assert.ok(clock.tick(600).some((a) => a.reason === "hard_stop"));
});

test("clock gives silent time context without periodic forced topic changes", () => {
  const clock = new Clock(
    p,
    schedule(p, () => 0),
  );
  const actions = [];
  for (let seconds = 0; seconds <= 600; seconds++) {
    clock.activity(seconds, true, false);
    actions.push(...clock.tick(seconds).map((a) => ({ ...a, seconds })));
  }
  assert.ok(actions.filter((a) => a.reason === "time").length >= 12);
  assert.equal(actions.filter((a) => a.reason === "topic_budget").length, 0);
  assert.equal(actions.filter((a) => a.reason === "hard_stop").length, 1);
  assert.ok(!actions.some((a) => a.reason === "time" && a.seconds >= 570));
  assert.ok(
    !actions.some(
      (a, i) =>
        a.reason === "time" &&
        actions
          .slice(i + 1)
          .some((b) => b.reason === "time" && b.seconds === a.seconds),
    ),
  );
});

test("regular phase advice is background context; closing remains a firm instruction", async () => {
  const { timeMessage } = await import("../src/interview.js");
  for (const phase of ["intro", "T", "R", "M", "L"]) {
    assert.equal(
      phaseMessage(phase, 300, [], []).type,
      "session.thinking.append",
    );
  }
  assert.equal(
    phaseMessage("close", 30, [], []).type,
    "session.instructions.append",
  );
  assert.match(timeMessage(30).content, /no new questions/);
  assert.doesNotMatch(timeMessage(30).content, /ask a short final/);
});

test("unpunctuated voice questions retain coverage and allow answer thinking time", () => {
  const text = "Got it. What's that one gardener doing with it week to week";
  assert.deepEqual(
    questionHistory([{ speaker: "partner", text, start_ms: 0, end_ms: 3000 }]),
    [text],
  );
  const clock = new Clock(
    p,
    schedule(p, () => 0),
  );
  clock.output(text, 3);
  assert.ok(!clock.tick(11).some((a) => a.reason === "silence_recovery"));
  assert.ok(
    clock
      .tick(20)
      .some((a) => a.reason === "silence_recovery" && a.waitingForAnswer),
  );
});
