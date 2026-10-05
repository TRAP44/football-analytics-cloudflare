import test from 'node:test';
import assert from 'node:assert/strict';
import { __testApiAnalyze as apiAnalyze, __testWorkerMemory as memory } from '../src/worker.js';

const cfg={
  devMode:false,
  supabaseUrl:'',
  supabaseKey:'',
  cacheMinutes:20,
  limits:{FREE:3,PRO:20,PREMIUM:100},
  starsPrices:{},
  passPrices:{},
  passDurations:{},
  passUsageLimits:{},
};

function analyzeRequest(body) {
  return new Request('https://example.test/api/analyze',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body),
  });
}

test('apiAnalyze rejects an invalid fixture through the real runtime boundary', async () => {
  const response=await apiAnalyze(analyzeRequest({fixtureId:0}),cfg,{id:91001});
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:'Некорректный номер матча.'});
});

test('apiAnalyze serves a fresh cached analysis with stable probability/confidence output and no provider call', async () => {
  const userId=91002;
  const fixtureId=551234;
  const cacheKey=`fixture:${fixtureId}:v15-availability-quality-rc144`;
  const generatedAt=new Date().toISOString();
  const kickoffAt=new Date(Date.now()+8*60*60_000).toISOString();
  const cached={
    generatedAt,
    match:{
      fixtureId,
      date:kickoffAt,
      status:'NS',
      home:{id:10,name:'Home FC'},
      away:{id:20,name:'Away FC'},
    },
    probability:{home:52,draw:27,away:21},
    aiInstructor:{
      confidenceScore:74,
      confidenceLabel:'Высокая',
      betSignal:{code:'home',label:'П1'},
      verdict:{outcome:'П1',total:'ТБ 2.5',btts:'Да'},
    },
    lineups:{home:{startXI:[]},away:{startXI:[]}},
    market:{odds:{home:1.9,draw:3.4,away:4.2}},
  };

  memory.users.set(userId,{telegram_id:userId,plan:'FREE'});
  memory.usage.delete(`${userId}:${new Date().toISOString().slice(0,10)}`);
  memory.cache.set(cacheKey,{payload:cached,expiresAt:Date.now()+10*60_000});
  memory.history.delete(userId);

  const previousFetch=globalThis.fetch;
  let providerCalls=0;
  globalThis.fetch=async()=>{ providerCalls+=1; throw new Error('network must not be used for a fresh cached analysis'); };

  try {
    const response=await apiAnalyze(analyzeRequest({fixtureId}),cfg,{id:userId});
    assert.equal(response.status,200);
    const body=await response.json();

    assert.equal(body.cached,true);
    assert.equal(body.stale,false);
    assert.deepEqual(body.probability,{home:52,draw:27,away:21});
    assert.equal(body.aiInstructor.confidenceScore,74);
    assert.equal(body.aiInstructor.confidenceLabel,'Высокая');
    assert.equal(body.freshness.state,'fresh');
    assert.equal(body.quota.plan,'FREE');
    assert.equal(body.quota.left,3);
    assert.equal(providerCalls,0);
    assert.equal((memory.history.get(userId)||[]).length,1);
  } finally {
    globalThis.fetch=previousFetch;
    memory.cache.delete(cacheKey);
    memory.history.delete(userId);
    memory.users.delete(userId);
  }
});
