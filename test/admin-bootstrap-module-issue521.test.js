import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminBootstrapModule } from '../public/modules/admin-bootstrap.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('admin bootstrap module exposes extracted contract',()=>{
  assert.equal(typeof createAdminBootstrapModule,'function');
  const module=createAdminBootstrapModule({});
  for(const name of [
    'outcomeShortLabel',
    'ensureAdminModelQualityModule',
    'renderModelQuality',
    'loadModelQuality',
    'ensureAdminCalibrationControlModule',
    'renderCalibrationControl',
    'loadCalibrationControl',
    'runCalibrationControlAction',
    'ensureAdminModelRemediationModule',
    'renderModelRemediation',
    'loadModelRemediation',
    'runModelRemediation',
    'resolveSettlementDriftFromUi',
    'resetSettlementCircuitFromUi',
    'openProfileView',
    'ensureAdminReleaseReadinessModule',
    'renderReleaseReadiness',
    'loadReleaseReadiness',
    'diagPct',
    'diagDuration',
    'diagnosticsStateLabel',
    'ensureAdminProductionReadinessModule',
    'renderProductionReadiness',
    'loadProductionReadiness',
    'runClientContractSmoke',
    'ensureAdminRcRegressionModule',
    'renderRcRegression',
    'loadRcRegression',
    'ensureAdminRuntimeControlsModule',
    'renderRuntimeControls',
    'loadRuntimeControlsAdmin',
    'saveRuntimeControls',
    'restoreRuntimeDefaults',
    'ensureAdminReminderHealthModule',
    'renderReminderHealth',
    'loadReminderHealth',
    'sendReminderTest',
    'ensureAdminReleaseMonitorModule',
    'renderReleaseMonitor',
    'loadReleaseMonitor',
    'transitionPostDeployRegressionResponse',
    'ensureAdminMediaPublisherModule',
    'generateMediaPublisherLink',
    'copyMediaPublisherPost',
    'ensureAdminLaunchFunnelModule',
    'renderLaunchFunnel',
    'acknowledgeRecoveryIncident',
    'loadLaunchFunnel',
    'ensureAdminDiagnosticsModule',
    'renderDiagnostics',
    'loadDiagnostics',
    'openActivePassMatches',
    'ensureBillingModule',
    'renderBilling',
    'loadBilling',
    'showQuotaPaywall',
    'showQuotaPaywallForFixture',
    'hideQuotaPaywall',
    'openPassStoreForFixture',
    'ensureAdminProviderModule',
    'renderProvider',
    'renderProviderAudit',
    'renderExpandedDataReleaseGate',
    'loadProvider',
    'probeProvider',
    'runProviderCoverageAudit',
    'runProviderE2E',
    'loadFavorites',
    'loadReminders',
    'handleReminderRemove',
    'savePreferencesFromUi',
    'favoriteSet',
    'isFavorite',
    'favoriteMutationSelector',
    'syncFavoriteMutationUi',
    'toggleFavorite',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes admin bootstrap instead of keeping it inline',()=>{
  assert.match(app,/import \{ createAdminBootstrapModule \} from '\.\/modules\/admin-bootstrap\.js'/);
  assert.match(app,/createAdminBootstrapModule\(\{/);
  assert.doesNotMatch(app,/async function ensureAdminModelQualityModule\(\) \{/);
  assert.doesNotMatch(app,/async function loadReleaseMonitor\(\.\.\.args\) \{/);
  assert.doesNotMatch(app,/async function ensureAdminProviderModule\(\) \{/);
});
