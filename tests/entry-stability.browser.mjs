import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
try {
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    await page.goto('http://localhost:4318/new');
    const tabs = page.locator('#entry-modes');
    const y = (await tabs.boundingBox()).y;
    await page.getByRole('tab',{name:'Join room',exact:true}).click();
    assert(Math.abs((await tabs.boundingBox()).y-y)<1,'Join moved tabs');
    await page.getByRole('tab',{name:'Create room',exact:true}).click();
    await page.locator('#application-form summary').click();
    assert(Math.abs((await tabs.boundingBox()).y-y)<1,'Expanded details moved tabs');
    await page.locator('#application-form summary').click();
    const handle=page.getByRole('separator',{name:'Resize application field'});
    const box=await handle.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+100);await page.mouse.up();
    assert(Math.abs((await tabs.boundingBox()).y-y)<1,'Resize moved tabs');
    await page.locator('#draft-application').click();
    assert.equal(await page.locator('#draft-application').evaluate(e=>getComputedStyle(e).outlineStyle),'none');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('html').getAttribute('data-input-mode'),'keyboard');
    console.log('Entry position and focus pass',viewport);
    await page.close();
  }
} finally { await browser.close(); }
