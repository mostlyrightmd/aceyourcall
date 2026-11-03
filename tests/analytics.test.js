import test from 'node:test';
import assert from 'node:assert/strict';
import { analytics, browserEvents } from '../src/analytics.js';
test('analytics only emits bounded approved properties, hashes identifiers and never creates people', async () => {
 const sent=[];const capture=analytics({token:'test',send:async (url,options)=>{sent.push(JSON.parse(options.body));return {ok:true};}});
 capture('interview_ended','room-secret',{application:'PRIVATE',name:'PRIVATE',url:'PRIVATE',status:'complete',duration_seconds:90000});
 await new Promise(r=>setImmediate(r));
 assert.equal(sent.length,1);assert.equal(sent[0].properties.duration_seconds,86400);
 assert.equal(sent[0].properties.$process_person_profile,false);
 assert.equal(sent[0].properties.$geoip_disable,true);
 assert(!JSON.stringify(sent).includes('PRIVATE'));assert(!JSON.stringify(sent).includes('room-secret'));
 assert(!browserEvents.has('interview_started'));
});
test('analytics is disabled without a token and bounds in-flight requests', async () => {
 let count=0;const send=()=>{count++;return new Promise(()=>{});};
 analytics({token:'',send})('test');assert.equal(count,0);
 const capture=analytics({token:'test',send});for(let i=0;i<100;i++)capture('test');assert.equal(count,8);
});
