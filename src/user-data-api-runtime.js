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

  const requiredFunctions={
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
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') {
      throw new TypeError(`User data API runtime requires ${name}.`);
    }
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || value.length > 24) return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveId(value) {
    const number=integerCandidate(value);
    return number !== null && number > 0 ? number : 0;
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.length > 48) return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function safeRows(value) {
    if (!Array.isArray(value)) {
      const error=new TypeError('Personal-data store returned an invalid collection.');
      error.code='PERSONAL_DATA_INVALID_RESPONSE';
      throw error;
    }
    const rows=[];
    for (const item of value) {
      const row=plainObject(item);
      if (!row) {
        const error=new TypeError('Personal-data store returned an invalid row.');
        error.code='PERSONAL_DATA_INVALID_RESPONSE';
        throw error;
      }
      rows.push(row);
    }
    return rows;
  }

  function safeText(value, max = 2048) {
    if (typeof value !== 'string') return '';
    const limit=integerCandidate(max);
    return value.slice(0,limit !== null ? Math.min(4096,limit) : 2048);
  }

  function nonNegativeCount(value) {
    const number=integerCandidate(value);
    return number !== null && number >= 0 ? Math.min(number,1_000_000) : 0;
  }

  async function apiMe(request, cfg, user) {
    const userId=positiveId(user?.id);
    if (!userId) return json({error:'Сессия Telegram не подтверждена.',code:'AUTH_REQUIRED'},401);

    const [rawQuota, rawRecord, rawFavorites, rawFavoritePlayers, rawReminders, preferences] = await Promise.all([
      getQuota(userId, cfg),
      getUserRecord(userId, cfg),
      getFavorites(userId, cfg),
      getFavoritePlayers(userId, cfg),
      getReminders(userId, cfg),
      getPreferences(userId, cfg),
    ]);
    const quota=plainObject(rawQuota) || {};
    const record=plainObject(rawRecord) || {};
    const favorites=safeRows(rawFavorites);
    const favoritePlayers=safeRows(rawFavoritePlayers);
    const reminders=safeRows(rawReminders);
    const admin=isAdminUser(user,cfg) === true;

    return json({
      user: {
        id:userId,
        username:safeText(user?.username,160),
        firstName:safeText(user?.first_name,160),
        photoUrl:safeText(user?.photo_url,2048),
        createdAt:record.created_at || null,
        subscriptionUntil:record.subscription_until || null,
      },
      quota,
      billing: {
        plan:safeText(quota.plan,40) || 'FREE',
        subscriptionUntil:record.subscription_until || null,
        canceled:record.subscription_canceled === true,
        paymentChargeIdPresent:Boolean(record.telegram_payment_charge_id),
      },
      features: {
        monetizationEnabled:cfg?.monetizationEnabled === true,
        isAdmin:admin,
        role:admin ? 'admin' : 'user',
        dataCapabilities:publicDataCapabilities(),
        runtime:publicRuntimeControls(),
      },
      preferences,
      stats:{favorites:favorites.length,favoritePlayers:favoritePlayers.length,reminders:reminders.length},
    });
  }
  
  async function apiHistory(request, cfg, user) {
    const userId=positiveId(user?.id);
    if (!userId) return json({error:'Сессия Telegram не подтверждена.',code:'AUTH_REQUIRED'},401);

    const rows=safeRows(await getHistory(userId,cfg));
    return json({
      items:rows.map(row=>{
        const confidence=finiteNumber(row.ai_confidence);
        return {
          fixtureId:positiveId(row.fixture_id) || null,
          homeName:safeText(row.home_name,180),
          awayName:safeText(row.away_name,180),
          leagueName:safeText(row.league_name,180),
          fixtureDate:safeText(row.fixture_date,80),
          homeLogo:safeText(row.home_logo,2048),
          awayLogo:safeText(row.away_logo,2048),
          aiSignalCode:safeText(row.ai_signal_code,40),
          aiSignalLabel:safeText(row.ai_signal_label,160),
          aiConfidence:confidence,
          aiRisk:safeText(row.ai_risk,60),
          aiOutcome:safeText(row.ai_outcome,80),
          aiTotal:safeText(row.ai_total,80),
          aiBtts:safeText(row.ai_btts,80),
          analysisVersion:safeText(row.analysis_version,80),
          viewedAt:safeText(row.viewed_at,80),
        };
      }),
    });
  }
  
  async function apiHistoryAnalysis(request, cfg, user) {
    const userId=positiveId(user?.id);
    if (!userId) return json({error:'Сессия Telegram не подтверждена.',code:'AUTH_REQUIRED'},401);

    const fixtureId=positiveId(new URL(request.url).searchParams.get('fixtureId'));
    if (!fixtureId) return json({error:'Номер матча обязателен.'},400);
  
    const history=safeRows(await getHistory(userId,cfg));
    if (!history.some(row=>positiveId(row.fixture_id)===fixtureId)) {
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

    const payloadFixtureId=positiveId(plainObject(payload?.match)?.fixtureId);
    if (!payloadFixtureId || payloadFixtureId !== fixtureId) {
      void recordOpsEvent(cfg, {
        severity:'warning',
        source:'cache',
        eventType:'history_analysis_cache_rejected',
        code:'HISTORY_ANALYSIS_IDENTITY_MISMATCH',
        message:'History analysis cache payload was rejected because fixture identity did not match.',
        meta:{fixtureId,payloadFixtureId:payloadFixtureId || null},
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

    return json(analysisResponsePayload(payload,{cached:true,stale:!fresh,historyReadOnly:true,recheck:{requested:false,performed:false,free:false,reasonCode:freshnessReason},quota:await getQuota(userId,cfg)}));
  }
  
  
  async function apiFavorites(request, cfg, user) {
    const userId=positiveId(user?.id);
    if (!userId) return json({error:'Сессия Telegram не подтверждена.',code:'AUTH_REQUIRED'},401);

    if (request.method === 'GET') {
      const rows=safeRows(await getFavorites(userId,cfg));
      return json({
        items:rows.map(row=>({
          teamId:positiveId(row.team_id) || null,
          teamName:safeText(row.team_name,180),
          teamLogo:safeText(row.team_logo,2048),
        })),
      });
    }
    if (request.method === 'POST') {
      let body;
      try { body=plainObject(await request.json()); } catch { body=null; }
      if (!body) return json({error:'Некорректное тело запроса.',code:'FAVORITE_INVALID_JSON'},400);

      const row=plainObject(await addFavorite(
        userId,
        {id:body.teamId,name:body.teamName,logo:body.teamLogo},
        cfg,
      )) || {};
      return json({
        ok:true,
        item:{
          teamId:positiveId(row.team_id) || null,
          teamName:safeText(row.team_name,180),
          teamLogo:safeText(row.team_logo,2048),
        },
      });
    }
    if (request.method === 'DELETE') {
      const teamId=positiveId(new URL(request.url).searchParams.get('teamId'));
      if (!teamId) return json({error:'Номер команды обязателен.'},400);
      await removeFavorite(userId,teamId,cfg);
      return json({ok:true});
    }
    return json({ error: 'Метод не поддерживается.' }, 405);
  }
  
  
  function publicFavoritePlayer(row = {}) {
    const source=plainObject(row) || {};
    return {
      playerId:positiveId(source.player_id) || null,
      playerName:safeText(source.player_name,180),
      teamId:positiveId(source.team_id) || null,
      createdAt:safeText(source.created_at,80) || null,
    };
  }
  
  async function resolveFavoritePlayerIdentity(input = {}, cfg) {
    const source=plainObject(input) || {};
    const playerId=positiveId(source.playerId);
    const teamId=positiveId(source.teamId);
    const fixtureId=positiveId(source.fixtureId);
  
    if (!playerId || !teamId || !fixtureId) {
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
  
    const match=plainObject(center?.match) || {};
    const side=['home','away'].find(key=>positiveId(plainObject(match[key])?.id)===teamId);
    if (!side) {
      return {
        ok: false,
        status: 422,
        code: 'FAVORITE_PLAYER_TEAM_MISMATCH',
        error: 'Игрок не относится к выбранной команде этого матча.',
      };
    }
  
    const leaders=Array.isArray(center?.playerLeaders?.[side])
      ? center.playerLeaders[side].filter(item=>plainObject(item))
      : [];
    const player=leaders.find(item=>positiveId(item.id)===playerId);
    const playerName=safeText(player?.name,180).trim();
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
  
    const userId=positiveId(user?.id);
    if (!userId) return json({error:'Сессия Telegram не подтверждена.',code:'AUTH_REQUIRED'},401);

    if (request.method === 'GET') {
      const rows=safeRows(await getFavoritePlayers(userId,cfg));
      return json({
        items:rows.map(publicFavoritePlayer),
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
  
      const row=await addFavoritePlayer(userId,resolved.player,cfg);
      return json({
        ok: true,
        item: publicFavoritePlayer(row),
        notificationContract,
      });
    }
  
    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const playerId=positiveId(url.searchParams.get('playerId'));
      if (!playerId) {
        return json({ error: 'Номер игрока обязателен.', code: 'FAVORITE_PLAYER_INVALID' }, 400);
      }
      await removeFavoritePlayer(userId,playerId,cfg);
      return json({ ok: true, notificationContract });
    }
  
    return json({ error: 'Метод не поддерживается.' }, 405);
  }
  
  async function apiDigestSettings(request, cfg, user) {
    const telegramId=positiveId(user?.id);
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
      void Promise.resolve(recordOpsEvent(cfg,{
        severity:'info',
        source:'telegram',
        eventType:'digest_subscription',
        code:body.enabled?'DIGEST_SUBSCRIPTION_ENABLED':'DIGEST_SUBSCRIPTION_DISABLED',
        message:body.enabled?'Mini App digest subscription enabled.':'Mini App digest subscription disabled.',
        endpoint:'/api/digest-settings',
        meta:{channel:'miniapp',enabled:body.enabled,plan:safeText(quota?.plan,40) || 'FREE'},
      })).catch(()=>null);
      return json({ok:true,settings:publicDigestSettings(row,quota?.plan,favorites)});
    }
  
    return json({error:'Метод не поддерживается.'},405);
  }
  
  function publicReminder(row = {}) {
    const source=plainObject(row) || {};
    const reminderMinutes=integerCandidate(source.remind_before_minutes);
    const prematchAttempts=nonNegativeCount(source.prematch_attempts);
    const kickoffAttempts=nonNegativeCount(source.kickoff_attempts);
    return {
      fixtureId:positiveId(source.fixture_id) || null,
      homeName:safeText(source.home_name,180),
      awayName:safeText(source.away_name,180),
      leagueName:safeText(source.league_name,180),
      fixtureDate:safeText(source.fixture_date,80),
      notifiedAt:safeText(source.notified_at,80) || null,
      remindBeforeMinutes:[15,30,60].includes(reminderMinutes) ? reminderMinutes : 30,
      kickoffNotify:source.kickoff_notify !== false,
      kickoffNotifiedAt:safeText(source.kickoff_notified_at,80) || null,
      deliveryStatus:reminderDeliveryStatus(source),
      deliveryAttempts:Math.min(2_000_000,prematchAttempts+kickoffAttempts),
      deliveryLastAttemptAt:safeText(source.delivery_last_attempt_at,80) || null,
    };
  }
  
  async function apiReminders(request, cfg, user) {
    const userId=positiveId(user?.id);
    if (!userId) return json({error:'Сессия Telegram не подтверждена.',code:'AUTH_REQUIRED'},401);

    if (request.method === 'GET') {
      const rows=safeRows(await getReminders(userId,cfg));
      return json({items:rows.map(publicReminder)});
    }
    if (request.method === 'POST') {
      let body;
      try { body=plainObject(await request.json()); } catch { body=null; }
      if (!body) return json({error:'Некорректное тело запроса.',code:'REMINDER_INVALID_JSON'},400);

      const row=await addReminder(userId,body,cfg);
      return json({ok:true,item:publicReminder(row)});
    }
    if (request.method === 'DELETE') {
      const fixtureId=positiveId(new URL(request.url).searchParams.get('fixtureId'));
      if (!fixtureId) return json({error:'Номер матча обязателен.'},400);
      await removeReminder(userId,fixtureId,cfg);
      return json({ok:true});
    }
    return json({ error: 'Метод не поддерживается.' }, 405);
  }
  
  async function apiPreferences(request, cfg, user) {
    const userId=positiveId(user?.id);
    if (!userId) return json({error:'Сессия Telegram не подтверждена.',code:'AUTH_REQUIRED'},401);

    if (request.method === 'GET') {
      const [preferences, quota] = await Promise.all([
        getPreferences(userId,cfg),
        getQuota(userId,cfg),
      ]);
      return json({
        preferences,
        notificationCapabilities:publicSmartNotificationCapabilities(quota?.plan),
      });
    }
    if (request.method === 'PUT' || request.method === 'POST') {
      let body;
      try { body=plainObject(await request.json()); } catch { body=null; }
      if (!body) return json({error:'Некорректное тело запроса.',code:'PREFERENCES_INVALID_JSON'},400);

      const preferences=await savePreferences(userId,body,cfg);
      const quota=await getQuota(userId,cfg);
      return json({
        ok:true,
        preferences,
        notificationCapabilities:publicSmartNotificationCapabilities(quota?.plan),
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
