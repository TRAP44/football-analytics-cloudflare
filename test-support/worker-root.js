import { readFileSync } from 'node:fs';
// Import the actual composition root with test-only exports, keeping production
// exports unchanged and resolving its real relative module dependencies.
const workerUrl = new URL('../src/worker.js', import.meta.url);
const source = readFileSync(workerUrl, 'utf8').replace(
  /from (['"])(\.\/[^'"]+)\1/g,
  (_, quote, specifier) => `from ${quote}${new URL(specifier, workerUrl).href}${quote}`,
);
export const factories = ["getCommonInfrastructureRuntime", "getRouteSecurityRuntime", "getTelemetryOpsRuntime", "getSharedCacheRuntime", "getMaintenanceRuntime", "getTelegramCampaignRuntime", "getGrowthAnalyticsRuntime", "getQuotaUsageRuntime", "getBillingRuntime", "getTelegramLinksRuntime", "getPublisherRuntime", "getTelegramBotUiRuntime", "getNewsImpactRecoveryRuntime", "getTelegramBotOrchestrationRuntime", "getTelegramDigestRuntime", "getTelegramSearchRuntime", "getBillingApiRuntime", "getChannelPublishIdempotencyRuntime", "getDistributedAnalysisLockRuntime", "getPredictionMathRuntime", "getCalibrationRuntime", "getAiTimelineRuntime", "getLivePressureTimelineRuntime", "getModelEvaluationRuntime", "getPostMatchReturnRuntime", "getClientTelemetryRuntime", "getBetaPhase5Runtime", "getProviderSloRuntime", "getReleaseMonitorApiRuntime", "getProductionMonitorRuntime", "getSupabaseSchemaRuntime", "getReleaseReadinessRuntime", "getFootballNewsRuntime", "getLiveMatchIntelligenceRuntime", "getOddsSnapshotRuntime", "getModelIntelligenceRuntime", "getMatchFormattingRuntime", "getUserDataApiRuntime", "getSearchDiscoveryRuntime", "getProviderFixtureRuntime", "getTeamTournamentRuntime", "getTeamIntelligenceRuntime", "getRefereeIntelligenceRuntime", "getAnalysisQualityRuntime", "getAnalysisLifecycleRuntime", "getMatchCenterRuntime", "getAnalysisContextRuntime", "getAnalysisRuntime"];
export const workerRuntime = await import(`data:text/javascript,${encodeURIComponent(
  `${source}\nexport { ${[...factories, 'telegramPersistentDedupeSelfTest', 'telegramDedupeObservabilitySelfTest'].join(', ')} };`,
)}`);

