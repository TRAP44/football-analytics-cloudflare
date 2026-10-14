// «Обыграй AI»: прогноз 1/X/2 до начала матча (Штаб матча, вкладка ✦ AI)
// и таблица лидеров за 30 дней (Профиль). Все цифры — только из ответа сервера.
// Без денег и ставочных слов: очки — за угаданный исход.

import { aiGuessedCardModel, shareAiGuessedCard } from './ai-guessed-card.js';

const OUTCOMES = ['home', 'draw', 'away'];

function outcome(value) {
  return OUTCOMES.includes(value) ? value : null;
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

export function outcomeLabel(value, match = {}) {
  if (value === 'home') return String(match.homeName || 'Хозяева');
  if (value === 'away') return String(match.awayName || 'Гости');
  if (value === 'draw') return 'Ничья';
  return '';
}

function pointText(point) {
  return point === 1 ? '+1' : '0';
}

/** Карточка прогноза в Штабе матча. data — ответ GET/POST /api/match-pick. */
export function matchPickHtml(data, match, escapeHtml) {
  if (!data || data.available !== true) return '';
  const pick = outcome(data.pick);
  const ai = outcome(data.ai);
  const label = value => escapeHtml(outcomeLabel(value, match));
  const head = '<div class="match-explanation-head"><span>🎯 Обыграй AI</span><small>1 очко за угаданный исход</small></div>';
  const result = data.result && outcome(data.result.actual) ? data.result : null;
  if (result) {
    const user = pick
      ? `Вы: ${label(pick)} · <b>${pointText(result.userPoint)}</b>`
      : 'Вы не сделали прогноз';
    const card = aiGuessedCardModel(data);
    const cardButton = card ? `<button type="button" class="match-question-chip beat-ai-card-btn" data-beat-card>📸 Карточка «${escapeHtml(card.headline)}»</button>` : '';
    return `${head}<p class="beat-ai-line">Итог: <b>${label(result.actual)}</b></p>
      <p class="beat-ai-line">${user}</p>
      <p class="beat-ai-line">AI: ${label(ai)} · <b>${pointText(result.aiPoint)}</b></p>
      ${cardButton}
      <p class="match-explanation-note">Таблица лидеров — в Профиле.</p>`;
  }
  if (data.verifying === true) {
    return `${head}<p class="beat-ai-line">Матч завершён — итог проверяется, очки появятся после проверки.</p>
      <p class="beat-ai-line">${pick ? `Ваш прогноз: <b>${label(pick)}</b>` : 'Вы не сделали прогноз.'}</p>
      <p class="beat-ai-line">AI: <b>${label(ai)}</b></p>`;
  }
  if (!data.open) {
    return `${head}<p class="beat-ai-line">Матч начался — прогнозы закрыты, ждём итог.</p>
      <p class="beat-ai-line">${pick ? `Ваш прогноз: <b>${label(pick)}</b>` : 'Вы не сделали прогноз.'}</p>
      <p class="beat-ai-line">AI: <b>${label(ai)}</b></p>`;
  }
  const buttons = OUTCOMES.map(value => `<button type="button" class="match-question-chip beat-ai-chip" data-beat-pick="${value}" aria-pressed="${pick === value ? 'true' : 'false'}">${label(value)}</button>`).join('');
  const status = pick
    ? `<p class="beat-ai-line">Ваш прогноз: <b>${label(pick)}</b> · AI: <b>${label(ai)}</b>. Изменить можно до начала матча.</p>`
    : '<p class="beat-ai-line">AI уже сделал выбор. Ваш ход — кто победит?</p>';
  return `${head}<div class="match-question-presets beat-ai-picks" role="group" aria-label="Ваш прогноз на матч">${buttons}</div>
    ${status}
    <p class="match-explanation-note">Игра на очки, без денег. Таблица лидеров — в Профиле.</p>`;
}

const PICK_ERRORS = Object.freeze({
  PICK_LOCKED: 'Матч уже начался — прогноз больше не меняется.',
  NO_MODEL_PREDICTION: 'В этом матче AI не делал прогноз — сыграть не получится.',
});

export function mountMatchPick({ root, fixtureId, match = {}, api, escapeHtml, isCurrent = () => true, toast = () => {} } = {}) {
  const id = Number(fixtureId);
  if (!root || !Number.isSafeInteger(id) || id <= 0 || typeof api !== 'function') return false;
  let busy = false;
  const stillHere = () => isCurrent() && root.isConnected && Number(root.dataset.fixture) === id;

  function render(data, note = '') {
    const html = matchPickHtml(data, match, escapeHtml);
    if (!html) {
      root.hidden = true;
      root.innerHTML = '';
      return;
    }
    root.innerHTML = `${html}${note ? `<p class="beat-ai-line beat-ai-error" role="status">${escapeHtml(note)}</p>` : ''}`;
    root.hidden = false;
    root.querySelectorAll('[data-beat-pick]').forEach(button => {
      button.addEventListener('click', () => save(button.dataset.beatPick, data));
    });
    root.querySelector('[data-beat-card]')?.addEventListener('click', event => {
      const button = event.currentTarget;
      button.disabled = true;
      shareAiGuessedCard(data, { toast }).finally(() => { button.disabled = false; });
    });
  }

  async function save(pick, previous) {
    if (busy || !outcome(pick)) return;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    let data = previous;
    let note = '';
    try {
      data = await api('/api/match-pick', { method: 'POST', body: JSON.stringify({ fixtureId: id, pick }), retry: false, timeoutMs: 8000 });
    } catch (error) {
      const payload = error?.payload && typeof error.payload === 'object' ? error.payload : {};
      if (payload.available === true) data = payload;
      note = PICK_ERRORS[payload.code] || 'Не удалось сохранить прогноз. Попробуйте ещё раз.';
    }
    busy = false;
    root.removeAttribute('aria-busy');
    if (stillHere()) render(data, note);
  }

  (async () => {
    let data = null;
    try {
      data = await api(`/api/match-pick?fixtureId=${id}`, { retry: false, timeoutMs: 8000 });
    } catch {
      data = null;
    }
    if (stillHere()) render(data);
  })();
  return true;
}

/** Таблица лидеров в Профиле. data — ответ GET /api/picks-leaderboard. */
export function picksLeaderboardHtml(data, escapeHtml) {
  const head = '<div class="match-explanation-head"><span>🎯 Соревнуйся с AI</span><small>Последние 30 дней</small></div>';
  if (!data || data.available !== true) {
    return `${head}<p class="beat-ai-line">Таблица временно недоступна.</p>`;
  }
  const me = data.me && typeof data.me === 'object' ? data.me : {};
  const played = nonNegative(me.played);
  const pending = nonNegative(me.pending);
  const mine = played
    ? `<p class="beat-ai-line">Ваши очки: <b>${nonNegative(me.points)}</b> из ${played} · AI на тех же матчах: <b>${nonNegative(me.aiPoints)}</b>${Number.isSafeInteger(me.rank) && me.rank > 0 ? ` · место ${me.rank}` : ''}</p>`
    : '<p class="beat-ai-intro">Кто точнее предскажет исход — ты или AI?</p>';
  const waiting = pending ? `<p class="beat-ai-line">Ожидают итога: ${pending}</p>` : '';
  const rows = (Array.isArray(data.top) ? data.top : []).slice(0, 10)
    .filter(row => row && typeof row === 'object')
    .map(row => `<li class="${row.me === true ? 'is-me' : ''}"><span class="beat-ai-rank">${nonNegative(row.rank)}</span><span class="beat-ai-name">${escapeHtml(String(row.name || 'Игрок').slice(0, 32))}</span><span class="beat-ai-points">${nonNegative(row.points)} из ${nonNegative(row.played)}</span></li>`)
    .join('');
  const table = rows
    ? `<ol class="beat-ai-board-list" aria-label="Таблица лидеров">${rows}</ol>`
    : (played || pending ? '<p class="beat-ai-line">Рейтинг появится после завершения матчей.</p>' : '');
  const partial = data.truncated === true ? '<p class="beat-ai-line">Прогнозов очень много — таблица посчитана по части из них.</p>' : '';
  return `${head}${mine}${waiting}${table}${partial}<button type="button" class="primary-btn beat-ai-choose-match" data-beat-choose-match>Выбрать матч →</button><details class="beat-ai-rules"><summary>Как играть</summary><p>Выбери исход до начала матча в его штабе. Верный прогноз — 1 очко. Сравниваем с прогнозом AI на тех же матчах. В рейтинге показывается имя из Telegram.</p></details>`;
}

export async function loadPicksLeaderboard({ root, api, escapeHtml, onChooseMatch } = {}) {
  if (!root || typeof api !== 'function') return false;
  let data = null;
  try {
    data = await api('/api/picks-leaderboard', { retry: false, timeoutMs: 8000 });
  } catch {
    data = null;
  }
  if (!root.isConnected) return false;
  root.innerHTML = picksLeaderboardHtml(data, escapeHtml);
  if (typeof onChooseMatch === 'function') root.querySelector?.('[data-beat-choose-match]')?.addEventListener('click',onChooseMatch);
  root.hidden = false;
  return true;
}
