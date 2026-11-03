import { chromium } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { validateCaption } from "../src/named-transcription.js";
const bundle = await build({
  entryPoints: ["web/named-captions.js"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Captions",
});
const server = createServer((req, res) => {
  if (req.url === "/caption-worklet.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(readFileSync("public/caption-worklet.js"));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Caption capture test</title>");
  }
});
await new Promise((r) => server.listen(14338, "127.0.0.1", r));
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:14338");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const packets = await page.evaluate(async () => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.resume();
    const sent = [];
    const captions = await Captions.createNamedCaptions({
      ctx,
      elapsedMs: 0,
      send: async (p) => {
        sent.push(p);
      },
      onError: (message) => {
        throw Error(message);
      },
    });
    const tracks = [];
    for (let i = 0; i < 2; i++) {
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain(),
        dest = ctx.createMediaStreamDestination();
      oscillator.frequency.value = 440 + i * 220;
      gain.gain.value = 0.1;
      oscillator.connect(gain);
      gain.connect(dest);
      const track = {
        mediaStreamTrack: dest.stream.getAudioTracks()[0],
        isMuted: false,
      };
      const source = ctx.createMediaStreamSource(dest.stream);
      captions.add(track, source, {
        identity: `10000000-0000-4000-8000-00000000000${i + 1}`,
      });
      oscillator.start();
      gain.gain.setValueAtTime(0, ctx.currentTime + 1 + i * 0.2);
      tracks.push({ track, oscillator });
    }
    await new Promise((r) => setTimeout(r, 2200));
    // Muting flushes the existing utterance without reusing it when unmuted.
    tracks[0].track.isMuted = true;
    await new Promise((r) => setTimeout(r, 150));
    await captions.stop();
    for (const t of tracks) t.oscillator.stop();
    await ctx.close();
    return sent;
  });
  assert.equal(new Set(packets.map((p) => p.speakerId)).size, 2);
  assert.ok(packets.length >= 2);
  for (const p of packets) {
    const result = validateCaption({ ...p, speakerName: "Synthetic" }, 10000);
    assert.ok(result.pcm.some((byte) => byte !== 0));
    assert.ok(p.end_ms - p.start_ms <= 8100);
  }
  assert.deepEqual(errors, []);
  console.log(
    "Actual AudioWorklet: two overlapping microphones produced separate bounded PCM segments with stable participant IDs.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
