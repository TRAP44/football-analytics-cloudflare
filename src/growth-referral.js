import { bytesToHex } from './crypto-utils.js';

// Bounded growth/referral domain extracted from worker.js for Issue #440.
// Persistence, user lookup, metadata sanitization and clock are injected by the composition root.
export function createGrowthReferralRuntime(deps = {}) {
  const {
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
  } = deps;

  if (!memory || typeof memory!=='object' || Array.isArray(memory)) {
    throw new TypeError('Growth referral runtime requires memory state.');
  }
  if (!(memory.users instanceof Map)) {
    throw new TypeError('Growth referral runtime requires memory.users Map.');
  }
  for (const [name,fn] of Object.entries({
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
    clock,
  })) {
    if (typeof fn!=='function') {
      throw new TypeError(`Growth referral runtime requires ${name}.`);
    }
  }

  function plainObject(value) {
    try {
      return value && typeof value==='object' && !Array.isArray(value)
        ? value
        : null;
    } catch {
      return null;
    }
  }

  function safeRead(value,key) {
    try {
      return value?.[key];
    } catch {
      return undefined;
    }
  }

  function safeText(value,max=180) {
    if (typeof value!=='string') return '';
    return value
      .replace(/[\u0000-\u001f\u007f]+/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,max);
  }

  function safeCall(fn,...args) {
    try {
      return fn(...args);
    } catch {
      return undefined;
    }
  }

  async function safeAsyncCall(fn,...args) {
    try {
      return await fn(...args);
    } catch {
      return undefined;
    }
  }

  function integerCandidate(value) {
    if (typeof value==='number') {
      return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=integerCandidate(value);
    return number!==null && number>0 ? number : 0;
  }

  function strictInstantMs(value) {
    if (typeof value!=='string' || !value.trim()) return null;
    const raw=value.trim();
    const match=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(raw);
    if (!match) return null;
    const year=Number(match[1]);
    const month=Number(match[2]);
    const day=Number(match[3]);
    if (month<1 || month>12 || day<1) return null;
    const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    if (day>maxDay) return null;
    const parsed=Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function safeClockIso() {
    const value=safeCall(clock);
    if (typeof value==='number' && Number.isFinite(value)) {
      try {
        return new Date(value).toISOString();
      } catch {
        return '';
      }
    }
    if (value instanceof Date) {
      try {
        return Number.isFinite(value.getTime()) ? value.toISOString() : '';
      } catch {
        return '';
      }
    }
    return '';
  }

  function supabaseMode(cfg) {
    const value=safeCall(hasSupabase,cfg);
    if (value===true) return true;
    if (value===false) return false;
    return null;
  }

  function normalizedReferralCode(value) {
    const result=safeCall(normalizeReferralCode,value);
    return typeof result==='string' ? result : '';
  }

  function safeMetadata(value) {
    const sanitized=safeCall(safeOpsMetadata,plainObject(value) || {});
    return plainObject(sanitized) || {};
  }

  function eventRowMatches(row,{id,event,eventKey}) {
    const value=plainObject(row);
    return Boolean(
      value
      && positiveSafeInteger(safeRead(value,'telegram_id'))===id
      && safeRead(value,'event_name')===event
      && safeRead(value,'event_key')===eventKey
    );
  }

  async function stableEventKeyToken(value = '') {
    const raw=safeText(value,512);
    if (!raw) return '';
    if (/^[A-Za-z0-9._:-]{1,160}$/.test(raw)) return raw;
    const subtle=globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest!=='function') return '';
    try {
      const digest=await subtle.digest(
        'SHA-256',
        new TextEncoder().encode(raw),
      );
      const hex=bytesToHex(digest);
      return typeof hex==='string' && /^[a-f0-9]{64}$/i.test(hex)
        ? `h${hex.toLowerCase().slice(0,40)}`
        : '';
    } catch {
      return '';
    }
  }

  function cleanLaunchPart(value = '', max = 48) {
    if (typeof value!=='string') return '';
    const boundedMax=Number.isSafeInteger(max)
      ? Math.max(1,Math.min(80,max))
      : 48;
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g,'')
      .replace(/_+/g,'_')
      .replace(/^-+|-+$/g,'')
      .slice(0,boundedMax);
  }

  function parseLaunchStartParam(value = '') {
    if (typeof value!=='string') {
      return {
        source:'telegram',
        campaign:'direct',
        content:'',
        startParam:'',
        referralCode:'',
      };
    }
    const raw=value
      .trim()
      .replace(/[^A-Za-z0-9_-]/g,'')
      .slice(0,64);
    if (!raw) {
      return {
        source:'telegram',
        campaign:'direct',
        content:'',
        startParam:'',
        referralCode:'',
      };
    }

    const lower=raw.toLowerCase();
    let parts=lower.includes('__')
      ? lower.split('__').filter(Boolean)
      : lower.split('_').filter(Boolean);
    const referral=plainObject(
      safeCall(splitLaunchReferralParts,parts),
    ) || {};
    parts=Array.isArray(safeRead(referral,'parts'))
      ? safeRead(referral,'parts').filter(part=>typeof part==='string')
      : [];
    const referralCode=normalizedReferralCode(
      safeRead(referral,'referralCode'),
    );
    const prefix=cleanLaunchPart(parts.shift() || '',20);

    if (/^fx\d{1,12}$/.test(prefix)) {
      const fixtureId=positiveSafeInteger(prefix.slice(2));
      const source=cleanLaunchPart(
        parts.shift() || 'social',
        24,
      ) || 'social';
      const campaign=cleanLaunchPart(
        parts.shift() || 'match_share',
        32,
      ) || 'match_share';
      const content=cleanLaunchPart(parts.join('_'),40);
      return {
        source,
        campaign,
        content,
        startParam:raw,
        fixtureId,
        action:'fixture',
        referralCode,
      };
    }

    if (['media','press','partner','social'].includes(prefix)) {
      return {
        source:cleanLaunchPart(parts[0] || prefix,32) || prefix,
        campaign:cleanLaunchPart(parts[1] || 'launch',40) || 'launch',
        content:cleanLaunchPart(parts.slice(2).join('_'),48),
        startParam:raw,
        referralCode,
      };
    }

    if (prefix==='ref' || prefix==='referral') {
      return {
        source:'referral',
        campaign:cleanLaunchPart(parts[0] || 'invite',40) || 'invite',
        content:cleanLaunchPart(parts.slice(1).join('_'),48),
        startParam:raw,
        referralCode,
      };
    }

    return {
      source:'telegram',
      campaign:cleanLaunchPart(lower,40) || 'direct',
      content:'',
      startParam:raw,
      referralCode,
    };
  }

  function acquisitionFromUser(row = {}) {
    const value=plainObject(row) || {};
    const rawFirstTouch=safeRead(value,'acquisition_first_touch_at');
    return {
      source:cleanLaunchPart(
        safeRead(value,'acquisition_source'),
        32,
      ) || 'telegram',
      campaign:cleanLaunchPart(
        safeRead(value,'acquisition_campaign'),
        40,
      ) || 'direct',
      content:cleanLaunchPart(
        safeRead(value,'acquisition_content'),
        48,
      ),
      startParam:safeText(
        safeRead(value,'acquisition_start_param'),
        64,
      ),
      firstTouchAt:
        strictInstantMs(rawFirstTouch)!==null
          ? rawFirstTouch
          : null,
    };
  }

  async function ensureLaunchAttribution(userId,rawStartParam,cfg) {
    const id=positiveSafeInteger(userId);
    const incoming=parseLaunchStartParam(rawStartParam);
    if (!id) return incoming;

    const existing=plainObject(
      await safeAsyncCall(getUserRecord,id,cfg),
    );
    const existingAttribution=acquisitionFromUser(existing);
    if (existingAttribution.firstTouchAt) {
      return existingAttribution;
    }

    const firstTouchAt=safeClockIso();
    if (!firstTouchAt) return {...incoming,firstTouchAt:null};

    const patch={
      acquisition_source:incoming.source,
      acquisition_campaign:incoming.campaign,
      acquisition_content:incoming.content,
      acquisition_start_param:incoming.startParam,
      acquisition_first_touch_at:firstTouchAt,
    };

    const mode=supabaseMode(cfg);
    if (mode===null) return {...incoming,firstTouchAt:null};

    if (mode===true) {
      await safeAsyncCall(
        supaPatch,
        cfg,
        'users',
        {
          telegram_id:`eq.${id}`,
          acquisition_first_touch_at:'is.null',
        },
        patch,
      );
      const confirmed=plainObject(
        await safeAsyncCall(getUserRecord,id,cfg),
      );
      const attribution=acquisitionFromUser(confirmed);
      return attribution.firstTouchAt
        ? attribution
        : {...incoming,firstTouchAt:null};
    }

    const current=plainObject(memory.users.get(id))
      || {telegram_id:id,plan:'FREE'};
    memory.users.set(id,{...current,...patch});
    return {...incoming,firstTouchAt};
  }

  async function recordGrowthEvent(cfg,eventInput={}) {
    const task=recordGrowthEventTask(cfg,eventInput);
    const waitUntil=safeRead(cfg,'waitUntil');
    if (typeof waitUntil==='function') {
      try {
        waitUntil.call(cfg,task);
      } catch {}
    }
    return await task;
  }

  async function recordGrowthEventTask(cfg,eventInput={}) {
    const input=plainObject(eventInput) || {};
    const id=positiveSafeInteger(safeRead(input,'userId'));
    const event=cleanLaunchPart(
      safeRead(input,'eventName'),
      40,
    );
    const rawDedupeKey=safeText(
      safeRead(input,'eventKey'),
      180,
    );
    const dedupeKey=/^[A-Za-z0-9._:-]{1,180}$/.test(rawDedupeKey)
      ? rawDedupeKey
      : '';
    if (!id || !event || (rawDedupeKey && !dedupeKey)) return false;

    const createdAt=safeClockIso();
    if (!createdAt) return false;

    try {
      const explicitAttribution=plainObject(
        safeRead(input,'attribution'),
      );
      const storedUser=plainObject(
        await safeAsyncCall(getUserRecord,id,cfg),
      );
      const attr=explicitAttribution
        ? acquisitionFromUser({
            acquisition_source:safeRead(explicitAttribution,'source'),
            acquisition_campaign:safeRead(explicitAttribution,'campaign'),
            acquisition_content:safeRead(explicitAttribution,'content'),
          })
        : acquisitionFromUser(storedUser);

      const rawChannel=safeRead(input,'channel');
      const channel=
        typeof rawChannel==='string'
        && ['telegram','miniapp','system'].includes(rawChannel)
          ? rawChannel
          : 'telegram';

      const row={
        telegram_id:id,
        event_name:event,
        event_key:dedupeKey || null,
        channel,
        fixture_id:
          positiveSafeInteger(safeRead(input,'fixtureId')) || null,
        source:attr.source || 'telegram',
        campaign:attr.campaign || 'direct',
        content:attr.content || '',
        metadata:safeMetadata(safeRead(input,'metadata')),
        created_at:createdAt,
      };

      const mode=supabaseMode(cfg);
      if (mode===null) return false;

      if (mode===true) {
        if (dedupeKey) {
          try {
            await supaUpsert(cfg,'growth_events',row);
          } catch (error) {
            const existing=await safeAsyncCall(
              supaSelectOne,
              cfg,
              'growth_events',
              {event_key:`eq.${dedupeKey}`},
            );
            if (!eventRowMatches(existing,{
              id,
              event,
              eventKey:dedupeKey,
            })) {
              throw error;
            }
          }
        } else {
          await supaUpsert(cfg,'growth_events',row);
        }
      } else if (dedupeKey) {
        if (!(memory.growthEventKeys instanceof Set)) {
          memory.growthEventKeys=new Set();
        }
        if (memory.growthEventKeys.has(dedupeKey)) return true;
        memory.growthEventKeys.add(dedupeKey);
      }
      return true;
    } catch {
      return false;
    }
  }

  function referralCodeEventKey(code) {
    const normalized=normalizedReferralCode(code);
    return normalized ? `referral_code:${normalized}` : '';
  }

  function referralAttributionEventKey(userId) {
    const id=positiveSafeInteger(userId);
    return id ? `referral_attribution:${id}` : '';
  }

  function referralOpenEventKey(userId) {
    const id=positiveSafeInteger(userId);
    return id ? `referral_open:${id}` : '';
  }

  async function ensureReferralCode(userId,cfg) {
    const id=positiveSafeInteger(userId);
    if (!id) return '';

    const token=safeText(safeRead(cfg,'botToken'),512);
    const rawCode=await safeAsyncCall(opaqueReferralCode,id,token);
    const code=normalizedReferralCode(rawCode);
    if (!code) return '';

    const eventKey=referralCodeEventKey(code);
    if (!eventKey) return '';

    const mode=supabaseMode(cfg);
    if (mode===null) return '';

    if (mode===true) {
      const createdAt=safeClockIso();
      if (!createdAt) return '';

      await safeAsyncCall(supaUpsert,cfg,'growth_events',{
        telegram_id:id,
        event_name:'referral_code_created',
        event_key:eventKey,
        channel:'system',
        fixture_id:null,
        source:'internal',
        campaign:'referral',
        content:'code',
        metadata:{referral_code:code},
        created_at:createdAt,
      });
      const confirmed=plainObject(
        await safeAsyncCall(
          supaSelectOne,
          cfg,
          'growth_events',
          {event_key:`eq.${eventKey}`},
        ),
      );
      const metadata=plainObject(safeRead(confirmed,'metadata')) || {};
      return positiveSafeInteger(safeRead(confirmed,'telegram_id'))===id
        && safeRead(confirmed,'event_name')==='referral_code_created'
        && normalizedReferralCode(
          safeRead(metadata,'referral_code'),
        )===code
          ? code
          : '';
    }

    if (!(memory.referralCodeOwners instanceof Map)) {
      memory.referralCodeOwners=new Map();
    }
    const owner=positiveSafeInteger(memory.referralCodeOwners.get(code));
    if (owner && owner!==id) return '';
    memory.referralCodeOwners.set(code,id);
    return code;
  }

  async function lookupReferralCodeOwner(code,cfg) {
    const normalized=normalizedReferralCode(code);
    if (!normalized) return 0;

    const mode=supabaseMode(cfg);
    if (mode===null) return 0;

    if (mode===true) {
      const eventKey=referralCodeEventKey(normalized);
      const row=plainObject(
        await safeAsyncCall(
          supaSelectOne,
          cfg,
          'growth_events',
          {event_key:`eq.${eventKey}`},
        ),
      );
      const metadata=plainObject(safeRead(row,'metadata')) || {};
      if (
        safeRead(row,'event_name')!=='referral_code_created'
        || normalizedReferralCode(
          safeRead(metadata,'referral_code'),
        )!==normalized
      ) return 0;
      return positiveSafeInteger(safeRead(row,'telegram_id'));
    }

    if (!(memory.referralCodeOwners instanceof Map)) return 0;
    return positiveSafeInteger(memory.referralCodeOwners.get(normalized));
  }

  async function referralAttributionForUser(userId,cfg) {
    const id=positiveSafeInteger(userId);
    if (!id) return null;

    const mode=supabaseMode(cfg);
    if (mode===null) return null;

    if (mode===true) {
      const eventKey=referralAttributionEventKey(id);
      const row=plainObject(
        await safeAsyncCall(
          supaSelectOne,
          cfg,
          'growth_events',
          {event_key:`eq.${eventKey}`},
        ),
      );
      if (
        positiveSafeInteger(safeRead(row,'telegram_id'))!==id
        || safeRead(row,'event_name')!=='referred_first_open'
        || safeRead(row,'event_key')!==eventKey
      ) return null;

      const metadata=plainObject(safeRead(row,'metadata')) || {};
      const code=normalizedReferralCode(
        safeRead(metadata,'referral_code'),
      );
      const createdAt=safeRead(row,'created_at');
      return code
        ? {
            referralCode:code,
            createdAt:
              strictInstantMs(createdAt)!==null
                ? createdAt
                : null,
          }
        : null;
    }

    if (!(memory.referralAttributions instanceof Map)) return null;
    const code=normalizedReferralCode(
      memory.referralAttributions.get(id),
    );
    return code ? {referralCode:code,createdAt:null} : null;
  }

  async function applyReferralAttribution(userId,launchIntent,cfg) {
    const id=positiveSafeInteger(userId);
    if (!id) return {accepted:false,status:'invalid_user'};

    const intent=plainObject(launchIntent) || {};
    const code=normalizedReferralCode(
      safeRead(intent,'referralCode'),
    );
    if (!code) return {accepted:false,status:'none'};

    const mode=supabaseMode(cfg);
    if (mode===null) {
      return {accepted:false,status:'storage_unavailable'};
    }

    const [referrerUserId,existing]=await Promise.all([
      lookupReferralCodeOwner(code,cfg),
      referralAttributionForUser(id,cfg),
    ]);
    const decision=plainObject(
      safeCall(referralAttributionDecision,{
        referredUserId:id,
        referrerUserId,
        referralCode:code,
        existingReferralCode:safeRead(existing,'referralCode') || '',
      }),
    );
    if (!decision || safeRead(decision,'accepted')!==true) {
      return decision || {accepted:false,status:'invalid_ref'};
    }

    const attribution={
      source:'referral',
      campaign:cleanLaunchPart(
        safeRead(intent,'campaign') || 'match_share',
        40,
      ) || 'match_share',
      content:cleanLaunchPart(
        safeRead(intent,'content') || 'share',
        48,
      ) || 'share',
    };
    const metadata={
      referral_code:code,
      origin_source:cleanLaunchPart(
        safeRead(intent,'source') || 'social',
        32,
      ) || 'social',
      origin_campaign:cleanLaunchPart(
        safeRead(intent,'campaign') || 'match_share',
        40,
      ) || 'match_share',
      origin_content:cleanLaunchPart(
        safeRead(intent,'content'),
        48,
      ),
    };

    if (mode===false) {
      if (!(memory.referralAttributions instanceof Map)) {
        memory.referralAttributions=new Map();
      }
      if (memory.referralAttributions.has(id)) {
        return {
          accepted:false,
          status:'duplicate_attribution',
          referralCode:normalizedReferralCode(
            memory.referralAttributions.get(id),
          ),
        };
      }
      memory.referralAttributions.set(id,code);
    }

    const recorded=await recordGrowthEvent(cfg,{
      userId:id,
      eventName:'referred_first_open',
      channel:'telegram',
      fixtureId:
        positiveSafeInteger(safeRead(intent,'fixtureId')) || null,
      attribution,
      metadata,
      eventKey:referralAttributionEventKey(id),
    });

    const confirmed=await referralAttributionForUser(id,cfg);
    if (!recorded || !confirmed) {
      if (mode===false && memory.referralAttributions.get(id)===code) {
        memory.referralAttributions.delete(id);
      }
      return {accepted:false,status:'persistence_failed'};
    }
    if (confirmed.referralCode!==code) {
      return {
        accepted:false,
        status:'duplicate_attribution',
        referralCode:confirmed.referralCode || '',
      };
    }

    await recordGrowthEvent(cfg,{
      userId:id,
      eventName:'referral_open',
      channel:'telegram',
      fixtureId:
        positiveSafeInteger(safeRead(intent,'fixtureId')) || null,
      attribution,
      metadata,
      eventKey:referralOpenEventKey(id),
    });

    return {
      accepted:true,
      status:'accepted',
      referralCode:code,
    };
  }

  async function recordReferredPayment(userId,payment,plan,cfg) {
    const id=positiveSafeInteger(userId);
    const value=plainObject(payment) || {};
    const chargeId=safeText(
      safeRead(value,'telegram_payment_charge_id'),
      512,
    );
    const starsAmount=positiveSafeInteger(
      safeRead(value,'total_amount'),
    );
    const chargeToken=await stableEventKeyToken(chargeId);
    if (!id || !chargeToken || !starsAmount) return false;

    const referral=plainObject(
      await referralAttributionForUser(id,cfg),
    );
    const referralCode=normalizedReferralCode(
      safeRead(referral,'referralCode'),
    );
    if (!referralCode) return false;

    const planValue=cleanLaunchPart(
      typeof plan==='string' ? plan : '',
      24,
    );
    return await recordGrowthEvent(cfg,{
      userId:id,
      eventName:'referred_payment',
      channel:'system',
      attribution:{
        source:'referral',
        campaign:'telegram_stars',
        content:planValue || 'paid',
      },
      metadata:{
        referral_code:referralCode,
        plan:planValue,
        stars_amount:starsAmount,
        recurring:safeRead(value,'is_recurring')===true,
      },
      eventKey:`referred_payment:${chargeToken}`,
    });
  }

  async function cleanupGrowthEvents(cfg) {
    const mode=supabaseMode(cfg);
    if (mode===false) return {skipped:true};
    if (mode===null) {
      return {ok:false,error:'Supabase availability is unknown.'};
    }

    const configuredDays=integerCandidate(
      safeRead(cfg,'growthRetentionDays'),
    );
    const days=Math.max(
      7,
      Math.min(3650,configuredDays ?? 90),
    );
    try {
      const now=safeCall(clock);
      const nowMs=
        typeof now==='number' && Number.isFinite(now)
          ? now
          : now instanceof Date && Number.isFinite(now.getTime())
            ? now.getTime()
            : null;
      if (nowMs===null) {
        throw new Error('Invalid growth cleanup clock.');
      }
      const cutoff=new Date(
        nowMs-days*86400_000,
      ).toISOString();
      await supaDelete(
        cfg,
        'growth_events',
        {created_at:`lt.${cutoff}`},
      );
      return {ok:true,cutoff,retentionDays:days};
    } catch (error) {
      const message=safeText(safeRead(error,'message'),180)
        || 'growth_cleanup_failed';
      const redacted=safeCall(redactOpsString,message,180);
      return {
        ok:false,
        error:
          typeof redacted==='string' && redacted
            ? redacted
            : 'growth_cleanup_failed',
      };
    }
  }

  return Object.freeze({
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
  });
}
