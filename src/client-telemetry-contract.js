export const CLIENT_TELEMETRY_EVENT_TYPE = 'client_telemetry';

export const CLIENT_TELEMETRY_CODES = Object.freeze({
  BOOT_OK: 'BOOT_OK',
  PRODUCT_ACTION: 'PRODUCT_ACTION',
  ACTION_ERROR: 'ACTION_ERROR',
  NETWORK_RECOVERY: 'NETWORK_RECOVERY',
  CLIENT_ERROR: 'CLIENT_ERROR',
  COMPATIBILITY_BLOCK: 'COMPATIBILITY_BLOCK',
});

export const BOOT_OK_REQUIRED_METADATA = Object.freeze([
  'deploySha',
  'viewportWidth',
  'bootMs',
  'moduleReadyMs',
  'navigationReadyMs',
  'feedMs',
]);

export function canonicalClientTelemetrySelector(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!Object.values(CLIENT_TELEMETRY_CODES).includes(normalized)) {
    throw new TypeError(`Unsupported client telemetry code: ${normalized || '(empty)'}`);
  }
  return Object.freeze({
    eventType: CLIENT_TELEMETRY_EVENT_TYPE,
    code: normalized,
  });
}

export function assessClientTelemetryEvidence(rows = [], {
  code = CLIENT_TELEMETRY_CODES.BOOT_OK,
  requiredMetadata = code === CLIENT_TELEMETRY_CODES.BOOT_OK ? BOOT_OK_REQUIRED_METADATA : [],
} = {}) {
  const selector = canonicalClientTelemetrySelector(code);
  const samples = Array.isArray(rows) ? rows : [];
  const matching = samples.filter(row =>
    String(row?.event_type || '') === selector.eventType
    && String(row?.code || '').toUpperCase() === selector.code
  );

  if (!matching.length) {
    return Object.freeze({
      status: 'insufficient_evidence',
      sampleCount: 0,
      completeSampleCount: 0,
      selector,
      missingMetadata: [...requiredMetadata],
    });
  }

  const complete = matching.filter(row => {
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return requiredMetadata.every(field => metadata[field] !== undefined && metadata[field] !== null && metadata[field] !== '');
  });

  const missingMetadata = requiredMetadata.filter(field =>
    !matching.some(row => {
      const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      return metadata[field] !== undefined && metadata[field] !== null && metadata[field] !== '';
    })
  );

  return Object.freeze({
    status: complete.length ? 'confirmed' : 'incomplete_samples',
    sampleCount: matching.length,
    completeSampleCount: complete.length,
    selector,
    missingMetadata,
  });
}

export function clientTelemetrySqlWhere(code = CLIENT_TELEMETRY_CODES.BOOT_OK) {
  const selector = canonicalClientTelemetrySelector(code);
  return `event_type = '${selector.eventType}' and code = '${selector.code}'`;
}
