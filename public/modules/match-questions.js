// Задача 6: «Спросить про матч». Ответ приходит с сервера только как факты из
// каталога данных матча (тексты и связки задаёт сервер) или как короткий
// готовый ответ «в данных этого нет» / отказ от ставок. Здесь — проверка формы
// ответа и отрисовка; свободный текст AI сюда не попадает.

const PRESETS = Object.freeze([
  ['why', 'Почему такой прогноз?'],
  ['risk', 'Что может изменить исход?'],
  ['form', 'Кто в форме?'],
  ['squad', 'Что с составами и потерями?'],
]);
const ROLES = new Set(['lead', 'support', 'risk', 'caveat']);
const MAX_LENGTH = 200;

const UNAVAILABLE = Object.freeze({
  user_limit: 'Лимит вопросов на этот час исчерпан. Готовые подсказки работают без лимита.',
  daily_limit: 'На сегодня вопросы к AI закончились. Готовые подсказки работают без лимита.',
  ai_unavailable: 'AI сейчас не ответил. Попробуйте готовую подсказку или спросите позже.',
  ai_disabled: 'Свои вопросы к AI временно выключены. Готовые подсказки работают.',
  disabled: 'Вопросы по матчу временно выключены.',
  analysis_disabled: 'Вопросы по матчу временно недоступны.',
  analysis_unavailable: 'Данные разбора устарели — обновите разбор матча и спросите снова.',
  not_in_history: 'Сначала откройте полный разбор этого матча.',
  rate_limited: 'Слишком много вопросов подряд — подождите минуту.',
});

export function matchQuestionsShellHtml(escapeHtml) {
  return `<div class="match-explanation-head"><button type="button" class="match-question-start" data-question-start>💬 Спросить про матч</button><small>О судье, форме, составах и прогнозе</small></div>
    <div class="match-question-presets" role="group" aria-label="Готовые вопросы">${PRESETS.map(([id, label]) => `<button type="button" class="match-question-chip" data-question-preset="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}</div>
    <form class="match-question-form" data-question-form>
      <input type="text" name="question" maxlength="${MAX_LENGTH}" autocomplete="off" placeholder="Свой вопрос, например: кто главный судья?" aria-label="Вопрос про матч">
      <button type="submit" class="match-question-submit">Спросить</button>
    </form>
    <div class="match-question-answer" data-question-answer aria-live="polite"></div>
    <p class="match-explanation-note">Ответы основаны на данных этого матча.</p>`;
}

function validItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item && typeof item === 'object' && ROLES.has(item.role)
      && typeof item.connector === 'string' && item.connector.trim()
      && typeof item.text === 'string' && item.text.trim())
    .slice(0, 3);
}

export function matchQuestionAnswerHtml(data, escapeHtml) {
  const question = typeof data?.question === 'string' ? data.question.trim().slice(0, MAX_LENGTH) : '';
  const head = question ? `<p class="match-question-asked">«${escapeHtml(question)}»</p>` : '';
  const remaining = Number.isInteger(data?.remaining) && data.remaining >= 0
    ? `<small class="match-question-remaining">Осталось своих вопросов в этот час: ${data.remaining}</small>` : '';
  if (data?.available === true) {
    const items = validItems(data.items);
    if (data.answer === 'facts' && items.length) {
      return `${head}<div class="match-question-response">${items.map(item => `<p>${escapeHtml(item.text.trim().slice(0, /^starters_(home|away)$/.test(item.id) ? 1400 : 300))}</p>`).join('')}</div>${remaining}`;
    }
    if (data.answer === 'refused') return `${head}<p class="match-question-empty">Ставки мы не подсказываем. Могу рассказать, что важно в этом матче по данным.</p>${remaining}`;
    return `${head}<p class="match-question-empty">В данных этого матча ответа на этот вопрос нет.</p>${remaining}`;
  }
  const text = UNAVAILABLE[data?.reason] || 'Не удалось получить ответ. Попробуйте ещё раз.';
  return `${head}<p class="match-question-empty">${escapeHtml(text)}</p>${remaining}`;
}

export function mountMatchQuestions({ root, fixtureId, api, escapeHtml, presetAnswers = null, accessReceipt = null, isCurrent = () => true } = {}) {
  const id = Number(fixtureId);
  if (!root || !Number.isSafeInteger(id) || id <= 0 || typeof api !== 'function') return false;
  if (root.dataset.questionsMounted === 'true' && Number(root.dataset.fixture) === id) return true;
  root.dataset.fixture = String(id);
  root.dataset.questionsMounted = 'true';
  root.innerHTML = matchQuestionsShellHtml(escapeHtml);
  root.hidden = false;
  const answer = root.querySelector('[data-question-answer]');
  const form = root.querySelector('[data-question-form]');
  const input = form?.querySelector('input[name="question"]');
  let busy = false;

  async function ask(body) {
    if (busy || !answer) return;
    const prepared=Number(presetAnswers?.fixtureId)===id && body.preset
      ? presetAnswers?.presets?.[body.preset] : null;
    if (prepared?.available===true && (prepared.answer==='not_in_data'
      || (prepared.answer==='facts' && validItems(prepared.items).length))) {
      answer.innerHTML=matchQuestionAnswerHtml({...prepared,question:PRESETS.find(([key])=>key===body.preset)?.[1]},escapeHtml);
      return;
    }
    busy = true;
    root.setAttribute('aria-busy', 'true');
    answer.innerHTML = '<p class="match-question-empty">Ищу в данных матча…</p>';
    let data = null;
    try {
      data = await api('/api/match-question', { method: 'POST', body: JSON.stringify({ fixtureId: id, ...body, ...(typeof accessReceipt==='string' && accessReceipt.length<=100 ? {accessReceipt} : {}) }), retry: false, timeoutMs: 9000 });
    } catch (error) {
      const reason = error?.payload?.reason || (Number(error?.status) === 404 ? 'not_in_history' : Number(error?.status) === 429 ? 'rate_limited' : '');
      data = { available: false, reason };
    }
    busy = false;
    root.removeAttribute('aria-busy');
    // Пользователь мог уйти с этого разбора, пока шёл запрос.
    if (!isCurrent() || !root.isConnected || Number(root.dataset.fixture) !== id) return;
    answer.innerHTML = matchQuestionAnswerHtml(data, escapeHtml);
  }

  root.querySelector('[data-question-start]')?.addEventListener('click', () => ask({ preset: 'why' }));
  root.querySelectorAll('[data-question-preset]').forEach(button => {
    button.addEventListener('click', () => ask({ preset: button.dataset.questionPreset }));
  });
  form?.addEventListener('submit', event => {
    event.preventDefault();
    const question = String(input?.value || '').trim();
    if (question.length < 3) {
      answer.innerHTML = '<p class="match-question-empty">Напишите вопрос хотя бы из трёх символов.</p>';
      return;
    }
    ask({ question: question.slice(0, MAX_LENGTH) });
  });
  return true;
}
