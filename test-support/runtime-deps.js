// Dependencies unrelated to a focused test must fail if they are exercised.
function unused(name) {
  return () => { throw new Error(`Unexpected test dependency: ${name}`); };
}

export function settlementDependencies(overrides = {}) {
  const names = [
    'actualOutcomeFromGoals', 'brierFromProbabilities', 'buildSettlementDriftResolution',
    'bytesToHex', 'fetchWithTimeout', 'fixtureIdentity', 'fixtureStatusShort',
    'freeQuotaHealthy', 'getCache', 'hasSupabase', 'isFinishedStatus',
    'loadProviderFixturesForDate', 'loadRuntimeControls', 'parseJsonObject',
    'predictionOutcomeKey', 'probeOptionalTable', 'providerSnapshot', 'recordOpsEvent',
    'redactOpsString', 'regulationScore', 'scoreBrier', 'setCache',
    'signalProbabilitySnapshot', 'stalePredictionCandidates', 'supaHeaders',
    'supaInsertIgnore', 'supaPatch', 'supaSelectMany', 'supaSelectOne',
    'supaSelectPaged', 'supaUpsert', 'todayUtc',
  ];
  return {
    ...Object.fromEntries(names.map(name => [name, unused(name)])),
    memory: { modelPredictions: new Map(), modelRemediation: { actions: [] } },
    SETTLEMENT_DRIFT_ACTIONS: new Set(),
    enc: new TextEncoder(),
    ...overrides,
  };
}

export function userDataDependencies(overrides = {}) {
  const names = ["addFavorite", "addFavoritePlayer", "addReminder", "analysisFreshness", "analysisResponsePayload", "getBotDigestSubscription", "getCache", "getFavoritePlayers", "getFavorites", "getHistory", "getPreferences", "getQuota", "getReminders", "getStaleCache", "getUserRecord", "isAdminUser", "json", "publicDataCapabilities", "publicDigestSettings", "publicPlayerFollowNotificationContract", "publicRuntimeControls", "publicSiteUrl", "publicSmartNotificationCapabilities", "recordOpsEvent", "reminderDeliveryStatus", "removeFavorite", "removeFavoritePlayer", "removeReminder", "savePreferences", "setBotDigestSubscription"];
  return { ...Object.fromEntries(names.map(name => [name, unused(name)])), ...overrides };
}
