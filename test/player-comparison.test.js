import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPlayerComparisonCandidates,
  buildPlayerComparisonModel,
  playerComparisonHtml,
  samePlayer,
  playerPositionGroup,
} from '../public/modules/player-comparison.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

const primary = {
  data: { id: 1, name: 'Очень длинное имя основного игрока для мобильного экрана', position: 'Forward', rating: 7.4, shotsOn: 3 },
  team: { id: 10, name: 'Alpha FC' },
  match: { leagueId: 39, season: 2026, home:{ id:10, name:'Alpha FC' }, away:{ id:20, name:'Beta FC' } },
  squadProfile: { found:true, age:24, position:'Forward' },
  seasonStats: { found:true, appearances:8, lineups:7, minutes:650, goals:5, assists:2, rating:7.21, keyPasses:11, passAccuracy:82, partial:false, sourceLabel:'api-football' },
};

test('Player Comparison rejects selecting the same player twice and de-duplicates candidates', () => {
  assert.equal(samePlayer(primary, { data:{ id:1, name:'Duplicate' }, team:{ id:10 } }), true);
  const candidates = buildPlayerComparisonCandidates(primary, {
    center: {
      match: primary.match,
      playerLeaders: {
        home: [primary.data, { id:2, name:'Second', position:'Midfielder' }],
        away: [{ id:3, name:'Third', position:'Defender' }],
      },
    },
  });
  assert.deepEqual(candidates.map(x => x.data.id), [2, 3]);
});

test('Player Comparison keeps different positions contextual without an overall score', () => {
  const secondary = {
    data: { id:3, name:'Defender', position:'Defender', tackles:5, interceptions:4, rating:7.1 },
    team: { id:20, name:'Beta FC' },
    match: primary.match,
    squadProfile: { found:true, age:29, position:'Defender' },
    seasonStats: { found:true, appearances:9, lineups:9, minutes:810, goals:0, assists:1, rating:7.08, partial:true, sourceLabel:'football-data' },
  };
  const model = buildPlayerComparisonModel(primary, secondary);
  assert.equal(model.differentRoles, true);
  assert.ok(model.categories.some(x => x.id === 'attack'));
  assert.ok(model.categories.some(x => x.id === 'defense'));
  const html = playerComparisonHtml({ primary, secondary });
  assert.match(html, /Игроки разных ролей/);
  assert.doesNotMatch(html, /общий рейтинг|Player A =|Player B =|победител/i);
});

test('Player Comparison omits metrics missing for both players and never turns missing into zero', () => {
  const a = { data:{ id:4, name:'A' }, team:{ id:10 }, seasonStats:{ found:true, appearances:null, goals:null, assists:null } };
  const b = { data:{ id:5, name:'B' }, team:{ id:10 }, seasonStats:{ found:true, appearances:null, goals:null, assists:null } };
  const model = buildPlayerComparisonModel(a, b);
  assert.equal(model.categories.length, 0);
  const html = playerComparisonHtml({ primary:a, secondary:b });
  assert.match(html, /нет общих доступных показателей/i);
  assert.doesNotMatch(html, />0</);
});

test('Player Comparison remains useful without season stats and with unavailable images', () => {
  const secondary = {
    data: { id:6, name:'No Season', position:'Goalkeeper', saves:6, photo:'' },
    team: { id:20, name:'Beta FC' },
    seasonStats: { found:false, reason:'quota_guard' },
  };
  const html = playerComparisonHtml({ primary:{ ...primary, seasonStats:{ found:false } }, secondary });
  assert.match(html, /нет сезонной выборки/);
  assert.match(html, /Сейвы · матч/);
  assert.match(html, /player-comparison-avatar/);
});

test('Player Comparison integration reuses squad and Team Intelligence caches with fail-soft provider handling', () => {
  assert.match(app, /state\.teamSquadCache\.get\(String\(teamId\)\)/);
  assert.match(app, /state\.teamIntelligenceCache\.get\(intelligenceKey\)/);
  assert.match(app, /\/api\/team\/squad\?teamId=\$\{teamId\}/);
  assert.match(app, /\/api\/team\/intelligence\?\$\{q\.toString\(\)\}/);
  assert.match(app, /comparison\.error = friendlyErrorMessage\(error\)/);
  assert.doesNotMatch(app.slice(app.indexOf('async function hydrateComparisonPlayer'), app.indexOf('function renderPlayerHub')), /\/api\/player|\/players\?/);
});

