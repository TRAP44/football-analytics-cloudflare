// Тарифы в боте (вариант оформления A, решение Сергея 13.10). Цены и лимиты —
// только из рабочей конфигурации (переменные окружения), без выдуманных цифр.
// Покупка — в приложении (Профиль → тарифы), здесь только справка и кнопка.
import { passProductConfig } from './entitlements.js';

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function durationLabel(hours) {
  const value = positiveInt(hours);
  if (!value) return '';
  if (value % 24 === 0) {
    const days = value / 24;
    const tail = days % 10 === 1 && days % 100 !== 11 ? 'день'
      : [2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100) ? 'дня' : 'дней';
    return `${days} ${tail}`;
  }
  return `${value} ч`;
}

export function botPlansText(cfg = {}) {
  const limits = cfg?.limits || {};
  const prices = cfg?.starsPrices || {};
  const lines = ['💎 <b>Тарифы MatchRadar</b>', ''];
  const free = positiveInt(limits.FREE);
  if (free) lines.push(`Бесплатно — ${free} AI-разбора в день.`);
  const pro = positiveInt(prices.PRO);
  const proLimit = positiveInt(limits.PRO);
  if (pro) lines.push(`<b>PRO</b> — ${pro} ⭐ за 30 дней${proLimit ? ` · ${proLimit} разборов в день` : ''}`);
  const premium = positiveInt(prices.PREMIUM);
  const premiumLimit = positiveInt(limits.PREMIUM);
  if (premium) lines.push(`<b>Premium</b> — ${premium} ⭐ за 30 дней${premiumLimit ? ` · ${premiumLimit} разборов в день` : ''}`);

  const passes = [];
  const match = passProductConfig('MATCH_PASS', cfg);
  if (match) passes.push(`<b>Match Pass</b> — ${match.stars} ⭐ · один выбранный матч`);
  const day = passProductConfig('DAY_PASS', cfg);
  if (day) passes.push(`<b>Day Pass</b> — ${day.stars} ⭐ · все матчи на ${durationLabel(day.durationHours) || '24 ч'}`);
  const week = passProductConfig('WEEKEND_PASS', cfg);
  // Лимит разборов недельного доступа — обязательно в тексте (ревью Codex #872).
  const weekCap = positiveInt(week?.usageLimit);
  if (week?.saleReady && weekCap) passes.push(`<b>${durationLabel(week.durationHours) || '7 дней'}</b> — ${week.stars} ⭐ · до ${weekCap} AI-разборов за этот срок`);
  if (passes.length) lines.push('', 'Разовый доступ:', ...passes);

  lines.push('', 'Оплата — Telegram Stars в приложении.');
  return lines.join('\n');
}

export const BOT_NOTIFICATIONS_TEXT = [
  '⚙️ <b>Уведомления</b>',
  '',
  'Напоминания о матчах и события любимых команд и игроков настраиваются в приложении: Профиль → Уведомления.',
].join('\n');

// Утренняя подборка (Issue #922): показываем подтверждённое состояние и одно
// действие. enabled === null — состояние не прочитано, тогда обе кнопки.
// Кнопки меняют только подборку, остальные уведомления не трогают.
export function botDigestView(enabled) {
  const state = enabled === true ? 'включена' : enabled === false ? 'выключена' : '';
  const lines = [
    BOT_NOTIFICATIONS_TEXT,
    '',
    state
      ? `☀️ <b>Утренняя подборка: ${state}</b> — до 3 заметных матчей дня около 10:00 МСК.`
      : '☀️ <b>Утренняя подборка</b> — до 3 заметных матчей дня около 10:00 МСК.',
    'Кнопка ниже меняет только подборку — уведомления о матчах и командах остаются как есть.',
  ];
  const on = { text: '☀️ Включить подборку', callback_data: 'digest:on' };
  const off = { text: '🔕 Выключить подборку', callback_data: 'digest:off' };
  const buttons = enabled === true ? [off] : enabled === false ? [on] : [on, off];
  return { text: lines.join('\n'), buttons };
}

// Совместимость: старый набор кнопок (обе), если состояние неизвестно.
export const BOT_DIGEST_BUTTONS = Object.freeze(botDigestView(null).buttons.map(button => Object.freeze(button)));
