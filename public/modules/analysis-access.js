function entitlementPayload(value = {}) {
  return value?.entitlement || value || {};
}

function positiveSafeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonNegativeSafeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizedPass(row = {}) {
  const type = String(row.type || '').toUpperCase();
  const usageLimit = row.usageLimit == null ? null : positiveSafeInteger(row.usageLimit);
  return {
    id: positiveSafeInteger(row.id),
    type: ['MATCH_PASS', 'DAY_PASS', 'WEEKEND_PASS'].includes(type) ? type : '',
    fixtureId: nonNegativeSafeInteger(row.fixtureId),
    usageLimit,
    usageCount: nonNegativeSafeInteger(row.usageCount),
  };
}

function passCandidate(entitlement = {}, fixtureId = 0) {
  const rows = Array.isArray(entitlement?.passes?.active)
    ? entitlement.passes.active.map(normalizedPass)
    : [];
  const fid = positiveSafeInteger(fixtureId);
  const eligible = rows.filter(row =>
    row.id &&
    row.type &&
    (row.type !== 'WEEKEND_PASS' || row.usageLimit !== null) &&
    (row.type === 'WEEKEND_PASS' || row.usageLimit === null) &&
    (row.type !== 'MATCH_PASS' || (fid !== null && row.fixtureId === fid)) &&
    (row.type === 'MATCH_PASS' || row.fixtureId === 0) &&
    (row.usageLimit == null || row.usageCount < row.usageLimit)
  );
  return eligible.find(row => row.usageLimit == null) || eligible[0] || null;
}

function updatedDecision(after = {}, candidate = null) {
  if (!candidate?.id) return null;
  const rows = Array.isArray(after?.decisions) ? after.decisions : [];
  return rows.find(row => Number(row?.id || 0) === Number(candidate.id)) || null;
}

function quotaLabel(plan, quota = {}) {
  const used = nonNegativeSafeInteger(quota?.used, null);
  const limit = positiveSafeInteger(quota?.limit);
  if (used !== null && limit !== null) {
    return `Использовано: ${plan} · ${Math.min(used, limit)}/${limit} сегодня`;
  }
  return `Использовано: ${plan}`;
}

export function buildAnalysisAccessUsage({
  analysis = {},
  entitlementBefore = {},
  entitlementAfter = {},
  profile = {},
  fixtureId = 0,
} = {}) {
  const before = entitlementPayload(entitlementBefore);
  const after = entitlementPayload(entitlementAfter);
  const quota = analysis?.quota || profile?.quota || {};

  if (analysis?.recheck?.free === true) {
    return {
      kind: 'free_recheck',
      label: 'Без списания · бесплатная перепроверка',
      detail: 'Pass и дневная квота не расходуются.',
    };
  }

  if (analysis?.cached === true) {
    return {
      kind: 'cached',
      label: 'Открыт сохранённый AI-разбор',
      detail: nonNegativeSafeInteger(quota?.left, null) !== null
        ? `Осталось по дневной квоте: ${nonNegativeSafeInteger(quota.left, 0)}.`
        : '',
    };
  }

  if (before?.source === 'subscription') {
    const plan = String(before?.effectiveTier || before?.plan || quota?.plan || 'PRO').toUpperCase();
    return {
      kind: 'subscription',
      label: quotaLabel(plan, quota),
      detail: 'Расширенный доступ предоставлен активной подпиской.',
    };
  }

  if (before?.source === 'pass') {
    const candidate = passCandidate(before, fixtureId);
    if (candidate) {
      const decision = updatedDecision(after, candidate);
      const decisionLimit = decision?.usageLimit == null ? null : positiveSafeInteger(decision.usageLimit);
      const usageLimit = decision?.usageLimit == null ? candidate.usageLimit : decisionLimit;
      const decisionCount = decision?.usageCount == null ? null : nonNegativeSafeInteger(decision.usageCount, null);
      const usageCount = decisionCount == null
        ? (usageLimit == null ? candidate.usageCount : Math.min(usageLimit, candidate.usageCount + 1))
        : (usageLimit == null ? decisionCount : Math.min(usageLimit, decisionCount));

      if (candidate.type === 'MATCH_PASS') {
        return {
          kind: 'pass',
          passType: candidate.type,
          label: 'Использовано: Match Pass · только этот матч',
          detail: 'Другие матчи используют собственный доступ или дневную FREE-квоту.',
        };
      }
      if (candidate.type === 'DAY_PASS') {
        return {
          kind: 'pass',
          passType: candidate.type,
          label: 'Использовано: Day Pass · все матчи',
          detail: 'Доступ действует для поддерживаемых матчей в течение оплаченного периода.',
        };
      }
      if (candidate.type === 'WEEKEND_PASS') {
        const limit = Number(usageLimit || 0);
        const remaining = limit > 0 ? Math.max(0, limit - usageCount) : null;
        return {
          kind: 'pass',
          passType: candidate.type,
          label: limit > 0
            ? `Использовано: Weekend Pass · ${usageCount}/${limit} AI-анализов`
            : 'Использовано: Weekend Pass',
          detail: remaining == null ? '' : `Осталось анализов: ${remaining}.`,
        };
      }
    }
  }

  const plan = String(quota?.plan || profile?.billing?.plan || profile?.plan || 'FREE').toUpperCase();
  return {
    kind: 'quota',
    label: quotaLabel(plan, quota),
    detail: plan === 'FREE'
      ? 'Pass для этого анализа не использовался.'
      : 'Использована дневная квота текущего тарифа.',
  };
}

function defaultEscapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function analysisAccessUsageHtml(access = {}, escapeHtml = defaultEscapeHtml) {
  const label = String(access?.label || '').trim();
  if (!label) return '';
  const detail = String(access?.detail || '').trim();
  return `<div class="experience-health-row analysis-access-row"><span class="quality-pill">🔐 ${escapeHtml(label)}</span>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>`;
}
