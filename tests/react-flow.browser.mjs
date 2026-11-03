import { build } from "vite";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
await build({
  resolve: {
    alias: { "livekit-client": resolve("tests/fixtures/livekit-client.ts") },
  },
  build: { outDir: "../private/react-fixture" },
});
const card = {
  verdict: "promising",
  reason: "Clear problem; strengthen evidence.",
  scores: [
    { criterion: "intro_clarity", score: 7, quote: "I build the product." },
  ],
  weakest_answers: [
    {
      timestamp_seconds: 10,
      quote: "We have some users.",
      why_weak: "No count.",
      better_answer: "We have [FILL] active users.",
    },
  ],
  fact_mismatches: [],
  limitations: ["Synthetic test."],
};
const session = {
  id: "session",
  status: "complete",
  profile: "speedrun-10",
  transcript: [
    {
      speaker: "founders",
      speakerId: "alex",
      speakerName: "Alex",
      segmentId: "a",
      text: "I build the product.",
      start_ms: 1000,
      end_ms: 2000,
    },
    {
      speaker: "founders",
      speakerId: "bea",
      speakerName: "Bea",
      segmentId: "b",
      text: "I work with customers.",
      start_ms: 2000,
      end_ms: 3000,
    },
  ],
  scoreStatus: "failed",
  scoreError: "Please retry.",
};
const state = {
  research: { status: "searching" },
  host: true,
  profiles: [
    {
      id: "speedrun-10",
      title: "Speedrun",
      interviewer: { name: "Jordan Lee", photo: "" },
    },
  ],
  application: "Synthetic company application for interview scheduling.",
  facts: "{}",
  interviewer: { name: "Jordan Lee" },
  enabled: true,
  busy: false,
  sessions: [session],
};
let scoreFail = true,
  scoreCalls = 0,
  saveFail = false,
  saves = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  res.setHeader("Content-Type", "application/json");
  if (path === "/config")
    return res.end(
      JSON.stringify({ canCreate: true, turnstileSitekey: "test-widget" }),
    );
  if (path === "/rooms/fixture/link")
    return res.end(JSON.stringify({ code: "abcd-efgh-jkmp", host: true }));
  if (path === "/creator-access") return res.end("{}");
  if (path === "/rooms/fixture/join")
    return res.end(
      JSON.stringify({ url: "wss://test.invalid", token: "fixture" }),
    );
  if (path === "/rooms/fixture/state") return res.end(JSON.stringify(state));
  if (path === "/rooms/fixture/grounding") {
    saves++;
    let raw = "";
    for await (const c of req) raw += c;
    await new Promise((r) => setTimeout(r, 150));
    if (saveFail) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "Invalid context." }));
    }
    Object.assign(state, JSON.parse(raw));
    return res.end("{}");
  }
  if (path.endsWith("/scorecard")) {
    scoreCalls++;
    await new Promise((r) => setTimeout(r, 250));
    if (scoreFail) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: "Scoring failed." }));
    }
    session.scorecard = card;
    return res.end(JSON.stringify(card));
  }
  if (
    path.endsWith("/queue") ||
    path.endsWith("/end") ||
    path.endsWith("/withdraw-permissions")
  )
    return res.end("{}");
  let file;
  if (path === "/" || path === "/new" || path.startsWith("/r/"))
    file = "private/react-fixture/index.html";
  else if (/^\/app\/assets\/[\w-]+\.(js|css)$/.test(path))
    file = "private/react-fixture/" + path.slice(5);
  else if (
    [
      "/call.css",
      "/entry.css",
      "/theme.js",
      "/theme.css",
      "/theme-dark.png",
      "/theme-light.png",
      "/entry-coast.webp",
      "/seeam-noor.png",
    ].includes(path)
  )
    file = "public" + path;
  if (!file) {
    res.statusCode = 404;
    return res.end("{}");
  }
  res.setHeader(
    "Content-Type",
    file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".webp")
          ? "image/webp"
          : file.endsWith(".png")
            ? "image/png"
            : "text/html",
  );
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(14359, "127.0.0.1", r));
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-write", "clipboard-read"],
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://challenges.cloudflare.com/**", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile={render:(el)=>{el.textContent='Verification ready';return 'test'},getResponse:()=> 'test-token',reset:()=>{},remove:()=>{}};`,
    }),
  );
  await page.goto("http://localhost:14359/");
  await page.locator("#challenge").getByText("Verification ready").waitFor();
  await page.locator("#entry-join-tab").click();
  await page.locator("#entry-create-tab").click();
  await page.locator("#challenge").getByText("Verification ready").waitFor();
  assert.equal(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((r) => r.name.includes("/Room-")),
    ),
    false,
  );
  await page.goto("http://localhost:14359/#room=fixture&key=fixture");
  await page.locator("#lobby").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#preview-video")?.readyState >= 2,
  );
  await page.screenshot({ path: "private/react-prejoin.png" });
  await page.locator("#join").click();
  await page.locator("#join-error").waitFor();
  await page.locator("#name").fill("Alex");
  await page.locator("#preview-mic").click();
  assert.equal(
    await page.locator("#preview-mic").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#join").click();
  await page.locator("#call").waitFor();
  await page.locator("#room-settings").waitFor();
  assert.equal(await page.locator(".tile").count(), 4);
  await page.getByRole("progressbar", {name:"Interviewer research in progress"}).waitFor();
  assert.equal(await page.locator("#start").isDisabled(), true);
  await page.screenshot({ path: "private/react-research.png" });
  state.research = {
    status: "ready",
    result: {
      matched: true,
      name: "Jordan Lee",
      summary: "Synthetic public professional background.",
      topics: ["Founder experience"],
      sources: [
        { title: "Public profile", url: "https://example.com/profile" },
      ],
    },
  };
  await page.getByRole("progressbar", {name:"Interviewer research in progress"}).waitFor({ state: "hidden" });
  assert.equal(await page.locator("#start").isDisabled(), false);

  assert.match(await page.locator("#transcript").innerText(), /Alex/);
  assert.match(await page.locator("#transcript").innerText(), /Bea/);
  await page.screenshot({ path: "private/react-call.png" });
  await page.locator("#room-settings").click();
  await page.locator("#background-open").click();
  assert.equal(await page.locator("#facts").count(), 0);
  await page.screenshot({ path: "private/react-context.png" });
  await page.locator("#application").fill("Unsaved edit");
  await page.locator("#background-cancel").click();
  await page.locator("#room-settings").click();
  await page.locator("#background-open").click();
  assert.equal(
    await page.locator("#application").inputValue(),
    state.application,
  );
  saveFail = true;
  await page.locator("#save").click();
  await page.locator("#context-error").waitFor();
  saveFail = false;
  await page
    .locator("#application")
    .fill("Updated synthetic application for customer interviews.");
  await page.locator("#save").dblclick();
  await page.locator("#background-dialog").waitFor({ state: "hidden" });
  assert.equal(saves, 2);
  await page.locator("#scorecard-tab").click();
  await page.locator("#score").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#score-status")
      ?.textContent.includes("Scoring failed"),
  );
  scoreFail = false;
  await page.locator("#score").click();
  await page.locator(".score-verdict").waitFor();
  assert.equal(scoreCalls, 2);
  await page.getByRole("tab", {name:"Suggestions", exact:true}).click();
  assert.match(await page.locator("#scorecard").innerText(), /We have/);
  await page.screenshot({ path: "private/react-scorecard.png" });
  await page.locator("#transcript-tab").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () =>
      document
        .querySelector("#scorecard-tab")
        ?.getAttribute("aria-selected") === "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector("#scorecard-toggle")?.getAttribute("aria-pressed") === "false");
  await page.locator("#scorecard-toggle").click();
  await page.locator("#panel-close").waitFor({state:"visible"});
  await page.screenshot({ path: "private/react-room-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator("#panel-close").click();
  await page.locator("#leave").click();
  await page.locator("#lobby").waitFor();
  await page.getByRole("button", {name:"View interview results"}).click();
  await page.getByRole("heading", {name:"Interview results"}).waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Clear problem/);
  await page.screenshot({path:"private/results-after-leave.png"});
  await page.getByRole("button", {name:"Close results", exact:true}).click();
  assert.deepEqual(errors, []);
  console.log(
    "React: prejoin media, 4 participants, named transcript, context cancel/save/failure, score retry, keyboard tabs, mobile and leave passed.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
