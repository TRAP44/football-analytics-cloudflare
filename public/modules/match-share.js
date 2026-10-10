// «Поделиться матчем»: короткая нейтральная карточка для Telegram.
// Только данные из проверенного payload — без ставочных меток («ТБ 2.5», «П1»)
// и без чисел, которых нет в ответе сервера.

const SHARE_TEXT_LIMIT = 700;

function cleanText(value, max = 120) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function scoreValue(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

// Вероятности показываем, только если все три — корректные проценты и в сумме ~100.
export function shareProbabilities(probabilities) {
  if (!probabilities || typeof probabilities !== 'object') return null;
  const values = [probabilities.home, probabilities.draw, probabilities.away].map(value => (
    value === null || value === undefined || value === '' ? NaN : Number(value)
  ));
  if (!values.every(value => Number.isFinite(value) && value >= 0 && value <= 100)) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 100) > 3) return null;
  return values.map(value => Math.round(value));
}

export function shareConfidence(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number) : null;
}

export function buildMatchShareText({ match, probabilities, confidence, dateTime } = {}) {
  const m = match && typeof match === 'object' ? match : {};
  const home = cleanText(m.home?.name) || 'Хозяева';
  const away = cleanText(m.away?.name) || 'Гости';
  const lines = [`⚽ ${home} — ${away}`];

  const when = m.date && typeof dateTime === 'function' ? cleanText(String(dateTime(m.date) || ''), 40) : '';
  const context = [cleanText(m.league), when].filter(Boolean).join(' · ');
  if (context) lines.push(context);

  const scoreHome = scoreValue(m.score?.home);
  const scoreAway = scoreValue(m.score?.away);
  if (scoreHome !== null && scoreAway !== null && (m.live || m.finished)) {
    const elapsed = scoreValue(m.elapsed);
    lines.push(m.live
      ? `Сейчас ${scoreHome} : ${scoreAway}${elapsed !== null ? ` · ${elapsed}′` : ''}`
      : `Итог ${scoreHome} : ${scoreAway}`);
  }

  const probs = shareProbabilities(probabilities);
  if (probs) lines.push(`MatchRadar AI: хозяева ${probs[0]}% · ничья ${probs[1]}% · гости ${probs[2]}%`);
  const score = shareConfidence(confidence);
  if (probs && score !== null) lines.push(`Уверенность модели: ${score}/100`);

  lines.push('', probs ? 'Аналитика модели, а не гарантия результата.' : 'Разбор и данные матча — в MatchRadar.');
  return lines.join('\n').slice(0, SHARE_TEXT_LIMIT);
}

export function telegramComposerUrl(url, text) {
  if (typeof url !== 'string' || !/^https:\/\//.test(url) || url.length > 2048) return '';
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

export async function shareMatch({
  match,
  probabilities = null,
  confidence = null,
  source = 'miniapp',
  api,
  tg,
  navigatorRef = globalThis.navigator,
  toast = () => {},
  safeTelegramUrl = value => value,
  dateTime,
} = {}) {
  const text = buildMatchShareText({ match, probabilities, confidence, dateTime });
  const fixtureId = Number(match?.fixtureId || 0);
  let shareUrl = '';
  if (Number.isSafeInteger(fixtureId) && fixtureId > 0 && typeof api === 'function') {
    try {
      const share = await api(`/api/share-link?fixtureId=${fixtureId}&source=social&campaign=match_share&content=${encodeURIComponent(source)}`, { retry: false, timeoutMs: 7000 });
      shareUrl = typeof share?.url === 'string' ? share.url : '';
    } catch {}
  }
  const fullText = shareUrl ? `${text}\n\n${shareUrl}` : text;
  const title = (text.split('\n')[0] || '').replace(/^⚽\s*/, '');
  try {
    const composer = safeTelegramUrl(telegramComposerUrl(shareUrl, text));
    if (composer && typeof tg?.openTelegramLink === 'function') {
      tg.openTelegramLink(composer);
      toast('Выберите чат, куда отправить матч');
      return 'telegram';
    }
    if (typeof navigatorRef?.share === 'function') {
      await navigatorRef.share({ title, text, ...(shareUrl ? { url: shareUrl } : {}) });
      return 'native';
    }
    await navigatorRef.clipboard.writeText(fullText);
    toast(shareUrl ? 'Ссылка на матч скопирована' : 'Текст о матче скопирован');
    return 'clipboard';
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
    try {
      await navigatorRef.clipboard.writeText(fullText);
      toast(shareUrl ? 'Ссылка на матч скопирована' : 'Текст о матче скопирован');
      return 'clipboard';
    } catch {
      toast('Не удалось поделиться матчем');
      return 'failed';
    }
  }
}
