import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operatorPool } from "../src/operator-pool.js";
import { publicAdmission } from "../src/public-admission.js";
test("twenty slots remain distinct under concurrent admission; FIFO queue survives restart and cancels", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-pool-"));
  const db = new DatabaseSync(":memory:");
  const file = join(dir, "workers.json");
  const workers = Array.from({ length: 20 }, (_, i) => ({
    id: i ? "worker-" + i : "default",
    origin: "http://localhost:" + (4500 + i),
  }));
  writeFileSync(file, JSON.stringify(workers));
  const old = process.env.MP_OPERATOR_POOL_PATH;
  process.env.MP_OPERATOR_POOL_PATH = file;
  const states = workers.map(() => ({
    enabled: true,
    kill: false,
    sessions: [],
    availableBudget: 20,
    profiles: [],
  }));
  let probes = 0;
  const request = async (url) => {
    probes++;
    const i = Number(new URL(url).port) - 4500;
    return { ok: true, json: async () => states[i] };
  };
  try {
    let pool = operatorPool(db, "", request);
    const admissions = await Promise.all(
      Array.from({ length: 25 }, (_, i) => pool.admission("room-" + i)),
    );
    assert.equal(probes, 20, "concurrent polls share one 20-worker snapshot");
    assert.equal(admissions.filter((a) => a.status === "ready").length, 20);
    assert.deepEqual(
      admissions.slice(20).map((a) => a.position),
      [1, 2, 3, 4, 5],
    );
    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        pool.admission("room-" + i, "claim"),
      ),
    );
    assert.equal(new Set(claims.map((c) => c.worker)).size, 20);
    await assert.rejects(pool.admission("room-0", "claim"), /already starting/);
    claims.forEach((c) => {
      states[workers.findIndex((w) => w.id === c.worker)].active = "running";
    });
    for (let i = 0; i < 20; i++) pool.release("room-" + i);
    pool = operatorPool(db, "", request);
    assert.equal((await pool.admission("room-24")).position, 5);
    states[0].active = null;
    await new Promise((r) => setTimeout(r, 1050)); // External worker changes refresh within the 1s poll cache.
    assert.equal((await pool.admission("room-24")).status, "queued");
    assert.equal((await pool.admission("room-20")).status, "ready");
    await pool.admission("room-21", "cancel");
    assert.equal((await pool.admission("room-22")).position, 1);
    states.forEach((s) => {
      s.availableBudget = 0;
      s.active = null;
    });
    await assert.rejects(
      pool.admission("room-20", "claim"),
      /capacity changed/,
      "claim rejects stale funded snapshot",
    );
    await new Promise((r) => setTimeout(r, 1050));
    assert.equal((await pool.admission("room-25")).status, "unavailable");
    assert.equal((await pool.state()).enabled, false);
  } finally {
    if (old === undefined) delete process.env.MP_OPERATOR_POOL_PATH;
    else process.env.MP_OPERATOR_POOL_PATH = old;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("public admission validates challenge hostname/action and persists limits; signed identity cannot be chosen", async () => {
  const db = new DatabaseSync(":memory:");
  let now = 1000;
  let reply = {
    success: true,
    hostname: "practice.example.test",
    action: "create-room",
  };
  const a = publicAdmission(db, "https://practice.example.test", "secret", {
    now: () => now,
    verify: async () => ({ ok: true, json: async () => reply }),
  });
  try {
    let cookie;
    const req = {
      headers: { "x-forwarded-for": "192.0.2.1" },
      socket: { remoteAddress: "127.0.0.1" },
    };
    const id = a.identity(req, { setHeader: (_, v) => (cookie = v) });
    assert.equal(
      a.identity(
        { ...req, headers: { ...req.headers, cookie: cookie.split(";")[0] } },
        { setHeader() {} },
      ).device,
      id.device,
    );
    a.limit("x", 2, 100);
    a.limit("x", 2, 100);
    assert.throws(() => a.limit("x", 2, 100));
    now = 1200;
    a.limit("x", 2, 100);
    await a.challenge("test");
    reply = { ...reply, hostname: "attacker.test" };
    await assert.rejects(a.challenge("test"));
    await assert.rejects(a.challenge(""));
  } finally {
    db.close();
  }
});

test("funding preparation partitions four credit accounts into twenty slots without enabling launch", async () => {
  const { execFileSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "mp-funding-"));
  try {
    const input = join(dir, "funding.json"),
      output = join(dir, "prepared");
    writeFileSync(
      input,
      JSON.stringify({
        dailyUsd: 40,
        legacySpentUsd: 1,
        accounts: Array.from({ length: 4 }, (_, i) => ({
          id: "account-" + i,
          secret: "test-secret-" + i,
          availableUsd: 100,
          expiresAt: "2030-01-01T00:00:00Z",
          concurrency: 5,
        })),
      }),
    );
    execFileSync("python3", [
      "scripts/prepare-community-pool.py",
      input,
      output,
    ]);
    const review = JSON.parse(readFileSync(join(output, "review.json")));
    assert.equal(review.capacity, 20);
    assert.equal(review.allocatedUsd, 400);
    assert.equal(review.dailyUsd, 40);
    assert.equal(review.publicLaunchEnabled, false);
    assert.match(
      readFileSync(join(output, "default.env"), "utf8"),
      /MP_APPROVED_USD=21.00000000/,
    );
    assert.equal(
      JSON.parse(readFileSync(join(output, "operators.json"))).length,
      20,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expired or malformed credit windows and invalid caps fail closed before paid work", async () => {
  const { guard } = await import("../src/core.js");
  const previous = {
    expiry: process.env.MP_CREDIT_EXPIRES_AT,
    daily: process.env.MP_DAILY_CAP_USD,
  };
  const safe = {
    kill: false,
    active: false,
    enabled: true,
    daily: 0,
    cycle: 0,
    approvedRemaining: 10,
  };
  try {
    process.env.MP_CREDIT_EXPIRES_AT = "2020-01-01T00:00:00Z";
    assert.throws(() => guard(safe), /expired/);
    process.env.MP_CREDIT_EXPIRES_AT = "bad";
    assert.throws(() => guard(safe), /expired/);
    delete process.env.MP_CREDIT_EXPIRES_AT;
    process.env.MP_DAILY_CAP_USD = "bad";
    assert.throws(() => guard(safe));
  } finally {
    for (const [key, value] of [
      ["MP_CREDIT_EXPIRES_AT", previous.expiry],
      ["MP_DAILY_CAP_USD", previous.daily],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("room quota groups are atomic and expose bounded retry timing", () => {
  const db = new DatabaseSync(":memory:");
  let time = 1000;
  const a = publicAdmission(db, "https://practice.example.test", "test", {
    now: () => time,
  });
  a.limit("create-network:test", 1, 60000);
  assert.throws(
    () =>
      a.limitMany([
        ["create-global", 40, 60000],
        ["create-device:test", 3, 60000],
        ["create-network:test", 1, 60000],
      ]),
    (error) =>
      error.status === 429 &&
      error.retryAfter === 60 &&
      /network/.test(error.message),
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM public_limits WHERE key='create-global'")
      .get().n,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM public_limits WHERE key='create-device:test'",
      )
      .get().n,
    0,
  );
  time = 61000;
  a.limitMany([
    ["create-global", 40, 60000],
    ["create-network:test", 1, 60000],
  ]);
  db.close();
});

test("an in-flight pre-mutation summary cannot reserve a now-busy worker", async () => {
  const db = new DatabaseSync(":memory:");
  let active,
    unblock,
    first = true;
  const pending = new Promise((resolve) => {
    unblock = resolve;
  });
  let began;
  const begun = new Promise((resolve) => {
    began = resolve;
  });
  const pool = operatorPool(
    db,
    "http://localhost:4500",
    async (_url, options) => {
      if (options.method === "POST") {
        active = "running";
        return { ok: true, json: async () => ({}) };
      }
      const captured = { enabled: true, kill: false, active, sessions: [] };
      if (first) {
        first = false;
        began();
        await pending;
      }
      return { ok: true, json: async () => captured };
    },
  );
  try {
    const admission = pool.admission("waiting-room");
    await begun;
    await pool.call("/api/sessions", {});
    unblock();
    assert.equal((await admission).status, "queued");
    assert.equal((await pool.admission("waiting-room")).status, "queued");
  } finally {
    unblock();
    db.close();
  }
});

test("preparation spreads across funded workers and retains cache affinity without another paid job", async () => {
  const { createHash } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "mp-preparation-pool-")),
    db = new DatabaseSync(":memory:");
  const workers = [
    { id: "default", origin: "http://localhost:4600" },
    { id: "worker-1", origin: "http://localhost:4601" },
  ];
  const file = join(dir, "pool.json");
  writeFileSync(file, JSON.stringify(workers));
  const old = process.env.MP_OPERATOR_POOL_PATH;
  process.env.MP_OPERATOR_POOL_PATH = file;
  const states = workers.map(() => ({
      enabled: true,
      kill: false,
      availableBudget: 2,
      sessions: [],
      profiles: [],
    })),
    jobs = new Map();
  let creates = 0;
  try {
    const pool = operatorPool(db, "", async (url, init) => {
      const u = new URL(url),
        i = Number(u.port) - 4600;
      let result;
      if (u.pathname === "/api/state") result = states[i];
      else if (init.body) {
        creates++;
        const b = JSON.parse(init.body),
          id = createHash("sha256")
            .update(
              JSON.stringify([
                1,
                b.roomId,
                b.context.application,
                b.context.facts,
              ]),
            )
            .digest("hex");
        result = { id, status: "ready" };
        jobs.set(i + id, result);
        states[i].backgroundProcessing = true;
      } else result = jobs.get(i + u.pathname.split("/").at(-1));
      return { ok: true, json: async () => result };
    });
    const context = {
      application: "Synthetic company application for a garden tool.",
      facts: {},
    };
    const [a, b] = await Promise.all([
      pool.prepare({ id: "a" }, context),
      pool.prepare({ id: "b" }, context),
    ]);
    assert.notEqual(a.worker, b.worker);
    assert.equal(creates, 2);
    states.forEach((s) => (s.availableBudget = 0));
    const again = await pool.prepare({ id: "a", preparation: a }, context);
    assert.equal(again.worker, a.worker);
    assert.equal(creates, 2);
  } finally {
    if (old === undefined) delete process.env.MP_OPERATOR_POOL_PATH;
    else process.env.MP_OPERATOR_POOL_PATH = old;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a claim cannot reuse a released lease with a pre-start capacity snapshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-claim-race-")),
    db = new DatabaseSync(":memory:"),
    file = join(dir, "pool.json");
  writeFileSync(
    file,
    JSON.stringify([
      { id: "default", origin: "http://localhost:4700" },
      { id: "other", origin: "http://localhost:4701" },
    ]),
  );
  const old = process.env.MP_OPERATOR_POOL_PATH;
  process.env.MP_OPERATOR_POOL_PATH = file;
  let block = false,
    release,
    entered;
  const blocked = new Promise((r) => (entered = r));
  const states = [
    { enabled: true, availableBudget: 10, sessions: [] },
    { enabled: true, availableBudget: 10, sessions: [] },
  ];
  try {
    const pool = operatorPool(db, "", async (url) => {
      const i = Number(new URL(url).port) - 4700,
        value = structuredClone(states[i]);
      if (block && i === 0) {
        block = false;
        entered();
        await new Promise((r) => (release = r));
      }
      return { ok: true, json: async () => value };
    });
    await pool.admission("a");
    await pool.admission("b");
    await pool.admission("c");
    assert.equal((await pool.admission("a", "claim")).worker, "default");
    block = true;
    const claiming = pool.admission("b", "claim");
    await blocked;
    states[0].active = "running";
    pool.release("a");
    release();
    assert.equal((await claiming).worker, "other");
    assert.equal((await pool.admission("c")).status, "queued");
  } finally {
    if (old === undefined) delete process.env.MP_OPERATOR_POOL_PATH;
    else process.env.MP_OPERATOR_POOL_PATH = old;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
