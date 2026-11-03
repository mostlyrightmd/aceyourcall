import test from "node:test";
import assert from "node:assert/strict";
import { roomContext, roomProfile } from "../src/room-context.js";
import { practicePlan } from "../src/practice-plan.js";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("room context validates plain text, bounded notes and LinkedIn URLs without fetching", () => {
  const a = {
    application: "Synthetic founder application with private facts.",
    interviewer: {
      name: "Example",
      linkedin: "https://www.linkedin.com/in/example",
      notes: "Developer tools",
    },
  };
  assert.equal(roomContext(a).interviewer.name, "Example");
  for (const linkedin of [
    "http://www.linkedin.com/in/example",
    "https://evil.test/in/example",
    "https://www.linkedin.com@evil.test/in/example",
    "https://www.linkedin.com/in/example?token=x",
  ])
    assert.throws(() => roomContext({ ...a, interviewer: { linkedin } }));
  assert.throws(() => roomContext({ ...a, application: "" }));
  assert.throws(() => roomContext({ ...a, facts: "[1,2]" }));
  const p = roomProfile(
    {
      id: "speedrun-10",
      instructions: "Private Seeam persona",
      interviewer: { name: "Seeam" },
    },
    roomContext(a),
  );
  assert.equal(p.interviewer.name, "Example");
  assert.doesNotMatch(p.instructions, /Private Seeam/);
  assert.match(p.instructions, /unverified context/);
});
test("practice actions prioritize low scores and preserve observed evidence without new claims", () => {
  const result = practicePlan({
    scores: [
      { criterion: "concision", score: 3, quote: "We sort of do everything." },
      { criterion: "intro_clarity", score: 2, quote: "We are a platform." },
      { criterion: "candor", score: 8, quote: "" },
      { criterion: "market_depth", score: 4, quote: "" },
    ],
  });
  assert.deepEqual(
    result.map((x) => x.criterion),
    ["intro_clarity", "concision", "market_depth"],
  );
  assert.equal(result[0].evidence, "We are a platform.");
  assert.ok(result.every((x) => x.drill && x.success));
});
test("community preview isolates context and forwards a room snapshot, never global company data", async () => {
  let received;
  const backend = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/api/state"))
      res.end(
        JSON.stringify({
          profiles: [
            {
              id: "speedrun-10",
              instructions: "private persona",
              interviewer: { name: "Private" },
            },
          ],
          application: "DO NOT LEAK GLOBAL APPLICATION",
          facts: "{}",
          enabled: true,
          sessions: [],
        }),
      );
    else {
      received = JSON.parse(raw);
      res.end(JSON.stringify({ id: "10000000-0000-4000-8000-000000000001" }));
    }
  });
  await new Promise((r) => backend.listen(14331, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "mp-community-"));
  symlinkSync(resolve("src"), join(dir, "src"));
  const origin = "http://localhost:14330";
  const child = spawn(process.execPath, [resolve("src/call-server.js")], {
    cwd: dir,
    env: {
      ...process.env,
      MP_CALL_ORIGIN: origin,
      CALL_PORT: "14330",
      MP_OPERATOR_ORIGIN: "http://127.0.0.1:14331",
      MP_CALL_ACCESS: "m".repeat(40),
      LIVEKIT_API_KEY: "test",
      LIVEKIT_API_SECRET: "s".repeat(40),
      MP_COMMUNITY_PREVIEW: "1",
    },
    stdio: "pipe",
  });
  const request = (path, key, data) =>
    fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body:
        data === undefined
          ? undefined
          : JSON.stringify({
              ...data,
              permissions: data.permissions || {
                version: "2026-11-01",
                terms: true,
                improvement: false,
                sales: false,
                email: "",
              },
            }),
    });
  try {
    await new Promise((r, j) => {
      child.stdout.once("data", r);
      child.once("exit", () => j(Error("exited")));
      setTimeout(() => j(Error("startup")), 5000).unref();
    });
    assert.equal(
      (await (await request("/config")).json()).communityPreview,
      true,
    );
    const a = await (
      await request("/rooms", "", {
        application: "TEAM ALPHA private application.",
        interviewer: { name: "Person A" },
      })
    ).json();
    const b = await (
      await request("/rooms", "", {
        application: "TEAM BETA private application.",
      })
    ).json();
    assert.equal(
      (await request("/creator-access", a.host, { roomId: a.id })).status,
      403,
    );
    const state = await (await request(`/rooms/${a.id}/state`, a.host)).json();
    assert.equal(state.application, "TEAM ALPHA private application.");
    assert.equal(state.profiles[0].interviewer.name, "Person A");
    assert.equal(
      (await (await request(`/rooms/${b.id}/state`, b.host)).json())
        .application,
      "TEAM BETA private application.",
    );
    assert.equal(
      (await (await request(`/rooms/${a.id}/state`, a.guest)).json())
        .application,
      undefined,
    );
    assert.equal((await request(`/rooms/${a.id}/state`, b.host)).status, 403);
    assert.equal(
      (
        await request(`/rooms/${a.id}/grounding`, a.host, {
          application: "UPDATED ALPHA application context.",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/rooms/${a.id}/start`, a.host, {
          profile: "speedrun-10",
          sdp: "synthetic",
        })
      ).status,
      201,
    );
    assert.equal(
      received.context.application,
      "UPDATED ALPHA application context.",
    );
    assert.equal(received.roomId, a.id);
    const joined = await (
      await request(`/rooms/${a.id}/join`, a.guest, {
        consent: true,
        name: "Canonical founder",
      })
    ).json();
    const participantId = JSON.parse(
      Buffer.from(joined.token.split(".")[1], "base64url").toString(),
    ).sub;
    const captionPath = `/rooms/${a.id}/sessions/10000000-0000-4000-8000-000000000001/caption`;
    assert.equal(
      (
        await request(captionPath, a.host, {
          speakerId: participantId,
          speakerName: "Spoofed name",
          pcm: "test",
        })
      ).status,
      200,
    );
    assert.equal(received.speakerName, "Canonical founder");
    assert.equal(
      (await request(captionPath, a.guest, { speakerId: participantId }))
        .status,
      403,
    );
    assert.equal(
      (await request(captionPath, a.host, { speakerId: "unknown" })).status,
      400,
    );
    assert.equal(
      (await request(`/rooms/${a.id}/withdraw-permissions`, a.guest, {}))
        .status,
      200,
    );
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(dir, "private/rooms.sqlite"));
    const choices = db
      .prepare("SELECT data FROM privacy_consents WHERE room_id=?")
      .all(a.id)
      .map((r) => JSON.parse(r.data));
    assert.ok(
      choices.length > 0 &&
        choices.every(
          (c) => c.withdrawn && !c.sales && !c.improvement && c.email === "",
        ),
    );
    db.close();
    assert.equal(
      (await (await request(`/rooms/${b.id}/state`, b.host)).json())
        .application,
      "TEAM BETA private application.",
    );
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    await new Promise((r) => backend.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention removes application and assessment content while preserving cost ledger", async () => {
  const { openStore } = await import("../src/store.js");
  const dir = mkdtempSync(join(tmpdir(), "mp-retention-"));
  const store = openStore(join(dir, "records.sqlite"));
  try {
    store.save({
      id: "expired",
      created: Date.now() - 31 * 86400000,
      cost: 0.25,
      application: "Private app",
      facts: { secret: "private" },
      transcript: [],
      namedTranscript: [
        { speakerName: "Private name", text: "Private speech" },
      ],
      captionChunks: [{ speakerId: "Private identity" }],
      captionCost: 0.01,
      scorecard: { reason: "Private assessment" },
      scoreError: "Private error",
      errors: [{ detail: "Private" }],
      events: [{ content: "Private" }],
    });
    store.prune();
    const r = store.record("expired");
    assert.equal(r.cost, 0.25);
    assert.equal(r.application, undefined);
    assert.equal(r.scorecard, undefined);
    assert.equal(r.facts, undefined);
    assert.equal(r.scoreError, undefined);
    assert.equal(r.namedTranscript, undefined);
    assert.equal(r.captionChunks, undefined);
    assert.equal(r.captionCost, 0.01);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.events, []);
    assert.equal(r.transcriptExpired, true);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accepted context leaves room for the largest question set and excludes LinkedIn from AI instructions", async () => {
  const { readFileSync } = await import("node:fs");
  const { default: YAML } = await import("yaml");
  const { grounding } = await import("../src/core.js");
  const bank = YAML.parse(readFileSync("grounding/question_set.yaml", "utf8"))
    .sort(
      (a, b) =>
        Buffer.byteLength(JSON.stringify(b)) -
        Buffer.byteLength(JSON.stringify(a)),
    )
    .slice(0, 10);
  const context = roomContext({
    application: "a".repeat(35000),
    facts: { note: "b".repeat(2500) },
    interviewer: {
      name: "Example",
      linkedin: "https://www.linkedin.com/in/example",
      notes: "Discuss customer learning.",
    },
  });
  const profile = roomProfile(
    YAML.parse(readFileSync("profiles/speedrun-10.yaml", "utf8")),
    context,
  );
  assert.doesNotThrow(() =>
    grounding(profile, context.application, context.facts, bank),
  );
  assert.doesNotMatch(profile.instructions, /https:\/\/www.linkedin.com/);
  assert.match(profile.instructions, /Discuss customer learning/);
  assert.throws(() => roomContext({ application: "é".repeat(20000) }));
  assert.throws(() =>
    roomContext({
      application: "a".repeat(35000),
      facts: { note: "b".repeat(9000) },
    }),
  );
});
