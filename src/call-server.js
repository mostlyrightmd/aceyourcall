import { capture, browserEvents } from "./analytics.js";
import { publicStats } from "./public-stats.js";
import { roomLinks } from "./room-links.js";
import { publicAdmission } from "./public-admission.js";
import { operatorPool } from "./operator-pool.js";
import { consentChoices, POLICY_VERSION } from "./consent.js";
import { roomContext, roomProfile } from "./room-context.js";
import YAML from "yaml";
import http from "node:http";
import { requestOrigin } from "./call-origins.js";
import { sendStatic } from "./static-assets.js";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  AccessToken,
  RoomConfiguration,
  TrackSource,
  RoomServiceClient,
  WebhookReceiver,
} from "livekit-server-sdk";
import { openStore } from "./store.js";
const origin = process.env.MP_CALL_ORIGIN || "http://localhost:4320";
const key = process.env.LIVEKIT_API_KEY,
  secret = process.env.LIVEKIT_API_SECRET;
const master = process.env.MP_CALL_ACCESS;
if (!key || !secret || !master || master.length < 32)
  throw Error("Call service credentials missing");
// Preview admission is deliberately loopback-only; this is not a public launch switch.
const communityPreview =
  process.env.MP_COMMUNITY_PREVIEW === "1" &&
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
const publicLaunch = process.env.MP_PUBLIC_LAUNCH === "1";
// Internal team testing retains bot, request, capacity and spending guards.
const internalTesting = process.env.MP_INTERNAL_TESTING === "1";
if (
  publicLaunch &&
  (!process.env.MP_TURNSTILE_SITEKEY ||
    !process.env.MP_TURNSTILE_SECRET ||
    !process.env.MP_OPERATOR_POOL_PATH ||
    process.env.MP_MEDIA_WEBHOOK_READY !== "1")
)
  throw Error(
    "Public launch requires a funded operator pool and Turnstile configuration",
  );
const store = openStore("private/rooms.sqlite", {
  ephemeralApplications: true,
});
setInterval(() => store.prune(), 60000).unref();
const links = roomLinks(store.db, master, origin);
// Extend still-valid legacy rooms once; never revive expired capabilities.
for (const row of store.db.prepare("SELECT key,value FROM settings").all()) {
  const room = JSON.parse(row.value);
  if (
    room?.id === row.key &&
    room.expires > Date.now() &&
    !room.preparationVersion
  ) {
    room.created = room.expires - 86400000;
    room.expires += 6 * 86400000;
    room.preparationVersion = 1;
    store.set(row.key, room);
    store.db
      .prepare("UPDATE room_links SET expires=? WHERE room_id=?")
      .run(room.expires, room.id);
  }
}

