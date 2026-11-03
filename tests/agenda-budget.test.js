import test from "node:test";
import assert from "node:assert/strict";
import { inspectAgenda, AGENDA_RESERVE } from "../src/agenda.js";
test("agenda output budget covers reasoning and all candidate IDs; incomplete output retains usage", async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  let incomplete = false;
  try {
    globalThis.fetch = async (_url, init) => {
      const b = JSON.parse(init.body);
      assert.equal(b.max_output_tokens, 1200);
      // Worst-case byte-sized input tokens and max output still fit the reservation.
      assert.ok(
        (55000 * 0.1 + b.max_output_tokens * 0.5) / 1e6 < AGENDA_RESERVE,
      );
      return {
        ok: true,
        json: async () => ({
          status: incomplete ? "incomplete" : "completed",
          usage: { input_tokens: 1507, output_tokens: incomplete ? 1200 : 420 },
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    derailment: false,
                    repair_interviewer: false,
                    evidence: "",
                    covered_questions: ["R1", "P1"],
                  }),
                },
              ],
            },
          ],
        }),
      };
    };
    const args = {
      profile: { id: "speedrun-10" },
      application: "Synthetic garden scheduler",
      context: "Two gardeners returned, actually only one is a real user.",
      input: "Only one is a real user.",
    };
    const valid = await inspectAgenda(args);
    assert.deepEqual(valid.decision.covered_questions, ["R1", "P1"]);
    incomplete = true;
    const truncated = await inspectAgenda(args);
    assert.equal(truncated.decision, null);
    assert.equal(truncated.failure, "agenda_output_incomplete");
    assert.ok(truncated.cost > valid.cost);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
