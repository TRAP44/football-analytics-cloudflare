export function createAdminCalibrationControlModule({
  state,
  elementById,
  isAdmin,
  escapeHtml,
  humanizeTechnicalText,
  relativeAge,
  api,
  toast,
  confirmAction,
  refreshModelQuality,
}) {
  if (
    !state ||
    typeof elementById !== 'function' ||
    typeof isAdmin !== 'function' ||
    typeof api !== 'function' ||
    typeof toast !== 'function' ||
    typeof confirmAction !== 'function' ||
    typeof refreshModelQuality !== 'function'
  ) {
    throw new TypeError('Admin Calibration Control requires state, DOM, admin, API and lifecycle callbacks.');
  }

  const $ = elementById;

  function calibrationTransitionLabel(action) {
    return ({
      initialize: 'Инициализация',
      promote: 'Новая активная модель',
      rollback: 'Автооткат',
      manual_rollback: 'Ручной откат',
      freeze: 'Заморозка',
      unfreeze: 'Разморозка',
    })[String(action || '')] || String(action || 'Переход');
  }
  
  function shortFingerprint(value) {
    return value ? String(value).slice(0, 12) : '—';
  }
  
  function renderCalibrationControl() {
    const status = $('calibrationControlStatus');
    const summary = $('calibrationControlSummary');
    const history = $('calibrationControlHistory');
    const freezeBtn = $('calibrationFreezeBtn');
    const unfreezeBtn = $('calibrationUnfreezeBtn');
    const rollbackBtn = $('calibrationRollbackBtn');
    if (!status || !summary || !history || !freezeBtn || !unfreezeBtn || !rollbackBtn) return;
  
    const saving = state.calibrationControlSaving;
    const data = state.calibrationControl;
    if (state.calibrationControlLoading) {
      status.textContent = 'Загружаю состояние жизненного цикла…';
      summary.innerHTML = '';
      history.innerHTML = '';
    } else if (!data?.available) {
      status.textContent = data?.reason || 'Жизненный цикл пока недоступен.';
      summary.innerHTML = '';
      history.innerHTML = '';
    } else {
      status.textContent = data.frozen
        ? `Переходы заморожены${data.freezeReason ? `: ${data.freezeReason}` : '.'}`
        : 'Автоматическое продвижение и откат разрешены.';
      summary.innerHTML = `
        <div><span>Состояние</span><strong>${data.frozen ? 'ЗАМОРОЖЕНО' : 'АКТИВНО'}</strong><small>версия ${Number(data.revision || 0)}</small></div>
        <div><span>Активная модель</span><strong>${escapeHtml(shortFingerprint(data.activeFingerprint))}</strong><small>активный отпечаток</small></div>
        <div><span>Предыдущий</span><strong>${escapeHtml(shortFingerprint(data.previousFingerprint))}</strong><small>цель отката</small></div>`;
      history.innerHTML = (data.transitions || []).length
        ? `<div class="model-remediation-history-head"><strong>Последние переходы</strong><span>идентификатор оператора скрыт</span></div>${data.transitions.slice(0, 8).map(row => `
            <div class="model-remediation-history-row">
              <div><strong>${escapeHtml(calibrationTransitionLabel(row.action))}</strong><span>${escapeHtml(humanizeTechnicalText(row.reason || ''))}</span></div>
              <small>r${Number(row.expectedRevision || 0)} → r${Number(row.resultingRevision || 0)} · ${escapeHtml(relativeAge(row.createdAt))}</small>
            </div>`).join('')}`
        : '<div class="empty compact-empty">Переходов пока нет.</div>';
    }
  
    const frozen = Boolean(data?.frozen);
    freezeBtn.hidden = frozen;
    unfreezeBtn.hidden = !frozen;
    freezeBtn.disabled = saving || !data?.available;
    unfreezeBtn.disabled = saving || !data?.available;
    rollbackBtn.disabled = saving || !data?.available || !data?.previousFingerprint;
  }
  
  async function loadCalibrationControl(force = false) {
    if (!isAdmin() || state.calibrationControlLoading) return;
    if (!force && state.calibrationControl) return renderCalibrationControl();
    state.calibrationControlLoading = true;
    renderCalibrationControl();
    try {
      state.calibrationControl = await api('/api/calibration-control');
    } catch (error) {
      state.calibrationControl = { available: false, reason: error.message || 'Не удалось загрузить состояние жизненного цикла.' };
    } finally {
      state.calibrationControlLoading = false;
      renderCalibrationControl();
    }
  }
  
  async function runCalibrationControlAction(action) {
    if (!isAdmin() || state.calibrationControlSaving) return;
    const reason = String($('calibrationControlReason')?.value || '').trim();
    if (reason.length < 5) return toast('Укажите причину действия — минимум 5 символов.');
    const labels = { freeze: 'заморозить автоматические переходы', unfreeze: 'разморозить автоматические переходы', manual_rollback: 'вернуть предыдущую активную модель' };
    if (!confirmAction(`Подтвердить действие: ${labels[action] || action}?`)) return;
    state.calibrationControlSaving = true;
    renderCalibrationControl();
    try {
      state.calibrationControl = await api('/api/calibration-control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, reason }),
        retry: false,
        dedupe: false,
      });
      if ($('calibrationControlReason')) $('calibrationControlReason').value = '';
      toast('Состояние калибровки обновлено атомарно.');
      await refreshModelQuality(true);
    } catch (error) {
      toast(error.message || 'Не удалось изменить состояние калибровки.');
      state.calibrationControl = null;
      await loadCalibrationControl(true);
    } finally {
      state.calibrationControlSaving = false;
      renderCalibrationControl();
    }
  }

  return Object.freeze({
    renderCalibrationControl,
    loadCalibrationControl,
    runCalibrationControlAction,
  });
}
