export function createAuthGrowthWiringRuntime(deps = {}) {
  const {
    DEVELOPMENT_TELEGRAM_ID,
    bumpTelemetry,
    createGrowthReferralRuntime,
    createUserAuthRuntime,
    hasSupabase,
    memory,
    normalizeReferralCode,
    opaqueReferralCode,
    pruneMemoryState,
    recordOpsEvent,
    redactOpsString,
    referralAttributionDecision,
    safeOpsMetadata,
    splitLaunchReferralParts,
    supaDelete,
    supaPatch,
    supaSelectOne,
    supaUpsert,
    validateTelegramInitData,
    withSingleFlight
  } = deps;

  const {
    getRequestUser,
    upsertUser,
    getUserRecord,
  } = createUserAuthRuntime({
    memory,
    validateTelegramInitData,
    developmentTelegramId: DEVELOPMENT_TELEGRAM_ID,
    hasSupabase,
    supaUpsert,
    supaSelectOne,
    withSingleFlight,
    pruneMemoryState,
    bumpTelemetry,
    recordOpsEvent,
  });

  const {
    cleanLaunchPart,
    parseLaunchStartParam,
    ensureLaunchAttribution,
    recordGrowthEvent,
    ensureReferralCode,
    applyReferralAttribution,
    recordReferredPayment,
    cleanupGrowthEvents,
  } = createGrowthReferralRuntime({
    memory,
    getUserRecord,
    hasSupabase,
    supaPatch,
    supaUpsert,
    supaSelectOne,
    supaDelete,
    safeOpsMetadata,
    redactOpsString,
    normalizeReferralCode,
    opaqueReferralCode,
    referralAttributionDecision,
    splitLaunchReferralParts,
  });

  return {
    getRequestUser,
    upsertUser,
    getUserRecord,
    cleanLaunchPart,
    parseLaunchStartParam,
    ensureLaunchAttribution,
    recordGrowthEvent,
    ensureReferralCode,
    applyReferralAttribution,
    recordReferredPayment,
    cleanupGrowthEvents,
  };
}
