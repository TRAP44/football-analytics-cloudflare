export function renderLaunchFunnelCampaignSections({ d = {}, campaigns, mediaCampaigns, escapeHtml, launchFunnelPct } = {}) {
  const sources=d.campaigns || [];
  campaigns.innerHTML=`<div class="release-monitor-section-head"><strong>Источники и кампании</strong><span>без Telegram ID</span></div>
  ${sources.length ? `<div class="launch-campaign-list">${sources.map(x=>`<div>
  <span><b>${escapeHtml(x.source || 'telegram')}</b> · ${escapeHtml(x.campaign || 'direct')}</span>
  <strong>${Number(x.entries || 0)} → ${Number(x.fullAi || 0)}</strong>
  <small>AI conversion ${launchFunnelPct(x.conversionPct)} · ${Number(x.events || 0)} событий</small>
  </div>`).join('')}</div>` : '<div class="empty compact-empty">Пока нет атрибутированных входов.</div>'}
  <p class="tiny">${escapeHtml(d.privacy || '')}</p>`;
  
  const mediaRows=d.mediaCampaigns || [];
  const mediaSummary=d.mediaSummary || {};
  mediaCampaigns.innerHTML=`<div class="release-monitor-section-head"><strong>Материалы СМИ</strong><span>source · campaign · content</span></div>
  <div class="media-campaign-summary">
  <span>Создано ссылок <strong>${Number(mediaSummary.linksCreated || 0)}</strong></span>
  <span>Входы <strong>${Number(mediaSummary.entries || 0)}</strong></span>
  <span>Quick AI <strong>${Number(mediaSummary.quickAi || 0)}</strong></span>
  <span>Полный AI <strong>${Number(mediaSummary.fullAi || 0)}</strong></span>
  <span>Конверсия <strong>${launchFunnelPct(mediaSummary.conversionPct)}</strong></span>
  </div>
  ${mediaRows.length ? `<div class="media-campaign-list">${mediaRows.map(x=>`<div class="media-campaign-row">
  <div class="media-campaign-name"><strong>${escapeHtml(x.content || 'default')}</strong><small>${escapeHtml(x.source || 'media')} · ${escapeHtml(x.campaign || 'launch')}</small></div>
  <div class="media-campaign-flow"><span>${Number(x.entries || 0)} входов</span><b>→</b><span>${Number(x.fullAi || 0)} полный AI</span></div>
  <div class="media-campaign-metrics"><span>${Number(x.deepLinkOpens || 0)} deep-link</span><span>${Number(x.quickAi || 0)} quick AI</span><span>${launchFunnelPct(x.fullAiConversionPct)} конверсия</span><span>${Number(x.linksCreated || 0)} ссылок</span></div>
  </div>`).join('')}</div>` : '<div class="empty compact-empty">Пока нет данных по отдельным материалам СМИ.</div>'}
  <p class="tiny">Статистика агрегируется по first-party attribution. Telegram ID пользователей не отображаются.</p>`;
}
