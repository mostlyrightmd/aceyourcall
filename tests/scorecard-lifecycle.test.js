import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
test("scorecard running, failure, retry and interrupted states persist without duplicate charges", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-score-state-"));
  for (const path of ["src", "public", "profiles", "grounding", "package.json"])
    cpSync(path, join(dir, path), { recursive: true });
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "private"));
  const db = new DatabaseSync(join(dir, "private/mock-partner.sqlite"));
  db.exec(
    "CREATE TABLE records(id TEXT PRIMARY KEY, created INTEGER, data TEXT);",
  );
  const id = "10000000-0000-4000-8000-000000000001",
    interrupted = "10000000-0000-4000-8000-000000000002";
  for (const [key, scoreStatus] of [
    [id, undefined],
    [interrupted, "running"],
  ]) {
    const r = {
      id: key,
      created: Date.now(),
      status: "complete",
      cost: 0,
      errors: [],
      transcript: [
        {
          speaker: "founders",
          text: "Synthetic answer",
          start_ms: 0,
          end_ms: 1000,
        },
      ],
      scoreStatus,
    };
    db.prepare("INSERT INTO records VALUES(?,?,?)").run(
      key,
      r.created,
      JSON.stringify(r),
    );
  }
  db.close();
  writeFileSync(
    join(dir, "src/scorecard.js"),
    `import {existsSync} from 'node:fs';export const SCORE_RESERVE=.05;export function markdown(){return '';};let attempts=0;export async function score(){attempts++;if(attempts===1){while(!existsSync('private/release'))await new Promise(r=>setTimeout(r,10));throw Error('Synthetic evidence validation failure');}return {card:{verdict:'maybe'},cost:.001,usage:{input_tokens:1,output_tokens:1}};}`,
  );
  const origin = "http://localhost:44327";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: "44327",
      MP_PAID_ENABLED: "1",
      MP_APPROVED_USD: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((ok, no) => {
      child.stdout.once("data", ok);
      child.once("exit", () => no(Error("startup failed")));
    });
    const state = async () => await (await fetch(origin + "/api/state")).json();
    const get = async (key) =>
      (await state()).sessions.find((s) => s.id === key);
    const request = () =>
      fetch(origin + "/api/sessions/" + id + "/scorecard", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{}",
      });
    assert.equal((await get(interrupted)).scoreStatus, "failed");
    const pending = request();
    for (let i = 0; i < 100 && (await get(id)).scoreStatus !== "running"; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal((await get(id)).scoreStatus, "running");
    assert.equal((await request()).status, 400);
    assert.equal((await get(id)).scoreCost, 0.05);
    writeFileSync(join(dir, "private/release"), "yes");
    assert.equal((await pending).status, 400);
    const failed = await get(id);
    assert.equal(failed.scoreStatus, "failed");
    assert.match(failed.scoreError, /retry/);
    assert.equal(failed.errors.at(-1).code, "scorecard_failed");
    assert.equal((await request()).status, 200);
    const done = await get(id);
    assert.equal(done.scoreStatus, "complete");
    assert.equal(done.scoreError, null);
    assert.equal(done.scorecard.verdict, "maybe");
    assert.ok(Math.abs(done.cost - 0.051) < 1e-9);
    assert.equal((await request()).status, 200);
    assert.equal((await get(id)).cost, done.cost);
    // A newly completed interview is picked up without any browser request.
    const queuedId = "10000000-0000-4000-8000-000000000003";
    const queued = {
      ...done,
      id: queuedId,
      ended: Date.now() - 21000,
      scorecard: undefined,
      scoreStatus: "queued",
      scoreCost: 0,
      cost: 0,
    };
    const writer = new DatabaseSync(join(dir, "private/mock-partner.sqlite"));
    writer
      .prepare("INSERT INTO records VALUES(?,?,?)")
      .run(queuedId, queued.created, JSON.stringify(queued));
    writer.close();
    for (let i = 0; i < 60 && !(await get(queuedId)).scorecard; i++)
      await new Promise((r) => setTimeout(r, 50));
    const automatic = await get(queuedId);
    assert.equal(automatic.scoreStatus, "complete");
    assert.ok(Math.abs(automatic.cost - 0.001) < 1e-9);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal((await get(queuedId)).cost, automatic.cost);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  }
});
