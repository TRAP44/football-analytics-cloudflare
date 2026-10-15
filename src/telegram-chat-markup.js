// Кнопки web_app Telegram принимает только в личном чате; в группе или канале
// сообщение с ними отклоняется целиком (Issue #922). Перед отправкой в такой чат
// web_app-кнопка заменяется обычной HTTPS-ссылкой в бота (t.me/<бот>?start=…),
// а если ссылку получить нельзя — убирается. Личные чаты не меняются.

const CHAT_METHODS = new Set([
  'sendMessage', 'sendPhoto', 'sendAnimation', 'sendDocument', 'sendVideo',
  'editMessageText', 'editMessageReplyMarkup', 'editMessageCaption', 'editMessageMedia',
]);

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

// Личный чат — положительный id пользователя; группы, супергруппы и каналы —
// отрицательные id или @username канала.
export function chatAllowsWebApp(chatId) {
  if (typeof chatId === 'string' && chatId.trim().startsWith('@')) return false;
  const id = Number(chatId);
  return Number.isSafeInteger(id) && id > 0;
}

export function markupHasWebApp(markup) {
  const root = plainObject(markup);
  if (!root) return false;
  for (const key of ['inline_keyboard', 'keyboard']) {
    for (const row of Array.isArray(root[key]) ? root[key] : []) {
      for (const button of Array.isArray(row) ? row : []) {
        if (plainObject(button)?.web_app) return true;
      }
    }
  }
  return false;
}

function webAppFixtureId(button) {
  try {
    const url = new URL(String(plainObject(button?.web_app)?.url || ''));
    const id = Number(url.searchParams.get('fixtureId'));
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  } catch {
    return 0;
  }
}

// linkFor(fixtureId|0) → https-ссылка в бота или '' (тогда кнопка убирается).
export async function groupSafeReplyMarkup(markup, linkFor) {
  const root = plainObject(markup);
  if (!root || !markupHasWebApp(root)) return markup;
  const result = { ...root };
  if (Array.isArray(root.inline_keyboard)) {
    const rows = [];
    for (const row of root.inline_keyboard) {
      const next = [];
      for (const button of Array.isArray(row) ? row : []) {
        const value = plainObject(button);
        if (!value) continue;
        if (!value.web_app) { next.push(value); continue; }
        let url = '';
        try { url = String(await linkFor(webAppFixtureId(value)) || ''); } catch {}
        if (/^https:\/\//.test(url)) next.push({ text: value.text, url });
      }
      if (next.length) rows.push(next);
    }
    result.inline_keyboard = rows;
  }
  if (Array.isArray(root.keyboard)) {
    // Обычная клавиатура: без web_app кнопка просто отправит свой текст.
    result.keyboard = root.keyboard.map(row => (Array.isArray(row) ? row : []).map(button => {
      const value = plainObject(button);
      if (!value?.web_app) return button;
      const { web_app: _webApp, ...rest } = value;
      return rest;
    }));
  }
  return result;
}

export async function chatSafeTelegramBody(method, body, linkFor) {
  const source = plainObject(body);
  if (!source || !CHAT_METHODS.has(method) || chatAllowsWebApp(source.chat_id)) return body;
  if (!markupHasWebApp(source.reply_markup)) return body;
  const markup = await groupSafeReplyMarkup(source.reply_markup, linkFor);
  const next = { ...source, reply_markup: markup };
  const empty = !plainObject(markup)
    || (Array.isArray(markup.inline_keyboard) && !markup.inline_keyboard.length && !markup.keyboard);
  if (empty) delete next.reply_markup;
  return next;
}
