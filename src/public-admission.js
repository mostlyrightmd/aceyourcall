import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export function publicAdmission(
  db,
  origin,
  secret,
  { verify = fetch, now = Date.now } = {},
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS public_limits (key TEXT PRIMARY KEY, count INTEGER, expires INTEGER)",
  );
  const hash = (s) => createHmac("sha256", secret).update(s).digest("hex");
  function identity(req, res) {
    const raw =
      String(req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("mp_visitor="))
        ?.slice(11) || "";
    const [id, sig] = raw.split(".");
    let visitor;
    if (
      /^[a-f0-9]{48}$/.test(id || "") &&
      /^[a-f0-9]{64}$/.test(sig || "") &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(hash(id)))
    )
      visitor = id;
    else {
      visitor = randomBytes(24).toString("hex");
      res.setHeader(
        "Set-Cookie",
        `mp_visitor=${visitor}.${hash(visitor)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict`,
      );
    }
    const ip = String(
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown",
    )
      .split(",")
      .at(-1)
      .trim();
    return {
      device: hash("device:" + visitor),
      network: hash("network:" + ip),
    };
  }
  function limitMany(rules) {
    const time = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM public_limits WHERE expires <= ?").run(time);
      for (const [key, max] of rules) {
        const r = db
          .prepare("SELECT * FROM public_limits WHERE key=?")
          .get(key);
        if (r?.count >= max) {
          const seconds = Math.max(1, Math.ceil((r.expires - time) / 1000));
          const wait =
            seconds < 60
              ? `${seconds} seconds`
              : `${Math.ceil(seconds / 60)} minutes`;
          const scope = key.startsWith("create-device:")
            ? "This browser has reached its room limit"
            : key.startsWith("create-network:")
              ? "This network has reached its room limit"
              : key === "create-global"
                ? "Today's free room capacity has been reached"
                : "Too many requests";
          const error = new Error(`${scope}. Try again in ${wait}.`);
          error.status = 429;
          error.retryAfter = seconds;
          throw error;
        }
      }
      for (const [key, , ms] of rules)
        db.prepare(
          "INSERT INTO public_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
        ).run(key, 1, time + ms);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function limit(key, max, ms) {
    return limitMany([[key, max, ms]]);
  }
  async function challenge(token, expectedOrigin = origin) {
    if (typeof token !== "string" || token.length < 1 || token.length > 2048)
      throw Error("Complete the security check to continue.");
    const r = await verify(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.MP_TURNSTILE_SECRET,
          response: token,
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    const result = await r.json();
    if (
      !r.ok ||
      !result.success ||
      result.hostname !== new URL(expectedOrigin).hostname ||
      result.action !== "create-room"
    )
      throw Error("Security check expired. Please try again.");
  }
  return { identity, limit, limitMany, challenge };
}
