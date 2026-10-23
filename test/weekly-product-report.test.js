import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeProductUsage,collectProductUsage,productMarkdown} from '../scripts/weekly-product-report.js';
import {auditWorkflow} from '../scripts/privileged-access-audit.js';
const now=new Date('2026-10-20T08:00:00Z');
const row=(user,event,created_at)=>({telegram_id:user,event_name:event,created_at,metadata:{private:'private text'},username:'private name'});
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'not-for-output'};
const response=rows=>new Response(JSON.stringify(rows),{status:200});

test('weekly counts deduplicate people, separate event counts and follow direct paths after entry',()=>{
  const report=summarizeProductUsage([
    row('123456789','bot_start','2026-10-12T10:00:00Z'),
    row('123456789','miniapp_open','2026-10-13T10:00:00Z'),
    row(123456789,'miniapp_open','2026-10-13T10:01:00Z'),
    row('123456789','full_ai','2026-10-13T10:02:00Z'),
    row('123456789','miniapp_open','2026-10-14T10:00:00Z'),
    row(987654321,'match_open','2026-10-15T10:00:00Z'),
    row(987654321,'full_ai','2026-10-15T10:01:00Z'),
    row(987654321,'bot_start','2026-10-15T10:02:00Z'),
    row(111111111,'favorite_add','2026-10-19T10:00:00Z'),
  ],[{created_at:'2026-10-19T10:00:00Z',username:'private name'}],{now});
  assert.equal(report.complete,true);
  assert.equal(report.registrations.createdInWeekAtLeast,1);
  assert.equal(report.activity.productUsersAtLeast,3);
  assert.equal(report.activity.entryUsersAtLeast,2);
  assert.equal(report.activity.events.miniapp_open.eventsAtLeast,3);
  assert.equal(report.activity.events.miniapp_open.usersAtLeast,1);
  assert.equal(report.activity.events.full_ai.usersAtLeast,2);
  assert.equal(report.returns.entryOnMultipleMoscowDaysAtLeast,1);
  assert.equal(report.returns.entryInBothWeeksAtLeast,1);
  assert.equal(report.returns.previousWeekReturnPct,100);
  assert.equal(report.afterEntry.full_ai.usersAtLeast,1,'delivery before entry is not a conversion');
  assert.equal(report.afterEntry.full_ai.ofEntryPct,50);
  assert.equal(report.afterEntry.match_open.usersAtLeast,0,'direct analysis does not require a search or match_open');
  assert.doesNotMatch(JSON.stringify(report)+productMarkdown(report),/123456789|987654321|111111111|private text|private name|telegram_id/);
});

test('return days use Moscow boundaries, not UTC midnight or repeated clicks',()=>{
  const report=summarizeProductUsage([
    row(1,'miniapp_open','2026-10-18T20:59:00Z'),
    row(1,'bot_start','2026-10-18T21:00:00Z'),
    row(2,'miniapp_open','2026-10-19T23:00:00Z'),
    row(2,'miniapp_open','2026-10-20T00:00:00Z'),
  ],[],{now});
  assert.equal(report.returns.entryOnMultipleMoscowDaysAtLeast,1);
  assert.equal(report.daily.find(x=>x.day==='2026-10-18').entryUsersAtLeast,1);
  assert.equal(report.daily.find(x=>x.day==='2026-10-19').entryUsersAtLeast,1);
  assert.equal(report.daily.find(x=>x.day==='2026-10-20').entryUsersAtLeast,1);
});

test('invalid rows and truncated windows suppress rates, and empty history never invents retention',()=>{
  const valid=row(1,'miniapp_open','2026-10-19T10:00:00Z');
  for(const extra of [null,row(0,'miniapp_open','2026-10-19T10:00:00Z'),row('9007199254740992','miniapp_open','2026-10-19T10:00:00Z'),row(1,'arbitrary secret','2026-10-19T10:00:00Z'),row(1,'miniapp_open','bad'),row(1,'miniapp_open',now.toISOString()),row(1,'miniapp_open','2026-10-01T10:00:00Z')]){
    const report=summarizeProductUsage([valid,extra],[],{now});
    assert.equal(report.complete,false);
    assert.equal(report.coverage.events.invalidRows,1);
    assert.equal(report.afterEntry.full_ai.ofEntryPct,null);
  }
  const partial=summarizeProductUsage([valid],[],{now,eventsTruncated:true});
  assert.equal(partial.afterEntry.full_ai.ofEntryPct,null);
  assert.equal(partial.returns.previousWeekReturnPct,null);
  assert.equal(summarizeProductUsage([],[],{now}).returns.previousWeekReturnPct,null);
  const onlyRegistrationsPartial=summarizeProductUsage([valid],[],{now,registrationsTruncated:true});
  assert.equal(onlyRegistrationsPartial.complete,false);
  assert.equal(onlyRegistrationsPartial.afterEntry.full_ai.ofEntryPct,0,'independent event coverage is complete');
});

