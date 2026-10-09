import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProviderBudgetWindows } from '../scripts/supabase-concurrency-gate.js';
const first='2026-10-09T19:04:00Z',second='2026-10-09T19:05:00Z';
const admitted=(window,count)=>({allowed:true,count,windowStartedAt:window});
const denied=window=>({allowed:false,count:4,windowStartedAt:window});
test('provider concurrency assertion accepts an exactly filled single window',()=>{
  assertProviderBudgetWindows([1,2,3,4].map(count=>admitted(first,count)).concat(denied(first)),4);
});
test('provider concurrency assertion accepts a legitimate minute-boundary reset',()=>{
  assertProviderBudgetWindows([admitted(first,1),admitted(first,2),...[1,2,3,4].map(count=>admitted(second,count)),denied(second)],4);
});
test('provider concurrency assertion rejects over-admission and duplicate atomic counts',()=>{
  assert.throws(()=>assertProviderBudgetWindows([1,2,3,4,5].map(count=>admitted(first,count)).concat(denied(first)),4));
  assert.throws(()=>assertProviderBudgetWindows([1,2,3,4,4].map(count=>admitted(first,count)).concat(denied(first)),4));
});
test('provider concurrency assertion rejects missing window evidence and unexercised quotas',()=>{
  assert.throws(()=>assertProviderBudgetWindows([{allowed:true,count:1},denied(first)],4));
  assert.throws(()=>assertProviderBudgetWindows([1,2,3,4].map(count=>admitted(first,count)),4));
  assert.throws(()=>assertProviderBudgetWindows([admitted(first,1),denied(first)],4));
});
