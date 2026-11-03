import { readFileSync } from "node:fs";
export function operatorPool(db, fallback, request = fetch) {
  const workers = process.env.MP_OPERATOR_POOL_PATH
    ? JSON.parse(readFileSync(process.env.MP_OPERATOR_POOL_PATH, "utf8"))
    : [{ id: "default", origin: fallback }];
  if (
    !Array.isArray(workers) ||
    !workers.length ||
    workers.length > 20 ||
    new Set(workers.map((w) => w.id)).size !== workers.length
  )
    throw Error("Configure between one and twenty distinct operators");
  for (const w of workers) {
    const u = new URL(w.origin);
    if (
      !/^[a-z0-9-]{1,40}$/.test(w.id) ||
      u.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(u.hostname) ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      u.username ||
      u.password
    )
      throw Error("Operator endpoints must be distinct local HTTP services");
  }
  if (
    new Set(workers.map((w) => new URL(w.origin).port)).size !== workers.length
  )
    throw Error("Duplicate operator ports");
  db.exec(
    "CREATE TABLE IF NOT EXISTS admission_queue (room TEXT PRIMARY KEY, joined INTEGER, seen INTEGER, worker TEXT, lease INTEGER, starting INTEGER DEFAULT 0)",
  );
  const call = async (path, body, id = workers[0].id) => {
    const w = workers.find((w) => w.id === id);
    if (!w) throw Error("Interview worker unavailable");
    const r = await request(w.origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: w.origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(
        path.endsWith("/scorecard")
          ? 110000
          : path.startsWith("/api/state")
            ? 4000
            : 45000,
      ),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error || "Interview unavailable");
    if (body !== undefined) invalidate();
    return result;
  };
  const snapshot = async () =>
    await Promise.all(
      workers.map(async (w) => {
        try {
          return {
            worker: w.id,
            ...(await call("/api/state?summary=1", undefined, w.id)),
          };
        } catch {
          return { worker: w.id, enabled: false, kill: true, sessions: [] };
        }
      }),
    );
  let serial = Promise.resolve();
  const locked = (fn) => {
    const next = serial.then(fn);
    serial = next.catch(() => {});
    return next;
  };
  const idle = (s) =>
    s.enabled &&
    !s.kill &&
    !s.active &&
    !s.processing &&
    !s.meeting?.running &&
    !(s.cooldownUntil > Date.now());
  const funded = (s) =>
    s.availableBudget === undefined || s.availableBudget >= 1.7;
  let cached, cacheAt = 0, generation = 0, fetching;
  function invalidate() {
    generation++;
    cached = undefined;
    cacheAt = 0;
  }
  async function summary() {
    if (cached && Date.now() - cacheAt < 1000) return cached;
    const version = generation;
    if (!fetching || fetching.version !== version) {
      const flight = { version };
      flight.promise = snapshot().then((s) => {
        if (generation === version) {
          cached = s;
          cacheAt = Date.now();
        }
        return s;
      }).finally(() => {
        if (fetching === flight) fetching = undefined;
      });
      fetching = flight;
    }
    const result = await fetching.promise;
    // A mutation may finish while these reads are in flight. Its caller must
    // not receive the old snapshot either, even if we did not cache it.
    return generation === version ? result : summary();
  }
  async function state(room) {
    const states = await summary();
    let sessions = states.flatMap((s) => s.sessions || []);
    if (room) {
      const ids = [
        ...new Set(
          room.sessions.map((id) => room.sessionWorkers?.[id] || "default"),
        ),
      ];
      sessions = (
        await Promise.all(
          ids.map(async (id) => {
            const detail = await call(
              "/api/state?room=" + encodeURIComponent(room.id),
              undefined,
              id,
            );
            return detail.sessions.filter((s) => room.sessions.includes(s.id));
          }),
        )
      ).flat();
    }
    const first = states.find((s) => s.profiles) || {};
    return {
      ...first,
      enabled: states.some((s) => s.enabled && !s.kill && funded(s)),
      kill: states.every((s) => s.kill),
      active: states.find((s) => s.active)?.active,
      processing: states.some((s) => s.processing),
      busy: !states.some((s) => idle(s) && funded(s)),
      sessions: sessions.sort((a, b) => b.created - a.created),
      capacity: workers.length,
    };
  }
  const admission = (room, action = "join") =>
    locked(async () => {
      const now = Date.now();
      db.prepare(
        "DELETE FROM admission_queue WHERE (worker IS NULL AND seen < ?) OR (worker IS NOT NULL AND lease < ?)",
      ).run(now - 60000, now);
      if (action === "cancel") {
        db.prepare(
          "DELETE FROM admission_queue WHERE room=? AND starting=0",
        ).run(room);
        return { status: "cancelled" };
      }
      let row = db
        .prepare("SELECT * FROM admission_queue WHERE room=?")
        .get(room);
      if (!row) {
        if (action === "claim") throw Error("Join the interview queue first");
        if (db.prepare("SELECT count(*) n FROM admission_queue").get().n >= 100)
          throw Error("The queue is full. Please try again later.");
        db.prepare(
          "INSERT INTO admission_queue(room,joined,seen) VALUES(?,?,?)",
        ).run(room, now, now);
      } else if (row.starting) throw Error("Interview is already starting");
      db.prepare("UPDATE admission_queue SET seen=? WHERE room=?").run(
        now,
        room,
      );
      // Polls share a bounded snapshot; claims always revalidate live capacity.
      const states = action === "claim" ? await snapshot() : await summary();
      const occupied = new Set(
        db
          .prepare(
            "SELECT worker FROM admission_queue WHERE worker IS NOT NULL",
          )
          .all()
          .map((r) => r.worker),
      );
      const waiting = db
        .prepare(
          "SELECT room FROM admission_queue WHERE worker IS NULL ORDER BY joined,rowid",
        )
        .all();
      for (const s of states.filter(
        (s) => idle(s) && funded(s) && !occupied.has(s.worker),
      )) {
        const next = waiting.shift();
        if (!next) break;
        db.prepare(
          "UPDATE admission_queue SET worker=?,lease=? WHERE room=?",
        ).run(s.worker, Date.now() + 90000, next.room);
      }
      row = db.prepare("SELECT * FROM admission_queue WHERE room=?").get(room);
      if (action === "claim") {
        if (!row.worker) throw Error("Your interview is still queued");
        const s = states.find((s) => s.worker === row.worker);
        if (!s || !idle(s) || !funded(s))
          throw Error("Interview capacity changed. Please try again.");
        db.prepare(
          "UPDATE admission_queue SET starting=1,lease=? WHERE room=?",
        ).run(Date.now() + 90000, room);
        return { status: "ready", worker: row.worker };
      }
      if (row.worker) return { status: "ready" };
      if (!states.some((s) => s.enabled && !s.kill && funded(s))) {
        db.prepare("DELETE FROM admission_queue WHERE room=?").run(room);
        return {
          status: "unavailable",
          message:
            "Free interview capacity is unavailable. Please try again later.",
        };
      }
      return {
        status: "queued",
        position: db
          .prepare(
            "SELECT count(*) n FROM admission_queue WHERE worker IS NULL AND (joined < ? OR (joined=? AND rowid <= (SELECT rowid FROM admission_queue WHERE room=?)))",
          )
          .get(row.joined, row.joined, room).n,
      };
    });
  return {
    workers,
    call,
    state,
    admission,
    release: (room) => {
      invalidate();
      return db.prepare("DELETE FROM admission_queue WHERE room=?").run(room);
    },
  };
}
