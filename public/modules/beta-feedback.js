export function createBetaFeedbackModule({
  state,
  elementById,
  api,
  schedule,
}) {
  if (!state || typeof elementById !== 'function' || typeof api !== 'function') {
    throw new TypeError('Beta Feedback requires state, elementById and api.');
  }

  const $ = elementById;
  const scheduleTask = typeof schedule === 'function' ? schedule : (fn, ms) => setTimeout(fn, ms);

  function setBetaFeedbackOpen(open) {
    const form=$('betaFeedbackForm');
    const button=$('betaFeedbackOpenBtn');
    if (!form || !button) return;
    form.hidden=!open;
    button.setAttribute('aria-expanded',open?'true':'false');
    if (open) $('betaFeedbackNote')?.focus();
  }
  
  async function submitBetaFeedback() {
    if (state.betaFeedbackSending) return;
    const category=String($('betaFeedbackCategory')?.value || '');
    const severity=String($('betaFeedbackSeverity')?.value || '');
    const note=String($('betaFeedbackNote')?.value || '').trim();
    const status=$('betaFeedbackStatus');
    if (note.length<5) {
      if (status) status.textContent='Кратко опишите, что произошло.';
      return;
    }
    state.betaFeedbackSending=true;
    if ($('betaFeedbackSendBtn')) $('betaFeedbackSendBtn').disabled=true;
    if (status) status.textContent='Отправляю…';
    try {
      await api('/api/beta-feedback',{method:'POST',body:JSON.stringify({category,severity,note}),timeoutMs:6500,retry:false,dedupe:false});
      if (status) status.textContent='Спасибо. Сообщение добавлено в beta-наблюдение.';
      if ($('betaFeedbackNote')) $('betaFeedbackNote').value='';
      scheduleTask(()=>setBetaFeedbackOpen(false),900);
    } catch (error) {
      if (status) status.textContent=error.message || 'Не удалось отправить сообщение.';
    } finally {
      state.betaFeedbackSending=false;
      if ($('betaFeedbackSendBtn')) $('betaFeedbackSendBtn').disabled=false;
    }
  }

  return Object.freeze({
    setBetaFeedbackOpen,
    submitBetaFeedback,
  });
}
