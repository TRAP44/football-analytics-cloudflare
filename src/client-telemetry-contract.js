export const CLIENT_TELEMETRY_EVENT_TYPE = 'client_telemetry';

export const CLIENT_TELEMETRY_CODES = Object.freeze({
  BOOT_OK: 'BOOT_OK',
  BOOT_RECOVERY: 'BOOT_RECOVERY',
  PRODUCT_ACTION: 'PRODUCT_ACTION',
  ACTION_ERROR: 'ACTION_ERROR',
  NETWORK_RECOVERY: 'NETWORK_RECOVERY',
  CLIENT_ERROR: 'CLIENT_ERROR',
  COMPATIBILITY_BLOCK: 'COMPATIBILITY_BLOCK',
  OPERATION_TIMING: 'OPERATION_TIMING',
  DATA_COVERAGE: 'DATA_COVERAGE',
});

export const BOOT_OK_REQUIRED_METADATA = Object.freeze([
  'deploySha',
  'viewportWidth',
  'bootMs',
  'moduleReadyMs',
  'navigationReadyMs',
  'feedMs',
]);

const SHA_RE = /^[0-9a-f]{40}$/i;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bootMetadataFieldValid(field, value) {
  if (field === 'deploySha') return typeof value === 'string' && SHA_RE.test(value.trim());
  if (field === 'viewportWidth') {
    const number = finiteNumber(value);
    return number !== null && Number.isInteger(number) && number >= 200 && number <= 2400;
  }
  if (['bootMs','moduleReadyMs','navigationReadyMs','feedMs'].includes(field)) {
    const number = finiteNumber(value);
    return number !== null && Number.isInteger(number) && number >= 0 && number <= 60000;
  }
  return value !== undefined && value !== null && value !== '';
}

function telemetryMetadataFieldValid(code, field, value) {
  return code === CLIENT_TELEMETRY_CODES.BOOT_OK
    ? bootMetadataFieldValid(field, value)
    : value !== undefined && value !== null && value !== '';
}

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

export function assessClientTelemetryEvidence(rows = [], options = {}) {
  const code = options?.code ?? CLIENT_TELEMETRY_CODES.BOOT_OK;
  const selector = canonicalClientTelemetrySelector(code);
  const defaultRequiredMetadata = selector.code === CLIENT_TELEMETRY_CODES.BOOT_OK
    ? BOOT_OK_REQUIRED_METADATA
    : [];
  const requiredMetadata = options?.requiredMetadata === undefined
    ? defaultRequiredMetadata
    : Array.isArray(options.requiredMetadata)
      ? [...new Set(options.requiredMetadata.map(field => String(field || '').trim()).filter(Boolean))]
      : defaultRequiredMetadata;
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
    const metadata = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {};
    return requiredMetadata.every(field => telemetryMetadataFieldValid(selector.code, field, metadata[field]));
  });

  const missingMetadata = requiredMetadata.filter(field =>
    !matching.some(row => {
      const metadata = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {};
      return telemetryMetadataFieldValid(selector.code, field, metadata[field]);
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
