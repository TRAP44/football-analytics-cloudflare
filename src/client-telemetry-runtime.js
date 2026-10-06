// Client telemetry ingestion and Phase 5 request tagging extracted from worker.js.
// Identity, growth and ops-event primitives are injected by the composition root.
export function createClientTelemetryRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Client telemetry runtime dependencies are required.');
  }
  const {
    CLIENT_ACTION_ERROR_KINDS,
    CLIENT_ACTION_ERROR_REASONS,
    CLIENT_PRODUCT_ACTIONS,
    CLIENT_TELEMETRY_EVENTS,
    CLIENT_TIMING_OPERATIONS,
    CLOSED_BETA_COHORT,
    bytesToHex,
    enc,
    ensureLaunchAttribution,
    hmacSha256,
    isAdminUser,
    isClosedBetaUser,
    isTelegramValidatedUser,
    json,
    memory,
    pruneMemoryState,
    recordGrowthEvent,
    recordOpsEvent,
    redactOpsString,
  } = deps;

  async function closedBetaTelemetrySubject(user, cfg = {}) {
    if (!isClosedBetaUser(user, cfg) || !cfg.botToken) return '';
    try {
      const digest=await hmacSha256(enc.encode(cfg.botToken),`${CLOSED_BETA_COHORT}:${Number(user.id)}`);
      return bytesToHex(digest).slice(0,32);
    } catch {
      return '';
    }
  }
  
  
  const PHASE5_VALIDATION_COHORT = 'phase5_public_v2';
  const PHASE5_SESSION_HEADER = 'x-phase5-session';
  const PHASE5_PROVIDER_KINDS = new Set(['search','matches_feed','match_center','ai','live_refresh']);
  
  function phase5ValidationRequestKind(url) {
    const path=String(url?.pathname || '');
    if (path==='/api/search') return 'search';
    if (path==='/api/matches') return 'matches_feed';
    if (path==='/api/match-center') return url?.searchParams?.has('t') ? 'live_refresh' : 'match_center';
    if (path==='/api/analyze') return 'ai';
    return '';
  }
  
  async function phase5ValidationContext(request,user,cfg,url) {
    if (!isTelegramValidatedUser(user) || isAdminUser(user,cfg) || !cfg.botToken) return null;
    const rawSession=String(request?.headers?.get(PHASE5_SESSION_HEADER) || '').trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(rawSession)) return null;
    try {
      const subjectDigest=await hmacSha256(enc.encode(cfg.botToken),`${PHASE5_VALIDATION_COHORT}:user:${Number(user.id)}`);
      const sessionDigest=await hmacSha256(enc.encode(cfg.botToken),`${PHASE5_VALIDATION_COHORT}:session:${Number(user.id)}:${rawSession}`);
      return {
        cohort:PHASE5_VALIDATION_COHORT,
        verified:true,
        subject:bytesToHex(subjectDigest).slice(0,32),
        session:bytesToHex(sessionDigest).slice(0,32),
        requestKind:phase5ValidationRequestKind(url),
      };
    } catch {
      return null;
    }
  }
  
  function phase5ProviderUsage(cfg,key,amount=1) {
    const context=cfg?.phase5Validation;
    if (!context?.verified || !PHASE5_PROVIDER_KINDS.has(String(context.requestKind || ''))) return;
    const usage=cfg.phase5ProviderUsage ||= {networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};
    usage[key]=Number(usage[key] || 0)+Math.max(0,Number(amount || 0));
  }
  
  function phase5ProviderCacheUsage(cfg,cacheKey,key) {
    const name=String(cacheKey || '');
    if (!name || /(quota|cooldown|compute-lock|runtime|webhook|attribution)/i.test(name)) return;
    phase5ProviderUsage(cfg,key,1);
  }
  
  async function recordPhase5ProviderRequestSummary(cfg) {
    const context=cfg?.phase5Validation;
    if (!context?.verified || !PHASE5_PROVIDER_KINDS.has(String(context.requestKind || ''))) return;
    const usage=cfg.phase5ProviderUsage || {};
    await recordOpsEvent(cfg,{
      severity:'info',
      source:'phase5',
      eventType:'provider_usage',
      code:'PHASE5_PROVIDER_USAGE',
      message:'Aggregated provider usage for one verified normal-user request.',
      endpoint:String(context.requestKind || ''),
      meta:{
        validationCohort:PHASE5_VALIDATION_COHORT,
        validationVerified:true,
        validationSubject:String(context.subject || ''),
        validationSession:String(context.session || ''),
        requestKind:String(context.requestKind || ''),
        networkRequests:Number(usage.networkRequests || 0),
        cacheHits:Number(usage.cacheHits || 0),
        staleCacheHits:Number(usage.staleCacheHits || 0),
        quotaBlocks:Number(usage.quotaBlocks || 0),
        sharedCooldowns:Number(usage.sharedCooldowns || 0),
      },
    });
  }
  
  const CLIENT_TELEMETRY_VIEWS = new Set([
    'matchesView',
    'myTeamsView',
    'searchView',
    'tournamentView',
    'teamView',
    'analysisView',
    'historyView',
    'profileView',
    'unknown',
  ]);
  
  function finiteTelemetryNumber(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function boundedTelemetryNumber(value, min, max) {
    const parsed = finiteTelemetryNumber(value);
    return parsed === null ? null : Math.max(min, Math.min(max, Math.round(parsed)));
  }

  function clientTelemetryMetadata(body = {}, event = '') {
    const meta = body?.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) ? body.meta : {};
    const rawReason = String(meta.reason || '').trim().toLowerCase();
    const rawErrorKind = String(meta.errorKind || '').trim().toLowerCase();
    const rawView = String(meta.view || '').trim();
    const rawDurationMs = finiteTelemetryNumber(meta.durationMs);
    const reason = event === 'product_action'
      ? (CLIENT_PRODUCT_ACTIONS.has(rawReason) ? rawReason : '')
      : event === 'action_error'
        ? (CLIENT_ACTION_ERROR_REASONS.has(rawReason) ? rawReason : '')
        : event === 'operation_timing'
          ? (CLIENT_TIMING_OPERATIONS.has(rawReason) ? rawReason : '')
          : redactOpsString(rawReason, 80);
    const errorKind = event === 'action_error'
      ? (CLIENT_ACTION_ERROR_KINDS.has(rawErrorKind) ? rawErrorKind : 'unknown')
      : redactOpsString(rawErrorKind, 60);
    const out = {
      clientVersion: redactOpsString(meta.clientVersion || '', 40),
      apiContract: finiteTelemetryNumber(meta.apiContract),
      releaseChannel: redactOpsString(meta.releaseChannel || '', 30),
      view: CLIENT_TELEMETRY_VIEWS.has(rawView) ? rawView : 'unknown',
      networkMode: redactOpsString(meta.networkMode || '', 30),
      bootMs: boundedTelemetryNumber(meta.bootMs, 0, 60000),
      durationMs: event === 'operation_timing' ? boundedTelemetryNumber(rawDurationMs, 0, 120000) : null,
      moduleReadyMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.moduleReadyMs, 0, 60000) : null,
      navigationReadyMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.navigationReadyMs, 0, 60000) : null,
      responseEndMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.responseEndMs, 0, 60000) : null,
      domContentLoadedMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.domContentLoadedMs, 0, 60000) : null,
      firstContentfulPaintMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.firstContentfulPaintMs, 0, 60000) : null,
      manifestMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.manifestMs, 0, 60000) : null,
      identityMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.identityMs, 0, 60000) : null,
      feedMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.feedMs, 0, 60000) : null,
      revealDelayMs: event === 'boot_ok' ? boundedTelemetryNumber(meta.revealDelayMs, 0, 5000) : null,
      viewportWidth: event === 'boot_ok' ? boundedTelemetryNumber(meta.viewportWidth, 200, 2400) : null,
      matchMode: event === 'data_coverage' && ['upcoming','live','finished'].includes(String(meta.matchMode || '').toLowerCase())
        ? String(meta.matchMode || '').toLowerCase()
        : null,
      lineupsAvailable: event === 'data_coverage' && typeof meta.lineupsAvailable === 'boolean' ? meta.lineupsAvailable : null,
      injuriesAvailable: event === 'data_coverage' && typeof meta.injuriesAvailable === 'boolean' ? meta.injuriesAvailable : null,
      statisticsAvailable: event === 'data_coverage' && typeof meta.statisticsAvailable === 'boolean' ? meta.statisticsAvailable : null,
      xgAvailable: event === 'data_coverage' && typeof meta.xgAvailable === 'boolean' ? meta.xgAvailable : null,
      oddsAvailable: event === 'data_coverage' && typeof meta.oddsAvailable === 'boolean' ? meta.oddsAvailable : null,
      manifestOk: typeof meta.manifestOk === 'boolean' ? meta.manifestOk : null,
      degraded: typeof meta.degraded === 'boolean' ? meta.degraded : null,
      blocking: typeof meta.blocking === 'boolean' ? meta.blocking : null,
      reason,
      errorKind,
      startParam: String(meta.startParam || '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,64),
    };
    return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== null && value !== ''));
  }
  
  async function apiClientTelemetry(request, cfg, user) {
    let body = {};
    try { body = await request.json(); } catch {}
    const event = String(body?.event || '').trim().toLowerCase();
    if (!CLIENT_TELEMETRY_EVENTS.has(event)) {
      return json({ ok: false, error: 'Unsupported telemetry event.' }, 400);
    }
  
    const meta = clientTelemetryMetadata(body, event);
    if (event === 'product_action' && !meta.reason) return json({ ok: false, error: 'Unsupported product action.' }, 400);
    if (event === 'action_error' && !meta.reason) return json({ ok: false, error: 'Unsupported action error.' }, 400);
    if (event === 'operation_timing' && (!meta.reason || !Number.isFinite(Number(meta.durationMs)))) {
      return json({ ok: false, error: 'Unsupported operation timing.' }, 400);
    }
    if (event === 'data_coverage' && (
      !meta.matchMode
      || ['lineupsAvailable','injuriesAvailable','statisticsAvailable','xgAvailable','oddsAvailable']
        .some(key=>typeof meta[key] !== 'boolean')
    )) {
      return json({ ok: false, error: 'Unsupported data coverage telemetry.' }, 400);
    }
    const shouldDedupe = event !== 'operation_timing';
    if (shouldDedupe) {
      const dedupePart = event === 'data_coverage'
        ? `${meta.matchMode}:${Number(meta.lineupsAvailable)}${Number(meta.injuriesAvailable)}${Number(meta.statisticsAvailable)}${Number(meta.xgAvailable)}${Number(meta.oddsAvailable)}`
        : (meta.reason || meta.errorKind || meta.view || '');
      const validationSession=String(cfg?.phase5Validation?.session || '');
      const dedupeKey = `${Number(user.id)}:${event}:${meta.clientVersion || ''}:${validationSession}:${dedupePart}`;
      const last = Number(memory.clientTelemetryDedupe.get(dedupeKey) || 0);
      if (last && Date.now() - last < 5 * 60 * 1000) {
        return json({ ok: true, deduped: true });
      }
      memory.clientTelemetryDedupe.set(dedupeKey, Date.now());
      if (memory.clientTelemetryDedupe.size > 1500) pruneMemoryState();
    }
  
    const validation=cfg?.phase5Validation;
    const phase5Meta=validation?.verified
      ? {
          validationCohort:PHASE5_VALIDATION_COHORT,
          validationVerified:true,
          validationSubject:String(validation.subject || ''),
          validationSession:String(validation.session || ''),
        }
      : {};
    const betaParticipant=isClosedBetaUser(user, cfg);
    const betaSubject=betaParticipant ? await closedBetaTelemetrySubject(user,cfg) : '';
    const betaMeta=betaParticipant && betaSubject
      ? { betaCohort:CLOSED_BETA_COHORT,betaMembershipVerified:true,betaSubject }
      : {};
    // Closed-beta client telemetry is kept out of growth_events because that legacy
    // table requires a raw Telegram ID. The privacy-safe beta view is sourced from
    // ops_events with an HMAC-derived subject that is never returned by the API.
    if (!betaParticipant && event === 'boot_ok') {
      const attribution=await ensureLaunchAttribution(user.id,meta.startParam || '',cfg);
      void recordGrowthEvent(cfg,{userId:user.id,eventName:'miniapp_open',channel:'miniapp',attribution,metadata:{view:meta.view || '',clientVersion:meta.clientVersion || '',releaseChannel:meta.releaseChannel || ''}});
    }
    if (!betaParticipant && event === 'product_action') {
      void recordGrowthEvent(cfg,{
        userId:user.id,
        eventName:`miniapp_${meta.reason}`,
        channel:'miniapp',
        metadata:{view:meta.view || 'unknown',clientVersion:meta.clientVersion || '',releaseChannel:meta.releaseChannel || ''},
      });
    }
    if (!betaParticipant && event === 'action_error') {
      void recordGrowthEvent(cfg,{
        userId:user.id,
        eventName:'miniapp_error',
        channel:'miniapp',
        metadata:{action:meta.reason,errorKind:meta.errorKind || 'unknown',view:meta.view || 'unknown',clientVersion:meta.clientVersion || '',releaseChannel:meta.releaseChannel || ''},
      });
    }
    const severity = ['compatibility_block', 'client_error'].includes(event)
      || (event === 'action_error' && !['offline','rate_limit'].includes(meta.errorKind))
      ? 'warning'
      : 'info';
    await recordOpsEvent(cfg, {
      severity,
      source: 'client',
      eventType: 'client_telemetry',
      code: event.toUpperCase(),
      message: `Client event: ${event}`,
      endpoint: '/api/client-telemetry',
      durationMs: event === 'operation_timing' ? meta.durationMs : null,
      meta:{...meta,...phase5Meta,...betaMeta},
    });
    return json({ ok: true, deduped: false });
  }

  return {
    closedBetaTelemetrySubject,
    phase5ValidationRequestKind,
    phase5ValidationContext,
    phase5ProviderUsage,
    phase5ProviderCacheUsage,
    recordPhase5ProviderRequestSummary,
    clientTelemetryMetadata,
    apiClientTelemetry,
  };
}
