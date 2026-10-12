// «Пригласить друга» в Профиле: ссылка-приглашение и бонусные разборы.
// Цифры — только из ответа /api/referral. Награда: +1 AI-разбор другу и вам
// после его первого разбора (не больше 10 наград за 30 дней).

const INVITE_TEXT = 'Попробуй MatchRadar — AI-разбор футбольных матчей в Telegram. По моей ссылке у тебя будет +1 бонусный разбор.';

function nonNegative(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

export function inviteShareUrl(url) {
  if (typeof url !== 'string' || !/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=[A-Za-z0-9_-]{1,64}$/.test(url)) return '';
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(INVITE_TEXT)}`;
}

export function referralInviteHtml(data, escapeHtml) {
  const head = '<div class="match-explanation-head"><span>🎁 Пригласить друга</span><small>+1 AI-разбор вам обоим</small></div>';
  if (!data || data.available !== true || !inviteShareUrl(data.url)) {
    return `${head}<p class="beat-ai-line">Приглашения временно недоступны.</p>`;
  }
  const bonus = nonNegative(data.bonusAvailable);
  const invited = nonNegative(data.invitedThisMonth);
  const cap = nonNegative(data.monthlyCap) || 10;
  return `${head}<p class="beat-ai-line">Когда друг придёт по вашей ссылке и откроет первый AI-разбор, вы оба получите +1 бонусный разбор. Он тратится, когда закончится дневной лимит.</p>
    <p class="beat-ai-line">Бонусных разборов: <b>${bonus}</b> · приглашено за 30 дней: <b>${Math.min(invited, cap)}</b> из ${cap}</p>
    <button type="button" class="match-question-submit referral-invite-btn" data-referral-share>Пригласить друга</button>
    <p class="match-explanation-note">Награда начисляется только за новых пользователей. Это не оплата и не деньги.</p>`;
}

export async function loadReferralInvite({ root, api, escapeHtml, tg = null, navigatorRef = globalThis.navigator, toast = () => {} } = {}) {
  if (!root || typeof api !== 'function') return false;
  let data = null;
  try {
    data = await api('/api/referral', { retry: false, timeoutMs: 8000 });
  } catch {
    data = null;
  }
  if (!root.isConnected) return false;
  root.innerHTML = referralInviteHtml(data, escapeHtml);
  root.hidden = false;
  root.querySelector('[data-referral-share]')?.addEventListener('click', async () => {
    const shareUrl = inviteShareUrl(data?.url);
    if (!shareUrl) return;
    try {
      if (typeof tg?.openTelegramLink === 'function') {
        tg.openTelegramLink(shareUrl);
        return;
      }
      if (typeof navigatorRef?.share === 'function') {
        await navigatorRef.share({ title: 'MatchRadar', text: INVITE_TEXT, url: data.url });
        return;
      }
      await navigatorRef.clipboard.writeText(`${INVITE_TEXT}\n${data.url}`);
      toast('Ссылка-приглашение скопирована');
    } catch (error) {
      if (error?.name !== 'AbortError') toast('Не удалось открыть приглашение');
    }
  });
  return true;
}
