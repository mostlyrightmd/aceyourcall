// Paid, synthetic AUDIO evaluation. Never part of offline CI.
// ACE_VOICE_EVAL=1 ACE_EVAL_ORIGIN=http://localhost:44419 ACE_EVAL_AUDIO=/tmp/ace-eval-audio node tests/voice-conversation.eval.mjs
// Supply 0.wav..4.wav from tests/fixtures/conversation-eval.json.
// Output is reviewed against that fixture rubric; timing/ASR assertions alone do not establish conversational quality.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import { isInterviewQuestion } from "../src/interview.js";
if (process.env.ACE_VOICE_EVAL !== "1")
  throw Error("Explicit paid evaluation opt-in required");
const origin = process.env.ACE_EVAL_ORIGIN;
if (!/^http:\/\/localhost:\d+$/.test(origin || ""))
  throw Error("Use an isolated local worker");
const audio = process.env.ACE_EVAL_AUDIO;
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/conversation-eval.json", import.meta.url)),
);
const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const replies = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, body) {
  const res = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(40000),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "API failure");
  return data;
}
const server = http.createServer((req, res) =>
  res.end("<!doctype html><title>Synthetic conversation evaluation</title>"),
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  channel: process.env.ACE_EVAL_BROWSER || "chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
let id, heartbeat, saved;
const latencies = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:" + server.address().port);
  const sdp = await page.evaluate(async () => {
    const ctx = new AudioContext(),
      destination = ctx.createMediaStreamDestination();
    const zero = ctx.createConstantSource(),
      gain = ctx.createGain();
    gain.gain.value = 0;
    zero.connect(gain).connect(destination);
    zero.start();
    const pc = new RTCPeerConnection();
    pc.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
    pc.createDataChannel("oai-events");
    pc.ontrack = (e) => {
      const a = new Audio();
      a.srcObject = new MediaStream([e.track]);
      a.muted = true;
      a.play();
      const remote = ctx.createMediaStreamSource(a.srcObject),
        mute = ctx.createGain();
      mute.gain.value = 0;
      remote.connect(mute).connect(ctx.destination);
      window.testAudio = a;
    };
    window.fixture = {
      pc,
      ctx,
      destination,
      speaking: false,
      play: async (bytes) => {
        const b = await ctx.decodeAudioData(new Uint8Array(bytes).buffer);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(destination);
        window.fixture.speaking = true;
        s.start();
        await new Promise((r) => (s.onended = r));
        window.fixture.speaking = false;
      },
    };
    await ctx.resume();
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.iceGatheringState !== "complete")
      await new Promise((r) =>
        pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") r();
        }),
      );
    return pc.localDescription.sdp;
  });
  ({ id, ...saved } = await api("/api/sessions", {
    profile: "speedrun-10",
    consent: true,
    synthetic: true,
    participants: [{ id: "alex", name: "Alex" }],
    sdp,
  }));
  await page.evaluate(
    (sdp) => window.fixture.pc.setRemoteDescription({ type: "answer", sdp }),
    saved.sdp,
  );
  heartbeat = setInterval(
    () =>
      api(`/api/sessions/${id}/heartbeat`, {
        participants: [{ id: "alex", name: "Alex" }],
      }).catch(() => {}),
    2000,
  );
  const session = async () =>
    (await api("/api/state")).sessions.find((s) => s.id === id);
  async function replyAfter(after, baseline, expected = "", inputBaseline = 0) {
    const deadline = Date.now() + 30000;
    let first,
      lastCount = 0,
      lastChange = Date.now();
    while (Date.now() < deadline) {
      saved = await session();
      const input = saved.transcript
        .filter((t) => t.speaker === "founders")
        .slice(inputBaseline);
      const completeInput =
        !expected ||
        normalize(input.map((t) => t.text).join("")).includes(
          normalize(expected).split(" ").slice(-5).join(" "),
        );
      const out = saved.transcript.filter((t) => t.speaker === "partner");
      const afterInput =
        !expected ||
        (input.length && out.at(-1)?.end_ms >= input.at(-1).end_ms);
      if (!completeInput || !afterInput) {
        await sleep(500);
        continue;
      }
      if (out.length !== lastCount) {
        lastCount = out.length;
        lastChange = Date.now();
      }
      if (out.length > baseline) {
        first ??= Date.now();
        const last = out.at(-1);
        if (
          isInterviewQuestion(
            out
              .slice(baseline)
              .filter((t) => !expected || t.end_ms >= input.at(-1).end_ms)
              .map((t) => t.text)
              .join(""),
          ) &&
          Date.now() - lastChange > 1800
        ) {
          latencies.push(first - after);
          return;
        }
      }
      if (saved.status === "complete") throw Error("Interview ended early");
      await sleep(500);
    }
    throw Error(
      "No complete interviewer question after the complete input within 30 seconds",
    );
  }
  await replyAfter(Date.now(), 0);
  for (let i = 0; i < fixture.turns.length; i++) {
    const inputBaseline = saved.transcript.filter(
      (t) => t.speaker === "founders",
    ).length;
    const baseline = saved.transcript.filter(
      (t) => t.speaker === "partner",
    ).length;
    await page.evaluate(
      (bytes) => window.fixture.play(bytes),
      [...readFileSync(`${audio}/${i}.wav`)],
    );
    const end = Date.now();
    await replyAfter(end, baseline, fixture.turns[i].answer, inputBaseline);
    replies.push(
      saved.transcript
        .filter((t) => t.speaker === "partner")
        .slice(baseline)
        .map((t) => t.text)
        .join(""),
    );
    console.log(
      JSON.stringify({
        turn: i + 1,
        partner: saved.transcript
          .filter((t) => t.speaker === "partner")
          .slice(baseline)
          .map((t) => t.text)
          .join(""),
        responseMs: latencies.at(-1),
        rubric: fixture.turns[i].rubric,
      }),
    );
  }
  assert.ok(
    saved.transcript.some((t) => t.speaker === "founders"),
    "Real input audio must be transcribed",
  );
  assert.deepEqual(saved.errors, []);
  assert.ok(
    !saved.agendaWarning,
    "Ordinary answers and coaching requests must not receive misconduct warnings",
  );
  // Exact repeats are a cheap regression check; semantic relevance still needs the rubric.
  const questions = replies
    .flatMap((t) => t.match(/[^?]+\?/g) || [])
    .map(normalize);
  assert.equal(
    new Set(questions).size,
    questions.length,
    "No exact question repeats",
  );
} finally {
  clearInterval(heartbeat);
  if (id) {
    await api(`/api/sessions/${id}/end`, {});
    await sleep(2500);
    saved = (await api("/api/state")).sessions.find((s) => s.id === id);
    writeFileSync(
      `${audio}/result.json`,
      JSON.stringify(
        { latencies, replies, rubric: fixture.turns, session: saved },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        id,
        status: saved.status,
        cost: saved.cost,
        errors: saved.errors,
      }),
    );
  }
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
