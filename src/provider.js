import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
let cachedKey;
export function key() {
  if (!cachedKey) {
    if (process.env.OPENAI_API_KEY_FILE) {
      try { cachedKey = readFileSync(process.env.OPENAI_API_KEY_FILE, "utf8").trim(); }
      catch { throw new Error("Cannot read OPENAI_API_KEY_FILE"); }
      if (!cachedKey) throw new Error("OPENAI_API_KEY_FILE is empty");
      return cachedKey;
    }
    if (process.env.OPENAI_API_KEY?.trim()) return cachedKey = process.env.OPENAI_API_KEY.trim();
    try {
      cachedKey = execFileSync(
        "gcloud",
        [
          "secrets",
          "versions",
          "access",
          "latest",
          "--secret=" + (process.env.MP_OPENAI_SECRET || "mp-openai-api-key"),
          "--project=" + (process.env.MP_GCP_PROJECT || "configure-your-gcp-project"),
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
      ).trim();
    } catch {
      throw new Error(
        "Set OPENAI_API_KEY or OPENAI_API_KEY_FILE, or configure the optional GCP Secret Manager adapter",
      );
    }
  }
  if (!cachedKey) throw new Error("Secret Manager returned an empty key");
  return cachedKey;
}
export async function createLive(sdp, profile, instructions) {
  const r = await fetch("https://api.openai.com/v1/live/sessions", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        model: "gpt-live-1",
        store: false,
        delegation: { type: "client" },
        client: {
          data_channel: {
            allowed_client_events: ["session.close"],
            allowed_server_events: [
              { type: "session.started" },
              { type: "session.closed" },
              { type: "error" },
            ],
          },
        },
        instructions,
        audio: { output: { voice: profile.voice } },
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text: `Speak immediately in English: ${profile.greeting} Then listen.`,
              },
            ],
          },
        ],
      },
      transport: { type: "webrtc", sdp },
    }),
  });
  if (!r.ok) {
    const error = new Error(
      `Voice API rejected creation (HTTP ${r.status}); check access and credit balance`,
    );
    // Explicit client rejections did not create a session. Transport/5xx failures remain uncertain.
    error.creationRejected =
      r.status >= 400 && r.status < 500 && r.status !== 408;
    throw error;
  }
  const body = await r.json();
  if (
    typeof body.session?.id !== "string" ||
    typeof body.transport?.sdp !== "string"
  )
    throw new Error("Unexpected Live API response");
  return body;
}
export function attach(id) {
  return new WebSocket(
    `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`,
    {
      headers: { Authorization: `Bearer ${key()}` },
      handshakeTimeout: 10000,
      maxPayload: 2 * 1024 * 1024,
    },
  );
}
export async function hangup(id) {
  // Reattach to the WebRTC session: the REST hangup endpoint is documented for SIP.
  const socket = attach(id);
  return await new Promise((resolve, reject) => {
    let complete = false;
    const finish = (ok) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      socket.close();
      ok ? resolve() : reject(new Error("Remote close unconfirmed"));
    };
    const timer = setTimeout(() => finish(false), 5000);
    socket.on("open", () =>
      socket.send(JSON.stringify({ type: "session.close" })),
    );
    socket.on("message", (raw) => {
      try {
        const e = JSON.parse(raw.toString());
        if (e.type === "session.closed") finish(true);
      } catch {}
    });
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
  });
}
