import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.js";
test("application context stays in RAM, migration removes old copies, restart retains room/ledger only", () => {
  const dir = mkdtempSync(join(tmpdir(), "mp-memory-"));
  const path = join(dir, "state.sqlite");
  const secret = "UNIQUE_APPLICATION_SENTINEL_8273";
  const now = Date.now();
  let store = openStore(path);
  store.set("room", {
    id: "room",
    host: "host",
    expires: now + 86400000,
    context: { application: secret, facts: { x: secret } },
  });
  store.set("application", secret);
  store.save({
    id: "session",
    created: now,
    application: secret,
    facts: { x: secret },
    cost: 1,
    transcript: [],
  });
  store.db.close();
  store = openStore(path, { ephemeralApplications: true });
  assert.equal(store.get("room").context, undefined);
  assert.equal(store.record("session").application, undefined);
  store.set("room", { ...store.get("room"), context: { application: secret } });
  store.save({
    ...store.record("session"),
    application: secret,
    facts: { x: secret },
  });
  assert.equal(store.get("room").context.application, secret);
  assert.equal(store.record("session").application, secret);
  assert.equal(store.all()[0].application, secret);
  store.set("coverage", { a: 1 });
  assert.equal(store.get("coverage").a, 1);
  assert.ok(
    !JSON.stringify(store.db.prepare("SELECT * FROM settings").all()).includes(
      secret,
    ),
  );
  assert.ok(
    !JSON.stringify(store.db.prepare("SELECT * FROM records").all()).includes(
      secret,
    ),
  );
  store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  assert.ok(!readFileSync(path).includes(Buffer.from(secret)));
  store.db.close();
  store = openStore(path, { ephemeralApplications: true });
  assert.equal(store.get("room").host, "host");
  assert.equal(store.get("room").context, undefined);
  assert.equal(store.record("session").cost, 1);
  assert.equal(store.record("session").application, undefined);
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
