import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { TokenVerifier } from "livekit-server-sdk";
test("public gateway isolates private APIs, room invites and host grants", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "mp-calls-"));
  mkdirSync(join(cwd, "public"));
  symlinkSync(resolve("src"), join(cwd, "src"));
  const origin = "http://localhost:14320",
    master = "m".repeat(40),
    secret = "s".repeat(40);
  const child = spawn(process.execPath, [resolve("src/call-server.js")], {
    cwd,
    env: {
      ...process.env,
      CALL_PORT: "14320",
      MP_CALL_ORIGIN: origin,
      MP_CALL_ALIAS_ORIGINS: "http://127.0.0.1:14320",
      MP_CALL_ACCESS: master,
      LIVEKIT_API_KEY: "testkey",
      LIVEKIT_API_SECRET: secret,
      LIVEKIT_URL: "ws://localhost:7880",
    },
    stdio: "pipe",
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("exit", () => reject(Error("gateway exited")));
      setTimeout(() => reject(Error("startup timed out")), 5000).unref();
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
    const alias = "http://127.0.0.1:14320";
    assert.equal((await fetch(alias + "/config", {headers:{Origin:alias}})).status, 200);
    assert.equal((await fetch(alias + "/config", {headers:{Origin:origin}})).status, 403);
    assert.equal((await fetch(origin + "/config", {headers:{Origin:alias}})).status, 403);
    assert.match(await (await fetch(alias + "/robots.txt")).text(), /http:\/\/localhost:14320\/sitemap.xml/);
    assert.equal((await request("/api/state", master)).status, 404);
    assert.equal((await request("/rooms", "bad", {})).status, 403);
    const a = await (
        await request("/rooms", master, {
          application: "Synthetic company application for test room.",
        })
      ).json(),
      b = await (
        await request("/rooms", master, {
          application: "Synthetic company application for test room.",
        })
      ).json();
    assert.match(a.code, /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
    assert.equal(
      (await (await request("/config", "")).json()).canCreate,
      false,
    );
    assert.equal(
      (await request("/creator-access", "bad", { roomId: a.id })).status,
      403,
    );
    const resolved = await (
      await request("/room-code", "", { code: a.code.toUpperCase() })
    ).json();
    assert.equal(resolved.id, a.id);
    assert.equal(resolved.guest, a.guest);
    assert.equal(resolved.host, undefined);
    assert.equal(
      (await request(`/rooms/${a.id}/grounding`, resolved.guest, {})).status,
      403,
    );
    assert.equal(
      (await request("/creator-access", a.guest, { roomId: a.id })).status,
      403,
    );
    const remembered = await request("/creator-access", a.host, {
      roomId: a.id,
    });
    assert.equal(remembered.status, 200);
    const cookie = remembered.headers.get("set-cookie").split(";")[0];
    const config = await (
      await fetch(origin + "/config", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(config.canCreate, true);
    assert.equal(config.communityPreview, false);
    const fromCookie = await fetch(origin + "/rooms", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        application: "Synthetic application from remembered browser.",
        permissions: {
          version: "2026-11-01",
          terms: true,
          improvement: false,
          sales: false,
        },
      }),
    });
    assert.equal(fromCookie.status, 201);
    assert.equal(
      (await request("/room-code", "", { code: "bad" })).status,
      404,
    );
    assert.equal(
      (await request(`/rooms/${a.id}/join`, b.guest, { consent: true })).status,
      403,
    );
    assert.equal(
      (await request(`/rooms/${a.id}/join`, a.guest, { consent: false }))
        .status,
      400,
    );
    assert.equal(
      (
        await request(`/rooms/${a.id}/join`, a.guest, {
          consent: true,
          ai: true,
        })
      ).status,
      403,
    );
    assert.equal(
      (await request(`/rooms/${a.id}/grounding`, a.guest, {})).status,
      403,
    );
    const human = await (
      await request(`/rooms/${a.id}/join`, a.guest, {
        consent: true,
        name: "Founder",
      })
    ).json();
    assert.ok(human.token, JSON.stringify(human));
    const grant = await new TokenVerifier("testkey", secret).verify(
      human.token,
    );
    assert.equal(grant.video.room, a.id);
    assert.equal(grant.video.roomAdmin, undefined);
    assert.equal(grant.roomConfig.maxParticipants, 4);
    assert.deepEqual(grant.video.canPublishSources, ["camera", "microphone"]);
    const ai = await (
      await request(`/rooms/${a.id}/join`, a.host, { consent: true, ai: true })
    ).json();
    const aiGrant = await new TokenVerifier("testkey", secret).verify(ai.token);
    assert.equal(aiGrant.sub, "interviewer");
    assert.equal(aiGrant.video.canSubscribe, false);
    assert.equal(
      (await request(`/rooms/${a.id}/sessions/0000/end`, a.host, {})).status,
      404,
    );
    const cross = await fetch(origin + "/rooms", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        Authorization: "Bearer " + master,
      },
      body: "{}",
    });
    assert.equal(cross.status, 403);
    for (let i = 0; i < 30; i++)
      await request("/room-code", "", { code: "bad" });
    assert.equal(
      (await request("/room-code", "", { code: a.code })).status,
      429,
    );
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    rmSync(cwd, { recursive: true, force: true });
  }
});
