// Задача 5: «AI · простыми словами» в полном разборе.
// Тексты и связки приходят с сервера (каталог фактов); AI на сервере только
// упорядочивает факты. Здесь — только проверка формы ответа и отрисовка.

const ROLES = new Set(['lead', 'support', 'risk', 'caveat']);
const MAX_ITEMS = 5;

function validItems(data) {
  if (!data || typeof data !== 'object' || data.available !== true || !Array.isArray(data.items)) return [];
  const items = data.items
    .filter(item => item && typeof item === 'object'
      && ROLES.has(item.role)
      && typeof item.connector === 'string' && item.connector.trim()
      && typeof item.text === 'string' && item.text.trim())
    .slice(0, MAX_ITEMS);
  return items.length >= 2 && items[0].role === 'lead' ? items : [];
}

export function matchExplanationHtml(data, escapeHtml) {
  const items = validItems(data);
  if (!items.length) return '';
  const source = data.source === 'ai' ? 'Порядок фактов выбрал AI' : 'Базовый порядок фактов';
  return `<div class="match-explanation-head"><span>🧠 AI · простыми словами</span><small>${escapeHtml(source)}</small></div>
    <ol class="match-explanation-list">${items.map(item => `<li class="is-${escapeHtml(item.role)}"><b>${escapeHtml(item.connector.trim().slice(0, 40))}</b> ${escapeHtml(item.text.trim().slice(0, 300))}</li>`).join('')}</ol>
    <p class="match-explanation-note">Все факты и цифры — из данных матча. AI только выбирает и упорядочивает их; это оценка, а не гарантия результата.</p>`;
}

export async function loadMatchExplanation({ root, fixtureId, api, escapeHtml, isCurrent = () => true } = {}) {
  const id = Number(fixtureId);
  if (!root || !Number.isSafeInteger(id) || id <= 0 || typeof api !== 'function') return false;
  let data = null;
  try {
    data = await api(`/api/match-explanation?fixtureId=${id}`, { retry: false, timeoutMs: 9000 });
  } catch {
    data = null;
  }
  // Пользователь мог уйти с этого разбора, пока шёл запрос.
  if (!isCurrent() || !root.isConnected || Number(root.dataset.fixture) !== id) return false;
  const html = matchExplanationHtml(data, escapeHtml);
  if (!html) {
    root.hidden = true;
    root.innerHTML = '';
    return false;
  }
  root.innerHTML = html;
  root.hidden = false;
  return true;
}
