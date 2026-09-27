export function createUserAuthRuntime({
  memory,
  validateTelegramInitData,
  developmentTelegramId,
  hasSupabase,
  supaUpsert,
  supaSelectOne,
  withSingleFlight,
  pruneMemoryState,
  bumpTelemetry,
  recordOpsEvent,
}) {
  async function getRequestUser(request, cfg) {
    const initData = request.headers.get('x-telegram-init-data') || '';
    const requestUrl = new URL(request.url);
    const adminSensitive = requestUrl.pathname.startsWith('/api/runtime-controls')
      || requestUrl.pathname.startsWith('/api/provider/')
      || requestUrl.pathname === '/api/admin/channel-publisher/test'
      || ['/api/diagnostics','/api/release-readiness','/api/production-readiness','/api/rc-regression','/api/release-monitor','/api/production-monitor','/api/beta-dashboard','/api/calibration-control','/api/model-remediation','/api/media-publisher-link'].includes(requestUrl.pathname);
    const mutation = !['GET','HEAD','OPTIONS'].includes(String(request.method || 'GET').toUpperCase());
    const initDataMaxAgeSeconds = adminSensitive ? 15 * 60 : mutation ? 2 * 60 * 60 : 24 * 60 * 60;
    let user = await validateTelegramInitData(initData, cfg.botToken, initDataMaxAgeSeconds);
    const telegramValidated = Boolean(user);
    if (!user && cfg.devMode) {
      user = {
        id: developmentTelegramId,
        username: 'dev_user',
        first_name: 'DEV',
        last_name: 'User',
        __developmentIdentity: true,
      };
    }
    if (!user) return null;
    user.__telegramValidated = telegramValidated;
    try {
      await upsertUser(user, cfg);
    } catch (error) {
      // Authentication is already cryptographically validated. A transient DB
      // write problem must not take public read-only football screens offline.
      bumpTelemetry('supabaseErrors');
      recordOpsEvent(cfg, {
        severity: 'warning', source: 'auth', eventType: 'user_sync', code: 'USER_SYNC_DEGRADED',
        message: error?.message || error, meta: { userSync: 'degraded' },
      }).catch(() => {});
    }
    return user;
  }

  async function upsertUser(user, cfg) {
    const userId = Number(user.id);
    const record = {
      telegram_id: userId,
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      photo_url: user.photo_url || null,
      updated_at: new Date().toISOString(),
    };

    if (hasSupabase(cfg)) {
      const lastSync = Number(memory.userSyncAt.get(userId) || 0);
      if (lastSync && Date.now() - lastSync < 10 * 60 * 1000) {
        bumpTelemetry('userSyncSkips');
        return;
      }
      await withSingleFlight(`user-sync:${userId}`, async () => {
        const insideLastSync = Number(memory.userSyncAt.get(userId) || 0);
        if (insideLastSync && Date.now() - insideLastSync < 10 * 60 * 1000) {
          bumpTelemetry('userSyncSkips');
          return;
        }
        await supaUpsert(cfg, 'users', record, 'telegram_id');
        memory.userSyncAt.set(userId, Date.now());
        if (memory.userSyncAt.size > 1500) pruneMemoryState();
      });
      return;
    }
    const old = memory.users.get(userId) || { plan: 'FREE', created_at: new Date().toISOString() };
    memory.users.set(userId, { ...old, ...record });
  }

  async function getUserRecord(userId, cfg) {
    if (hasSupabase(cfg)) {
      return await supaSelectOne(cfg, 'users', { telegram_id: `eq.${Number(userId)}` });
    }
    return memory.users.get(Number(userId)) || { telegram_id: Number(userId), plan: 'FREE' };
  }

  return { getRequestUser, upsertUser, getUserRecord };
}
