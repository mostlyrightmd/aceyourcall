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
test("kill while provider creation is pending closes returned ID and never returns SDP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-race-"));
  for (const p of ["src", "public", "profiles", "grounding", "package.json"])
    cpSync(p, join(dir, p), { recursive: true });
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  writeFileSync(
    join(dir, "src/provider.js"),
    `import {writeFileSync} from 'node:fs';
export function key(){throw new Error('No real key in test');}
export async function createLive(){writeFileSync('private/creating','yes');await new Promise(r=>setTimeout(r,2000));return {session:{id:'synthetic-provider-id'},transport:{sdp:'synthetic-sdp'}};}
export function attach(){throw new Error('Cancelled session must never attach for use');}
export async function hangup(id){writeFileSync('private/closed-id',id);}
`,
  );
  const port = 44320,
    origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: String(port),
      MP_PAID_ENABLED: "1",
      MP_APPROVED_USD: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("startup timeout")),
        10000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", () => reject(new Error("server exited")));
    });
    const post = (path, b) =>
      fetch(origin + path, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
    await post("/api/grounding", {
      application: "Synthetic startup sells gardening tools.",
      facts: "{}",
    });
    const pending = post("/api/sessions", {
      profile: "speedrun-10",
      consent: true,
      sdp: "synthetic-sdp-offer-long-enough",
    });
    for (let i = 0; i < 100; i++) {
      try {
        readFileSync(join(dir, "private/creating"));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    await post("/api/kill", { enabled: true });
    const state = await (await fetch(origin + "/api/state")).json();
    assert.ok(state.active, "reservation stays active while creating");
    assert.equal(state.kill, true);
    const response = await pending;
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cancelled/);
    assert.equal(
      readFileSync(join(dir, "private/closed-id"), "utf8"),
      "synthetic-provider-id",
    );
    const done = await (await fetch(origin + "/api/state")).json();
    assert.equal(done.kill, true);
    assert.equal(done.sessions[0].status, "unconfirmed");
    assert.equal(done.total, 0.6);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  }
});