store.db.exec(
  "CREATE TABLE IF NOT EXISTS privacy_consents (id TEXT PRIMARY KEY, room_id TEXT, created INTEGER, data TEXT)",
);
store.db.exec(
  "CREATE TABLE IF NOT EXISTS room_participants(id TEXT PRIMARY KEY, room_id TEXT, name TEXT, created INTEGER)",
);
function saveConsent(roomId, identity, choices) {
  store.db
    .prepare("INSERT INTO privacy_consents VALUES(?,?,?,?)")
    .run(identity, roomId, choices.at, JSON.stringify(choices));
}
function authenticatedParticipants(room, entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.slice(0, 3).flatMap((entry) => {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (seen.has(id)) return [];
    seen.add(id);
    const row = store.db
      .prepare("SELECT name FROM room_participants WHERE id=? AND room_id=?")
      .get(String(id || ""), room.id);
    return row
      ? [{ id, name: row.name, speaking: entry?.speaking === true }]
      : [];
  });
}
function saveRoom(room) {
  const research = room.research;
  // Keep the public profile in its TTL-governed cache only, not in room copies.
  store.set(room.id, {
    ...room,
    interviewerSettings: room.context?.interviewer || room.interviewerSettings,
    preparation: room.preparation
      ? {
          id: room.preparation.id,
          worker: room.preparation.worker,
          status: room.preparation.status,
          error: room.preparation.error,
        }
      : undefined,
    research: research
      ? { id: research.id, status: research.status, error: research.error }
      : undefined,
  });
}
async function queueResearch(room) {
  if (room.context?.application) {
    try {
      room.preparation = await pool.prepare(room, room.context);
      if (!/^[a-f0-9]{64}$/.test(room.preparation?.id || ""))
        throw Error("Invalid preparation response");
    } catch {
      room.preparation = {
        status: "failed",
        error:
          "Business preparation unavailable. Save the application to retry.",
      };
    }
  }
  const person = room.context?.interviewer;
  if (!person?.name && !person?.linkedin) {
    delete room.research;
    return;
  }
  try {
    room.research = await backend("/api/interviewer-research", {
      name: person.name,
      linkedin: person.linkedin,
    });
    if (!/^[a-f0-9]{64}$/.test(room.research?.id || ""))
      throw Error("Invalid research response");
  } catch {
    room.research = {
      status: "failed",
      error: "Research unavailable. You can continue with your supplied notes.",
    };
  }
}
async function refreshResearch(room) {
  if (room.preparation?.id) {
    try {
      const worker = room.preparation.worker;
      const next = await backend(
        "/api/business-preparation/" + room.preparation.id,
        undefined,
        worker,
      );
      room.preparation = next
        ? { ...next, worker }
        : {
            status: "failed",
            error: "Preparation expired. Save the application to refresh.",
          };
    } catch {
      room.preparation = {
        ...room.preparation,
        status: "failed",
        error: "Business preparation temporarily unavailable.",
      };
    }
    saveRoom(room);
  }
  if (!room.research?.id) return;
  try {
    const next = await backend("/api/interviewer-research/" + room.research.id);
    if (next) {
      room.research = next;
      saveRoom(room);
    } else {
      room.research = {
        status: "failed",
        error: "Research expired. Save interviewer details to refresh.",
      };
      saveRoom(room);
    }
  } catch {
    room.research = {
      ...room.research,
      status: "failed",
      error: "Research temporarily unavailable. Using your notes.",
    };
  }
}
function pruneRooms() {
  store.db.prepare("DELETE FROM room_links WHERE expires < ?").run(Date.now());
  store.db
    .prepare("DELETE FROM room_participants WHERE created < ?")
    .run(Date.now() - 86400000);
  store.db
    .prepare("DELETE FROM privacy_consents WHERE created < ?")
    .run(Date.now() - 30 * 86400000);
  for (const entry of store.db
    .prepare("SELECT key,value FROM settings")
    .all()) {
    const room = JSON.parse(entry.value);
    if (room?.expires && room.expires < Date.now())
      store.db.prepare("DELETE FROM settings WHERE key=?").run(entry.key);
  }
}
pruneRooms();
setInterval(pruneRooms, 3600000).unref();
const editing = new Set();
const random = () => randomBytes(32).toString("base64url");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const operatorOrigin =
  process.env.MP_OPERATOR_ORIGIN || "http://localhost:4317";
