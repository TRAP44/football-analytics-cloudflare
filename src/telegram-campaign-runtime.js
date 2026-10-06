export function createTelegramCampaignRuntime(deps = {}) {
  const {
    cleanLaunchPart
  } = deps;

  function telegramStartPayload(text = '') {
    const match=String(text || '').match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?/i);
    return String(match?.[1] || '').slice(0,64);
  }
  
  function buildMediaCampaignPerformance(rows = []) {
    const map=new Map();
    for (const row of rows || []) {
      const event=String(row?.event_name || '');
      const source=cleanLaunchPart(row?.source || 'telegram',32) || 'telegram';
      const campaign=cleanLaunchPart(row?.campaign || 'direct',40) || 'direct';
      const content=cleanLaunchPart(row?.content || '',48);
      const mediaRelevant=Boolean(content)
        || ['media_link_created','share_created','share_link_created','share_card_created'].includes(event)
        || event==='fixture_deep_link_open'
        || ['media','press','partner','social'].includes(source);
      if (!mediaRelevant) continue;
      const key=`${source}|${campaign}|${content || 'default'}`;
      const bucket=map.get(key) || {
        source,campaign,content:content || 'default',
        users:new Set(),entries:new Set(),matchOpens:new Set(),quickAi:new Set(),fullAi:new Set(),
        deepLinkOpens:0,linksCreated:0,events:0,
      };
      const uid=Number(row?.telegram_id || 0);
      if (uid) bucket.users.add(uid);
      if (uid && ['bot_start','miniapp_open'].includes(event)) bucket.entries.add(uid);
      if (uid && event==='match_open') bucket.matchOpens.add(uid);
      if (uid && event==='quick_ai') bucket.quickAi.add(uid);
      if (uid && event==='full_ai') bucket.fullAi.add(uid);
      if (event==='fixture_deep_link_open') bucket.deepLinkOpens+=1;
      if (['media_link_created','share_created','share_link_created','share_card_created'].includes(event)) bucket.linksCreated+=1;
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
    })).sort((a,b)=>b.entries-a.entries || b.fullAi-a.fullAi || b.linksCreated-a.linksCreated || b.events-a.events).slice(0,30);
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

  return {
    telegramStartPayload,
    buildMediaCampaignPerformance,
    mediaCampaignControlDrill
  };
}
