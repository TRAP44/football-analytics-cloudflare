import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildPersonalContextSignals,
  evaluatePersonalMatchInsight,
  normalizePersonalSignalText,
} from '../public/modules/personal-feed.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function sourceBlock(source,start,end) {
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('Home removes duplicate LIVE and My Teams promos while keeping contextual personalization', () => {
  assert.doesNotMatch(html, /id="homeLiveCard"/);
  assert.doesNotMatch(html, /id="homeTeamsBtn"/);
  assert.doesNotMatch(html, /id="homeFavoriteBtn"/);
  assert.match(html, /id="homePersonalMatchBtn"/);
  assert.doesNotMatch(html, /overviewRecommendedCount|dailyOverviewTitle|dailyOverviewKicker/);
  assert.match(app, /root\.hidden = !personalItem/);
  assert.doesNotMatch(app, /liveCard\.hidden = liveCount <= 0/);
  assert.doesNotMatch(app, /teamsCard\.hidden = favoriteCount <= 0/);
});

test('the primary match feed stays on For You while deferred history is still loading', () => {
  assert.match(html, /class="filter-btn active" data-filter="top">Для вас/);
  assert.match(html, /<option value="top">✨ Для вас<\/option>/);

  const apply=sourceBlock(app,'function applyMatchPayload','async function loadMatches');
  assert.doesNotMatch(apply,/state\.filter\s*=\s*['"]all['"]/);

  const history=sourceBlock(app,'async function loadHistory','async function openHistoryAnalysis');
  assert.match(history,/if \(Array\.isArray\(state\.matches\) && state\.matches\.length\) renderMatches\(\)/);

  const startup=app.slice(
    app.indexOf('const startupTasks = [loadFavorites(), loadMatches({ snapshotFastPath:true })]'),
    app.indexOf('const api = createApiClient'),
  );
  assert.match(startup,/scheduleIdle\(async \(\) => \{/);
  assert.match(startup,/const tasks = \[loadHistory\(false\)\]/);
});

test('personal context accepts only bounded real favorite and history evidence', () => {
  const history=Array.from({length:22},(_,index)=>({
    homeName:index===20 ? 'Ignored Team' : `Home ${index}`,
    awayName:`Away ${index}`,
    leagueName:`League ${index}`,
  }));
  history[0]={
    homeName:{toString:()=> 'Forged Team'},
    awayName:' Arsenal ',
    leagueName:' Premier League ',
  };

  const signals=buildPersonalContextSignals({
    favorites:[
      {teamId:7},
      {teamId:'8'},
      {teamId:[9]},
      {teamId:true},
    ],
    history,
  });

  assert.deepEqual([...signals.favoriteTeams],[7,8]);
  assert.equal(signals.viewedTeams.has('arsenal'),true);
  assert.equal(signals.viewedLeagues.has('premier league'),true);
  assert.equal(signals.viewedTeams.has('forged team'),false);
  assert.equal(signals.viewedTeams.has('ignored team'),false);
  assert.equal(signals.hasPersonalData,true);

  assert.equal(normalizePersonalSignalText({toString:()=> 'Chelsea'}),'');
});

test('personal ranking fails closed on coercible live featured ids and scores', () => {
  const forged=evaluatePersonalMatchInsight({
    home:{id:[7],name:{toString:()=> 'Arsenal'}},
    away:{id:true,name:'Chelsea'},
    league:'Premier League',
    live:'false',
    featured:'true',
    lowPriority:'false',
    youthReserve:'false',
    interestScore:'99',
    competition:{priority:'9'},
  },{
    favoriteTeams:new Set([7]),
    viewedTeams:new Set(['arsenal']),
    viewedLeagues:new Set(),
    hasPersonalData:false,
  });

  assert.deepEqual(forged,{
    score:0,
    reason:'',
    favorite:false,
    viewedTeam:false,
    viewedLeague:false,
    recommended:false,
  });

  const genuine=evaluatePersonalMatchInsight({
    home:{id:7,name:'Arsenal'},
    away:{id:8,name:'Chelsea'},
    league:'Premier League',
    live:true,
    featured:false,
    lowPriority:false,
    youthReserve:false,
    interestScore:82,
    competition:{priority:8},
  },{
    favoriteTeams:new Set([7]),
    viewedTeams:new Set(),
    viewedLeagues:new Set(),
    hasPersonalData:true,
  });

  assert.equal(genuine.favorite,true);
  assert.equal(genuine.recommended,true);
  assert.equal(genuine.reason,'Любимая команда');
  assert.ok(genuine.score>150);
});

test('recommendations combine favorites, viewing history and explicit live context', () => {
  const signals=buildPersonalContextSignals({
    favorites:[{teamId:5}],
    history:[{
      homeName:'Real Madrid',
      awayName:'Barcelona',
      leagueName:'La Liga',
    }],
  });

  const favorite=evaluatePersonalMatchInsight({
    home:{id:5,name:'Team Five'},
    away:{id:6,name:'Opponent'},
    league:'League',
    live:false,
    featured:false,
    interestScore:10,
    competition:{priority:1},
  },signals);
  assert.equal(favorite.favorite,true);
  assert.equal(favorite.reason,'Любимая команда');
  assert.equal(favorite.recommended,true);

  const viewed=evaluatePersonalMatchInsight({
    home:{id:10,name:'Real Madrid'},
    away:{id:11,name:'Other'},
    league:'La Liga',
    live:false,
    featured:false,
    interestScore:10,
    competition:{priority:1},
  },signals);
  assert.equal(viewed.viewedTeam,true);
  assert.equal(viewed.reason,'Вы смотрели эту команду');
  assert.equal(viewed.recommended,true);

  const live=evaluatePersonalMatchInsight({
    home:{id:20,name:'A'},
    away:{id:21,name:'B'},
    league:'Other',
    live:true,
    featured:false,
    interestScore:10,
    competition:{priority:1},
  },signals);
  assert.equal(live.reason,'Сейчас в эфире');
  assert.equal(live.recommended,true);
});

test('feed filtering uses strict live and identity evidence instead of JavaScript coercion', () => {
  const filtered=sourceBlock(app,'function filteredMatches()','function categoryLabel');
  assert.match(filtered,/positiveEntityId\(m\?\.home\?\.id\)/);
  assert.match(filtered,/if \(state\.filter === 'live'\) byFilter = m\?\.live === true/);
  assert.doesNotMatch(filtered,/if \(state\.filter === 'live'\) byFilter = Boolean\(m\.live\)/);
  assert.match(filtered,/typeof m\?\.category === 'string'/);
  assert.match(filtered,/\.filter\(v => typeof v === 'string'\)/);
});

test('recommendation reasons stay in ranking logic but off compact feed cards', () => {
  const ranking=readFileSync(
    new URL('../public/modules/personal-feed.js', import.meta.url),
    'utf8',
  );
  assert.match(ranking, /reason='Любимая команда'/);
  assert.match(ranking, /reason='Вы смотрели эту команду'/);
  assert.match(ranking, /reason='Сейчас в эфире'/);

  const card=app.slice(
    app.indexOf('function matchCardHtml'),
    app.indexOf('function bindMatchActions'),
  );
  assert.doesNotMatch(card, /favorite-signal|Почему здесь/);
});

test('AI history and admin-only data remain deferred after first public paint', () => {
  assert.match(app, /const tasks = \[loadHistory\(false\)\]/);
  assert.match(app, /tasks\.push\(loadProvider\(\)\)/);
  assert.match(app, /if \(!state\.remindersLoaded\) tasks\.push\(loadReminders\(\)\)/);
  assert.doesNotMatch(html, /profile-data-details/);
  assert.doesNotMatch(html, /id="dataModeSummary"/);
});

test('app delegates personal recommendation policy to the extracted fail-closed module', () => {
  assert.match(app,/buildPersonalContextSignals,/);
  assert.match(app,/evaluatePersonalMatchInsight,/);
  assert.match(app,/normalizePersonalSignalText,/);
  assert.match(
    app,
    /function personalContextSignals\(\) \{[\s\S]*buildPersonalContextSignals\(\{[\s\S]*favorites:state\.favorites,[\s\S]*history:state\.history/,
  );
  assert.match(
    app,
    /function personalMatchInsight\(match, signals = personalContextSignals\(\)\) \{[\s\S]*evaluatePersonalMatchInsight\(match,signals\)/,
  );
});
