import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const codePattern = /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/;
export function normalizeCode(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, "");
  return /^[a-z2-7]{12}$/.test(text) ? text.match(/.{4}/g).join("-") : null;
}
export function roomLinks(db, master, origin) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS room_links (code TEXT PRIMARY KEY, room_id TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL)",
  );
  function code(room) {
    const existing = db
      .prepare("SELECT code FROM room_links WHERE room_id=?")
      .get(room.id);
    if (existing) return existing.code;
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    for (;;) {
      const value = [...randomBytes(12)]
        .map((b) => alphabet[b & 31])
        .join("")
        .match(/.{4}/g)
        .join("-");
      const result = db
        .prepare("INSERT OR IGNORE INTO room_links VALUES(?,?,?)")
        .run(value, room.id, room.expires);
      if (result.changes) return value;
      const raced = db
        .prepare("SELECT code FROM room_links WHERE room_id=?")
        .get(room.id);
      if (raced) return raced.code;
    }
  }
  const signature = (value) =>
    createHmac("sha256", master)
      .update("creator-browser:" + value)
      .digest("hex");
  function creator(req) {
    const cookie = String(req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("mp_creator="))
      ?.slice(11);
    const [expiry, nonce, sig] = (cookie || "").split(".");
    if (
      !/^\d{13}$/.test(expiry || "") ||
      !/^[a-f0-9]{32}$/.test(nonce || "") ||
      !/^[a-f0-9]{64}$/.test(sig || "") ||
      Number(expiry) <= Date.now()
    )
      return false;
    return timingSafeEqual(
      Buffer.from(sig),
      Buffer.from(signature(expiry + "." + nonce)),
    );
  }
  function remember(res) {
    const value = `${Date.now() + 30 * 86400000}.${randomBytes(16).toString("hex")}`;
    res.setHeader(
      "Set-Cookie",
      `mp_creator=${value}.${signature(value)}; Path=/; Max-Age=2592000; HttpOnly; ${origin.startsWith("https:") ? "Secure; " : ""}SameSite=Strict`,
    );
  }
  return {
    code,
    creator,
    remember,
    resolve(value) {
      const normalized = normalizeCode(value);
      if (!normalized) return null;
      return db
        .prepare("SELECT room_id FROM room_links WHERE code=? AND expires>?")
        .get(normalized, Date.now())?.room_id;
    },
  };
}
