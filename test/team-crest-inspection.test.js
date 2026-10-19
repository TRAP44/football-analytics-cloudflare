import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTeamCrest} from '../scripts/inspect-team-crest.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'private_key'};
test('inspection reads only fixed public date caches and emits only the reported team canonical public URL',async()=>{
  const calls=[];
  const result=await inspectTeamCrest({env,now:new Date('2026-10-19T00:00:00Z'),fetchImpl:async(url,init)=>{
    calls.push(String(url));assert.equal(init.redirect,'error');
    if(String(url).startsWith(env.SUPABASE_URL)){
      assert.equal(url.searchParams.get('select'),'fixtures:payload->fixtures');assert.equal(url.searchParams.get('limit'),'1');
      assert.match(url.searchParams.get('cache_key'),/^eq\.provider-fixtures:2026-10-(18|19):v1$/);
      return Response.json([{fixtures:[{teams:{home:{id:123,name:'FARDU',logo:'https://evil.example/private_key'},away:{id:999,name:'Other'}}}],private:'do not copy'}]);
    }
    assert.equal(String(url),'https://media.api-sports.io/football/teams/123.png');assert.equal(init.headers,undefined);
    return new Response(null,{status:404});
  }});
  assert.equal(calls.length,3);assert.deepEqual(result.teams,[{teamId:123,teamName:'FARDU',logoUrl:'https://media.api-sports.io/football/teams/123.png',httpStatus:404}]);
  assert.doesNotMatch(JSON.stringify(result),/private|evil|Other/);
});
test('inspection rejects arbitrary credential destinations and excessive response bodies',async()=>{
  await assert.rejects(inspectTeamCrest({env:{...env,SUPABASE_URL:'https://evil.example'},fetchImpl:async()=>assert.fail('no network')}));
  await assert.rejects(inspectTeamCrest({env,fetchImpl:async()=>new Response('x'.repeat(2_000_001))}),/too large/);
});
