export function createBillingRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Billing runtime dependencies are required.');
  }
  const {
    BILLING_PLANS,
    STAR_SYNC_MAX_PAGES,
    STAR_SYNC_PAGE_SIZE,
    SUBSCRIPTION_PERIOD_SECONDS,
    activatePassPurchase,
    bytesToHex,
    constantTimeEqual,
    enc,
    fetchWithTimeout,
    getQuota,
    getUserRecord,
    hasSupabase,
    hmacSha256,
    listUserEntitlements,
    markTelegramWebhookEffect,
    markTelegramWebhookMutation,
    memory,
    parsePassInvoicePayload,
    passProductConfig,
    recordOpsEvent,
    recordReferredPayment,
    refundPassByCharge,
    supaPatch,
    supaSelectOne,
    supaUpsert
  } = deps;

  if (!BILLING_PLANS || typeof BILLING_PLANS !== 'object' || Array.isArray(BILLING_PLANS)) {
    throw new TypeError('Billing runtime requires BILLING_PLANS.');
  }
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('Billing runtime requires memory.');
  }
  for (const [name,fn] of Object.entries({
    activatePassPurchase,
    bytesToHex,
    constantTimeEqual,
    fetchWithTimeout,
    getQuota,
    getUserRecord,
    hasSupabase,
    hmacSha256,
    listUserEntitlements,
    markTelegramWebhookEffect,
    markTelegramWebhookMutation,
    parsePassInvoicePayload,
    passProductConfig,
    recordOpsEvent,
    recordReferredPayment,
    refundPassByCharge,
    supaPatch,
    supaSelectOne,
    supaUpsert,
  })) {
    if (typeof fn !== 'function') throw new TypeError(`Billing runtime requires ${name}.`);
  }
  if (!enc || typeof enc.encode !== 'function') throw new TypeError('Billing runtime requires a text encoder.');

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || value.length > 24) return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveInt(value) {
    const number=integerCandidate(value);
    return number !== null && number > 0 ? number : null;
  }

  function nonNegativeInt(value) {
    const number=integerCandidate(value);
    return number !== null && number >= 0 ? number : null;
  }

  function boundedRetryAfter(value) {
    const seconds=nonNegativeInt(value);
    return seconds === null ? 0 : Math.min(seconds,7*24*60*60);
  }

  function safeText(value,max=512) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0,max);
  }

  function unixSeconds(value,fallback=null) {
    const seconds=nonNegativeInt(value);
    return seconds !== null && seconds <= 8_640_000_000_000 ? seconds : fallback;
  }

  function billingPlanConfig(plan, cfg) {
    const key=safeText(plan,24).toUpperCase();
    if (!key || !Object.hasOwn(BILLING_PLANS,key)) return null;
    const base=BILLING_PLANS[key];
    const stars=positiveInt(cfg?.starsPrices?.[key]) ?? positiveInt(base?.stars);
    const dailyLimit=positiveInt(cfg?.limits?.[key]) ?? positiveInt(base?.dailyLimit);
    if (stars === null || dailyLimit === null) return null;
    return {key,...base,stars,dailyLimit};
  }
  
  async function invoiceSignature(base, botToken) {
    return bytesToHex(await hmacSha256(enc.encode(botToken), base)).slice(0, 24);
  }
  
  async function makeInvoicePayload(userId, plan, botToken) {
    const uid=positiveInt(userId);
    const planCfg=billingPlanConfig(plan,{});
    const token=typeof botToken === 'string' ? botToken : '';
    if (uid === null || !planCfg || !token) throw new TypeError('Invalid subscription invoice parameters.');
    const nonceBytes=crypto.getRandomValues(new Uint8Array(6));
    const nonce=bytesToHex(nonceBytes);
    const base=`fa1|${uid}|${planCfg.key}|${nonce}`;
    return `${base}|${await invoiceSignature(base,token)}`;
  }
  
  async function parseInvoicePayload(payload, botToken) {
    if (typeof payload !== 'string' || payload.length > 512 || typeof botToken !== 'string' || !botToken) return null;
    const parts=payload.split('|');
    if (parts.length !== 5 || parts[0] !== 'fa1') return null;
    const [,uidRaw,planRaw,nonce,sig]=parts;
    const uid=positiveInt(uidRaw);
    const plan=safeText(planRaw,24).toUpperCase();
    if (uid === null || !Object.hasOwn(BILLING_PLANS,plan) || !/^[0-9a-f]{12}$/i.test(nonce) || !/^[0-9a-f]{24}$/i.test(sig)) return null;
    const base = `fa1|${uid}|${plan}|${nonce}`;
    const expected = await invoiceSignature(base, botToken);
    if (!constantTimeEqual(expected.toLowerCase(), sig.toLowerCase())) return null;
    return { userId: uid, plan, nonce };
  }
  
  async function telegramApi(method, cfg, body = {}) {
    const safeMethod=safeText(method,80);
    if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(safeMethod)) {
      const error=new Error('Некорректный метод Telegram API.');
      error.code='TELEGRAM_METHOD';
      throw error;
    }
    if (typeof cfg?.botToken !== 'string' || !cfg.botToken) {
      const error = new Error('TELEGRAM_BOT_TOKEN не настроен.');
      error.code = 'TELEGRAM_CONFIG';
      throw error;
    }
  
    let r;
    try {
      r = await fetchWithTimeout(`https://api.telegram.org/bot${cfg.botToken}/${safeMethod}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }, 8000, `Telegram ${safeMethod}`);
    } catch (cause) {
      const timedOut = String(cause?.code || '') === 'UPSTREAM_TIMEOUT';
      const error = new Error(cause?.message || (timedOut ? `Telegram ${safeMethod} timeout` : `Telegram ${safeMethod} network error`));
      error.code = timedOut ? 'TELEGRAM_TIMEOUT' : 'TELEGRAM_NETWORK';
      error.retryAfter=boundedRetryAfter(cause?.retryAfter);
      throw error;
    }
  
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok) {
      const status=nonNegativeInt(r?.status) ?? 0;
      const error = new Error(data?.description || `Telegram ${safeMethod}: HTTP ${status}`);
      error.status = status;
      error.retryAfter=boundedRetryAfter(data?.parameters?.retry_after ?? r.headers.get('retry-after'));
      error.code = status === 429
        ? 'TELEGRAM_RATE_LIMIT'
        : status >= 500
          ? 'TELEGRAM_UPSTREAM'
          : 'TELEGRAM_REJECTED';
      throw error;
    }
  
    if (!/^get[A-Z]/.test(safeMethod)) markTelegramWebhookEffect(cfg,safeMethod);
    return data.result;
  }
  
  async function updateUserSubscription(userId, fields, cfg) {
    const uid=positiveInt(userId);
    if (uid === null || !fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new TypeError('Invalid subscription update.');
    }
    markTelegramWebhookMutation(cfg,'user_subscription');
    const patch={...fields,plan_updated_at:new Date().toISOString()};
    if (hasSupabase(cfg)) {
      await supaPatch(cfg,'users',{telegram_id:`eq.${uid}`},patch);
    } else {
      if (!(memory.users instanceof Map)) throw new TypeError('Billing user memory is unavailable.');
      const old=memory.users.get(uid) || {telegram_id:uid,plan:'FREE'};
      memory.users.set(uid,{...old,...patch});
    }
  }
  
  async function saveBillingPayment(row, cfg) {
    if (!row?.telegram_payment_charge_id) return;
    markTelegramWebhookMutation(cfg, 'billing_payment');
    if (hasSupabase(cfg)) {
      await supaUpsert(cfg, 'billing_payments', row, 'telegram_payment_charge_id');
    } else {
      memory.billingPayments.set(String(row.telegram_payment_charge_id), row);
    }
  }
  
  async function findRefundableBillingCharge(userId, paymentChargeId, cfg) {
    const uid=positiveInt(userId);
    const chargeId=safeText(paymentChargeId,240);
    if (uid === null || !chargeId) return null;
  
    let payment = null;
    if (hasSupabase(cfg)) {
      payment = await supaSelectOne(cfg, 'billing_payments', {
        telegram_payment_charge_id: `eq.${chargeId}`,
        telegram_id: `eq.${uid}`,
      });
    } else {
      const row = memory.billingPayments.get(chargeId) || null;
      if (row && positiveInt(row?.telegram_id) === uid) payment=row;
    }
    if (payment) return {
      kind: 'subscription',
      status: String(payment.status || 'paid').toLowerCase(),
      plan: String(payment.plan || ''),
    };
  
    const entitlements = await listUserEntitlements(uid, cfg);
    const entitlement = entitlements.find(row =>
      String(row.payment_charge_id || row.paymentChargeId || '') === chargeId
      && positiveInt(row.telegram_id ?? row.telegramId) === uid
    );
    if (!entitlement) return null;
    return {
      kind: 'pass',
      status: String(entitlement.status || 'active').toLowerCase(),
      plan: String(entitlement.entitlement_type || entitlement.type || ''),
    };
  }
  
  async function applyRefundedPayment(userId, paymentChargeId, cfg) {
    const uid=positiveInt(userId);
    const chargeId=safeText(paymentChargeId,240);
    if (uid === null || !chargeId) return {updated:false,reason:'invalid_refund'};
  
    try {
      markTelegramWebhookMutation(cfg, 'billing_refund');
      if (hasSupabase(cfg)) {
        await supaPatch(cfg, 'billing_payments', {
          telegram_payment_charge_id: `eq.${chargeId}`,
          telegram_id: `eq.${uid}`,
        }, {
          status: 'refunded',
          updated_at: new Date().toISOString(),
        });
      } else {
        const row = memory.billingPayments.get(chargeId);
        if (row && positiveInt(row?.telegram_id) === uid) {
          memory.billingPayments.set(chargeId, { ...row, status:'refunded', updated_at:new Date().toISOString() });
        }
      }
  
      // Pass revocation is part of the refund invariant. Do not turn a temporary
      // entitlement-store failure into a successful refund acknowledgement.
      const passRefund = await refundPassByCharge(userId, chargeId, cfg);
      const record = await getUserRecord(uid, cfg);
      let subscriptionRevoked = false;
      if (record && String(record.telegram_payment_charge_id || '') === chargeId) {
        await updateUserSubscription(uid, {
          plan: 'FREE',
          subscription_until: new Date().toISOString(),
          subscription_canceled: true,
          telegram_payment_charge_id: null,
        }, cfg);
        subscriptionRevoked = true;
      }
      return { updated:true, subscriptionRevoked, passRevoked:Boolean(passRefund?.updated) };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause || 'Refund reconciliation failed.'));
      error.code = 'BILLING_REFUND_RECONCILIATION';
      // Every mutation above is an idempotent move toward the same refunded
      // state, so Telegram may safely redeliver a refunded_payment update.
      error.telegramWebhookRetrySafe = true;
      throw error;
    }
  }
  
  async function applySuccessfulPayment(userId, payment, cfg, fallbackDate = Math.floor(Date.now() / 1000)) {
    const uid=positiveInt(userId);
    if (uid === null || !payment || typeof payment !== 'object' || Array.isArray(payment) || payment.currency !== 'XTR') return false;
    const chargeId=safeText(payment.telegram_payment_charge_id,240);
    const amount=positiveInt(payment.total_amount);
    const paidAt=unixSeconds(fallbackDate,Math.floor(Date.now()/1000));
    if (!chargeId || amount === null || paidAt === null) return false;
  
    // A refunded-charge lookup is a billing safety boundary. Storage failures must
    // fail closed rather than treating an unknown charge as safe to activate.
    const existingCharge = await findRefundableBillingCharge(userId, chargeId, cfg);
    if (String(existingCharge?.status || '').toLowerCase() === 'refunded') {
      await recordOpsEvent(cfg, {
        severity:'warning',
        source:'billing',
        eventType:'refund_replay_blocked',
        code:'BILLING_REFUNDED_CHARGE_REPLAY_BLOCKED',
        message:'Refused to re-apply a refunded Telegram Stars charge.',
        endpoint:'telegram_stars_sync',
        status:200,
        meta:{
          kind:existingCharge?.kind || '',
          product:existingCharge?.plan || '',
          chargeSuffix:chargeId.slice(-8),
        },
      }).catch(() => null);
      return false;
    }
  
    const subscription = await parseInvoicePayload(payment.invoice_payload, cfg.botToken);
    if (subscription) {
      if (positiveInt(subscription.userId)!==uid) return false;
      const planCfg = billingPlanConfig(subscription.plan, cfg);
      if (!planCfg || amount!==positiveInt(planCfg.stars)) return false;
  
      const expiresUnix=unixSeconds(payment.subscription_expiration_date,null)
        ?? (paidAt+SUBSCRIPTION_PERIOD_SECONDS);
      const expiresAt = new Date(expiresUnix * 1000).toISOString();
  
      await saveBillingPayment({
        telegram_payment_charge_id: chargeId,
        telegram_id:uid,
        plan: subscription.plan,
        stars_amount:amount,
        currency: 'XTR',
        invoice_payload: String(payment.invoice_payload || ''),
        provider_payment_charge_id: payment.provider_payment_charge_id || null,
        subscription_expiration_date: expiresAt,
        is_recurring:payment.is_recurring === true,
        is_first_recurring:payment.is_first_recurring === true,
        status: 'paid',
        created_at:new Date(paidAt*1000).toISOString(),
      }, cfg);
  
      await updateUserSubscription(userId, {
        plan: subscription.plan,
        subscription_until: expiresAt,
        subscription_canceled: false,
        telegram_payment_charge_id: chargeId,
      }, cfg);
      await recordReferredPayment(userId,payment,subscription.plan,cfg).catch(()=>false);
      return true;
    }
  
    const pass = await parsePassInvoicePayload(payment.invoice_payload, cfg.botToken);
    if (!pass || positiveInt(pass.userId)!==uid) return false;
    const product = passProductConfig(pass.passType, cfg);
    if (!product || amount!==positiveInt(product.stars)) return false;
  
    const activated = await activatePassPurchase({
      telegramId:uid,
      passType: pass.passType,
      fixtureId: pass.fixtureId,
      starsAmount:amount,
      paymentChargeId: chargeId,
      invoicePayload: String(payment.invoice_payload || ''),
      paidAt:new Date(paidAt*1000).toISOString(),
    }, cfg);
    return activated?.activated === true || activated?.duplicate === true;
  }
  
  async function billingWebhookStatus(request, cfg) {
    if (!cfg.botToken || !cfg.webhookSecret) {
      return { ready: false, reason: 'webhook_not_configured', expectedUrl: `${new URL(request.url).origin}/telegram/webhook` };
    }
    const expectedUrl = `${new URL(request.url).origin}/telegram/webhook`;
    try {
      const info = await telegramApi('getWebhookInfo', cfg);
      const ready = String(info?.url || '') === expectedUrl;
      return {
        ready,
        expectedUrl,
        currentUrl: info?.url || '',
        pendingUpdates:nonNegativeInt(info?.pending_update_count) ?? 0,
        lastError: info?.last_error_message || '',
        reason: ready ? '' : 'webhook_url_mismatch',
      };
    } catch (e) {
      return { ready: false, reason: 'webhook_check_failed', expectedUrl, error: String(e?.message || e) };
    }
  }

  async function loadStarTransactionsForSync(cfg) {
    const transactions=[];
    let pagesScanned=0;
    let truncated=false;
  
    for (let page=0; page<STAR_SYNC_MAX_PAGES; page+=1) {
      const offset=page*STAR_SYNC_PAGE_SIZE;
      const tx=await telegramApi('getStarTransactions',cfg,{offset,limit:STAR_SYNC_PAGE_SIZE});
      const batch=Array.isArray(tx?.transactions) ? tx.transactions : [];
      transactions.push(...batch);
      pagesScanned+=1;
      if (batch.length < STAR_SYNC_PAGE_SIZE) {
        truncated=false;
        break;
      }
      truncated=page === STAR_SYNC_MAX_PAGES - 1;
    }
  
    return { transactions, pagesScanned, truncated };
  }
  
  async function syncBillingFromStars(userId, cfg) {
    const uid=positiveInt(userId);
    if (uid === null) return {synced:false,subscriptionSynced:false,passVerified:0,refundsReconciled:0,transactionPagesScanned:0,transactionHistoryTruncated:false,quota:null};
    const history=await loadStarTransactionsForSync(cfg);
    const list=history.transactions;
    const refundedChargeIds=new Set();
    let best = null;
    let passVerified = 0;
    let refundsReconciled = 0;
  
    // Telegram exposes purchase refunds as outgoing Star transactions whose id
    // matches the original incoming payment charge. Reconcile those first so an
    // older purchase page can never reactivate already-refunded access.
    for (const item of list) {
      const receiver=item?.receiver;
      if (!receiver || receiver.type !== 'user' || receiver.transaction_type !== 'invoice_payment') continue;
      if (positiveInt(receiver.user?.id)!==uid) continue;
      const chargeId=String(item?.id || '').trim();
      if (!chargeId || refundedChargeIds.has(chargeId)) continue;
      refundedChargeIds.add(chargeId);
      const reconciled=await applyRefundedPayment(userId,chargeId,cfg);
      if (reconciled?.updated) refundsReconciled+=1;
    }
  
    const seenIncomingCharges=new Set();
    for (const item of list) {
      const source = item?.source;
      if (!source || source.type !== 'user' || source.transaction_type !== 'invoice_payment') continue;
      if (positiveInt(source.user?.id)!==uid) continue;
      const chargeId=String(item?.id || '').trim();
      if (!chargeId || refundedChargeIds.has(chargeId) || seenIncomingCharges.has(chargeId)) continue;
      seenIncomingCharges.add(chargeId);
  
      const pass = await parsePassInvoicePayload(source.invoice_payload, cfg.botToken);
      if (pass && positiveInt(pass.userId)===uid) {
        const product = passProductConfig(pass.passType, cfg);
        if (product && positiveInt(item.amount)===positiveInt(product.stars)) {
          const applied = await applySuccessfulPayment(userId, {
            currency: 'XTR',
            total_amount:positiveInt(item.amount),
            invoice_payload: source.invoice_payload,
            telegram_payment_charge_id: chargeId,
            provider_payment_charge_id: '',
            is_recurring: false,
            is_first_recurring: false,
          },cfg,unixSeconds(item.date,Math.floor(Date.now()/1000)));
          if (applied) passVerified += 1;
        }
        continue;
      }
  
      const parsed = await parseInvoicePayload(source.invoice_payload, cfg.botToken);
      if (!parsed || positiveInt(parsed.userId)!==uid) continue;
      const planCfg = billingPlanConfig(parsed.plan, cfg);
      if (!planCfg || positiveInt(item.amount)!==positiveInt(planCfg.stars)) continue;
      const period=positiveInt(source.subscription_period) ?? SUBSCRIPTION_PERIOD_SECONDS;
      const itemDate=unixSeconds(item.date,null);
      if (itemDate===null) continue;
      const expiresUnix=itemDate+period;
      if (!best || expiresUnix > best.expiresUnix) best = { item, source, parsed, expiresUnix, chargeId };
    }
  
    let subscriptionSynced = false;
    if (best && best.expiresUnix * 1000 > Date.now()) {
      subscriptionSynced = await applySuccessfulPayment(userId, {
        currency: 'XTR',
        total_amount:positiveInt(best.item.amount),
        invoice_payload: best.source.invoice_payload,
        telegram_payment_charge_id: best.chargeId,
        provider_payment_charge_id: '',
        subscription_expiration_date: best.expiresUnix,
        is_recurring: true,
        is_first_recurring: false,
      },cfg,unixSeconds(best.item.date,Math.floor(Date.now()/1000)));
    }
  
    return {
      synced: Boolean(subscriptionSynced || passVerified || refundsReconciled),
      subscriptionSynced: Boolean(subscriptionSynced),
      passVerified,
      refundsReconciled,
      transactionPagesScanned: history.pagesScanned,
      transactionHistoryTruncated: history.truncated,
      quota: await getQuota(userId, cfg),
    };
  }

  return Object.freeze({
    billingPlanConfig,
    invoiceSignature,
    makeInvoicePayload,
    parseInvoicePayload,
    telegramApi,
    updateUserSubscription,
    saveBillingPayment,
    findRefundableBillingCharge,
    applyRefundedPayment,
    applySuccessfulPayment,
    billingWebhookStatus,
    loadStarTransactionsForSync,
    syncBillingFromStars
  });
}
