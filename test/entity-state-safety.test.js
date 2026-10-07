import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  collectionItems,
  isCurrentEntityRequest,
  positiveEntityId,
  teamCompetitionEntityKey,
  teamEntityKey,
  tournamentEntityKey,
  tournamentTabForTeamShortcut,
  uiErrorMessage,
} from '../public/modules/entity-state-safety.js';
import { createFavoriteTeamsRenderer } from '../public/modules/favorite-teams-renderer.js';
import { createReminderListModule } from '../public/modules/reminder-list.js';

function fakeElement() {
  return {
    innerHTML:'',
    querySelectorAll:()=>[],
    insertAdjacentHTML(_position,html){ this.innerHTML=html+this.innerHTML; },
  };
}

function elements(ids=[]) {
  const map=new Map(ids.map(id=>[id,fakeElement()]));
  return {
    get:id=>map.get(id) || null,
    ensure:id=>{
      if(!map.has(id)) map.set(id,{
        ...fakeElement(),
        addEventListener:()=>{},
      });
      return map.get(id);
    },
  };
}

test('entity keys are strict and distinguish team, competition and season identity',()=>{
  assert.equal(positiveEntityId(42),42);
  assert.equal(positiveEntityId('42'),42);
  assert.equal(positiveEntityId(true),0);
  assert.equal(
    positiveEntityId({valueOf(){throw new Error('must not coerce');}}),
    0,
  );

  assert.equal(teamEntityKey({id:42}),'42');
  assert.equal(tournamentEntityKey({leagueId:39,season:2026}),'39:2026');
  assert.equal(
    teamCompetitionEntityKey({
      id:42,
      data:{primaryCompetition:{leagueId:39,season:2026}},
    }),
    '42:39:2026',
  );
  assert.notEqual(
    teamCompetitionEntityKey({
      id:42,
      data:{primaryCompetition:{leagueId:39,season:2026}},
    }),
    teamCompetitionEntityKey({
      id:42,
      data:{primaryCompetition:{leagueId:39,season:2025}},
    }),
  );
});

test('async entity guard rejects stale sequence and same-team old competition responses',()=>{
  assert.equal(isCurrentEntityRequest({
    sequence:3,
    currentSequence:3,
    expectedKey:'42:39:2026',
    currentKey:'42:39:2026',
  }),true);

  assert.equal(isCurrentEntityRequest({
    sequence:2,
    currentSequence:3,
    expectedKey:'42:39:2026',
    currentKey:'42:39:2026',
  }),false);

  assert.equal(isCurrentEntityRequest({
    sequence:3,
    currentSequence:3,
    expectedKey:'42:39:2025',
    currentKey:'42:39:2026',
  }),false);

  assert.equal(isCurrentEntityRequest({
    sequence:'3',
    currentSequence:3,
    expectedKey:'42',
    currentKey:'42',
  }),false);
});

test('team tournament shortcut opens table only for an explicit boolean request',()=>{
  assert.equal(tournamentTabForTeamShortcut(false),'matches');
  assert.equal(tournamentTabForTeamShortcut(undefined),'matches');
  assert.equal(tournamentTabForTeamShortcut({type:'click'}),'matches');
  assert.equal(tournamentTabForTeamShortcut('true'),'matches');
  assert.equal(tournamentTabForTeamShortcut(true),'table');
});

test('personal collection payloads and UI errors reject coercion and hostile getters',()=>{
  const rows=[{id:1}];
  assert.equal(collectionItems({items:rows}),rows);
  assert.deepEqual(collectionItems({items:{0:'bad',length:1}}),[]);
  assert.deepEqual(collectionItems({items:'bad'}),[]);
  assert.deepEqual(collectionItems(null),[]);

  const hostile={};
  Object.defineProperty(hostile,'message',{
    get(){throw new Error('hostile error getter');},
  });
  assert.equal(uiErrorMessage(hostile,'fallback'),'fallback');
  assert.equal(
    uiErrorMessage({message:'  upstream\u0000 unavailable  '},'fallback'),
    'upstream unavailable',
  );
});

