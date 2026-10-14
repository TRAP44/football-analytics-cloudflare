import test from 'node:test';
import assert from 'node:assert/strict';
import {prematchProviderBudget} from '../src/prematch-provider-budget.js';

const now=Date.parse('2026-10-14T12:00:00Z');
test('request cap stays at a quarter of lower plans and at most 1875 on higher plans',()=>{
  for (const [dailyLimit,limit] of [[100,25],[7500,1875],[75000,1875]]) {
    assert.deepEqual(prematchProviderBudget({dailyLimit,dailyRemaining:dailyLimit,updatedAt:new Date(now).toISOString()},now),{allowed:true,reason:'',limit});
  }
});
test('previous UTC day cannot supply a fresh daily reserve after reset',()=>{
  const midnight=Date.parse('2026-10-15T00:01:00Z');
  assert.equal(prematchProviderBudget({dailyLimit:7500,dailyRemaining:7400,updatedAt:'2026-10-14T23:59:00Z'},midnight).reason,'provider_quota_unconfirmed');
});
