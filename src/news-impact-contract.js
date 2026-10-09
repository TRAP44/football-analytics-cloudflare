// News Impact contract values retained across runtime extraction.
export const NEWS_IMPACT_ACTION_WINDOW_MINUTES = 30;

export const NEWS_IMPACT_FAILURE_CODES = new Set([
  'provider_rate_limit','provider_unavailable','quota_exhausted','analysis_warming',
  'match_missing','invalid_fixture','data_invalid','telegram_delivery','timeout','server_error',
]);

export const NEWS_IMPACT_FUNNEL_MIN_USERS = 10;

export const NEWS_IMPACT_FUNNEL_STABLE_USERS = 30;

export const NEWS_IMPACT_OUTCOME_WINDOW_MINUTES = 5;

export const NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS = 15;

export const NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS = 20;

export const NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS = 10;

export const NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES = 120;

export const NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT = 'news_impact_recovery_incident_ack';

export const NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES = 30;

export const NEWS_IMPACT_RECOVERY_INCIDENT_CODES = new Set(['performance_drift','recent_regression']);

export const NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES = 360;

export const NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES = 30;

export const NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS = 10;

export const NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS = 7;

export const NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS = 30;

export const NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS = 30;

export const NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS = 5;

export const NEWS_IMPACT_RECOVERY_WINDOW_MINUTES = 5;

export const NEWS_IMPACT_ACTION_CODES = new Set(['full_ai','squads','market','recheck','news','share']);

export const NEWS_IMPACT_ACTION_LABELS = {
  full_ai:'Полный AI',
  squads:'Составы',
  market:'Рынок',
  recheck:'Перепроверка',
  news:'Новости',
  share:'Поделиться',
};

export const NEWS_IMPACT_DECISION_CODES = new Set(['material','detail','stable','guarded','baseline_missing','unavailable']);

export const NEWS_IMPACT_FAILURE_LABELS = {
  provider_rate_limit:'Лимит источника данных',
  provider_unavailable:'Источник данных недоступен',
  quota_exhausted:'Дневной лимит AI',
  analysis_warming:'AI уже рассчитывается',
  match_missing:'Матч недоступен',
  invalid_fixture:'Некорректный матч',
  data_invalid:'Данные матча противоречивы',
  telegram_delivery:'Доставка в Telegram',
  timeout:'Тайм-аут',
  server_error:'Временная серверная ошибка',
};

export const NEWS_IMPACT_FUNNEL_DECISIONS = [
  ['material','🔴 Существенное изменение'],
  ['detail','🟡 Изменились детали'],
  ['stable','🟢 Сценарий стабилен'],
  ['guarded','🟦 Причинность не подтверждается'],
  ['baseline_missing','⚪ Нет базового снимка'],
  ['unavailable','🟠 Перепроверка недоступна'],
];

export const NEWS_IMPACT_OUTCOME_CODES = {
  full_ai:'analysis_delivered',
  squads:'section_delivered',
  market:'section_delivered',
  recheck:'recheck_delivered',
  news:'news_delivered',
  share:'share_card_delivered',
};

export const NEWS_IMPACT_RECOVERY_CODES = new Set([
  'retry','retry_soon','retry_later','wait_quota_reset','open_search','open_full_ai',
]);

export const NEWS_IMPACT_RECOVERY_LABELS = {
  retry:'повторить',
  retry_soon:'повторить через несколько секунд',
  retry_later:'повторить позже',
  wait_quota_reset:'дождаться обновления лимита',
  open_search:'вернуться к поиску',
  open_full_ai:'открыть полный AI',
};

export const NEWS_IMPACT_RECOVERY_STRATEGY_CACHE_MS = 300_000;

export const NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES = new Set([
  'fixed_default','baseline_sample','no_significant_better','significant_better',
  'stability_sample','recent_regression','stable_significant_better','performance_drift',
  'supabase_unavailable','truncated','load_failed','evidence_unavailable',
]);
