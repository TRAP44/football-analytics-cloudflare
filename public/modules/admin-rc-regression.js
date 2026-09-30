export function createAdminRcRegressionModule({
  state,
  elementById,
  isAdmin,
  runClientContractSmoke,
  relativeAge,
  escapeHtml,
  humanizeTechnicalText,
  api,
  toast,
}) {
  if (!state || typeof elementById !== 'function' || typeof isAdmin !== 'function') {
    throw new TypeError('Admin RC Regression requires state, elementById and isAdmin.');
  }

  const $ = elementById;
  const clientContractSmoke = typeof runClientContractSmoke === 'function'
    ? runClientContractSmoke
    : () => ({ total: 0, passed: 0, failed: 0, checks: [] });

  function rcStateText(status) {
    if (status === 'rc_ready') return 'ГОТОВО';
    if (status === 'rc_with_holds') return 'ЕСТЬ ОГРАНИЧЕНИЯ';
    if (status === 'blocked') return 'ЗАБЛОКИРОВАНО';
    return 'ОЖИДАНИЕ';
  }
  
  function renderRcRegression() {
    if (!isAdmin()) return;
    const badge = $('rcBadge');
    const status = $('rcStatus');
    const meta = $('rcMeta');
    const summary = $('rcSummary');
    const groups = $('rcGroups');
    const client = $('rcClient');
    const checks = $('rcChecks');
    const btn = $('rcRunBtn');
    if (!badge || !status || !meta || !summary || !groups || !client || !checks || !btn) return;
  
    btn.disabled = Boolean(state.rcRegressionLoading);
    if (state.rcRegressionLoading) {
      badge.className = 'rc-badge running';
      badge.textContent = 'ПРОВЕРКА';
      status.textContent = 'Запускаю безопасную регрессионную проверку…';
      meta.textContent = 'Лимит API-Football не расходуется';
      summary.innerHTML = '';
      groups.innerHTML = '';
      client.innerHTML = '';
      checks.innerHTML = '';
      return;
    }
  
    const r = state.rcRegression;
    if (!r) {
      badge.className = 'rc-badge';
      badge.textContent = 'Версия';
      status.textContent = 'Полная регрессионная проверка ещё не запускалась.';
      meta.textContent = 'Тест безопасный: без полного анализа, без изменения пользовательских данных и без расхода API-Football.';
      summary.innerHTML = '';
      groups.innerHTML = '';
      client.innerHTML = '';
      checks.innerHTML = '';
      return;
    }
  
    const cls = r.status === 'rc_ready' ? 'ready' : r.status === 'blocked' ? 'blocked' : 'warning';
    badge.className = `rc-badge ${cls}`;
    badge.textContent = rcStateText(r.status);
    status.textContent = r.label || 'Регрессионная проверка завершена.';
    meta.textContent = `${Number(r.score || 0)}% сервер · ${relativeAge(r.generatedAt)} · ${Number(r.durationMs || 0)} мс`;
  
    summary.innerHTML = `
      <div class="rc-summary-grid">
        <div><span>Всего</span><strong>${Number(r.summary?.total || 0)}</strong></div>
        <div><span>ПРОЙДЕНО</span><strong>${Number(r.summary?.passed || 0)}</strong></div>
        <div><span>ПРЕДУПРЕЖДЕНИЕ/ОГРАНИЧЕНИЕ</span><strong>${Number(r.summary?.warnings || 0)}</strong></div>
        <div><span>БЛОКИРОВКА</span><strong>${Number(r.summary?.blockers || 0)}</strong></div>
      </div>`;
  
    const groupLabels = {
      runtime:'Среда', security:'Безопасность', database:'Схема Supabase',
      user_routes:'Маршруты пользователя', gates:'Проверки выпуска', provider:'Источник данных', safety:'Безопасность',
    };
    groups.innerHTML = `<div class="rc-group-grid">${Object.entries(r.groups || {}).map(([key,g]) => `
      <div class="${Number(g.fail || 0) ? 'fail' : Number(g.warn || 0) ? 'warn' : 'pass'}">
        <span>${escapeHtml(groupLabels[key] || humanizeTechnicalText(key))}</span>
        <strong>${Number(g.pass || 0)}/${Number(g.total || 0)}</strong>
        <small>${Number(g.warn || 0)} предупреждений · ${Number(g.fail || 0)} ошибок</small>
      </div>`).join('')}</div>`;
  
    const cs = r.clientContract || clientContractSmoke();
    client.innerHTML = `
      <div class="rc-client-head"><strong>📱 Проверка клиентского контракта</strong><span>${Number(cs.passed || 0)}/${Number(cs.total || 0)}</span></div>
      <div class="rc-client-checks">${(cs.checks || []).map(x => `
        <div class="${x.pass ? 'pass' : 'fail'}"><i>${x.pass ? '✓' : '×'}</i><span><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></span></div>`).join('')}</div>`;
  
    checks.innerHTML = `<details class="rc-details"><summary>Все серверные проверки · ${Number(r.summary?.total || 0)}</summary>
      <div class="rc-check-list">${(r.checks || []).map(x => `
        <div class="${escapeHtml(x.state || 'warn')}">
          <i>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : '!'}</i>
          <span><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></span>
          <em>${x.blocking ? 'обязательно' : (groupLabels[x.group] || humanizeTechnicalText(x.group))}</em>
        </div>`).join('')}</div>
    </details>
    <p class="tiny">${escapeHtml(humanizeTechnicalText(r.policy?.note || ''))}</p>`;
  }
  
  async function loadRcRegression(force = true) {
    if (!isAdmin() || state.rcRegressionLoading) return;
    if (!force && state.rcRegression) { renderRcRegression(); return; }
  
    state.rcRegressionLoading = true;
    renderRcRegression();
    try {
      const result = await api(`/api/rc-regression${force ? '?refresh=1' : ''}`, {
        retry: false,
        timeoutMs: 45000,
        dedupe: false,
      });
      result.clientContract = clientContractSmoke();
      state.rcRegression = result;
      const clientFailed = Number(result.clientContract?.failed || 0);
      toast(result.status === 'blocked' || clientFailed ? 'Регрессионная проверка RC: есть пункты для проверки' : 'Регрессионная проверка RC завершена');
    } catch (e) {
      state.rcRegression = {
        status: 'blocked',
        label: e.message || 'Регрессионная проверка RC не выполнена.',
        score: 0,
        summary: { total: 0, passed: 0, warnings: 0, blockers: 1 },
        groups: {},
        checks: [],
        clientContract: clientContractSmoke(),
        policy: {},
      };
    } finally {
      state.rcRegressionLoading = false;
      renderRcRegression();
    }
  }

  return Object.freeze({
    renderRcRegression,
    loadRcRegression,
  });
}
