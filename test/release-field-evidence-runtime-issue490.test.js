import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleaseFieldEvidenceRuntime } from '../src/release-field-evidence.js';

function runtime(overrides = {}) {
  const ops=[];
  const providerCalls=[];
  const lockBodies=[];
  const ids=['beta-claim','provider-claim','extra-claim'];
  const api=createReleaseFieldEvidenceRuntime({
    hasSupabase:overrides.hasSupabase || (()=>true),
    appVersion:'6.120.0-rc144',
    fetchWithTimeout:overrides.fetchWithTimeout || (async(_url,options)=>{
      const body=JSON.parse(options.body);
      lockBodies.push(body[0]);
      return {
        ok:true,
        json:async()=>[{payload:{claimId:body[0].payload.claimId}}],
      };
    }),
    supaHeaders:(_cfg,extra={})=>extra,
    supaSelectMany:overrides.supaSelectMany || (async()=>[
      {telegram_id:1001,created_at:'2026-10-05T10:00:00.000Z'},
      {telegram_id:2002,created_at:'2026-10-05T09:00:00.000Z'},
      {telegram_id:3003,created_at:'2026-10-05T08:00:00.000Z'},
    ]),
    recordOpsEvent:async(_cfg,event)=>{ops.push(event);},
    loadSharedProviderState:async()=>{},
    apiFootball:overrides.apiFootball || (async(path,params,_cfg,options)=>{
      providerCalls.push({path,params,options});
      return {};
    }),
    isFootballRateLimitError:error=>String(error?.code || '')==='FOOTBALL_RATE_LIMIT',
    providerSnapshot:()=>({
      plan:'FREE',
      dailyLimit:100,
      dailyRemaining:77,
      minuteLimit:10,
      minuteRemaining:7,
      cooldownActive:false,
    }),
    randomUUID:()=>ids.shift() || 'fallback-claim',
    now:()=>Date.parse('2026-10-05T10:30:00.000Z'),
  });
  return {api,ops,providerCalls,lockBodies};
}

test('release evidence requires strict Supabase availability and valid lock identity',async()=>{
  let fetches=0;
  const rt=runtime({
    hasSupabase:()=> 'true',
    fetchWithTimeout:async()=>{fetches+=1; return {ok:true,json:async()=>[]};},
  });
  assert.equal(await rt.api.claimReleaseEvidenceLock({supabaseUrl:'https://db.test'},'beta-access'),false);
  assert.equal(fetches,0);

  const malformedKind=runtime();
  assert.equal(
    await malformedKind.api.claimReleaseEvidenceLock({supabaseUrl:'https://db.test'},{toString:()=> 'beta-access'}),
    false,
  );
});

test('release evidence lock rejects clocks that cannot safely fit the lease TTL',async()=>{
  let fetches=0;
  const api=createReleaseFieldEvidenceRuntime({
    hasSupabase:()=>true,
    appVersion:'6.120.0-rc144',
    fetchWithTimeout:async()=>{fetches+=1;return {ok:true,json:async()=>[]};},
    supaHeaders:()=>({}),
    supaSelectMany:async()=>[],
    recordOpsEvent:async()=>{},
    loadSharedProviderState:async()=>{},
    apiFootball:async()=>({}),
    isFootballRateLimitError:()=>false,
    providerSnapshot:()=>({}),
    randomUUID:()=> 'clock-boundary-claim',
    now:()=>8.64e15,
  });
  assert.equal(
    await api.claimReleaseEvidenceLock({supabaseUrl:'https://db.test'},'beta-access'),
    false,
  );
  assert.equal(fetches,0);
});

test('release evidence lock requires strict confirmed HTTP success',async()=>{
  const rt=runtime({
    fetchWithTimeout:async(_url,options)=>{
      const body=JSON.parse(options.body);
      return {
        ok:'true',
        json:async()=>[{payload:{claimId:body[0].payload.claimId}}],
      };
    },
  });
  assert.equal(
    await rt.api.claimReleaseEvidenceLock({supabaseUrl:'https://db.test'},'beta-access'),
    false,
  );
});

