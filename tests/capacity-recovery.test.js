import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test("rejected startup and confirmed remote closure recover without clearing manual kill; scoring does not occupy voice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-capacity-"));
  for (const p of ["src", "public", "profiles", "grounding", "package.json"])
    cpSync(p, join(dir, p), { recursive: true });
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  writeFileSync(
    join(dir, "src/provider.js"),
    `import {EventEmitter} from 'node:events';let n=0;
 export function key(){throw Error('No paid API');}
 export async function createLive(){if(++n===1)throw Object.assign(Error('HTTP 429'),{creationRejected:true});return {session:{id:'fake-'+n},transport:{sdp:'answer'}};}
 export function attach(){const ws=new EventEmitter();ws.readyState=1;ws.send=()=>{};ws.close=()=>{ws.readyState=3;};setTimeout(()=>{ws.emit('open');ws.emit('message',JSON.stringify({type:'session.started'}));ws.emit('message',JSON.stringify({type:'session.input_transcript.delta',delta:'Synthetic startup answer.',start_ms:0,end_ms:1000}));},10);return ws;}
 export async function hangup(){}
 `,
  );
  writeFileSync(
    join(dir, "src/scorecard.js"),
    `export const SCORE_RESERVE=.05;export function markdown(){return '';}export async function score(){await new Promise(r=>setTimeout(r,1500));return {card:{verdict:'maybe'},cost:.001,usage:{}};}`,
  );
  const origin = "http://localhost:44334";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: "44334",
      MP_PAID_ENABLED: "1",
      MP_APPROVED_USD: "10",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((ok, no) => {
      child.stdout.once("data", ok);
      child.once("exit", () => no(Error("startup")));
    });
    const post = (path, b) =>
      fetch(origin + path, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
    const state = async () => await (await fetch(origin + "/api/state")).json();
    const body = {
      profile: "speedrun-10",
      consent: true,
      synthetic: true,
      sdp: "synthetic-offer-long-enough",
    };
    assert.equal((await post("/api/sessions", body)).status, 400);
    let s = await state();
    assert.equal(s.kill, false);
    assert.equal(s.processing, false);
    assert.equal(s.total, 0.6);
    const response = await post("/api/sessions", body);
    assert.equal(response.status, 201);
    const session = await response.json();
    await post("/api/sessions/" + session.id + "/end", {reason:"ai_room_disconnected"});
    await wait(1800);
    s = await state();
    assert.equal(s.processing, false);
    assert.equal(s.kill, false);
    assert.equal(s.cooldownUntil, 0);
    assert.equal(
      s.sessions.find((x) => x.id === session.id).remoteClosed,
      true,
    );
    const previous = s.sessions.find((x) => x.id === session.id);
    assert.equal(previous.status, "unconfirmed");
    assert.equal(previous.stopReason, "ai_room_disconnected");
    assert.equal(previous.finalUsageConfirmed, false);
    assert.equal(previous.cost, 0.6);
    assert.equal(previous.scoreStatus, "queued");
    // Generate a scorecard for the previous session while starting another voice call.
    const scoring = post("/api/sessions/" + session.id + "/scorecard", {});
    await wait(100);
    s = await state();
    assert.equal(s.processing, false);
    assert.equal(s.backgroundProcessing, true);
    const next = await post("/api/sessions", body);
    assert.equal(next.status, 201);
    assert.equal((await scoring).status, 200);
    const scored = (await state()).sessions.find(x => x.id === session.id);
    assert.equal(scored.scoreStatus, "complete");
    assert.equal(scored.status, "unconfirmed");
    assert.equal(scored.cost, 0.601);
    assert.equal(scored.finalUsageConfirmed, false);
    const nextSession = await next.json();
    await post("/api/sessions/" + nextSession.id + "/end", {reason:"heartbeat_failed"});
    let automatic;
    for (let attempt=0; attempt<40; attempt++) {
      automatic = (await state()).sessions.find(x => x.id === nextSession.id);
      if (automatic.scorecard) break;
      await wait(200);
    }
    assert.equal(automatic.scoreStatus, "complete");
    assert.equal(automatic.status, "unconfirmed");
    assert.equal(automatic.stopReason, "heartbeat_failed");
    assert.equal(automatic.cost, 0.601);
    await post("/api/kill", { enabled: true });
    await wait(1800);
    assert.equal((await state()).kill, true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy and crashed sessions recover conservatively without clearing operator kill", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-restart-"));
  for (const p of ["src", "public", "profiles", "grounding", "package.json"])
    cpSync(p, join(dir, p), { recursive: true });
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  const { openStore } = await import("../src/store.js");
  // openStore's private-directory setup is harmless; use the isolated path.
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "private"));
  const store = openStore(join(dir, "private/mock-partner.sqlite"));
  for (const [id, status] of [
    ["legacy", "unconfirmed"],
    ["crashed", "live"],
  ])
    store.save({
      id,
      created: Date.now(),
      status,
      providerId: id,
      cost: 0.7,
      scoreCost: 0.05,
      agendaCost: 0.05,
      captionCost: 0,
      transcript: [],
      errors: [],
    });
  store.set("kill", true);
  store.db.close();
  writeFileSync(
    join(dir, "src/provider.js"),
    `export function key(){throw Error('No paid API');}export async function createLive(){throw Error('No creation');}export function attach(){}export async function hangup(){}`,
  );
  const origin = "http://localhost:44335";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: dir,
    env: { ...process.env, PORT: "44335" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((ok, no) => {
      child.stdout.once("data", ok);
      child.once("exit", () => no(Error("startup")));
    });
    const state = async () => await (await fetch(origin + "/api/state")).json();
    assert.equal((await state()).processing, true);
    for (let i = 0; i < 60 && (await state()).processing; i++) await wait(100);
    const done = await state();
    assert.equal(done.processing, false);
    assert.equal(done.kill, true);
    assert.ok(Math.abs(done.total - 1.4) < 1e-9);
    assert.ok(
      done.sessions.every(
        (r) => r.remoteClosed && r.recoveryAttempts === 1 && r.recoveredAt,
      ),
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  }
});
