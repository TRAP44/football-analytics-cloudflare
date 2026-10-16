const STAGES=['cache','access','fixture','providers','enrichment','persistence','settlement'];

// Per-request monotonic wall time. No identifiers, payloads or error strings.
export function createAnalysisTiming({now=()=>performance.now()}={}) {
  const clock=typeof now==='function'?now:()=>performance.now();
  const read=()=>{try{const value=clock();return Number.isFinite(value)?value:null;}catch{return null;}};
  const started=read();let previous=started,stage='cache',finished=false;
  const durations=Object.fromEntries(STAGES.map(key=>[key,0]));
  function enter(next){
    if(finished || !STAGES.includes(next))return;
    const at=read();
    if(at!==null && previous!==null && at>=previous){durations[stage]+=at-previous;previous=at;}
    stage=next;
  }
  return {enter,finish(){
    if(finished)return null;
    enter(stage);finished=true;
    if(started===null || previous===null)return null;
    const durationMs=Math.round(previous-started);
    if(durationMs<2000 || durationMs>600000)return null;
    return {durationMs,meta:Object.fromEntries(STAGES.map(key=>[key+'Ms',Math.round(durations[key])]))};
  }};
}
