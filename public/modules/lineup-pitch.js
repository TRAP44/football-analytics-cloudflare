// Задача 4: экран составов — 2.5D поле без WebGL и 3D-библиотек.
// Обе команды на одном поле: хозяева снизу (вратарь у нижних ворот), гости
// сверху. Перспектива — расчётом координат (верх поля уже, фишки меньше), а не
// 3D-трансформацией: текст не искажается, а вёрстка остаётся дешёвой.
// Показываются только составы из данных матча: «вероятных» составов нет.

const ROLE_LABELS = Object.freeze({ G: 'вратарь', D: 'защитник', M: 'полузащитник', F: 'нападающий' });
const NEAR_WIDTH = 1;
const FAR_WIDTH = 0.8;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function playerName(player) {
  return typeof player === 'string' ? player : String(player?.name || 'Игрок');
}

function playerNumber(player) {
  if (!player || typeof player !== 'object') return '';
  const number = finite(player.number);
  return number !== null && number > 0 && number < 1000 ? String(Math.round(number)) : '';
}

function surname(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || 'Игрок');
}

function gridOf(player) {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(String(player?.grid || '').trim());
  return match ? { row: Number(match[1]), col: Number(match[2]) } : null;
}

/** Разбор расстановки: строки по grid «ряд:позиция»; null — данных для поля мало. */
export function lineupFormationRows(lineup) {
  const players = Array.isArray(lineup?.startXI) ? lineup.startXI.slice(0, 11) : [];
  const placed = players.map(player => ({ player, grid: gridOf(player) })).filter(row => row.grid);
  if (players.length < 8 || placed.length < 8) return null;
  const rows = new Map();
  for (const { player, grid } of placed) {
    if (!rows.has(grid.row)) rows.set(grid.row, []);
    rows.get(grid.row).push({ player, col: grid.col });
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, items]) => ({ row, players: items.sort((a, b) => a.col - b.col).map(item => item.player) }));
}

// Точка на плоском поле (0–100 по ширине, 0–100 по длине, 0 — дальние ворота)
// → точка на трапеции с перспективой.
function project(x, y) {
  const width = FAR_WIDTH + (NEAR_WIDTH - FAR_WIDTH) * (y / 100);
  return { x: 50 + (x - 50) * width, y: 4 + y * 0.92, scale: 0.86 + 0.14 * (y / 100) };
}

/** Координаты фишек одной команды. side: home — нижняя половина, away — верхняя. */
export function lineupPositions(rows, side) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const lines = rows.length;
  const out = [];
  rows.forEach((line, lineIndex) => {
    // Вратарь у своих ворот, нападающие ближе к центру.
    const depth = lines === 1 ? 0 : lineIndex / (lines - 1);
    const fromGoal = 6 + depth * 38;
    const y = side === 'home' ? 100 - fromGoal : fromGoal;
    const count = line.players.length;
    line.players.forEach((player, index) => {
      const spread = count === 1 ? 0 : (index / (count - 1)) * 2 - 1;
      // Гости смотрят на нас: их «левый» край — справа на экране.
      const xFlat = 50 + spread * Math.min(40, 13 + count * 6.5) * (side === 'home' ? 1 : -1);
      out.push({ player, ...project(xFlat, y) });
    });
  });
  return out;
}

function fieldSvg() {
  const p = (x, y) => { const point = project(x, y); return `${point.x.toFixed(2)},${point.y.toFixed(2)}`; };
  const line = (x1, y1, x2, y2) => `<line x1="${project(x1, y1).x.toFixed(2)}" y1="${project(x1, y1).y.toFixed(2)}" x2="${project(x2, y2).x.toFixed(2)}" y2="${project(x2, y2).y.toFixed(2)}"/>`;
  const box = (x1, y1, x2, y2) => `<polygon points="${p(x1, y1)} ${p(x2, y1)} ${p(x2, y2)} ${p(x1, y2)}"/>`;
  const stripes = Array.from({ length: 10 }, (_, i) => i % 2 ? '' : `<polygon class="lp-stripe" points="${p(0, i * 10)} ${p(100, i * 10)} ${p(100, i * 10 + 10)} ${p(0, i * 10 + 10)}"/>`).join('');
  const center = project(50, 50);
  return `<svg class="lp-field" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <polygon class="lp-grass" points="${p(0, 0)} ${p(100, 0)} ${p(100, 100)} ${p(0, 100)}"/>
    ${stripes}
    <g class="lp-lines">
      <polygon points="${p(0, 0)} ${p(100, 0)} ${p(100, 100)} ${p(0, 100)}"/>
      ${line(0, 50, 100, 50)}
      <ellipse cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" rx="${(12 * (FAR_WIDTH + NEAR_WIDTH) / 2).toFixed(2)}" ry="7.2"/>
      ${box(22, 0, 78, 15)}${box(36, 0, 64, 5.5)}
      ${box(22, 85, 78, 100)}${box(36, 94.5, 64, 100)}
    </g>
  </svg>`;
}

