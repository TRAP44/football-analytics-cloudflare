function entitlementPayload(value = {}) {
  return value?.entitlement || value || {};
}

function normalizedPass(row = {}) {
  return {
    id: row.id ?? null,
    type: String(row.type || '').toUpperCase(),
    fixtureId: Number(row.fixtureId || 0),
    usageLimit: row.usageLimit == null ? null : Number(row.usageLimit),
    usageCount: Math.max(0, Number(row.usageCount || 0)),
  };
}

function passCandidate(entitlement = {}, fixtureId = 0) {
  const rows = Array.isArray(entitlement?.passes?.active)
    ? entitlement.passes.active.map(normalizedPass)
    : [];
  const fid = Number(fixtureId || 0);
  const eligible = rows.filter(row => row.type !== 'MATCH_PASS' || (fid > 0 && row.fixtureId === fid));
  return eligible.find(row => row.usageLimit == null) || eligible[0] || null;
}

function updatedDecision(after = {}, candidate = null) {
  if (!candidate?.id) return null;
  const rows = Array.isArray(after?.decisions) ? after.decisions : [];
  return rows.find(row => Number(row?.id || 0) === Number(candidate.id)) || null;
}

function quotaLabel(plan, quota = {}) {
  const used = Number(quota?.used);
  const limit = Number(quota?.limit);
  if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) {
    return `Использовано: ${plan} · ${Math.max(0, used)}/${Math.max(0, limit)} сегодня`;
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
      detail: Number.isFinite(Number(quota?.left)) ? `Осталось по дневной квоте: ${Number(quota.left)}.` : '',
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
      const usageLimit = decision?.usageLimit == null ? candidate.usageLimit : Number(decision.usageLimit);
      const usageCount = decision?.usageCount == null
        ? (usageLimit == null ? candidate.usageCount : Math.min(usageLimit, candidate.usageCount + 1))
        : Math.max(0, Number(decision.usageCount || 0));

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

export function analysisAccessUsageHtml(access = {}, escapeHtml = value => String(value ?? '')) {
  const label = String(access?.label || '').trim();
  if (!label) return '';
  const detail = String(access?.detail || '').trim();
  return `<div class="experience-health-row analysis-access-row"><span class="quality-pill">🔐 ${escapeHtml(label)}</span>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>`;
}
