const MEDIA_LINK_EVENTS = new Set([
  'media_link_created',
  'share_created',
  'share_link_created',
  'share_card_created',
]);
const MEDIA_SOURCES = new Set(['media','press','partner','social']);
const ENTRY_EVENTS = new Set(['bot_start','miniapp_open']);

export function createTelegramCampaignRuntime(deps = {}) {
  if (!deps || typeof deps!=='object' || Array.isArray(deps)) {
    throw new TypeError('Telegram campaign runtime dependencies are required.');
  }

  const {
    cleanLaunchPart
  } = deps;

  if (typeof cleanLaunchPart!=='function') {
    throw new TypeError('cleanLaunchPart is required');
  }

  function plainObject(value) {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  }

  function safeScalarText(value,max=120) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    try {
      return String(value)
        .replace(/[\u0000-\u001F\u007F]/g,' ')
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,max);
    } catch {
      return '';
    }
  }

  function positiveSafeInteger(value) {
    if (typeof value==='number') {
      return Number.isSafeInteger(value) && value>0 ? value : null;
    }
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) && number>0 ? number : null;
  }

  function eventName(value) {
    const event=safeScalarText(value,64).toLowerCase();
    return /^[a-z0-9_:-]+$/.test(event) ? event : '';
  }

  function cleanPart(value,max,fallback='') {
    const raw=safeScalarText(value,Math.max(max*4,128));
    if (!raw) return fallback;
    try {
      const cleaned=safeScalarText(cleanLaunchPart(raw,max),max).toLowerCase();
      return cleaned
        && cleaned.length<=max
        && /^[a-z0-9_-]+$/.test(cleaned)
        ? cleaned
        : fallback;
    } catch {
      return fallback;
    }
  }

  function telegramStartPayload(text = '') {
    if (typeof text!=='string') return '';
    const raw=text.trim();
    if (!raw || raw.length>160 || /[\u0000-\u001F\u007F]/.test(raw)) return '';
    const match=raw.match(
      /^\/start(?:@[A-Za-z0-9_]{1,64})?(?:[ \t]+([A-Za-z0-9_-]{1,64}))?$/i,
    );
    return match?.[1] || '';
  }
  
  function buildMediaCampaignPerformance(rows = []) {
    const map=new Map();
    const input=Array.isArray(rows) ? rows : [];
    for (const candidate of input) {
      const row=plainObject(candidate);
      if (!row) continue;

      const event=eventName(row.event_name);
      const source=cleanPart(row.source,32,'telegram');
      const campaign=cleanPart(row.campaign,40,'direct');
      const content=cleanPart(row.content,48,'');
      const mediaRelevant=Boolean(content)
        || MEDIA_LINK_EVENTS.has(event)
        || event==='fixture_deep_link_open'
        || MEDIA_SOURCES.has(source);
      if (!mediaRelevant) continue;

      const key=`${source}|${campaign}|${content || 'default'}`;
      const bucket=map.get(key) || {
        source,campaign,content:content || 'default',
        users:new Set(),entries:new Set(),matchOpens:new Set(),quickAi:new Set(),fullAi:new Set(),
        deepLinkOpens:0,linksCreated:0,events:0,
      };
      const uid=positiveSafeInteger(row.telegram_id);
      if (uid!==null) bucket.users.add(uid);
      if (uid!==null && ENTRY_EVENTS.has(event)) bucket.entries.add(uid);
      if (uid!==null && event==='match_open') bucket.matchOpens.add(uid);
      if (uid!==null && event==='quick_ai') bucket.quickAi.add(uid);
      if (uid!==null && event==='full_ai') bucket.fullAi.add(uid);
      if (event==='fixture_deep_link_open') bucket.deepLinkOpens+=1;
      if (MEDIA_LINK_EVENTS.has(event)) bucket.linksCreated+=1;
      bucket.events+=1;
      map.set(key,bucket);
    }
    return [...map.values()].map(x=>({
      source:x.source,
      campaign:x.campaign,
      content:x.content,
      users:x.users.size,
      entries:x.entries.size,
      matchOpens:x.matchOpens.size,
      quickAi:x.quickAi.size,
      fullAi:x.fullAi.size,
      deepLinkOpens:x.deepLinkOpens,
      linksCreated:x.linksCreated,
      events:x.events,
      matchOpenPct:x.entries.size ? Math.round((x.matchOpens.size/x.entries.size)*1000)/10 : 0,
      quickAiPct:x.entries.size ? Math.round((x.quickAi.size/x.entries.size)*1000)/10 : 0,
      fullAiConversionPct:x.entries.size ? Math.round((x.fullAi.size/x.entries.size)*1000)/10 : 0,
    })).sort((a,b)=>
      b.entries-a.entries
      || b.fullAi-a.fullAi
      || b.linksCreated-a.linksCreated
      || b.events-a.events
      || a.source.localeCompare(b.source)
      || a.campaign.localeCompare(b.campaign)
      || a.content.localeCompare(b.content)
    ).slice(0,30);
  }
  
  function mediaCampaignControlDrill() {
    const rows=[
      {telegram_id:1,event_name:'bot_start',source:'press',campaign:'ucl_launch',content:'article1'},
      {telegram_id:1,event_name:'fixture_deep_link_open',source:'press',campaign:'ucl_launch',content:'article1'},
      {telegram_id:1,event_name:'quick_ai',source:'press',campaign:'ucl_launch',content:'article1'},
      {telegram_id:1,event_name:'full_ai',source:'press',campaign:'ucl_launch',content:'article1'},
      {telegram_id:9,event_name:'media_link_created',source:'press',campaign:'ucl_launch',content:'article1'},
      {telegram_id:2,event_name:'bot_start',source:'press',campaign:'ucl_launch',content:'article2'},
    ];
    const result=buildMediaCampaignPerformance(rows);
    const article1=result.find(x=>x.content==='article1');
    const article2=result.find(x=>x.content==='article2');
    return {
      pass:result.length===2
        && article1?.entries===1
        && article1?.deepLinkOpens===1
        && article1?.quickAi===1
        && article1?.fullAi===1
        && article1?.linksCreated===1
        && article1?.fullAiConversionPct===100
        && article2?.entries===1,
      cases:8,
    };
  }

  return Object.freeze({
    telegramStartPayload,
    buildMediaCampaignPerformance,
    mediaCampaignControlDrill
  });
}