function chipHtml({ player, x, y, scale }, side, escapeHtml) {
  const number = playerNumber(player);
  const name = playerName(player);
  const role = ROLE_LABELS[String(player?.pos || '').toUpperCase()] || '';
  const label = `${number ? `№${number} ` : ''}${name}${role ? `, ${role}` : ''}`;
  return `<li class="lp-chip ${side}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--lp-scale:${scale.toFixed(3)}" aria-label="${escapeHtml(label)}">
    <b aria-hidden="true">${escapeHtml(number || '•')}</b><span aria-hidden="true">${escapeHtml(surname(name))}</span>
  </li>`;
}

function teamMetaHtml(lineup, name, side, escapeHtml) {
  const formation = String(lineup?.formation || '').trim();
  const coach = String(lineup?.coach || '').trim();
  return `<div class="lp-team ${side}"><i aria-hidden="true"></i><b>${escapeHtml(name)}</b><span>${escapeHtml([formation || 'схема —', coach ? `тренер ${coach}` : ''].filter(Boolean).join(' · '))}</span></div>`;
}

function benchHtml(lineup, name, escapeHtml) {
  const subs = Array.isArray(lineup?.substitutes) ? lineup.substitutes.slice(0, 23) : [];
  return `<details class="lp-bench"><summary>${escapeHtml(name)} · запасные · ${subs.length}</summary>
    ${subs.length
      ? `<ul>${subs.map(player => `<li><b>${escapeHtml(playerNumber(player) || '•')}</b>${escapeHtml(playerName(player))}</li>`).join('')}</ul>`
      : '<p>Запасные в данных не указаны.</p>'}
  </details>`;
}

function emptyText(match = {}) {
  const kickoff = Date.parse(match?.date || '');
  if (match?.finished) return 'Источник не передал составы этого матча.';
  if (match?.live) return 'Источник пока не передал составы этого матча.';
  if (Number.isFinite(kickoff) && kickoff - Date.now() > 70 * 60_000) {
    return 'Составы пока не объявлены — обычно их публикуют примерно за час до начала.';
  }
  return 'Составы пока не объявлены.';
}

/**
 * Экран составов. fallback(lineups, match) — прежний список, если у обеих
 * команд нет расстановки по сетке.
 */
export function lineupPitchViewHtml(lineups, match = {}, { escapeHtml, fallback } = {}) {
  const esc = typeof escapeHtml === 'function' ? escapeHtml : value => String(value);
  const home = lineups?.home && typeof lineups.home === 'object' ? lineups.home : null;
  const away = lineups?.away && typeof lineups.away === 'object' ? lineups.away : null;
  const homeName = String(match?.home?.name || 'Хозяева');
  const awayName = String(match?.away?.name || 'Гости');
  if (!home?.startXI?.length && !away?.startXI?.length) {
    return `<div class="empty compact-empty lp-empty">${esc(emptyText(match))}</div>`;
  }
  const homeRows = lineupFormationRows(home);
  const awayRows = lineupFormationRows(away);
  if (!homeRows && !awayRows) return typeof fallback === 'function' ? fallback(lineups, match) : '';

  const chips = [
    ...lineupPositions(awayRows, 'away').map(pos => chipHtml(pos, 'away', esc)),
    ...lineupPositions(homeRows, 'home').map(pos => chipHtml(pos, 'home', esc)),
  ].join('');
  const missingHalf = (rows, lineup, side) => (rows ? '' : `<p class="lp-half-note ${side}">${esc(lineup?.startXI?.length ? 'Расстановка этой команды не передана' : 'Состав этой команды пока не объявлен')}</p>`);
  const partial = [home, away].some(lineup => lineup?.quality?.partial);
  return `<div class="lp-view">
    ${teamMetaHtml(away, awayName, 'away', esc)}
    <figure class="lp-pitch" aria-label="${esc(`Расстановка: ${awayName} сверху, ${homeName} снизу`)}">
      ${fieldSvg()}
      <ul class="lp-chips">${chips}</ul>
      ${missingHalf(awayRows, away, 'away')}${missingHalf(homeRows, home, 'home')}
    </figure>
    ${teamMetaHtml(home, homeName, 'home', esc)}
    ${partial ? '<p class="data-notice">⚠️ Источник передал неполный стартовый состав — он не считается подтверждённым.</p>' : ''}
    <div class="lp-benches">${benchHtml(home, homeName, esc)}${benchHtml(away, awayName, esc)}</div>
  </div>`;
}
