import {buildExplanationFacts,composeExplanation} from './match-explanation-runtime.js';

const MAX_ANSWER_FACTS=3;

/** Готовые подсказки — детерминированный выбор фактов по ролям и типам. */
export function presetAnswerIds(preset, facts = []) {
  const list = Array.isArray(facts) ? facts : [];
  const byPriority = rows => rows.slice().sort((a, b) => b.priority - a.priority);
  const pick = rows => byPriority(rows).slice(0, MAX_ANSWER_FACTS).map(fact => fact.id);
  if (preset === 'why') {
    const lead = list.filter(fact => fact.id === 'model_lead' || fact.id === 'model_balance').slice(0, 1);
    if (!lead.length) return [];
    return [lead[0].id, ...pick(list.filter(fact => fact.role === 'support')).slice(0, MAX_ANSWER_FACTS - 1)];
  }
  if (preset === 'risk') return pick(list.filter(fact => fact.role === 'risk' || fact.role === 'caveat'));
  if (preset === 'form') return pick(list.filter(fact => /^form_|^h2h$/.test(fact.id)));
  if (preset === 'squad') return pick(list.filter(fact => /^lineups_|^absences_/.test(fact.id)));
  return [];
}


// Included only in the delivered full analysis: no model call, history lookup
// or extra cache read is needed when the fan opens a prepared question.
export function buildMatchQuestionPresets(payload) {
  const rawId=payload?.match?.fixtureId;
  const fixtureId=typeof rawId==='number' || (typeof rawId==='string' && /^\d+$/.test(rawId)) ? Number(rawId) : 0;
  if (!Number.isSafeInteger(fixtureId) || fixtureId<=0) return null;
  const facts=buildExplanationFacts(payload);
  const presets={};
  for (const preset of ['why','risk','form','squad']) {
    const items=composeExplanation(facts,presetAnswerIds(preset,facts));
    presets[preset]={available:true,answer:items.length ? 'facts' : 'not_in_data',items,source:'preset'};
  }
  return {fixtureId,presets};
}
