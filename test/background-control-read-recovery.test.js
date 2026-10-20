import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverControlRead,canStartLiveWindow} from '../scripts/cron-runner.js';
const failed=(reason='runtime_controls_read_timeout')=>({failed:true,tasks:[{task:'scheduled_execution',status:'skipped',reason}]});
const start=Date.parse('2026-10-20T09:30:10Z');
function clock(at=start){return {now:()=>at,wait:async ms=>{at+=ms;}};}

test('controls read retries are bounded to four later minutes in the same window',async()=>{
  const calls=[],initial=failed();
  const results=await recoverControlRead({initial,...clock(),endMs:start-10000+300000,run:async at=>{calls.push(at);return failed();}});
  assert.equal(results.length,4);
  assert.deepEqual(calls.map(at=>new Date(at).getUTCMinutes()),[31,32,33,34]);
  assert.equal(initial.failed,true);
});

test('ambiguous claim, post-work failure, manual pause, and unclassified empty runs never start recovery',async()=>{
  let calls=0;
  const initialStates=[failed('lease_unavailable'),failed('execution_lease_completion_failed'),failed('runtime_controls_invalid'),{failed:false,tasks:[]},{failed:true,tasks:[]},{failed:false,tasks:failed().tasks},{failed:true,tasks:[...failed().tasks,{task:'reminders',status:'ok'}]}];
  for(const initial of initialStates){
    assert.deepEqual(await recoverControlRead({initial,...clock(),endMs:start+300000,run:async()=>{calls++;return failed();}}),[]);
  }
  assert.equal(calls,0);
});

test('a recovery claim failure stops immediately and is never replayed',async()=>{
  let calls=0;
  const result=await recoverControlRead({initial:failed(),...clock(),endMs:start+300000,run:async()=>{calls++;return failed('lease_unavailable');}});
  assert.equal(result.length,1);assert.equal(calls,1);
});

test('no recovery starts outside the slot or with less than thirty seconds remaining',async()=>{
  let calls=0;
  const result=await recoverControlRead({initial:failed(),...clock(start+250000),endMs:start-10000+300000,run:async()=>{calls++;}});
  assert.deepEqual(result,[]);assert.equal(calls,0);
});

test('an early timer wake uses the intended next minute and stops on first successful run',async()=>{
  let at=start;
  const calls=[];
  const result=await recoverControlRead({initial:failed(),now:()=>at,wait:async ms=>{at+=ms-1;},endMs:start+300000,
    run:async time=>{calls.push(time);return {failed:false,tasks:[{task:'smart_notifications',status:'ok'}]};}});
  assert.equal(result.length,1);assert.equal(calls[0],Date.parse('2026-10-20T09:31:00Z'));
});

test('LIVE after an unrelated task failure requires positive durable completion',()=>{
  const smart={task:'smart_notifications',status:'ok'},timeline={task:'in_play_timeline',status:'failed'};
  const closed={task:'scheduled_execution',status:'ok',reason:'lease_completed'};
  assert.equal(canStartLiveWindow({failed:false,tasks:[smart]}),true);
  assert.equal(canStartLiveWindow({failed:false,tasks:[{...smart,status:'degraded',reason:'bounded_notification_page'}]}),true);
  assert.equal(canStartLiveWindow({failed:false,tasks:[{...smart,status:'skipped',reason:'interval'}]}),true);
  assert.equal(canStartLiveWindow({failed:true,tasks:[smart,timeline]}),false);
  assert.equal(canStartLiveWindow({failed:true,tasks:[smart,timeline,closed]}),true);
  for(const reason of ['lease_unavailable','execution_lease_heartbeat_lost','execution_lease_completion_failed']){
    assert.equal(canStartLiveWindow({failed:true,tasks:[smart,timeline,closed,{task:'scheduled_execution',status:'degraded',reason}]}),false);
  }
  assert.equal(canStartLiveWindow({failed:true,tasks:[timeline,closed]}),false);
  assert.equal(canStartLiveWindow({failed:true,tasks:[{...smart,status:'failed'},closed]}),false);
});
