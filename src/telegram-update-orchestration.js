// Telegram update command/callback orchestration boundary for Issue #440.
// All network, persistence, billing and product capabilities are injected by worker.js.
export function createTelegramUpdateProcessor(deps) {
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

  return async function processTelegramUpdate(request, cfg, update) {
  const runtimeState = await loadRuntimeControls(cfg);
  const lockdown = telegramLockdownDecision(update, { runtime: runtimeState.value });
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
    const q = update.pre_checkout_query;
    if (!cfg.monetizationEnabled) {
      await telegramApi('answerPreCheckoutQuery', cfg, {
        pre_checkout_query_id: q.id,
        ok: false,
        error_message: 'Оплата временно отключена: мы завершаем основной функционал сервиса.',
      });
      return json({ ok: true });
    }
    let ok = false;
    let errorMessage = 'Не удалось проверить подписку.';
    try {
      const parsed = await parseInvoicePayload(q.invoice_payload, cfg.botToken);
      const planCfg = parsed ? billingPlanConfig(parsed.plan, cfg) : null;
      const pass = parsed ? null : await parsePassInvoicePayload(q.invoice_payload, cfg.botToken);
      const passCfg = pass ? passProductConfig(pass.passType, cfg) : null;
      ok = Boolean(
        q.currency === 'XTR'
        && (
          (parsed
            && Number(parsed.userId) === Number(q.from?.id)
            && planCfg
            && Number(q.total_amount) === Number(planCfg.stars))
          || (pass
            && Number(pass.userId) === Number(q.from?.id)
            && passCfg
            && Number(q.total_amount) === Number(passCfg.stars))
        )
      );
      if (!ok) errorMessage = 'Параметры покупки не совпадают. Откройте приложение и создайте счёт заново.';
    } catch {}
    await telegramApi('answerPreCheckoutQuery', cfg, {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: errorMessage }),
    });
    return json({ ok: true });
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const data = String(cb.data || '');
    const callbackChatId = cb.message?.chat?.id;
    const callbackUserId = Number(cb.from?.id || callbackChatId || 0);
    if (callbackChatId && data === 'digest:on') {
      await setBotDigestSubscription(callbackUserId, callbackChatId, true, cfg, telegramWebAppUrl(request));
      void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'digest_opt_in',channel:'telegram'});
      await telegramApi('answerCallbackQuery', cfg, { callback_query_id: cb.id, text: 'Утренняя подборка включена' });
      await telegramApi('sendMessage', cfg, { chat_id: callbackChatId, text: '✅ Утренняя подборка включена. Примерно в 07:00 UTC будут приходить матчи дня и короткий блок важных футбольных новостей.', reply_markup: footballBotKeyboard(request) });
      return json({ ok: true });
    }
    if (callbackChatId && data === 'digest:off') {
      await setBotDigestSubscription(callbackUserId, callbackChatId, false, cfg, telegramWebAppUrl(request));
      await telegramApi('answerCallbackQuery', cfg, { callback_query_id: cb.id, text: 'Утренняя подборка выключена' });
      await telegramApi('sendMessage', cfg, { chat_id: callbackChatId, text: '🔕 Утренняя AI-подборка отключена.', reply_markup: footballBotKeyboard(request) });
      return json({ ok: true });
    }
    if (callbackChatId && data === 'feed:today') {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Обновляю матчи…'}).catch(()=>null);
      await sendBotDayMatches(request,cfg,callbackChatId,{liveOnly:false});
      return json({ok:true});
    }
    if (callbackChatId && data === 'feed:live') {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Обновляю LIVE…'}).catch(()=>null);
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
      const fixtureId=Number(matched[newsImpactRecoveryAction ? 4 : 3]);
      if (recoveryCode) await recordNewsImpactRecoveryAttempt(cfg,{userId:callbackUserId,fixtureId,decision,action,recovery:recoveryCode,channel:'telegram'});
      void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_impact_action',channel:'telegram',fixtureId,metadata:{decision,action,...(recoveryCode ? {recovery:recoveryCode} : {})}});
      if (action==='news') {
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Открываю новости…'}).catch(()=>null);
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
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Готовлю ссылку…'}).catch(()=>null);
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
        callback_query_id:cb.id,
        text:action==='recheck'?'Перепроверяю AI…':'Собираю футбольные данные…',
      }).catch(()=>null);
      const delivery=await sendBotFixtureSection(request,cfg,callbackUserId,callbackChatId,fixtureId,action==='recheck'?'verdict':action,{suppressFallback:true});
      if (!delivery?.ok) {
        const error=Object.assign(new Error(delivery?.message || 'delivery_failed'),{status:Number(delivery?.status || 0),code:String(delivery?.code || '')});
        await sendNewsImpactRecoveryMessage(request,cfg,{userId:callbackUserId,chatId:callbackChatId,fixtureId,decision,action,error,fallback:'server_error'});
        return json({ok:true,recovered:true});
      }
      await recordNewsImpactOutcome(cfg,{userId:callbackUserId,fixtureId,decision,action,channel:'telegram'});
      return json({ok:true});
    }
    if (callbackChatId && (data === 'news:general' || data === 'news:refresh')) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:data==='news:refresh'?'Обновляю новости…':'Открываю новости…'}).catch(()=>null);
      await sendGeneralFootballNews(request,cfg,callbackUserId,callbackChatId,{force:data==='news:refresh'});
      return json({ok:true});
    }
    const datedNewsAiMatchAction=data.match(/^news:ai_match:(\d+):(\d{8})$/);
    const legacyNewsAiMatchAction=data.match(/^news:ai_match:(\d+)$/);
    const newsAiMatchAction=datedNewsAiMatchAction || legacyNewsAiMatchAction;
    if (callbackChatId && newsAiMatchAction) {
      const fixtureId=Number(newsAiMatchAction[1]);
      const newsPublishedAt=newsPublishedAtFromDayToken(datedNewsAiMatchAction?.[2] || '');
      void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_ai_intent',channel:'telegram',fixtureId,metadata:{mode:'direct_fixture',linking:'smart_fixture'}});
      void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_return',channel:'telegram',fixtureId,metadata:{origin:'news_ai_cta'}});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Сравниваю AI до и после новости…'}).catch(()=>null);
      await sendBotFixtureMenu(request,cfg,callbackUserId,callbackChatId,fixtureId,{source:'news_impact',newsImpactDelta:Boolean(newsPublishedAt),newsPublishedAt});
      return json({ok:true});
    }
    const datedNewsAiTeamAction=data.match(/^news:ai_team:([a-z0-9]{2,32}):(\d{8})$/);
    const legacyNewsAiTeamAction=data.match(/^news:ai_team:([a-z0-9]{2,32})$/);
    const newsAiTeamAction=datedNewsAiTeamAction || legacyNewsAiTeamAction;
    if (callbackChatId && newsAiTeamAction) {
      const team=newsTeamByToken(newsAiTeamAction[1]);
      if (!team) {
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Не удалось определить клуб',show_alert:true}).catch(()=>null);
        return json({ok:true});
      }
      const publishedAt=newsPublishedAtFromDayToken(datedNewsAiTeamAction?.[2] || '');
      if (publishedAt) {
        const parts={first:team.canonical,second:'',query:team.canonical,intent:'analysis'};
        const matches=await botRemoteTeamMatches(parts,cfg).catch(()=>[]);
        const link=newsRelevantFixture({publishedAt,category:{code:'general'}},matches || []);
        if (link?.fixture?.fixtureId) {
          const fixtureId=Number(link.fixture.fixtureId);
          void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_ai_intent',channel:'telegram',fixtureId,metadata:{mode:'team_smart_link',team:newsTeamToken(team),linking:'smart_fixture'}});
          void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_return',channel:'telegram',fixtureId,metadata:{origin:'news_ai_smart_link'}});
          await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:`Нашёл релевантный матч ${team.canonical}`}).catch(()=>null);
          await sendBotFixtureMenu(request,cfg,callbackUserId,callbackChatId,fixtureId,{source:'news_impact',newsImpactDelta:true,newsPublishedAt:publishedAt});
          return json({ok:true});
        }
      }
      void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_ai_intent',channel:'telegram',metadata:{mode:'team_search',team:newsTeamToken(team)}});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:`Ищу ближайший матч ${team.canonical}…`}).catch(()=>null);
      await sendBotFootballSearch(request,cfg,callbackUserId,callbackChatId,team.canonical);
      return json({ok:true});
    }
    const newsMatchAction=data.match(/^news:match:(\d+)$/);
    if (callbackChatId && newsMatchAction) {
      const fixtureId=Number(newsMatchAction[1]);
      void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'news_return',channel:'telegram',fixtureId,metadata:{origin:'team_news'}});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Открываю матч из новости…'}).catch(()=>null);
      await sendBotFixtureMenu(request,cfg,callbackUserId,callbackChatId,fixtureId);
      return json({ok:true});
    }
    const newsTeamAction=data.match(/^news:team:(\d+)$/);
    if (callbackChatId && newsTeamAction) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Ищу новости клуба…'}).catch(()=>null);
      await sendFavoriteTeamNews(request,cfg,callbackUserId,callbackChatId,Number(newsTeamAction[1]),{force:false});
      return json({ok:true});
    }
    const newsTeamRefresh=data.match(/^news:team_refresh:(\d+)$/);
    if (callbackChatId && newsTeamRefresh) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Обновляю новости клуба…'}).catch(()=>null);
      await sendFavoriteTeamNews(request,cfg,callbackUserId,callbackChatId,Number(newsTeamRefresh[1]),{force:true});
      return json({ok:true});
    }
    const favoriteToggle=data.match(/^favorite:toggle:(\d+):(\d+)$/);
    if (callbackChatId && favoriteToggle) {
      const teamId=Number(favoriteToggle[1]), fixtureId=Number(favoriteToggle[2]);
      try {
        const result=await toggleBotFavorite(callbackUserId,teamId,cfg);
        if (result.active) void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'favorite_add',channel:'telegram',fixtureId,metadata:{teamId}});
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:result.active?`★ ${result.team.name} добавлен в «Мои команды»`:`☆ ${result.team.name} удалён из «Моих команд»`}).catch(()=>null);
        if (fixtureId && cb.message?.message_id) {
          const [match,favorites]=await Promise.all([loadBotFixtureCard(fixtureId,cfg),getFavorites(callbackUserId,cfg)]);
          if (match) await telegramApi('editMessageReplyMarkup',cfg,{
            chat_id:callbackChatId,
            message_id:Number(cb.message.message_id),
            reply_markup:footballMatchActionKeyboard(request,match,'',favorites),
          }).catch(()=>null);
        }
      } catch (error) {
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:error?.message || 'Не удалось изменить избранное',show_alert:true}).catch(()=>null);
      }
      return json({ok:true});
    }
    const favoriteAction=data.match(/^favorite:team:(\d+)$/);
    if (callbackChatId && favoriteAction) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Ищу матчи клуба…'}).catch(()=>null);
      await sendBotFavoriteTeamMatches(request,cfg,callbackUserId,callbackChatId,Number(favoriteAction[1]));
      return json({ok:true});
    }
    if (callbackChatId && data === 'postmatch:return:off') {
      await setCache(postMatchReturnDisabledKey(callbackUserId),0,{disabledAt:new Date().toISOString(),source:'telegram'},cfg,525600);
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Итоги после матчей отключены'}).catch(()=>null);
      await telegramApi('sendMessage',cfg,{chat_id:callbackChatId,text:'🔕 Автоматические итоги после проанализированных матчей отключены.',reply_markup:{inline_keyboard:[[{text:'🔔 Включить обратно',callback_data:'postmatch:return:on'}]]}}).catch(()=>null);
      return json({ok:true});
    }
    if (callbackChatId && data === 'postmatch:return:on') {
      memory.cache.delete(postMatchReturnDisabledKey(callbackUserId));
      if (hasSupabase(cfg)) await supaDelete(cfg,'analysis_cache',{cache_key:`eq.${postMatchReturnDisabledKey(callbackUserId)}`}).catch(()=>null);
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Итоги после матчей включены'}).catch(()=>null);
      await telegramApi('sendMessage',cfg,{chat_id:callbackChatId,text:'🔔 Автоматические итоги после проанализированных матчей снова включены.'}).catch(()=>null);
      return json({ok:true});
    }
    const returnReview=data.match(/^match:return_review:(\d+)$/);
    if (callbackChatId && returnReview) {
      const fixtureId=Number(returnReview[1]);
      void recordGrowthEvent(cfg,{userId:callbackUserId,eventName:'post_match_return_open',channel:'telegram',fixtureId});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Открываю итог AI…'}).catch(()=>null);
      await sendBotFixtureSection(request,cfg,callbackUserId,callbackChatId,fixtureId,'review');
      return json({ok:true});
    }
    const shareAction=data.match(/^match:share:(\d+)$/);
    if (callbackChatId && shareAction) {
      const fixtureId=Number(shareAction[1]);
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:cb.id,text:'Готовлю ссылку…'}).catch(()=>null);
      try { await sendBotFixtureShareCard(request,cfg,callbackUserId,callbackChatId,fixtureId); }
      catch { await telegramApi('sendMessage',cfg,{chat_id:callbackChatId,text:'Не удалось подготовить ссылку на этот матч.'}).catch(()=>null); }
      return json({ok:true});
    }
    const matchAction = data.match(/^match:(menu|verdict|referee|squads|market|refresh|review):(\d+)$/);
    if (callbackChatId && matchAction) {
      const section = matchAction[1];
      const fixtureId = Number(matchAction[2]);
      await telegramApi('answerCallbackQuery', cfg, {
        callback_query_id: cb.id,
        text: section === 'menu' ? 'Готовлю короткую AI-оценку…' : section === 'review' ? 'Сверяю прогноз с фактом…' : 'Собираю футбольные данные…',
      }).catch(()=>null);
      if (section === 'menu') await sendBotFixtureMenu(request, cfg, callbackUserId, callbackChatId, fixtureId);
      else await sendBotFixtureSection(request, cfg, callbackUserId, callbackChatId, fixtureId, section === 'refresh' ? 'verdict' : section);
      return json({ ok: true });
    }
    await telegramApi('answerCallbackQuery', cfg, { callback_query_id: cb.id }).catch(()=>null);
    return json({ ok: true });
  }

  const msg = update.message;
  if (msg?.successful_payment) {
    await applySuccessfulPayment(msg.from?.id, msg.successful_payment, cfg, Number(msg.date || Math.floor(Date.now() / 1000)));
    return json({ ok: true });
  }

  if (msg?.refunded_payment) {
    const userId = Number(msg.from?.id || 0);
    const chargeId = String(msg.refunded_payment.telegram_payment_charge_id || '');
    if (userId && chargeId) await applyRefundedPayment(userId, chargeId, cfg);
    return json({ ok: true });
  }

  if (update.subscription) {
    const sub = update.subscription;
    const parsed = await parseInvoicePayload(sub.invoice_payload, cfg.botToken);
    if (parsed && Number(parsed.userId) === Number(sub.user?.id)) {
      if (sub.state === 'canceled') {
        await updateUserSubscription(parsed.userId, { subscription_canceled: true }, cfg);
      } else if (sub.state === 'active') {
        await updateUserSubscription(parsed.userId, { subscription_canceled: false }, cfg);
      }
    }
    return json({ ok: true });
  }

  const text = String(msg?.text || '').trim();
  const chatId = msg?.chat?.id;
  if (chatId && /^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
    const userId=Number(msg.from?.id || chatId);
    const startParam=telegramStartPayload(text);
    await upsertUser(msg.from || {id:userId},cfg).catch(()=>null);
    const launchIntent=parseLaunchStartParam(startParam);
    const attribution=await ensureLaunchAttribution(userId,startParam,cfg);
    const referral=await applyReferralAttribution(userId,launchIntent,cfg).catch(()=>({accepted:false,status:'unavailable'}));
    const eventAttribution=startParam ? launchIntent : attribution;
    void recordGrowthEvent(cfg,{userId,eventName:'bot_start',channel:'telegram',attribution:eventAttribution,fixtureId:Number(launchIntent.fixtureId || 0) || null,metadata:{attributed:Boolean(startParam),fixtureDeepLink:Boolean(launchIntent.fixtureId),referralStatus:referral.status}});
    await configureFootballBot(request, cfg, chatId);
    if (Number(launchIntent.fixtureId || 0)>0) {
      void recordGrowthEvent(cfg,{
        userId,
        eventName:'share_open',
        channel:'telegram',
        fixtureId:Number(launchIntent.fixtureId),
        attribution:launchIntent,
        metadata:{referral:Boolean(launchIntent.referralCode),referralStatus:referral.status},
        eventKey:`share_open:${userId}:${startParam}`,
      });
      void recordGrowthEvent(cfg,{userId,eventName:'fixture_deep_link_open',channel:'telegram',fixtureId:Number(launchIntent.fixtureId),attribution:launchIntent,metadata:{startParam}});
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'⚡ Ссылка ведёт прямо на матч. Загружаю AI-разбор без повторного поиска…'}).catch(()=>null);
      await sendBotFixtureMenu(request,cfg,userId,chatId,Number(launchIntent.fixtureId),{attribution:launchIntent,source:'deep_link'});
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
      reply_markup: { inline_keyboard: [[{ text:'Открыть Профиль', web_app:{ url:telegramWebAppUrl(request,{view:'profile'}) } }]] },
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
    await sendBotFavoriteTeams(request,cfg,Number(msg.from?.id || chatId),chatId);
    return json({ ok: true });
  }

  if (chatId && text === '📰 Новости') {
    await sendGeneralFootballNews(request,cfg,Number(msg.from?.id || chatId),chatId,{force:false});
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
    await sendBotFootballSearch(request, cfg, Number(msg.from?.id || chatId), chatId, text);
    return json({ ok: true });
  }

  if (chatId && (/^\/last(?:@\w+)?(?:\s|$)/i.test(text) || text === '🕘 Последний разбор')) {
    await sendLastAiVerdict(request, cfg, Number(msg.from?.id || chatId), chatId);
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
    await setBotDigestSubscription(msg.from?.id || chatId, chatId, true, cfg, telegramWebAppUrl(request));
    await telegramApi('sendMessage', cfg, { chat_id: chatId, text: '✅ Утренняя подборка включена: матчи дня + главное в футболе.', reply_markup: footballBotKeyboard(request) });
    return json({ ok: true });
  }

  if (chatId && /^\/digest_off(?:@\w+)?(?:\s|$)/i.test(text)) {
    await setBotDigestSubscription(msg.from?.id || chatId, chatId, false, cfg, telegramWebAppUrl(request));
    await telegramApi('sendMessage', cfg, { chat_id: chatId, text: '🔕 Утренняя AI-подборка отключена.', reply_markup: footballBotKeyboard(request) });
    return json({ ok: true });
  }

  if (chatId && /^(?:меню|главное меню|старт)$/i.test(text)) {
    await configureFootballBot(request, cfg, chatId);
    await sendFootballBotHome(request, cfg, chatId, msg.from || {});
    return json({ ok: true });
  }

  if (chatId && text && !text.startsWith('/')) {
    await sendBotFootballSearch(request, cfg, Number(msg.from?.id || chatId), chatId, text);
  }

  return json({ ok: true });
}

}
