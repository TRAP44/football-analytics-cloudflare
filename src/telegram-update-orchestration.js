// Telegram update command/callback orchestration boundary for Issue #440.
// All network, persistence, billing and product capabilities are injected by worker.js.
export function createTelegramUpdateProcessor(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Telegram update orchestration dependencies are required.');
  }

  const {
    loadRuntimeControls,
    telegramLockdownDecision,
    telegramApi,
    json,
    parseInvoicePayload,
    billingPlanConfig,
    parsePassInvoicePayload,
    passProductConfig,
    setBotDigestSubscription,
    telegramWebAppUrl,
    recordGrowthEvent,
    footballBotKeyboard,
    sendBotDayMatches,
    cleanNewsImpactDecisionCode,
    cleanNewsImpactActionCode,
    cleanNewsImpactRecoveryCode,
    recordNewsImpactRecoveryAttempt,
    sendGeneralFootballNews,
    recordNewsImpactOutcome,
    sendNewsImpactRecoveryMessage,
    sendBotFixtureShareCard,
    sendBotFixtureSection,
    newsPublishedAtFromDayToken,
    newsTeamByToken,
    botRemoteTeamMatches,
    newsRelevantFixture,
    newsTeamToken,
    sendBotFootballSearch,
    sendFavoriteTeamNews,
    toggleBotFavorite,
    loadBotFixtureCard,
    getFavorites,
    footballMatchActionKeyboard,
    setCache,
    postMatchReturnDisabledKey,
    memory,
    hasSupabase,
    supaDelete,
    applySuccessfulPayment,
    applyRefundedPayment,
    updateUserSubscription,
    telegramStartPayload,
    upsertUser,
    parseLaunchStartParam,
    ensureLaunchAttribution,
    applyReferralAttribution,
    configureFootballBot,
    sendBotFixtureMenu,
    sendFootballBotHome,
    footballBotMoreKeyboard,
    sendFootballBotHelp,
    sendBotFavoriteTeams,
    sendBotFavoriteTeamMatches,
    sendDailyPicks,
    sendLastAiVerdict,
    sendBotAiTrackRecord,
    sendDigestControls,
  } = deps;

  const requiredFunctions={
    loadRuntimeControls,
    telegramLockdownDecision,
    telegramApi,
    json,
    parseInvoicePayload,
    billingPlanConfig,
    parsePassInvoicePayload,
    passProductConfig,
    setBotDigestSubscription,
    telegramWebAppUrl,
    footballBotKeyboard,
    sendBotDayMatches,
    cleanNewsImpactDecisionCode,
    cleanNewsImpactActionCode,
    cleanNewsImpactRecoveryCode,
    recordNewsImpactRecoveryAttempt,
    sendGeneralFootballNews,
    recordNewsImpactOutcome,
    sendNewsImpactRecoveryMessage,
    sendBotFixtureShareCard,
    sendBotFixtureSection,
    newsPublishedAtFromDayToken,
    newsTeamByToken,
    botRemoteTeamMatches,
    newsRelevantFixture,
    newsTeamToken,
    sendBotFootballSearch,
    sendFavoriteTeamNews,
    toggleBotFavorite,
    loadBotFixtureCard,
    getFavorites,
    footballMatchActionKeyboard,
    setCache,
    postMatchReturnDisabledKey,
    hasSupabase,
    supaDelete,
    applySuccessfulPayment,
    applyRefundedPayment,
    updateUserSubscription,
    telegramStartPayload,
    upsertUser,
    parseLaunchStartParam,
    ensureLaunchAttribution,
    applyReferralAttribution,
    configureFootballBot,
    sendBotFixtureMenu,
    sendFootballBotHome,
    footballBotMoreKeyboard,
    sendFootballBotHelp,
    sendBotFavoriteTeams,
    sendBotFavoriteTeamMatches,
    sendDailyPicks,
    sendLastAiVerdict,
    sendBotAiTrackRecord,
    sendDigestControls,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function textValue(value, max = 240) {
    if (typeof value !== 'string' || value.length > Math.max(max * 4,max)) return '';
    const text=value.trim();
    if (!text || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return '';
    return text.slice(0,max);
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || value.length > 24) return null;
    const raw=value.trim();
    if (!/^-?\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveInteger(value) {
    const number=integerCandidate(value);
    return number !== null && number>0 ? number : 0;
  }

  function nonNegativeInteger(value, fallback = 0) {
    const number=integerCandidate(value);
    return number !== null && number>=0 ? number : fallback;
  }

  function telegramChatId(value) {
    const number=integerCandidate(value);
    return number !== null && number !== 0 ? number : 0;
  }

  function telegramUserId(value, fallback = 0) {
    return positiveInteger(value) || positiveInteger(fallback);
  }

  function samePositiveInteger(left, right) {
    const a=positiveInteger(left);
    const b=positiveInteger(right);
    return a>0 && b>0 && a===b;
  }

  function boundedErrorText(value, fallback, max = 180) {
    return textValue(value,max) || fallback;
  }

  async function swallowAsync(fn, ...args) {
    if (typeof fn !== 'function') return null;
    try { return await fn(...args); }
    catch { return null; }
  }

  function safeWebAppUrl(request, params = {}) {
    try {
      const raw=textValue(telegramWebAppUrl(request,params),4096);
      if (!raw) return '';
      const url=new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function safeBotKeyboard(request) {
    try {
      const keyboard=footballBotKeyboard(request);
      return plainObject(keyboard) || undefined;
    } catch {
      return undefined;
    }
  }

  function backgroundGrowthEvent(cfg,event) {
    if (typeof recordGrowthEvent !== 'function') return;
    try {
      const task=recordGrowthEvent(cfg,event);
      if (task && typeof task.catch === 'function') task.catch(()=>null);
    } catch {}
  }

  function transientControlPlaneError(error) {
    const source=error instanceof Error ? error : plainObject(error);
    const failure=new Error(
      textValue(source?.message,500)
      || 'Telegram runtime controls are unavailable.',
    );
    failure.code=textValue(source?.code,80) || 'TELEGRAM_UPSTREAM';
    if (source?.retryAfter !== undefined) failure.retryAfter=source.retryAfter;
    if (error instanceof Error) failure.cause=error;
    return failure;
  }

  return async function processTelegramUpdate(request, cfg, update) {
  cfg=plainObject(cfg) || {};
  update=plainObject(update);
  if (!update) return json({ok:false,error:'telegram_update_invalid'},400);

  let runtimeState;
  try {
    runtimeState=await loadRuntimeControls(cfg);
  } catch (error) {
    throw transientControlPlaneError(error);
  }
  const runtimeValue=plainObject(runtimeState)?.value;
  if (!plainObject(runtimeValue)) {
    throw transientControlPlaneError(new Error('Telegram runtime controls returned an invalid state.'));
  }

  let lockdown;
  try {
    lockdown=plainObject(telegramLockdownDecision(update,{runtime:runtimeValue}));
  } catch (error) {
    throw transientControlPlaneError(error);
  }
  if (!lockdown) throw transientControlPlaneError(new Error('Telegram lockdown decision is unavailable.'));
  if (lockdown.blocked) {
    if (update.pre_checkout_query && lockdown.rejectCheckout) {
      await telegramApi('answerPreCheckoutQuery', cfg, {
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: false,
        error_message: 'Оплата временно приостановлена аварийным режимом безопасности. Попробуйте позже.',
      }).catch(() => null);
    } else if (update.callback_query?.id) {
      await telegramApi('answerCallbackQuery', cfg, {
        callback_query_id: update.callback_query.id,
        text: 'Security Lockdown: действие временно недоступно.',
        show_alert: true,
      }).catch(() => null);
    }
    return json({ ok: true, securityLockdown: true });
  }

  if (update.pre_checkout_query) {
    const q=plainObject(update.pre_checkout_query);
    const preCheckoutId=textValue(q?.id,120);
    if (!q || !preCheckoutId) return json({ok:false,error:'pre_checkout_invalid'},400);
    if (!cfg.monetizationEnabled) {
      await telegramApi('answerPreCheckoutQuery', cfg, {
        pre_checkout_query_id: preCheckoutId,
        ok: false,
        error_message: 'Оплата временно отключена: мы завершаем основной функционал сервиса.',
      });
      return json({ ok: true });
    }
    let ok = false;
    let errorMessage = 'Не удалось проверить подписку.';
    try {
      const invoicePayload=textValue(q.invoice_payload,512);
      const parsed = invoicePayload ? await parseInvoicePayload(invoicePayload, cfg.botToken) : null;
      const planCfg = plainObject(parsed) ? billingPlanConfig(parsed.plan, cfg) : null;
      const pass = parsed ? null : invoicePayload ? await parsePassInvoicePayload(invoicePayload, cfg.botToken) : null;
      const passCfg = pass ? passProductConfig(pass.passType, cfg) : null;
      const checkoutUserId=positiveInteger(q.from?.id);
      const checkoutAmount=positiveInteger(q.total_amount);
      ok = Boolean(
        q.currency === 'XTR'
        && checkoutUserId>0
        && checkoutAmount>0
        && (
          (parsed
            && samePositiveInteger(parsed.userId,checkoutUserId)
            && planCfg
            && samePositiveInteger(planCfg.stars,checkoutAmount))
          || (pass
            && samePositiveInteger(pass.userId,checkoutUserId)
            && passCfg
            && samePositiveInteger(passCfg.stars,checkoutAmount))
        )
      );
      if (!ok) errorMessage = 'Параметры покупки не совпадают. Откройте приложение и создайте счёт заново.';
    } catch {}
    await telegramApi('answerPreCheckoutQuery', cfg, {
      pre_checkout_query_id: preCheckoutId,
      ok,
      ...(ok ? {} : { error_message: errorMessage }),
    });
    return json({ ok: true });
  }

  if (update.callback_query) {
    const cb=plainObject(update.callback_query);
    const callbackId=textValue(cb?.id,120);
    if (!cb || !callbackId) return json({ok:false,error:'callback_query_invalid'},400);
    const data=textValue(cb.data,128);
    const callbackChatId=telegramChatId(cb.message?.chat?.id);
    const callbackUserId=telegramUserId(cb.from?.id);
    if (callbackChatId && !callbackUserId) {
      return json({ok:false,error:'telegram_user_invalid'},400);
    }
    if (callbackChatId && data === 'digest:on') {
      await setBotDigestSubscription(callbackUserId, callbackChatId, true, cfg, safeWebAppUrl(request));
      backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'digest_opt_in',channel:'telegram'});
      await telegramApi('answerCallbackQuery', cfg, { callback_query_id: callbackId, text: 'Утренняя подборка включена' });
      const replyMarkup=safeBotKeyboard(request);
      await telegramApi('sendMessage', cfg, {
        chat_id:callbackChatId,
        text:'✅ Утренняя подборка включена. Примерно в 07:00 UTC будут приходить матчи дня и короткий блок важных футбольных новостей.',
        ...(replyMarkup ? {reply_markup:replyMarkup} : {}),
      });
      return json({ ok: true });
    }
    if (callbackChatId && data === 'digest:off') {
      await setBotDigestSubscription(callbackUserId, callbackChatId, false, cfg, safeWebAppUrl(request));
      await telegramApi('answerCallbackQuery', cfg, { callback_query_id: callbackId, text: 'Утренняя подборка выключена' });
      const replyMarkup=safeBotKeyboard(request);
      await telegramApi('sendMessage', cfg, {
        chat_id:callbackChatId,
        text:'🔕 Утренняя AI-подборка отключена.',
        ...(replyMarkup ? {reply_markup:replyMarkup} : {}),
      });
      return json({ ok: true });
    }
    if (callbackChatId && data === 'feed:today') {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Обновляю матчи…'}).catch(()=>null);
      await sendBotDayMatches(request,cfg,callbackChatId,{liveOnly:false});
      return json({ok:true});
    }
    if (callbackChatId && data === 'feed:live') {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Обновляю LIVE…'}).catch(()=>null);
      await sendBotDayMatches(request,cfg,callbackChatId,{liveOnly:true});
      return json({ok:true});
    }
    const newsImpactAction=data.match(/^news:impact:(material|detail|stable|guarded|baseline_missing|unavailable):(squads|market|recheck|news|share):(\d+)$/);
    const newsImpactRecoveryAction=data.match(/^ni:r:(material|detail|stable|guarded|baseline_missing|unavailable):(squads|market|recheck|news|share):(retry|retry_soon|retry_later|wait_quota_reset|open_full_ai):(\d+)$/);
    if (callbackChatId && (newsImpactAction || newsImpactRecoveryAction)) {
      const matched=newsImpactRecoveryAction || newsImpactAction;
      const decision=cleanNewsImpactDecisionCode(matched[1]);
      const action=cleanNewsImpactActionCode(matched[2]);
      const recoveryCode=newsImpactRecoveryAction ? cleanNewsImpactRecoveryCode(matched[3]) : '';
      const fixtureId=positiveInteger(matched[newsImpactRecoveryAction ? 4 : 3]);
      if (recoveryCode) await recordNewsImpactRecoveryAttempt(cfg,{userId:callbackUserId,fixtureId,decision,action,recovery:recoveryCode,channel:'telegram'});
      backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_impact_action',channel:'telegram',fixtureId,metadata:{decision,action,...(recoveryCode ? {recovery:recoveryCode} : {})}});
      if (action==='news') {
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Открываю новости…'}).catch(()=>null);
        try {
          await sendGeneralFootballNews(request,cfg,callbackUserId,callbackChatId,{force:false});
          await recordNewsImpactOutcome(cfg,{userId:callbackUserId,fixtureId,decision,action,channel:'telegram'});
        } catch (error) {
          await sendNewsImpactRecoveryMessage(request,cfg,{userId:callbackUserId,chatId:callbackChatId,fixtureId,decision,action,error,fallback:'provider_unavailable'});
          return json({ok:true,recovered:true});
        }
        return json({ok:true});
      }
      if (action==='share') {
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Готовлю ссылку…'}).catch(()=>null);
        try {
          await sendBotFixtureShareCard(request,cfg,callbackUserId,callbackChatId,fixtureId);
          await recordNewsImpactOutcome(cfg,{userId:callbackUserId,fixtureId,decision,action,channel:'telegram'});
        } catch (error) {
          await sendNewsImpactRecoveryMessage(request,cfg,{userId:callbackUserId,chatId:callbackChatId,fixtureId,decision,action,error,fallback:'telegram_delivery'});
          return json({ok:true,recovered:true});
        }
        return json({ok:true});
      }
      await telegramApi('answerCallbackQuery',cfg,{
        callback_query_id:callbackId,
        text:action==='recheck'?'Перепроверяю AI…':'Собираю футбольные данные…',
      }).catch(()=>null);
      const delivery=await sendBotFixtureSection(request,cfg,callbackUserId,callbackChatId,fixtureId,action==='recheck'?'verdict':action,{suppressFallback:true});
      if (!delivery?.ok) {
        const error=Object.assign(
          new Error(boundedErrorText(delivery?.message,'delivery_failed')),
          {
            status:nonNegativeInteger(delivery?.status),
            code:textValue(delivery?.code).slice(0,80),
          },
        );
        await sendNewsImpactRecoveryMessage(request,cfg,{userId:callbackUserId,chatId:callbackChatId,fixtureId,decision,action,error,fallback:'server_error'});
        return json({ok:true,recovered:true});
      }
      await recordNewsImpactOutcome(cfg,{userId:callbackUserId,fixtureId,decision,action,channel:'telegram'});
      return json({ok:true});
    }
    if (callbackChatId && (data === 'news:general' || data === 'news:refresh')) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:data==='news:refresh'?'Обновляю новости…':'Открываю новости…'}).catch(()=>null);
      await sendGeneralFootballNews(request,cfg,callbackUserId,callbackChatId,{force:data==='news:refresh'});
      return json({ok:true});
    }
    const datedNewsAiMatchAction=data.match(/^news:ai_match:(\d+):(\d{8})$/);
    const legacyNewsAiMatchAction=data.match(/^news:ai_match:(\d+)$/);
    const newsAiMatchAction=datedNewsAiMatchAction || legacyNewsAiMatchAction;
    if (callbackChatId && newsAiMatchAction) {
      const fixtureId=positiveInteger(newsAiMatchAction[1]);
      const newsPublishedAt=newsPublishedAtFromDayToken(datedNewsAiMatchAction?.[2] || '');
      backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_ai_intent',channel:'telegram',fixtureId,metadata:{mode:'direct_fixture',linking:'smart_fixture'}});
      backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_return',channel:'telegram',fixtureId,metadata:{origin:'news_ai_cta'}});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Сравниваю AI до и после новости…'}).catch(()=>null);
      await sendBotFixtureMenu(request,cfg,callbackUserId,callbackChatId,fixtureId,{source:'news_impact',newsImpactDelta:Boolean(newsPublishedAt),newsPublishedAt});
      return json({ok:true});
    }
    const datedNewsAiTeamAction=data.match(/^news:ai_team:([a-z0-9]{2,32}):(\d{8})$/);
    const legacyNewsAiTeamAction=data.match(/^news:ai_team:([a-z0-9]{2,32})$/);
    const newsAiTeamAction=datedNewsAiTeamAction || legacyNewsAiTeamAction;
    if (callbackChatId && newsAiTeamAction) {
      const team=newsTeamByToken(newsAiTeamAction[1]);
      if (!team) {
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Не удалось определить клуб',show_alert:true}).catch(()=>null);
        return json({ok:true});
      }
      const publishedAt=newsPublishedAtFromDayToken(datedNewsAiTeamAction?.[2] || '');
      if (publishedAt) {
        const parts={first:team.canonical,second:'',query:team.canonical,intent:'analysis'};
        const matches=await swallowAsync(botRemoteTeamMatches,parts,cfg) || [];
        const link=plainObject(newsRelevantFixture({publishedAt,category:{code:'general'}},Array.isArray(matches) ? matches : []));
        if (link?.fixture?.fixtureId) {
          const fixtureId=positiveInteger(link.fixture.fixtureId);
          backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_ai_intent',channel:'telegram',fixtureId,metadata:{mode:'team_smart_link',team:newsTeamToken(team),linking:'smart_fixture'}});
          backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_return',channel:'telegram',fixtureId,metadata:{origin:'news_ai_smart_link'}});
          await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{callback_query_id:callbackId,text:`Нашёл релевантный матч ${textValue(team.canonical,80) || 'клуба'}`});
          await sendBotFixtureMenu(request,cfg,callbackUserId,callbackChatId,fixtureId,{source:'news_impact',newsImpactDelta:true,newsPublishedAt:publishedAt});
          return json({ok:true});
        }
      }
      backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_ai_intent',channel:'telegram',metadata:{mode:'team_search',team:newsTeamToken(team)}});
      const teamName=textValue(team.canonical,80);
      if (!teamName) return json({ok:false,error:'news_team_invalid'},400);
      await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{callback_query_id:callbackId,text:`Ищу ближайший матч ${teamName}…`});
      await sendBotFootballSearch(request,cfg,callbackUserId,callbackChatId,teamName);
      return json({ok:true});
    }
    const newsMatchAction=data.match(/^news:match:(\d+)$/);
    if (callbackChatId && newsMatchAction) {
      const fixtureId=positiveInteger(newsMatchAction[1]);
      backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_return',channel:'telegram',fixtureId,metadata:{origin:'team_news'}});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Открываю матч из новости…'}).catch(()=>null);
      await sendBotFixtureMenu(request,cfg,callbackUserId,callbackChatId,fixtureId);
      return json({ok:true});
    }
    const newsTeamAction=data.match(/^news:team:(\d+)$/);
    if (callbackChatId && newsTeamAction) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Ищу новости клуба…'}).catch(()=>null);
      await sendFavoriteTeamNews(request,cfg,callbackUserId,callbackChatId,positiveInteger(newsTeamAction[1]),{force:false});
      return json({ok:true});
    }
    const newsTeamRefresh=data.match(/^news:team_refresh:(\d+)$/);
    if (callbackChatId && newsTeamRefresh) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Обновляю новости клуба…'}).catch(()=>null);
      await sendFavoriteTeamNews(request,cfg,callbackUserId,callbackChatId,positiveInteger(newsTeamRefresh[1]),{force:true});
      return json({ok:true});
    }
    const favoriteToggle=data.match(/^favorite:toggle:(\d+):(\d+)$/);
    if (callbackChatId && favoriteToggle) {
      const teamId=positiveInteger(favoriteToggle[1]), fixtureId=positiveInteger(favoriteToggle[2]);
      try {
        const result=plainObject(await toggleBotFavorite(callbackUserId,teamId,cfg));
        if (!result || typeof result.active !== 'boolean') throw new Error('Некорректный ответ избранного.');
        if (result.active) backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'favorite_add',channel:'telegram',fixtureId,metadata:{teamId}});
        const teamName=textValue(plainObject(result.team)?.name,80) || 'Команда';
        await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{callback_query_id:callbackId,text:result.active?`★ ${teamName} добавлен в «Мои команды»`:`☆ ${teamName} удалён из «Моих команд»`});
        if (fixtureId && cb.message?.message_id) {
          const [match,favorites]=await Promise.all([loadBotFixtureCard(fixtureId,cfg),getFavorites(callbackUserId,cfg)]);
          if (match) await telegramApi('editMessageReplyMarkup',cfg,{
            chat_id:callbackChatId,
            message_id:positiveInteger(cb.message.message_id),
            reply_markup:footballMatchActionKeyboard(request,match,'',favorites),
          }).catch(()=>null);
        }
      } catch (error) {
        await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{
          callback_query_id:callbackId,
          text:boundedErrorText(error?.message,'Не удалось изменить избранное',160),
          show_alert:true,
        });
      }
      return json({ok:true});
    }
    const favoriteAction=data.match(/^favorite:team:(\d+)$/);
    if (callbackChatId && favoriteAction) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Ищу матчи клуба…'}).catch(()=>null);
      await sendBotFavoriteTeamMatches(request,cfg,callbackUserId,callbackChatId,positiveInteger(favoriteAction[1]));
      return json({ok:true});
    }
    if (callbackChatId && data === 'postmatch:return:off') {
      await setCache(postMatchReturnDisabledKey(callbackUserId),0,{disabledAt:new Date().toISOString(),source:'telegram'},cfg,525600);
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Итоги после матчей отключены'}).catch(()=>null);
      await telegramApi('sendMessage',cfg,{chat_id:callbackChatId,text:'🔕 Автоматические итоги после проанализированных матчей отключены.',reply_markup:{inline_keyboard:[[{text:'🔔 Включить обратно',callback_data:'postmatch:return:on'}]]}}).catch(()=>null);
      return json({ok:true});
    }
    if (callbackChatId && data === 'postmatch:return:on') {
      const disabledKey=textValue(postMatchReturnDisabledKey(callbackUserId),240);
      if (!disabledKey) return json({ok:false,error:'postmatch_key_invalid'},500);
      if (memory?.cache instanceof Map) memory.cache.delete(disabledKey);
      let persistent=false;
      try { persistent=hasSupabase(cfg) === true; } catch {}
      if (persistent) await swallowAsync(supaDelete,cfg,'analysis_cache',{cache_key:`eq.${disabledKey}`});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Итоги после матчей включены'}).catch(()=>null);
      await telegramApi('sendMessage',cfg,{chat_id:callbackChatId,text:'🔔 Автоматические итоги после проанализированных матчей снова включены.'}).catch(()=>null);
      return json({ok:true});
    }
    const returnReview=data.match(/^match:return_review:(\d+)$/);
    if (callbackChatId && returnReview) {
      const fixtureId=positiveInteger(returnReview[1]);
      backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'post_match_return_open',channel:'telegram',fixtureId});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Открываю итог AI…'}).catch(()=>null);
      await sendBotFixtureSection(request,cfg,callbackUserId,callbackChatId,fixtureId,'review');
      return json({ok:true});
    }
    const shareAction=data.match(/^match:share:(\d+)$/);
    if (callbackChatId && shareAction) {
      const fixtureId=positiveInteger(shareAction[1]);
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Готовлю ссылку…'}).catch(()=>null);
      try { await sendBotFixtureShareCard(request,cfg,callbackUserId,callbackChatId,fixtureId); }
      catch { await telegramApi('sendMessage',cfg,{chat_id:callbackChatId,text:'Не удалось подготовить ссылку на этот матч.'}).catch(()=>null); }
      return json({ok:true});
    }
    const matchAction = data.match(/^match:(menu|verdict|referee|squads|market|refresh|review):(\d+)$/);
    if (callbackChatId && matchAction) {
      const section = matchAction[1];
      const fixtureId = positiveInteger(matchAction[2]);
      await telegramApi('answerCallbackQuery', cfg, {
        callback_query_id: callbackId,
        text: section === 'menu' ? 'Готовлю короткую AI-оценку…' : section === 'review' ? 'Сверяю прогноз с фактом…' : 'Собираю футбольные данные…',
      }).catch(()=>null);
      if (section === 'menu') await sendBotFixtureMenu(request, cfg, callbackUserId, callbackChatId, fixtureId);
      else await sendBotFixtureSection(request, cfg, callbackUserId, callbackChatId, fixtureId, section === 'refresh' ? 'verdict' : section);
      return json({ ok: true });
    }
    await telegramApi('answerCallbackQuery', cfg, { callback_query_id: callbackId }).catch(()=>null);
    return json({ ok: true });
  }

  const msg=plainObject(update.message);
  if (msg?.successful_payment) {
    const payment=plainObject(msg.successful_payment);
    const userId=positiveInteger(msg.from?.id);
    if (!payment || !userId) return json({ok:false,error:'telegram_payment_invalid'},400);
    const eventTime=nonNegativeInteger(msg.date,Math.floor(Date.now()/1000));
    await applySuccessfulPayment(userId,payment,cfg,eventTime);
    return json({ok:true});
  }

  if (msg?.refunded_payment) {
    const refund=plainObject(msg.refunded_payment);
    const userId=positiveInteger(msg.from?.id);
    const chargeId=textValue(refund?.telegram_payment_charge_id,256);
    if (!refund || !userId || !chargeId) return json({ok:false,error:'telegram_refund_invalid'},400);
    await applyRefundedPayment(userId,chargeId,cfg);
    return json({ok:true});
  }

  if (update.subscription) {
    const sub=plainObject(update.subscription);
    const invoicePayload=textValue(sub?.invoice_payload,512);
    const state=textValue(sub?.state,32);
    const subscriptionUserId=positiveInteger(sub?.user?.id);
    if (!sub || !invoicePayload || !subscriptionUserId || !['active','canceled'].includes(state)) {
      return json({ok:false,error:'telegram_subscription_invalid'},400);
    }
    const parsed=plainObject(await parseInvoicePayload(invoicePayload,cfg.botToken));
    if (parsed && samePositiveInteger(parsed.userId,subscriptionUserId)) {
      if (state === 'canceled') {
        await updateUserSubscription(parsed.userId, { subscription_canceled: true }, cfg);
      } else if (state === 'active') {
        await updateUserSubscription(parsed.userId, { subscription_canceled: false }, cfg);
      }
    }
    return json({ ok: true });
  }

  const text=textValue(msg?.text,4096);
  const chatId=telegramChatId(msg?.chat?.id);
  if (chatId && /^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
    const userId=telegramUserId(msg.from?.id);
    if (!userId) return json({ok:false,error:'telegram_user_invalid'},400);
    const startParam=textValue(telegramStartPayload(text),64);
    await swallowAsync(upsertUser,plainObject(msg.from) || {id:userId},cfg);
    const launchIntent=plainObject(parseLaunchStartParam(startParam)) || {};
    const attribution=plainObject(await ensureLaunchAttribution(userId,startParam,cfg)) || {};
    const referral=plainObject(await swallowAsync(applyReferralAttribution,userId,launchIntent,cfg))
      || {accepted:false,status:'unavailable'};
    const eventAttribution=startParam ? launchIntent : attribution;
    const launchFixtureId=positiveInteger(launchIntent.fixtureId);
    backgroundGrowthEvent(cfg,{userId,eventName:'bot_start',channel:'telegram',attribution:eventAttribution,fixtureId:launchFixtureId || null,metadata:{attributed:Boolean(startParam),fixtureDeepLink:launchFixtureId>0,referralStatus:referral.status}});
    await configureFootballBot(request, cfg, chatId);
    if (launchFixtureId>0) {
      backgroundGrowthEvent(cfg,{
        userId,
        eventName:'share_open',
        channel:'telegram',
        fixtureId:launchFixtureId,
        attribution:launchIntent,
        metadata:{referral:Boolean(launchIntent.referralCode),referralStatus:referral.status},
        eventKey:`share_open:${userId}:${startParam}`,
      });
      backgroundGrowthEvent(cfg,{userId,eventName:'fixture_deep_link_open',channel:'telegram',fixtureId:launchFixtureId,attribution:launchIntent,metadata:{startParam}});
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'⚡ Ссылка ведёт прямо на матч. Загружаю AI-разбор без повторного поиска…'}).catch(()=>null);
      await sendBotFixtureMenu(request,cfg,userId,chatId,launchFixtureId,{attribution:launchIntent,source:'deep_link'});
      return json({ok:true});
    }
    await sendFootballBotHome(request, cfg, chatId, msg.from || {});
    return json({ ok: true });
  }

  if (chatId && text === '••• Ещё') {
    await telegramApi('sendMessage', cfg, { chat_id:chatId, text:'Дополнительные функции:', reply_markup:footballBotMoreKeyboard(request) });
    return json({ ok: true });
  }

  if (chatId && text === '← Главное меню') {
    await telegramApi('sendMessage', cfg, { chat_id:chatId, text:'Главное меню', reply_markup:footballBotKeyboard(request) });
    return json({ ok: true });
  }

  if (chatId && /^\/paysupport(?:@\w+)?(?:\s|$)/i.test(text)) {
    await telegramApi('sendMessage', cfg, {
      chat_id: chatId,
      text: [
        '⭐ Поддержка по оплате MatchRadar',
        '',
        'Если Stars списаны, а тариф не обновился — откройте Профиль → MatchRadar Pro и нажмите «Проверить оплату».',
        'Возврат выполняется только после ручной проверки администратором MatchRadar.',
        'Не отправляйте данные карты или секретные коды: платежи проходят через Telegram Stars.',
      ].join('\n'),
      ...(safeWebAppUrl(request,{view:'profile'})
        ? {reply_markup:{inline_keyboard:[[{text:'Открыть Профиль',web_app:{url:safeWebAppUrl(request,{view:'profile'})}}]]}}
        : {}),
    });
    return json({ ok:true });
  }

  if (chatId && (/^\/help(?:@\w+)?(?:\s|$)/i.test(text) || text === 'ℹ️ Как это работает')) {
    await sendFootballBotHelp(request, cfg, chatId);
    return json({ ok: true });
  }

  if (chatId && (/^\/today(?:@\w+)?(?:\s|$)/i.test(text) || /^матчи$/i.test(text) || (text === '⚽ Матчи сегодня' || text === '⚽ Матчи'))) {
    await sendBotDayMatches(request,cfg,chatId,{liveOnly:false});
    return json({ ok: true });
  }

  if (chatId && (/^\/live(?:@\w+)?(?:\s|$)/i.test(text) || /^live$/i.test(text) || /^лайв$/i.test(text) || text === '🔴 LIVE')) {
    await sendBotDayMatches(request,cfg,chatId,{liveOnly:true});
    return json({ ok: true });
  }

  if (chatId && (/^\/favorites(?:@\w+)?(?:\s|$)/i.test(text) || text === '⭐ Мои команды')) {
    await sendBotFavoriteTeams(request,cfg,telegramUserId(msg.from?.id,chatId>0 ? chatId : 0),chatId);
    return json({ ok: true });
  }

  if (chatId && text === '📰 Новости') {
    await sendGeneralFootballNews(request,cfg,telegramUserId(msg.from?.id,chatId>0 ? chatId : 0),chatId,{force:false});
    return json({ ok: true });
  }

  if (chatId && (/^\/picks(?:@\w+)?(?:\s|$)/i.test(text) || (text === '🧠 AI-подборка' || text === '🤖 AI-подборка'))) {
    await sendDailyPicks(request, cfg, chatId);
    return json({ ok: true });
  }

  if (chatId && text === '🔎 Найти матч') {
    await telegramApi('sendMessage', cfg, {
      chat_id:chatId,
      text:'🔎 Напишите клуб или конкретный матч. Можно по-русски: «Реал», «ПСЖ», «Бавария», «Бока Хуниорс», «Аль-Наср», «Интер Майами» или «Интер — Милан». Я ищу глобально, а кнопки разбора покажу прямо здесь.',
    });
    return json({ ok: true });
  }

  if (chatId && /^\/(?:search|ask)(?:@\w+)?(?:\s|$)/i.test(text)) {
    await sendBotFootballSearch(request, cfg, telegramUserId(msg.from?.id,chatId>0 ? chatId : 0), chatId, text);
    return json({ ok: true });
  }

  if (chatId && (/^\/last(?:@\w+)?(?:\s|$)/i.test(text) || text === '🕘 Последний разбор')) {
    await sendLastAiVerdict(request, cfg, telegramUserId(msg.from?.id,chatId>0 ? chatId : 0), chatId);
    return json({ ok: true });
  }

  if (chatId && (/^\/track(?:@\w+)?(?:\s|$)/i.test(text) || text === '📈 Протокол AI')) {
    await sendBotAiTrackRecord(request,cfg,chatId);
    return json({ok:true});
  }

  if (chatId && text === '☀️ Утренняя подборка') {
    await sendDigestControls(request, cfg, chatId);
    return json({ ok: true });
  }

  if (chatId && /^\/digest(?:@\w+)?(?:\s|$)/i.test(text)) {
    const userId=telegramUserId(msg.from?.id);
    if (!userId) return json({ok:false,error:'telegram_user_invalid'},400);
    await setBotDigestSubscription(userId, chatId, true, cfg, safeWebAppUrl(request));
    const replyMarkup=safeBotKeyboard(request);
    await telegramApi('sendMessage', cfg, {
      chat_id:chatId,
      text:'✅ Утренняя подборка включена: матчи дня + главное в футболе.',
      ...(replyMarkup ? {reply_markup:replyMarkup} : {}),
    });
    return json({ ok: true });
  }

  if (chatId && /^\/digest_off(?:@\w+)?(?:\s|$)/i.test(text)) {
    const userId=telegramUserId(msg.from?.id);
    if (!userId) return json({ok:false,error:'telegram_user_invalid'},400);
    await setBotDigestSubscription(userId, chatId, false, cfg, safeWebAppUrl(request));
    const replyMarkup=safeBotKeyboard(request);
    await telegramApi('sendMessage', cfg, {
      chat_id:chatId,
      text:'🔕 Утренняя AI-подборка отключена.',
      ...(replyMarkup ? {reply_markup:replyMarkup} : {}),
    });
    return json({ ok: true });
  }

  if (chatId && /^(?:меню|главное меню|старт)$/i.test(text)) {
    await configureFootballBot(request, cfg, chatId);
    await sendFootballBotHome(request, cfg, chatId, msg.from || {});
    return json({ ok: true });
  }

  if (chatId && text && !text.startsWith('/')) {
    await sendBotFootballSearch(request, cfg, telegramUserId(msg.from?.id,chatId>0 ? chatId : 0), chatId, text);
  }

  return json({ ok: true });
}

}
