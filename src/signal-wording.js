// Нейтральные формулировки AI-сигнала. MatchRadar — аналитический сервис,
// а не подсказчик ставок: вместо «Пропустить ставку» говорим, что уверенного
// вывода нет. Старые подписи из истории и кеша приводим к новой при выдаче.
export const NO_CLEAR_SIGNAL_LABEL = 'Без уверенного вывода';

const LEGACY_SKIP_LABEL = /^\s*пропустить\s+ставку\s*$/i;

export function publicSignalLabel(label) {
  if (typeof label !== 'string') return '';
  return LEGACY_SKIP_LABEL.test(label) ? NO_CLEAR_SIGNAL_LABEL : label;
}

export function withPublicSignalLabel(payload) {
  const signal = payload?.aiInstructor?.betSignal;
  if (!signal || typeof signal !== 'object' || typeof signal.label !== 'string') return payload;
  const label = publicSignalLabel(signal.label);
  if (label === signal.label) return payload;
  return {
    ...payload,
    aiInstructor: { ...payload.aiInstructor, betSignal: { ...signal, label } },
  };
}
