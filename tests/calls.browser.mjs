// Real SFU test through an IAP signaling tunnel; media traverses the VM's public UDP ports.
// No OpenAI calls and no human camera/microphone are used.
import { chromium } from "playwright";
import { readFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const config = Object.fromEntries(
  readFileSync("private/calls-vm.env", "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split("=")),
);
const paid = process.env.MP_PAID_SMOKE === "1";
let operator;
if (paid) {
  const dir = process.cwd() + "/private/call-smoke";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of ["src", "public", "profiles", "grounding"])
    if (!existsSync(dir + "/" + name))
      symlinkSync(process.cwd() + "/" + name, dir + "/" + name);
  operator = spawn(process.execPath, [process.cwd() + "/src/server.js"], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: "14323",
      MP_PAID_ENABLED: "1",
      MP_APPROVED_USD: "0.85",
    },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    operator.stdout.once("data", resolve);
    operator.once("exit", () => reject(Error("test operator failed")));
  });
}
const publicTest = process.env.MP_PUBLIC_TEST === "1";
if (publicTest && paid) throw Error("Paid smoke uses an isolated backend only");
const origin = publicTest
  ? "https://practice.mostlyright.md"
  : "http://localhost:14322";
const gateway = publicTest
  ? null
  : spawn(process.execPath, ["src/call-server.js"], {
      env: {
        ...process.env,
        ...config,
        MP_CALL_ORIGIN: origin,
        CALL_PORT: "14322",
        LIVEKIT_URL: process.env.MP_TEST_LIVEKIT_URL || "ws://localhost:17880",
        ...(paid ? { MP_OPERATOR_ORIGIN: "http://localhost:14323" } : {}),
      },
      stdio: "pipe",
    });
