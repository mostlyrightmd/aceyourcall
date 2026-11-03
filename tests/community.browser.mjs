import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:14333/");
  await page.locator("#create").waitFor({ state: "visible" });
  await page
    .locator("#draft-file")
    .setInputFiles({
      name: "application.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "Synthetic application: we build scheduling software for gardeners.",
      ),
    });
  await page.locator(".interviewer-fields summary").click();
  await page.locator("#draft-person").fill("Example Partner");
  await page
    .locator("#draft-linkedin")
    .fill("https://www.linkedin.com/in/example");
  await page.reload();
  assert.match(
    await page.locator("#draft-application").inputValue(),
    /gardeners/,
  );
  assert.equal(
    await page.locator("#draft-person").inputValue(),
    "Example Partner",
  );
  await page.screenshot({
    path: "private/community-onboarding-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "private/community-onboarding-mobile.png",
    fullPage: true,
  });
  await page.locator("#forget-draft").click();
  await page.reload();
  assert.equal(await page.locator("#draft-application").inputValue(), "");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.body.classList.remove("onboarding");
    document.body.classList.add("in-call");
    document.getElementById("welcome").hidden = true;
    document.getElementById("call").hidden = false;
  });
  const handle = page.locator("#panel-resize");
  await handle.focus();
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowLeft");
  assert.equal(Number(await handle.getAttribute("aria-valuenow")), before + 32);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 4, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + 100);
  await page.mouse.up();
  assert.ok(Number(await handle.getAttribute("aria-valuenow")) > before + 32);
  assert.deepEqual(errors, []);
  console.log(
    "Community draft upload/persistence/clear, responsive layout, keyboard and pointer resize passed.",
  );
} finally {
  await browser.close();
}
