import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPlayerComparisonCandidates,
  buildPlayerComparisonModel,
  playerComparisonHtml,
  samePlayer,
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