let browser;
try {
  if (gateway)
    await new Promise((resolve, reject) => {
      gateway.stdout.once("data", resolve);
      gateway.once("exit", () => reject(Error("gateway failed")));
    });
  const response = await fetch(origin + "/rooms", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: "Bearer " + config.MP_CALL_ACCESS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      application: "Synthetic media check for scheduling software.",
      permissions: {
        version: "2026-11-01",
        terms: true,
        sales: false,
        improvement: false,
      },
    }),
  });
  const room = await response.json();
  assert.ok(room.id);
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const pages = [];
  for (const [name, key] of [
    ["Test founder 1", room.host],
    ["Test founder 2", room.guest],
  ]) {
    const context = await browser.newContext({
      permissions: [
        "camera",
        "microphone",
        "clipboard-read",
        "clipboard-write",
      ],
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.addInitScript((relayOnly) => {
      const Native = window.RTCPeerConnection;
      window.testPeers = [];
      window.RTCPeerConnection = class extends Native {
        constructor(...args) {
          if (relayOnly)
            args[0] = {
              ...args[0],
              iceTransportPolicy: "relay",
              iceServers: (args[0]?.iceServers || [])
                .map((s) => ({
                  ...s,
                  urls: [s.urls].flat().filter((u) => u.startsWith("turns:")),
                }))
                .filter((s) => s.urls.length),
            };
          super(...args);
          window.testPeers.push(this);
        }
        setConfiguration(config) {
          if (relayOnly)
            config = {
              ...config,
              iceTransportPolicy: "relay",
              iceServers: (config.iceServers || [])
                .map((s) => ({
                  ...s,
                  urls: [s.urls].flat().filter((u) => u.startsWith("turns:")),
                }))
                .filter((s) => s.urls.length),
            };
          return super.setConfiguration(config);
        }
      };
    }, process.env.MP_RELAY_ONLY === "1");
    pages.push(page);
    page.on("pageerror", (e) => console.error("Browser error:", e.message));
    await page.goto(
      origin + "/#" + new URLSearchParams({ room: room.id, key }),
    );
    await page.locator("#name").fill(name);
    await page.locator("#join").click();
    await page.locator("#call").waitFor({ state: "visible", timeout: 30000 });
  }
  for (const page of pages) {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".tile video").length === 2 &&
        [...document.querySelectorAll(".tile video")].every(
          (v) => v.readyState >= 2 && v.currentTime > 0,
        ),
      {},
      { timeout: 30000 },
    );
    const network = await page.evaluate(async () => {
      const pairs = [];
      for (const peer of window.testPeers)
        for (const stat of (await peer.getStats()).values())
          if (
            stat.type === "candidate-pair" &&
            stat.nominated &&
            stat.state === "succeeded"
          )
            pairs.push({
              rttMs: Math.round((stat.currentRoundTripTime || 0) * 1000),
              bytesReceived: stat.bytesReceived,
              candidateType: (await peer.getStats()).get(stat.localCandidateId)
                ?.candidateType,
              relayProtocol: (await peer.getStats()).get(stat.localCandidateId)
                ?.relayProtocol,
            });
      return pairs;
    });
    console.log("Selected network paths:", JSON.stringify(network));
    if (process.env.MP_RELAY_ONLY === "1")
      assert.ok(
        network.length && network.every((p) => p.candidateType === "relay"),
        "Expected relay-only selected paths",
      );
    const level = await page.evaluate(async () => {
      const el = document.querySelector(".tile audio");
      if (!el?.srcObject) throw Error("Missing remote audio");
      const ctx = new AudioContext();
      await ctx.resume();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(el.srcObject).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peak = 0;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        analyser.getFloatTimeDomainData(samples);
        peak = Math.max(peak, ...samples.map(Math.abs));
      }
      await ctx.close();
      return peak;
    });
    assert.ok(level > 0.001, `Incoming audio should have signal, got ${level}`);
    console.log(
      "Verified two videos and incoming audio signal:",
      level.toFixed(4),
    );
  }
  if (paid) {
    const host = pages[0];
    if (!(await host.locator("#background-dialog").isVisible()))
      await host.locator("#room-settings").click();
    await host.locator("#background-open").click();
    await host
      .locator("#application")
      .fill(
        "SYNTHETIC TEST ONLY. Fictional founder Alex builds scheduling software for gardeners. Three trial users; no revenue. These are not Mostly Right facts.",
      );
    await host.locator("#save").click();
    await host.locator("#start").click();
    try {
      await host.waitForFunction(
        () =>
          [...document.querySelectorAll(".tile span")].some(
            (el) => el.textContent === "AceYourCall",
          ),
        {},
        { timeout: 30000 },
      );
      await host.waitForFunction(
        () =>
          [...document.querySelectorAll(".tile")].some(
            (el) =>
              el.textContent.includes("AceYourCall") &&
              el.querySelector("audio")?.readyState >= 2,
          ),
        {},
        { timeout: 20000 },
      );
      if (process.env.MP_ADVERSARIAL_SMOKE === "1") {
        const wav = readFileSync("private/derail-test.wav").toString("base64");
        await host.evaluate(async (bytes) => {
          const ctx = new AudioContext({ sampleRate: 48000 });
          await ctx.resume();
          const audio = await ctx.decodeAudioData(
            Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)).buffer,
          );
          const dest = ctx.createMediaStreamDestination(),
            source = ctx.createBufferSource();
          source.buffer = audio;
          source.connect(dest);
          const sender = window.testPeers
            .flatMap((p) => p.getSenders())
            .find((s) => s.track?.label === "MediaStreamAudioDestinationNode");
          if (!sender) throw Error("No mixed-audio sender");
          await sender.replaceTrack(dest.stream.getAudioTracks()[0]);
          window.evalAudioContext = ctx;
          source.start();
        }, wav);
        await host
          .locator("#agenda-warning")
          .waitFor({ state: "visible", timeout: 25000 });
        await host.waitForFunction(
          () =>
            document
              .getElementById("notice")
              .textContent.includes("continued off-topic"),
          {},
          { timeout: 35000 },
        );
        console.log(
          "Verified spoken derailment caused a visible warning and actual interview termination.",
        );
      } else await new Promise((r) => setTimeout(r, 10000));
      console.log("AI participant audio received through the SFU.");
    } finally {
      if (await host.locator("#end").isEnabled())
        await host.locator("#end").click();
      await new Promise((r) => setTimeout(r, 2500));
    }
    const s = await (await fetch("http://localhost:14323/api/state")).json();
    console.log(
      "Paid smoke accounting:",
      JSON.stringify(
        s.sessions.map((r) => ({
          status: r.status,
          cost: r.cost,
          seconds: r.seconds,
          finalUsageConfirmed: r.finalUsageConfirmed,
          outputFragments: r.transcript.filter((t) => t.speaker === "partner")
            .length,
        })),
      ),
    );
    assert.equal(s.sessions[0]?.status, "complete");
  }
  await pages[0].screenshot({
    path: "private/call-room-test.png",
    fullPage: true,
  });
  for (const [width, height] of [
    [1252, 800],
    [1280, 720],
    [1440, 900],
    [768, 700],
    [390, 844],
    [844, 390],
  ]) {
    await pages[0].setViewportSize({ width, height });
    await pages[0].evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await pages[0].evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "No horizontal overflow",
    );
    const layout = await pages[0].evaluate(() => {
      const rect = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return {
        scroll: document.documentElement.scrollHeight > innerHeight,
        controls: getComputedStyle(document.querySelector(".call-controls"))
          .position,
        tiles: rect("tiles"),
        leave: rect("leave"),
        panel: rect("results"),
        height: innerHeight,
      };
    });
    assert.equal(layout.scroll, false, "Call page never scrolls");
    assert.equal(layout.controls, "fixed");
    assert.ok(
      layout.leave.bottom <= height && layout.leave.top >= 0,
      "Leave is in viewport",
    );
    assert.ok(
      layout.tiles.top >= 0 && layout.tiles.bottom < layout.leave.top,
      "Gallery does not collide with controls",
    );
    if (width > 680)
      assert.ok(
        layout.panel.top === layout.tiles.top &&
          layout.panel.bottom < layout.leave.top,
        "Transcript sits beside gallery, above controls",
      );
    await pages[0].screenshot({
      path: `private/call-ui-${width}.png`,
      fullPage: false,
    });
  }
  // Long transcript fixture exercises real rendering without an OpenAI call.
  const fixture = Array.from({ length: 80 }, (_, i) => ({
    speaker: i % 2 ? "founders" : "partner",
    text:
      i % 2
        ? "We shipped the scheduling workflow and learned that gardeners need fewer steps to book a customer."
        : "What changed in the product after your last customer conversation?",
    start_ms: i * 7000,
    end_ms: i * 7000 + 4000,
  }));
  const ui = pages[0];
  await ui.route(`**/rooms/${room.id}/state`, async (route) => {
    const upstream = await route.fetch();
    const data = await upstream.json();
    data.sessions = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        status: "complete",
        transcript: fixture,
        profile: "speedrun-10",
      },
    ];
    await route.fulfill({ json: data });
  });
  await ui.setViewportSize({ width: 1252, height: 800 });
  await ui.locator(".transcript-turn").first().waitFor();
  await ui.waitForFunction(
    () => document.querySelectorAll(".transcript-turn").length === 80,
  );
  assert.equal(
    await ui.evaluate(
      () => document.documentElement.scrollHeight > innerHeight,
    ),
    false,
    "Long transcript cannot grow the page",
  );
  await ui.locator("#transcript").evaluate((el) => (el.scrollTop = 0));
  fixture.push({
    speaker: "partner",
    text: "Which assumption will you test next?",
    start_ms: 570000,
    end_ms: 574000,
  });
  await ui.waitForFunction(
    () => document.querySelectorAll(".transcript-turn").length === 81,
  );
  assert.equal(
    await ui.locator("#transcript").evaluate((el) => el.scrollTop),
    0,
    "Reading earlier transcript must not jump to latest",
  );
  await ui
    .locator("#transcript")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  fixture.push({
    speaker: "founders",
    text: "Whether customers can finish onboarding without help.",
    start_ms: 575000,
    end_ms: 579000,
  });
  await ui.waitForFunction(
    () => document.querySelectorAll(".transcript-turn").length === 82,
  );
  assert.ok(
    await ui
      .locator("#transcript")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2),
    "Live edge follows new text",
  );
  await ui.screenshot({
    path: "private/call-viewport-transcript.png",
    fullPage: false,
  });
  await ui.locator("#panel-close").click();
  assert.equal(
    await ui.evaluate(() => document.activeElement.id),
    "panel-toggle",
  );
  assert.equal(
    await ui.locator("#panel-toggle").getAttribute("aria-expanded"),
    "false",
  );
  await ui.locator("#panel-toggle").click();
  await ui.locator("#transcript-tab").focus();
  await ui.keyboard.press("ArrowRight");
  assert.equal(
    await ui.locator("#scorecard-tab").getAttribute("aria-selected"),
    "true",
  );
  await ui.keyboard.press("ArrowLeft");
  await ui.setViewportSize({ width: 390, height: 844 });
  await ui.locator("#panel-toggle").click();
  await ui.locator("#transcript").waitFor({ state: "visible" });
  assert.equal(
    await ui.evaluate(
      () => document.documentElement.scrollHeight > innerHeight,
    ),
    false,
  );
  await ui.screenshot({
    path: "private/call-viewport-mobile-transcript.png",
    fullPage: false,
  });
  await ui.locator("#panel-close").click();
  assert.equal(
    await ui.evaluate(() => document.activeElement.id),
    "panel-toggle",
  );
  await ui.locator("#tiles").waitFor({ state: "visible" });
  console.log(
    "Verified viewport containment, long transcript scroll retention, tabs, and mobile panel controls.",
  );
  await pages[0].bringToFront();
  await pages[0].locator("#copy-in-call").click();
  await pages[0].waitForFunction(() =>
    document
      .getElementById("notice-text")
      .textContent.startsWith("Invite copied"),
  );
  const copied = await pages[0].evaluate(() => navigator.clipboard.readText());
  assert.equal(
    new URLSearchParams(new URL(copied).hash.slice(1)).get("key"),
    room.guest,
    "Copy invite must never disclose host capability",
  );
  await pages[0].locator("#mic").click();
  assert.equal(
    await pages[0].locator("#mic").getAttribute("aria-label"),
    "Unmute mic",
  );
  await pages[1].locator("#leave").click();
  await pages[0].waitForFunction(
    () => document.querySelectorAll(".tile").length === 1,
  );
  console.log(
    paid
      ? "Verified mute control and participant leave; paid usage reported above."
      : "Verified mute control and participant leave. No paid API calls.",
  );
} finally {
  await browser?.close();
  gateway?.kill();
  operator?.kill();
}
