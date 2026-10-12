// Карточка-картинка «AI угадал» для шаринга (решение Сергея 12.10).
// Рисуется в браузере (canvas 1080×1080) только из проверенного итога
// /api/match-pick: исход подтверждён проверкой финальности, вероятность —
// из того же предматчевого снимка модели. Без денег и ставочных слов.

const SIZE = 1080;
const AMBER = '#fbbf24';
const INK = '#1a1203';
const BASE = '#0b0f14';
const TEXT = '#f4f6f8';
const MUTED = '#9aa4b2';
const OUTCOMES = ['home', 'draw', 'away'];

function clean(value, max = 40) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function goals(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isSafeInteger(number) && number >= 0 && number <= 30 ? number : null;
}

function outcomeName(value, home, away) {
  if (value === 'home') return home;
  if (value === 'away') return away;
  return value === 'draw' ? 'Ничья' : '';
}

/**
 * Содержимое карточки или null, если делиться нечем (никто не угадал,
 * итог не подтверждён или данных не хватает). data — ответ /api/match-pick.
 */
export function aiGuessedCardModel(data) {
  if (!data || data.available !== true || !data.result || typeof data.result !== 'object') return null;
  const result = data.result;
  if (!OUTCOMES.includes(result.actual)) return null;
  const aiRight = result.aiPoint === 1;
  const userRight = result.userPoint === 1;
  if (!aiRight && !userRight) return null;
  const home = clean(result.homeName) || 'Хозяева';
  const away = clean(result.awayName) || 'Гости';
  const ai = OUTCOMES.includes(data.ai) ? data.ai : null;
  const pick = OUTCOMES.includes(data.pick) ? data.pick : null;
  const scoreHome = goals(result.score?.home);
  const scoreAway = goals(result.score?.away);
  const probability = Number.isSafeInteger(result.aiProbability) && result.aiProbability >= 0 && result.aiProbability <= 100 ? result.aiProbability : null;
  const headline = aiRight && userRight ? 'Вы и AI угадали' : aiRight ? 'AI угадал' : 'Вы обыграли AI';
  const lines = [];
  if (ai) lines.push(`Прогноз AI до матча: ${outcomeName(ai, home, away)}${probability !== null ? ` · ${probability}%` : ''}`);
  if (pick) lines.push(`Ваш прогноз: ${outcomeName(pick, home, away)}`);
  return {
    headline,
    league: clean(result.league, 60),
    home,
    away,
    score: scoreHome !== null && scoreAway !== null ? `${scoreHome} : ${scoreAway}` : '',
    outcome: `Итог: ${outcomeName(result.actual, home, away)}`,
    lines,
    footer: 'MatchRadar · аналитика, а не гарантия результата',
    fileName: `matchradar-${clean(home, 20)}-${clean(away, 20)}.png`.replace(/[^\p{L}\p{N}.-]+/gu, '-'),
  };
}

function fitText(ctx, text, maxWidth, size, weight = 800) {
  let current = size;
  ctx.font = `${weight} ${current}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  while (current > 28 && ctx.measureText(text).width > maxWidth) {
    current -= 4;
    ctx.font = `${weight} ${current}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  }
  return current;
}