test('collector makes narrow bounded read-only queries and writes no personal fields into its result',async()=>{
  const calls=[];
  const report=await collectProductUsage({env,now,fetchImpl:async(url,init)=>{
    calls.push({url,init});
    assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.apikey,env.SUPABASE_SECRET_KEY);
    assert.ok(init.signal);assert.equal(url.searchParams.get('limit'),'500');
    assert.doesNotMatch(url.searchParams.get('select'),/\*|metadata|username|first_name|photo/);
    if(url.pathname==='/rest/v1/growth_events'){
      assert.equal(url.searchParams.get('select'),'telegram_id,event_name,created_at');
      assert.equal(url.searchParams.get('order'),'created_at.asc,id.asc');
      assert.equal(url.searchParams.get('and'),'(created_at.gte.2026-10-06T08:00:00.000Z,created_at.lt.2026-10-20T08:00:00.000Z)');
      assert.match(url.searchParams.get('event_name'),/^in\.\(bot_start,miniapp_open,/);
      return response([row(123456789,'miniapp_open','2026-10-19T10:00:00Z')]);
    }
    assert.equal(url.pathname,'/rest/v1/users');
    assert.equal(url.searchParams.get('select'),'created_at');
    assert.equal(url.searchParams.get('and'),'(created_at.gte.2026-10-13T08:00:00.000Z,created_at.lt.2026-10-20T08:00:00.000Z)');
    return response([{created_at:'2026-10-19T10:00:00Z'}]);
  }});
  assert.equal(calls.length,2);assert.equal(report.activity.entryUsersAtLeast,1);
  assert.doesNotMatch(JSON.stringify(report)+productMarkdown(report),/not-for-output|123456789|private/);
});

test('full pages stop at a hard ceiling and never imply complete audience counts',async()=>{
  let calls=0;
  const report=await collectProductUsage({env,now,fetchImpl:async(url)=>{
    calls++;
    assert.ok(Number(url.searchParams.get('offset'))<=4500);
    return response(Array.from({length:500},()=>url.pathname.endsWith('growth_events')?row(1,'miniapp_open','2026-10-19T10:00:00Z'):{created_at:'2026-10-19T10:00:00Z'}));
  }});
  assert.equal(calls,20);assert.equal(report.complete,false);
  assert.equal(report.coverage.events.pages,10);
  assert.equal(report.coverage.events.truncated,true);
  assert.equal(report.afterEntry.full_ai.ofEntryPct,null);
});

test('errors never expose private upstream text; invalid URLs never receive credentials',async()=>{
  for(const fetchImpl of [async()=>new Response('private response',{status:403}),async()=>response({message:'private'}),async()=>response([null]),async()=>response(Array(501).fill({})),async()=>new Response('x'.repeat(500001)),async()=>{throw Error(env.SUPABASE_SECRET_KEY); }]){
    await assert.rejects(collectProductUsage({env,now,fetchImpl}),error=>{assert.doesNotMatch(error.message,/private|not-for-output/);return true;});
  }
  for(const url of ['http://example.supabase.co','https://example.supabase.co.evil.example','https://user:pass@example.supabase.co','https://example.supabase.co/path','https://example.supabase.co?secret=x']){
    await assert.rejects(collectProductUsage({env:{...env,SUPABASE_URL:url},now,fetchImpl:()=>assert.fail('credentials sent')}));
  }
});

test('product report stays optional, manual/main-only, protected and report steps free of messaging/provider bindings',()=>{
  const path='.github/workflows/live-usage-report.yml',source=readFileSync(path,'utf8');
  assert.deepEqual(auditWorkflow(path,source),[]);
  assert.match(source,/include_product_report:[\s\S]*?default: false/);
  assert.match(source,/if: inputs.include_product_report == true/);
  assert.match(source,/if: github.ref == 'refs\/heads\/main'/);
  assert.match(source,/environment: background-jobs/);
  const withoutWatch=source.replace(/      - name: Verify official watch source metadata\n[\s\S]*?run: node scripts\/inspect-match-watch\.js\n/,'');
  assert.equal((source.match(/secrets\.API_FOOTBALL_KEY/g)||[]).length,1);
  assert.doesNotMatch(withoutWatch,/pull_request:|schedule:|workflow_run:|TELEGRAM|API_FOOTBALL|contents: write|actions: write/);
});