test('favorite renderer distinguishes loading, initial error, empty and stale states',()=>{
  const dom=elements(['favoriteTeams']);
  const state={
    favorites:[],
    favoritesLoaded:false,
    favoritesLoading:true,
    favoritesLoadError:'',
    favoriteMutations:new Set(),
  };
  const renderer=createFavoriteTeamsRenderer({
    state,
    elementById:id=>dom.get(id) || dom.ensure(id),
    escapeHtml:value=>String(value),
    safeUrl:value=>typeof value==='string' ? value : '',
    recoveryCardHtml:({title,message})=>`<div>${title}: ${message}</div>`,
    onRetryLoad:()=>{},
    onShowMatches:()=>{},
    onRemoveFavorite:()=>{},
    onOpenTeam:()=>{},
  });

  renderer.renderFavoriteTeams();
  assert.match(dom.get('favoriteTeams').innerHTML,/Загружаю избранное/);

  state.favoritesLoading=false;
  state.favoritesLoadError='storage down';
  renderer.renderFavoriteTeams();
  assert.match(dom.get('favoriteTeams').innerHTML,/Избранное временно недоступно/);

  state.favoritesLoaded=true;
  state.favoritesLoadError='';
  renderer.renderFavoriteTeams();
  assert.match(dom.get('favoriteTeams').innerHTML,/Избранных команд пока нет/);

  state.favorites=[{teamId:40,teamName:'Liverpool',teamLogo:''}];
  state.favoritesLoadError='refresh failed';
  renderer.renderFavoriteTeams();
  assert.match(
    dom.get('favoriteTeams').innerHTML,
    /Показано последнее загруженное избранное/,
  );
  assert.match(dom.get('favoriteTeams').innerHTML,/Liverpool/);
});

test('reminder renderer distinguishes loading, initial error, empty and stale states',()=>{
  const dom=elements(['reminderList']);
  const state={
    reminders:[],
    remindersLoaded:false,
    remindersLoading:true,
    remindersLoadError:'',
    reminderMutations:new Set(),
  };
  const renderer=createReminderListModule({
    state,
    elementById:id=>dom.get(id) || dom.ensure(id),
    querySelectorAll:()=>[],
    escapeHtml:value=>String(value),
    dateTime:value=>String(value),
    recoveryCardHtml:({title,message})=>`<div>${title}: ${message}</div>`,
    onRetry:()=>{},
    onOpenMatches:()=>{},
    onRemove:()=>{},
  });

  renderer.renderReminderList();
  assert.match(dom.get('reminderList').innerHTML,/Загружаю напоминания/);

  state.remindersLoading=false;
  state.remindersLoadError='storage down';
  renderer.renderReminderList();
  assert.match(dom.get('reminderList').innerHTML,/Напоминания временно недоступны/);

  state.remindersLoaded=true;
  state.remindersLoadError='';
  renderer.renderReminderList();
  assert.match(dom.get('reminderList').innerHTML,/Активных напоминаний пока нет/);

  state.reminders=[{
    fixtureId:9001,
    homeName:'Alpha',
    awayName:'Beta',
    fixtureDate:'2026-10-07T18:00:00Z',
    remindBeforeMinutes:30,
    kickoffNotify:true,
    deliveryStatus:'scheduled',
  }];
  state.remindersLoadError='refresh failed';
  renderer.renderReminderList();
  assert.match(
    dom.get('reminderList').innerHTML,
    /Показаны последние загруженные напоминания/,
  );
  assert.match(dom.get('reminderList').innerHTML,/Alpha — Beta/);
});

test('Mini App wiring uses shared entity guards instead of the old partial checks',()=>{
  const app=fs.readFileSync('public/app.js','utf8');

  assert.match(app,/from '\.\/modules\/entity-state-safety\.js'/);
  assert.match(app,/teamCompetitionEntityKey\(state\.currentTeam\)/);
  assert.match(app,/isCurrentEntityRequest\(\{/);
  assert.match(app,/state\.favorites = collectionItems\(data\)/);
  assert.match(app,/state\.reminders = collectionItems\(data\)/);
  assert.match(app,/tournamentTabForTeamShortcut\(openTable\)/);
  assert.doesNotMatch(
    app,
    /setTournamentTab\('table', true\);\s*showView\('tournamentView'\);/,
  );
});
