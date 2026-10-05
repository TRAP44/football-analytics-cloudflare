const root=document.getElementById('statusCard');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const label=v=>({operational:'Работает',degraded:'Ограничения',maintenance:'Обслуживание',paused:'Приостановлено',limited:'Ограничено',configuration_required:'Требует настройки'}[v]||v||'—');
const serviceLabel=k=>({telegram:'Telegram',miniApp:'Mini App',aiAnalysis:'AI-анализ',search:'Поиск',live:'LIVE-данные',news:'Новости'}[k]||k);
const controller=new AbortController();
const timeout=setTimeout(()=>controller.abort(),8000);
try{
  const r=await fetch('/api/public-status',{headers:{accept:'application/json'},cache:'no-store',signal:controller.signal});
  const d=await r.json();
  if(!r.ok) throw new Error('HTTP '+r.status);
  const rows=Object.entries(d.services||{}).map(([k,v])=>'<li><strong>'+esc(serviceLabel(k))+'</strong>: '+esc(label(v))+'</li>').join('');
  const release=[d.version,d.releaseCandidate].filter(Boolean).join(' · ')||'—';
  const updated=d.generatedAt?new Date(d.generatedAt).toLocaleString('ru-RU'):'—';
  root.innerHTML='<p><strong>'+esc(d.label||'MatchRadar')+'</strong></p><p>Версия: '+esc(release)+'</p><ul>'+rows+'</ul>'+(d.notice?'<p>'+esc(d.notice)+'</p>':'')+'<p class="meta">Обновлено: '+esc(updated)+'</p>';
}catch{
  root.innerHTML='<p><strong>Не удалось загрузить текущий статус.</strong></p><p>Повторите позже.</p>';
}finally{
  clearTimeout(timeout);
}
