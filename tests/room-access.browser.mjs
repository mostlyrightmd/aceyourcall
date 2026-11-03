import {chromium} from 'playwright';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['frontend/api.ts'],bundle:true,write:false,format:'iife',globalName:'RoomAPI'});
const server=createServer((req,res)=>res.end('<!doctype html><title>Access test</title>'));
await new Promise(r=>server.listen(14358,'127.0.0.1',r));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined,headless:true});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:14358');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const results=await page.evaluate(async()=>{
  let authorized=true;
  window.fetch=async url=>new Response(JSON.stringify(url==='/room-code'?{id:'room',guest:'guest',code:'abcd-efgh-ijkl'}:url.endsWith('/link')?{host:authorized}:{ok:true}),{headers:{'content-type':'application/json'}});
  const expired=()=>localStorage.setItem('mp-host:room',JSON.stringify({key:'legacy-host',expires:Date.now()-86400000,program:'yc-10'}));
  expired();const resumed=await RoomAPI.resolveRoom('abcd-efgh-ijkl');
  const renewed=JSON.parse(localStorage.getItem('mp-host:room')).expires>Date.now();
  authorized=false;expired();const rejected=await RoomAPI.resolveRoom('abcd-efgh-ijkl');
  return {resumed,renewed,rejected,removed:!localStorage.getItem('mp-host:room')};
 });
 assert.equal(results.resumed.key,'legacy-host');assert.equal(results.renewed,true);
 assert.equal(results.rejected.key,'guest');assert.equal(results.removed,true);
 console.log('Expired legacy host grants renew only after server verification; rejected grants are removed.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
