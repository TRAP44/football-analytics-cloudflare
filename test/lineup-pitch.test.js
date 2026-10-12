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
  assert.doesNotMatch(module, /(?:^import|three\.js|getContext\(|<canvas)/im, 'no 3D libraries or canvas');
});

// Ревью #839: стартовый состав команды без сетки не пропадает; неполная сетка — не поле.
test('a team without grid keeps its starting XI as a list; partial grid never hides starters', () => {
  const gridless = { ...xi('4-4-2', 'Гость'), startXI: xi('4-4-2', 'Гость').startXI.map(p => ({ ...p, grid: '' })) };
  const html = lineupPitchViewHtml({ home: xi('4-3-3', 'Хозяин'), away: gridless }, match, { escapeHtml: esc });
  assert.equal((html.match(/class="lp-chip home"/g) || []).length, 11);
  assert.match(html, /Рома · стартовый состав/);
  assert.equal((html.match(/Гость /g) || []).length, 11, 'all 11 away starters are listed');
  assert.match(html, /Расстановки нет — состав списком ниже/);

  const partialGrid = xi('4-3-3');
  partialGrid.startXI = partialGrid.startXI.map((p, i) => (i >= 9 ? { ...p, grid: '' } : p));
  assert.equal(lineupFormationRows(partialGrid), null, '9 of 11 grids is not enough for the pitch');
  const both = lineupPitchViewHtml({ home: partialGrid, away: xi('4-4-2') }, match, { escapeHtml: esc });
  assert.match(both, /Милан · стартовый состав/);
  assert.equal((both.match(/class="lp-chip home"/g) || []).length, 0);
});

// Ревью #839: частичная сетка у обеих команд — списки, без прежнего «поля» с достроенными позициями.
test('partial grids on both sides render lists and never the legacy synthesized pitch', () => {
  const partial = prefix => {
    const lineup = xi('4-3-3', prefix);
    lineup.startXI = lineup.startXI.map((p, i) => (i >= 9 ? { ...p, grid: '' } : p));
    return lineup;
  };
  let fallbackCalls = 0;
  const html = lineupPitchViewHtml({ home: partial('Хозяин'), away: partial('Гость') }, match, { escapeHtml: esc, fallback: () => { fallbackCalls += 1; return 'LEGACY'; } });
  assert.equal(fallbackCalls, 0);
  assert.doesNotMatch(html, /lp-chip|LEGACY/);
  assert.match(html, /расстановку не для всех игроков/);
  assert.match(html, /Милан · стартовый состав/);
  assert.match(html, /Рома · стартовый состав/);
  assert.equal((html.match(/Хозяин /g) || []).length, 11);
});

test('without an escapeHtml dependency the view still escapes text', () => {
  const html = lineupPitchViewHtml({ home: xi('4-3-3', '<b>x</b>') }, { home: { name: '<i>Милан</i>' }, away: { name: 'Рома' } });
  assert.doesNotMatch(html, /<b>x<\/b>|<i>Милан<\/i>/);
  assert.match(html, /&lt;i&gt;Милан/);
});

test('codex #839: an XI the server downgraded to unconfirmed is labelled as such', () => {
  const home = { ...xi('4-3-3'), formation: '4-3-3', quality: { confirmed: false, partial: false } };
  const away = { ...xi('4-4-2', 'Гость'), formation: '4-4-2', quality: { confirmed: true, partial: false, startCount: 11 } };
  const html = lineupPitchViewHtml({ home, away }, match, { escapeHtml: esc });
  assert.match(html, /lp-status is-unconfirmed">состав не подтверждён/);
  assert.match(html, /lp-status">состав подтверждён/);
  assert.match(html, /Состав не подтверждён источником — показан как есть/);
  const confirmed = lineupPitchViewHtml({ home: { ...home, quality: { confirmed: true } }, away }, match, { escapeHtml: esc });
  assert.doesNotMatch(confirmed, /is-unconfirmed|Состав не подтверждён источником/);
});

test('codex #839: substitutes stay visible when no starting XI is published', () => {
  const lineups = { home: { startXI: [], substitutes: [{ name: 'Запасной Один', number: 12 }] }, away: { startXI: [], substitutes: [] } };
  const html = lineupPitchViewHtml(lineups, match, { escapeHtml: esc });
  assert.match(html, /lp-empty/);
  assert.match(html, /Милан · запасные · 1/);
  assert.match(html, /Запасной Один/);
  assert.doesNotMatch(lineupPitchViewHtml({ home: { startXI: [] }, away: { startXI: [] } }, match, { escapeHtml: esc }), /lp-benches/);
});