const pool = operatorPool(store.db, operatorOrigin);
const getPublicStats = publicStats(pool);
const admission = publicAdmission(store.db, origin, master);
const rtcService = new RoomServiceClient(
  (
    process.env.LIVEKIT_INTERNAL_URL ||
    process.env.LIVEKIT_URL ||
    "http://localhost:7880"
  ).replace(/^ws/, "http"),
  key,
  secret,
);
setInterval(async () => {
  for (const entry of store.db.prepare("SELECT value FROM settings").all()) {
    const room = JSON.parse(entry.value);
    if (
      room.mediaDeadline &&
      !room.mediaClosed &&
      room.mediaDeadline < Date.now()
    ) {
      try {
        await rtcService.deleteRoom(room.id);
        room.mediaClosed = true;
        saveRoom(room);
      } catch {}
    }
  }
}, 30000).unref();
const backend = (path, body, worker) =>
  path === "/api/state" ? pool.state() : pool.call(path, body, worker);
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function body(req) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (Buffer.byteLength(raw) > 450000) throw Error("Request too large");
  }
  return JSON.parse(raw || "{}");
}
const server = http.createServer(async (req, res) => {
  const styleNonce = randomBytes(18).toString("base64");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=()",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; connect-src 'self' https://challenges.cloudflare.com ${process.env.LIVEKIT_URL || "ws://localhost:7880"}; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'nonce-${styleNonce}'; media-src 'self' blob:; worker-src blob:; frame-ancestors 'none'; base-uri 'none'`,
  );
  const incomingOrigin = requestOrigin(
    req,
    origin,
    process.env.MP_CALL_ALIAS_ORIGINS,
  );
  if (!incomingOrigin) return json(res, 403, { error: "Invalid host" });
  if (
    (req.headers.origin && req.headers.origin !== incomingOrigin) ||
    (req.method !== "GET" &&
      req.headers.origin !== incomingOrigin &&
      !(req.method === "POST" && req.url === "/rtc-events"))
  )
    return json(res, 403, { error: "Invalid origin" });
  try {
    const path = new URL(req.url, origin).pathname;
    if (path === "/practice" && req.method === "GET") {
      res.writeHead(308, {
        Location: "/new" + new URL(req.url, origin).search,
      });
      return res.end();
    }
    if (path === "/analytics" && req.method === "POST") {
      admission.limit("analytics:global", 600, 60000);
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 512)
          return json(res, 413, { error: "Too large" });
      }
      const input = JSON.parse(raw || "{}");
      if (
        !browserEvents.has(input.event) ||
        !/^[a-f0-9-]{36}$/.test(input.id || "")
      )
        return json(res, 400, { error: "Invalid event" });
      if (req.headers.dnt !== "1" && req.headers["sec-gpc"] !== "1")
        capture(input.event, input.id);
      return json(res, 202, { ok: true });
    }
    if (path === "/rtc-events" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 100000) throw Error("Webhook too large");
      }
      const event = await new WebhookReceiver(key, secret).receive(
        raw,
        req.headers.authorization,
      );
      if (["room_started", "participant_joined"].includes(event.event)) {
        const room = store.get(event.room?.name);
        if (
          !room ||
          room.expires < Date.now() ||
          (room.publicRoom &&
            (!room.mediaDeadline || room.mediaDeadline < Date.now()))
        )
          await rtcService.deleteRoom(event.room.name);
      }
      return json(res, 200, { ok: true });
    }
    if (
      (req.method === "GET" &&
        [
          "/",
          "/new",
          "/favicon.svg",
          "/favicon-16.png",
          "/favicon-32.png",
          "/favicon-180.png",
          "/aceyourcall-logo.svg",
          "/landing.css",
          "/landing.js",
          "/analytics.js",
          "/og-lighthouse.png",
          "/og-light-minimal.png",
          "/x-light-minimal.png",
          "/call.css",
          "/entry.css",
          "/entry-coast.webp",
          "/theme.js",
          "/theme.css",
          "/theme-dark.png",
          "/theme-light.png",
          "/seeam-noor.png",
          "/caption-worklet.js",
          "/terms",
          "/privacy",
        ].includes(path)) ||
      (req.method === "GET" && path.startsWith("/r/") && path.length < 100) ||
      (req.method === "GET" &&
        /^\/app\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(path))
    ) {
      const file =
        path === "/"
          ? "landing.html"
          : path === "/new" || path.startsWith("/r/")
            ? "app/index.html"
            : ["/terms", "/privacy"].includes(path)
              ? path.slice(1) + ".html"
              : path.slice(1);
      res.setHeader(
        "Content-Type",
        file.endsWith(".webp")
          ? "image/webp"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : file.endsWith(".png")
              ? "image/png"
              : file.endsWith(".js")
                ? "text/javascript"
                : file.endsWith(".css")
                  ? "text/css"
                  : "text/html",
      );
      if (path === "/new" || path.startsWith("/r/"))
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
      return sendStatic(req, res, file, styleNonce, origin);
    }
    if (path === "/stats" && req.method === "GET") {
      try {
        return json(res, 200, await getPublicStats());
      } catch {
        return json(res, 503, { error: "Count unavailable" });
      }
    }
    if (path === "/robots.txt" && req.method === "GET") {
      res.setHeader("Content-Type", "text/plain");
      return res.end(
        `User-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /rooms/\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`,
      );
    }
    if (path === "/sitemap.xml" && req.method === "GET") {
      res.setHeader("Content-Type", "application/xml");
      return res.end(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`,
      );
    }
    if (path === "/config" && req.method === "GET")
      return json(res, 200, {
        communityPreview: communityPreview || publicLaunch,
        canCreate: links.creator(req),
        turnstileSitekey: publicLaunch
          ? process.env.MP_TURNSTILE_SITEKEY
          : undefined,
        policyVersion: POLICY_VERSION,
      });
    if (publicLaunch) {
      const identity = admission.identity(req, res);
      admission.limit("requests:" + identity.network, 1200, 60000);
    }
    const auth = req.headers.authorization?.replace(/^Bearer /, "");
    if (path === "/creator-access" && req.method === "POST") {
      const input = await body(req);
      const room =
        typeof input.roomId === "string" ? store.get(input.roomId) : null;
      const privateHost =
        room &&
        room.expires > Date.now() &&
        room.publicRoom === false &&
        !communityPreview &&
        equal(auth, room.host);
      if (!equal(auth, master) && !privateHost && !links.creator(req))
        return json(res, 403, { error: "Creator access required" });
      links.remember(res);
      return json(res, 200, { ok: true });
    }
    if (path === "/room-code" && req.method === "POST") {
      const identity = admission.identity(req, res);
      try {
        admission.limit("code:" + identity.network, 30, 60000);
      } catch {
        return json(res, 429, {
          error: "Too many attempts. Try again in a minute.",
        });
      }
      const input = await body(req);
      const id = links.resolve(input.code),
        room = id ? store.get(id) : null;
      if (!room || room.expires <= Date.now())
        return json(res, 404, {
          error: "Code not found or expired. Check it with your host.",
        });
      return json(res, 200, {
        id: room.id,
        guest: room.guest,
        code: links.code(room),
      });
    }
    if (path === "/rooms" && req.method === "POST") {
      const privateCreator = equal(auth, master) || links.creator(req);
      if (!privateCreator && !communityPreview && !publicLaunch)
        return json(res, 403, {
          error: "Open your private creator link to create a room",
        });
      const input = await body(req);
      let publicIdentity;
      if (!privateCreator && publicLaunch) {
        publicIdentity = admission.identity(req, res);
        admission.limit("attempt:" + publicIdentity.network, 10, 60000);
        await admission.challenge(input.challenge, incomingOrigin);
        if (!(await pool.state()).enabled)
          throw Error(
            "Free interview capacity is unavailable. Please try again later.",
          );
        pruneRooms();
        if (store.db.prepare("SELECT count(*) n FROM settings").get().n >= 500)
          throw Error("Free rooms are currently full. Please try again later.");
      }
      const choices = consentChoices(input.permissions);
      const context = Object.hasOwn(input, "application")
        ? roomContext(input)
        : null;
      if (!privateCreator && !context)
        throw Error("Add your application first.");
      const initial = context ? null : await backend("/api/state");
      if (publicIdentity && !internalTesting) {
        admission.limitMany([
          ["create-global", 40, 86400000],
          ["create-device:" + publicIdentity.device, 3, 86400000],
          ["create-network:" + publicIdentity.network, 10, 86400000],
        ]);
      }
      const id = randomUUID(),
        room = {
          id,
          created: Date.now(),
          preparationVersion: 1,
          publicRoom: !!publicIdentity,
          publicIdentity,
          attempts: 0,
          host: random(),
          guest: random(),
          expires: Date.now() + 7 * 86400000,
          sessions: [],
          context: context || {
            application: initial.application,
            facts: YAML.parse(initial.facts || "{}"),
            interviewer: { name: "", linkedin: "", notes: "" },
          },
          legacyPreset: !context,
        };
      await queueResearch(room);
      saveRoom(room);
      saveConsent(id, "creator:" + id, choices);
      capture("room_created");
      return json(res, 201, {
        id,
        host: room.host,
        guest: room.guest,
        code: links.code(room),
      });
    }
    const match = path.match(/^\/rooms\/([a-f0-9-]+)(?:\/(.*))?$/);
    if (!match) return json(res, 404, { error: "Not found" });
    let room = store.get(match[1]);
    if (!room || room.expires < Date.now())
      return json(res, 404, { error: "Room expired; create a new room" });
    const host = equal(auth, room.host);
    if (!host && !equal(auth, room.guest))
      return json(res, 403, { error: "Invalid invite" });
    if (room.starting && Date.now() - (room.startingAt || 0) > 90000) {
      const recovered = await pool.call(
        "/api/state",
        undefined,
        room.pendingWorker || "default",
      );
      for (const session of recovered.sessions.filter(
        (s) => s.roomId === room.id,
      )) {
        if (!room.sessions.includes(session.id)) room.sessions.push(session.id);
        (room.sessionWorkers ||= {})[session.id] =
          room.pendingWorker || "default";
      }
      room.starting = false;
      pool.release(room.id);
      saveRoom(room);
    }
    const action = match[2] || "",
      b = req.method === "POST" ? await body(req) : undefined;
    room = store.get(match[1]);
    if (action === "join" && req.method === "POST") {
      if (b.consent !== true) throw Error("Consent is required to join");
      if (room.publicRoom) {
        if (room.mediaDeadline && room.mediaDeadline < Date.now()) {
          if (
            Date.now() -
              (room.practiceDayStarted || room.mediaDeadline - 25 * 60000) <
            86400000
          )
            throw Error(
              "Today’s practice window has ended. Return tomorrow or create a new room.",
            );
          room.mediaDeadline = null;
          room.mediaClosed = false;
          room.attempts = 0;
        }
        admission.limit("join:" + room.id, 30, 3600000);
        if (!room.mediaDeadline) {
          const activeRooms = store.db
            .prepare("SELECT value FROM settings")
            .all()
            .filter(
              (e) => JSON.parse(e.value).mediaDeadline > Date.now(),
            ).length;
          if (activeRooms >= 40)
            throw Error(
              "Free rooms are full. Please try joining again shortly.",
            );
          room.mediaDeadline = Date.now() + 25 * 60000;
          room.practiceDayStarted = Date.now();
          saveRoom(room);
        }
      }
      const ai = b.ai === true;
      if (ai && !host) return json(res, 403, { error: "Host only" });
      const identity = ai ? "interviewer" : randomUUID();
      const choices = ai ? null : consentChoices(b.permissions);
      const displayName = ai
        ? "AceYourCall"
        : String(b.name || "Founder")
            .trim()
            .slice(0, 60) || "Founder";
      const token = new AccessToken(key, secret, {
        identity,
        name: displayName,
        ttl: room.publicRoom
          ? Math.max(
              1,
              Math.min(
                600,
                Math.floor((room.mediaDeadline - Date.now()) / 1000),
              ),
            )
          : "10m",
      });
      token.roomConfig = new RoomConfiguration({
        maxParticipants: 4,
        emptyTimeout: 300,
        departureTimeout: 20,
      });
      token.addGrant({
        room: room.id,
        roomJoin: true,
        canPublish: true,
        canSubscribe: !ai,
        canPublishData: false,
        canPublishSources: ai
          ? [TrackSource.MICROPHONE]
          : [TrackSource.CAMERA, TrackSource.MICROPHONE],
      });
      if (choices) {
        saveConsent(room.id, identity, choices);
        store.db
          .prepare("INSERT INTO room_participants VALUES(?,?,?,?)")
          .run(identity, room.id, displayName, Date.now());
      }
      return json(res, 200, {
        token: await token.toJwt(),
        url: process.env.LIVEKIT_URL,
        host,
      });
    }
    if (action === "link" && req.method === "GET") {
      return json(res, 200, { code: links.code(room), host });
    }
    if (action === "presence" && req.method === "GET") {
      try {
        const rooms = await rtcService.listRooms([room.id]);
        const participants = rooms.length
          ? await rtcService.listParticipants(room.id)
          : [];
        return json(res, 200, {
          count: participants.filter((p) => p.identity !== "interviewer")
            .length,
          code: links.code(room),
        });
      } catch {
        return json(res, 200, { count: null, code: links.code(room) });
      }
    }
    if (action === "state" && req.method === "GET") {
      if (host && !room.preparation && room.context?.application) {
        await queueResearch(room);
        saveRoom(room);
      }
      await refreshResearch(room);
      const state = await pool.state(room);
      return json(res, 200, {
        host,
        invite: host ? room.guest : undefined,
        profiles: state.profiles.map((p) => {
          const { id, title, interviewer } = roomProfile(
            p,
            room.legacyPreset
              ? null
              : {
                  ...room.context,
                  interviewer:
                    room.context?.interviewer || room.interviewerSettings,
                  research: room.research?.result,
                },
          );
          return { id, title, interviewer };
        }),
        enabled: state.enabled && !state.kill,
        busy: state.busy,
        preparation: room.preparation
          ? { status: room.preparation.status, error: room.preparation.error }
          : undefined,
        research: room.research
          ? {
              status: room.research.status,
              result: room.research.result,
              error: room.research.error,
            }
          : undefined,
        queueEnabled: true,
        capacity: state.capacity,
        sessions: state.sessions.filter((s) => room.sessions.includes(s.id)),
        application: host ? (room.context?.application ?? "") : undefined,
        facts: host
          ? room.context
            ? YAML.stringify(room.context.facts)
            : "{}"
          : undefined,
        interviewer: host
          ? room.context?.interviewer || room.interviewerSettings
          : undefined,
      });
    }
    if (action === "withdraw-permissions" && req.method === "POST") {
      // Any participant may stop optional reuse of the shared room content.
      store.db
        .prepare(
          "UPDATE privacy_consents SET data=json_set(data,'$.withdrawn',json('true'),'$.sales',json('false'),'$.improvement',json('false'),'$.email','') WHERE room_id=?",
        )
        .run(room.id);
      return json(res, 200, { ok: true });
    }
    if (!host) return json(res, 403, { error: "Host only" });
    if (action === "grounding" && req.method === "POST") {
      if (room.starting || editing.has(room.id))
        throw Error("Wait for the current room update to finish.");
      editing.add(room.id);
      try {
        const state = await backend("/api/state");
        if (
          state.sessions.some(
            (s) =>
              room.sessions.includes(s.id) &&
              ["live", "connecting", "closing"].includes(s.status),
          )
        )
          throw Error("End the interview before editing context.");
        room.context = roomContext(b);
        await queueResearch(room);
        room.legacyPreset = false;
        saveRoom(room);
        return json(res, 200, { ok: true });
      } finally {
        editing.delete(room.id);
      }
    }
    if (action === "queue" && req.method === "POST") {
      if (room.starting) throw Error("Interview is already starting");
      return json(
        res,
        200,
        await pool.admission(room.id, b.cancel ? "cancel" : "join"),
      );
    }
    if (action === "start" && req.method === "POST") {
      await refreshResearch(room);
      if (["queued", "searching"].includes(room.preparation?.status))
        throw Error("Business preparation is still in progress.");
      if (["queued", "searching"].includes(room.research?.status))
        throw Error("Interviewer research is still in progress.");
      if (room.starting || editing.has(room.id))
        throw Error("Wait for the current room update to finish.");
      const prepared =
        room.preparation?.status === "ready" ? room.preparation.result : null;
      if (!room.context?.application && prepared)
        room.context = {
          application: prepared.brief,
          facts: {},
          interviewer: room.interviewerSettings || {},
        };
      if (!room.context?.application)
        throw Error(
          "Application expired from memory. Open Company context and paste or upload it again.",
        );
      room.starting = true;
      room.startingAt = Date.now();
      saveRoom(room);
      try {
        if (
          room.publicRoom &&
          (room.attempts >= 2 ||
            !Number.isFinite(room.mediaDeadline) ||
            room.mediaDeadline < Date.now() + 11 * 60000)
        )
          throw Error(
            "This room’s practice allowance is used. Create a new room later.",
          );
        const existing = await pool.state(room);
        if (
          existing.sessions.some((s) =>
            ["live", "connecting", "closing"].includes(s.status),
          )
        )
          throw Error("An interview is already running in this room");
        await pool.admission(room.id);
        const allocation = await pool.admission(room.id, "claim");
        room.pendingWorker = allocation.worker;
        room.attempts = (room.attempts || 0) + 1;
        saveRoom(room);
        const s = await backend(
          "/api/sessions",
          {
            consent: true,
            profile: b.profile,
            sdp: b.sdp,
            roomId: room.id,
            namedTranscription: b.namedTranscription === true,
            participants: authenticatedParticipants(room, b.participantIds),
            interviewerResearch: room.research?.result,
            preparation: prepared,
            context: room.context || roomContext(await backend("/api/state")),
            legacyPreset: room.legacyPreset || !room.context,
          },
          allocation.worker,
        );
        (room.sessionWorkers ||= {})[s.id] = allocation.worker;
        room.sessions.push(s.id);
        capture("interview_started", s.id);
        return json(res, 201, s);
      } finally {
        room.starting = false;
        pool.release(room.id);
        saveRoom(room);
      }
    }
    const session = action.match(
      /^sessions\/([a-f0-9-]+)\/(heartbeat|end|scorecard|caption)$/,
    );
    if (
      session &&
      req.method === "POST" &&
      room.sessions.includes(session[1])
    ) {
      if (session[2] === "caption") {
        const participant = store.db
          .prepare(
            "SELECT name FROM room_participants WHERE id=? AND room_id=?",
          )
          .get(String(b.speakerId || ""), room.id);
        if (!participant)
          throw Error("Microphone participant must rejoin this room");
        return json(
          res,
          200,
          await backend(
            "/api/sessions/" + session[1] + "/caption",
            {
              timebase: b.timebase,
              failureReason: b.failureReason,
              chunkId: b.chunkId,
              speakerId: b.speakerId,
              speakerName: participant.name,
              start_ms: b.start_ms,
              end_ms: b.end_ms,
              pcm: b.pcm,
              failed: b.failed === true,
            },
            room.sessionWorkers?.[session[1]] || "default",
          ),
        );
      }
      return json(
        res,
        200,
        await backend(
          "/api/sessions/" + session[1] + "/" + session[2],
          session[2] === "heartbeat"
            ? {
                started: b.started === true,
                humanSpeaking: b.humanSpeaking === true,
                partnerSpeaking: b.partnerSpeaking === true,
                participants: Array.isArray(b.participants)
                  ? authenticatedParticipants(room, b.participants)
                  : undefined,
              }
            : session[2] === "end"
              ? { reason: b.reason }
              : {},
          room.sessionWorkers?.[session[1]] || "default",
        ),
      );
    }
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e.code === "ENOENT") return json(res, 404, { error: "Not found" });
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    json(res, e.status === 429 ? 429 : 400, { error: e.message.slice(0, 240) });
  }
});
server.requestTimeout = 60000;
server.listen(
  Number(process.env.CALL_PORT || 4320),
  process.env.MP_CALL_BIND || "127.0.0.1",
  () => console.log("Private call gateway listening"),
);
