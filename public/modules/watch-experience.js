const KEY='matchradar:watch-mode:v1',LIFETIME=3*3600000;
export function createWatchExperience({api,window:win=window,document:doc=document,onReturn=()=>{}}={}){
  let mode=null,pending=false,confirmed=false,error='',target=0,sequence=0;
  try{const saved=JSON.parse(win.localStorage.getItem(KEY)||'null');if(saved&&Number.isSafeInteger(saved.fixtureId)&&saved.fixtureId>0&&Date.parse(saved.expiresAt)>Date.now()&&[0,30,60,90].includes(saved.delaySeconds))mode=saved;}catch{}
  const banner=doc.createElement('aside');banner.id='watchPrivacyBanner';banner.className='panel watch-privacy-banner';banner.setAttribute('aria-live','polite');
  (doc.querySelector('main')||doc.body).before(banner);
  function apply(){
    const enabled=Boolean(mode);
    doc.body.classList.toggle('watch-private',enabled);
    const analysis=doc.getElementById('analysis');if(analysis){analysis.inert=enabled;analysis.setAttribute('aria-hidden',String(enabled));}
    banner.hidden=!enabled;
    if(!enabled){banner.replaceChildren();doc.dispatchEvent(new Event('watchprivacychange'));return;}
    if(Date.parse(mode.expiresAt)<=Date.now()){confirmed=false;error='Срок защиты уведомлений истёк. Продлите режим кнопкой «Применить». Данные остаются скрыты.';}
    banner.innerHTML='<strong>Без спойлеров</strong><span data-privacy-state></span><div><button type="button" data-privacy-return>К просмотру</button><button type="button" data-privacy-off>Показать данные матчей</button></div>';
    banner.querySelector('[data-privacy-state]').textContent=pending?'Сохраняем защиту уведомлений…':error|| (confirmed?'Счёт, события и AI скрыты. Защита уведомлений включена на 3 часа.':'Данные скрыты. Подтверждаем защиту уведомлений…');
    banner.querySelector('[data-privacy-return]').onclick=()=>onReturn(mode.fixtureId);
    banner.querySelector('[data-privacy-off]').disabled=pending;
    banner.querySelector('[data-privacy-off]').onclick=()=>void setMode(target||mode.fixtureId,false,0);
    doc.dispatchEvent(new Event('watchprivacychange'));
  }
  function persist(){try{mode?win.localStorage.setItem(KEY,JSON.stringify(mode)):win.localStorage.removeItem(KEY);}catch{}}
  async function setMode(fixtureId,enabled,delaySeconds=0){
    if(pending||!Number.isSafeInteger(fixtureId)||fixtureId<=0||![0,30,60,90].includes(delaySeconds))return false;
    sequence++;pending=true;error='';confirmed=false;
    if(enabled){const now=Date.now();mode={fixtureId,delaySeconds,startedAt:new Date(now).toISOString(),expiresAt:new Date(now+LIFETIME).toISOString()};persist();}apply();
    try{
      const data=await api('/api/preferences',{method:'POST',body:JSON.stringify({watchSession:enabled?{fixtureId,delaySeconds}:null})});
      const saved=data?.watchSession;
      if(enabled&&(!saved||saved.fixtureId!==fixtureId||Date.parse(saved.expiresAt)<=Date.now()))throw Error('WATCH_NOT_CONFIRMED');
      mode=enabled?saved:null;confirmed=true;persist();return true;
    }catch{error='Данные скрыты, но защиту уведомлений подтвердить не удалось. Повторите включение в блоке «Где смотреть».';return false;}
    finally{pending=false;apply();if(mode&&target>0&&mode.fixtureId!==target)void setMode(target,true,mode.delaySeconds);}
  }
  function prepare(fixtureId){target=Number(fixtureId)||0;apply();if(mode&&target>0&&mode.fixtureId!==target&&!pending)void setMode(target,true,mode.delaySeconds);}
  function settings(){return {enabled:Boolean(mode),pending,delaySeconds:mode?.delaySeconds||0,confirmed,error,fixtureId:mode?.fixtureId||0};}
  apply();
  win.setInterval(()=>{if(mode)apply();},30000);
  if(mode){const version=sequence;void api('/api/preferences').then(data=>{
    if(version!==sequence||!mode)return;
    const saved=data?.watchSession;
    confirmed=Boolean(saved&&Number.isSafeInteger(saved.fixtureId)&&saved.fixtureId>0&&[0,30,60,90].includes(saved.delaySeconds)&&Date.parse(saved.expiresAt)>Date.now()&&Date.parse(saved.startedAt)<=Date.now()+5000);
    if(confirmed){mode=saved;persist();error='';}
    else error='Данные скрыты. Подтвердите защиту уведомлений кнопкой «Применить».';
    apply();if(confirmed&&target>0&&mode.fixtureId!==target)void setMode(target,true,mode.delaySeconds);
  }).catch(()=>{if(version!==sequence)return;error='Данные скрыты. Защита уведомлений пока не подтверждена.';apply();});}

  return {prepare,settings,setMode};
}
