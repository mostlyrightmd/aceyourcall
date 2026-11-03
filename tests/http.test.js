import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("offline HTTP: host/origin, consent, grounding, kill, no paid starts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-test-"));
  for (const p of ["src", "public", "profiles", "grounding", "package.json"])
    cpSync(p, join(dir, p), { recursive: true });
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  const port = 44319,
    origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), MP_PAID_ENABLED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server startup timeout")),
        10000,
      );
      child.stdout.on("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.on("exit", () => reject(new Error("Server exited")));
    });
    const post = (path, b, headers = { Origin: origin }) =>
      fetch(origin + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(b),
      });
    assert.equal(
      (
        await post(
          "/api/kill",
          { enabled: true },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal((await post("/api/kill", { enabled: true }, {})).status, 403);
    assert.equal(
      (
        await post("/api/grounding", {
          application: "Synthetic company builds gardening tools.",
          facts: "{}",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/api/sessions", {
          profile: "speedrun-10",
          consent: false,
          sdp: "x".repeat(40),
        })
      ).status,
      400,
    );
    const disabled = await post("/api/sessions", {
      profile: "speedrun-10",
      consent: true,
      sdp: "x".repeat(40),
    });
    assert.match((await disabled.json()).error, /disabled/);
    assert.equal((await post("/api/kill", { enabled: true })).status, 200);
    const state = await (await fetch(origin + "/api/state")).json();
    assert.equal(state.kill, true);
    assert.equal(state.total, 0);
    assert.equal(state.sessions.length, 0);
    assert.equal(state.meeting.running, false);
    const meet = await post("/api/meet/start", {
      url: "https://meet.google.com/abc-defg-hij",
      profile: "speedrun-10",
      consent: true,
    });
    assert.equal(meet.status, 400);
    assert.equal(
      (
        await post("/api/meet/start", {
          url: "https://meet.google.com/abc-defg-hij",
          profile: "speedrun-10",
          consent: false,
        })
      ).status,
      400,
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
