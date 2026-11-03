import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const cwd = mkdtempSync(join(tmpdir(), "mp-links-browser-")),
  origin = "http://localhost:14347",
  master = "m".repeat(40);
for (const dir of ["src", "public"]) symlinkSync(resolve(dir), join(cwd, dir));
const child = spawn(process.execPath, [resolve("src/call-server.js")], {
  cwd,
  env: {
    ...process.env,
    CALL_PORT: "14347",
    MP_CALL_ORIGIN: origin,
    MP_CALL_ACCESS: master,
    LIVEKIT_API_KEY: "testkey",
    LIVEKIT_API_SECRET: "s".repeat(40),
    MP_PUBLIC_LAUNCH: "0",
    MP_COMMUNITY_PREVIEW: "0",
  },
  stdio: "pipe",
});
let browser;
try {
  await new Promise((r, j) => {
    child.stdout.once("data", r);
    child.once("exit", () => j(Error("server exited")));
    setTimeout(() => j(Error("startup timeout")), 5000).unref();
  });
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const host = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
      viewport: { width: 1440, height: 1000 },
    }),
    page = await host.newPage();
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.cspViolations.push(e.violatedDirective),
    );
  });
  let roomBody;
  page.on("request", (r) => {
    if (r.url() === origin + "/rooms" && r.method() === "POST")
      roomBody = r.postDataJSON();
  });
  await page.goto(origin + "/practice#create=" + master);
  await page.locator("#create").waitFor({ state: "visible" });
  await page.waitForURL(origin + "/new");
  await page.locator("#new").click();
  assert.match(
    await page.locator("#application-error").innerText(),
    /Paste or upload/,
  );
  await page.locator("#draft-program").click();
  await page.getByRole("option", { name: "YC", exact: true }).click();
  assert.match(await page.locator("#draft-program").innerText(), /YC/);
  await page.locator("#draft-program").click();
  await page.keyboard.press("Escape");
  await page.locator("#draft-file").setInputFiles({
    name: "application.md",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Uploaded synthetic company application for scheduling.",
    ),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#draft-application")
      .value.includes("Uploaded synthetic"),
  );

  await page
    .locator("#draft-application")
    .fill("Synthetic company application about interview scheduling.");
  await page.locator("#entry-join-tab").click();
  assert.equal(await page.locator("#create").isVisible(), false);
  await page.locator("#entry-join-tab").press("ArrowLeft");
  assert.equal(
    await page.locator("#draft-application").inputValue(),
    "Synthetic company application about interview scheduling.",
  );
  await page.locator("#entry-title").click();
  await page.screenshot({ path: "private/flow-application-desktop.png" });
  await page.locator("#new").click();
  await page.waitForURL(/\/r\/[a-z2-7-]+$/);
  assert.deepEqual(roomBody.permissions, {
    version: "2026-11-01",
    terms: true,
    improvement: false,
    sales: false,
  });
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
  const url = page.url(),
    code = url.split("/").at(-1);
  assert.equal(new URL(url).hash, "");
  assert.equal(await page.locator("#copy").count(), 0);
  await page.reload();
  await page.locator("#lobby").waitFor({ state: "visible" });
  assert.equal(await page.locator("#new-room-link").count(), 0);
  const guest = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    guestPage = await guest.newPage();
  await guestPage.goto(origin + "/new");
  await guestPage.locator("#creator-shortcut").waitFor({ state: "visible" });
  assert.equal(await guestPage.locator("#create").isVisible(), false);
  await guestPage.waitForTimeout(200);
  await guestPage.screenshot({ path: "private/entry-join-mobile.png" });
  await guestPage.setViewportSize({ width: 1440, height: 900 });
  await guestPage.reload();
  await guestPage.locator("#creator-shortcut").waitFor({ state: "visible" });
  await guestPage.waitForTimeout(200);
  await guestPage.screenshot({ path: "private/entry-join-desktop.png" });
  await guestPage.locator("#creator-shortcut").click();
  await guestPage.waitForTimeout(200);
  await guestPage.screenshot({ path: "private/entry-private-create.png" });
  await guestPage.locator("#creator-link").fill("bad link");
  await guestPage.locator("#creator-entry button").click();
  await guestPage.locator("#creator-error").waitFor({ state: "visible" });
  await guestPage.locator("#entry-join-tab").click();
  await guestPage.setViewportSize({ width: 390, height: 844 });
  await guestPage.locator("#room-code").fill("invalid");
  await guestPage.locator("#code-entry button").click();
  await guestPage.locator("#code-error").waitFor({ state: "visible" });
  await guestPage.waitForTimeout(200);
  await guestPage.screenshot({ path: "private/flow-code-error.png" });
  await guestPage
    .locator("#room-code")
    .fill(code.toUpperCase().replaceAll("-", " "));
  await guestPage.locator("#code-entry button").click();
  await guestPage.locator("#lobby").waitFor({ state: "visible" });
  assert.equal(guestPage.url(), url);
  assert.equal(await guestPage.locator("#new-room-link").isVisible(), false);
  await guestPage.reload();
  await guestPage.locator("#lobby").waitFor({ state: "visible" });
  await page.goto(origin + "/new");
  await page.locator("#create").waitFor({ state: "visible" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator("#create").waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  await page.screenshot({ path: "private/flow-application-mobile.png" });
  await guestPage.goto(origin + "/r/aaaa-aaaa-aaaa");
  await guestPage.locator("#code-error").waitFor({ state: "visible" });
  assert.match(await guestPage.locator("#code-error").textContent(), /expired/);
  assert.equal(
    await guestPage.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const unlock = await browser.newContext();
  const unlockPage = await unlock.newPage();
  await unlockPage.goto(origin + "/new");
  await unlockPage.locator("#creator-shortcut").click();
  await unlockPage.locator("#creator-link").fill(origin + "/#create=" + master);
  await unlockPage.locator("#creator-entry button").click();
  await unlockPage.locator("#create").waitFor({ state: "visible" });
  assert.equal(unlockPage.url(), origin + "/new");
  assert.equal(
    await unlockPage.evaluate(() =>
      JSON.stringify(localStorage).includes("m".repeat(40)),
    ),
    false,
  );
  await unlockPage.reload();
  await unlockPage.locator("#create").waitFor({ state: "visible" });
  await unlock.close();
  console.log(
    "Real gateway: creator cookie, clean URLs, copy invite, host reload, guest isolation, typed code, invalid/expired codes and homepage return passed.",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  rmSync(cwd, { recursive: true, force: true });
}
