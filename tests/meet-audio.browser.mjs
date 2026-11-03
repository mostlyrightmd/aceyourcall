import { chromium } from "playwright";
import http from "node:http";
import assert from "node:assert/strict";
import { installAudioBridge } from "../src/meet/audio-bridge.js";
const server = http.createServer((req, res) =>
  res.end("<!doctype html><title>Isolated audio test</title>"),
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    chromiumSandbox: process.platform === "linux",
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  const page = await browser.newPage();
  await page.addInitScript(installAudioBridge);
  await page.goto("http://localhost:" + server.address().port);
  if (process.platform === "linux") {
    // Meet checks native enumeration before it ever requests the bridged mic.
    // A sink monitor alone is not exposed as an audioinput by Chrome.
    await page.context().grantPermissions(["microphone"], {
      origin: "http://localhost:" + server.address().port,
    });
    const inputCount = await page.evaluate(async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "audioinput",
      ).length,
    );
    assert.ok(inputCount > 0, "Chrome must enumerate a virtual microphone");
  }
  const result = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    const ac = new AudioContext();
    await ac.resume();
    const source = ac.createMediaStreamSource(stream),
      meter = ac.createAnalyser();
    meter.fftSize = 256;
    source.connect(meter);
    const silence = ac.createGain();
    silence.gain.value = 0;
    meter.connect(silence);
    silence.connect(ac.destination);
    const rms = () => {
      const values = new Float32Array(256);
      meter.getFloatTimeDomainData(values);
      return Math.sqrt(values.reduce((n, v) => n + v * v, 0) / 256);
    };
    const before = rms();
    const toneStart = performance.now();
    await window.mockPartnerBridge.tone(3);
    // Routing test: a cold Linux audio renderer can start after the old fixed
    // 500 ms sample. Observe both edges with deadlines and report startup delay.
    let during = 0;
    while (performance.now() - toneStart < 5000) {
      await new Promise((r) => setTimeout(r, 50));
      during = rms();
      if (during > 0.01) break;
    }
    const toneOnsetMs = performance.now() - toneStart;
    let after = during;
    while (performance.now() - toneStart < 12000 && after >= 0.001) {
      await new Promise((r) => setTimeout(r, 100));
      after = rms();
    }
    const toneSilenceMs = performance.now() - toneStart;
    const status = window.mockPartnerBridge.status();
    // Remote participant -> Meet receiver -> interviewer input, entirely synthetic.
    const NativePC = RTCPeerConnection.prototype.constructor;
    const remote = new NativePC(),
      meet = new RTCPeerConnection();
    const remoteDest = ac.createMediaStreamDestination(),
      remoteTone = ac.createOscillator();
    remoteTone.frequency.value = 330;
    remoteTone.connect(remoteDest);
    const remoteMeter = ac.createAnalyser();
    remoteTone.connect(remoteMeter);
    remoteMeter.connect(silence);
    remoteTone.start();
    remote.addTrack(remoteDest.stream.getAudioTracks()[0], remoteDest.stream);
    remote.onicecandidate = (e) => {
      if (e.candidate) meet.addIceCandidate(e.candidate).catch(() => {});
    };
    meet.onicecandidate = (e) => {
      if (e.candidate) remote.addIceCandidate(e.candidate).catch(() => {});
    };
    await remote.setLocalDescription(await remote.createOffer());
    await meet.setRemoteDescription(remote.localDescription);
    await meet.setLocalDescription(await meet.createAnswer());
    await remote.setRemoteDescription(meet.localDescription);
    let incoming;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      incoming = window.mockPartnerBridge.status();
      if (incoming.inputRms > 0.01) break;
    }
    const rv = new Float32Array(256);
    remoteMeter.getFloatTimeDomainData(rv);
    incoming.sourceRms = Math.sqrt(rv.reduce((a, x) => a + x * x, 0) / 256);
    incoming.contextTime = ac.currentTime;
    incoming.contextState = ac.state;
    incoming.remoteState = remote.connectionState;
    incoming.meetState = meet.connectionState;
    incoming.stats = Array.from((await meet.getStats()).values())
      .filter((x) => x.type === "inbound-rtp")
      .map((x) => ({
        bytes: x.bytesReceived,
        audioLevel: x.audioLevel,
        totalAudioEnergy: x.totalAudioEnergy,
      }));
    // Mock the voice provider: verify both the bridge uplink and returned audio.
    const fakeLive = new NativePC();
    const feedbackMeter = ac.createAnalyser();
    feedbackMeter.connect(silence);
    let anchor;
    fakeLive.ontrack = (e) => {
      const received = new MediaStream([e.track]);
      anchor = new Audio();
      anchor.muted = true;
      anchor.srcObject = received;
      anchor.play();
      ac.createMediaStreamSource(received).connect(feedbackMeter);
    };
    const voiceTone = ac.createOscillator(),
      voiceGain = ac.createGain(),
      voiceDest = ac.createMediaStreamDestination();
    voiceGain.gain.value = 0.15;
    voiceTone.frequency.value = 660;
    voiceTone.connect(voiceGain);
    voiceGain.connect(voiceDest);
    voiceTone.start();
    fakeLive.addTrack(voiceDest.stream.getAudioTracks()[0], voiceDest.stream);
    const offer = await window.mockPartnerBridge.offer();
    await fakeLive.setRemoteDescription({ type: "offer", sdp: offer });
    await fakeLive.setLocalDescription(await fakeLive.createAnswer());
    if (fakeLive.iceGatheringState !== "complete")
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("fake voice ICE timeout")),
          10000,
        );
        fakeLive.onicegatheringstatechange = () => {
          if (fakeLive.iceGatheringState === "complete") {
            clearTimeout(timer);
            resolve();
          }
        };
      });
    await window.mockPartnerBridge.answer(fakeLive.localDescription.sdp);
    let voiceRms = 0,
      uplinkRms = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      voiceRms = rms();
      const v = new Float32Array(256);
      feedbackMeter.getFloatTimeDomainData(v);
      uplinkRms = Math.sqrt(v.reduce((n, x) => n + x * x, 0) / 256);
      if (voiceRms > 0.01 && uplinkRms > 0.01) break;
    }
    voiceTone.stop();
    fakeLive.close();
    if (anchor) {
      anchor.pause();
      anchor.srcObject = null;
    }
    remoteTone.stop();
    remote.close();
    meet.close();
    window.mockPartnerBridge.close();
    stream.getTracks().forEach((t) => t.stop());
    source.disconnect();
    await ac.close();
    window.mockPartnerBridge.dispose();
    return {
      before,
      during,
      after,
      toneOnsetMs,
      toneSilenceMs,
      status,
      incoming,
      voiceRms,
      uplinkRms,
      audioTracks: stream.getAudioTracks().length,
      videoTracks: stream.getVideoTracks().length,
    };
  });
  console.log(JSON.stringify(result));
  assert.equal(result.audioTracks, 1);
  assert.equal(result.videoTracks, 1);
  assert.ok(result.before < 0.001);
  assert.ok(result.during > 0.01, "tone must reach virtual microphone");
  assert.ok(result.after < 0.001);
  assert.equal(result.status.audioState, "running");
  assert.ok(result.incoming.receivedTracks >= 1);
  assert.ok(
    result.incoming.inputRms > 0.01,
    "remote RTP audio must reach interviewer input",
  );
  assert.ok(
    result.voiceRms > 0.01,
    "voice provider audio must reach Meet microphone",
  );
  assert.ok(result.uplinkRms > 0.01, "Meet input must reach voice provider");
  console.log(
    JSON.stringify({
      test: "software microphone tone and silence",
      passed: true,
      ...result,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
