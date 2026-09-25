import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFixtureAbsences } from '../src/availability.js';

test('RC134 classifies suspension even when provider type is generic', () => {
  const data = normalizeFixtureAbsences([
    {
      team: { id: 1 },
      player: { id: 10, name: 'A Player', type: 'Missing Fixture', reason: 'Suspended 3 matches' },
    },
  ], { homeId: 1, awayId: 2 });

  assert.equal(data.home.length, 1);
  assert.equal(data.home[0].category, 'suspension');
  assert.equal(data.home[0].status, 'reported_out');
  assert.equal(data.summary.home.suspension, 1);
});

test('RC134 distinguishes injuries, illness and doubtful wording', () => {
  const data = normalizeFixtureAbsences([
    { team:{id:1}, player:{id:11,name:'Injured',type:'Injury',reason:'Hamstring strain'} },
    { team:{id:1}, player:{id:12,name:'Ill',type:'Missing Fixture',reason:'Viral illness'} },
    { team:{id:2}, player:{id:13,name:'Doubt',type:'Injury',reason:'Doubtful - late fitness test'} },
  ], { homeId:1, awayId:2 });

  assert.equal(data.home[0].category, 'injury');
  assert.equal(data.home[1].category, 'illness');
  assert.equal(data.away[0].status, 'doubtful');
  assert.equal(data.summary.away.doubtful, 1);
});

test('RC134 deduplicates repeated provider rows for one player', () => {
  const data = normalizeFixtureAbsences([
    { team:{id:1}, player:{id:20,name:'Same Player',type:'Injury',reason:'Knee injury'} },
    { team:{id:1}, player:{id:20,name:'Same Player',type:'Missing Fixture',reason:'Knee injury'} },
  ], { homeId:1, awayId:2 });

  assert.equal(data.home.length, 1);
  assert.equal(data.home[0].duplicateCount, 2);
  assert.equal(data.summary.home.total, 1);
});

test('RC134 removes stale absence when exact player appears in published lineup', () => {
  const data = normalizeFixtureAbsences([
    { team:{id:1}, player:{id:30,name:'Recovered Player',type:'Injury',reason:'Ankle injury'} },
    { team:{id:1}, player:{id:31,name:'Still Out',type:'Suspension',reason:'Suspended'} },
  ], {
    homeId:1,
    awayId:2,
    lineups:{
      home:{
        startXI:[{id:30,name:'Recovered Player'}],
        substitutes:[],
      },
      away:null,
    },
  });

  assert.deepEqual(data.home.map(x=>x.name), ['Still Out']);
  assert.equal(data.resolvedByLineup.home.length, 1);
  assert.equal(data.resolvedByLineup.home[0].reconciliationReason, 'listed_in_published_lineup');
  assert.equal(data.summary.resolvedByLineup, 1);
});

test('RC134 can reconcile by normalized player name when provider id is absent', () => {
  const data = normalizeFixtureAbsences([
    { team:{id:2}, player:{name:'José Álvarez',type:'Injury',reason:'Muscle injury'} },
  ], {
    homeId:1,
    awayId:2,
    lineups:{
      away:{
        startXI:[],
        substitutes:[{id:99,name:'Jose Alvarez'}],
      },
    },
  });

  assert.equal(data.away.length, 0);
  assert.equal(data.resolvedByLineup.away.length, 1);
});


const worker = fs.readFileSync('src/worker.js', 'utf8');

test('RC134 both Match Center and AI analysis reconcile absences against lineups', () => {
  assert.match(worker, /const absences = formatAbsences\(injuryRows, homeId, awayId, lineups\)/);
  assert.match(worker, /const absences = enrichFixtureAbsencesWithSeasonRole\(formatAbsences\(injuries, homeId, awayId, lineups\), \{ homePlayerStats, awayPlayerStats \}\)/);
  assert.match(worker, /return normalizeFixtureAbsences\(rows, \{ homeId, awayId, lineups \}\)/);
});

test('RC134 doubtful players have reduced model adjustment instead of full confirmed-out weight', () => {
  assert.match(worker, /row\?\.status === 'doubtful' \? 0\.5 : 1/);
  assert.match(worker, /absenceAdjustmentUnits\(absences\?\.home\)/);
  assert.match(worker, /absenceAdjustmentUnits\(absences\?\.away\)/);
});

test('RC134 lineup impact exposes injuries, suspensions, doubts and reconciled rows separately', () => {
  assert.match(worker, /categories:\{home:\{injuryOrIllness:hi,suspension:hs,doubtful:hd\}/);
  assert.match(worker, /resolvedByLineup:reconciled/);
  assert.match(worker, /дисквалификации \$\{hs\}:\$\{as\}/);
  assert.doesNotMatch(worker, /Баланс подтверждённых потерь близкий/);
});


const app = fs.readFileSync('public/app.js', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');

test('RC134 Match Center renders structured absence categories and doubt status', () => {
  assert.match(app, /function absenceKindLabel\(row = \{\}\)/);
  assert.match(app, /Дисквалификация/);
  assert.match(app, /Под вопросом/);
  assert.match(app, /Травмы, болезни, дисквалификации и сомнения по данным источника/);
  assert.match(app, /Сверка с опубликованными составами сняла устаревших отметок/);
});

test('RC134 analysis and Match Center copy no longer overstates provider absences as confirmed', () => {
  assert.doesNotMatch(app, /Подтверждённые недоступные игроки/);
  assert.doesNotMatch(app, /Нет подтверждённых данных\./);
  assert.match(app, /Активных отметок о потерях нет или данные недоступны/);
});

test('RC134 UI has distinct category badges without introducing a new API request', () => {
  assert.match(styles, /\.absence-kind\.suspension/);
  assert.match(styles, /\.absence-kind\.injury/);
  assert.match(styles, /\.absence-kind\.illness/);
  const start=app.indexOf('function liveAbsencesHtml');
  const end=app.indexOf('function centerStatNumber',start);
  const helper=app.slice(start,end);
  assert.doesNotMatch(helper,/\bapi\s*\(/);
  assert.doesNotMatch(helper,/fetch\s*\(/);
});


test('RC134 feature remains part of the RC136 release health contract', () => {
  assert.match(worker, /structuredAvailability: 'enabled'/);
  assert.match(worker, /const APP_VERSION = '6\.112\.0-rc136'/);
  assert.match(worker, /const RC_NAME = 'RC135'/);
  assert.match(app, /const CLIENT_VERSION = '6\.112\.0-rc136'/);
});
