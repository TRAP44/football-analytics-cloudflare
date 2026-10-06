export function createServiceWiringRuntime(deps = {}) {
  const {
    SMART_NOTIFICATION_POLICY,
    bumpTelemetry,
    bytesToHex,
    createEntitlementService,
    createFavoritePlayersService,
    createImportantChangeNotificationService,
    createLineupNotificationService,
    createReminderDeliveryService,
    createReminderDeliveryStore,
    createScheduledLeaseRuntime,
    createSmartNotificationAudience,
    createSmartNotificationDeliveryService,
    createSmartNotificationService,
    createTelegramDedupeRuntime,
    createUserFavoritesService,
    createUserHistoryService,
    createUserPreferencesService,
    createUserRemindersService,
    enc,
    fetchWithTimeout,
    getAnalysisTimelineSnapshots,
    getOddsSnapshots,
    getUserRecord,
    hasSupabase,
    hmacSha256,
    loadLineupNotificationSnapshot,
    loadRuntimeControls,
    loadSmartNotificationEventSnapshot,
    markTelegramWebhookMutation,
    memory,
    pruneMemoryState,
    recordOpsEvent,
    redactOpsString,
    sendTelegramMessage,
    supaHeaders,
    supaRpc,
    supaSelectMany,
    supaSelectOne,
    supaSelectPaged,
    supaUpsert
  } = deps;

  const {
    claimScheduledJob,
    completeScheduledJob,
    releaseScheduledJob,
  } = createScheduledLeaseRuntime({
    hasSupabase,
    supaRpc,
    recordOpsEvent,
    redactOpsString,
  });
  
  const {
    getPreferences,
    savePreferences,
  } = createUserPreferencesService({
    memory,
    hasSupabase,
    supaSelectOne,
    supaUpsert,
  });
  
  const {
    recordHistory,
    getHistory,
  } = createUserHistoryService({
    memory,
    hasSupabase,
    supaUpsert,
    supaSelectMany,
    recordOpsEvent,
    bumpTelemetry,
    redactOpsString,
    correlationId: async (userId, fixtureId, cfg) => {
      if (!cfg?.botToken) return `fixture-${Number(fixtureId || 0)}`;
      const digest = await hmacSha256(
        enc.encode(cfg.botToken),
        `analysis-history:${Number(userId)}:${Number(fixtureId)}`,
      );
      return bytesToHex(digest).slice(0, 24);
    },
  });
  
  const {
    activatePassPurchase,
    listUserEntitlements,
    refundEntitlementUsage,
    refundPassByCharge,
    reserveEntitlementUsage,
    resolveUserEntitlements,
  } = createEntitlementService({
    memory,
    hasSupabase,
    supaSelectMany,
    supaRpc,
    getUserRecord: (...args) => getUserRecord(...args),
    markWebhookMutation: markTelegramWebhookMutation,
  });
  
  const {
    filterRecipients: filterSmartNotificationRecipients,
    loadFavoritePlayersByUser: loadFavoritePlayersForSmartNotifications,
  } = createSmartNotificationAudience({
    hasSupabase,
    supaSelectMany,
    getPreferences,
    getUserRecord: (...args) => getUserRecord(...args),
    getFavoritePlayers: (...args) => getFavoritePlayers(...args),
  });
  
  const {
    reminderDeliveryStatus,
    clearStaleReminderClaims,
    claimReminderDelivery,
    markReminderDeliverySending,
    holdReminderDeliveryUnknown,
    finishReminderDelivery,
    releaseReminderClaim,
  } = createReminderDeliveryStore({
    hasSupabase,
    fetchWithTimeout,
    supaHeaders,
    recordOpsEvent,
    redactOpsString,
  });
  
  const {
    deliverClaimedReminder,
    processDueReminders,
  } = createReminderDeliveryService({
    hasSupabase,
    loadRuntimeControls,
    clearStaleReminderClaims,
    supaSelectPaged,
    recordOpsEvent,
    sendTelegramMessage,
    claimReminderDelivery,
    markReminderDeliverySending,
    holdReminderDeliveryUnknown,
    finishReminderDelivery,
    releaseReminderClaim,
    filterNotificationRecipients: filterSmartNotificationRecipients,
  });
  
  const {
    processLineupNotifications,
  } = createLineupNotificationService({
    hasSupabase,
    loadRuntimeControls,
    supaSelectPaged,
    loadLineupNotificationSnapshot,
    deliverClaimedReminder,
    filterNotificationRecipients: filterSmartNotificationRecipients,
    recordOpsEvent,
    maxFixturesPerRun: 4,
  });
  
  const {
    processImportantChangeNotifications,
  } = createImportantChangeNotificationService({
    hasSupabase,
    loadRuntimeControls,
    supaSelectPaged,
    getOddsSnapshots,
    deliverClaimedReminder,
    filterNotificationRecipients: filterSmartNotificationRecipients,
    recordOpsEvent,
    maxFixturesPerRun: 12,
    thresholdPp: SMART_NOTIFICATION_POLICY.marketThresholdPp,
  });
  
  const {
    getFavorites,
    addFavorite,
    removeFavorite,
  } = createUserFavoritesService({
    memory,
    hasSupabase,
    supaSelectMany,
    supaRpc,
    fetchWithTimeout,
    supaHeaders,
  });
  
  const {
    getFavoritePlayers,
    addFavoritePlayer,
    removeFavoritePlayer,
  } = createFavoritePlayersService({
    memory,
    hasSupabase,
    supaSelectMany,
    supaRpc,
    fetchWithTimeout,
    supaHeaders,
  });
  
  const {
    deliverSmartNotification,
  } = createSmartNotificationDeliveryService({
    memory,
    hasSupabase,
    supaRpc,
    sendTelegramMessage,
    recordOpsEvent,
  });
  
  const {
    processSmartNotifications,
  } = createSmartNotificationService({
    hasSupabase,
    loadRuntimeControls,
    supaSelectPaged,
    filterRecipients: filterSmartNotificationRecipients,
    loadFavoritePlayersByUser: loadFavoritePlayersForSmartNotifications,
    loadLiveNotificationSnapshot: loadSmartNotificationEventSnapshot,
    loadLineupSnapshot: loadLineupNotificationSnapshot,
    getAnalysisTimelineSnapshots,
    deliverSmartNotification,
    recordOpsEvent,
    maxFixturesPerRun: SMART_NOTIFICATION_POLICY.maxFixturesPerRun,
    aiThresholdPp: SMART_NOTIFICATION_POLICY.aiProbabilityThresholdPp,
    aiCooldownSeconds: SMART_NOTIFICATION_POLICY.aiCooldownSeconds,
    radarConfidenceThreshold: SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
    radarOutcomeThreshold: SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
    radarCooldownSeconds: SMART_NOTIFICATION_POLICY.radarCooldownSeconds,
  });
  
  const {
    getReminders,
    addReminder,
    removeReminder,
  } = createUserRemindersService({
    memory,
    hasSupabase,
    supaSelectMany,
    supaRpc,
    fetchWithTimeout,
    supaHeaders,
    getPreferences,
  });
  
  const {
    claimTelegramUpdate,
    completeTelegramUpdate,
    releaseTelegramUpdate,
    claimTelegramUpdatePersistent,
    completeTelegramUpdatePersistent,
    releaseTelegramUpdatePersistent,
    telegramPersistentDedupeSelfTest,
    readTelegramDedupeHealth,
    telegramDedupeObservabilitySelfTest,
    enforceTelegramBurst,
  } = createTelegramDedupeRuntime({
    memory,
    pruneMemoryState,
    bumpTelemetry,
    hasSupabase,
    supaRpc,
    redactOpsString,
  });

  return {
    claimScheduledJob,
    completeScheduledJob,
    releaseScheduledJob,
    getPreferences,
    savePreferences,
    recordHistory,
    getHistory,
    activatePassPurchase,
    listUserEntitlements,
    refundEntitlementUsage,
    refundPassByCharge,
    reserveEntitlementUsage,
    resolveUserEntitlements,
    filterSmartNotificationRecipients,
    loadFavoritePlayersForSmartNotifications,
    reminderDeliveryStatus,
    clearStaleReminderClaims,
    claimReminderDelivery,
    markReminderDeliverySending,
    holdReminderDeliveryUnknown,
    finishReminderDelivery,
    releaseReminderClaim,
    deliverClaimedReminder,
    processDueReminders,
    processLineupNotifications,
    processImportantChangeNotifications,
    getFavorites,
    addFavorite,
    removeFavorite,
    getFavoritePlayers,
    addFavoritePlayer,
    removeFavoritePlayer,
    deliverSmartNotification,
    processSmartNotifications,
    getReminders,
    addReminder,
    removeReminder,
    claimTelegramUpdate,
    completeTelegramUpdate,
    releaseTelegramUpdate,
    claimTelegramUpdatePersistent,
    completeTelegramUpdatePersistent,
    releaseTelegramUpdatePersistent,
    telegramPersistentDedupeSelfTest,
    readTelegramDedupeHealth,
    telegramDedupeObservabilitySelfTest,
    enforceTelegramBurst
  };
}
