import { MAX_TELEGRAM_INIT_DATA_LENGTH } from './security-gate.js';
import { usesStrictTelegramFreshness } from './security-route-registry.js';


function positiveTelegramId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export function isLocalDevelopmentRequest(requestUrl) {
  const hostname = String(requestUrl?.hostname || '').toLowerCase();
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.localhost');
}

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
    if (initData.length > MAX_TELEGRAM_INIT_DATA_LENGTH) return null;
    const adminSensitive = usesStrictTelegramFreshness(requestUrl.pathname);
    const mutation = !['GET','HEAD','OPTIONS'].includes(String(request.method || 'GET').toUpperCase());
    const initDataMaxAgeSeconds = adminSensitive ? 15 * 60 : mutation ? 2 * 60 * 60 : 24 * 60 * 60;
    let user = await validateTelegramInitData(initData, cfg?.botToken, initDataMaxAgeSeconds);
    const validatedTelegramId = positiveTelegramId(user?.id);
    const telegramValidated = Boolean(user && validatedTelegramId);
    if (user && !validatedTelegramId) user = null;

    const localDevelopmentId = positiveTelegramId(developmentTelegramId);
    if (
      !user
      && cfg?.devMode === true
      && localDevelopmentId
      && isLocalDevelopmentRequest(requestUrl)
    ) {
      user = {
        id: localDevelopmentId,
        username: 'dev_user',
        first_name: 'DEV',
        last_name: 'User',
        __developmentIdentity: true,
      };
    }
    if (!user) return null;
    user.id = positiveTelegramId(user.id);
    user.__telegramValidated = telegramValidated;
    try {
      await upsertUser(user, cfg);
    } catch (error) {
      // Authentication is already cryptographically validated. A transient DB
      // write problem must not take public read-only football screens offline.
      bumpTelemetry('supabaseErrors');
      try {
        await Promise.resolve(recordOpsEvent?.(cfg, {
          severity: 'warning', source: 'auth', eventType: 'user_sync', code: 'USER_SYNC_DEGRADED',
          message: error?.message || error, meta: { userSync: 'degraded' },
        }));
      } catch {
        // Authentication remains valid even if operational logging is unavailable.
      }
    }
    return user;
  }

  async function upsertUser(user, cfg) {
    const userId = positiveTelegramId(user?.id);
    if (!userId) throw new TypeError('valid Telegram user id is required');
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
    const normalizedUserId = positiveTelegramId(userId);
    if (!normalizedUserId) return null;
    if (hasSupabase(cfg)) {
      return await supaSelectOne(cfg, 'users', { telegram_id: `eq.${normalizedUserId}` });
    }
    return memory.users.get(normalizedUserId) || { telegram_id: normalizedUserId, plan: 'FREE' };
  }

  return { getRequestUser, upsertUser, getUserRecord };
}
