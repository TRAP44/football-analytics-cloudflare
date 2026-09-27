import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUserFavoritesService } from '../src/user-favorites.js';

function runtime(overrides = {}) {
  const memory={favorites:new Map()};
  const rpcCalls=[];
  const fetchCalls=[];
  const service=createUserFavoritesService({
    memory,
    hasSupabase:overrides.hasSupabase || (()=>false),
    supaSelectMany:overrides.supaSelectMany || (async()=>[]),
    supaRpc:overrides.supaRpc || (async(_cfg,name,args,timeout)=>{
      rpcCalls.push({name,args,timeout});
      return {allowed:true,item:{telegram_id:args.p_telegram_id,team_id:args.p_team_id,team_name:args.p_team_name,team_logo:args.p_team_logo}};
    }),
    fetchWithTimeout:overrides.fetchWithTimeout || (async(url,init,timeout,source)=>{
      fetchCalls.push({url:String(url),init,timeout,source});
      return {ok:true,status:204};
    }),
    supaHeaders:overrides.supaHeaders || ((_cfg,extra)=>({...extra,'x-test':'1'})),
  });
  return {memory,rpcCalls,fetchCalls,service};
}

test('favorites service preserves in-memory add/read/remove semantics', async () => {
  const {memory,service}=runtime();
  const cfg={};
  const added=await service.addFavorite(7,{id:101,name:' Arsenal ',logo:'https://example.test/a.png'},cfg);
  assert.equal(added.telegram_id,7);
  assert.equal(added.team_id,101);
  assert.equal(added.team_name,'Arsenal');
  assert.equal((await service.getFavorites(7,cfg)).length,1);
  await service.removeFavorite(7,101,cfg);
  assert.deepEqual(await service.getFavorites(7,cfg),[]);
  assert.equal(memory.favorites.get(7).length,0);
});

test('favorites service preserves 50-item fallback cap', async () => {
  const {memory,service}=runtime();
  memory.favorites.set(9,Array.from({length:50},(_,i)=>({
    telegram_id:9,team_id:i+1,team_name:`Club ${i+1}`,team_logo:'',created_at:new Date().toISOString(),
  })));
  await assert.rejects(
    ()=>service.addFavorite(9,{id:999,name:'Extra Club',logo:''},{}),
    error=>error?.code==='FAVORITES_LIMIT',
  );
  assert.equal(memory.favorites.get(9).length,50);
});

test('favorites service preserves guarded Supabase RPC contract', async () => {
  const {rpcCalls,service}=runtime({hasSupabase:()=>true});
  const row=await service.addFavorite(11,{id:55,name:'Club',logo:''},{supabaseUrl:'https://db.test'});
  assert.equal(row.team_id,55);
  assert.equal(rpcCalls.length,1);
  assert.equal(rpcCalls[0].name,'save_favorite_guarded');
  assert.equal(rpcCalls[0].args.p_telegram_id,11);
  assert.equal(rpcCalls[0].args.p_team_id,55);
  assert.equal(rpcCalls[0].args.p_limit,50);
  assert.equal(rpcCalls[0].timeout,4000);
});

test('favorites service preserves Supabase delete request shape', async () => {
  const {fetchCalls,service}=runtime({hasSupabase:()=>true});
  await service.removeFavorite(15,77,{supabaseUrl:'https://db.test'});
  assert.equal(fetchCalls.length,1);
  const call=fetchCalls[0];
  assert.match(call.url,/\/rest\/v1\/favorites/);
  assert.match(call.url,/telegram_id=eq\.15/);
  assert.match(call.url,/team_id=eq\.77/);
  assert.equal(call.init.method,'DELETE');
  assert.equal(call.init.headers.Prefer,'return=minimal');
  assert.equal(call.timeout,7000);
  assert.equal(call.source,'Supabase favorites');
});

test('worker delegates favorites storage boundary to extracted service', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/import \{ createUserFavoritesService \} from '\.\/user-favorites\.js'/);
  assert.match(worker,/createUserFavoritesService\(\{/);
  assert.doesNotMatch(worker,/async function getFavorites\(userId, cfg\)/);
  assert.doesNotMatch(worker,/async function addFavorite\(userId, team, cfg\)/);
  assert.doesNotMatch(worker,/async function removeFavorite\(userId, teamId, cfg\)/);
  assert.match(worker,/await getFavorites\(user\.id, cfg\)/);
  assert.match(worker,/await addFavorite\(user\.id/);
  assert.match(worker,/await removeFavorite\(user\.id/);
});
