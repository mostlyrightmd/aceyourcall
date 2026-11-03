import { DatabaseSync } from "node:sqlite";
import { AccessToken } from "livekit-server-sdk";
import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
test("gateway routes twenty concurrent rooms to isolated workers, queues room21 and retains session affinity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-gateway-pool-"));
  const servers = [],
    workers = [],
    records = [];
  let child;
  try {
    for (let i = 0; i < 20; i++) {
      const sessions = [];
      records.push(sessions);
      const srv = createServer(async (req, res) => {
        let raw = "";
        for await (const c of req) raw += c;
        const b = raw ? JSON.parse(raw) : {};
        const url = new URL(req.url, "http://local");
        res.setHeader("Content-Type", "application/json");
        if (url.pathname === "/api/state")
          return res.end(
            JSON.stringify({
              profiles: [{ id: "yc-10", title: "YC" }],
              application: "private default",
              facts: "{}",
              enabled: true,
              kill: false,
              availableBudget: 10,
              active: sessions.find((s) => s.status === "live")?.id,
              sessions: sessions.filter(
                (s) =>
                  !url.searchParams.has("room") ||
                  s.roomId === url.searchParams.get("room"),
              ),
            }),
          );
        if (url.pathname === "/api/sessions") {
          assert.equal(
            sessions.some((s) => s.status === "live"),
            false,
          );
          const s = {
            id: randomUUID(),
            roomId: b.roomId,
            created: Date.now(),
            status: "live",
            transcript: [],
          };
          sessions.push(s);
          return res.end(JSON.stringify({ id: s.id, sdp: "fake-" + i }));
        }
        const id = url.pathname.split("/")[3],
          s = sessions.find((s) => s.id === id);
        if (!s) {
          res.statusCode = 404;
          return res.end("{}");
        }
        if (url.pathname.endsWith("/end")) s.status = "complete";
        res.end(JSON.stringify({ worker: i }));
      });
      await new Promise((r) => srv.listen(0, "127.0.0.1", r));
      servers.push(srv);
      workers.push({
        id: i ? "worker-" + i : "default",
        origin: "http://localhost:" + srv.address().port,
      });
    }
    let deletedRoom;
    const media = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      deletedRoom = JSON.parse(raw).room;
      res.setHeader("Content-Type", "application/json");
      res.end("{}");
    });
    await new Promise((r) => media.listen(0, "127.0.0.1", r));
    servers.push(media);
    const config = join(dir, "workers.json");
    writeFileSync(config, JSON.stringify(workers));
    const origin = "http://localhost:14347";
    child = spawn(process.execPath, [resolve("src/call-server.js")], {
      cwd: dir,
      env: {
        ...process.env,
        MP_OPERATOR_POOL_PATH: config,
        MP_CALL_ORIGIN: origin,
        CALL_PORT: "14347",
        MP_CALL_ACCESS: "m".repeat(40),
        LIVEKIT_API_KEY: "test",
        LIVEKIT_API_SECRET: "s".repeat(40),
        LIVEKIT_URL: "http://localhost:" + media.address().port,
      },
      stdio: "pipe",
    });
    await new Promise((r, j) => {
      child.stdout.once("data", r);
      child.once("exit", () => j(Error("gateway exited")));
      setTimeout(() => j(Error("startup")), 5000).unref();
    });
    const req = async (path, key, data) => {
      const r = await fetch(origin + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const b = await r.json();
      assert.ok(r.ok, JSON.stringify(b));
      return b;
    };
    const rooms = await Promise.all(
      Array.from({ length: 21 }, () =>
        req("/rooms", "m".repeat(40), {
          application: "Synthetic application for scheduling gardeners.",
          permissions: {
            version: "2026-11-01",
            terms: true,
            improvement: false,
            sales: false,
          },
        }),
      ),
    );
    const tickets = await Promise.all(
      rooms
        .slice(0, 20)
        .map((r) => req("/rooms/" + r.id + "/queue", r.host, {})),
    );
    assert.equal(tickets.filter((t) => t.status === "ready").length, 20);
    const lastTicket = await req(
      "/rooms/" + rooms[20].id + "/queue",
      rooms[20].host,
      {},
    );
    assert.equal(lastTicket.position, 1);
    const started = await Promise.all(
      rooms.slice(0, 20).map((r) =>
        req("/rooms/" + r.id + "/start", r.host, {
          profile: "yc-10",
          sdp: "synthetic",
        }),
      ),
    );
    assert.equal(new Set(started.map((s) => s.sdp)).size, 20);
    for (let i = 0; i < 20; i++) {
      const r = rooms[i],
        s = await req("/rooms/" + r.id + "/state", r.host);
      assert.equal(s.sessions.length, 1);
      assert.equal(s.sessions[0].id, started[i].id);
      assert.equal(s.sessions[0].roomId, r.id);
    }
    await req(
      "/rooms/" + rooms[0].id + "/sessions/" + started[0].id + "/end",
      rooms[0].host,
      {},
    );
    const q = await req(
      "/rooms/" + rooms[20].id + "/queue",
      rooms[20].host,
      {},
    );
    assert.equal(q.status, "ready");
    const twentyone = await req(
      "/rooms/" + rooms[20].id + "/start",
      rooms[20].host,
      { profile: "yc-10", sdp: "synthetic" },
    );
    assert.equal(twentyone.sdp, started[0].sdp);
    const score = await req(
      "/rooms/" + rooms[0].id + "/sessions/" + started[0].id + "/scorecard",
      rooms[0].host,
      {},
    );
    assert.equal("fake-" + score.worker, started[0].sdp);
    const db = new DatabaseSync(join(dir, "private/rooms.sqlite"));
    const stored = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE key=?").get(rooms[0].id)
        .value,
    );
    stored.starting = true;
    stored.startingAt = Date.now() - 100000;
    stored.pendingWorker = workers[score.worker].id;
    stored.sessions = [];
    stored.sessionWorkers = {};
    db.prepare("UPDATE settings SET value=? WHERE key=?").run(
      JSON.stringify(stored),
      stored.id,
    );
    const recovered = await req(
      "/rooms/" + stored.id + "/state",
      rooms[0].host,
    );
    assert.equal(recovered.sessions[0].id, started[0].id);
    const liveRoom = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE key=?").get(stored.id).value,
    );
    assert.equal(liveRoom.starting, false);
    liveRoom.publicRoom = true;
    liveRoom.mediaDeadline = Date.now() - 1000;
    db.prepare("UPDATE settings SET value=? WHERE key=?").run(
      JSON.stringify(liveRoom),
      liveRoom.id,
    );
    db.close();
    const event = JSON.stringify({
      event: "room_started",
      room: { name: liveRoom.id },
    });
    const token = new AccessToken("test", "s".repeat(40), { ttl: 60 });
    token.sha256 = createHash("sha256").update(event).digest("base64");
    const forged = await fetch(origin + "/rtc-events", {
      method: "POST",
      headers: { Authorization: "forged" },
      body: event,
    });
    assert.equal(forged.status, 400);
    assert.equal(deletedRoom, undefined);
    const verified = await fetch(origin + "/rtc-events", {
      method: "POST",
      headers: { Authorization: await token.toJwt() },
      body: event,
    });
    assert.equal(verified.status, 200);
    assert.equal(deletedRoom, liveRoom.id);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
    for (const s of servers) {
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
