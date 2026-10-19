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
// Verified from protected public-cache inspection39240543606 and the actual PNG.
// Pin both the reported resource and exact file bytes; never classify by colour.
export const REPORTED_CREST_URL='https://media.api-sports.io/football/teams/25763.png';
export const UNAVAILABLE_CREST_SHA256='72f0bbb253ab54961cd5d66148e55aceb3e6bc9823da43e57a6e0812e5427430';
export async function verifyReportedCrest(url,{fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto}={}) {
  if(url!==REPORTED_CREST_URL)return 'uninspected';
  let reader;
  try {
    const response=await fetchImpl(REPORTED_CREST_URL,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'force-cache',signal:AbortSignal.timeout(2500)});
    if(!response.ok || !response.body)return 'unavailable';
    reader=response.body.getReader();const chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>128000){await reader.cancel();return 'unavailable';}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const digest=await cryptoImpl.subtle.digest('SHA-256',bytes);
    const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
    return hash===UNAVAILABLE_CREST_SHA256 ? 'placeholder' : 'different';
  } catch {return 'unavailable';} finally {reader?.releaseLock();}
}
let reportedVerification=null,reportedVerifiedAt=0;
function sharedVerification(url) {
  if(!reportedVerification || Date.now()-reportedVerifiedAt>60000){reportedVerifiedAt=Date.now();reportedVerification=verifyReportedCrest(url);}
  return reportedVerification;
}
export function installCrestFallback(image,{verify=sharedVerification}={}) {
  if(!image?.matches?.('img[data-team-crest]') || image.dataset.crestObserved==='true')return;
  image.dataset.crestObserved='true';
  const expected=image.getAttribute('src');
  let marker=null;
  const makeMarker=()=>{
    if(marker)return marker;
    marker=image.ownerDocument.createElement('span');
    marker.className='team-crest-initials';marker.setAttribute('aria-hidden','true');
    marker.textContent=teamInitials(image.dataset.teamCrest);
    const rect=image.getBoundingClientRect?.();
    if(rect && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width>0 && rect.height>0) {
      const width=Math.min(160,Math.max(12,rect.width)),height=Math.min(160,Math.max(12,rect.height));
      marker.style?.setProperty('--crest-width',`${width}px`);
      marker.style?.setProperty('--crest-height',`${height}px`);
      marker.style?.setProperty('--crest-font-size',`${Math.max(8,Math.min(24,width*.38))}px`);
    }
    return marker;
  };
  const current=()=>image.getAttribute('src')===expected && image.parentNode;
  const fallback=()=>{if(current())image.replaceWith(makeMarker());};
  image.addEventListener('error',fallback,{once:true});
  if(expected===REPORTED_CREST_URL) {
    const pending=makeMarker();image.hidden=true;image.before(pending);
    const settle=result=>{
      if(!image.parentNode)return;
      if(image.getAttribute('src')!==expected){marker?.remove();image.hidden=false;return;}
      if(result==='different'){marker.remove();image.hidden=false;}
      else image.remove();
    };
    Promise.resolve().then(()=>verify(expected)).then(settle,()=>settle('unavailable'));
  } else if(image.complete && image.naturalWidth===0)fallback();
}
