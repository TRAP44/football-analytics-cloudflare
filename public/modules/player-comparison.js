const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const nullableNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const displayNumber = (value, digits = null) => {
  const number = nullableNumber(value);
  if (number === null) return '—';
  return digits === null ? String(number) : number.toFixed(digits);
};

const normalizeName = value => String(value || '').trim().toLowerCase();

export function playerIdentity(player = {}) {
  const id = Number(player?.data?.id || player?.id || 0);
  if (id > 0) return `id:${id}`;
  const teamId = Number(player?.team?.id || player?.teamId || 0);
  const name = normalizeName(player?.data?.name || player?.name || '');
  return name ? `name:${teamId}:${name}` : '';
}

export function samePlayer(left = {}, right = {}) {
  const a = playerIdentity(left);
  const b = playerIdentity(right);
  return Boolean(a && b && a === b);
}

export function playerPositionGroup(value = '') {
  const position = normalizeName(value);
  if (!position) return 'unknown';
  if (/(goal|keeper|врат)/.test(position) || position === 'g') return 'goalkeeper';
  if (/(def|back|защит)/.test(position) || position === 'd') return 'defender';
  if (/(mid|полузащит)/.test(position) || position === 'm') return 'midfielder';
  if (/(forward|attack|wing|striker|напад)/.test(position) || position === 'f') return 'attacker';
  return 'unknown';
}

function candidateFromMatch(item = {}, team = {}, match = {}, side = '') {
  return {
    data: { ...item },
    team: { ...team },
    match: { ...match },
    source: 'match_center',
    comparisonSide: side,
  };
}

function candidateFromSquad(item = {}, group = {}, team = {}, match = {}) {
  return {
    data: {
      id: item?.id,
      name: item?.name,
      photo: item?.photo || '',
      position: item?.position || '',
    },
    team: { ...team },
    match: { ...match },
    squadProfile: {
      found: true,
      group: String(group?.label || 'Состав'),
      age: nullableNumber(item?.age),
      number: nullableNumber(item?.number),
      position: item?.position || '',
      photo: item?.photo || '',
      stale: false,
      warning: '',
    },
    source: 'team_squad_cache',
  };
}

