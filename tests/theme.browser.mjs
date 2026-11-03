import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server = spawn(process.execPath, ["scripts/ui-review.mjs"], {
  env: { ...process.env, UI_REVIEW_PORT: "4321" },
  stdio: "pipe",
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error("Server timeout")), 20000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("UI review:")) {
        clearTimeout(t);
        resolve();
      }
    });
    server.on("exit", (c) => {
      clearTimeout(t);
      reject(Error("Server exit " + c));
    });
  });
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
  const context = await browser.newContext({
    colorScheme: "light",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://localhost:4321";
  const theme = () => page.locator("html").getAttribute("data-theme");
  await page.goto(base);
  await page.locator("#draft-application").waitFor();
  assert.equal(await theme(), "light");
  assert.equal(
    await page.locator('meta[name="theme-color"]').getAttribute("content"),
    "#f7f7f5",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  assert.equal(await theme(), "light");
  await page.reload();
  await page.locator("#draft-application").waitFor();
  assert.equal(await theme(), "light");
  const other = await context.newPage();
  await other.goto(base + "/privacy");
  await other.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await other.close();
  const textarea = page.locator("#draft-application"),
    handle = page.locator(".field-resize-handle");
  const before = await textarea.boundingBox(),
    grip = await handle.boundingBox();
  await page.mouse.move(grip.x + 12, grip.y + 12);
  await page.mouse.down();
  await page.mouse.move(grip.x + 12, grip.y + 100, { steps: 8 });
  await page.mouse.up();
  assert.ok((await textarea.boundingBox()).height > before.height + 60);
  await handle.focus();
  await page.keyboard.press("Home");
  assert.equal(Math.round((await textarea.boundingBox()).height), 64);
  for (const mode of ["light", "dark"]) {
    await page.evaluate((m) => window.mpTheme.set(m), mode);
    for (const route of [
      "/",
      "/r/prejoin",
      "/r/call-four",
      "/r/scorecard",
      "/terms",
      "/privacy",
    ]) {
      await page.goto(base + route);
      await page
        .locator(
          route.startsWith("/r/")
            ? "#lobby, #call"
            : route === "/"
              ? "#draft-application"
              : ".legal-content",
        )
        .first()
        .waitFor();
      if (route === "/r/scorecard")
        await page.locator("#scorecard-panel:not([hidden])").waitFor();
      assert.equal(await theme(), mode);
      await page.screenshot({
        path: `private/theme-${mode}-${route.split("/").at(-1) || "home"}.png`,
      });
    }
  }
  await page.goto(base + "/r/call-four");
  await page.locator("#room-settings").click();
  await page.locator("#theme-choice").click();
  await page
    .getByRole("menuitemradio", { name: "System", exact: true })
    .click();
  assert.equal(await theme(), "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.equal(await page.locator(".page-theme-toggle").isVisible(), false);
  await page.locator("#room-settings").click();
  assert.equal(await page.locator("#background-open").isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const mode of ["light", "dark"]) {
    await page.evaluate((m) => window.mpTheme.set(m), mode);
    for (const route of ["/", "/r/prejoin", "/r/scorecard", "/privacy"]) {
      await page.goto(base + route);
      await page
        .locator(
          route.startsWith("/r/")
            ? "#lobby, #call"
            : route === "/"
              ? "#draft-application"
              : ".legal-content",
        )
        .first()
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        route,
      );
      await page.screenshot({
        path: `private/theme-mobile-${mode}-${route.split("/").at(-1) || "home"}.png`,
      });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base);
  await page.locator(".theme-toggle").waitFor();
  assert.equal(
    await page
      .locator(".theme-sun")
      .evaluate((e) => getComputedStyle(e).transitionDuration),
    "0s",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Theme: system, persistence, cross-tab, legal/room, resizing, responsive layouts and reduced motion passed.",
  );
} finally {
  await browser?.close();
  server.kill();
}
