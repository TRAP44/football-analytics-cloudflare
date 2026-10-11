// Нейтральные формулировки AI-сигнала. MatchRadar — аналитический сервис,
// а не подсказчик ставок: вместо «Пропустить ставку» говорим, что уверенного
// вывода нет. Старые подписи из истории и кеша приводим к новой при выдаче.
export const NO_CLEAR_SIGNAL_LABEL = 'Без уверенного вывода';

const LEGACY_SKIP_LABEL = /^\s*пропустить\s+ставку\s*$/i;

export function publicSignalLabel(label) {
  if (typeof label !== 'string') return '';
  return LEGACY_SKIP_LABEL.test(label) ? NO_CLEAR_SIGNAL_LABEL : label;
}

export function withPublicSignalLabel(payload) {
  const signal = payload?.aiInstructor?.betSignal;
  if (!signal || typeof signal !== 'object' || typeof signal.label !== 'string') return payload;
  const label = publicSignalLabel(signal.label);
  if (label === signal.label) return payload;
  return {
    ...payload,
    aiInstructor: { ...payload.aiInstructor, betSignal: { ...signal, label } },
  };
}

// Ставочные слова и метки. Границы слов — через Unicode-классы: \b не видит кириллицу.
const BETTING_TEXT = /коэффициент|рын(ок|ка|ке|ком|очн)|ставк|букмекер|тотал|обе забьют|форсир|пропустить\s+(матч|ставку)|(^|[^\p{L}\p{N}])(1[XХ]2|ТБ|ТМ|П1|П2|1X|X2|Х2|1Х)(?![\p{L}\p{N}])/iu;

export function isBettingText(text) {
  return typeof text === 'string' && BETTING_TEXT.test(text);
}

// Текст из разбора без ставочных фраз: иначе пустая строка.
export function neutralReasonText(text) {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean && !isBettingText(clean) ? clean : '';
}

function teamName(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
}

// Код сигнала → нейтральный вывод словами (вместо «ТБ 2.5», «П1», «1X»).
export function neutralSignalText(code, { home, away } = {}) {
  const homeName = teamName(home, 'Хозяева');
  const awayName = teamName(away, 'Гости');
  switch (String(code || '').trim().toLowerCase()) {
    case 'home': return `Перевес ${homeName}`;
    case 'away': return `Перевес ${awayName}`;
    case 'double_home': return `${homeName} скорее не проиграет`;
    case 'double_away': return `${awayName} скорее не проиграет`;
    case 'over25': return 'Результативная игра: 3+ гола';
    case 'btts': return 'Забьют обе команды';
    case 'skip': return NO_CLEAR_SIGNAL_LABEL;
    default: return '';
  }
}

// «П1 · 52%» → «Победа Милан · 52%»; непонятный или ставочный формат — пустая строка.
export function neutralOutcomeText(outcome, { home, away } = {}) {
  if (typeof outcome !== 'string') return '';
  const text = outcome.replace(/\s+/g, ' ').trim();
  const match = /^(П1|П2|Н|Х|X)\s*·\s*(\d{1,3}(?:[.,]\d+)?)\s*%$/i.exec(text);
  if (match) {
    const key = match[1].toUpperCase();
    const label = key === 'П1' ? `Победа ${teamName(home, 'хозяев')}`
      : key === 'П2' ? `Победа ${teamName(away, 'гостей')}`
        : 'Ничья';
    return `${label} · ${match[2].replace(',', '.')}%`;
  }
  return text && !isBettingText(text) && text !== 'Нет данных' ? text : '';
}
