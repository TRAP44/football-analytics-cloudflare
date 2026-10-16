import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectLiveUsage,summarizeTimings,summarizeScoreboards,usageMarkdown} from '../scripts/live-usage-report.js';
import {auditWorkflow} from '../scripts/privileged-access-audit.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_not_for_logs'};
const now=new Date('2026-10-16T18:00:00Z');
const response=rows=>({status:200,json:async()=>rows});

test('live usage reads only bounded narrow GET projections and emits sanitized aggregates',async()=>{
  const calls=[];
  const report=await collectLiveUsage({env,now,fetchImpl:async(url,init)=>{
    calls.push({url,init});
    assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.apikey,env.SUPABASE_SECRET_KEY);
    assert.equal(url.pathname,'/rest/v1/ops_events');assert.equal(url.searchParams.get('limit'),'250');
    assert.equal(url.searchParams.get('and'),'(created_at.gte.2026-10-16T12:00:00.000Z,created_at.lte.2026-10-16T18:00:00.000Z)');
    const select=url.searchParams.get('select');assert.doesNotMatch(select,/\*|telegram_id|message|metadata(?:,|$)/);
    if(select.startsWith('duration_ms'))return response(Array.from({length:20},(_,i)=>({duration_ms:String((i+1)*100),reason:'ai',message:'private headline',telegram_id:123})));
    if(select.includes('telegramCalls'))return response([{code:'FAVORITE_SCOREBOARD_PARTIAL',sent:'1',edited:'2',closed:'0',failed:'1',unknown:'0',deferred:'3',staleSkipped:'0',oldestWaitSec:'90',telegramCalls:'4',stopped:'rate_limited',telegram_id:123}]);
    return response([{code:'UPSTREAM_TIMEOUT'},{code:'UPSTREAM_TIMEOUT'},{code:'DAILY_DIGEST_SLO_MISSING_RUN'},{code:'private lower-case text'}]);
  }});
  assert.equal(calls.length,3);assert.equal(report.complete,true);
  assert.equal(report.timings.operations.ai.p50Ms,1000);assert.equal(report.timings.operations.ai.p95Ms,1900);
  assert.equal(report.timings.operations.ai.samples,20);assert.equal(report.timings.operations.live.p95Ms,null);
  assert.equal(report.scoreboards.totals.edited,2);assert.equal(report.scoreboards.maxOldestWaitSec,90);
  assert.equal(report.scoreboards.partialRuns,1);assert.equal(report.errors.byCode.UPSTREAM_TIMEOUT,2);
  assert.equal(report.errors.byCode.DAILY_DIGEST_SLO_MISSING_RUN,undefined);
  assert.doesNotMatch(JSON.stringify(report)+usageMarkdown(report),/sb_secret_not_for_logs|private headline|telegram_id|private lower-case text/);
  assert.equal(report.productionCapacityConfirmed,false);
});

test('missing and malformed counters remain unknown rather than inventing fast latency or healthy delivery',()=>{
  const r=summarizeTimings([{duration_ms:null,reason:'ai'},{duration_ms:true,reason:'ai'},{duration_ms:'',reason:'live'},{duration_ms:Infinity,reason:'match'},{duration_ms:999999,reason:'search'},{duration_ms:1,reason:'unknown'}]);
  assert.equal(r.invalid,6);assert.equal(r.operations.ai.samples,0);assert.equal(r.operations.ai.p95Ms,null);
  assert.equal(r.operations.ai.evidence,'insufficient_samples');
  assert.equal(summarizeScoreboards([]).evidence,'no_activity_evidence');
  const board=summarizeScoreboards([{sent:9007199254740991,stopped:'private user text'}]);
  assert.equal(board.totals.sent,0);assert.equal(board.invalidCounters,10);assert.equal(board.maxOldestWaitSec,null);
  assert.deepEqual(board.stops,{other:1});
});

test('large observation sets stop at four pages per category and explicitly report truncation',async()=>{
  let count=0;
  const report=await collectLiveUsage({env,now,fetchImpl:async(url)=>{
    count++;
    const offset=Number(url.searchParams.get('offset'));assert.ok([0,250,500,750].includes(offset));
    return response(Array.from({length:250},()=>({code:'UPSTREAM_TIMEOUT',reason:'ai',duration_ms:500})));
  }});
  assert.equal(count,12);assert.equal(report.complete,false);
  for(const coverage of Object.values(report.coverage)){assert.equal(coverage.pages,4);assert.equal(coverage.truncated,true);}
  assert.equal(report.timings.operations.ai.samples,1000);
});

test('permission errors, malformed responses and transport failures never become empty success or leak upstream details',async()=>{
  for(const fetchImpl of [async()=>({status:403,json:async()=>({private:'sensitive'})}),async()=>response({message:'private'}),async()=>response([null]),async()=>{throw new Error(env.SUPABASE_SECRET_KEY);},async()=>({status:200,json:async()=>{throw new Error('private upstream text');}})]){
    await assert.rejects(collectLiveUsage({env,now,fetchImpl}),error=>{
      assert.doesNotMatch(error.message,/sb_secret|private|sensitive/);return true;
    });
  }
});

test('invalid configuration cannot send credentials to an arbitrary scheme or URL with credentials',async()=>{
  for(const url of ['http://example.supabase.co','https://user:pass@example.supabase.co','https://example.supabase.co/path','https://evil.example','https://example.supabase.co?token=x']){
    await assert.rejects(collectLiveUsage({env:{...env,SUPABASE_URL:url},fetchImpl:async()=>assert.fail('network must not run')}));
  }
});

test('report workflow is manual/main-only, uses existing protected environment and has no messaging or provider keys',()=>{
  const path='.github/workflows/live-usage-report.yml',source=readFileSync(path,'utf8');
  assert.deepEqual(auditWorkflow(path,source),[]);
  assert.match(source,/workflow_dispatch:/);assert.doesNotMatch(source,/pull_request:|schedule:|workflow_run:/);
  assert.match(source,/if: github.ref == 'refs\/heads\/main'/);assert.match(source,/environment: background-jobs/);
  assert.doesNotMatch(source,/TELEGRAM|API_FOOTBALL|TAVILY|contents: write|actions: write/);
  assert.ok(auditWorkflow(path,source.replace('environment: background-jobs','environment: other')).some(x=>x.type==='secret_environment_missing'));
});
