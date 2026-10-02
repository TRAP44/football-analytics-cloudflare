export function createAdminMediaPublisherModule({
  $,
  isAdmin,
  toast,
  api,
  escapeHtml,
  tg,
} = {}) {
  let mediaPublisherPayload = null;

  function mediaPublisherValue(id, fallback = '') {
    return String($(id)?.value || fallback).trim();
  }

  async function generateMediaPublisherLink() {
    if (!isAdmin()) return;
    const fixtureRaw = mediaPublisherValue('mediaPublisherFixtureId');
    const fixtureId = fixtureRaw ? Number(fixtureRaw) : 0;
    if (fixtureRaw && (!Number.isSafeInteger(fixtureId) || fixtureId <= 0)) {
      return toast('Укажите корректный fixture ID или оставьте поле пустым.');
    }

    const button = $('mediaPublisherGenerateBtn');
    const result = $('mediaPublisherResult');
    if (button) button.disabled = true;
    if (result) {
      result.hidden = false;
      result.innerHTML = '<div class="loader compact-loader">Создаю ссылку и текст публикации…</div>';
    }

    try {
      mediaPublisherPayload = await api('/api/media-publisher-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fixtureId: fixtureId || null,
          source: mediaPublisherValue('mediaPublisherSource', 'telegram_channel'),
          campaign: mediaPublisherValue('mediaPublisherCampaign', 'soft_launch'),
          content: mediaPublisherValue('mediaPublisherContent', 'post1'),
        }),
        retry: false,
        dedupe: false,
        timeoutMs: 9000,
      });

      if (result) {
        result.innerHTML = `
          <div class="media-publisher-link-row"><span>${mediaPublisherPayload.mode === 'fixture' ? 'Ссылка на матч' : 'Промо-ссылка'}</span><code>${escapeHtml(mediaPublisherPayload.deepLink || '')}</code></div>
          <div class="media-publisher-link-row"><span>Start param</span><code>${escapeHtml(mediaPublisherPayload.startParam || '')}</code></div>
          <textarea class="media-publisher-copy" readonly>${escapeHtml(mediaPublisherPayload.copy?.body || '')}</textarea>
          <div class="media-publisher-result-actions">
            <button id="mediaPublisherTelegramBtn" class="secondary-btn" type="button">Открыть Telegram Share</button>
          </div>`;
      }

      if ($('mediaPublisherCopyBtn')) $('mediaPublisherCopyBtn').disabled = false;
      $('mediaPublisherTelegramBtn')?.addEventListener('click', () => {
        const url = String(mediaPublisherPayload?.telegramShareUrl || '');
        if (!url) return;
        if (tg?.openTelegramLink) tg.openTelegramLink(url);
        else window.open(url, '_blank', 'noopener,noreferrer');
      });
      toast(mediaPublisherPayload?.mode === 'fixture' ? 'Ссылка на матч готова' : 'Промо-ссылка готова');
    } catch (error) {
      mediaPublisherPayload = null;
      if (result) {
        result.innerHTML = `<div class="data-notice error">Не удалось создать ссылку: ${escapeHtml(error.message || 'ошибка')}</div>`;
      }
      if ($('mediaPublisherCopyBtn')) $('mediaPublisherCopyBtn').disabled = true;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function copyMediaPublisherPost() {
    const text = String(mediaPublisherPayload?.copy?.body || '');
    if (!text) return toast('Сначала создайте ссылку.');
    try {
      await navigator.clipboard.writeText(text);
      toast('Текст публикации скопирован');
    } catch {
      toast('Не удалось скопировать текст');
    }
  }

  return Object.freeze({
    generateMediaPublisherLink,
    copyMediaPublisherPost,
  });
}