test('Issue #490 release evidence is skipped when Supabase is unavailable',async()=>{
  let fetches=0;
  const rt=runtime({
    hasSupabase:()=>false,
    fetchWithTimeout:async()=>{fetches+=1; throw new Error('unexpected');},
  });
  assert.equal(await rt.api.claimReleaseEvidenceLock({},'beta-access'),false);
  assert.equal(rt.api.scheduleReleaseFieldEvidence({}),null);
  await rt.api.captureReleaseFieldEvidence({});
  assert.equal(fetches,0);
  assert.equal(rt.ops.length,0);
  assert.equal(rt.providerCalls.length,0);
});

test('beta evidence ignores coercible allowlist identifiers and uses strict config booleans',async()=>{
  const rt=runtime({
    supaSelectMany:async()=>[
      {telegram_id:'1001',created_at:'not-a-date'},
      {telegram_id:true,created_at:'2026-10-05T09:00:00.000Z'},
    ],
  });
  const ok=await rt.api.recordClosedBetaConfigurationEvidence({
    supabaseUrl:'https://db.test',
    adminTelegramIds:[true,'1001',[2002]],
    betaTelegramIds:['2002',false],
    betaAccessConfigured:true,
    betaAccessEnabled:'true',
  });
  assert.equal(ok,true);
  const event=rt.ops.find(row=>row.code==='BETA_ACCESS_CONFIG_CONFIRMED');
  assert.equal(event.meta.adminAllowlistCount,1);
  assert.equal(event.meta.betaAllowlistCount,1);
  assert.equal(event.meta.betaAccessConfigured,'invalid');
  assert.equal(event.meta.strictEffective,false);
  assert.equal(event.meta.observedUsers,1);
  assert.equal(event.meta.observedInvalidUsers,1);
  assert.equal(event.meta.newestUserCreatedAt,null);
});

test('beta evidence releases its lock when the user sample cannot be read',async()=>{
  const calls=[];
  const rt=runtime({
    supaSelectMany:async()=>{throw new Error('temporary read failure');},
    fetchWithTimeout:async(url,options)=>{
      calls.push({url:String(url),method:options.method});
      if(options.method==='POST'){
        const body=JSON.parse(options.body);
        return {ok:true,json:async()=>[{payload:{claimId:body[0].payload.claimId}}]};
      }
      return {ok:true,json:async()=>[]};
    },
  });
  assert.equal(await rt.api.recordClosedBetaConfigurationEvidence({supabaseUrl:'https://db.test'}),false);
  assert.deepEqual(calls.map(item=>item.method),['POST','DELETE']);
  assert.match(calls[1].url,/payload-%3E%3EclaimId=/);
});

test('Issue #490 release evidence keeps beta identities out of ops metadata',async()=>{
  const rt=runtime();
  const cfg={
    supabaseUrl:'https://db.test',
    adminTelegramIds:[1001],
    betaTelegramIds:[2002],
    betaAccessConfigured:'true',
    betaAccessEnabled:true,
  };
  const ok=await rt.api.recordClosedBetaConfigurationEvidence(cfg);
  assert.equal(ok,true);
  const event=rt.ops.find(row=>row.code==='BETA_ACCESS_CONFIG_CONFIRMED');
  assert.ok(event);
  assert.equal(event.meta.adminAllowlistCount,1);
  assert.equal(event.meta.betaAllowlistCount,1);
  assert.equal(event.meta.observedNonAdminOutsideBeta,1);
  const serialized=JSON.stringify(event.meta);
  for (const id of ['1001','2002','3003']) assert.equal(serialized.includes(id),false);
});

