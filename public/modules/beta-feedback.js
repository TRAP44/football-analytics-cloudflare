const FEEDBACK_CATEGORIES = new Set(['search', 'matches', 'ai', 'live', 'ux', 'data_sources', 'performance']);
const FEEDBACK_SEVERITIES = new Set(['BLOCKER', 'MAJOR', 'MINOR']);

export function createBetaFeedbackModule({
  state,
  elementById,
  api,
  schedule,
}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || typeof elementById !== 'function'
    || typeof api !== 'function') {
    throw new TypeError('Beta Feedback requires state, elementById and api.');
  }

  const $ = elementById;
  const scheduleTask = typeof schedule === 'function' ? schedule : (fn, ms) => setTimeout(fn, ms);
  let interactionRevision = 0;

  function setStatus(message = '') {
    const status = $('betaFeedbackStatus');
    if (status) status.textContent = String(message || '');
  }

  function setBetaFeedbackOpen(open) {
    const form = $('betaFeedbackForm');
    const button = $('betaFeedbackOpenBtn');
    if (!form || !button) return;

    const shouldOpen = open === true;
    interactionRevision += 1;
    form.hidden = !shouldOpen;
    button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');

    if (shouldOpen) {
      setStatus('');
      $('betaFeedbackNote')?.focus();
    }
  }

  async function submitBetaFeedback() {
    if (state.betaFeedbackSending) return;

    const category = String($('betaFeedbackCategory')?.value || '').trim().toLowerCase();
    const severity = String($('betaFeedbackSeverity')?.value || '').trim().toUpperCase();
    const noteElement = $('betaFeedbackNote');
    const note = String(noteElement?.value || '').trim();

    if (!FEEDBACK_CATEGORIES.has(category)) {
      setStatus('Выберите раздел проблемы.');
      return;
    }
    if (!FEEDBACK_SEVERITIES.has(severity)) {
      setStatus('Выберите важность проблемы.');
      return;
    }
    if (note.length < 5) {
      setStatus('Кратко опишите, что произошло.');
      return;
    }

    state.betaFeedbackSending = true;
    const sendButton = $('betaFeedbackSendBtn');
    if (sendButton) sendButton.disabled = true;
    setStatus('Отправляю…');

    try {
      await api('/api/beta-feedback', {
        method: 'POST',
        body: JSON.stringify({ category, severity, note }),
        timeoutMs: 6500,
        retry: false,
        dedupe: false,
      });

      setStatus('Спасибо. Сообщение отправлено и добавлено в журнал обратной связи.');
      if (noteElement) noteElement.value = '';

      const successRevision = interactionRevision;
      scheduleTask(() => {
        const currentNote = String($('betaFeedbackNote')?.value || '').trim();
        if (interactionRevision === successRevision && !currentNote) setBetaFeedbackOpen(false);
      }, 900);
    } catch (error) {
      setStatus(error?.message || 'Не удалось отправить сообщение.');
    } finally {
      state.betaFeedbackSending = false;
      if (sendButton) sendButton.disabled = false;
    }
  }

  return Object.freeze({
    setBetaFeedbackOpen,
    submitBetaFeedback,
  });
}
