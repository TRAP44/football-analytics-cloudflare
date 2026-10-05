function stableErrorCode(error) {
  const raw = String(error?.code || error?.name || 'WRITE_FAILED').trim().toUpperCase();
  return raw.replace(/[^A-Z0-9_:-]/g, '_').slice(0, 80) || 'WRITE_FAILED';
}

export async function recordCriticalWriteFailure({
  recordOpsEvent,
  cfg,
  source,
  eventType,
  code,
  message,
  meta = {},
  error,
}) {
  if (typeof recordOpsEvent !== 'function') return null;
  try {
    await recordOpsEvent(cfg, {
      severity: 'error',
      source: String(source || 'write').slice(0, 40),
      eventType: String(eventType || 'write_failure').slice(0, 80),
      code: String(code || 'CRITICAL_WRITE_FAILED').slice(0, 100),
      message: String(message || 'Critical write failed.').slice(0, 240),
      meta: {
        ...meta,
        errorCode: stableErrorCode(error),
      },
    });
  } catch {
    // Ops reporting must never replace the original best-effort user-visible behavior.
  }
  return null;
}