test('Player Comparison is mobile-first with no horizontal overflow and long-name wrapping', () => {
  assert.match(styles, /Player Comparison/);
  assert.match(styles, /\.player-comparison-panel\s*\{[^}]*min-width:\s*0/s);
  assert.match(styles, /\.player-comparison-head strong\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*\.player-comparison-heads/);
  assert.match(styles, /\.player-comparison-row\s*\{[^}]*min-width:\s*0/s);
  assert.doesNotMatch(styles.slice(styles.indexOf('/* Player Comparison */')), /overflow-x:\s*(auto|scroll)/);
});



test('Player Comparison identifies fallback names per team and normalizes role labels', () => {
  assert.equal(samePlayer(
    { data:{ name:'  Alex Silva ' },team:{id:10}},
    { data:{ name:'alex silva'},team:{id:10}},
  ),true);
  assert.equal(samePlayer(
    { data:{ name:'Alex Silva'},team:{id:10}},
    { data:{ name:'Alex Silva'},team:{id:20}},
  ),false);
  assert.equal(samePlayer({ data:{name:''} },{data:{name:''}}),false);
  for(const [position,expected] of [
    ['Goalkeeper','goalkeeper'],
    ['Вратарь','goalkeeper'],
    ['Defender','defender'],
    ['Midfielder','midfielder'],
    ['Forward','attacker'],
    ['','unknown'],
  ]) assert.equal(playerPositionGroup(position),expected,position);
});

test('Player Comparison de-duplicates cached squad and match candidates without losing the preferred match source', () => {
  const candidates=buildPlayerComparisonCandidates(primary,{
    center:{match:primary.match,playerLeaders:{
      home:[{id:2,name:'Second'},{id:2,name:'Repeated'}],
      away:[{id:3,name:'Third'}],
    }},
    squads:[{
      team:{id:10,name:'Alpha FC'},
      data:{groups:[{label:'Main',players:[
        {id:2,name:'Second from squad'},
        {id:4,name:'Fourth'},
        {id:1,name:'Primary'},
        {id:4,name:'Repeated Fourth'},
      ]}]},
    }],
  });
  assert.deepEqual(candidates.map(player=>player.data.id),[2,3,4]);
  assert.equal(candidates[0].source,'match_center');
  assert.equal(candidates[2].source,'team_squad_cache');
  assert.equal(candidates[2].squadProfile.group,'Main');
});

test('Player Comparison preserves legitimate zero values while leaving unavailable values blank', () => {
  const a={ data:{id:4,name:'A',shotsOn:0},team:{id:10},seasonStats:{found:true,goals:0,assists:null}};
  const b={ data:{id:5,name:'B'},team:{id:20},seasonStats:{found:true,goals:null,assists:null}};
  const model=buildPlayerComparisonModel(a,b);
  const attack=model.categories.find(category=>category.id==='attack');
  const goals=attack.rows.find(row=>row.label==='Голы · сезон');
  const shots=attack.rows.find(row=>row.label==='Удары в створ · матч');
  assert.deepEqual({left:goals.left,right:goals.right},{left:'0',right:'—'});
  assert.deepEqual({left:shots.left,right:shots.right},{left:'0',right:'—'});
  assert.ok(!model.categories.some(category=>category.rows.some(row=>row.label==='Ассисты · сезон')));
});

test('Player Comparison escapes player names, candidate metadata and provider error messages', () => {
  const malicious='<img src=x onerror=alert(1)>';
  const html=playerComparisonHtml({
    primary:{data:{id:1,name:malicious},team:{id:10,name:'A & B'}},
    secondary:{data:{id:2,name:'B'},team:{id:20,name:'C'}},
    error:'<script>alert(1)</script>',
  });
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html,/A &amp; B/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|<img src=x/);
  const selection=playerComparisonHtml({candidates:[{data:{name:malicious},team:{name:'A & B'}}]});
  assert.match(selection,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(selection,/A &amp; B/);
  assert.doesNotMatch(selection,/<img src=x/);
});

test('Player Comparison presents the empty candidate and loading states without fabricated metrics', () => {
  const noCandidates=playerComparisonHtml({});
  assert.match(noCandidates,/нет второго игрока/);
  assert.match(noCandidates,/data-player-comparison-close/);
  assert.doesNotMatch(noCandidates,/player-comparison-row/);
  const loading=playerComparisonHtml({
    primary:{data:{id:1,name:'A'}},secondary:{data:{id:2,name:'B'}},loading:true,
  });
  assert.match(loading,/Уточняю уже доступные данные/);
  assert.match(loading,/нет общих доступных показателей/);
  assert.doesNotMatch(loading,/общий рейтинг победителя/i);
});
