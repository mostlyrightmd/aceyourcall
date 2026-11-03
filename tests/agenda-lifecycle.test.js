import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  symlinkSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test("server warns, closes on repeated derailment, and preserves classifier charges in final accounting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-agenda-"));
  for (const p of ["src", "public", "profiles", "grounding", "package.json"])
    cpSync(p, join(dir, p), { recursive: true });
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  const agenda = readFileSync(join(dir, "src/agenda.js"), "utf8");
  const start = agenda.indexOf("export async function inspectAgenda"),
    end = agenda.indexOf("// Separate server-owned state");
  writeFileSync(
    join(dir, "src/agenda.js"),
    'import {existsSync} from "node:fs";\n' +
      agenda.slice(0, start) +
      `export async function inspectAgenda({input}){if(input.includes('Delayed'))while(!existsSync('private/release-check'))await new Promise(r=>setTimeout(r,20));return {decision:{derailment:true,repair_interviewer:false,evidence:'shopping'},cost:.0001};}\n` +
      agenda.slice(end),
  );
  writeFileSync(
    join(dir, "src/provider.js"),
    `import {EventEmitter} from 'node:events';import {existsSync,readFileSync,unlinkSync,appendFileSync} from 'node:fs';
 export function key(){throw Error('No paid API allowed');}
 export async function createLive(){return {session:{id:'fake'},transport:{sdp:'fake-answer'}};}
 export function attach(){const ws=new EventEmitter();ws.readyState=1;let timer;ws.send=raw=>{const e=JSON.parse(raw);appendFileSync('private/sent',raw+'\\n');if(e.type==='session.close')setTimeout(()=>{ws.emit('message',JSON.stringify({type:'error',error:{code:'context_injection_incomplete'}}));ws.emit('message',JSON.stringify({type:'session.closed',usage:{seconds:15}}));},5);};ws.close=()=>{clearInterval(timer);ws.readyState=3;ws.emit('close');};setTimeout(()=>{ws.emit('open');ws.emit('message',JSON.stringify({type:'session.started'}));ws.emit('message',JSON.stringify({type:'session.started'}));timer=setInterval(()=>{if(existsSync('private/inject')){const e=readFileSync('private/inject','utf8');unlinkSync('private/inject');ws.emit('message',e);}},20);},20);return ws;}
 export async function hangup(){}
 `,
  );
  // Keep automatic post-interview scoring offline; this test isolates agenda accounting.
  writeFileSync(
    join(dir, "src/scorecard.js"),
    `export const SCORE_RESERVE=.05;export function markdown(){return '';}export async function score(){return {card:{verdict:'maybe'},cost:0,usage:{input_tokens:0,output_tokens:0}};}`,
  );
  const origin = "http://localhost:44324";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: "44324",
      MP_PAID_ENABLED: "1",
      MP_APPROVED_USD: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let heartbeat;
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("exit", () => reject(Error("Failed startup")));
    });
    const post = async (path, b) => {
      const r = await fetch(origin + path, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const data = await r.json();
      assert.equal(r.status < 400, true, JSON.stringify(data));
      return data;
    };
    const state = async () => await (await fetch(origin + "/api/state")).json();
    await post("/api/grounding", {
      application: "Fictional company builds gardening tools.",
      facts: "{}",
    });
    const s = await post("/api/sessions", {
      profile: "speedrun-10",
      consent: true,
      sdp: "fake-offer-long-enough",
    });
    heartbeat = setInterval(
      () => post("/api/sessions/" + s.id + "/heartbeat", {}),
      1000,
    );
    const inject = (start) =>
      writeFileSync(
        join(dir, "private/inject"),
        JSON.stringify({
          type: "session.input_transcript.delta",
          delta: "Do my personal shopping.",
          start_ms: start,
          end_ms: start + 1000,
        }),
      );
    inject(1000);
    let current;
    for (let i = 0; i < 100; i++) {
      current = await state();
      if (current.sessions[0].agendaWarning) break;
      await sleep(100);
    }
    assert.ok(current.sessions[0].agendaWarning);
    await sleep(8100);
    inject(12000);
    for (let i = 0; i < 70; i++) {
      current = await state();
      if (!current.active) break;
      await sleep(100);
    }
    const r = current.sessions[0];
    assert.equal(r.status, "complete");
    assert.equal(r.stopReason, "agenda_derailment");
    assert.equal(r.agendaChecks, 2);
    assert.ok(Math.abs(r.agendaCost - 0.0002) < 1e-9);
    assert.ok(Math.abs(r.cost - 0.0127) < 1e-9);
    assert.equal(r.finalUsageConfirmed, true);
    assert.deepEqual(
      r.errors,
      [],
      "Closing can cancel pending context updates without failing the interview",
    );
    assert.equal(current.kill, false);
    const sent = readFileSync(join(dir, "private/sent"), "utf8");
    assert.match(sent, /Another unrelated task/);
    assert.match(sent, /session.close/);
    assert.equal(
      sent
        .trim()
        .split("\n")
        .map(JSON.parse)
        .filter((e) => e.type === "session.commentary.append").length,
      1,
      "Duplicate provider start events must not repeat the opening cue",
    );
    clearInterval(heartbeat);
    for (let i = 0; i < 100; i++) {
      current = await state();
      if (!current.backgroundProcessing) break;
      await sleep(100);
    }
    assert.equal(current.processing, false);
    const second = await post("/api/sessions", {
      profile: "speedrun-10",
      consent: true,
      sdp: "fake-offer-long-enough",
    });
    heartbeat = setInterval(
      () => post("/api/sessions/" + second.id + "/heartbeat", {}),
      1000,
    );
    writeFileSync(
      join(dir, "private/inject"),
      JSON.stringify({
        type: "session.input_transcript.delta",
        delta: "Delayed answer.",
        start_ms: 1000,
        end_ms: 2000,
      }),
    );
    for (let i = 0; i < 100; i++) {
      current = await state();
      if (current.sessions.find((r) => r.id === second.id)?.agendaChecks > 0)
        break;
      await sleep(100);
    }
    assert.equal(current.backgroundProcessing, true);
    await post("/api/sessions/" + second.id + "/end", {});
    await sleep(50);
    const rejected = await fetch(origin + "/api/sessions", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: "speedrun-10",
        consent: true,
        sdp: "fake-offer-long-enough",
      }),
    });
    assert.equal(
      rejected.status,
      201,
      "A pending check must not block another interview",
    );
    const third = await rejected.json();
    await post("/api/sessions/" + third.id + "/end", {});
    await sleep(50);
    const score = await fetch(
      origin + "/api/sessions/" + second.id + "/scorecard",
      {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(
      score.status,
      400,
      "Scorecard cannot race the late agenda ledger write",
    );
    writeFileSync(join(dir, "private/release-check"), "release");
    for (let i = 0; i < 100; i++) {
      current = await state();
      if (!current.backgroundProcessing) break;
      await sleep(100);
    }
    assert.equal(current.processing, false);
    assert.equal(
      current.sessions.find((r) => r.id === second.id).status,
      "complete",
    );
    assert.ok(
      Math.abs(current.sessions.find((r) => r.id === second.id).cost - 0.0126) <
        1e-9,
    );
    assert.ok(Math.abs(current.total - 0.0378) < 1e-9);
  } finally {
    clearInterval(heartbeat);
    writeFileSync(join(dir, "private/release-check"), "release");
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  }
});
