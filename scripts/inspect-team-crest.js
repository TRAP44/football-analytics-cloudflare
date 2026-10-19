// Fixed public sports cache only. Never output cache payloads or user records.
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
async function boundedBytes(response,max) {
  if(!response.body)throw Error('Missing response body');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Response too large');}chunks.push(value);}
  } finally {reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export async function inspectTeamCrest({env=process.env,fetchImpl=fetch,now=new Date()}={}) {
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:' || !base.hostname.endsWith('.supabase.co') || base.username || base.password || base.pathname!=='/' || base.search || base.hash)throw Error('Invalid configuration');
  const key=env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if(typeof key!=='string'||!key.trim())throw Error('Missing configuration');
  const teams=new Map();
  for(const offset of [0,-1]) {
    const date=new Date(now.getTime()+offset*86400000).toISOString().slice(0,10);
    const url=new URL('/rest/v1/analysis_cache',base);
    url.search=new URLSearchParams({select:'fixtures:payload->fixtures',cache_key:`eq.provider-fixtures:${date}:v1`,limit:'1'});
    const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(response.status!==200)throw Error('Cache observation unavailable');
    const rows=JSON.parse(new TextDecoder().decode(await boundedBytes(response,2_000_000)));
    for(const fixture of (Array.isArray(rows?.[0]?.fixtures)?rows[0].fixtures:[]).slice(0,1500)) {
      for(const team of [fixture?.teams?.home,fixture?.teams?.away]) {
        if(String(team?.name || '').trim().toUpperCase()!=='FARDU' || !Number.isSafeInteger(team.id) || team.id<=0)continue;
        teams.set(team.id,{teamId:team.id,teamName:'FARDU',logoUrl:`https://media.api-sports.io/football/teams/${team.id}.png`});
      }
    }
  }
  const result=[];
  for(const team of [...teams.values()].slice(0,2)) {
    const response=await fetchImpl(team.logoUrl,{redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok){result.push({...team,httpStatus:response.status});continue;}
    const bytes=await boundedBytes(response,128000);
    if(bytes.length>128000 || bytes.length<24 || ![137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x))throw Error('Invalid public logo');
    const view=new DataView(bytes.buffer);if(view.getUint32(16)<1 || view.getUint32(20)<1 || view.getUint32(16)>512 || view.getUint32(20)>512)throw Error('Invalid public logo');
    result.push({...team,httpStatus:response.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    mkdirSync('load-results',{recursive:true});writeFileSync(`load-results/team-crest-${team.teamId}.png`,bytes);
  }
  return {scope:'fixed_public_FARDU_logo_only',teams:result};
}
if(process.argv[1]?.endsWith('/inspect-team-crest.js')) {
  try {const report=await inspectTeamCrest();mkdirSync('load-results',{recursive:true});writeFileSync('load-results/team-crest-inspection.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
  catch {console.error('Public crest inspection unavailable; details suppressed.');process.exitCode=1;}
}
