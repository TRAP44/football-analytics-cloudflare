import test from 'node:test';
import assert from 'node:assert/strict';
import {issueMatchQuestionAccess,verifyMatchQuestionAccess} from '../src/match-question-access.js';
import {createAnalysisRuntime} from '../src/analysis-runtime.js';
const secret='isolated-unit-fixture-secret';
const now=Date.parse('2026-10-18T12:30:00Z');

test('question receipt binds user, fixture, purpose, signature, key and expiry',async()=>{
  const token=await issueMatchQuestionAccess(secret,5,77,now);
  assert.equal(await verifyMatchQuestionAccess(token,secret,5,77,now),true);
  for(const [value,key,user,fixture,at] of [
    [token,secret,6,77,now],[token,secret,5,78,now],
    [token,secret+'rotation',5,77,now],[token,secret,5,77,now+1800_000],
    [token,secret,5,77,now-60_000],
    [token.slice(0,-1)+(token.endsWith('0')?'1':'0'),secret,5,77,now],
    [token.replace('qa1.','payment.'),secret,5,77,now],
  ])assert.equal(await verifyMatchQuestionAccess(value,key,user,fixture,at),false);
  assert.equal(await issueMatchQuestionAccess('',5,77,now),null);
  assert.equal(await issueMatchQuestionAccess(secret,true,77,now),null);
  assert.equal(await verifyMatchQuestionAccess('bad',secret,5,77,now),false);
});

test('cached analysis issues a private receipt only on delivery and never mutates shared cache/history payload',async()=>{
  const cached={generatedAt:new Date().toISOString(),match:{fixtureId:77,status:'NS',date:new Date(Date.now()+3600000).toISOString()},probabilities:{home:54,draw:25,away:21}};
  const histories=[];
  const rt=createAnalysisRuntime({
    getCacheEntry:async()=>({payload:cached,expired:false}),
    analysisFreshness:()=>({needsRecheck:false}),recordHistory:async(_id,payload)=>histories.push(structuredClone(payload)),
    getQuota:async()=>({plan:'FREE',used:0,limit:3,left:3}),
    analysisResponsePayload:(payload,extra)=>({...payload,...extra}),
    json:(body,status=200)=>({body,status}),
  });
  const response=await rt.apiAnalyze({json:async()=>({fixtureId:77})},{botToken:secret},{id:5});
  assert.equal(response.status,200);
  assert.equal(await verifyMatchQuestionAccess(response.body.questionAccess,secret,5,77),true);
  assert.equal(await verifyMatchQuestionAccess(response.body.questionAccess,secret,6,77),false);
  assert.equal(Object.hasOwn(cached,'questionAccess'),false);
  assert.equal(histories.length,1);assert.equal(Object.hasOwn(histories[0],'questionAccess'),false);
});
