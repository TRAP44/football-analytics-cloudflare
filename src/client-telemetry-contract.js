export const CLIENT_TELEMETRY_EVENT_TYPE = 'client_telemetry';

export const CLIENT_TELEMETRY_EVENTS = Object.freeze([
  'boot_ok',
  'boot_recovery',
  'compatibility_block',
  'network_recovery',
  'client_error',
  'product_action',
  'action_error',
  'operation_timing',
  'data_coverage',
]);

export const CLIENT_TELEMETRY_CODES = Object.freeze(
  Object.fromEntries(CLIENT_TELEMETRY_EVENTS.map(event => [event, event.toUpperCase()])),
);

export const BOOT_TELEMETRY_REQUIRED_METADATA = Object.freeze([
  'deploySha',
  'bootMs',
  'moduleReadyMs',
  'navigationReadyMs',
  'manifestMs',
  'identityMs',
  'feedMs',
  'revealDelayMs',
  'viewportWidth',
]);

export function clientTelemetryCode(event = '') {
  const normalized = String(event || '').trim().toLowerCase();
  return CLIENT_TELEMETRY_CODES[normalized] || '';
}

export function clientTelemetryOpsFilter(event = '') {
  const code = clientTelemetryCode(event);
  if (!code) return null;
  return Object.freeze({
    source: 'client',
    eventType: CLIENT_TELEMETRY_EVENT_TYPE,
    code,
  });
}

export function isClientTelemetryOpsRow(row = {}, event = '') {
  const filter = clientTelemetryOpsFilter(event);
  if (!filter) return false;
  return String(row?.source || '') === filter.source
    && String(row?.event_type || '') === filter.eventType
    && String(row?.code || '') === filter.code;
}

export function bootTelemetryEvidence(row = {}) {
  const errors = [];
  if (!isClientTelemetryOpsRow(row, 'boot_ok')) {
    errors.push('row_contract');
  }

  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const deploySha = String(metadata.deploySha || '').trim();
  if (!/^[0-9a-f]{7,64}$/i.test(deploySha)) errors.push('deploy_sha');

  for (const key of BOOT_TELEMETRY_REQUIRED_METADATA) {
    if (key === 'deploySha') continue;
    const value = Number(metadata[key]);
    if (!Number.isFinite(value) || value < 0) errors.push(key);
  }

  const viewportWidth = Number(metadata.viewportWidth);
  if (Number.isFinite(viewportWidth) && (viewportWidth < 200 || viewportWidth > 2400)) {
    errors.push('viewport_range');
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    deploySha,
    viewportWidth: Number.isFinite(viewportWidth) ? viewportWidth : null,
    timings: Object.freeze({
      bootMs: numberOrNull(metadata.bootMs),
      moduleReadyMs: numberOrNull(metadata.moduleReadyMs),
      navigationReadyMs: numberOrNull(metadata.navigationReadyMs),
      responseEndMs: numberOrNull(metadata.responseEndMs),
      domContentLoadedMs: numberOrNull(metadata.domContentLoadedMs),
      firstContentfulPaintMs: numberOrNull(metadata.firstContentfulPaintMs),
      manifestMs: numberOrNull(metadata.manifestMs),
      identityMs: numberOrNull(metadata.identityMs),
      feedMs: numberOrNull(metadata.feedMs),
      revealDelayMs: numberOrNull(metadata.revealDelayMs),
    }),
  });
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}
