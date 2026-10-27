import {broadcastGuideUrl,validBroadcastGuide} from './broadcast-guide-links.js?v=6.120.0-launch152';
// Optional, lazy watch panel. No video, SDK or third-party connection before play.
const COUNTRY_KEY='matchradar:watch-country:v1';
let sdkPromise;
export function youtubeEmbedUrl(item,origin){
  if(item?.provider!=='youtube'||item.embed!==true||!/^[A-Za-z0-9_-]{11}$/.test(item.videoId||''))return '';
  try{const url=new URL(item.eventUrl);if(url.href!==`https://www.youtube.com/watch?v=${item.videoId}`)return '';
    const parent=new URL(origin);if(!['https:','http:'].includes(parent.protocol))return '';
    return `https://www.youtube.com/embed/${item.videoId}?${new URLSearchParams({enablejsapi:'1',origin:parent.origin,playsinline:'1',autoplay:'0'})}`;
  }catch{return '';}
}
function youtubeSdk(win,doc){
  if(win.YT?.Player)return Promise.resolve(win.YT);
  if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
    let settled=false;const previous=win.onYouTubeIframeAPIReady;
    const timer=win.setTimeout(()=>finish(false),8000);
    function finish(ok){if(settled)return;settled=true;win.clearTimeout(timer);win.onYouTubeIframeAPIReady=previous;ok?resolve(win.YT):reject(new Error('PLAYER_UNAVAILABLE'));}
    win.onYouTubeIframeAPIReady=()=>{try{previous?.();}finally{finish(Boolean(win.YT?.Player));}};
    const script=doc.createElement('script');script.src='https://www.youtube.com/iframe_api';script.referrerPolicy='strict-origin-when-cross-origin';script.onerror=()=>finish(false);doc.head.append(script);
  }).catch(error=>{sdkPromise=null;throw error;});
  return sdkPromise;
}
export function createMatchWatch({api,escapeHtml,watchExperience,now=Date.now,window:win=window,document:doc=document}={}){
  let session=null;
  doc.addEventListener?.('watchprivacychange',()=>{
    if(!session)return;const settings=watchExperience?.settings(),checkbox=session.root.querySelector('[data-watch-private]'),select=session.root.querySelector('[data-watch-delay]');
    if(!settings?.enabled){session.privacyEdited=false;if(checkbox)checkbox.checked=false;if(select)select.value='0';}
    else if(!session.privacyEdited&&settings.confirmed){if(checkbox)checkbox.checked=true;if(select)select.value=String(settings.delaySeconds);}
  });
  const storedCountry=()=>{try{const value=win.localStorage.getItem(COUNTRY_KEY)||'';return /^[A-Z]{2}$/.test(value)?value:'';}catch{return '';}};
  const saveCountry=country=>{try{win.localStorage.setItem(COUNTRY_KEY,country);}catch{}};
  const active=s=>session===s&&s.root.isConnected&&s.isCurrent();
  const canRefreshEmpty=s=>active(s)&&s.open&&doc.visibilityState!=='hidden'&&s.data&&!s.failedRoot&&(!s.root.hidden||s.hadCatalogue);
  function stopPlayer(s){win.clearTimeout(s.playerReadyTimer);s.playerReadyTimer=null;savePosition(s);win.clearInterval(s.positionTimer);s.positionTimer=null;s.player?.destroy?.();s.player=null;s.item=null;s.root.querySelector('[data-watch-player]')?.replaceChildren();}
  function positionKey(s,item){return `matchradar:watch-position:${s.fixtureId}:${item.videoId}:v1`;}
  function savePosition(s){
    if(s.item?.kind!=='replay'||!s.player?.getCurrentTime)return;
    try{const seconds=Math.floor(s.player.getCurrentTime());if(Number.isFinite(seconds)&&seconds>=10&&seconds<4*3600000)win.localStorage.setItem(positionKey(s,s.item),JSON.stringify({seconds,at:Date.now()}));}catch{}
  }
  function position(s,item){try{const value=JSON.parse(win.localStorage.getItem(positionKey(s,item))||'null');return item.kind==='replay'&&value?.seconds>=10&&value.seconds<4*3600000&&Date.now()-value.at<7*86400000?Math.floor(value.seconds):0;}catch{return 0;}}
  function clearTimers(s){win.clearTimeout(s.refreshTimer);win.clearTimeout(s.expiryTimer);}
  function dispose(){if(!session)return;session.controller?.abort();clearTimers(session);stopPlayer(session);session.root.hidden=true;session.root.replaceChildren();session=null;}
  function schedule(s){
    clearTimers(s);if(!active(s))return;
    const expiry=Math.min(...s.items.map(item=>Date.parse(item.expiresAt)));
    if(Number.isFinite(expiry))s.expiryTimer=win.setTimeout(()=>{
      if(!active(s))return;
      // Expiry is independent of a slow refresh. Never extend an old permission
      // while waiting for a response, including a request that ignores abort.
      render(s,s.data);if(!s.loading)void load(s,true);
    },Math.max(1,expiry-now()));
    // A previously published source may hide this panel when withdrawn; keep
    // its existing bounded recovery while the previously open page is visible.
    const delay=Number.isFinite(expiry)?Math.min(60000,Math.max(15000,expiry-now()-15000)):canRefreshEmpty(s)?(s.hadCatalogue?30000:60000):0;
    if(delay)s.refreshTimer=win.setTimeout(()=>{if(active(s)&&!s.loading)void load(s,true);},delay);
  }
  function render(s,data){
    if(!active(s))return;
    if(s.failedRoot){s.root.replaceChildren();s.failedRoot=false;}
    const guide=validBroadcastGuide(data?.broadcastGuide,s.fixtureId,s.country,now());
    const videoCountries=Array.isArray(data?.countries)?data.countries.filter(item=>/^[A-Z]{2}$/.test(item?.code)&&typeof item.name==='string'):[];
    const countries=[...new Map([...videoCountries,...(guide?.countries||[])].map(item=>[item.code,item])).values()];
    const items=Array.isArray(data?.items)?data.items.filter(item=>Date.parse(item?.expiresAt)>now()).slice(0,10):[];
    s.data=data;s.items=items;s.hadCatalogue||=items.length>0;
    const privacy=watchExperience?.settings();
    const country=countries.some(item=>item.code===s.country)?s.country:'';
    const renewed=country&&s.item&&items.find(item=>youtubeEmbedUrl(item,win.location.origin)&&youtubeEmbedUrl(item,win.location.origin)===youtubeEmbedUrl(s.item,win.location.origin));
    const stopped=Boolean(s.item&&!renewed);if(stopped)stopPlayer(s);else if(renewed)s.item=renewed;
    if(!countries.length&&!privacy){s.root.hidden=true;s.root.replaceChildren();schedule(s);return;}
    s.root.hidden=false;
    const mounted=Boolean(s.root.querySelector('details'));
    if(!mounted)s.root.innerHTML=`<details class="match-watch-details" ${s.open?'open':''}><summary></summary>
      <div class="match-watch-body"><div data-watch-country-area></div>
      ${privacy?`<div class="watch-privacy-controls"><label><input type="checkbox" data-watch-private ${privacy.enabled?'checked':''}> Без спойлеров</label><label>Голевые уведомления <select data-watch-delay><option value="0">Не присылать во время просмотра</option><option value="30">Не раньше чем через 30 секунд</option><option value="60">Не раньше чем через 60 секунд</option><option value="90">Не раньше чем через 90 секунд</option></select></label><small>Счёт, события и AI скрываются. Остальные сообщения и табло этого матча приостанавливаются на 3 часа. Доставка голевых сообщений может быть позже выбранного времени.</small><button type="button" data-watch-privacy-save>Применить</button><p data-watch-privacy-state role="status"></p></div>`:''}
      <div data-watch-options></div><div data-broadcast-guide></div><div data-watch-player></div><p class="muted" data-watch-status role="status">Доступ и подписку проверяет источник. Если плеер не открылся, перейдите по официальной ссылке.</p></div></details>`;
    s.root.querySelector('summary').innerHTML=`${countries.length?'Где смотреть':'Режим просмотра'} <span>${guide?'Видео и вещатели':countries.length?'Официальные источники':'Без спойлеров'}</span>`;
    s.root.querySelector('[data-watch-country-area]').innerHTML=countries.length?`<label>Где будете смотреть? <select data-watch-country aria-label="Страна просмотра"><option value="">Выберите страну</option>${countries.map(item=>`<option value="${item.code}" ${item.code===country?'selected':''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>`:'';
    s.root.querySelector('[data-watch-options]').innerHTML=!countries.length?'Доступный источник видео пока не подтверждён. Режим без спойлеров можно включить и для просмотра на другом сервисе.':country?items.length?items.map((item,index)=>`<article class="match-watch-source"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.kind==='live'?'Трансляция':item.kind==='replay'?'Полная запись':'Обзор')} · ${escapeHtml(({free:'Бесплатно',subscription:'По подписке',ppv:'Отдельная покупка',unknown:'Условия у источника'})[item.access]||'Условия у источника')}</span>
      ${youtubeEmbedUrl(item,win.location.origin)?`<button class="primary-btn" type="button" data-watch-play="${index}">${position(s,item)?`Продолжить с ${Math.floor(position(s,item)/60)}:${String(position(s,item)%60).padStart(2,'0')}`:'Смотреть в приложении'}</button>${position(s,item)?`<button class="secondary-btn" type="button" data-watch-restart="${index}">Сначала</button>`:''}`:''}
      <a data-watch-external="${index}" href="${escapeHtml(item.eventUrl)}" target="_blank" rel="noopener noreferrer">${item.embed?'Открыть у источника ↗':'Смотреть у источника ↗'}</a></article>`).join(''):guide?' ':'<p>Для этой страны просмотр сейчас не подтверждён.</p>':'<p>Выберите страну — покажем доступный вариант.</p>';
    s.root.querySelector('[data-broadcast-guide]').innerHTML=guide?.directory?`<article class="match-watch-source broadcast-guide"><strong>${escapeHtml(guide.leagueName)} · где показывают</strong>
      <span>Вещатели турнира. Эфир матча и условия просмотра уточняйте у сервиса.</span>
      ${guide.providers.map(provider=>`<a data-broadcast-external href="${escapeHtml(provider.url)}" target="_blank" rel="noopener noreferrer">Открыть ${escapeHtml(provider.name)} ↗</a>`).join('')}
      <a data-broadcast-external href="${escapeHtml(guide.directory.url)}" target="_blank" rel="noopener noreferrer">Вещатели и расписание ↗</a></article>`:'';
    s.root.querySelectorAll('[data-broadcast-external]').forEach(link=>{link.onclick=event=>{
      const current=validBroadcastGuide(s.data?.broadcastGuide,s.fixtureId,s.country,now());
      const url=broadcastGuideUrl(link.getAttribute('href'));
      if(!active(s)||!current||!url||![current.directory?.url,...current.providers.map(item=>item.url)].includes(url)){event.preventDefault();if(active(s)&&s.data)render(s,s.data);return;}
      try{if(typeof win.Telegram?.WebApp?.openLink==='function'){win.Telegram.WebApp.openLink(url);event.preventDefault();}}catch{}
    };});
    s.root.querySelector('[data-watch-status]').hidden=Boolean(guide&&!items.length);
    if(stopped)s.root.querySelector('[data-watch-status]').textContent='Доступ к этому видео больше не подтверждён. Выберите доступный источник.';
    if(privacy&&!mounted){
      s.privacyEdited=false;
      s.root.querySelector('[data-watch-private]').onchange=()=>{s.privacyEdited=true;};
      s.root.querySelector('[data-watch-delay]').onchange=()=>{s.privacyEdited=true;};
      s.root.querySelector('[data-watch-delay]').value=String(privacy.delaySeconds);
      s.root.querySelector('[data-watch-privacy-save]').onclick=async()=>{
        const button=s.root.querySelector('[data-watch-privacy-save]');button.disabled=true;
        const ok=await watchExperience.setMode(s.fixtureId,s.root.querySelector('[data-watch-private]').checked,Number(s.root.querySelector('[data-watch-delay]').value));
        if(active(s)){button.disabled=false;if(ok)s.privacyEdited=false;s.root.querySelector('[data-watch-privacy-state]').textContent=ok?'Настройки просмотра сохранены.':'Данные скрыты, но настройка уведомлений не подтверждена. Повторите попытку.';}
      };
    }
    if(!mounted)s.root.querySelector('details').addEventListener('toggle',event=>{
      s.open=event.target.open;
      if(!s.items.length){
        if(!s.open)clearTimers(s);
        else if(!s.loading&&now()-(s.loadedAt||0)>=60000)void load(s,true);
        else schedule(s);
      }
    });
    const countrySelect=s.root.querySelector('[data-watch-country]');
    if(countrySelect)countrySelect.onchange=event=>{stopPlayer(s);clearTimers(s);s.data=null;s.items=[];s.root.querySelector('[data-watch-options]').textContent='Проверяем доступность…';s.root.querySelector('[data-broadcast-guide]')?.replaceChildren();s.country=event.target.value;saveCountry(s.country);s.open=true;void load(s);};
    s.root.querySelectorAll('[data-watch-play]').forEach(button=>{button.onclick=()=>void play(s,items[Number(button.dataset.watchPlay)]);});
    s.root.querySelectorAll('[data-watch-restart]').forEach(button=>{button.onclick=()=>void play(s,items[Number(button.dataset.watchRestart)],true);});
    s.root.querySelectorAll('[data-watch-external]').forEach(link=>{link.onclick=event=>{
      const item=items[Number(link.dataset.watchExternal)];
      if(!active(s)||!s.items.includes(item)||!(Date.parse(item?.expiresAt)>now())){event.preventDefault();return;}
      // Prefer Telegram's supported external navigation; a real anchor remains
      // available in other browsers or if the bridge rejects the call.
      try{if(typeof win.Telegram?.WebApp?.openLink==='function'){win.Telegram.WebApp.openLink(item.eventUrl);event.preventDefault();}}catch{}
    };});
    schedule(s);
  }
  function loadFailure(s,error){
    stopPlayer(s);clearTimers(s);s.items=[];s.root.hidden=false;s.failedRoot=true;
    if(error?.status===400 && error?.payload?.code==='WATCH_INPUT_INVALID') {s.country='';saveCountry('');}
    s.root.innerHTML='<details class="match-watch-details" open><summary>Где смотреть</summary><div class="match-watch-body"><p role="status">Не удалось проверить источники видео. Повторите попытку.</p><button class="secondary-btn" type="button" data-watch-retry>Повторить</button></div></details>';
    s.root.querySelector('[data-watch-retry]').onclick=event=>{event.currentTarget.disabled=true;event.currentTarget.textContent='Проверяем…';void load(s);};
  }
  async function load(s,background=false){
    s.loadedAt=now();s.controller?.abort();const controller=new AbortController();s.controller=controller;s.loading=true;
    try{const data=await api(`/api/match-watch?${new URLSearchParams({fixtureId:String(s.fixtureId),...(s.country?{country:s.country}:{})})}`,{signal:controller.signal,timeoutMs:4000});
      if(!controller.signal.aborted&&s.controller===controller)render(s,data);
    }catch(error){if(active(s)&&!controller.signal.aborted&&s.controller===controller){
      if(background&&s.data)render(s,s.data);
      else loadFailure(s,error);
    }}finally{if(active(s)&&s.controller===controller){s.loading=false;schedule(s);}}
  }
  async function play(s,item,fromStart=false){
    if(!active(s)||!s.items.includes(item)||!(Date.parse(item?.expiresAt)>now()))return;
    stopPlayer(s);
    let source=youtubeEmbedUrl(item,win.location.origin);if(!source)return;
    if(fromStart)try{win.localStorage.removeItem(positionKey(s,item));}catch{}
    const resume=fromStart?0:position(s,item);if(resume)source+='&start='+resume;s.item=item;
    const target=s.root.querySelector('[data-watch-player]'),status=s.root.querySelector('[data-watch-status]');
    const iframe=doc.createElement('iframe');iframe.title='Официальный плеер YouTube';iframe.referrerPolicy='strict-origin-when-cross-origin';iframe.allow='encrypted-media; picture-in-picture; fullscreen';iframe.allowFullscreen=true;iframe.src=source;
    target.append(iframe);status.textContent='Если видео недоступно, откройте официальный источник по ссылке выше.';
    const failed=message=>{if(active(s)&&iframe.isConnected){stopPlayer(s);status.textContent=message;}};
    s.playerReadyTimer=win.setTimeout(()=>failed('Плеер не загрузился. Откройте официальный источник по ссылке выше.'),15000);
    try{const YT=await youtubeSdk(win,doc);if(!active(s)||!iframe.isConnected)return;if(!(Date.parse(s.item?.expiresAt)>now())){stopPlayer(s);return;}
      s.player=new YT.Player(iframe,{events:{onReady:()=>{if(active(s)&&iframe.isConnected){win.clearTimeout(s.playerReadyTimer);s.playerReadyTimer=null;s.positionTimer=win.setInterval(()=>savePosition(s),5000);}},onError:event=>failed([101,150].includes(event?.data)?'Источник не разрешил просмотр здесь. Откройте официальную ссылку выше.':'Встроенный плеер недоступен. Откройте официальный источник по ссылке выше.')}});
    }catch{failed('Плеер не загрузился. Откройте официальный источник по ссылке выше.');}
  }
  win.addEventListener?.('pagehide',()=>{if(session){savePosition(session);if(!session.items.length)clearTimers(session);}});
  const resume=()=>{const s=session;if(!s||!active(s)||!s.data)return;render(s,s.data);if(!s.items.length&&!canRefreshEmpty(s))return;if(!s.loading&&now()-s.loadedAt>=60000)void load(s,true);};
  doc.addEventListener?.('visibilitychange',()=>{
    if(doc.visibilityState==='visible')resume();
    else if(session&&!session.items.length)clearTimers(session);
  });
  win.addEventListener?.('pageshow',resume);
  function mount({root,fixtureId,isCurrent=()=>true,open=false}={}){
    if(!root||!Number.isSafeInteger(fixtureId)||fixtureId<=0)return;
    if(session?.fixtureId===fixtureId&&session.root===root){session.isCurrent=isCurrent;if(open){session.open=true;const details=root.querySelector('details');if(details)details.open=true;}if(!session.loading&&(session.items.length||canRefreshEmpty(session))&&now()-(session.loadedAt||0)>60000)void load(session,true);return;}
    dispose();const s={root,fixtureId,isCurrent,country:storedCountry(),open:open||new URL(win.location.href).searchParams.get('watch')==='1',player:null,items:[],controller:null};session=s;
    s.root.dataset.fixture=String(fixtureId);void load(s);
  }
  return {mount,dispose};
}
