import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { roomLinks, normalizeCode, codePattern } from "../src/room-links.js";
test("short room codes persist, normalize, expire and remain distinct", () => {
  const db = new DatabaseSync(":memory:"),
    links = roomLinks(db, "secret", "https://example.test");
  const a = { id: "a", expires: Date.now() + 60000 },
    b = { id: "b", expires: Date.now() + 60000 };
  const code = links.code(a);
  assert.match(code, codePattern);
  assert.equal(links.code(a), code);
  assert.equal(links.resolve(code.toUpperCase().replaceAll("-", " ")), "a");
  assert.equal(roomLinks(db, "secret", "https://example.test").code(a), code);
  assert.notEqual(links.code(b), code);
  assert.equal(links.resolve("bad"), null);
  db.prepare("UPDATE room_links SET expires=0 WHERE room_id='a'").run();
  assert.equal(links.resolve(code), undefined);
  assert.equal(normalizeCode("<script>"), null);
  db.close();
});
test("creator cookie is signed, secure, scoped and cannot survive key rotation", () => {
  const db = new DatabaseSync(":memory:"),
    links = roomLinks(db, "secret", "https://example.test");
  let cookie;
  links.remember({
    setHeader(name, value) {
      cookie = value;
    },
  });
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const req = { headers: { cookie } };
  assert.equal(links.creator(req), true);
  assert.equal(
    links.creator({
      headers: { cookie: cookie.replace(/mp_creator=./, "mp_creator=0") },
    }),
    false,
  );
  assert.equal(
    roomLinks(db, "different", "https://example.test").creator(req),
    false,
  );
  assert.equal(links.creator({ headers: {} }), false);
  db.close();
});
