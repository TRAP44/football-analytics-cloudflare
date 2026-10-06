// User profile, history, favorites, reminders, digest and preferences API extracted from worker.js.
// User data, cache and presentation primitives are injected by the composition root.
export function createUserDataApiRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('User data API runtime dependencies are required.');
  }
  const {
    addFavorite,
    addFavoritePlayer,
    addReminder,
    analysisFreshness,
    analysisResponsePayload,
    getBotDigestSubscription,
    getCache,
    getFavoritePlayers,
    getFavorites,
    getHistory,
    getPreferences,
    getQuota,
    getReminders,
    getStaleCache,
    getUserRecord,
    isAdminUser,
    json,
    publicDataCapabilities,
    publicDigestSettings,
    publicPlayerFollowNotificationContract,
    publicRuntimeControls,
    publicSiteUrl,
    publicSmartNotificationCapabilities,
    recordOpsEvent,
    reminderDeliveryStatus,
    removeFavorite,
    removeFavoritePlayer,
    removeReminder,
    savePreferences,
    setBotDigestSubscription,
  } = deps;

  async function apiMe(request, cfg, user) {
    const [quota, record, favorites, favoritePlayers, reminders, preferences] = await Promise.all([
      getQuota(user.id, cfg),
      getUserRecord(user.id, cfg),
      getFavorites(user.id, cfg),
      getFavoritePlayers(user.id, cfg),
      getReminders(user.id, cfg),
      getPreferences(user.id, cfg),
    ]);
    return json({
      user: {
        id: user.id,
        username: user.username || '',
        firstName: user.first_name || '',
        photoUrl: user.photo_url || '',
        createdAt: record?.created_at || null,
        subscriptionUntil: record?.subscription_until || null,
      },
      quota,
      billing: {
        plan: quota.plan,
        subscriptionUntil: record?.subscription_until || null,
        canceled: Boolean(record?.subscription_canceled),
        paymentChargeIdPresent: Boolean(record?.telegram_payment_charge_id),
      },
      features: {
        monetizationEnabled: cfg.monetizationEnabled,
        isAdmin: isAdminUser(user, cfg),
        role: isAdminUser(user, cfg) ? 'admin' : 'user',
        dataCapabilities: publicDataCapabilities(),
        runtime: publicRuntimeControls(),
      },
      preferences,
      stats: { favorites: favorites.length, favoritePlayers: favoritePlayers.length, reminders: reminders.length },
    });
  }
  
  async function apiHistory(request, cfg, user) {
    const rows = await getHistory(user.id, cfg);
    return json({
      items: rows.map(x => ({
        fixtureId: Number(x.fixture_id),
        homeName: x.home_name || '',
        awayName: x.away_name || '',
        leagueName: x.league_name || '',
        fixtureDate: x.fixture_date || '',
        homeLogo: x.home_logo || '',
        awayLogo: x.away_logo || '',
        aiSignalCode: x.ai_signal_code || '',
        aiSignalLabel: x.ai_signal_label || '',
        aiConfidence: Number.isFinite(Number(x.ai_confidence)) ? Number(x.ai_confidence) : null,
        aiRisk: x.ai_risk || '',
        aiOutcome: x.ai_outcome || '',
        aiTotal: x.ai_total || '',
        aiBtts: x.ai_btts || '',
        analysisVersion: x.analysis_version || '',
        viewedAt: x.viewed_at || '',
      })),
    });
  }
  
  async function apiHistoryAnalysis(request, cfg, user) {
    const fixtureId = Number(new URL(request.url).searchParams.get('fixtureId'));
    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) return json({ error: 'Номер матча обязателен.' }, 400);
  
    const history = await getHistory(user.id, cfg);
    if (!history.some(row => Number(row.fixture_id) === fixtureId)) {
      return json({ error: 'Этот матч отсутствует в вашей истории анализов.', code: 'HISTORY_ANALYSIS_NOT_FOUND' }, 404);
    }
  
    const cacheKey = `fixture:${fixtureId}:v15-availability-quality-rc144`;
    const fresh = await getCache(cacheKey, cfg);
    const payload = fresh || await getStaleCache(cacheKey, cfg);
    if (!payload) {
      return json({
        error: 'Сохранённый полный анализ уже недоступен. Откройте центр матча или выполните новый анализ вручную.',
        code: 'HISTORY_ANALYSIS_UNAVAILABLE',
      }, 404);
    }

    const payloadFixtureId = Number(payload?.match?.fixtureId);
    if (!Number.isSafeInteger(payloadFixtureId) || payloadFixtureId !== fixtureId) {
      void recordOpsEvent(cfg, {
        severity:'warning',
        source:'cache',
        eventType:'history_analysis_cache_rejected',
        code:'HISTORY_ANALYSIS_IDENTITY_MISMATCH',
        message:'History analysis cache payload was rejected because fixture identity did not match.',
        meta:{fixtureId,payloadFixtureId:Number.isSafeInteger(payloadFixtureId) ? payloadFixtureId : null},
      }).catch(()=>null);
      return json({
        error:'Сохранённый анализ не прошёл проверку идентичности матча.',
        code:'HISTORY_ANALYSIS_IDENTITY_MISMATCH',
      },409);
    }

    let freshnessReason='history_snapshot';
    try {
      freshnessReason=String(analysisFreshness(payload)?.reasonCode || freshnessReason).slice(0,80);
    } catch {}

    return json(analysisResponsePayload(payload,{cached:true,stale:!fresh,historyReadOnly:true,recheck:{requested:false,performed:false,free:false,reasonCode:freshnessReason},quota:await getQuota(user.id,cfg)}));
  }
  
  
  async function apiFavorites(request, cfg, user) {
    if (request.method === 'GET') {
      const rows = await getFavorites(user.id, cfg);
      return json({ items: rows.map(x => ({ teamId: Number(x.team_id), teamName: x.team_name || '', teamLogo: x.team_logo || '' })) });
    }
    if (request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const row = await addFavorite(user.id, { id: body.teamId, name: body.teamName, logo: body.teamLogo }, cfg);
      return json({ ok: true, item: { teamId: row.team_id, teamName: row.team_name, teamLogo: row.team_logo } });
    }
    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const teamId = Number(url.searchParams.get('teamId'));
      if (!teamId) return json({ error: 'Номер команды обязателен.' }, 400);
      await removeFavorite(user.id, teamId, cfg);
      return json({ ok: true });
    }
    return json({ error: 'Метод не поддерживается.' }, 405);
  }
  
  
  function publicFavoritePlayer(row = {}) {
    return {
      playerId: Number(row.player_id),
      playerName: String(row.player_name || ''),
      teamId: Number(row.team_id),
      createdAt: row.created_at || null,
    };
  }
  
  async function resolveFavoritePlayerIdentity(input = {}, cfg) {
    const playerId = Number(input?.playerId || 0);
    const teamId = Number(input?.teamId || 0);
    const fixtureId = Number(input?.fixtureId || 0);
  
    if (![playerId, teamId, fixtureId].every(id => Number.isSafeInteger(id) && id > 0)) {
      return {
        ok: false,
        status: 400,
        code: 'FAVORITE_PLAYER_INVALID',
        error: 'Некорректный игрок, команда или матч.',
      };
    }
  
    const cacheKey = `match-center:${fixtureId}:v16-availability-quality-rc144`;
    const center = await getCache(cacheKey, cfg) || await getStaleCache(cacheKey, cfg);
    if (!center) {
      return {
        ok: false,
        status: 409,
        code: 'FAVORITE_PLAYER_CONTEXT_EXPIRED',
        error: 'Контекст матча устарел. Откройте матч заново и повторите.',
      };
    }
  
    const match = center?.match || {};
    const side = ['home', 'away'].find(key => Number(match?.[key]?.id || 0) === teamId);
    if (!side) {
      return {
        ok: false,
        status: 422,
        code: 'FAVORITE_PLAYER_TEAM_MISMATCH',
        error: 'Игрок не относится к выбранной команде этого матча.',
      };
    }
  
    const player = (center?.playerLeaders?.[side] || [])
      .find(item => Number(item?.id || 0) === playerId);
    const playerName = String(player?.name || '').trim();
    if (!player || !playerName) {
      return {
        ok: false,
        status: 422,
        code: 'FAVORITE_PLAYER_NOT_FOUND',
        error: 'Игрок не найден в подтверждённых данных этого матча.',
      };
    }
  
    return {
      ok: true,
      player: { id: playerId, name: playerName, teamId },
    };
  }
  
  async function apiFavoritePlayers(request, cfg, user) {
    const notificationContract = publicPlayerFollowNotificationContract();
  
    if (request.method === 'GET') {
      const rows = await getFavoritePlayers(user.id, cfg);
      return json({
        items: rows.map(publicFavoritePlayer),
        notificationContract,
      });
    }
  
    if (request.method === 'POST') {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Некорректное тело запроса.', code: 'FAVORITE_PLAYER_INVALID_JSON' }, 400);
      }
  
      const resolved = await resolveFavoritePlayerIdentity(body, cfg);
      if (!resolved.ok) return json({ error: resolved.error, code: resolved.code }, resolved.status);
  
      const row = await addFavoritePlayer(user.id, resolved.player, cfg);
      return json({
        ok: true,
        item: publicFavoritePlayer(row),
        notificationContract,
      });
    }
  
    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const playerId = Number(url.searchParams.get('playerId'));
      if (!Number.isSafeInteger(playerId) || playerId <= 0) {
        return json({ error: 'Номер игрока обязателен.', code: 'FAVORITE_PLAYER_INVALID' }, 400);
      }
      await removeFavoritePlayer(user.id, playerId, cfg);
      return json({ ok: true, notificationContract });
    }
  
    return json({ error: 'Метод не поддерживается.' }, 405);
  }
  
  async function apiDigestSettings(request, cfg, user) {
    const telegramId=Number(user?.id || 0);
    if (!telegramId) return json({error:'Сессия Telegram не подтверждена.',code:'DIGEST_AUTH_REQUIRED'},401);
  
    if (request.method === 'GET') {
      const [row,quota,favorites]=await Promise.all([
        getBotDigestSubscription(telegramId,cfg),
        getQuota(telegramId,cfg),
        getFavorites(telegramId,cfg),
      ]);
      return json({settings:publicDigestSettings(row,quota?.plan,favorites)});
    }
  
    if (request.method === 'PUT' || request.method === 'POST') {
      let body={};
      try { body=await request.json(); } catch {
        return json({error:'Некорректное тело запроса.',code:'DIGEST_INVALID_JSON'},400);
      }
      if (typeof body?.enabled !== 'boolean') {
        return json({error:'Поле enabled должно быть true или false.',code:'DIGEST_INVALID_ENABLED'},400);
      }
      const appUrl=publicSiteUrl(request,'/');
      const row=await setBotDigestSubscription(telegramId,telegramId,body.enabled,cfg,appUrl);
      const [quota,favorites]=await Promise.all([
        getQuota(telegramId,cfg),
        getFavorites(telegramId,cfg),
      ]);
      void recordOpsEvent(cfg,{
        severity:'info',
        source:'telegram',
        eventType:'digest_subscription',
        code:body.enabled?'DIGEST_SUBSCRIPTION_ENABLED':'DIGEST_SUBSCRIPTION_DISABLED',
        message:body.enabled?'Mini App digest subscription enabled.':'Mini App digest subscription disabled.',
        endpoint:'/api/digest-settings',
        meta:{channel:'miniapp',enabled:Boolean(body.enabled),plan:String(quota?.plan || 'FREE')},
      }).catch(()=>null);
      return json({ok:true,settings:publicDigestSettings(row,quota?.plan,favorites)});
    }
  
    return json({error:'Метод не поддерживается.'},405);
  }
  
  function publicReminder(row = {}) {
    return {
      fixtureId: Number(row.fixture_id),
      homeName: row.home_name || '',
      awayName: row.away_name || '',
      leagueName: row.league_name || '',
      fixtureDate: row.fixture_date || '',
      notifiedAt: row.notified_at || null,
      remindBeforeMinutes: Number(row.remind_before_minutes || 30),
      kickoffNotify: row.kickoff_notify !== false,
      kickoffNotifiedAt: row.kickoff_notified_at || null,
      deliveryStatus: reminderDeliveryStatus(row),
      deliveryAttempts: Number(row.prematch_attempts || 0) + Number(row.kickoff_attempts || 0),
      deliveryLastAttemptAt: row.delivery_last_attempt_at || null,
    };
  }
  
  async function apiReminders(request, cfg, user) {
    if (request.method === 'GET') {
      const rows = await getReminders(user.id, cfg);
      return json({ items: rows.map(publicReminder) });
    }
    if (request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const row = await addReminder(user.id, body, cfg);
      return json({ ok: true, item: publicReminder(row) });
    }
    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const fixtureId = Number(url.searchParams.get('fixtureId'));
      if (!fixtureId) return json({ error: 'Номер матча обязателен.' }, 400);
      await removeReminder(user.id, fixtureId, cfg);
      return json({ ok: true });
    }
    return json({ error: 'Метод не поддерживается.' }, 405);
  }
  
  async function apiPreferences(request, cfg, user) {
    if (request.method === 'GET') {
      const [preferences, quota] = await Promise.all([
        getPreferences(user.id, cfg),
        getQuota(user.id, cfg),
      ]);
      return json({
        preferences,
        notificationCapabilities: publicSmartNotificationCapabilities(quota?.plan),
      });
    }
    if (request.method === 'PUT' || request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const preferences = await savePreferences(user.id, body, cfg);
      const quota = await getQuota(user.id, cfg);
      return json({
        ok: true,
        preferences,
        notificationCapabilities: publicSmartNotificationCapabilities(quota?.plan),
      });
    }
    return json({ error: 'Метод не поддерживается.' }, 405);
  }

  return {
    apiMe,
    apiHistory,
    apiHistoryAnalysis,
    apiFavorites,
    publicFavoritePlayer,
    resolveFavoritePlayerIdentity,
    apiFavoritePlayers,
    apiDigestSettings,
    publicReminder,
    apiReminders,
    apiPreferences,
  };
}