test('provider evidence rejects malformed key/snapshot coercion and bounds retry_after',async()=>{
  const noKey=runtime();
  assert.equal(
    await noKey.api.probeReleaseProviderQuotaEvidence({supabaseUrl:'https://db.test',apiFootballKey:{secret:true}}),
    false,
  );
  assert.equal(noKey.providerCalls.length,0);

  const limited=Object.assign(new Error('limited'),{
    code:{toString:()=> 'FOOTBALL_RATE_LIMIT'},
    retryAfter:999999999,
  });
  const ops=[];
  const api=createReleaseFieldEvidenceRuntime({
    hasSupabase:()=>true,
    appVersion:'6.120.0-rc144',
    fetchWithTimeout:async(_url,options)=>{
      const body=JSON.parse(options.body);
      return {ok:true,json:async()=>[{payload:{claimId:body[0].payload.claimId}}]};
    },
    supaHeaders:(_cfg,extra={})=>extra,
    supaSelectMany:async()=>[],
    recordOpsEvent:async(_cfg,event)=>ops.push(event),
    loadSharedProviderState:async()=>{},
    apiFootball:async()=>{throw limited;},
    isFootballRateLimitError:()=>true,
    providerSnapshot:()=>({
      plan:{name:'FREE'},
      dailyLimit:true,
      dailyRemaining:'77',
      minuteLimit:[10],
      minuteRemaining:-1,
      cooldownActive:'true',
    }),
    randomUUID:()=> 'provider-boundary-claim',
    now:()=>Date.parse('2026-10-05T10:30:00.000Z'),
  });
  assert.equal(await api.probeReleaseProviderQuotaEvidence({
    supabaseUrl:'https://db.test',
    apiFootballKey:'configured',
  }),true);
  const event=ops.find(row=>row.code==='PROVIDER_RELEASE_QUOTA_PROBE');
  assert.equal(event.meta.errorCode,'PROVIDER_PROBE_FAILED');
  assert.equal(event.meta.retryAfter,604800);
  assert.equal(event.meta.plan,'UNKNOWN');
  assert.equal(event.meta.dailyLimit,null);
  assert.equal(event.meta.dailyRemaining,77);
  assert.equal(event.meta.minuteLimit,null);
  assert.equal(event.meta.minuteRemaining,null);
  assert.equal(event.meta.cooldownActive,false);
});

test('provider evidence releases lock if persistence fails after the controlled probe',async()=>{
  const methods=[];
  const rt=runtime({
    fetchWithTimeout:async(_url,options)=>{
      methods.push(options.method);
      if(options.method==='POST'){
        const body=JSON.parse(options.body);
        return {ok:true,json:async()=>[{payload:{claimId:body[0].payload.claimId}}]};
      }
      return {ok:true,json:async()=>[]};
    },
  });
  const failing=createReleaseFieldEvidenceRuntime({
    hasSupabase:()=>true,
    appVersion:'6.120.0-rc144',
    fetchWithTimeout:async(url,options)=>{
      methods.push(options.method);
      if(options.method==='POST'){
        const body=JSON.parse(options.body);
        return {ok:true,json:async()=>[{payload:{claimId:body[0].payload.claimId}}]};
      }
      return {ok:true};
    },
    supaHeaders:(_cfg,extra={})=>extra,
    supaSelectMany:async()=>[],
    recordOpsEvent:async()=>{throw new Error('write failed');},
    loadSharedProviderState:async()=>{},
    apiFootball:async()=>({}),
    isFootballRateLimitError:()=>false,
    providerSnapshot:()=>({plan:'FREE'}),
    randomUUID:()=> 'provider-persist-fail',
    now:()=>Date.parse('2026-10-05T10:30:00.000Z'),
  });
  assert.equal(await failing.probeReleaseProviderQuotaEvidence({
    supabaseUrl:'https://db.test',
    apiFootballKey:'configured',
  }),false);
  assert.deepEqual(methods.slice(-2),['POST','DELETE']);
});

test('Issue #490 provider field probe is bounded and records only quota facts',async()=>{
  const rt=runtime();
  const cfg={supabaseUrl:'https://db.test',apiFootballKey:'configured'};
  const ok=await rt.api.probeReleaseProviderQuotaEvidence(cfg);
  assert.equal(ok,true);
  assert.equal(rt.providerCalls.length,1);
  assert.deepEqual(rt.providerCalls[0],{
    path:'/status',
    params:{},
    options:{responseType:'any',transportRetries:0,timeoutMs:8000},
  });
  const event=rt.ops.find(row=>row.code==='PROVIDER_RELEASE_QUOTA_PROBE');
  assert.equal(event.meta.outcome,'success');
  assert.equal(event.meta.plan,'FREE');
  assert.equal(event.meta.dailyRemaining,77);
  assert.equal(event.meta.minuteRemaining,7);
  assert.equal(JSON.stringify(event).includes('configured'),false);
});

