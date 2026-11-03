import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const stub = `
export const Track={Source:{Microphone:'microphone'}};
export const VideoPresets={h720:{resolution:{width:1,height:1}}};
export const RoomEvent=new Proxy({}, {get:(_,key)=>key});
export class Room {
 constructor(){this.handlers={};this.remoteParticipants=new Map();this.localParticipant={identity:'human',audioTrackPublications:new Map(),setMicrophoneEnabled:async()=>{},setCameraEnabled:async()=>{},publishTrack:async()=>{}};(window.rooms??=[]).push(this)}
 on(e,fn){(this.handlers[e]??=[]).push(fn);return this} emit(e){for(const fn of this.handlers[e]||[])fn()}
 async connect(){} async startAudio(){} async disconnect(){this.emit('Disconnected')}
}
`;
const built = await build({entryPoints:['frontend/engine.ts'],bundle:true,format:'iife',globalName:'EngineTest',write:false,plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/^(livekit-client|.*named-captions\.js|\.\/api|\.\/analytics)$/},a=>({path:a.path,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='livekit-client'?stub:a.path.endsWith('named-captions.js')?'export async function createNamedCaptions(){return {add(){},remove(){},stop:async()=>{}}}':a.path==='./analytics'?'export function track(){}':'export const request=(...args)=>window.api(...args);',loader:'js'}));
}}]});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined,headless:true});
try {
 const page=await browser.newPage();
 await page.goto('about:blank');
 await page.clock.install();
 await page.evaluate(()=>{
  window.calls=[]; window.sessions=[]; window.stateReads=0;
  window.api=async(path,body)=>{window.calls.push({path,body});
   if(path.endsWith('/state')) {window.stateReads++;return {sessions:window.sessions,profiles:[]}}
   if(path.endsWith('/queue'))return {status:'ready'};
   if(path.endsWith('/join'))return {url:'fake',token:'fake'};
   if(path.endsWith('/start')){window.sessions=[{id:'s1',status:'live',started:Date.now()}];return {id:'s1',sdp:'fake'}};
   return {};
  };
  window.RTCPeerConnection=class {connectionState='connected';iceGatheringState='complete';localDescription={sdp:'fake'};addTrack(){};createDataChannel(){return {readyState:'open',send(){}}} async createOffer(){return {}} async setLocalDescription(){} async setRemoteDescription(){} close(){this.connectionState='closed';this.onconnectionstatechange?.()}};
 });
 await page.addScriptTag({content:built.outputFiles[0].text});
 await page.evaluate(async()=>{window.engine=EngineTest.createEngine({id:'room',key:'capability',program:'speedrun-10'});await engine.refresh();await engine.join('Alex',false,false);await engine.start({application:'Synthetic test',facts:'{}'})});
 // Short reconnection must not end the interview.
 await page.evaluate(()=>rooms[1].emit('Reconnecting'));
 await page.clock.runFor(4000);
 await page.evaluate(()=>rooms[1].emit('Reconnected'));
 await page.clock.runFor(5000);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.path.endsWith('/end')).length),0);
 // Publisher disappears while provider remains connected: bounded automatic stop.
 await page.evaluate(()=>rooms[1].emit('Disconnected'));
 await page.clock.runFor(8100);
 await page.waitForFunction(()=>calls.some(c=>c.body?.reason==='ai_room_disconnected'));
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.path.endsWith('/end')).length),1);
 // Intentional disconnect must not schedule a second stop; result polling survives leave.
 await page.evaluate(async()=>{await engine.leave();window.readsBefore=stateReads;window.sessions=[{id:'s1',status:'unconfirmed',scoreStatus:'running'}]});
 await page.clock.runFor(9000);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.path.endsWith('/end')).length),1);
 assert.ok(await page.evaluate(()=>stateReads>readsBefore));
 await page.evaluate(()=>{window.sessions[0].scorecard={verdict:'maybe'}});
 await page.clock.runFor(3100);
 assert.equal(await page.evaluate(()=>engine.getSnapshot().data.sessions[0].scorecard.verdict),'maybe');
 await page.evaluate(()=>{engine.dispose();window.readsBefore=stateReads});
 await page.clock.runFor(9000);
 assert.equal(await page.evaluate(()=>stateReads),await page.evaluate(()=>readsBefore));
 console.log('Engine: transient recovery, publisher loss, explicit reason, cleanup idempotence, results after leave and polling disposal passed.');
} finally {await browser.close()}
