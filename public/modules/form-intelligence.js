// Intelligence 2.0: source-backed recent-form comparison for prematch analyses.
// No extra provider calls, inferred matches, fabricated percentages or odds.
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function boundedNumber(value, min, max) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^[0-9]+(?:[.,][0-9]+)?$/.test(value.trim()))) return null;
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validPair(home, away) {
  const h = object(home), a = object(away);
  const homeSample = boundedNumber(h?.sample, 3, 100);
  const awaySample = boundedNumber(a?.sample, 3, 100);
  const homePpg = boundedNumber(h?.ppg, 0, 3);
  const awayPpg = boundedNumber(a?.ppg, 0, 3);
  if (![homeSample, awaySample, homePpg, awayPpg].every(x => x !== null)) return null;
  if (!Number.isSafeInteger(homeSample) || !Number.isSafeInteger(awaySample)) return null;
  return {home: homePpg, away: awayPpg, homeSample, awaySample, delta:Math.round((homePpg - awayPpg)*100)/100};
}

export function deriveFormIntelligence(payload = {}) {
  const data = object(payload) || {};
  // Stale analyses are never presented as fresh form intelligence.
  if (data.stale === true) return null;
  const recent = object(data.recentForm) || {};
  const home = object(recent.home) || {}, away = object(recent.away) || {};
  const overall = validPair(home.overall, away.overall);
  if (!overall) return null;
  const venue = validPair(home.venue, away.venue);
  const homeName = typeof data.match?.home?.name === 'string' ? data.match.home.name.slice(0,110) : 'Хозяева';
  const awayName = typeof data.match?.away?.name === 'string' ? data.match.away.name.slice(0,110) : 'Гости';
  return {homeName, awayName, overall, venue};
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[char]);
}

function pairHtml(pair, title, homeName, awayName) {
  if (!pair) return '';
  const pct = n => Math.min(100, Math.max(0, n/3*100)).toFixed(2);
  const label = Math.abs(pair.delta) < 0.15
    ? 'Форма команд близка'
    : pair.delta > 0 ? 'По выборке впереди хозяева' : 'По выборке впереди гости';
  const renderSide = (name,side,sample) => '<div class="form-intel-side '+side+'">'
    + '<div class="form-intel-team"><span>'+escapeHtml(name)+'</span><strong>'
    + pair[side].toFixed(2)+'</strong></div>'
    + '<div class="form-intel-track"><i style="width:'+pct(pair[side])+'%"></i></div>'
    + '<small>Матчей в выборке: '+sample+'</small></div>';
  return '<div class="form-intel-pair">'
    + '<div class="form-intel-pair-title"><strong>'+escapeHtml(title)+'</strong>'
    + '<span>'+escapeHtml(label)+'</span></div>'
    + renderSide(homeName,'home',pair.homeSample)
    + renderSide(awayName,'away',pair.awaySample)
    + '</div>';
}

export function renderFormIntelligence(payload = {}) {
  const model = deriveFormIntelligence(payload);
  if (!model) return '';
  return '<section class="panel form-intel-panel" aria-label="Сравнение формы команд">'
    + '<div class="form-intel-header"><span>📈 ФОРМА КОМАНД</span>'
    + '<h2>Кто набирает больше очков?</h2>'
    + '<p>Очки за матч по фактически доступной выборке: от 0 до 3.</p></div>'
    + pairHtml(model.overall,'Общая форма',model.homeName,model.awayName)
    + (model.venue ? pairHtml(model.venue,'Хозяева дома / гости на выезде',model.homeName,model.awayName)
      : '<p class="form-intel-limited">Для сравнения дома и в гостях пока недостаточно матчей.</p>')
    + '<p class="form-intel-disclaimer">Данные описывают прошлые результаты команд. '
    + 'Это не вероятность победы и не гарантия будущего результата.</p></section>';
}
