export function createBillingRuntime(deps = {}) {
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

  function billingPlanConfig(plan, cfg) {
    const key = String(plan || '').toUpperCase();
    if (!BILLING_PLANS[key]) return null;
    return {
      key,
      ...BILLING_PLANS[key],
      stars: Number(cfg.starsPrices?.[key] || BILLING_PLANS[key].stars),
      dailyLimit: Number(cfg.limits?.[key] || BILLING_PLANS[key].dailyLimit),
    };
  }
  
  async function invoiceSignature(base, botToken) {
    return bytesToHex(await hmacSha256(enc.encode(botToken), base)).slice(0, 24);
  }
  
  async function makeInvoicePayload(userId, plan, botToken) {
    const nonceBytes = crypto.getRandomValues(new Uint8Array(6));
    const nonce = bytesToHex(nonceBytes);
    const base = `fa1|${Number(userId)}|${String(plan).toUpperCase()}|${nonce}`;
    return `${base}|${await invoiceSignature(base, botToken)}`;
  }
  
  async function parseInvoicePayload(payload, botToken) {
    const parts = String(payload || '').split('|');
    if (parts.length !== 5 || parts[0] !== 'fa1') return null;
    const [, uidRaw, planRaw, nonce, sig] = parts;
    const uid = Number(uidRaw);
    const plan = String(planRaw || '').toUpperCase();
    if (!Number.isSafeInteger(uid) || !BILLING_PLANS[plan] || !/^[0-9a-f]{12}$/i.test(nonce) || !/^[0-9a-f]{24}$/i.test(sig)) return null;
    const base = `fa1|${uid}|${plan}|${nonce}`;
    const expected = await invoiceSignature(base, botToken);
    if (!constantTimeEqual(expected.toLowerCase(), sig.toLowerCase())) return null;
    return { userId: uid, plan, nonce };
  }
  
  async function telegramApi(method, cfg, body = {}) {
    if (!cfg.botToken) {
      const error = new Error('TELEGRAM_BOT_TOKEN не настроен.');
      error.code = 'TELEGRAM_CONFIG';
      throw error;
    }
  
    let r;
    try {
      r = await fetchWithTimeout(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }, 8000, `Telegram ${method}`);
    } catch (cause) {
      const timedOut = String(cause?.code || '') === 'UPSTREAM_TIMEOUT';
      const error = new Error(cause?.message || (timedOut ? `Telegram ${method} timeout` : `Telegram ${method} network error`));
      error.code = timedOut ? 'TELEGRAM_TIMEOUT' : 'TELEGRAM_NETWORK';
      error.retryAfter = Math.max(0, Number(cause?.retryAfter || 0));
      throw error;
    }
  
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok) {
      const status = Number(r.status || 0);
      const error = new Error(data?.description || `Telegram ${method}: HTTP ${status}`);
      error.status = status;
      error.retryAfter = Math.max(0, Number(data?.parameters?.retry_after || r.headers.get('retry-after') || 0));
      error.code = status === 429
        ? 'TELEGRAM_RATE_LIMIT'
        : status >= 500
          ? 'TELEGRAM_UPSTREAM'
          : 'TELEGRAM_REJECTED';
      throw error;
    }
  
    if (!/^get[A-Z]/.test(String(method || ''))) markTelegramWebhookEffect(cfg, method);
    return data.result;
  }
  
  async function updateUserSubscription(userId, fields, cfg) {
    markTelegramWebhookMutation(cfg, 'user_subscription');
    const patch = { ...fields, plan_updated_at: new Date().toISOString() };
    if (hasSupabase(cfg)) {
      await supaPatch(cfg, 'users', { telegram_id: `eq.${Number(userId)}` }, patch);
    } else {
      const old = memory.users.get(Number(userId)) || { telegram_id: Number(userId), plan: 'FREE' };
      memory.users.set(Number(userId), { ...old, ...patch });
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
    const uid = Number(userId);
    const chargeId = String(paymentChargeId || '').trim();
    if (!Number.isSafeInteger(uid) || uid <= 0 || !chargeId || chargeId.length > 240) return null;
  
    let payment = null;
    if (hasSupabase(cfg)) {
      payment = await supaSelectOne(cfg, 'billing_payments', {
        telegram_payment_charge_id: `eq.${chargeId}`,
        telegram_id: `eq.${uid}`,
      });
    } else {
      const row = memory.billingPayments.get(chargeId) || null;
      if (row && Number(row.telegram_id) === uid) payment = row;
    }
    if (payment) return {
      kind: 'subscription',
      status: String(payment.status || 'paid').toLowerCase(),
      plan: String(payment.plan || ''),
    };
  
    const entitlements = await listUserEntitlements(uid, cfg);
    const entitlement = entitlements.find(row =>
      String(row.payment_charge_id || row.paymentChargeId || '') === chargeId
      && Number(row.telegram_id || row.telegramId || 0) === uid
    );
    if (!entitlement) return null;
    return {
      kind: 'pass',
      status: String(entitlement.status || 'active').toLowerCase(),
      plan: String(entitlement.entitlement_type || entitlement.type || ''),
    };
  }
  
  async function applyRefundedPayment(userId, paymentChargeId, cfg) {
    const uid = Number(userId);
    const chargeId = String(paymentChargeId || '').trim();
    if (!Number.isSafeInteger(uid) || uid <= 0 || !chargeId) return { updated:false, reason:'invalid_refund' };
  
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
        if (row && Number(row.telegram_id) === uid) {
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
    if (!payment || payment.currency !== 'XTR') return false;
    const chargeId = String(payment.telegram_payment_charge_id || '');
    if (!chargeId) return false;
  
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
      if (Number(subscription.userId) !== Number(userId)) return false;
      const planCfg = billingPlanConfig(subscription.plan, cfg);
      if (!planCfg || Number(payment.total_amount) !== Number(planCfg.stars)) return false;
  
      const expiresUnix = Number(payment.subscription_expiration_date || 0)
        || (Number(fallbackDate || Math.floor(Date.now() / 1000)) + SUBSCRIPTION_PERIOD_SECONDS);
      const expiresAt = new Date(expiresUnix * 1000).toISOString();
  
      await saveBillingPayment({
        telegram_payment_charge_id: chargeId,
        telegram_id: Number(userId),
        plan: subscription.plan,
        stars_amount: Number(payment.total_amount),
        currency: 'XTR',
        invoice_payload: String(payment.invoice_payload || ''),
        provider_payment_charge_id: payment.provider_payment_charge_id || null,
        subscription_expiration_date: expiresAt,
        is_recurring: Boolean(payment.is_recurring),
        is_first_recurring: Boolean(payment.is_first_recurring),
        status: 'paid',
        created_at: new Date(Number(fallbackDate || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
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
    if (!pass || Number(pass.userId) !== Number(userId)) return false;
    const product = passProductConfig(pass.passType, cfg);
    if (!product || Number(payment.total_amount) !== Number(product.stars)) return false;
  
    const activated = await activatePassPurchase({
      telegramId: Number(userId),
      passType: pass.passType,
      fixtureId: pass.fixtureId,
      starsAmount: Number(payment.total_amount),
      paymentChargeId: chargeId,
      invoicePayload: String(payment.invoice_payload || ''),
      paidAt: new Date(Number(fallbackDate || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    }, cfg);
    return Boolean(activated?.activated || activated?.duplicate);
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
        pendingUpdates: Number(info?.pending_update_count || 0),
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
      if (Number(receiver.user?.id) !== Number(userId)) continue;
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
      if (Number(source.user?.id) !== Number(userId)) continue;
      const chargeId=String(item?.id || '').trim();
      if (!chargeId || refundedChargeIds.has(chargeId) || seenIncomingCharges.has(chargeId)) continue;
      seenIncomingCharges.add(chargeId);
  
      const pass = await parsePassInvoicePayload(source.invoice_payload, cfg.botToken);
      if (pass && Number(pass.userId) === Number(userId)) {
        const product = passProductConfig(pass.passType, cfg);
        if (product && Number(item.amount) === Number(product.stars)) {
          const applied = await applySuccessfulPayment(userId, {
            currency: 'XTR',
            total_amount: Number(item.amount),
            invoice_payload: source.invoice_payload,
            telegram_payment_charge_id: chargeId,
            provider_payment_charge_id: '',
            is_recurring: false,
            is_first_recurring: false,
          }, cfg, Number(item.date || Math.floor(Date.now() / 1000)));
          if (applied) passVerified += 1;
        }
        continue;
      }
  
      const parsed = await parseInvoicePayload(source.invoice_payload, cfg.botToken);
      if (!parsed || Number(parsed.userId) !== Number(userId)) continue;
      const planCfg = billingPlanConfig(parsed.plan, cfg);
      if (!planCfg || Number(item.amount) !== Number(planCfg.stars)) continue;
      const period = Number(source.subscription_period || SUBSCRIPTION_PERIOD_SECONDS);
      const expiresUnix = Number(item.date || 0) + period;
      if (!best || expiresUnix > best.expiresUnix) best = { item, source, parsed, expiresUnix, chargeId };
    }
  
    let subscriptionSynced = false;
    if (best && best.expiresUnix * 1000 > Date.now()) {
      subscriptionSynced = await applySuccessfulPayment(userId, {
        currency: 'XTR',
        total_amount: Number(best.item.amount),
        invoice_payload: best.source.invoice_payload,
        telegram_payment_charge_id: best.chargeId,
        provider_payment_charge_id: '',
        subscription_expiration_date: best.expiresUnix,
        is_recurring: true,
        is_first_recurring: false,
      }, cfg, Number(best.item.date || Math.floor(Date.now() / 1000)));
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

  return {
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
  };
}
