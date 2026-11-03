import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test("named caption reservations survive voice finalization, duplicate requests and provider failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-names-"));
  for (const p of ["src", "public", "profiles", "grounding", "package.json"])
    cpSync(p, join(dir, p), { recursive: true });
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  writeFileSync(
    join(dir, "src/provider.js"),
    `import {EventEmitter} from 'node:events';export function key(){throw Error('No paid API');}export async function createLive(){return {session:{id:'fake'},transport:{sdp:'answer'}};}export function attach(){const ws=new EventEmitter();ws.readyState=1;ws.send=raw=>{if(JSON.parse(raw).type==='session.close')setTimeout(()=>ws.emit('message',JSON.stringify({type:'session.closed',usage:{seconds:15}})),1);};ws.close=()=>{ws.readyState=3;};setTimeout(()=>{ws.emit('open');ws.emit('message',JSON.stringify({type:'session.started'}));},10);return ws;}export async function hangup(){}`,
  );
  const module = readFileSync(join(dir, "src/named-transcription.js"), "utf8");
  writeFileSync(
    join(dir, "src/named-transcription.js"),
    `import {existsSync,appendFileSync} from 'node:fs';\n` +
      module.slice(
        0,
        module.indexOf("export async function transcribeMicrophone"),
      ) +
      `export async function transcribeMicrophone(pcm){appendFileSync('private/caption-calls','1');while(!existsSync('private/release-caption'))await new Promise(r=>setTimeout(r,10));if(pcm.readInt16LE(0)===2)throw Error('synthetic failure');return pcm.readInt16LE(0)===1?'Alex builds the product.':'Bea works with customers.';}`,
  );
  mkdirSync(join(dir, "private"));
  const db = new DatabaseSync(join(dir, "private/mock-partner.sqlite"));
  db.exec(
    "CREATE TABLE records(id TEXT PRIMARY KEY, created INTEGER, data TEXT)",
  );
  const old = {
    id: "old-caption",
    created: Date.now() - 40000,
    ended: Date.now() - 30000,
    status: "complete",
    namedTranscription: true,
    transcript: [],
    namedTranscript: [],
    cost: 0.02,
    captionCost: 0.001,
    captionChunks: [{ status: "running" }],
    errors: [],
  };
  db.prepare("INSERT INTO records VALUES(?,?,?)").run(
    old.id,
    old.created,
    JSON.stringify(old),
  );
  db.close();
  const origin = "http://localhost:44334";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: "44334",
      MP_PAID_ENABLED: "1",
      MP_APPROVED_USD: "1",
    },
    stdio: "pipe",
  });
  const request = (path, data) =>
    fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const state = async () => await (await request("/api/state")).json();
  try {
    await new Promise((r, j) => {
      child.stdout.once("data", r);
      child.once("exit", () => j(Error("exited")));
      setTimeout(() => j(Error("startup")), 5000).unref();
    });
    const recovered = (await state()).sessions.find(
      (r) => r.id === "old-caption",
    );
    assert.equal(recovered.captionChunks[0].status, "failed");
    assert.equal(recovered.captionFinishing, false);
    assert.equal(recovered.cost, 0.02);
    const started = await (
      await request("/api/sessions", {
        profile: "yc-10",
        consent: true,
        sdp: "synthetic-offer-long-enough",
        roomId: "test-room",
        context: {
          application: "Synthetic application about garden tools.",
          facts: {},
        },
        namedTranscription: true,
      })
    ).json();
    assert.ok(started.id, JSON.stringify(started));
    const pcm = Buffer.alloc(32000);
    pcm.writeInt16LE(1);
    const a = {
      chunkId: "10000000-0000-4000-8000-000000000001",
      speakerId: "20000000-0000-4000-8000-000000000001",
      speakerName: "Alex",
      start_ms: 0,
      end_ms: 1000,
      pcm: pcm.toString("base64"),
    };
    const pending = request("/api/sessions/" + started.id + "/caption", a);
    for (
      let i = 0;
      i < 100 && !existsSync(join(dir, "private/caption-calls"));
      i++
    )
      await sleep(10);
    assert.equal(
      (await request("/api/sessions/" + started.id + "/caption", a)).status,
      200,
    );
    assert.equal(
      readFileSync(join(dir, "private/caption-calls"), "utf8").length,
      1,
    );
    const b = {
      ...a,
      chunkId: "10000000-0000-4000-8000-000000000002",
      speakerId: "20000000-0000-4000-8000-000000000002",
      speakerName: "Bea",
      pcm: Buffer.alloc(32000).toString("base64"),
    };
    const other = request("/api/sessions/" + started.id + "/caption", b);
    await sleep(30);
    await request("/api/sessions/" + started.id + "/end", {});
    await sleep(30);
    writeFileSync(join(dir, "private/release-caption"), "yes");
    assert.equal((await pending).status, 200);
    assert.equal((await other).status, 200);
    let r = (await state()).sessions[0];
    assert.equal(r.status, "complete");
    assert.equal(r.transcript.length, 2);
    assert.deepEqual(
      r.transcript.map((t) => t.speakerName).sort(),
      ["Alex", "Bea"],
    );
    assert.ok(Math.abs(r.cost - (0.0125 + (2 * 0.0045) / 60)) < 1e-8);
    assert.equal(r.captionFinishing, true);
    const badpcm = Buffer.alloc(32000);
    badpcm.writeInt16LE(2);
    const fail = {
      ...a,
      chunkId: "10000000-0000-4000-8000-000000000003",
      start_ms: 1000,
      end_ms: 2000,
      pcm: badpcm.toString("base64"),
    };
    assert.equal(
      (await request("/api/sessions/" + started.id + "/caption", fail)).status,
      400,
    );
    r = (await state()).sessions[0];
    assert.equal(r.captionChunks.at(-1).status, "failed");
    assert.ok(Math.abs(r.cost - (0.0125 + (3 * 0.0045) / 60)) < 1e-8);
    assert.equal(
      (
        await request("/api/sessions/" + started.id + "/caption", {
          ...fail,
          chunkId: "10000000-0000-4000-8000-000000000004",
        })
      ).status,
      400,
    );
    assert.equal(
      readFileSync(join(dir, "private/caption-calls"), "utf8").length,
      3,
    );
    const beforeMarker = r.cost;
    assert.equal(
      (
        await request("/api/sessions/" + started.id + "/caption", {
          ...a,
          chunkId: "10000000-0000-4000-8000-000000000005",
          start_ms: 2000,
          end_ms: 2500,
          pcm: undefined,
          failed: true,
        })
      ).status,
      200,
    );
    r = (await state()).sessions[0];
    assert.equal(r.captionChunks.at(-1).status, "failed");
    assert.equal(r.cost, beforeMarker);
    assert.equal(
      readFileSync(join(dir, "private/caption-calls"), "utf8").length,
      3,
    );
    assert.equal(
      (await request("/api/sessions/" + started.id + "/scorecard", {})).status,
      400,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
