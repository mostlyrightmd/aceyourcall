import test from 'node:test';
import assert from 'node:assert/strict';
import { canScore, endReason } from '../src/session-lifecycle.js';
test('feedback is independent of billing only after remote closure is proven', () => {
  for (const status of ['live', 'connecting', 'closing']) assert.equal(canScore({status, remoteClosed:true}), false);
  assert.equal(canScore({status:'unconfirmed',remoteClosed:false}),false);
  assert.equal(canScore({status:'unconfirmed',remoteClosed:true,recoveryRequired:true}),false);
  assert.equal(canScore({status:'unconfirmed',remoteClosed:true,recoveryRequired:false}),true);
  assert.equal(canScore({status:'complete'}),true);
});
test('automatic shutdown reasons are bounded and distinct from manual stops', () => {
  assert.equal(endReason('heartbeat_failed'),'heartbeat_failed');
  assert.equal(endReason('ai_room_disconnected'),'ai_room_disconnected');
  assert.equal(endReason('arbitrary private text'),'manual');
  assert.equal(endReason(undefined),'manual');
});