test('scheduled capture survives a synchronous waitUntil hook failure',async()=>{
  const rt=runtime();
  const cfg={
    supabaseUrl:'https://db.test',
    apiFootballKey:'configured',
    adminTelegramIds:[1001],
    betaTelegramIds:[2002],
    betaAccessConfigured:'true',
    betaAccessEnabled:true,
    waitUntil(){throw new Error('bad hook');},
  };
  const task=rt.api.scheduleReleaseFieldEvidence(cfg);
  assert.ok(task instanceof Promise);
  await task;
  assert.equal(rt.ops.some(row=>row.code==='BETA_ACCESS_CONFIG_CONFIRMED'),true);
  assert.equal(rt.ops.some(row=>row.code==='PROVIDER_RELEASE_QUOTA_PROBE'),true);
});

test('Issue #490 scheduled capture uses waitUntil and runs beta/provider evidence together',async()=>{
  const rt=runtime();
  let scheduled=null;
  const cfg={
    supabaseUrl:'https://db.test',
    apiFootballKey:'configured',
    adminTelegramIds:[1001],
    betaTelegramIds:[2002],
    betaAccessConfigured:'true',
    betaAccessEnabled:true,
    waitUntil:promise=>{scheduled=promise;},
  };
  const task=rt.api.scheduleReleaseFieldEvidence(cfg);
  assert.ok(task instanceof Promise);
  assert.equal(task,scheduled);
  await task;
  assert.equal(rt.ops.some(row=>row.code==='BETA_ACCESS_CONFIG_CONFIRMED'),true);
  assert.equal(rt.ops.some(row=>row.code==='PROVIDER_RELEASE_QUOTA_PROBE'),true);
  assert.equal(rt.lockBodies.length,2);
  assert.equal(new Set(rt.lockBodies.map(row=>row.cache_key)).size,2);
});

test('Issue #490 provider field probe classifies rate limit without throwing',async()=>{
  const rateLimit=Object.assign(new Error('limited'),{code:'FOOTBALL_RATE_LIMIT',retryAfter:19});
  const rt=runtime({apiFootball:async()=>{throw rateLimit;}});
  const ok=await rt.api.probeReleaseProviderQuotaEvidence({supabaseUrl:'https://db.test',apiFootballKey:'configured'});
  assert.equal(ok,true);
  const event=rt.ops.find(row=>row.code==='PROVIDER_RELEASE_QUOTA_PROBE');
  assert.equal(event.meta.outcome,'rate_limited');
  assert.equal(event.meta.retryAfter,19);
  assert.equal(event.severity,'info');
});

test('release evidence lock rejects unconfirmed claims and never mistakes an HTTP success for ownership',async()=>{
  for(const payload of [[],[{payload:{claimId:'another-worker'}}],[{payload:{claimId:'beta-claim'}},{payload:{claimId:'beta-claim'}}]]){
    const rt=runtime({
      fetchWithTimeout:async()=>({ok:true,json:async()=>payload}),
    });
    assert.equal(
      await rt.api.claimReleaseEvidenceLock({supabaseUrl:'https://db.test'},'beta-access'),
      false,
    );
  }
});

test('release evidence rejects non-HTTPS Supabase origins before requesting a lease',async()=>{
  let fetches=0;
  const rt=runtime({
    fetchWithTimeout:async()=>{fetches++;return {ok:true,json:async()=>[]};},
  });
  for(const url of ['http://db.test','https://user:pass@db.test','not-a-url']){
    assert.equal(await rt.api.claimReleaseEvidenceLock({supabaseUrl:url},'beta-access'),false,url);
  }
  assert.equal(fetches,0);
});
