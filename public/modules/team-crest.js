// A neutral team marker, never a fabricated club badge.
export function teamInitials(name) {
  const words=String(name || '').normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [];
  const letters=words.length>1 ? words.slice(0,2).map(word=>Array.from(word)[0]).join('') : Array.from(words[0] || '').slice(0,2).join('');
  return letters.toLocaleUpperCase('ru-RU') || 'FC';
}
export function crestFallbackHtml(name,escapeHtml) {
  return `<span class="team-crest-initials" aria-hidden="true">${escapeHtml(teamInitials(name))}</span>`;
}
export function usableCrestUrl(value) {
  if(typeof value!=='string' || !value.trim())return '';
  try {
    const url=new URL(value);
    if(!['https:','http:'].includes(url.protocol) || url.username || url.password)return '';
    return url.href;
  } catch {return '';}
}
export function installCrestFallback(image) {
  if(!image?.matches?.('img[data-team-crest]') || image.dataset.crestObserved==='true')return;
  image.dataset.crestObserved='true';
  const expected=image.getAttribute('src');
  const fallback=()=>{
    if(image.getAttribute('src')!==expected || !image.parentNode)return;
    const marker=image.ownerDocument.createElement('span');
    marker.className='team-crest-initials';marker.setAttribute('aria-hidden','true');
    marker.textContent=teamInitials(image.dataset.teamCrest);
    image.replaceWith(marker);
  };
  image.addEventListener('error',fallback,{once:true});
  if(image.complete && image.naturalWidth===0)fallback();
}
