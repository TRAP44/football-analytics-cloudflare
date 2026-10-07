export function createWorkerBootstrapRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Worker bootstrap dependencies are required.');
  }

  const {
    API_ROUTE_DEPS,
    bumpTelemetry,
    closedBetaAccessDecision,
    cloudflareEdgeGuard,
    config,
    createPreAuthAbuseGuard,
    dispatchApiRoute,
    enforceDistributedAccountRateLimit,
    enforceDistributedPreAuthRateLimit,
    enforceRouteBurst,
    getRequestUser,
    handleScheduled,
    handleTelegramWebhook,
    hasSupabase,
    isAdminSensitivePath,
    isFootballRateLimitError,
    isSecurityLockdownControls,
    json,
    loadRuntimeControls,
    memory,
    phase5ValidationContext,
    preAuthRequestShapeDecision,
    publicDataCapabilities,
    publicRouteError,
    publicStatusRouter,
    reconcileAnalysisUsageReservations,
    recordOpsEvent,
    recordPhase5ProviderRequestSummary,
    redactOpsString,
    runtimeGuard,
    supaRpc
  } = deps;

  if (!API_ROUTE_DEPS || typeof API_ROUTE_DEPS !== 'object' || Array.isArray(API_ROUTE_DEPS)) {
    throw new TypeError('API_ROUTE_DEPS is required');
  }
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }
  if (!publicStatusRouter || typeof publicStatusRouter.handle !== 'function') {
    throw new TypeError('publicStatusRouter is required');
  }

  const requiredFunctions={
    bumpTelemetry,
    closedBetaAccessDecision,
    cloudflareEdgeGuard,
    config,
    createPreAuthAbuseGuard,
    dispatchApiRoute,
    enforceDistributedAccountRateLimit,
    enforceDistributedPreAuthRateLimit,
    enforceRouteBurst,
    getRequestUser,
    handleScheduled,
    handleTelegramWebhook,
    hasSupabase,
    isAdminSensitivePath,
    isFootballRateLimitError,
    isSecurityLockdownControls,
    json,
    loadRuntimeControls,
    phase5ValidationContext,
    preAuthRequestShapeDecision,
    publicDataCapabilities,
    publicRouteError,
    reconcileAnalysisUsageReservations,
    recordOpsEvent,
    recordPhase5ProviderRequestSummary,
    redactOpsString,
    runtimeGuard,
    supaRpc,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try {
      Object.getPrototypeOf(value);
      return value;
    } catch {
      return null;
    }
  }

  function safeRead(value,key) {
    if (!value || typeof value !== 'object') return undefined;
    try { return value[key]; } catch { return undefined; }
  }

  function safeText(value,max=120,fallback='') {
    let text='';
    if (typeof value === 'string') text=value;
    else if (typeof value === 'number' && Number.isFinite(value)) text=String(value);
    else if (typeof value === 'boolean') text=String(value);
    else return fallback;
    return text.slice(0,Math.max(1,Math.min(1000,max)));
  }

  function safeTelemetry(key) {
    try { bumpTelemetry(key); } catch {}
  }

  async function safeRecord(cfg,event) {
    try {
      await recordOpsEvent(cfg,event);
      return true;
    } catch {
      return false;
    }
  }

  async function safePhase5Summary(cfg) {
    try {
      await recordPhase5ProviderRequestSummary(cfg);
      return true;
    } catch {
      safeTelemetry('phase5SummaryErrors');
      return false;
    }
  }

  function safeRedact(value,max=240) {
    try {
      const redacted=redactOpsString(value,max);
      return typeof redacted === 'string' ? redacted.slice(0,max) : 'Worker boundary error';
    } catch {
      return 'Worker boundary error';
    }
  }

  function boundedStatus(value,fallback=500) {
    const number=typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
    return Number.isSafeInteger(number) && number>=100 && number<=599 ? number : fallback;
  }

  function boundedRetryAfter(value,fallback=null,max=604800) {
    const number=typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
    if (!Number.isFinite(number) || number<=0) return fallback;
    return Math.min(max,Math.max(1,Math.ceil(number)));
  }

  function buildConfig(env,ctx) {
    const raw=config(env);
    if (!plainObject(raw)) throw new TypeError('config() must return an object');
    const cfg={...raw};
    if (typeof ctx?.waitUntil === 'function') {
      cfg.waitUntil=promise=>ctx.waitUntil(Promise.resolve(promise));
    }
    return cfg;
  }

  function scheduledTimestamp(controller) {
    const value=controller?.scheduledTime;
    if (typeof value === 'number' && Number.isFinite(value) && value>=0 && value<=8.64e15) return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      const number=Number(value.trim());
      if (Number.isSafeInteger(number) && number>=0 && number<=8.64e15) return number;
    }
    return null;
  }

  function validScheduledTimestamp(controller) {
    const timestamp=scheduledTimestamp(controller);
    return timestamp !== null && timestamp > 0 ? timestamp : null;
  }

  function safeProviderCapabilities() {
    try {
      const value=publicDataCapabilities();
      return plainObject(value) || {};
    } catch {
      return {};
    }
  }

  function normalizeEdgeGuard(value) {
    const source=plainObject(value);
    if (!source) return null;
    const blocked=safeRead(source,'blocked');
    if (typeof blocked !== 'boolean') return null;
    return {
      blocked,
      degraded:safeRead(source,'degraded') === true,
      configured:safeRead(source,'configured') === true,
      kind:safeText(safeRead(source,'kind'),40),
      code:safeText(safeRead(source,'code'),80),
      policy:safeText(safeRead(source,'policy'),80),
      status:safeRead(source,'status'),
      retryAfter:safeRead(source,'retryAfter'),
    };
  }

  function normalizeSecurityShape(value) {
    const source=plainObject(value);
    if (!source) return null;
    const allowed=safeRead(source,'allowed');
    if (typeof allowed !== 'boolean') return null;
    return {
      allowed,
      code:safeText(safeRead(source,'code'),80),
      error:safeText(safeRead(source,'error'),240),
      status:safeRead(source,'status'),
    };
  }

  function normalizedPublicErrorBody(value) {
    const source=plainObject(value);
    if (!source) {
      return {
        error:'Сервис временно недоступен. Попробуйте повторить действие через несколько секунд.',
        code:'SERVER_ERROR',
        category:'service',
        recoverable:true,
      };
    }
    const retryAfter=boundedRetryAfter(safeRead(source,'retryAfter'),null);
    return {
      error:safeText(
        safeRead(source,'error'),
        500,
        'Сервис временно недоступен. Попробуйте повторить действие через несколько секунд.',
      ),
      code:safeText(safeRead(source,'code'),80,'SERVER_ERROR') || 'SERVER_ERROR',
      category:safeText(safeRead(source,'category'),80,'service') || 'service',
      recoverable:safeRead(source,'recoverable') === true,
      ...(retryAfter ? {retryAfter} : {}),
    };
  }

  function normalizedNewsImpactRecovery(value) {
    const source=plainObject(value);
    if (!source) return null;
    const code=safeText(safeRead(source,'code'),80);
    const action=safeText(safeRead(source,'action'),80);
    const message=safeText(safeRead(source,'message'),500);
    if (!code || !action || !message) return null;
    return {
      code,
      action,
      message,
      strategy:safeText(safeRead(source,'strategy'),40,'fixed') || 'fixed',
      guardReason:safeText(safeRead(source,'guardReason'),120),
      driftStatus:safeText(safeRead(source,'driftStatus'),80),
    };
  }

  async function guardUnavailable(cfg,url,code,message,telemetryKey='securityShapeBlocks') {
    safeTelemetry(telemetryKey);
    await safeRecord(cfg,{
      severity:'error',
      source:'security',
      eventType:'request_guard',
      code,
      message,
      endpoint:url.pathname,
      status:503,
    });
    return json({
      error:'Защитный контур временно недоступен. Повторите позже.',
      code,
      retryAfter:5,
    },503,{'retry-after':'5'});
  }

  return Object.freeze({
    async fetch(request, env, ctx) {
      let cfg;
      try {
        cfg=buildConfig(env,ctx);
      } catch {
        return json({
          error:'Конфигурация сервиса временно недоступна.',
          code:'WORKER_CONFIG_UNAVAILABLE',
        },503);
      }
      let url;
      try {
        url=new URL(typeof request?.url === 'string' ? request.url : '');
      } catch {
        return json({
          error:'Запрос не может быть безопасно обработан.',
          code:'REQUEST_URL_INVALID',
        },400);
      }
  
      let edgeGuard;
      try {
        edgeGuard=normalizeEdgeGuard(await cloudflareEdgeGuard(request,env));
      } catch {
        edgeGuard=null;
      }
      if (!edgeGuard) edgeGuard={blocked:false,degraded:true,configured:false,policy:'edge_guard_unavailable',kind:'',code:'',status:null,retryAfter:null};
      if (edgeGuard.blocked) {
        if (edgeGuard.kind === 'scanner') safeTelemetry('edgeScannerBlocks');
        else safeTelemetry('edgeRateLimitBlocks');
        const minuteBucket = new Date().toISOString().slice(0, 16);
        await safeRecord(cfg, {
          severity: 'warning',
          source: 'security',
          eventType: edgeGuard.kind === 'scanner' ? 'edge_scanner_block' : 'edge_rate_limit',
          code: edgeGuard.code,
          message: edgeGuard.kind === 'scanner'
            ? 'Obvious scanner traffic was rejected at the earliest Worker boundary.'
            : 'Cloudflare edge rate limiter rejected an abusive request burst.',
          endpoint: url.pathname,
          status: edgeGuard.status,
          transitionKey: `edge-security:${edgeGuard.policy || edgeGuard.kind}:${url.pathname}:${minuteBucket}`,
          meta: {
            policy:edgeGuard.policy,
            kind:edgeGuard.kind,
            retryAfter: boundedRetryAfter(edgeGuard.retryAfter,null),
            minuteBucket,
          },
        });
        const retryAfter=boundedRetryAfter(edgeGuard.retryAfter,null);
        const status=boundedStatus(edgeGuard.status,edgeGuard.kind === 'scanner' ? 404 : 429);
        return json({
          error: edgeGuard.kind === 'scanner' ? 'Not found.' : 'Слишком много запросов. Повторите позже.',
          code:edgeGuard.code || (edgeGuard.kind === 'scanner' ? 'EDGE_SCANNER_BLOCKED' : 'EDGE_RATE_LIMIT_BLOCKED'),
          ...(retryAfter ? {retryAfter} : {}),
        }, status, retryAfter ? { 'retry-after': String(retryAfter) } : {});
      }
      if (edgeGuard.degraded) {
        safeTelemetry('edgeRateLimitFallbacks');
        const now=Date.now();
        const previousWarningAt=scheduledTimestamp({scheduledTime:safeRead(memory,'edgeRateLimitWarningAt')}) || 0;
        if (now-previousWarningAt>=60_000) {
          try { memory.edgeRateLimitWarningAt=now; } catch {}
          await safeRecord(cfg, {
            severity: 'warning',
            source: 'security',
            eventType: 'edge_rate_limit',
            code: 'EDGE_RATE_LIMIT_DEGRADED',
            message: 'Cloudflare rate-limit binding was unavailable; existing Worker guards remain active.',
            endpoint: url.pathname,
            meta:{policy:edgeGuard.policy,configured:edgeGuard.configured},
          }).catch(() => {});
        }
      }
  
      let securityShape;
      try {
        securityShape=normalizeSecurityShape(await preAuthRequestShapeDecision(request,{
          api:url.pathname.startsWith('/api/'),
          webhook:url.pathname==='/telegram/webhook',
        }));
      } catch {
        securityShape=null;
      }
      if (!securityShape) {
        safeTelemetry('securityShapeBlocks');
        await safeRecord(cfg,{
          severity:'error',
          source:'security',
          eventType:'request_guard',
          code:'REQUEST_GUARD_UNAVAILABLE',
          message:'Pre-auth request guard returned an invalid decision.',
          endpoint:url.pathname,
          status:503,
        });
        return json({
          error:'Защитный контур временно недоступен. Повторите позже.',
          code:'REQUEST_GUARD_UNAVAILABLE',
          retryAfter:5,
        },503,{'retry-after':'5'});
      }
      if (!securityShape.allowed) {
        if (securityShape.code==='REQUEST_TOO_LARGE' || securityShape.code==='TELEGRAM_INIT_DATA_TOO_LARGE') safeTelemetry('securityOversizeBlocks');
        else if (String(securityShape.code || '').includes('CROSS_')) safeTelemetry('securityCrossOriginBlocks');
        else safeTelemetry('securityShapeBlocks');
        const minuteBucket=new Date().toISOString().slice(0,16);
        await safeRecord(cfg,{
          severity:'warning',
          source:'security',
          eventType:'request_guard',
          code:securityShape.code || 'REQUEST_REJECTED',
          message:'Public request blocked by the pre-auth security gate.',
          endpoint:url.pathname,
          status:boundedStatus(securityShape.status,400),
          transitionKey:'security-request-guard:' + (securityShape.code || 'REQUEST_REJECTED') + ':' + minuteBucket,
          meta:{
            method:safeText(request?.method || 'GET',16,'GET').toUpperCase(),
            minuteBucket,
          },
        });
        return json({
          error:securityShape.error || 'Запрос отклонён.',
          code:securityShape.code || 'REQUEST_REJECTED',
        },boundedStatus(securityShape.status,400));
      }
  
      let publicStatusResponse;
      try {
        publicStatusResponse=await publicStatusRouter.handle(request,url,cfg);
      } catch (error) {
        safeTelemetry('routeErrors');
        await safeRecord(cfg,{
          severity:'error',
          source:'api',
          eventType:'public_status_error',
          code:'PUBLIC_STATUS_UNAVAILABLE',
          message:safeRedact(error?.message || error,200),
          endpoint:url.pathname,
          status:503,
        });
        return json({
          error:'Статус сервиса временно недоступен. Повторите позже.',
          code:'PUBLIC_STATUS_UNAVAILABLE',
          retryAfter:5,
        },503,{'retry-after':'5'});
      }
      if (publicStatusResponse) return publicStatusResponse;
  
      if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
        try {
          return await handleTelegramWebhook(request, cfg);
        } catch (error) {
          const retry=safeRead(error,'telegramWebhookRetry') === true;
          const disposition=plainObject(safeRead(error,'telegramWebhookDisposition')) || {};
          const status=retry ? 503 : 200;
          console.error('telegram webhook',safeRedact(safeRead(error,'message') || error,240));
          safeTelemetry('routeErrors');
          await safeRecord(cfg, {
            severity: 'error',
            source: 'telegram',
            eventType: 'webhook',
            code: retry ? 'TELEGRAM_WEBHOOK_RETRY' : 'TELEGRAM_WEBHOOK_SUPPRESSED_RETRY',
            message:safeRedact(safeRead(error,'message') || error,240),
            endpoint: '/telegram/webhook',
            status,
            meta: {
              errorCode:safeText(safeRead(error,'code'),80),
              retry,
              successfulEffects:boundedRetryAfter(safeRead(disposition,'successfulEffects'),0,1_000_000) || 0,
              unsafeMutations:boundedRetryAfter(safeRead(disposition,'unsafeMutations'),0,1_000_000) || 0,
              lastEffect:safeText(safeRead(disposition,'lastEffect'),120),
              lastMutation:safeText(safeRead(disposition,'lastMutation'),120),
            },
          });
          const retryAfter=retry ? boundedRetryAfter(safeRead(disposition,'retryAfter'),null,3600) : null;
          return json(
            retry ? { ok: false, retry: true } : { ok: false },
            status,
            retryAfter ? { 'retry-after': String(retryAfter) } : {},
          );
        }
      }
  
      if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
  
      let distributedPreAuthResponse;
      try {
        distributedPreAuthResponse=await enforceDistributedPreAuthRateLimit({
          request,
          cfg,
          adminSensitive:isAdminSensitivePath(url.pathname),
          fingerprintSecret:cfg.botToken,
          hasSupabase,
          supaRpc,
          bumpTelemetry,
          recordOpsEvent,
          json,
        });
      } catch (error) {
        safeTelemetry('securityPreAuthFailClosed');
        await safeRecord(cfg,{
          severity:'error',
          source:'security',
          eventType:'preauth_rate_limit',
          code:'PREAUTH_RATE_GUARD_UNAVAILABLE',
          message:safeRedact(error?.message || error,200),
          endpoint:url.pathname,
          status:503,
        });
        return json({
          error:'Защитный контур временно недоступен. Повторите немного позже.',
          code:'PREAUTH_RATE_GUARD_UNAVAILABLE',
          retryAfter:5,
        },503,{'retry-after':'5'});
      }
      if (distributedPreAuthResponse) return distributedPreAuthResponse;
  
      try {
        const user = await getRequestUser(request, cfg);
        if (!user) {
          let abuseGuard;
          let abuse;
          try {
            abuseGuard=plainObject(createPreAuthAbuseGuard({
              memory,
              fingerprintSecret:cfg.botToken,
              bumpTelemetry,
              recordOpsEvent:event=>recordOpsEvent(cfg,event),
            }));
            const register=safeRead(abuseGuard,'registerInvalidAuthFailure');
            if (typeof register !== 'function') throw new TypeError('Invalid auth guard is unavailable.');
            abuse=plainObject(await register.call(abuseGuard,request,{
              adminSensitive:isAdminSensitivePath(url.pathname),
            }));
            if (!abuse || typeof safeRead(abuse,'blocked') !== 'boolean') {
              throw new TypeError('Invalid auth guard returned an invalid decision.');
            }
          } catch (error) {
            await safeRecord(cfg,{
              severity:'error',
              source:'security',
              eventType:'invalid_auth_guard',
              code:'INVALID_AUTH_GUARD_UNAVAILABLE',
              message:safeRedact(safeRead(error,'message') || error,200),
              endpoint:url.pathname,
              status:503,
            });
            return json({
              error:'Защитный контур авторизации временно недоступен.',
              code:'INVALID_AUTH_GUARD_UNAVAILABLE',
              retryAfter:5,
            },503,{'retry-after':'5'});
          }
          if (safeRead(abuse,'blocked') === true) {
            const retryAfter=boundedRetryAfter(safeRead(abuse,'retryAfter'),30,3600);
            return json({
              error:'Слишком много неуспешных попыток авторизации. Повторите позже.',
              code:'INVALID_AUTH_BURST',
              retryAfter,
            },429,{'retry-after':String(retryAfter)});
          }
        }
        if (!user) return json({ error: 'Откройте мини-приложение внутри Telegram.' }, 401);
  
        let betaAccess;
        try {
          betaAccess=plainObject(closedBetaAccessDecision(user,cfg));
        } catch {
          betaAccess=null;
        }
        if (!betaAccess || typeof safeRead(betaAccess,'allowed') !== 'boolean') {
          return guardUnavailable(
            cfg,
            url,
            'BETA_ACCESS_GUARD_UNAVAILABLE',
            'Closed beta access guard returned an invalid decision.',
            'securityAccessGuardFailures',
          );
        }
        if (safeRead(betaAccess,'allowed') !== true) {
          await safeRecord(cfg,{
            severity:'warning',
            source:'access',
            eventType:'closed_beta_access',
            code:'CLOSED_BETA_ACCESS_DENIED',
            message:'Authenticated Telegram user was blocked before normal-user API routing.',
            endpoint:url.pathname,
            status:403,
            meta:{
              betaAccessConfigured:safeText(cfg?.betaAccessConfigured || 'missing',40,'missing'),
              strictEffective:cfg?.betaAccessEnabled === true,
              betaParticipant:false,
              betaAllowlistCount:Array.isArray(cfg?.betaTelegramIds) ? Math.min(cfg.betaTelegramIds.length,100000) : 0,
              providerRequests:0,
            },
          });
          return json({ error: 'Доступ к закрытой beta пока не выдан.', code: 'CLOSED_BETA_ACCESS_REQUIRED' }, 403);
        }
  
        try {
          cfg.phase5Validation=plainObject(await phase5ValidationContext(request,user,cfg,url));
        } catch {
          cfg.phase5Validation=null;
          safeTelemetry('phase5ValidationContextErrors');
        }
        cfg.phase5ProviderUsage={networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};
  
        const runtimeState=plainObject(await loadRuntimeControls(cfg)) || {};
        let runtimeResponse;
        try {
          runtimeResponse=runtimeGuard(request,user,cfg,safeRead(runtimeState,'value'));
        } catch (error) {
          await safeRecord(cfg,{
            severity:'error',
            source:'security',
            eventType:'runtime_guard',
            code:'RUNTIME_GUARD_UNAVAILABLE',
            message:safeRedact(safeRead(error,'message') || error,200),
            endpoint:url.pathname,
            status:503,
          });
          return json({
            error:'Защитные настройки сервиса временно недоступны.',
            code:'RUNTIME_GUARD_UNAVAILABLE',
            retryAfter:5,
          },503,{'retry-after':'5'});
        }
        if (runtimeResponse) return runtimeResponse;
  
        let burstResponse;
        try {
          burstResponse=enforceRouteBurst(request,user);
        } catch (error) {
          await safeRecord(cfg,{
            severity:'error',
            source:'security',
            eventType:'route_burst_guard',
            code:'ROUTE_BURST_GUARD_UNAVAILABLE',
            message:safeRedact(safeRead(error,'message') || error,200),
            endpoint:url.pathname,
            status:503,
          });
          return json({
            error:'Защитный контур запросов временно недоступен.',
            code:'ROUTE_BURST_GUARD_UNAVAILABLE',
            retryAfter:5,
          },503,{'retry-after':'5'});
        }
        if (burstResponse) return burstResponse;
  
        let distributedBurstResponse;
        try {
          distributedBurstResponse=await enforceDistributedAccountRateLimit({
            request,
            user,
            cfg,
            hasSupabase,
            supaRpc,
            bumpTelemetry,
            recordOpsEvent,
            json,
            memory,
          });
        } catch (error) {
          await safeRecord(cfg,{
            severity:'error',
            source:'security',
            eventType:'account_rate_limit',
            code:'ACCOUNT_RATE_GUARD_UNAVAILABLE',
            message:safeRedact(safeRead(error,'message') || error,200),
            endpoint:url.pathname,
            status:503,
          });
          return json({
            error:'Защитный контур лимитов временно недоступен.',
            code:'ACCOUNT_RATE_GUARD_UNAVAILABLE',
            retryAfter:5,
          },503,{'retry-after':'5'});
        }
        if (distributedBurstResponse) return distributedBurstResponse;
  
        try {
          return await dispatchApiRoute(request,url,cfg,user,API_ROUTE_DEPS);
        } finally {
          await safePhase5Summary(cfg);
        }
      } catch (error) {
        console.error('api route',safeRedact(error?.message || error,240));
        let rateLimited=false;
        try { rateLimited=isFootballRateLimitError(error) === true; } catch {}
        let mapped;
        try { mapped=plainObject(publicRouteError(error,rateLimited)); } catch {}
        const body=normalizedPublicErrorBody(safeRead(mapped,'body'));
        const status=boundedStatus(safeRead(mapped,'status'),502);
        if (!rateLimited) {
          safeTelemetry('routeErrors');
          await safeRecord(cfg,{
            severity:'error',
            source:'api',
            eventType:'route_error',
            code:String(error?.code || 'SERVER_ERROR').slice(0,80),
            message:safeRedact(error?.message || 'Ошибка сервера.',240),
            endpoint:url.pathname,
            status,
          });
        }
        const retryAfter=boundedRetryAfter(body.retryAfter,null);
        const recovery=normalizedNewsImpactRecovery(safeRead(error,'newsImpactRecovery'));
        return json({
          ...body,
          ...(recovery ? {newsImpactRecovery:recovery} : {}),
          provider:safeProviderCapabilities(),
        },status,retryAfter ? {'retry-after':String(retryAfter)} : {});
      }
    },
  
    async scheduled(controller, env, ctx) {
      let cfg;
      try {
        cfg=buildConfig(env,ctx);
      } catch {
        return undefined;
      }

      const timestamp=validScheduledTimestamp(controller);
      if (timestamp === null) {
        await safeRecord(cfg,{
          severity:'error',
          source:'cron',
          eventType:'scheduled_execution',
          code:'CRON_SCHEDULE_INVALID',
          message:'Scheduled execution rejected an invalid scheduled timestamp at the Worker boundary.',
          status:400,
        });
        return undefined;
      }

      let runtimeState;
      try {
        runtimeState=plainObject(await loadRuntimeControls(cfg,{force:true}));
      } catch (error) {
        await safeRecord(cfg,{
          severity:'error',
          source:'release',
          eventType:'scheduled_control_plane',
          code:'SCHEDULED_CONTROL_PLANE_UNAVAILABLE',
          message:safeRedact(error?.message || error,200),
          status:503,
        });
        return undefined;
      }
      if (!runtimeState) {
        await safeRecord(cfg,{
          severity:'error',
          source:'release',
          eventType:'scheduled_control_plane',
          code:'SCHEDULED_CONTROL_PLANE_INVALID',
          message:'Scheduled execution skipped because runtime controls returned an invalid state.',
          status:503,
        });
        return undefined;
      }

      let lockdown=true;
      try {
        lockdown=isSecurityLockdownControls(safeRead(runtimeState,'value')) === true;
      } catch {
        lockdown=true;
      }
      if (lockdown) {
        const hourBucket = new Date(timestamp).toISOString().slice(0,13);
        await safeRecord(cfg, {
          severity: 'warning',
          source: 'release',
          eventType: 'security_lockdown_cron',
          code: 'SECURITY_LOCKDOWN_SCHEDULED_TASKS_PAUSED',
          message: 'Плановые фоновые задачи пропущены из-за активного Security Lockdown.',
          transitionKey: `security-lockdown:cron:${hourBucket}`,
          meta: {
            hourBucket,
            controlPlaneFailClosed:safeRead(safeRead(runtimeState,'value'),'controlPlaneFailClosed') === true,
            runtimeSource:safeText(safeRead(runtimeState,'source'),80),
          },
        });
        return undefined;
      }
  
      {
        const scheduledAt=new Date(timestamp);
        if (scheduledAt.getUTCMinutes() % 15 === 0) {
          const reconciliation=Promise.resolve()
            .then(()=>reconcileAnalysisUsageReservations(cfg))
            .catch(async error=>{
              await safeRecord(cfg,{
                severity:'warning',
                source:'quota',
                eventType:'analysis_usage_reconciliation',
                code:'ANALYSIS_USAGE_RECONCILIATION_FAILED',
                message:safeRedact(error?.message || error,200),
              });
              return false;
            });
          if (typeof ctx?.waitUntil === 'function') {
            try { ctx.waitUntil(reconciliation); }
            catch { await reconciliation; }
          } else {
            await reconciliation;
          }
        }
      }
  
      try {
        return await handleScheduled(controller,cfg,ctx);
      } catch (error) {
        safeTelemetry('scheduledErrors');
        await safeRecord(cfg,{
          severity:'error',
          source:'cron',
          eventType:'scheduled_execution',
          code:'SCHEDULED_HANDLER_FAILED',
          message:safeRedact(safeRead(error,'message') || error,240),
          status:500,
        });
        return undefined;
      }
    },
  });
}
