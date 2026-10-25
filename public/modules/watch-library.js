// Optional home library. No requests, player or third-party assets until opened.
const COUNTRY_KEY='matchradar:watch-country:v1';
const labels={live:'Трансляция',highlights:'Обзор',replay:'Полная запись'};
export function createWatchLibrary({root,api,escapeHtml,onOpen,now=Date.now,window:win=window,document:doc=document,isVisible=()=>true}={}){
  let country='',controller,sequence=0,refreshTimer,expiryTimer,loadedAt=0,items=[],opening=false,loading=false,countriesAvailable=false,intent=0;
  try{country=win.localStorage.getItem(COUNTRY_KEY)||'';if(!/^[A-Z]{2}$/.test(country))country='';}catch{}
  const body=root.querySelector('[data-watch-library-body]');
  const active=()=>root.isConnected&&root.open&&isVisible()&&doc.visibilityState!=='hidden';
  const date=value=>{try{return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value))+' МСК';}catch{return '';}};
  function pause(){if(loading)loadedAt=0;intent++;sequence++;controller?.abort();win.clearTimeout(refreshTimer);win.clearTimeout(expiryTimer);loading=false;}
  function armExpiry(){
    win.clearTimeout(expiryTimer);if(!active())return;
    const expiry=Math.min(...items.map(item=>Date.parse(item.expiresAt)));
    if(Number.isFinite(expiry))expiryTimer=win.setTimeout(()=>{if(active()){renderCards();armExpiry();}},Math.max(1,expiry-now()));
  }
  function schedule(){
    win.clearTimeout(refreshTimer);if(!active())return;armExpiry();
    refreshTimer=win.setTimeout(()=>{if(active())void load();},60000);
  }
  function renderCards(){
    const list=body.querySelector('[data-watch-library-list]');if(!list)return;
    items=items.filter(item=>Date.parse(item.expiresAt)>now());const current=items;
    list.innerHTML=!countriesAvailable?'<p class="muted">Доступность источников пока не подтверждена. Попробуйте обновить список позже.</p>':!country?'<p class="muted">Выберите страну — покажем доступные матчи.</p>':current.length?current.map((item,index)=>`<article class="watch-library-card"><small>${escapeHtml(item.league)} · ${escapeHtml(date(item.date))}</small><strong>${escapeHtml(item.home)} — ${escapeHtml(item.away)}</strong><span>${item.kinds.map(kind=>escapeHtml(labels[kind])).join(' · ')}</span><button type="button" class="primary-btn" data-watch-library-open="${index}" data-watch-without-spoilers>Смотреть без спойлеров</button><button type="button" class="secondary-btn" data-watch-library-open="${index}">Открыть матч →</button></article>`).join(''):'<p class="muted">Подтверждённых вариантов для этой страны пока нет. Список обновляется автоматически.</p>';
    list.querySelectorAll('[data-watch-library-open]').forEach(button=>{button.onclick=async()=>{
      const item=current[Number(button.dataset.watchLibraryOpen)];if(opening||!active()||Date.parse(item?.expiresAt)<=now())return;
      opening=true;button.disabled=true;const version=++intent,isCurrent=()=>active()&&version===intent;
      try{await onOpen(item.fixtureId,button,isCurrent,{withoutSpoilers:button.hasAttribute('data-watch-without-spoilers')});}catch{if(active())body.querySelector('[data-watch-library-state]').textContent='Не удалось открыть матч. Попробуйте ещё раз.';}
      finally{opening=false;if(button.isConnected)button.disabled=false;}
    };});
  }
  function render(data){
    const countries=Array.isArray(data?.countries)?data.countries.filter(item=>/^[A-Z]{2}$/.test(item?.code)&&typeof item.name==='string'):[];
    countriesAvailable=countries.length>0;
    items=data?.country===country&&Array.isArray(data?.items)?data.items.filter(item=>Number.isSafeInteger(item?.fixtureId)&&item.fixtureId>0&&typeof item.home==='string'&&typeof item.away==='string'&&Array.isArray(item.kinds)&&item.kinds.length>0&&item.kinds.every(kind=>Object.hasOwn(labels,kind))&&Date.parse(item.expiresAt)>now()).slice(0,20):[];
    body.innerHTML=`${countriesAvailable?`<label>Страна просмотра <select data-watch-library-country aria-label="Страна просмотра видео"><option value="">Выберите страну</option>${countries.map(item=>`<option value="${item.code}" ${item.code===country?'selected':''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>`:''}<p class="muted watch-library-hint">«Без спойлеров» скроет счёт и события до открытия матча, а также приостановит его уведомления на 3 часа.</p><div class="watch-library-list" data-watch-library-list></div><p class="muted" data-watch-library-state role="status"></p><button class="secondary-btn" type="button" data-watch-library-refresh>Обновить список</button>`;
    const selector=body.querySelector('[data-watch-library-country]');if(selector)selector.onchange=event=>{intent++;country=event.target.value;try{win.localStorage.setItem(COUNTRY_KEY,country);}catch{}items=[];renderCards();void load();};
    body.querySelector('[data-watch-library-refresh]').onclick=()=>void load();renderCards();schedule();
  }
  async function load(){
    if(!active())return;
    const request=++sequence;controller?.abort();controller=new AbortController();const signal=controller.signal;loading=true;win.clearTimeout(refreshTimer);armExpiry();
    const status=body.querySelector('[data-watch-library-state]');if(status)status.textContent='Обновляем список…';else body.textContent='Загружаем доступные матчи…';
    try{
      const data=await api('/api/match-watch?'+new URLSearchParams({list:'1',...(country?{country}:{})}),{signal,timeoutMs:4000});
      if(request!==sequence||signal.aborted||!active())return;loadedAt=now();render(data);
    }catch{
      if(request!==sequence||signal.aborted||!active())return;
      renderCards();const message=body.querySelector('[data-watch-library-state]');
      if(message)message.textContent='Список временно недоступен. Повторите обновление.';
      else{body.innerHTML='<p role="status">Список временно недоступен.</p><button type="button" class="secondary-btn" data-watch-library-retry>Попробовать снова</button>';body.querySelector('[data-watch-library-retry]').onclick=()=>void load();}
      schedule();
    }finally{if(request===sequence)loading=false;}
  }
  function resume(){if(!active()||loading)return;try{const raw=win.localStorage.getItem(COUNTRY_KEY)||'',saved=/^[A-Z]{2}$/.test(raw)?raw:'';if(saved!==country){country=saved;loadedAt=0;items=[];}}catch{}if(!loadedAt||now()-loadedAt>=60000)void load();else{renderCards();schedule();}}
  root.addEventListener('toggle',()=>{root.open?resume():pause();});
  win.addEventListener?.('pageshow',resume);
  doc.addEventListener?.('visibilitychange',()=>{doc.visibilityState==='hidden'?pause():resume();});
  return {resume,pause};
}
