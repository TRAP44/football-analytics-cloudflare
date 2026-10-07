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
  assert.doesNotMatch(toggle, /await loadReminders\(\)/);
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
