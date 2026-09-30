export function createAdminReleaseReadinessModule({
  state,
  elementById,
  isAdmin,
  escapeHtml,
  humanizeTechnicalText,
  relativeAge,
  api,
  renderProvider,
  renderDiagnostics,
}) {
  if (!state || typeof elementById !== 'function' || typeof isAdmin !== 'function' || typeof api !== 'function') {
    throw new TypeError('Admin Release Readiness requires state, elementById, isAdmin and api.');
  }

  const $ = elementById;
  const refreshProvider = typeof renderProvider === 'function' ? renderProvider : () => {};
  const refreshDiagnostics = typeof renderDiagnostics === 'function' ? renderDiagnostics : () => {};

  function releaseStateLabel(value) {
    const map = { ready: 'Готово', warning: 'Почти готово', blocked: 'Блокировано' };
    return map[String(value || '')] || 'Нет данных';
  }

  function renderReleaseReadiness() {
    if (!isAdmin()) return;
    const root = $('releaseStatus');
    const badge = $('releaseBadge');
    const checksEl = $('releaseChecks');
    const meta = $('releaseMeta');
    if (!root || !badge || !checksEl) return;
    if (state.releaseReadinessLoading) {
      badge.textContent = 'Проверка'; badge.className = 'release-badge waiting';
      root.textContent = 'Проверяю обязательные зависимости ядра…';
      checksEl.innerHTML = '';
      if (meta) meta.textContent = '';
      return;
    }
    const r = state.releaseReadiness;
    if (!r?.available) {
      badge.textContent = 'Нет данных'; badge.className = 'release-badge';
      root.textContent = r?.reason || 'Проверка ещё не запускалась.';
      checksEl.innerHTML = '';
      return;
    }
    badge.textContent = releaseStateLabel(r.status);
    badge.className = `release-badge ${escapeHtml(r.status || '')}`;
    root.textContent = r.label || 'Проверка завершена.';
    if (meta) meta.textContent = `${Number(r.score || 0)}% · ${relativeAge(r.generatedAt)}`;
    checksEl.innerHTML = (r.checks || []).map(x => `
      <div class="release-check ${escapeHtml(x.state || 'warn')}">
        <i>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : '!'}</i>
        <span><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></span>
      </div>`).join('') || '<div class="empty compact-empty">Нет результатов проверки.</div>';
  }

  async function loadReleaseReadiness(force = false) {
    if (!isAdmin()) return;
    if (state.releaseReadinessLoading) return;
    if (!force && state.releaseReadiness) { renderReleaseReadiness(); return; }
    state.releaseReadinessLoading = true;
    renderReleaseReadiness();
    try {
      state.releaseReadiness = await api(`/api/release-readiness${force ? '?refresh=1' : ''}`);
      if (state.releaseReadiness?.diagnostics) {
        state.diagnostics = state.releaseReadiness.diagnostics;
        if (state.diagnostics?.provider) {
          state.provider = state.diagnostics.provider;
          state.providerObservability = state.diagnostics.providerObservability || state.providerObservability;
          refreshProvider();
        }
        refreshDiagnostics();
      }
    } catch (e) {
      state.releaseReadiness = { available: false, reason: e.message || 'Не удалось выполнить проверку готовности.' };
    } finally {
      state.releaseReadinessLoading = false;
      renderReleaseReadiness();
    }
  }

  return Object.freeze({
    renderReleaseReadiness,
    loadReleaseReadiness,
  });
}
