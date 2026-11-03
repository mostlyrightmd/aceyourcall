import test from 'node:test';
import assert from 'node:assert/strict';
import {completedInterviews, publicStats} from '../src/public-stats.js';
test('only counts completed interviews with at least a minute of runtime',()=>{
 const good={status:'complete',started:1000,ended:61000};
 assert.equal(completedInterviews([good,{...good,kind:'research'},{...good,status:'live'},{...good,ended:5000},{status:'complete'}]),1);
});
test('aggregate is cached and coalesced; missing workers never yield misleading totals',async()=>{
 let calls=0,time=0,fail=false;
 const pool={workers:[{id:'a'},{id:'b'}],call:async()=>{calls++;if(fail)throw Error('offline');return {completedInterviews:3};}};
 const stats=publicStats(pool,()=>time);
 const results=await Promise.all([stats(),stats()]); assert.equal(results[0].completedInterviews,6);assert.equal(calls,2);
 await stats();assert.equal(calls,2);time=61000;fail=true;await assert.rejects(stats());
});
