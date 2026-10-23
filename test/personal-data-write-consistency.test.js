import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createUserDataApiRuntime } from '../src/user-data-api-runtime.js';

const app = fs.readFileSync('public/app.js', 'utf8');
const userDataApi = fs.readFileSync('src/user-data-api-runtime.js', 'utf8');
const appCapabilities = fs.readFileSync('src/app-capabilities.js', 'utf8');
const reminderList = fs.readFileSync('public/modules/reminder-list.js', 'utf8');
const favoriteTeamsRenderer = fs.readFileSync('public/modules/favorite-teams-renderer.js', 'utf8');

function sourceBlock(source,start,end) {
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

function apiRuntime(overrides={}) {
  const reminderRow={
    fixture_id:777,
    home_name:'Home',
    away_name:'Away',
    league_name:'League',
    fixture_date:'2026-10-08T18:00:00.000Z',
    notified_at:null,
    remind_before_minutes:30,
    kickoff_notify:true,
    kickoff_notified_at:null,
    prematch_attempts:1,
    kickoff_attempts:0,
    delivery_last_attempt_at:'2026-10-08T16:00:00.000Z',
  };
  return createUserDataApiRuntime({
    addFavorite:async()=>({team_id:1,team_name:'Team',team_logo:''}),
    addFavoritePlayer:async()=>({player_id:1,player_name:'Player',team_id:2}),
    addReminder:async()=>reminderRow,
    analysisFreshness:()=>({}),
    analysisResponsePayload:value=>value,
    getBotDigestSubscription:async()=>({}),
    getCache:async()=>null,
    getFavoritePlayers:async()=>[],
    getFavorites:async()=>[],
    getHistory:async()=>[],
    getPreferences:async()=>({}),
    getQuota:async()=>({plan:'FREE'}),
    getReminders:async()=>[reminderRow],
    getStaleCache:async()=>null,
    getUserRecord:async()=>({}),
    isAdminUser:()=>false,
    json:(body,status=200)=>({body,status}),
    publicDataCapabilities:()=>({}),
    publicDigestSettings:()=>({}),
    publicPlayerFollowNotificationContract:()=>({}),
    publicRuntimeControls:()=>({}),
    publicSiteUrl:()=> 'https://example.test/',
    publicSmartNotificationCapabilities:()=>({}),
    recordOpsEvent:async()=>{},
    reminderDeliveryStatus:()=> 'pending',
    removeFavorite:async()=>true,
    removeFavoritePlayer:async()=>true,
    removeReminder:async()=>true,
    savePreferences:async value=>value,
    setBotDigestSubscription:async()=>({}),
    ...overrides,
  });
}

test('favorite reads cannot overwrite a newer confirmed mutation', () => {
  assert.match(app, /favoritesRevision:\s*0/);
  const load = sourceBlock(app,'async function loadFavorites()','async function loadReminders()');
  assert.match(load, /const revisionAtStart = state\.favoritesRevision/);
  assert.match(load, /revisionAtStart !== state\.favoritesRevision/);
  assert.match(app, /state\.favoritesRevision \+= 1/);
});

test('reminder reads cannot overwrite a newer confirmed mutation', () => {
  assert.match(app, /remindersRevision:\s*0/);
  const load = sourceBlock(app,'async function loadReminders()','async function handleReminderRemove');
  assert.match(load, /const revisionAtStart = state\.remindersRevision/);
  assert.match(load, /revisionAtStart !== state\.remindersRevision/);
  assert.match(app, /state\.remindersRevision \+= 1/);
});

test('concurrent favorite mutations merge against state after each confirmed write', () => {
  const toggle=sourceBlock(app,'async function toggleFavorite(team)','function storageGet');
  const deleteAwait=toggle.indexOf("await api(`/api/favorites?teamId=${teamId}`");
  const deleteRows=toggle.indexOf('const rows = Array.isArray(state.favorites)',deleteAwait);
  const postAwait=toggle.indexOf("const data = await api('/api/favorites'");
  const postRows=toggle.indexOf('const rows = Array.isArray(state.favorites)',postAwait);

  assert.ok(deleteAwait>=0 && deleteRows>deleteAwait);
  assert.ok(postAwait>=0 && postRows>postAwait);
  assert.doesNotMatch(toggle,/try \{\s*const rows = Array\.isArray\(state\.favorites\)/);
});

test('concurrent reminder mutations merge against state after each confirmed write', () => {
  const toggle=sourceBlock(app,'async function toggleReminder(match)','function clampPercent');
  const deleteAwait=toggle.indexOf("await api(`/api/reminders?fixtureId=${fixtureId}`");
  const deleteRows=toggle.indexOf('const rows = Array.isArray(state.reminders)',deleteAwait);
  const postAwait=toggle.indexOf("const data = await api('/api/reminders'");
  const postRows=toggle.indexOf('const rows = Array.isArray(state.reminders)',postAwait);

  assert.ok(deleteAwait>=0 && deleteRows>deleteAwait);
  assert.ok(postAwait>=0 && postRows>postAwait);
  assert.doesNotMatch(toggle,/try \{\s*const rows = Array\.isArray\(state\.reminders\)/);
});

test('creating a reminder updates the local list from the POST response without a second GET', () => {
  const toggle=sourceBlock(app,'async function toggleReminder(match)','function clampPercent');
  assert.match(toggle, /const data = await api\('\/api\/reminders', \{/);
  assert.match(toggle, /const item = data\?\.item/);
  assert.match(toggle, /state\.reminders = \[item,/);
  assert.doesNotMatch(toggle.slice(toggle.indexOf('const item = data?.item')), /await loadReminders\(\)/);
});

test('personal-data API rejects malformed collection responses instead of publishing false empty state', async () => {
  const malformedFavorites=apiRuntime({
    getFavorites:async()=>({unexpected:true}),
  });
  await assert.rejects(
    ()=>malformedFavorites.apiFavorites(
      {method:'GET',url:'https://example.test/api/favorites'},
      {},
      {id:42},
    ),
    error=>error?.code==='PERSONAL_DATA_INVALID_RESPONSE',
  );

  const malformedReminders=apiRuntime({
    getReminders:async()=>[null],
  });
  await assert.rejects(
    ()=>malformedReminders.apiReminders(
      {method:'GET',url:'https://example.test/api/reminders'},
      {},
      {id:42},
    ),
    error=>error?.code==='PERSONAL_DATA_INVALID_RESPONSE',
  );

  assert.match(userDataApi,/Personal-data store returned an invalid collection/);
  assert.match(userDataApi,/PERSONAL_DATA_INVALID_RESPONSE/);
});

test('reminder GET and POST expose the same normalized public item contract', async () => {
  const runtime=apiRuntime();
  const getResponse=await runtime.apiReminders(
    {method:'GET',url:'https://example.test/api/reminders'},
    {},
    {id:42},
  );
  const postResponse=await runtime.apiReminders(
    {
      method:'POST',
      url:'https://example.test/api/reminders',
      json:async()=>({fixtureId:777}),
    },
    {},
    {id:42},
  );

  assert.equal(getResponse.status,200);
  assert.equal(postResponse.status,200);
  assert.deepEqual(postResponse.body.item,getResponse.body.items[0]);
  assert.deepEqual(postResponse.body.item,{
    fixtureId:777,
    homeName:'Home',
    awayName:'Away',
    leagueName:'League',
    fixtureDate:'2026-10-08T18:00:00.000Z',
    notifiedAt:null,
    remindBeforeMinutes:30,
    kickoffNotify:true,
    kickoffNotifiedAt:null,
    deliveryStatus:'pending',
    deliveryAttempts:1,
    deliveryLastAttemptAt:'2026-10-08T16:00:00.000Z',
  });
});

test('empty cached personal-data lists still surface refresh failures', () => {
  assert.match(favoriteTeamsRenderer, /Последний загруженный список избранного был пуст/);
  assert.match(reminderList, /Последний загруженный список напоминаний был пуст/);
});

test('current app manifest exposes personal-data write consistency contracts', () => {
  assert.match(appCapabilities, /personalDataWriteConsistency:true/);
  assert.match(appCapabilities, /reminderWriteConfirmation:true/);
  assert.match(appCapabilities, /readWriteRaceGuard:true/);
});

test('bootstrap profile keeps current auth/quota/preferences but does not read decorative collections',async()=>{
  const calls=[];
  const tracked=name=>async()=>{calls.push(name);return [];};
  const api=apiRuntime({getFavorites:tracked('favorites'),getFavoritePlayers:tracked('players'),getReminders:tracked('reminders'),getQuota:async()=>({plan:'PRO',left:12}),getPreferences:async()=>({defaultFilter:'live'})});
  const boot=await api.apiMe(new Request('https://example.test/api/me?bootstrap=1'),{}, {id:42});
  assert.equal(boot.body.bootstrap,true);assert.equal(boot.body.stats,null);assert.equal(boot.body.quota.plan,'PRO');
  assert.equal(boot.body.preferences.defaultFilter,'live');assert.deepEqual(calls,[]);
  const full=await api.apiMe(new Request('https://example.test/api/me'),{}, {id:42});
  assert.deepEqual(calls.sort(),['favorites','players','reminders']);assert.equal(full.body.bootstrap,undefined);
  assert.deepEqual(full.body.stats,{favorites:0,favoritePlayers:0,reminders:0});
  assert.equal((await api.apiMe(new Request('https://example.test/api/me?bootstrap=1'),{},null)).status,401);
});

test('favorite player can be saved from a verified club squad without a fixture; client metadata is ignored',async()=>{
 const writes=[];
 const squad={available:true,team:{id:55},players:[{id:777,name:'Canonical Roster Player'}]};
 const api=apiRuntime({getCache:async key=>key==='team:squad:55:v1'?squad:null,addFavoritePlayer:async(userId,player)=>{writes.push({userId,player});return {player_id:player.id,player_name:player.name,team_id:player.teamId};}});
 const request=body=>new Request('https://example.test/api/favorite-players',{method:'POST',body:JSON.stringify(body)});
 const saved=await api.apiFavoritePlayers(request({playerId:777,teamId:55,playerName:'Injected name'}),{}, {id:42});
 assert.equal(saved.status,200);assert.equal(saved.body.item.playerName,'Canonical Roster Player');
 assert.deepEqual(writes,[{userId:42,player:{id:777,name:'Canonical Roster Player',teamId:55}}]);
 for(const body of [{playerId:778,teamId:55},{playerId:777,teamId:56},{playerId:777,teamId:55,fixtureId:'invalid'}]){
  const result=await api.apiFavoritePlayers(request(body),{}, {id:42});assert.ok(result.status>=400);
 }
 const unauth=await api.apiFavoritePlayers(request({playerId:777,teamId:55}),{},null);assert.equal(unauth.status,401);assert.equal(writes.length,1);
 const expired=apiRuntime({getCache:async()=>null,getStaleCache:async()=>squad});
 assert.equal((await expired.resolveFavoritePlayerIdentity({playerId:777,teamId:55},{})).status,409);
});

test('favorite players from pre-match lineups are verified against fixture and team identity',async()=>{
 const center={match:{fixtureId:999,home:{id:55},away:{id:56}},lineups:{home:{startXI:[{id:777,name:'Starting Player'}],substitutes:[{player:{id:778,name:'Bench Player'}}]}}};
 const api=apiRuntime({getCache:async key=>key==='match-center:999:v17-event-evidence-rc144' ? center : null});
 for(const playerId of [777,778])assert.equal((await api.resolveFavoritePlayerIdentity({playerId,teamId:55,fixtureId:999},{})).ok,true);
 assert.equal((await api.resolveFavoritePlayerIdentity({playerId:777,teamId:56,fixtureId:999},{})).ok,false);
 assert.equal((await api.resolveFavoritePlayerIdentity({playerId:777,teamId:55,fixtureId:998},{})).ok,false);
});
