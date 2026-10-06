export function createWorkerBootstrapRuntime(deps = {}) {
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

  return {
    async fetch(request, env, ctx) {
      const cfg = config(env);
      if (ctx?.waitUntil) cfg.waitUntil = promise => ctx.waitUntil(Promise.resolve(promise));
      const url = new URL(request.url);
  
      const edgeGuard = await cloudflareEdgeGuard(request, env);
      if (edgeGuard.blocked) {
        if (edgeGuard.kind === 'scanner') bumpTelemetry('edgeScannerBlocks');
        else bumpTelemetry('edgeRateLimitBlocks');
        const minuteBucket = new Date().toISOString().slice(0, 16);
        await recordOpsEvent(cfg, {
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
            policy: edgeGuard.policy || '',
            kind: edgeGuard.kind || '',
            retryAfter: Number(edgeGuard.retryAfter || 0) || null,
            minuteBucket,
          },
        }).catch(() => {});
        return json({
          error: edgeGuard.kind === 'scanner' ? 'Not found.' : 'Слишком много запросов. Повторите позже.',
          code: edgeGuard.code,
          retryAfter: Number(edgeGuard.retryAfter || 0) || undefined,
        }, edgeGuard.status, edgeGuard.retryAfter ? { 'retry-after': String(edgeGuard.retryAfter) } : {});
      }
      if (edgeGuard.degraded) {
        bumpTelemetry('edgeRateLimitFallbacks');
        const now = Date.now();
        if (now - Number(memory.edgeRateLimitWarningAt || 0) >= 60_000) {
          memory.edgeRateLimitWarningAt = now;
          await recordOpsEvent(cfg, {
            severity: 'warning',
            source: 'security',
            eventType: 'edge_rate_limit',
            code: 'EDGE_RATE_LIMIT_DEGRADED',
            message: 'Cloudflare rate-limit binding was unavailable; existing Worker guards remain active.',
            endpoint: url.pathname,
            meta: { policy: edgeGuard.policy || '', configured: Boolean(edgeGuard.configured) },
          }).catch(() => {});
        }
      }
  
      const securityShape=await preAuthRequestShapeDecision(request,{
        api:url.pathname.startsWith('/api/'),
        webhook:url.pathname==='/telegram/webhook',
      });
      if (!securityShape.allowed) {
        if (securityShape.code==='REQUEST_TOO_LARGE' || securityShape.code==='TELEGRAM_INIT_DATA_TOO_LARGE') bumpTelemetry('securityOversizeBlocks');
        else if (String(securityShape.code || '').includes('CROSS_')) bumpTelemetry('securityCrossOriginBlocks');
        else bumpTelemetry('securityShapeBlocks');
        const minuteBucket=new Date().toISOString().slice(0,16);
        await recordOpsEvent(cfg,{
          severity:'warning',
          source:'security',
          eventType:'request_guard',
          code:String(securityShape.code || 'REQUEST_REJECTED'),
          message:'Public request blocked by the pre-auth security gate.',
          endpoint:url.pathname,
          status:Number(securityShape.status || 400),
          transitionKey:'security-request-guard:' + String(securityShape.code || 'REQUEST_REJECTED') + ':' + minuteBucket,
          meta:{
            method:String(request.method || 'GET').toUpperCase(),
            minuteBucket,
          },
        }).catch(()=>{});
        return json({
          error:securityShape.error || 'Запрос отклонён.',
          code:securityShape.code || 'REQUEST_REJECTED',
        },securityShape.status || 400);
      }
  
      const publicStatusResponse=await publicStatusRouter.handle(request,url,cfg);
      if (publicStatusResponse) return publicStatusResponse;
  
      if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
        try {
          return await handleTelegramWebhook(request, cfg);
        } catch (error) {
          const retry = Boolean(error?.telegramWebhookRetry);
          const disposition = error?.telegramWebhookDisposition || {};
          const status = retry ? 503 : 200;
          console.error('telegram webhook', redactOpsString(error?.message || error, 240));
          bumpTelemetry('routeErrors');
          await recordOpsEvent(cfg, {
            severity: 'error',
            source: 'telegram',
            eventType: 'webhook',
            code: retry ? 'TELEGRAM_WEBHOOK_RETRY' : 'TELEGRAM_WEBHOOK_SUPPRESSED_RETRY',
            message: error?.message || error,
            endpoint: '/telegram/webhook',
            status,
            meta: {
              errorCode: String(error?.code || ''),
              retry,
              successfulEffects: Number(disposition?.successfulEffects || 0),
              unsafeMutations: Number(disposition?.unsafeMutations || 0),
              lastEffect: String(disposition?.lastEffect || ''),
              lastMutation: String(disposition?.lastMutation || ''),
            },
          });
          return json(
            retry ? { ok: false, retry: true } : { ok: false },
            status,
            retry && Number(disposition?.retryAfter || 0) > 0
              ? { 'retry-after': String(Math.max(1, Number(disposition.retryAfter))) }
              : {},
          );
        }
      }
  
      if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
  
      const distributedPreAuthResponse=await enforceDistributedPreAuthRateLimit({
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
      if (distributedPreAuthResponse) return distributedPreAuthResponse;
  
      try {
        const user = await getRequestUser(request, cfg);
        if (!user) {
          const abuseGuard=createPreAuthAbuseGuard({
            memory,
            fingerprintSecret:cfg.botToken,
            bumpTelemetry,
            recordOpsEvent:event=>recordOpsEvent(cfg,event),
          });
          const abuse=await abuseGuard.registerInvalidAuthFailure(request,{
            adminSensitive:isAdminSensitivePath(url.pathname),
          });
          if (abuse.blocked) {
            return json({
              error:'Слишком много неуспешных попыток авторизации. Повторите позже.',
              code:'INVALID_AUTH_BURST',
              retryAfter:abuse.retryAfter,
            },429,{'retry-after':String(abuse.retryAfter)});
          }
        }
        if (!user) return json({ error: 'Откройте мини-приложение внутри Telegram.' }, 401);
  
        const betaAccess = closedBetaAccessDecision(user, cfg);
        if (!betaAccess.allowed) {
          await recordOpsEvent(cfg,{
            severity:'warning',
            source:'access',
            eventType:'closed_beta_access',
            code:'CLOSED_BETA_ACCESS_DENIED',
            message:'Authenticated Telegram user was blocked before normal-user API routing.',
            endpoint:url.pathname,
            status:403,
            meta:{
              betaAccessConfigured:String(cfg.betaAccessConfigured || 'missing'),
              strictEffective:Boolean(cfg.betaAccessEnabled),
              betaParticipant:false,
              betaAllowlistCount:Number(cfg.betaTelegramIds?.length || 0),
              providerRequests:0,
            },
          }).catch(()=>null);
          return json({ error: 'Доступ к закрытой beta пока не выдан.', code: 'CLOSED_BETA_ACCESS_REQUIRED' }, 403);
        }
  
        cfg.phase5Validation = await phase5ValidationContext(request,user,cfg,url);
        cfg.phase5ProviderUsage = {networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};
  
        const runtimeState = await loadRuntimeControls(cfg);
        const runtimeResponse = runtimeGuard(request, user, cfg, runtimeState.value);
        if (runtimeResponse) return runtimeResponse;
  
        const burstResponse = enforceRouteBurst(request, user);
        if (burstResponse) return burstResponse;
  
        const distributedBurstResponse = await enforceDistributedAccountRateLimit({
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
        if (distributedBurstResponse) return distributedBurstResponse;
  
        try {
          return await dispatchApiRoute(request, url, cfg, user, API_ROUTE_DEPS);
        } finally {
          await recordPhase5ProviderRequestSummary(cfg).catch(()=>null);
        }
      } catch (error) {
        console.error('api route', redactOpsString(error?.message || error, 240));
        const rateLimited = isFootballRateLimitError(error);
        const publicError = publicRouteError(error, rateLimited);
        if (!rateLimited) {
          bumpTelemetry('routeErrors');
          await recordOpsEvent(cfg, {
            severity: 'error', source: 'api', eventType: 'route_error', code: error?.code || 'SERVER_ERROR',
            message: error?.message || 'Ошибка сервера.', endpoint: url.pathname, status: publicError.status,
          });
        }
        return json({
          ...publicError.body,
          ...(error?.newsImpactRecovery ? {newsImpactRecovery:error.newsImpactRecovery} : {}),
          provider: publicDataCapabilities(),
        }, publicError.status, publicError.body.retryAfter ? { 'retry-after': String(publicError.body.retryAfter) } : {});
      }
    },
  
    async scheduled(controller, env, ctx) {
      const cfg = config(env);
      if (ctx?.waitUntil) cfg.waitUntil = promise => ctx.waitUntil(Promise.resolve(promise));
      const runtimeState = await loadRuntimeControls(cfg, { force: true });
      if (isSecurityLockdownControls(runtimeState.value)) {
        const hourBucket = new Date(Number(controller?.scheduledTime || Date.now())).toISOString().slice(0, 13);
        await recordOpsEvent(cfg, {
          severity: 'warning',
          source: 'release',
          eventType: 'security_lockdown_cron',
          code: 'SECURITY_LOCKDOWN_SCHEDULED_TASKS_PAUSED',
          message: 'Плановые фоновые задачи пропущены из-за активного Security Lockdown.',
          transitionKey: `security-lockdown:cron:${hourBucket}`,
          meta: {
            hourBucket,
            controlPlaneFailClosed: Boolean(runtimeState.value?.controlPlaneFailClosed),
            runtimeSource: String(runtimeState.source || ''),
          },
        }).catch(() => {});
        return undefined;
      }
  
      const scheduledAt = new Date(Number(controller?.scheduledTime || Date.now()));
      if (Number.isFinite(scheduledAt.getTime()) && scheduledAt.getUTCMinutes() % 15 === 0) {
        const reconciliation = reconcileAnalysisUsageReservations(cfg);
        if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(reconciliation);
        else await reconciliation;
      }
  
      return handleScheduled(controller, cfg, ctx);
    },
  };
}