/** Рисует карточку на canvas (2D-контекст). Возвращает true, если нарисовано. */
export function drawAiGuessedCard(canvas, model) {
  if (!canvas || !model) return false;
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return false;
  const center = SIZE / 2;
  const width = SIZE - 160;

  // Тёмная «стадионная» база и янтарный прожектор сверху.
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (typeof ctx.createRadialGradient === 'function') {
    const glow = ctx.createRadialGradient(center, -120, 40, center, -120, 760);
    glow.addColorStop(0, 'rgba(251, 191, 36, 0.32)');
    glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, SIZE - 80, SIZE - 80);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = AMBER;
  ctx.font = '700 34px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('✦ MatchRadar AI', center, 130);

  // Плашка-заголовок.
  fitText(ctx, model.headline, width - 80, 76, 900);
  const pillWidth = Math.min(width, ctx.measureText(model.headline).width + 96);
  ctx.fillStyle = AMBER;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(center - pillWidth / 2, 190, pillWidth, 116, 58);
    ctx.fill();
  } else {
    ctx.fillRect(center - pillWidth / 2, 190, pillWidth, 116);
  }
  ctx.fillStyle = INK;
  ctx.fillText(model.headline, center, 250);

  if (model.league) {
    ctx.fillStyle = MUTED;
    fitText(ctx, model.league, width, 34, 600);
    ctx.fillText(model.league, center, 380);
  }

  ctx.fillStyle = TEXT;
  fitText(ctx, model.home, width, 60);
  ctx.fillText(model.home, center, 470);
  if (model.score) {
    ctx.fillStyle = AMBER;
    ctx.font = '900 130px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(model.score, center, 590);
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = '700 44px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('—', center, 590);
  }
  ctx.fillStyle = TEXT;
  fitText(ctx, model.away, width, 60);
  ctx.fillText(model.away, center, 710);

  ctx.fillStyle = TEXT;
  fitText(ctx, model.outcome, width, 40, 700);
  ctx.fillText(model.outcome, center, 800);
  let y = 860;
  for (const line of model.lines.slice(0, 2)) {
    ctx.fillStyle = MUTED;
    fitText(ctx, line, width, 34, 600);
    ctx.fillText(line, center, y);
    y += 50;
  }

  ctx.fillStyle = MUTED;
  ctx.font = '500 26px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(model.footer, center, SIZE - 80);
  return true;
}

function canvasBlob(canvas) {
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => resolve(blob || null), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/**
 * Делится картинкой: системное «Поделиться» с файлом, если поддерживается;
 * иначе — окно с картинкой (долгое нажатие — сохранить или отправить).
 */
export async function shareAiGuessedCard(data, { documentRef = globalThis.document, navigatorRef = globalThis.navigator, toast = () => {} } = {}) {
  const model = aiGuessedCardModel(data);
  if (!model || !documentRef) return 'unavailable';
  const canvas = documentRef.createElement('canvas');
  if (!drawAiGuessedCard(canvas, model)) {
    toast('Не удалось нарисовать карточку');
    return 'failed';
  }
  const blob = typeof canvas.toBlob === 'function' ? await canvasBlob(canvas) : null;
  if (blob && typeof File === 'function' && typeof navigatorRef?.canShare === 'function') {
    const file = new File([blob], model.fileName, { type: 'image/png' });
    if (navigatorRef.canShare({ files: [file] })) {
      try {
        await navigatorRef.share({ files: [file], title: `MatchRadar: ${model.headline}` });
        return 'native';
      } catch (error) {
        if (error?.name === 'AbortError') return 'cancelled';
      }
    }
  }
  showCardOverlay(documentRef, canvas.toDataURL('image/png'), model);
  return 'overlay';
}

function showCardOverlay(documentRef, dataUrl, model) {
  documentRef.getElementById?.('aiGuessedOverlay')?.remove();
  const overlay = documentRef.createElement('div');
  overlay.id = 'aiGuessedOverlay';
  overlay.className = 'ai-guessed-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Карточка: ${model.headline}`);
  const image = documentRef.createElement('img');
  image.src = dataUrl;
  image.alt = `${model.headline}: ${model.home} — ${model.away}${model.score ? `, ${model.score}` : ''}`;
  const hint = documentRef.createElement('p');
  hint.textContent = 'Нажмите и удерживайте картинку, чтобы сохранить или отправить её.';
  const close = documentRef.createElement('button');
  close.type = 'button';
  close.className = 'secondary-btn';
  close.textContent = 'Закрыть';
  close.addEventListener('click', () => overlay.remove());
  overlay.append(image, hint, close);
  documentRef.body.append(overlay);
  close.focus?.();
}
