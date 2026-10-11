import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lineupFormationRows, lineupPitchViewHtml, lineupPositions } from '../public/modules/lineup-pitch.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function xi(formation, prefix = 'Игрок') {
  const rows = formation.split('-').map(Number);
  const players = [{ name: `${prefix} Вратарь`, number: 1, pos: 'G', grid: '1:1' }];
  let n = 2;
  rows.forEach((count, r) => { for (let c = 1; c <= count; c += 1) players.push({ name: `${prefix} ${n}`, number: n++, pos: r === 0 ? 'D' : r === rows.length - 1 ? 'F' : 'M', grid: `${r + 2}:${c}` }); });
  return { formation, coach: 'Тренер', startXI: players, substitutes: [{ name: 'Запасной', number: 23 }] };
}

const match = { home: { name: 'Милан' }, away: { name: 'Рома' } };

test('formation rows come from the source grid, goalkeeper first', () => {
  const rows = lineupFormationRows(xi('4-2-3-1'));
  assert.deepEqual(rows.map(row => row.players.length), [1, 4, 2, 3, 1]);
  assert.equal(rows[0].players[0].pos, 'G');
  assert.equal(lineupFormationRows({ startXI: xi('4-3-3').startXI.map(p => ({ ...p, grid: '' })) }), null, 'no grid — no invented positions');
  assert.equal(lineupFormationRows({ startXI: xi('4-3-3').startXI.slice(0, 6) }), null);
  assert.equal(lineupFormationRows(null), null);
});

test('home defends the bottom goal, away the top; away is mirrored and the far side is narrower', () => {
  const home = lineupPositions(lineupFormationRows(xi('4-3-3')), 'home');
  const away = lineupPositions(lineupFormationRows(xi('4-3-3')), 'away');
  assert.equal(home.length, 11);
  assert.ok(home[0].y > 90 && away[0].y < 12, 'goalkeepers at their own goals');
  assert.ok(home.every(p => p.y > 50) && away.every(p => p.y < 50));
  const homeBack = home.slice(1, 5).map(p => p.x);
  const awayBack = away.slice(1, 5).map(p => p.x);
  assert.ok(homeBack[0] < homeBack[3] && awayBack[0] > awayBack[3], 'away team faces the viewer');
  const spread = list => Math.max(...list) - Math.min(...list);
  assert.ok(spread(awayBack) < spread(homeBack), 'perspective: the far half is narrower');
  assert.ok(away[0].scale < home[0].scale);
});

test('pitch view: both teams, roles for screen readers, benches, escaping', () => {
  const lineups = { home: xi('4-3-3', 'Хозяин'), away: xi('4-2-3-1', '<img src=x>') };
  const html = lineupPitchViewHtml(lineups, match, { escapeHtml: esc });
  assert.equal((html.match(/class="lp-chip home"/g) || []).length, 11);
  assert.equal((html.match(/class="lp-chip away"/g) || []).length, 11);
  assert.match(html, /aria-label="№1 Хозяин Вратарь, вратарь"/);
  assert.match(html, /4-2-3-1 · тренер Тренер/);
  assert.match(html, /Милан · запасные · 1/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /вероятн|ставк|коэффициент/i);
});

test('honest states: not announced yet, one team only, no grid falls back to the list', () => {
  const soon = lineupPitchViewHtml(null, { ...match, date: new Date(Date.now() + 3 * 3600_000).toISOString() }, { escapeHtml: esc });
  assert.match(soon, /Составы пока не объявлены — обычно их публикуют примерно за час до начала/);
  assert.match(lineupPitchViewHtml({}, { ...match, finished: true }, { escapeHtml: esc }), /Источник не передал составы/);
  const oneTeam = lineupPitchViewHtml({ home: xi('4-4-2') }, match, { escapeHtml: esc });
  assert.equal((oneTeam.match(/class="lp-chip home"/g) || []).length, 11);
  assert.equal((oneTeam.match(/class="lp-chip away"/g) || []).length, 0);
  assert.match(oneTeam, /Состав этой команды пока не объявлен/);
  const noGrid = { home: { ...xi('4-4-2'), startXI: xi('4-4-2').startXI.map(p => ({ ...p, grid: '' })) } };
  assert.equal(lineupPitchViewHtml(noGrid, match, { escapeHtml: esc, fallback: () => 'LIST' }), 'LIST');
});

test('match center lineups tab uses the pitch view with the list as fallback', () => {
  const view = fs.readFileSync('public/modules/match-center-view.js', 'utf8');
  assert.match(view, /import \{ lineupPitchViewHtml \} from '\.\/lineup-pitch\.js';/);
  assert.match(view, /lineupPitchViewHtml\(d\.lineups, \{\.\.\.m,live,finished\}, \{ escapeHtml, fallback: lineupLiveHtml \}\)/);
  const module = fs.readFileSync('public/modules/lineup-pitch.js', 'utf8');
  assert.doesNotMatch(module, /^import|three\.js|getContext\(|<canvas/im, 'no 3D libraries or canvas');
});