export function buildPlayerComparisonCandidates(primary = {}, { center = {}, squads = [] } = {}) {
  const candidates = [];
  const seen = new Set([playerIdentity(primary)].filter(Boolean));
  const match = center?.match || primary?.match || {};

  const add = candidate => {
    const key = playerIdentity(candidate);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  for (const side of ['home', 'away']) {
    const team = match?.[side] || {};
    for (const item of (center?.playerLeaders?.[side] || [])) {
      add(candidateFromMatch(item, team, match, side));
    }
  }

  for (const entry of squads || []) {
    const data = entry?.data || {};
    const team = entry?.team || primary?.team || {};
    for (const group of (data?.groups || [])) {
      for (const item of (group?.players || [])) {
        add(candidateFromSquad(item, group, team, match));
      }
    }
  }

  return candidates;
}

function profilePosition(player = {}) {
  return player?.squadProfile?.position || player?.data?.position || '';
}

function profileAge(player = {}) {
  return nullableNumber(player?.squadProfile?.age);
}

function seasonMetric(player = {}, key) {
  const stats = player?.seasonStats || {};
  if (!stats?.found) return null;
  return nullableNumber(stats[key]);
}

function matchMetric(player = {}, key) {
  const data = player?.data || {};
  return Object.prototype.hasOwnProperty.call(data, key) ? nullableNumber(data[key]) : null;
}

function metric(label, left, right, { leftSuffix = '', rightSuffix = '', leftDigits = null, rightDigits = null } = {}) {
  if (left === null && right === null) return null;
  const leftText = left === null ? '—' : `${displayNumber(left, leftDigits)}${leftSuffix}`;
  const rightText = right === null ? '—' : `${displayNumber(right, rightDigits)}${rightSuffix}`;
  return { label, left: leftText, right: rightText };
}

function textMetric(label, left, right) {
  if (!left && !right) return null;
  return { label, left: left || '—', right: right || '—' };
}

function compact(rows) {
  return rows.filter(Boolean);
}

function availabilityLabel(player = {}) {
  if (player?.seasonStats?.found && player?.seasonStats?.injured === true) return 'Есть отметка травмы';
  return '';
}

function coverageLabel(player = {}) {
  const stats = player?.seasonStats || {};
  if (stats.loading) return 'сезон загружается';
  if (stats.error) return 'сезон недоступен';
  if (!stats.found) return 'нет сезонной выборки';
  return stats.partial ? 'частичное покрытие' : 'сезонные данные';
}

export function buildPlayerComparisonModel(primary = {}, secondary = {}) {
  const leftPosition = profilePosition(primary);
  const rightPosition = profilePosition(secondary);
  const leftGroup = playerPositionGroup(leftPosition);
  const rightGroup = playerPositionGroup(rightPosition);
  const differentRoles = leftGroup !== 'unknown' && rightGroup !== 'unknown' && leftGroup !== rightGroup;

  const categories = [
    {
      id: 'attack',
      title: 'Атака',
      rows: compact([
        metric('Голы · сезон', seasonMetric(primary, 'goals'), seasonMetric(secondary, 'goals')),
        metric('Удары в створ · матч', matchMetric(primary, 'shotsOn'), matchMetric(secondary, 'shotsOn')),
      ]),
    },
    {
      id: 'creation',
      title: 'Созидание',
      rows: compact([
        metric('Ассисты · сезон', seasonMetric(primary, 'assists'), seasonMetric(secondary, 'assists')),
        metric('Ключевые передачи · сезон', seasonMetric(primary, 'keyPasses'), seasonMetric(secondary, 'keyPasses')),
        metric('Точность паса · сезон', seasonMetric(primary, 'passAccuracy'), seasonMetric(secondary, 'passAccuracy'), { leftSuffix: '%', rightSuffix: '%' }),
        metric('Ключевые передачи · матч', matchMetric(primary, 'keyPasses'), matchMetric(secondary, 'keyPasses')),
      ]),
    },
    {
      id: 'defense',
      title: 'Оборона',
      rows: compact([
        metric('Отборы · матч', matchMetric(primary, 'tackles'), matchMetric(secondary, 'tackles')),
        metric('Перехваты · матч', matchMetric(primary, 'interceptions'), matchMetric(secondary, 'interceptions')),
        metric('Сейвы · матч', matchMetric(primary, 'saves'), matchMetric(secondary, 'saves')),
      ]),
    },
    {
      id: 'form',
      title: 'Форма',
      rows: compact([
        metric('Рейтинг · сезон', seasonMetric(primary, 'rating'), seasonMetric(secondary, 'rating'), { leftDigits: 2, rightDigits: 2 }),
        metric('Рейтинг · матч', matchMetric(primary, 'rating'), matchMetric(secondary, 'rating'), { leftDigits: 1, rightDigits: 1 }),
        textMetric('Доступность', availabilityLabel(primary), availabilityLabel(secondary)),
      ]),
    },
    {
      id: 'playing-time',
      title: 'Игровое время',
      rows: compact([
        metric('Матчи · сезон', seasonMetric(primary, 'appearances'), seasonMetric(secondary, 'appearances')),
        metric('В старте · сезон', seasonMetric(primary, 'lineups'), seasonMetric(secondary, 'lineups')),
        metric('Минуты · сезон', seasonMetric(primary, 'minutes'), seasonMetric(secondary, 'minutes')),
        metric('Минуты · матч', matchMetric(primary, 'minutes'), matchMetric(secondary, 'minutes')),
      ]),
    },
  ].filter(category => category.rows.length);

  return {
    primary: {
      name: String(primary?.data?.name || 'Игрок 1'),
      team: String(primary?.team?.name || ''),
      position: String(leftPosition || ''),
      age: profileAge(primary),
      photo: String(primary?.squadProfile?.photo || primary?.data?.photo || ''),
      coverage: coverageLabel(primary),
    },
    secondary: {
      name: String(secondary?.data?.name || 'Игрок 2'),
      team: String(secondary?.team?.name || ''),
      position: String(rightPosition || ''),
      age: profileAge(secondary),
      photo: String(secondary?.squadProfile?.photo || secondary?.data?.photo || ''),
      coverage: coverageLabel(secondary),
    },
    differentRoles,
    categories,
  };
}

function playerHead(player, side) {
  const initial = esc(String(player.name || '?').trim().charAt(0).toUpperCase() || '•');
  return `<div class="player-comparison-head ${side}">
    <div class="player-comparison-avatar"><span aria-hidden="true">${initial}</span></div>
    <div>
      <strong>${esc(player.name)}</strong>
      <small>${esc([player.team, player.position, player.age === null ? '' : `${player.age} лет`].filter(Boolean).join(' · '))}</small>
      <em>${esc(player.coverage)}</em>
    </div>
  </div>`;
}

function comparisonRows(category) {
  return `<section class="player-comparison-category">
    <h4>${esc(category.title)}</h4>
    <div class="player-comparison-rows">
      ${category.rows.map(row => `<div class="player-comparison-row">
        <span class="player-comparison-label">${esc(row.label)}</span>
        <strong>${esc(row.left)}</strong>
        <strong>${esc(row.right)}</strong>
      </div>`).join('')}
    </div>
  </section>`;
}

function candidateList(candidates = []) {
  if (!candidates.length) return '<div class="empty compact-empty">В уже загруженных данных пока нет второго игрока. Дождитесь состава команды или откройте матч с доступной статистикой игроков.</div>';
  return `<div class="player-comparison-candidates">
    ${candidates.map((player, index) => `<button type="button" class="player-comparison-candidate" data-player-comparison-candidate="${index}">
      <span>${esc(player?.data?.name || 'Игрок')}</span>
      <small>${esc([player?.team?.name || '', player?.data?.position || player?.squadProfile?.position || ''].filter(Boolean).join(' · '))}</small>
    </button>`).join('')}
  </div>`;
}

export function playerComparisonHtml({ primary = {}, secondary = null, candidates = [], loading = false, error = '' } = {}) {
  if (!secondary) {
    return `<section class="panel player-comparison-panel" data-player-comparison-panel>
      <div class="center-section-title">
        <div><h2>Сравнение игроков</h2><p>Выберите второго игрока из уже доступного состава или данных матча</p></div>
        <button class="btn secondary compact-btn" type="button" data-player-comparison-close>Закрыть</button>
      </div>
      ${candidateList(candidates)}
      <p class="tiny">Сравнение не создаёт общий субъективный рейтинг и не подменяет отсутствующие показатели нулём.</p>
    </section>`;
  }

  const model = buildPlayerComparisonModel(primary, secondary);
  return `<section class="panel player-comparison-panel" data-player-comparison-panel>
    <div class="center-section-title">
      <div><h2>Сравнение игроков</h2><p>Показаны только реально доступные показатели</p></div>
      <button class="btn secondary compact-btn" type="button" data-player-comparison-change>Другой игрок</button>
    </div>
    <div class="player-comparison-heads">
      ${playerHead(model.primary, 'left')}
      ${playerHead(model.secondary, 'right')}
    </div>
    ${model.differentRoles ? '<div class="data-notice">Игроки разных ролей: показатели сгруппированы по контексту позиции. Атакующие метрики не используются как штраф для защитника или вратаря.</div>' : ''}
    ${loading ? '<div class="loader compact-loader">Уточняю уже доступные данные второго игрока…</div>' : ''}
    ${error ? `<div class="data-notice stale">⚠️ ${esc(error)} Уже загруженные показатели остаются доступными.</div>` : ''}
    <div class="player-comparison-categories">
      ${model.categories.length ? model.categories.map(comparisonRows).join('') : '<div class="empty compact-empty">Для этой пары пока нет общих доступных показателей.</div>'}
    </div>
    <p class="tiny">Источник и покрытие показаны отдельно для каждого игрока. Missing data остаётся пустым и не превращается в 0.</p>
  </section>`;
}
