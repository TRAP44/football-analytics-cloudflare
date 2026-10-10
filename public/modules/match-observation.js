import { positiveEntityId } from './entity-state-safety.js';

export function observationRows(watchlist,matches) {
  const current=new Map((Array.isArray(matches)?matches:[]).map(m=>[positiveEntityId(m?.fixtureId),m]));
  const seen=new Set();
  return (Array.isArray(watchlist)?watchlist:[]).slice(0,50).flatMap(saved=>{
    const id=positiveEntityId(saved?.fixtureId);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const match=current.get(id);
    return [{id,match,saved}];
  }).sort((a,b)=>Number(b.match?.live===true)-Number(a.match?.live===true));
}

export function renderObservationPanel({root,watchlist,matches,reminders,remindersLoaded,escapeHtml,onOpen,onRemove,dateTime}) {
  if (!root) return;
  const rows=observationRows(watchlist,matches);
  root.hidden=!rows.length;
  if (!rows.length) {root.innerHTML='';return;}
  const reminderIds=new Set((Array.isArray(reminders)?reminders:[]).map(r=>positiveEntityId(r?.fixtureId)));
  root.innerHTML=`<summary>Наблюдаю за матчами · ${rows.length}</summary><p class="muted">Список сохранён на этом устройстве. Telegram-напоминания включаются отдельно в штабе.</p><div class="observation-list">${rows.map(({id,match,saved})=>{
    const status=match?.live===true ? 'LIVE' : match?.finished===true ? 'Завершён' : match ? dateTime(match.date) : 'Нет в текущей ленте · сохранённый матч';
    return `<article class="observation-row"><button type="button" class="secondary-btn" data-observation-open="${id}"><strong>${escapeHtml(match?.home?.name || saved.homeName || 'Хозяева')} — ${escapeHtml(match?.away?.name || saved.awayName || 'Гости')}</strong><small>${escapeHtml(status)} · ${reminderIds.has(id)?'Telegram-напоминание включено':remindersLoaded===true?'Без Telegram-напоминания':'Статус Telegram — в штабе'}</small></button><button type="button" class="secondary-btn" data-observation-remove="${id}" aria-label="Убрать матч из наблюдения">Убрать</button></article>`;
  }).join('')}</div>`;
  root.querySelectorAll('[data-observation-open]').forEach(button=>button.addEventListener('click',()=>onOpen(Number(button.dataset.observationOpen),button)));
  root.querySelectorAll('[data-observation-remove]').forEach(button=>button.addEventListener('click',()=>onRemove(Number(button.dataset.observationRemove))));
}
