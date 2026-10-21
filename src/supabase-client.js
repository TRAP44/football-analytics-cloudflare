import {withRequestDeadline} from './request-deadline.js';
import { createRpcAdmissionQueue } from './rpc-admission-queue.js';
import {createDurableRpcOperation} from './idempotent-rpc-recovery.js';

// Aggregate counters only: no keys, URLs, identifiers or payloads.
const readRecoveryStats={slowFallbacks:0,slowFallbackWins:0,originalWins:0,failedAfterFallback:0,busySkips:0};
export const supabaseReadRecoverySnapshot=()=>({...readRecoveryStats});
const noteReadRecovery=key=>{readRecoveryStats[key]=Math.min(Number.MAX_SAFE_INTEGER,readRecoveryStats[key]+1);};

export function createSupabaseClient({ fetchWithTimeout, redactMessage, sleepMs, bumpTelemetry = () => {}, now = () => performance.now() } = {}) {
  if (typeof fetchWithTimeout !== 'function') {
    throw new TypeError('createSupabaseClient requires fetchWithTimeout');
  }

  const redact = typeof redactMessage === 'function'
    ? redactMessage
    : (value, max = 180) => String(value ?? '').slice(0, max);

  const sleep = typeof sleepMs === 'function'
    ? sleepMs
    : ms => new Promise(resolve => setTimeout(resolve, ms));
  let activeReadFallbacks=0;
  const retryableReadStatuses = new Set([408, 503, 504]);
  const protectedHeaderNames = new Set([
    'apikey',
    'authorization',
    'proxy-authorization',
    'content-type',
  ]);

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function nonEmptyText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function boundedInteger(value, fallback, min, max) {
    let number = null;
    if (typeof value === 'number' && Number.isSafeInteger(value)) number = value;
    else if (typeof value === 'string' && /^\d+$/.test(value.trim())) number = Number(value.trim());
    if (!Number.isSafeInteger(number) || number < min || number > max) return fallback;
    return number;
  }

  function safeRedact(value, max = 180) {
    try {
      const redacted = redact(value, max);
      return String(redacted ?? '').slice(0, max);
    } catch {
      return '';
    }
  }

  function supabaseConfig(cfg) {
    const source = plainObject(cfg);
    const rawUrl = nonEmptyText(source?.supabaseUrl);
    const key = nonEmptyText(source?.supabaseKey);
    if (!rawUrl || !key) throw new TypeError('Supabase configuration requires supabaseUrl and supabaseKey.');

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new TypeError('Supabase configuration contains an invalid supabaseUrl.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new TypeError('Supabase configuration contains an invalid supabaseUrl.');
    }
    url.pathname = `${url.pathname.replace(/\/+$/g, '')}/`;
    return { baseUrl:url, key };
  }

  function resourceSegment(value, label) {
    const resource = nonEmptyText(value);
    if (!resource || resource.length > 128 || /[\u0000-\u001f\u007f]/u.test(resource)) {
      throw new TypeError(`Supabase ${label} must be a non-empty resource name.`);
    }
    return encodeURIComponent(resource);
  }

  function restUrl(cfg, resource, { rpc = false } = {}) {
    const { baseUrl } = supabaseConfig(cfg);
    const prefix = rpc ? 'rest/v1/rpc/' : 'rest/v1/';
    return new URL(`${prefix}${resourceSegment(resource, rpc ? 'RPC function' : 'table')}`, baseUrl);
  }

  function queryEntries(params, label) {
    const source = plainObject(params) || {};
    return Object.entries(source).map(([rawKey, value]) => {
      const key = nonEmptyText(rawKey);
      if (!key || /[\u0000-\u001f\u007f]/u.test(key)) {
        throw new TypeError(`Supabase ${label}: invalid query parameter name.`);
      }
      if (!['string','number','boolean'].includes(typeof value)) {
        throw new TypeError(`Supabase ${label}: invalid query parameter value for ${key}.`);
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new TypeError(`Supabase ${label}: invalid query parameter value for ${key}.`);
      }
      return [key, String(value)];
    });
  }

  function applyQueryParams(url, params, label) {
    for (const [key, value] of queryEntries(params, label)) url.searchParams.set(key, value);
  }

  function jsonEqual(left,right){
    if(left===right)return true;
    if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
    const keys=Object.keys(left);
    return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&jsonEqual(left[key],right[key]));
  }

  function responseArray(value, label) {
    if (!Array.isArray(value)) throw new Error(`Supabase ${label}: invalid response payload.`);
    return value;
  }

  function isTransientSecretReadAuthResponse(response, cfg) {
    if (Number(response?.status || 0) !== 401) return false;
    if (!nonEmptyText(plainObject(cfg)?.supabaseKey).startsWith('sb_secret_')) return false;
    const proxyStatus = String(response?.headers?.get?.('proxy-status') || '');
    return /(?:^|[;,\s])PostgREST(?:[;,\s]|$)/i.test(proxyStatus)
      && /(?:^|[;,\s])error=PGRST303(?:[;,\s]|$)/i.test(proxyStatus);
  }

  function withinDeadline(source,budget,operation,callerSignal){
    return withRequestDeadline(({signal,check,remaining})=>{
      const transportSignal=callerSignal?AbortSignal.any([signal,callerSignal]):signal;
      const checkBoth=()=>{
        check();
        if(callerSignal?.aborted)throw callerSignal.reason || new DOMException('Aborted','AbortError');
      };
      return operation({
        check:checkBoth,remaining,signal:transportSignal,
        fetchResponse:async(url,init={})=>{
          checkBoth();
          const requestSignal=init.signal?AbortSignal.any([transportSignal,init.signal]):transportSignal;
          requestSignal.throwIfAborted();
          const response=await fetchWithTimeout(url,{...init,signal:requestSignal},remaining(),source);
          try{checkBoth();requestSignal.throwIfAborted();}
          catch(error){try{Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}throw error;}
          return response;
        },
      });
    },{source,budgetMs:budget,now});
  }

  async function supaReadData(url,init,timeoutMs,source,cfg=null,callerSignal){
    return withinDeadline(source,timeoutMs,({fetchResponse,check,remaining,signal})=>new Promise((resolve,reject)=>{
      // Only table SELECTs use this path. Both the normal retry and a delayed
      // fallback share the same two attempts and original end-to-end deadline.
      // Keep the original request alive: a merely slow healthy response can win.
      let started=0,pending=0,settled=false,fallbackTimer,slowFallback=false;
      const controllers=[],failures=[];
      const cancelBody=response=>{try{Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}};
      const finish=(result,error,index)=>{
        if(settled)return;
        try{check();}catch(deadline){error=deadline;}
        settled=true;clearTimeout(fallbackTimer);signal.removeEventListener('abort',onAbort);
        for(const controller of controllers)controller.abort(Object.assign(new Error('Supabase read superseded.'),{code:'SUPABASE_READ_SUPERSEDED'}));
        if(slowFallback){
          activeReadFallbacks--;
          const key=error||!result?.response?.ok?'failedAfterFallback':index===1?'slowFallbackWins':'originalWins';
          noteReadRecovery(key);
        }
        if(error)reject(error);else resolve(result);
      };
      const onAbort=()=>finish(null,signal.reason||new DOMException('Aborted','AbortError'));
      function launch(){
        if(settled)return;
        try{check();}catch(error){finish(null,error);return;}
        if(started>=2)return;
        const index=started++,controller=new AbortController();controllers.push(controller);pending++;
        const attempt=async()=>{
          let response;
          try{response=await fetchResponse(url,{...init,signal:controller.signal});}
          catch(error){return {retry:true,error};}
          check();
          const retry=retryableReadStatuses.has(Number(response?.status||0))||isTransientSecretReadAuthResponse(response,cfg);
          // Discard the first transient error body before retrying. A stalled
          // error body must not consume the time reserved for the second read.
          if(retry&&index===0&&(started===2||remaining()>180)){
            cancelBody(response);return {retry:true,response,body:''};
          }
          const body=response.ok?await response.json():await response.text().catch(()=>'');
          check();
          if(response.ok&&!Array.isArray(body))throw new Error(`${source}: invalid response payload.`);
          return {response,body,retry};
        };
        attempt().then(result=>{
          pending--;if(settled)return;
          try{check();}catch(error){finish(null,error);return;}
          if(!result.retry){finish(result,null,index);return;}
          failures[index]=result;
          if(started===1){
            clearTimeout(fallbackTimer);
            if(remaining()<=180){finish(result,result.error,index);return;}
            Promise.resolve().then(()=>sleep(180)).then(()=>{
              if(settled)return;launch();
            },error=>finish(null,error));
          }else if(pending===0){
            const last=failures[1]||result;finish(last,last.error,1);
          }
          // A failed fallback cannot discard the original while it can succeed.
        },error=>{pending--;if(!settled)finish(null,error,index);});
      }
      if(signal.aborted){onAbort();return;}
      signal.addEventListener('abort',onAbort,{once:true});
      launch();
      // Measured failures are in the Node scheduler. HTTP Worker requests keep
      // their existing sequential policy; one fallback per client caps pressure.
      if(!settled&&plainObject(cfg)?.cronRunner==='github-actions'&&remaining()>2180){
        fallbackTimer=setTimeout(()=>{
          if(settled||started!==1||pending!==1||remaining()<=180)return;
          if(activeReadFallbacks>=1){noteReadRecovery('busySkips');return;}
          slowFallback=true;activeReadFallbacks++;noteReadRecovery('slowFallbacks');launch();
        },2000);
      }
    }),callerSignal);
  }

  async function supaWriteFetch(url,init,timeoutMs,source,cfg=null,retryAuth=false,callerSignal,readSuccess=false){
    return withinDeadline(source,timeoutMs,async({fetchResponse,check,remaining})=>{
      let response=await fetchResponse(url,init);
      if(retryAuth && isTransientSecretReadAuthResponse(response,cfg) && remaining()>180){
        try{Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}
        await sleep(180);check();response=await fetchResponse(url,init);
      }
      const text=response.ok && !readSuccess ? '' : await response.text();
      check();return {ok:response.ok,status:response.status,text:async()=>text};
    },callerSignal);
  }

  function hasSupabase(cfg) {
    const source = plainObject(cfg);
    return Boolean(nonEmptyText(source?.supabaseUrl) && nonEmptyText(source?.supabaseKey));
  }

  function supaHeaders(cfg, extra = {}) {
    // Supabase sb_secret_* keys are opaque API keys, not JWTs.
    // Keep them in apikey only; Bearer would make PostgREST parse them as JWTs.
    const { key } = supabaseConfig(cfg);
    const headers = {
      apikey: key,
      'content-type': 'application/json',
    };
    for (const [rawKey, value] of Object.entries(plainObject(extra) || {})) {
      const normalized = nonEmptyText(rawKey).toLowerCase();
      if (
        !normalized
        || protectedHeaderNames.has(normalized)
        || /[\u0000-\u001f\u007f]/u.test(normalized)
      ) continue;
      if (!['string','number','boolean'].includes(typeof value)) continue;
      headers[rawKey] = String(value);
    }
    return headers;
  }

  function supaRpcHeaders(cfg, extra = {}) {
    const headers = supaHeaders(cfg);
    const allowed = new Set([
      'x-analysis-usage-lifecycle',
      'x-analysis-operation-id',
      'x-analysis-usage-action',
    ]);
    for (const [key, value] of Object.entries(plainObject(extra) || {})) {
      const normalized = nonEmptyText(key).toLowerCase();
      if (!allowed.has(normalized)) continue;
      if (!['string','number','boolean'].includes(typeof value)) continue;
      headers[normalized] = String(value);
    }
    return headers;
  }

  async function supaSelectOne(cfg, table, params) {
    const tableName = nonEmptyText(table);
    const url = restUrl(cfg, tableName);
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', '1');
    applyQueryParams(url, params, tableName);
    const {response,body} = await supaReadData(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${tableName}`, cfg);
    if (!response.ok) throw new Error(`Supabase ${tableName}: HTTP ${response.status}`);
    const rows = responseArray(body, tableName);
    return rows[0] ?? null;
  }

  async function supaSelectMany(cfg, table, params = {}, { limit = 20, order = '', select = '*', timeoutMs = 7000, signal } = {}) {
    const tableName = nonEmptyText(table);
    const url = restUrl(cfg, tableName);
    const safeSelect = nonEmptyText(select) || '*';
    const safeOrder = nonEmptyText(order);
    const safeLimit = boundedInteger(limit, 20, 1, 1000);
    url.searchParams.set('select', safeSelect);
    url.searchParams.set('limit', String(safeLimit));
    if (safeOrder) url.searchParams.set('order', safeOrder);
    applyQueryParams(url, params, tableName);
    const budget=boundedInteger(timeoutMs,7000,1,7000);
    const {response,body} = await supaReadData(url, { headers: supaHeaders(cfg) }, budget, `Supabase ${tableName}`, cfg,signal);
    if (!response.ok) {
      const text = body;
      const detail = safeRedact(text, 160);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
    return responseArray(body, tableName);
  }

  async function supaSelectPaged(cfg, table, params = {}, { pageSize = 500, maxRows = 5000, order = '' } = {}) {
    const rows = [];
    const size = boundedInteger(pageSize, 500, 1, 1000);
    const cap = boundedInteger(maxRows, 5000, 1, 10000);

    for (let offset = 0; offset < cap; offset += size) {
      const requested = Math.min(size, cap - offset);
      const finalPage = offset + requested >= cap;
      const inlineProbe = finalPage && requested < 1000;
      const fetchLimit = inlineProbe ? requested + 1 : requested;
      const page = await supaSelectMany(cfg, table, { ...(plainObject(params) || {}), offset:String(offset) }, {
        limit: fetchLimit,
        order,
      });

      rows.push(...page.slice(0, requested));
      if (page.length < requested) return { rows, truncated:false };

      if (finalPage) {
        if (inlineProbe) return { rows:rows.slice(0, cap), truncated:page.length > requested };
        const probe = await supaSelectMany(cfg, table, { ...(plainObject(params) || {}), offset:String(cap) }, {
          limit:1,
          order,
        });
        return { rows:rows.slice(0, cap), truncated:probe.length > 0 };
      }
    }

    return { rows:rows.slice(0, cap), truncated:false };
  }

  async function supaUpsert(cfg, table, rows, onConflict) {
    const tableName = nonEmptyText(table);
    const url = restUrl(cfg, tableName);
    const conflict = nonEmptyText(onConflict);
    if (conflict) url.searchParams.set('on_conflict', conflict);
    const encoded=JSON.stringify(Array.isArray(rows)?rows:[rows]);
    const legacy=async(budget=7000,signal,representation=false)=>{
      const response=await supaWriteFetch(url,{
        method:'POST',headers:supaHeaders(cfg,{Prefer:`resolution=merge-duplicates,return=${representation?'representation':'minimal'}`}),body:encoded,
      },budget,`Supabase ${tableName}`,cfg,!signal,signal,representation);
      if(!response.ok){
        const text=await response.text().catch(()=>''),detail=safeRedact(text,180);
        const error=new Error(`Supabase ${tableName}: HTTP ${response.status}${detail?' — '+detail:''}`);
        error.httpStatus=response.status;throw error;
      }
      if(representation)return responseArray(JSON.parse(await response.text()),tableName);
    };
    const cacheRow=Array.isArray(rows)?rows.length===1?plainObject(rows[0]):null:plainObject(rows);
    const fields=['cache_key','fixture_id','payload','expires_at','provider','source_updated_at','freshness_status','updated_at'];
    if(tableName!=='analysis_cache'||conflict!=='cache_key'||!cacheRow||!fields.every(key=>Object.hasOwn(cacheRow,key)))return legacy();
    const matches=(row,body)=>fields.every(key=>['updated_at','expires_at','source_updated_at'].includes(key)
          ? row[key]===null&&body['p_'+key]===null || Number.isFinite(Date.parse(row[key]))&&Date.parse(row[key])===Date.parse(body['p_'+key])
          : key==='payload'?jsonEqual(row[key],body.p_payload):row[key]===body['p_'+key]);
    const args=Object.fromEntries(fields.map(key=>['p_'+key,cacheRow[key]]));
    const result=await durableRpc(cfg,'write_analysis_cache_versioned',args,7000,{}, {
      validate:value=>{
        if(!plainObject(value)||typeof value.stored!=='boolean'
          || !['stored','same','superseded','expired','legacy'].includes(value.reason)){
          throw Object.assign(new Error('Supabase cache write rejected.'),{code:'SUPABASE_CACHE_INVALID'});
        }
      },
      legacy:async(_connection,body,remaining,signal)=>{
        const records=await legacy(remaining,signal,true);
        if(records.length===0)return {stored:false,reason:'superseded'};
        if(records.length!==1||!matches(records[0],body))throw Object.assign(new Error('Supabase cache write unconfirmed.'),{code:'SUPABASE_CACHE_INVALID'});
        return {stored:true,reason:'legacy'};
      },
      confirm:async(connection,body,remaining,signal)=>{
        const records=await supaSelectMany(connection,'analysis_cache',{cache_key:`eq.${body.p_cache_key}`},
          {limit:1,select:fields.join(','),timeoutMs:remaining,signal});
        const row=records[0];
        if(!row)return null;
        if(matches(row,body))return {stored:true,reason:'same'};
        if(Date.parse(row.updated_at)>=Date.parse(body.p_updated_at))return {stored:false,reason:'superseded'};
        return null;
      },
    });
    return result.stored;
  }

  async function supaInsertIgnore(cfg, table, rows, onConflict) {
    const tableName = nonEmptyText(table);
    const url = restUrl(cfg, tableName);
    const conflict = nonEmptyText(onConflict);
    if (conflict) url.searchParams.set('on_conflict', conflict);
    const response = await supaWriteFetch(url, {
      method: 'POST',
      headers: supaHeaders(cfg, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    }, 7000, `Supabase ${tableName}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = safeRedact(text, 180);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
  }

  async function supaPatch(cfg, table, filters, patch) {
    const tableName = nonEmptyText(table);
    const filterEntries = queryEntries(filters, tableName);
    if (!filterEntries.length) throw new TypeError(`Supabase ${tableName}: PATCH requires at least one filter.`);
    const url = restUrl(cfg, tableName);
    for (const [key, value] of filterEntries) url.searchParams.set(key, value);
    const response = await supaWriteFetch(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify(patch || {}),
    }, 7000, `Supabase ${tableName}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = safeRedact(text, 180);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
  }

  async function supaDelete(cfg, table, filters = {}) {
    const tableName = nonEmptyText(table);
    const filterEntries = queryEntries(filters, tableName);
    if (!filterEntries.length) throw new TypeError(`Supabase ${tableName}: DELETE requires at least one filter.`);
    const url = restUrl(cfg, tableName);
    for (const [key, value] of filterEntries) url.searchParams.set(key, value);
    const response = await supaWriteFetch(url, {
      method: 'DELETE',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    }, 7000, `Supabase ${tableName}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = safeRedact(text, 180);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
  }

  const rateClaims=createRpcAdmissionQueue({onEvent:bumpTelemetry});

  async function rawRpc(cfg, functionName, payload = {}, timeoutMs = 7000, extraHeaders = {}, signal = undefined) {
    const rpcName = nonEmptyText(functionName);
    const url = restUrl(cfg, rpcName, { rpc:true });
    const budget = boundedInteger(timeoutMs, 7000, 500, 120000);
    const deadline = now() + budget;
    const controller = new AbortController();
    const rpcSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timeoutError = Object.assign(new Error(`Supabase RPC ${rpcName}: response deadline exceeded.`), {
      code: 'UPSTREAM_TIMEOUT', source: `Supabase RPC ${rpcName}`,
    });
    const checkDeadline = () => {
      if (now() >= deadline || rpcSignal.aborted) throw rpcSignal.reason || timeoutError;
    };
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(timeoutError);
        try { controller.abort(timeoutError); } catch {}
      }, budget);
    });
    // The transport helper ends its timer at headers. Keep one absolute RPC
    // deadline through body parsing, even if a transport ignores cancellation.
    const operation = (async () => {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: supaRpcHeaders(cfg, extraHeaders),
        body: JSON.stringify(payload || {}),
        signal: rpcSignal,
      }, budget, `Supabase RPC ${rpcName}`);
      try{checkDeadline();}catch(error){try{Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}throw error;}
      const body = await response.json().catch(() => null);
      checkDeadline();
      if (!response.ok) {
        const message = typeof body?.message === 'string' ? safeRedact(body.message, 180) : '';
        const error = new Error(`Supabase RPC ${rpcName}: HTTP ${response.status}${message ? ` — ${message}` : ''}`);
        error.code = typeof body?.code === 'string' && body.code.trim()
          ? body.code.trim()
          : `HTTP_${response.status}`;
        error.detail = body?.details ?? null;
        error.transientSecretAuth=isTransientSecretReadAuthResponse(response,cfg);
        throw error;
      }
      return Array.isArray(body) && body.length === 1 ? body[0] : body;
    })();
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  const durableRpc=createDurableRpcOperation(rawRpc,{now});

  async function claimOwnedRpc(cfg,payload,timeoutMs,extraHeaders){
    const owner=crypto.randomUUID();
    return durableRpc(cfg,'claim_scheduled_job_owned',{...payload,p_owner_token:owner},boundedInteger(timeoutMs,7000,500,120000),extraHeaders,{
      validate:result=>{
        if(!plainObject(result)||typeof result.claimed!=='boolean'
          || result.claimed===true&&result.leaseToken!==owner){
          throw Object.assign(new Error('Scheduled owner confirmation mismatch.'),{code:'SUPABASE_OWNER_MISMATCH'});
        }
      },
      legacy:(connection,body,remaining,signal)=>{
        const {p_owner_token,...args}=body;
        return rawRpc(connection,'claim_scheduled_job',args,remaining,extraHeaders,signal);
      },
      confirm:async(connection,body,remaining,signal)=>{
        const rows=await supaSelectMany(connection,'scheduled_job_leases',{job_key:`eq.${body.p_job_key}`},
          {limit:1,select:'job_key,group_key,scheduled_at,lease_token,status,locked_until',timeoutMs:remaining,signal});
        const row=rows[0];
        if(row?.status!=='running'||row.lease_token!==owner||row.job_key!==body.p_job_key
          ||row.group_key!==body.p_group_key||Date.parse(row.scheduled_at)!==Date.parse(body.p_scheduled_at)
          ||!(Date.parse(row.locked_until)>Date.now()+3000))return null;
        return {claimed:true,reason:'ownership_confirmed',jobKey:row.job_key,groupKey:row.group_key,
          scheduledAt:row.scheduled_at,lockedUntil:row.locked_until,leaseToken:owner};
      },
    });
  }

  function supaRpc(cfg, functionName, payload = {}, timeoutMs = 7000, extraHeaders = {}, callerSignal) {
    if(functionName==='claim_scheduled_job')return claimOwnedRpc(cfg,payload,timeoutMs,extraHeaders);
    const bucket=payload?.p_bucket_key;
    if(functionName==='claim_provider_request' && typeof bucket==='string' && /^(preauth:|route:)/.test(bucket)
      && typeof cfg?.supabaseUrl==='string' && cfg.supabaseUrl && typeof cfg?.supabaseKey==='string' && cfg.supabaseKey){
      const connection={...cfg};
      const snapshot={...payload};
      const headers={...extraHeaders};
      return rateClaims(JSON.stringify([connection.supabaseUrl,connection.supabaseKey]),
        (remaining,signal)=>rawRpc(connection,functionName,snapshot,remaining,headers,signal),boundedInteger(timeoutMs,7000,500,120000),bucket);
    }
    return rawRpc(cfg,functionName,payload,timeoutMs,extraHeaders,callerSignal);
  }

  return {
    hasSupabase,
    supaHeaders,
    supaSelectOne,
    supaSelectMany,
    supaSelectPaged,
    supaUpsert,
    supaInsertIgnore,
    supaPatch,
    supaDelete,
    supaRpc,
  };
}
