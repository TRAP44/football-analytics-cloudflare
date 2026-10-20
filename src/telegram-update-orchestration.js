// Telegram update command/callback orchestration boundary for Issue #440.
// All network, persistence, billing and product capabilities are injected by worker.js.
import { BOT_NOTIFICATIONS_TEXT, botPlansText } from './telegram-bot-plans.js';

const REMOVED_MENU_LABELS = new Set([
  '📰 Новости', '💎 Тарифы',
  '••• Ещё', '← Главное меню', '🕘 Последний разбор', '📈 Протокол AI',
  '🤖 AI-подборка', '🧠 AI-подборка', '🔎 Найти матч',
]);
const REMOVED_MATCH_SECTIONS = new Set(['referee', 'market', 'refresh']);

export function createTelegramUpdateProcessor(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Telegram update orchestration dependencies are required.');
  }

  const {
    loadRuntimeControls,
    telegramLockdownDecision,
    telegramApi: telegramApiDependency,
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
    answerBotInlineQuery,
    sendFavoritePicker,
    pickStartFavorite,
    sendFavoriteTeamNews,
    toggleBotFavorite,
    removeBotFavorite,
    getBotDigestSubscription,
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
    telegramApi:telegramApiDependency,
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

  const telegramApi=(...args)=>Promise.resolve().then(()=>telegramApiDependency(...args));

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
      const requestUrl=new URL(textValue(request?.url,2048));
      const raw=textValue(telegramWebAppUrl(request,params),4096);
      if (!raw) return '';
      const url=new URL(raw);
      if (
        requestUrl.protocol !== 'https:'
        || requestUrl.username
        || requestUrl.password
        || url.protocol !== 'https:'
        || url.username
        || url.password
        || url.origin !== requestUrl.origin
      ) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  // Настройки уведомлений о матчах; кнопка приложения — только
  // в личном чате (web_app в группах Telegram не принимает).
  function notificationsView(request, chatType) {

    const url=chatType === 'private' ? safeWebAppUrl(request,{view:'profile',section:'notifications'}) : '';
    return {
      parse_mode:'HTML',
      text:BOT_NOTIFICATIONS_TEXT,
      reply_markup:{inline_keyboard:[
        ...(url ? [[{text:'⚙️ Настроить уведомления',web_app:{url}}]] : []),
      ]},
    };
  }

  function safeBotKeyboard(request, chatId = 0) {
    try {
      const keyboard=footballBotKeyboard(request,chatId);
      return plainObject(keyboard) || undefined;
    } catch {
      return undefined;
    }
  }

  function safeMoreKeyboard(request) {
    try {
      const keyboard=footballBotMoreKeyboard(request);
      return plainObject(keyboard) || undefined;
    } catch {
      return undefined;
    }
  }

  function safeCall(fn, fallback, ...args) {
    if (typeof fn !== 'function') return fallback;
    try {
      const value=fn(...args);
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
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
    const blockedCheckout=plainObject(update.pre_checkout_query);
    const blockedCheckoutId=textValue(blockedCheckout?.id,120);
    const blockedCallback=plainObject(update.callback_query);
    const blockedCallbackId=textValue(blockedCallback?.id,120);
    if (blockedCheckoutId && lockdown.rejectCheckout) {
      await telegramApi('answerPreCheckoutQuery', cfg, {
        pre_checkout_query_id:blockedCheckoutId,
        ok:false,
        error_message:'Оплата временно приостановлена аварийным режимом безопасности. Попробуйте позже.',
      }).catch(() => null);
    } else if (blockedCallbackId) {
      await telegramApi('answerCallbackQuery', cfg, {
        callback_query_id:blockedCallbackId,
        text:'Security Lockdown: действие временно недоступно.',
        show_alert:true,
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
            && samePositiveInteger(planCfg.stars,checkoutAmount)
            && (parsed.stars === undefined || samePositiveInteger(parsed.stars,checkoutAmount)))
          || (pass
            && samePositiveInteger(pass.userId,checkoutUserId)
            && passCfg?.saleReady === true
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

  // Inline-режим: `@MatchRadarBot Реал` в любом чате (Сергей 15.10).
  if (update.inline_query) {
    const inline=plainObject(update.inline_query);
    if (!inline || !textValue(inline.id,120)) return json({ok:false,error:'inline_query_invalid'},400);
    if (typeof answerBotInlineQuery === 'function') await answerBotInlineQuery(request,cfg,inline);
    return json({ok:true});
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
    if (callbackChatId && /^(?:news:|ni:r:|digest:)/.test(data)) {
      await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Этот раздел больше недоступен.'});
      return json({ok:true});
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

    const favoriteToggle=data.match(/^favorite:toggle:(\d+):(\d+)$/);
    if (callbackChatId && favoriteToggle) {
      const teamId=positiveInteger(favoriteToggle[1]), fixtureId=positiveInteger(favoriteToggle[2]);
      if (!teamId || !fixtureId) return json({ok:false,error:'favorite_toggle_invalid'},400);
      try {
        const result=plainObject(await toggleBotFavorite(callbackUserId,teamId,cfg));
        if (!result || typeof result.active !== 'boolean') throw new Error('Некорректный ответ избранного.');
        if (result.active) backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'favorite_add',channel:'telegram',fixtureId,metadata:{teamId}});
        const teamName=textValue(plainObject(result.team)?.name,80) || 'Команда';
        await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{callback_query_id:callbackId,text:result.active?`★ ${teamName} добавлен в «Мои команды»`:`☆ ${teamName} удалён из «Моих команд»`});
        if (fixtureId && cb.message?.message_id) {
          const [match,favorites]=await Promise.all([
            swallowAsync(loadBotFixtureCard,fixtureId,cfg),
            swallowAsync(getFavorites,callbackUserId,cfg),
          ]);
          const messageId=positiveInteger(cb.message.message_id);
          const replyMarkup=safeCall(
            footballMatchActionKeyboard,
            null,
            request,
            match,
            '',
            Array.isArray(favorites) ? favorites : [],
          );
          if (match && messageId && plainObject(replyMarkup)) {
            await telegramApi('editMessageReplyMarkup',cfg,{
              chat_id:callbackChatId,
              message_id:messageId,
              reply_markup:replyMarkup,
            }).catch(()=>null);
          }
        }
      } catch (error) {
        await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{
          callback_query_id:callbackId,
          text:Number(error?.status)===409 ? 'Данные клуба устарели. Откройте карточку матча заново.' : 'Не удалось изменить избранное. Попробуйте ещё раз.',
          show_alert:true,
        });
      }
      return json({ok:true});
    }
    const startPick=data.match(/^fav:pick:(\d+)$/);
    if (callbackChatId && startPick && typeof pickStartFavorite === 'function') {
      try {
        const result=await pickStartFavorite(cfg,callbackUserId,callbackChatId,cb.message?.message_id,positiveInteger(startPick[1]));
        await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:`★ ${textValue(result?.team?.label,40) || 'Команда'} — в «Моих командах»`}).catch(()=>null);
      } catch (error) {
        await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Не удалось добавить команду. Попробуйте ещё раз.',show_alert:true});
      }
      return json({ok:true});
    }
    if (callbackChatId && data === 'fav:done') {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Готово'}).catch(()=>null);
      await sendBotFavoriteTeams(request,cfg,callbackUserId,callbackChatId);
      return json({ok:true});
    }
    // «Мои команды» (Issue #922): страницы, «➕ Добавить», «Убрать» — от callback.from.id.
    const favoritePage=data.match(/^favorite:page:(\d{1,3})$/);
    if (callbackChatId && favoritePage) {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId}).catch(()=>null);
      await sendBotFavoriteTeams(request,cfg,callbackUserId,callbackChatId,{page:Number(favoritePage[1]),messageId:positiveInteger(cb.message?.message_id)});
      return json({ok:true});
    }
    if (callbackChatId && data === 'fav:add' && typeof sendFavoritePicker === 'function') {
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId}).catch(()=>null);
      await sendFavoritePicker(request,cfg,callbackUserId,callbackChatId);
      return json({ok:true});
    }
    const favoriteRemove=data.match(/^favorite:remove:(\d+)$/);
    if (callbackChatId && favoriteRemove && typeof removeBotFavorite === 'function') {
      const teamId=positiveInteger(favoriteRemove[1]);
      if (!teamId) return json({ok:false,error:'team_id_invalid'},400);
      let result=null;
      try { result=plainObject(await removeBotFavorite(callbackUserId,teamId,cfg)); } catch {}
      if (!result) {
        await swallowAsync(telegramApi,'answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Не удалось убрать команду. Попробуйте ещё раз.',show_alert:true});
        return json({ok:true});
      }
      const teamName=textValue(plainObject(result.team)?.name,40) || 'Команда';
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:result.removed ? `☆ ${teamName} убран из «Моих команд»` : 'Этой команды уже нет в «Моих командах»'}).catch(()=>null);
      await sendBotFavoriteTeams(request,cfg,callbackUserId,callbackChatId,{page:0,messageId:positiveInteger(cb.message?.message_id)});
      return json({ok:true});
    }
    const favoriteAction=data.match(/^favorite:team:(\d+)$/);
    if (callbackChatId && favoriteAction) {
      const teamId=positiveInteger(favoriteAction[1]);
      if (!teamId) return json({ok:false,error:'team_id_invalid'},400);
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Ищу матчи клуба…'}).catch(()=>null);
      await sendBotFavoriteTeamMatches(request,cfg,callbackUserId,callbackChatId,teamId);
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
      if (!fixtureId) return json({ok:false,error:'fixture_id_invalid'},400);
      backgroundGrowthEvent(cfg,{userId:callbackUserId,eventName:'post_match_return_open',channel:'telegram',fixtureId});
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Открываю итог AI…'}).catch(()=>null);
      await sendBotFixtureSection(request,cfg,callbackUserId,callbackChatId,fixtureId,'review');
      return json({ok:true});
    }
    const shareAction=data.match(/^match:share:(\d+)$/);
    if (callbackChatId && shareAction) {
      const fixtureId=positiveInteger(shareAction[1]);
      if (!fixtureId) return json({ok:false,error:'fixture_id_invalid'},400);
      // Отвечаем на нажатие сразу, до работы с базой и Telegram: иначе при медленном ответе
      // нажатие истекает, человек жмёт ещё раз и получает две карточки (ревью Codex #914).
      // Без обещания «ссылка ваша» — реф-код может временно не создаться.
      await telegramApi('answerCallbackQuery',cfg,{callback_query_id:callbackId,text:'Готовлю карточку — перешлите её друзьям'}).catch(()=>null);
      try { await sendBotFixtureShareCard(request,cfg,callbackUserId,callbackChatId,fixtureId); }
      catch { await telegramApi('sendMessage',cfg,{chat_id:callbackChatId,text:'Не удалось подготовить карточку этого матча. Попробуйте ещё раз.'}).catch(()=>null); }
      return json({ok:true});
    }
    const matchAction = data.match(/^match:(menu|verdict|referee|squads|market|refresh|review):(\d+)$/);
    if (callbackChatId && matchAction) {
      const section = matchAction[1];
      const fixtureId = positiveInteger(matchAction[2]);
      if (!fixtureId) return json({ok:false,error:'fixture_id_invalid'},400);
      // Сергей 13.10: «Судья», «Риски матча» и «Обновить AI» убраны; старые кнопки в чатах
      // отвечают коротко и ничего не загружают.
      if (REMOVED_MATCH_SECTIONS.has(section)) {
        await telegramApi('answerCallbackQuery', cfg, {
          callback_query_id: callbackId,
          text: 'Этот раздел убран. Всё есть в полном AI-разборе.',
        }).catch(()=>null);
        return json({ ok: true });
      }
      await telegramApi('answerCallbackQuery', cfg, {
        callback_query_id: callbackId,
        text: section === 'menu' ? 'Готовлю короткую AI-оценку…' : section === 'review' ? 'Сверяю прогноз с фактом…' : 'Собираю футбольные данные…',
      }).catch(()=>null);
      if (section === 'menu') await sendBotFixtureMenu(request, cfg, callbackUserId, callbackChatId, fixtureId);
      else await sendBotFixtureSection(request, cfg, callbackUserId, callbackChatId, fixtureId, section === 'refresh' ? 'verdict' : section);
      return json({ ok: true });
    }
    await telegramApi('answerCallbackQuery', cfg, {
      callback_query_id: callbackId,
      text:'Эта кнопка устарела. Откройте меню командой /start.',
      show_alert:true,
    }).catch(()=>null);
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
    if (!parsed || !samePositiveInteger(parsed.userId,subscriptionUserId)) {
      return json({ok:false,error:'telegram_subscription_identity_mismatch'},400);
    }
    if (state === 'canceled') {
      await updateUserSubscription(parsed.userId,{subscription_canceled:true},cfg);
    } else {
      await updateUserSubscription(parsed.userId,{subscription_canceled:false},cfg);
    }
    return json({ok:true});
  }

  const text=textValue(msg?.text,4096);
  const chatId=telegramChatId(msg?.chat?.id);
  const messageUserId=telegramUserId(msg?.from?.id);
  if (chatId && /^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
    const userId=telegramUserId(msg.from?.id);
    if (!userId) return json({ok:false,error:'telegram_user_invalid'},400);
    const startParam=textValue(telegramStartPayload(text),64);
    await swallowAsync(upsertUser,plainObject(msg.from) || {id:userId},cfg);
    const launchIntent=plainObject(parseLaunchStartParam(startParam)) || {};
    const attribution=plainObject(await swallowAsync(ensureLaunchAttribution,userId,startParam,cfg)) || {};
    const referral=plainObject(await swallowAsync(applyReferralAttribution,userId,launchIntent,cfg))
      || {accepted:false,status:'unavailable'};
    const eventAttribution=startParam ? launchIntent : attribution;
    const launchFixtureId=positiveInteger(launchIntent.fixtureId);
    backgroundGrowthEvent(cfg,{userId,eventName:'bot_start',channel:'telegram',attribution:eventAttribution,fixtureId:launchFixtureId || null,metadata:{attributed:Boolean(startParam),fixtureDeepLink:launchFixtureId>0,referralStatus:referral.status}});
    const botSetup=swallowAsync(configureFootballBot,request,cfg,chatId);
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
      await Promise.all([sendBotFixtureMenu(request,cfg,userId,chatId,launchFixtureId,{attribution:launchIntent,source:'deep_link'}),botSetup]);
      return json({ok:true});
    }
    await sendFootballBotHome(request,cfg,chatId,msg.from || {});
    // Новичок без избранного сразу выбирает команды (Сергей 15.10) — только в личке.
    if (msg?.chat?.type === 'private' && typeof sendFavoritePicker === 'function') {
      const favorites=await swallowAsync(getFavorites,userId,cfg);
      if (Array.isArray(favorites) && !favorites.length) await swallowAsync(sendFavoritePicker,request,cfg,userId,chatId);
    }
    await botSetup;
    return json({ ok: true });
  }

  // Сергей 13.10: одно меню из шести кнопок. Кнопки старой клавиатуры («Ещё», «Главное меню»,
  // «Последний разбор», «Протокол AI», «AI-подборка», «Найти матч») и команды /last, /track,
  // /picks убраны: отвечаем коротко и присылаем новое меню.
  if (chatId && ((REMOVED_MENU_LABELS.has(text) || /^\/(?:news|digest|digest_off)(?:@\w+)?(?:\s|$)/i.test(text) || text === '📰 Новости' || text === '☀️ Утренняя подборка') || /^\/(?:last|track|picks)(?:@\w+)?(?:\s|$)/i.test(text))) {
    const replyMarkup=safeBotKeyboard(request,chatId);
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      text:text === '🔎 Найти матч'
        ? '🔎 Просто напишите клуб или матч в чат — например «Реал» или «Интер — Милан».'
        : 'Меню обновлено 👇 Напишите клуб в чат или выберите раздел.',
      ...(replyMarkup ? {reply_markup:replyMarkup} : {}),
    });
    return json({ok:true});
  }

  if (chatId && /^\/paysupport(?:@\w+)?(?:\s|$)/i.test(text)) {
    const profileUrl=safeWebAppUrl(request,{view:'profile'});
    await telegramApi('sendMessage', cfg, {
      chat_id: chatId,
      text: [
        '⭐ Поддержка по оплате MatchRadar',
        '',
        'Если Stars списаны, а тариф не обновился — откройте Профиль → MatchRadar Pro и нажмите «Проверить оплату».',
        'Возврат выполняется только после ручной проверки администратором MatchRadar.',
        'Не отправляйте данные карты или секретные коды: платежи проходят через Telegram Stars.',
      ].join('\n'),
      ...(profileUrl
        ? {reply_markup:{inline_keyboard:[[{text:'Открыть Профиль',web_app:{url:profileUrl}}]]}}
        : {}),
    });
    return json({ ok:true });
  }

  if (chatId && (/^\/help(?:@\w+)?(?:\s|$)/i.test(text) || text === 'ℹ️ Как это работает')) {
    await sendFootballBotHelp(request, cfg, chatId);
    return json({ ok: true });
  }

  // Сергей 15.10: текстовые списки «Матчи» и «LIVE» в чате убраны — матчи в приложении.
  // Старая клавиатура присылает текст: отвечаем кнопкой в приложение и новым меню.
  const legacyMatches=/^\/today(?:@\w+)?(?:\s|$)/i.test(text) || /^матчи$/i.test(text) || text === '⚽ Матчи сегодня' || text === '⚽ Матчи';
  const legacyLive=/^\/live(?:@\w+)?(?:\s|$)/i.test(text) || /^live$/i.test(text) || /^лайв$/i.test(text) || text === '🔴 LIVE';
  if (chatId && (legacyMatches || legacyLive)) {
    const url=msg?.chat?.type === 'private' ? safeWebAppUrl(request,legacyLive ? {filter:'live'} : {}) : '';
    if (url) {
      await telegramApi('sendMessage',cfg,{
        chat_id:chatId,
        text:legacyLive ? '🔴 Матчи, которые идут сейчас, — в MatchRadar.' : '⚽ Все матчи дня — в MatchRadar.',
        reply_markup:{inline_keyboard:[[{text:legacyLive ? '🔴 Открыть LIVE' : '⚽ Открыть матчи',web_app:{url}}]]},
      });
      const replyMarkup=safeBotKeyboard(request,chatId);
      if (replyMarkup) await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Меню обновлено 👇',reply_markup:replyMarkup}).catch(()=>null);
    } else {
      await sendBotDayMatches(request,cfg,chatId,{liveOnly:legacyLive});
    }
    return json({ ok: true });
  }

  if (chatId && (/^\/favorites(?:@\w+)?(?:\s|$)/i.test(text) || text === '⭐ Мои команды')) {
    if (!messageUserId) return json({ok:false,error:'telegram_user_invalid'},400);
    // Пусто — сразу выбор команд вместо подсказки «откройте миниапп».
    if (msg?.chat?.type === 'private' && typeof sendFavoritePicker === 'function') {
      const favorites=await swallowAsync(getFavorites,messageUserId,cfg);
      if (Array.isArray(favorites) && !favorites.length) {
        await sendFavoritePicker(request,cfg,messageUserId,chatId);
        return json({ok:true});
      }
    }
    await sendBotFavoriteTeams(request,cfg,messageUserId,chatId);
    return json({ ok: true });
  }


  if (chatId && (/^\/plans(?:@\w+)?(?:\s|$)/i.test(text) || text === '💎 Тарифы')) {
    // Кнопка web_app работает только в личном чате (ревью Codex #872).
    const url=msg?.chat?.type === 'private' ? safeWebAppUrl(request,{view:'profile',section:'billing'}) : '';
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text:botPlansText(cfg),
      ...(url ? {reply_markup:{inline_keyboard:[[{text:'💎 Открыть тарифы',web_app:{url}}]]}} : {}),
    });
    return json({ok:true});
  }

  if (chatId && (/^\/settings(?:@\w+)?(?:\s|$)/i.test(text) || text === '⚙️ Уведомления')) {
    await telegramApi('sendMessage',cfg,{chat_id:chatId,...notificationsView(request,msg?.chat?.type)});
    return json({ok:true});
  }

  if (chatId && /^\/(?:search|ask)(?:@\w+)?(?:\s|$)/i.test(text)) {
    if (!messageUserId) return json({ok:false,error:'telegram_user_invalid'},400);
    await sendBotFootballSearch(request, cfg, messageUserId, chatId, text);
    return json({ ok: true });
  }

  if (chatId && /^(?:меню|главное меню|старт)$/i.test(text)) {
    await Promise.all([configureFootballBot(request,cfg,chatId),sendFootballBotHome(request,cfg,chatId,msg.from || {})]);
    return json({ ok: true });
  }

  if (chatId && msg?.chat?.type === 'private' && text.startsWith('/')) {
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      text:'Такой команды нет. Напишите название клуба или откройте меню: /start. Подсказка: /help.',
    });
    return json({ok:true});
  }

  if (chatId && text && !text.startsWith('/')) {
    if (!messageUserId) return json({ok:false,error:'telegram_user_invalid'},400);
    await sendBotFootballSearch(request, cfg, messageUserId, chatId, text);
  }

  return json({ ok: true });
}

}
