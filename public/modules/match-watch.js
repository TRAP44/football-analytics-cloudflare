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
export function createMatchWatch({api,escapeHtml,window:win=window,document:doc=document}={}){
  let session=null;
  const storedCountry=()=>{try{return win.localStorage.getItem(COUNTRY_KEY)||'';}catch{return '';}};
  const saveCountry=country=>{try{win.localStorage.setItem(COUNTRY_KEY,country);}catch{}};
  const active=s=>session===s&&s.root.isConnected&&s.isCurrent();
  function stopPlayer(s){s.player?.destroy?.();s.player=null;s.root.querySelector('[data-watch-player]')?.replaceChildren();}
  function dispose(){if(!session)return;session.controller?.abort();win.clearTimeout(session.timer);stopPlayer(session);session.root.hidden=true;session.root.replaceChildren();session=null;}
  function render(s,data){
    if(!active(s))return;
    stopPlayer(s);win.clearTimeout(s.timer);
    const countries=Array.isArray(data?.countries)?data.countries.filter(item=>/^[A-Z]{2}$/.test(item?.code)&&typeof item.name==='string'):[];
    const items=Array.isArray(data?.items)?data.items.filter(item=>Date.parse(item?.expiresAt)>Date.now()).slice(0,10):[];
    if(!countries.length){s.root.hidden=true;s.root.replaceChildren();return;}
    const country=countries.some(item=>item.code===s.country)?s.country:'';
    s.root.hidden=false;
    s.root.innerHTML=`<details class="match-watch-details" ${s.open?'open':''}><summary>Где смотреть <span>Официальные источники</span></summary>
      <div class="match-watch-body"><label>Где будете смотреть? <select data-watch-country aria-label="Страна просмотра"><option value="">Выберите страну</option>${countries.map(item=>`<option value="${item.code}" ${item.code===country?'selected':''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
      <div data-watch-options>${country?items.length?items.map((item,index)=>`<article class="match-watch-source"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.kind==='live'?'Трансляция':item.kind==='replay'?'Полная запись':'Обзор')} · ${escapeHtml(({free:'Бесплатно',subscription:'По подписке',ppv:'Отдельная покупка',unknown:'Условия у источника'})[item.access]||'Условия у источника')}</span>
      ${youtubeEmbedUrl(item,win.location.origin)?`<button class="primary-btn" type="button" data-watch-play="${index}">Смотреть в приложении</button>`:''}
      <a href="${escapeHtml(item.eventUrl)}" target="_blank" rel="noopener noreferrer">${item.embed?'Открыть у источника ↗':'Смотреть у источника ↗'}</a></article>`).join(''):'<p>Для этой страны просмотр сейчас не подтверждён.</p>':'<p>Выберите страну — покажем доступный вариант.</p>'}</div>
      <div data-watch-player></div><p class="muted" data-watch-status role="status">Доступ и подписку проверяет источник. Если плеер не открылся, перейдите по официальной ссылке.</p></div></details>`;
    s.root.querySelector('details').addEventListener('toggle',event=>{s.open=event.target.open;});
    s.root.querySelector('[data-watch-country]').onchange=event=>{stopPlayer(s);win.clearTimeout(s.timer);s.root.querySelector('[data-watch-options]').textContent='Проверяем доступность…';s.country=event.target.value;saveCountry(s.country);s.open=true;void load(s);};
    s.root.querySelectorAll('[data-watch-play]').forEach(button=>{button.onclick=()=>void play(s,items[Number(button.dataset.watchPlay)]);});
    const expiry=Math.min(...items.map(item=>Date.parse(item.expiresAt)));
    if(Number.isFinite(expiry))s.timer=win.setTimeout(()=>{
      if(!active(s))return;stopPlayer(s);
      s.root.querySelector('[data-watch-options]').innerHTML='<p>Проверяем доступность заново…</p>';void load(s);
    },Math.max(1,expiry-Date.now()));
  }
  async function load(s){
    s.loadedAt=Date.now();s.controller?.abort();const controller=new AbortController();s.controller=controller;
    try{const data=await api(`/api/match-watch?${new URLSearchParams({fixtureId:String(s.fixtureId),...(s.country?{country:s.country}:{})})}`,{signal:controller.signal,timeoutMs:4000});
      if(!controller.signal.aborted)render(s,data);
    }catch{if(active(s)&&!controller.signal.aborted){stopPlayer(s);s.root.hidden=true;s.root.replaceChildren();}}
  }
  async function play(s,item){
    if(!active(s)||Date.parse(item?.expiresAt)<=Date.now())return;
    stopPlayer(s);
    const source=youtubeEmbedUrl(item,win.location.origin);if(!source)return;
    const target=s.root.querySelector('[data-watch-player]'),status=s.root.querySelector('[data-watch-status]');
    const iframe=doc.createElement('iframe');iframe.title='Официальный плеер YouTube';iframe.referrerPolicy='strict-origin-when-cross-origin';iframe.allow='encrypted-media; picture-in-picture; fullscreen';iframe.allowFullscreen=true;iframe.src=source;
    target.append(iframe);status.textContent='Если видео недоступно, откройте официальный источник по ссылке выше.';
    try{const YT=await youtubeSdk(win,doc);if(!active(s)||!iframe.isConnected)return;
      s.player=new YT.Player(iframe,{events:{onError:()=>{if(active(s)&&iframe.isConnected){stopPlayer(s);status.textContent='Источник не разрешил просмотр здесь. Откройте официальную ссылку выше.';}}}});
    }catch{if(active(s))status.textContent='Плеер может быть недоступен в Telegram. Официальная ссылка — выше.';}
  }
  function mount({root,fixtureId,isCurrent=()=>true}={}){
    if(!root||!Number.isSafeInteger(fixtureId)||fixtureId<=0)return;
    if(session?.fixtureId===fixtureId&&session.root===root){session.isCurrent=isCurrent;if(!session.player && !session.root.querySelector('iframe') && Date.now()-(session.loadedAt||0)>60000)void load(session);return;}
    dispose();const s={root,fixtureId,isCurrent,country:storedCountry(),open:new URL(win.location.href).searchParams.get('watch')==='1',player:null,timer:null,controller:null};session=s;
    s.root.dataset.fixture=String(fixtureId);void load(s);
  }
  return {mount,dispose};
}
