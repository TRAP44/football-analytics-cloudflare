const text=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,180):'';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const phases=['upcoming','live','finished'];
const labels=['До игры','LIVE','Итог'];
const interruptions={PST:'Матч перенесён',CANC:'Матч отменён',ABD:'Матч прерван',SUSP:'Матч приостановлен',INT:'Матч приостановлен'};
function trusted(data,key) {
  const meta=data?.dataFreshness?.[key];
  return data?.availability?.[key]===true && meta?.confidenceBearing===true
    && meta.stale!==true && meta.provenanceState==='verified';
}
export function deriveMatchHeadquarters(data={}) {
  const mode=phases.includes(data?.mode)?data.mode:'unknown';
  const interruption=Object.hasOwn(interruptions,data?.match?.status)?interruptions[data.match.status]:'';
  const phase=interruption?-1:phases.indexOf(mode);
  const events=trusted(data,'events') && Array.isArray(data.events)?data.events:[];
  const latest=events.at(-1);
  const stats=trusted(data,'statistics') && Array.isArray(data?.statistics?.items)?data.statistics.items:[];
  const shots=stats.find(row=>row?.key==='Shots on Goal');
  const number=value=>typeof value==='number' && Number.isSafeInteger(value) && value>=0?value:
    typeof value==='string' && /^\d{1,3}$/.test(value)?Number(value):null;
  const home=number(shots?.home),away=number(shots?.away);
  const hasShots=home!==null && away!==null;
  const confirmed=data?.availability?.lineupsConfirmed===true && trusted(data,'lineups');
  const generatedAt=typeof data?.generatedAt==='string' && Number.isFinite(Date.parse(data.generatedAt))?data.generatedAt:null;
  const cards=[
    {label:interruption?'Статус':mode==='upcoming'?'Подготовка':'Последнее событие',value:interruption || (mode==='upcoming'?'Ожидаем начало матча':
      latest && text(latest.label)?`${Number.isSafeInteger(latest.minute) && latest.minute>=0 && latest.minute<=180?latest.minute+"′ · ":''}${text(latest.label)}`:'Нет подтверждённых событий')},
    {label:'Удары в створ',value:hasShots?`${home} — ${away}`:'Нет подтверждённой статистики'},
    {label:'Составы',value:confirmed?'Оба состава подтверждены':mode==='upcoming'?'Подтверждение составов ожидается':'Нет подтверждённых составов'},
  ];
  return {mode,phase,interruption,generatedAt,cards,
    title:interruption || ({upcoming:'Подготовка к матчу',live:'Матч в реальном времени',finished:'Итоги матча'}[mode] || 'Статус матча уточняется'),
    stale:Object.values(data?.dataFreshness || {}).some(meta=>meta?.stale===true)};
}
export function renderMatchHeadquarters(data={}) {
  const model=deriveMatchHeadquarters(data);
  const stamp=model.generatedAt?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(model.generatedAt)):null;
  return `<section class="panel match-headquarters" aria-label="Штаб матча">
    <div class="headquarters-heading"><div><small>ШТАБ МАТЧА</small><h2>${escape(model.title)}</h2></div></div>
    <ol class="headquarters-phases" aria-label="Этапы матча">${labels.map((label,index)=>`<li class="${index===model.phase?'is-current':index<model.phase?'is-complete':''}"${index===model.phase?' aria-current="step"':''}>${escape(label)}</li>`).join('')}</ol>
    <div class="headquarters-facts">${model.cards.map(card=>`<div><small>${escape(card.label)}</small><strong>${escape(card.value)}</strong></div>`).join('')}</div>
    <p class="headquarters-freshness">${model.stale?'Есть сохранённые данные: часть сведений устарела. ':''}${stamp?'Сводка сформирована '+escape(stamp):'Время формирования сводки неизвестно'}. Свежесть отдельных данных указана в разделах ниже.</p>
  </section>`;
}
