import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server = spawn(process.execPath, ["scripts/ui-review.mjs"], {
  env: { ...process.env, UI_REVIEW_PORT: "4319" },
  stdio: "pipe",
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Review startup timeout")),
      20000,
    );
    server.stdout.on("data", (d) => {
      if (String(d).includes("UI review:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => reject(Error("Server exited " + code)));
  });
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4319/");
  await page.locator("textarea").first().waitFor();
  const initialBorder = await page
    .locator("#draft-dropzone")
    .evaluate((e) => getComputedStyle(e).borderColor);
  await page.evaluate(() => {
    const d = new DataTransfer();
    d.items.add(new File(["test"], "application.txt"));
    window.dispatchEvent(
      new DragEvent("dragenter", { dataTransfer: d, bubbles: true }),
    );
  });
  assert.equal(await page.locator(".upload-dropzone.is-dragging").count(), 1);
  await page.waitForFunction(
    (original) =>
      getComputedStyle(document.querySelector("#draft-dropzone"))
        .borderColor !== original,
    initialBorder,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await page.locator(".upload-dropzone.is-dragging").count(), 0);
  await page.goto("http://localhost:4319/r/research");
  await page.locator(".interviewer-standby progress").waitFor();
  assert.equal(await page.locator(".tile").count(), 3);
  const [gallery, last] = await Promise.all([
    page.locator("#tiles").boundingBox(),
    page.locator(".tile").last().boundingBox(),
  ]);
  assert.ok(
    Math.abs(last.x + last.width / 2 - gallery.x - gallery.width / 2) < 2,
  );
  const handle = await page.locator("#panel-resize").boundingBox();
  assert.equal(handle.width, 12);
  assert.ok(handle.height > 300);
  assert.equal(
    await page
      .locator("#panel-resize")
      .evaluate((e) => getComputedStyle(e, "::after").opacity),
    "0",
  );
  await page.mouse.move(handle.x + 6, handle.y + 20);
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#panel-resize"), "::after")
        .opacity === "1",
  );

  await page.goto("http://localhost:4319/r/scorecard");
  await page.locator("#scorecard-panel:not([hidden])").waitFor();
  await page.goto("http://localhost:4319/r/context");
  await page.getByRole("dialog").waitFor();
  await page.goto("http://localhost:4319/r/call-three");
  await page.locator(".tile").first().waitFor();
  assert.equal(await page.locator(".interviewer-standby").count(), 0);
  for (const [route, selector] of [
    ["/", "#draft-program"],

    ["/r/context", "#context-voice"],
  ]) {
    await page.goto("http://localhost:4319" + route);
    await page.locator(selector).click();
    const checked = page.locator('[role="option"][data-state="checked"]');
    const others = page.locator('[role="option"]:not([data-state="checked"])');
    for (const other of await others.all()) {
      await other.hover();
      assert.equal(
        await checked.locator(".select-check .icon").isVisible(),
        true,
        route,
      );
      assert.equal(await other.locator(".select-check").count(), 0);
    }
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await checked.locator(".select-check .icon").isVisible(),
      true,
      route + " keyboard",
    );
    await page.keyboard.press("Escape");
  }

  await page.goto("http://localhost:4319/r/prejoin");
  await page.locator("#preview-mic:not([disabled])").waitFor();
  for (const [id, label] of [
    ["#preview-mic", "Microphone"],
    ["#preview-camera", "Camera"],
  ]) {
    await page.locator(id).hover();
    assert.equal(
      await page
        .locator(id)
        .evaluate((e) => getComputedStyle(e, "::after").content),
      '"' + label + '"',
    );
    await page.waitForFunction(
      (selector) =>
        getComputedStyle(document.querySelector(selector), "::after")
          .visibility === "visible",
      id,
    );
  }
  const logoWidth = (await page.locator(".powered-by svg").boundingBox()).width;
  await page.goto("http://localhost:4319/r/ready");
  await page.locator("#room-settings").waitFor();
  assert.equal(await page.locator(".research-status").count(), 0);
  assert.equal(await page.locator("#profile").count(), 0);
  assert.equal(
    (await page.locator(".powered-by svg").boundingBox()).width,
    logoWidth,
  );
  await page.locator("#room-settings").click();
  await page.locator("#profile-menu").hover();
  const selected = page.getByRole("menuitemradio", {
    name: "Speedrun",
    exact: true,
  });
  await selected.waitFor();
  await page.getByRole("menuitemradio", { name: "YC", exact: true }).hover();
  assert.equal(await selected.locator(".select-check").isVisible(), true);
  await page.getByRole("menuitemradio", { name: "YC", exact: true }).click();
  await page.locator("#room-settings").click();
  await page.locator("#profile-menu").hover();
  assert.equal(
    await page
      .getByRole("menuitemradio", { name: "YC", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#room-settings").click();
  await page.locator("#theme-choice").click();
  for (const menu of await page.getByRole("menu").all()) {
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390);
  }
  assert.deepEqual(errors, []);
  console.log(
    "UI review: viewport drag, selection, tile centering, standby, resizer, scorecard/context passed.",
  );
} finally {
  await browser?.close();
  server.kill();
}
