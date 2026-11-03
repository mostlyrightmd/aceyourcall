import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import YAML from "yaml";
import {
  validateProfile,
  schedule,
  pickQuestions,
  guard,
  grounding,
  Clock,
  voiceCost,
} from "../src/core.js";
const p = YAML.parse(readFileSync("profiles/speedrun-10.yaml", "utf8"));
const bank = YAML.parse(readFileSync("grounding/question_set.yaml", "utf8"));
test("all profiles validate; invalid timing fails", () => {
  for (const f of readdirSync("profiles"))
    validateProfile(YAML.parse(readFileSync("profiles/" + f, "utf8")));
  assert.throws(() => validateProfile({ ...p, duration_seconds: 900 }));
});
test("phase shuffle preserves intro and close and all middle phases", () => {
  const s = schedule(p, () => 0);
  assert.equal(s[0].phase, "intro");
  assert.equal(s.at(-1).phase, "close");
  assert.equal(s.at(-1).at, 570);
  assert.equal(new Set(s.map((x) => x.phase)).size, 6);
  assert.notDeepEqual(
    s.slice(1, 5).map((x) => x.phase),
    ["T", "R", "M", "L"],
  );
});
test("coverage prioritizes unrehearsed and never marks selection as completion", () => {
  const c = { T3: { count: 2 } };
  const chosen = pickQuestions(bank, c, 10);
  assert.equal(chosen.length, 10);
  assert.ok(!chosen.some((q) => q.id === "T3"));
  assert.deepEqual(c, { T3: { count: 2 } });
});
const good = {
  kill: false,
  active: false,
  enabled: true,
  daily: 0,
  cycle: 0,
  approvedRemaining: 1,
};
for (const [name, override] of Object.entries({
  kill: { kill: true },
  concurrency: { active: true },
  disabled: { enabled: false },
  daily: { daily: 14.5 },
  cycle: { cycle: 179.5 },
  allowance: { approvedRemaining: 0.5 },
  invalid: { daily: NaN },
}))
  test("cost guard: " + name, () =>
    assert.throws(() => guard({ ...good, ...override })),
  );
test("cost initialization floor and cumulative duration math", () => {
  assert.equal(voiceCost(0), 0.0125);
  assert.equal(voiceCost(600), 0.5);
  assert.equal(voiceCost(630), 0.525);
  assert.doesNotThrow(() => guard(good));
});
test("grounding treats question premises as data, requires application, and hashes content", () => {
  const a = grounding(
    p,
    "A sample submitted application for a fictional company.",
    {},
    bank.slice(0, 6),
  );
  assert.match(a.instructions, /NOT factual evidence/);
  assert.equal(a.hash.length, 64);
  assert.throws(() => grounding(p, "", {}, []));
  assert.throws(() => grounding(p, "a".repeat(43000), {}, []));
  assert.notEqual(
    a.hash,
    grounding(
      p,
      "A different submitted application for a fictional company.",
      {},
      [],
    ).hash,
  );
});
test("clock never cuts early; long answer cut once; hard stop at 600 once", () => {
  const c = new Clock(
    p,
    schedule(p, () => 0),
  );
  c.input(0, 7000);
  assert.ok(!c.tick(7).some((x) => x.reason === "long_answer"));
  c.input(29000, 30000);
  assert.ok(c.tick(30).some((x) => x.reason === "long_answer"));
  assert.ok(!c.tick(31).some((x) => x.reason === "long_answer"));
  assert.ok(c.tick(600).some((x) => x.reason === "hard_stop"));
  assert.ok(!c.tick(601).some((x) => x.reason === "hard_stop"));
});
test("no transcript-triggered interruption during a thinking pause", () => {
  const c = new Clock(
    p,
    schedule(p, () => 0),
  );
  c.input(0, 27000);
  assert.ok(!c.tick(30.5).some((x) => x.reason === "long_answer"));
});
