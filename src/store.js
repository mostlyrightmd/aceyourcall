import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
export function openStore(
  path = "private/mock-partner.sqlite",
  { ephemeralApplications = false } = {},
) {
  mkdirSync("private", { recursive: true, mode: 0o700 });
  chmodSync("private", 0o700);
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(
    `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, created INTEGER, data TEXT); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);`,
  );
  // Application context lives only in process memory, never in SQLite/WAL.
  const volatile = new Map();
  function clean(value) {
    if (
      !ephemeralApplications ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return value;
    const copy = { ...value };
    delete copy.application;
    delete copy.facts;
    delete copy.context;
    return copy;
  }
  function remember(id, value, expires = Date.now() + 86400000) {
    if (!ephemeralApplications || !value || typeof value !== "object") return;
    const fields = {};
    for (const key of ["application", "facts", "context"])
      if (Object.hasOwn(value, key)) fields[key] = value[key];
    if (Object.keys(fields).length) volatile.set(id, { fields, expires });
  }
  function restore(id, value) {
    const cached = volatile.get(id);
    if (cached?.expires <= Date.now()) volatile.delete(id);
    return cached && cached.expires > Date.now()
      ? { ...value, ...cached.fields }
      : value;
  }
  if (ephemeralApplications) {
    db.exec("PRAGMA secure_delete=ON");
    let changed = false;
    for (const row of db.prepare("SELECT key,value FROM settings").all()) {
      if (["application", "facts"].includes(row.key)) {
        db.prepare("DELETE FROM settings WHERE key=?").run(row.key);
        changed = true;
      } else {
        const original = JSON.parse(row.value),
          next = JSON.stringify(clean(original));
        if (next !== row.value) {
          db.prepare("UPDATE settings SET value=? WHERE key=?").run(
            next,
            row.key,
          );
          changed = true;
        }
      }
    }
    for (const row of db.prepare("SELECT id,data FROM records").all()) {
      const next = JSON.stringify(clean(JSON.parse(row.data)));
      if (next !== row.data) {
        db.prepare("UPDATE records SET data=? WHERE id=?").run(next, row.id);
        changed = true;
      }
    }
    if (changed)
      db.exec(
        "PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)",
      );
  }
  const get = (k) => {
    if (ephemeralApplications && ["application", "facts"].includes(k))
      return restore("setting:" + k, {}).value ?? null;
    const r = db.prepare("SELECT value FROM settings WHERE key=?").get(k);
    return r ? restore("setting:" + k, JSON.parse(r.value)) : null;
  };
  const set = (k, v) => {
    if (ephemeralApplications && ["application", "facts"].includes(k)) {
      volatile.set("setting:" + k, {
        fields: { value: v },
        expires: Date.now() + 86400000,
      });
      return;
    }
    remember("setting:" + k, v, v?.expires);
    return db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(k, JSON.stringify(clean(v)));
  };
  const all = () =>
    db
      .prepare("SELECT id,data FROM records ORDER BY created DESC")
      .all()
      .map((r) => restore("record:" + r.id, JSON.parse(r.data)));
  const save = (r) => {
    remember("record:" + r.id, r, r.created + 86400000);
    return db
      .prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)")
      .run(r.id, r.created, JSON.stringify(clean(r)));
  };
  function prune() {
    for (const [id, item] of volatile)
      if (item.expires <= Date.now()) volatile.delete(id);
    for (const r of all())
      if (r.created < Date.now() - 30 * 86400000 && !r.transcriptExpired) {
        r.transcript = [];
        delete r.namedTranscript;
        delete r.captionChunks;
        delete r.application;
        delete r.facts;
        delete r.scorecard;
        delete r.scoreError;
        r.errors = [];
        r.events = [];
        r.transcriptExpired = true;
        save(r);
      }
  }
  prune();
  return {
    db,
    get,
    set,
    all,
    save,
    record: (id) => {
      const r = db.prepare("SELECT data FROM records WHERE id=?").get(id);
      return r ? restore("record:" + id, JSON.parse(r.data)) : null;
    },
    prune,
  };
}
