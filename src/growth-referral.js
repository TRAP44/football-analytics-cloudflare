// Bounded growth/referral domain extracted from worker.js for Issue #440.
// Persistence, user lookup, metadata sanitization and clock are injected by the composition root.
export function createGrowthReferralRuntime({
  memory,
  getUserRecord,
  hasSupabase,
  supaPatch,
  supaUpsert,
  supaSelectOne,
  supaDelete,
  safeOpsMetadata,
  redactOpsString,
  normalizeReferralCode,
  opaqueReferralCode,
  referralAttributionDecision,
  splitLaunchReferralParts,
  clock = () => Date.now(),
}) {
  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string') return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=integerCandidate(value);
    return number !== null && number > 0 ? number : 0;
  }

  function cleanLaunchPart(value = '', max = 48) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g,'').replace(/_+/g,'_').replace(/^-+|-+$/g,'').slice(0,max);
  }
  
  function parseLaunchStartParam(value = '') {
    const raw=String(value || '').trim().replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
    if (!raw) return {source:'telegram',campaign:'direct',content:'',startParam:'',referralCode:''};
    const lower=raw.toLowerCase();
    let parts=lower.includes('__') ? lower.split('__').filter(Boolean) : lower.split('_').filter(Boolean);
    const referral=splitLaunchReferralParts(parts);
    parts=referral.parts;
    const prefix=cleanLaunchPart(parts.shift() || '',20);
    if (/^fx\d{1,12}$/.test(prefix)) {
      const fixtureId=Number(prefix.slice(2));
      const source=cleanLaunchPart(parts.shift() || 'social',24) || 'social';
      const campaign=cleanLaunchPart(parts.shift() || 'match_share',32) || 'match_share';
      const content=cleanLaunchPart(parts.join('_'),40);
      return {source,campaign,content,startParam:raw,fixtureId,action:'fixture',referralCode:referral.referralCode};
    }
    if (['media','press','partner','social'].includes(prefix)) {
      return {
        source:cleanLaunchPart(parts[0] || prefix,32) || prefix,
        campaign:cleanLaunchPart(parts[1] || 'launch',40) || 'launch',
        content:cleanLaunchPart(parts.slice(2).join('_'),48),
        startParam:raw,
        referralCode:referral.referralCode,
      };
    }
    if (prefix === 'ref' || prefix === 'referral') {
      return {
        source:'referral',
        campaign:cleanLaunchPart(parts[0] || 'invite',40) || 'invite',
        content:cleanLaunchPart(parts.slice(1).join('_'),48),
        startParam:raw,
        referralCode:referral.referralCode,
      };
    }
    return {
      source:'telegram',
      campaign:cleanLaunchPart(lower,40) || 'direct',
      content:'',
      startParam:raw,
      referralCode:referral.referralCode,
    };
  }
  
  function acquisitionFromUser(row = {}) {
    return {
      source:cleanLaunchPart(row?.acquisition_source || 'telegram',32) || 'telegram',
      campaign:cleanLaunchPart(row?.acquisition_campaign || 'direct',40) || 'direct',
      content:cleanLaunchPart(row?.acquisition_content || '',48),
      startParam:String(row?.acquisition_start_param || '').slice(0,64),
      firstTouchAt:row?.acquisition_first_touch_at || null,
    };
  }
  
  async function ensureLaunchAttribution(userId, rawStartParam, cfg) {
    const id=positiveSafeInteger(userId);
    if (!id) return parseLaunchStartParam(rawStartParam);
    const incoming=parseLaunchStartParam(rawStartParam);
    const existing=await getUserRecord(id,cfg).catch(()=>null);
    if (existing?.acquisition_first_touch_at) return acquisitionFromUser(existing);
    const patch={
      acquisition_source:incoming.source,
      acquisition_campaign:incoming.campaign,
      acquisition_content:incoming.content,
      acquisition_start_param:incoming.startParam,
      acquisition_first_touch_at:new Date(clock()).toISOString(),
    };
    if (hasSupabase(cfg)) {
      await supaPatch(cfg,'users',{telegram_id:`eq.${id}`,acquisition_first_touch_at:'is.null'},patch).catch(()=>null);
      const confirmed=await getUserRecord(id,cfg).catch(()=>null);
      return confirmed?.acquisition_first_touch_at ? acquisitionFromUser(confirmed) : {...incoming,firstTouchAt:patch.acquisition_first_touch_at};
    }
    const current=memory.users.get(id) || {telegram_id:id,plan:'FREE'};
    memory.users.set(id,{...current,...patch});
    return {...incoming,firstTouchAt:patch.acquisition_first_touch_at};
  }
  
  async function recordGrowthEvent(cfg, event = {}) {
    const task = recordGrowthEventTask(cfg, event);
    if (typeof cfg?.waitUntil === 'function') {
      try {
        cfg.waitUntil(task);
      } catch {
        // waitUntil registration is best-effort; the caller still awaits the
        // same task so analytics delivery is not lost because of a bad hook.
      }
    }
    return await task;
  }
  
  async function recordGrowthEventTask(cfg, {
    userId,
    eventName,
    channel='telegram',
    fixtureId=null,
    metadata={},
    attribution=null,
    eventKey='',
  } = {}) {
    const id=positiveSafeInteger(userId);
    const event=cleanLaunchPart(eventName,40);
    const rawDedupeKey=String(eventKey || '').trim();
    const dedupeKey=/^[A-Za-z0-9._:-]{1,180}$/.test(rawDedupeKey) ? rawDedupeKey : '';
    if (!id || !event) return false;
    try {
      const attr=attribution || acquisitionFromUser(await getUserRecord(id,cfg).catch(()=>null));
      const row={
        telegram_id:id,
        event_name:event,
        event_key:dedupeKey || null,
        channel:['telegram','miniapp','system'].includes(channel) ? channel : 'telegram',
        fixture_id:positiveSafeInteger(fixtureId) || null,
        source:attr.source || 'telegram',
        campaign:attr.campaign || 'direct',
        content:attr.content || '',
        metadata:safeOpsMetadata(metadata || {}),
        created_at:new Date(clock()).toISOString(),
      };
      if (hasSupabase(cfg)) {
        if (dedupeKey) {
          try {
            await supaUpsert(cfg,'growth_events',row);
          } catch (error) {
            const existing=await supaSelectOne(cfg,'growth_events',{event_key:`eq.${dedupeKey}`}).catch(()=>null);
            if (!existing) throw error;
          }
        } else await supaUpsert(cfg,'growth_events',row);
      } else if (dedupeKey) {
        if (!(memory.growthEventKeys instanceof Set)) memory.growthEventKeys=new Set();
        if (memory.growthEventKeys.has(dedupeKey)) return true;
        memory.growthEventKeys.add(dedupeKey);
      }
      return true;
    } catch {
      return false;
    }
  }
  
  function referralCodeEventKey(code) {
    return `referral_code:${normalizeReferralCode(code)}`;
  }
  
  function referralAttributionEventKey(userId) {
    return `referral_attribution:${positiveSafeInteger(userId)}`;
  }
  
  function referralOpenEventKey(userId) {
    return `referral_open:${positiveSafeInteger(userId)}`;
  }
  
  async function ensureReferralCode(userId, cfg) {
    const id=positiveSafeInteger(userId);
    if (!id) return '';
    const code=normalizeReferralCode(await opaqueReferralCode(id,cfg?.botToken));
    if (!code) return '';
  
    if (hasSupabase(cfg)) {
      await supaUpsert(cfg,'growth_events',{
        telegram_id:id,
        event_name:'referral_code_created',
        event_key:referralCodeEventKey(code),
        channel:'system',
        fixture_id:null,
        source:'internal',
        campaign:'referral',
        content:'code',
        metadata:{referral_code:code},
        created_at:new Date(clock()).toISOString(),
      }).catch(()=>null);
      const confirmed=await supaSelectOne(cfg,'growth_events',{event_key:`eq.${referralCodeEventKey(code)}`});
      return positiveSafeInteger(confirmed?.telegram_id)===id && String(confirmed?.event_name || '')==='referral_code_created' ? code : '';
    }
  
    if (!(memory.referralCodeOwners instanceof Map)) memory.referralCodeOwners=new Map();
    memory.referralCodeOwners.set(code,id);
    return code;
  }
  
  async function lookupReferralCodeOwner(code, cfg) {
    const normalized=normalizeReferralCode(code);
    if (!normalized) return 0;
    if (hasSupabase(cfg)) {
      const row=await supaSelectOne(cfg,'growth_events',{event_key:`eq.${referralCodeEventKey(normalized)}`}).catch(()=>null);
      if (String(row?.event_name || '')!=='referral_code_created') return 0;
      return positiveSafeInteger(row?.telegram_id);
    }
    return positiveSafeInteger(memory.referralCodeOwners?.get?.(normalized));
  }
  
  async function referralAttributionForUser(userId, cfg) {
    const id=positiveSafeInteger(userId);
    if (!id) return null;
    if (hasSupabase(cfg)) {
      const row=await supaSelectOne(cfg,'growth_events',{event_key:`eq.${referralAttributionEventKey(id)}`}).catch(()=>null);
      if (
        positiveSafeInteger(row?.telegram_id)!==id
        || String(row?.event_name || '')!=='referred_first_open'
      ) return null;
      const code=normalizeReferralCode(row?.metadata?.referral_code || '');
      return code ? {referralCode:code,createdAt:row?.created_at || null} : null;
    }
    const code=normalizeReferralCode(memory.referralAttributions?.get?.(id) || '');
    return code ? {referralCode:code,createdAt:null} : null;
  }
  
  async function applyReferralAttribution(userId, launchIntent, cfg) {
    const id=positiveSafeInteger(userId);
    const code=normalizeReferralCode(launchIntent?.referralCode || '');
    if (!id) return {accepted:false,status:'invalid_user'};
    if (!code) return {accepted:false,status:'none'};
  
    const [referrerUserId,existing]=await Promise.all([
      lookupReferralCodeOwner(code,cfg),
      referralAttributionForUser(id,cfg),
    ]);
    const decision=referralAttributionDecision({
      referredUserId:id,
      referrerUserId,
      referralCode:code,
      existingReferralCode:existing?.referralCode || '',
    });
    if (!decision.accepted) return decision;
  
    const attribution={
      source:'referral',
      campaign:cleanLaunchPart(launchIntent?.campaign || 'match_share',40) || 'match_share',
      content:cleanLaunchPart(launchIntent?.content || 'share',48) || 'share',
    };
    const metadata={
      referral_code:code,
      origin_source:cleanLaunchPart(launchIntent?.source || 'social',32) || 'social',
      origin_campaign:cleanLaunchPart(launchIntent?.campaign || 'match_share',40) || 'match_share',
      origin_content:cleanLaunchPart(launchIntent?.content || '',48),
    };
  
    if (!hasSupabase(cfg)) {
      if (!(memory.referralAttributions instanceof Map)) memory.referralAttributions=new Map();
      if (memory.referralAttributions.has(id)) {
        return {accepted:false,status:'duplicate_attribution',referralCode:memory.referralAttributions.get(id)};
      }
      memory.referralAttributions.set(id,code);
    }
  
    await recordGrowthEvent(cfg,{
      userId:id,
      eventName:'referred_first_open',
      channel:'telegram',
      fixtureId:positiveSafeInteger(launchIntent?.fixtureId) || null,
      attribution,
      metadata,
      eventKey:referralAttributionEventKey(id),
    });
  
    const confirmed=await referralAttributionForUser(id,cfg);
    if (!confirmed || confirmed.referralCode!==code) {
      return {accepted:false,status:'duplicate_attribution',referralCode:confirmed?.referralCode || ''};
    }
  
    await recordGrowthEvent(cfg,{
      userId:id,
      eventName:'referral_open',
      channel:'telegram',
      fixtureId:positiveSafeInteger(launchIntent?.fixtureId) || null,
      attribution,
      metadata,
      eventKey:referralOpenEventKey(id),
    });
    return {accepted:true,status:'accepted',referralCode:code};
  }
  
  async function recordReferredPayment(userId, payment, plan, cfg) {
    const id=positiveSafeInteger(userId);
    const chargeId=String(payment?.telegram_payment_charge_id || '').trim();
    const starsAmount=positiveSafeInteger(payment?.total_amount);
    if (!id || !/^[A-Za-z0-9._:-]{1,160}$/.test(chargeId) || !starsAmount) return false;
    const referral=await referralAttributionForUser(id,cfg);
    if (!referral?.referralCode) return false;
    return await recordGrowthEvent(cfg,{
      userId:id,
      eventName:'referred_payment',
      channel:'system',
      attribution:{source:'referral',campaign:'telegram_stars',content:cleanLaunchPart(plan || 'paid',24) || 'paid'},
      metadata:{
        referral_code:referral.referralCode,
        plan:cleanLaunchPart(plan || '',24),
        stars_amount:starsAmount,
        recurring:Boolean(payment?.is_recurring),
      },
      eventKey:`referred_payment:${chargeId}`,
    });
  }
  
  async function cleanupGrowthEvents(cfg) {
    if (!hasSupabase(cfg)) return {skipped:true};
    const configuredDays=integerCandidate(cfg?.growthRetentionDays);
    const days=Math.max(7,Math.min(3650,configuredDays ?? 90));
    try {
      const nowMs=Number(clock());
      if (!Number.isFinite(nowMs)) throw new Error('Invalid growth cleanup clock.');
      const cutoff=new Date(nowMs-days*86400_000).toISOString();
      await supaDelete(cfg,'growth_events',{created_at:`lt.${cutoff}`});
      return {ok:true,cutoff,retentionDays:days};
    } catch (error) {
      return {ok:false,error:redactOpsString(error?.message || error,180)};
    }
  }

  return {
    cleanLaunchPart,
    parseLaunchStartParam,
    acquisitionFromUser,
    ensureLaunchAttribution,
    recordGrowthEvent,
    recordGrowthEventTask,
    referralCodeEventKey,
    referralAttributionEventKey,
    referralOpenEventKey,
    ensureReferralCode,
    lookupReferralCodeOwner,
    referralAttributionForUser,
    applyReferralAttribution,
    recordReferredPayment,
    cleanupGrowthEvents,
  };
}
