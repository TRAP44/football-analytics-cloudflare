import {EXPLANATION_MODEL} from '../src/match-explanation-runtime.js';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,appendFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

async function freePort(){
  const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
export function summarizeChatProbe(result){
  return result?.model===EXPLANATION_MODEL && result?.available===true && result?.answer==='facts' && result?.source==='ai'
    && result?.modelCalls===3 && result?.checks?.referee===true && result?.checks?.missingReferee===true && result?.checks?.goals===true && result?.checks?.h2h===true && result?.checks?.attack===true && Array.isArray(result?.items) && result.items.length>0
    && result.items.some(item=>item.id==='form_home')
    && result.items.every(item=>typeof item.text==='string' && /Home FC|Away FC/.test(item.text));
}
// Persist only locally defined verdicts, never strings returned by the HTTP probe.
export function safeProbeReport(result){
  return {
    model:result?.model===EXPLANATION_MODEL?'current':result?.model==='@cf/meta/llama-3.1-8b-instruct-fp8'?'previous':'unexpected',
    passed:summarizeChatProbe(result),
    modelCallsExpected:result?.modelCalls===3,
    headToHeadAnsweredByAi:result?.checks?.h2h===true,
    teamAttackAnsweredByAi:result?.checks?.attack===true,
    refereeAnswered:result?.checks?.referee===true,
    missingRefereeHandled:result?.checks?.missingReferee===true,
    goalsAnsweredFromData:result?.checks?.goals===true,
    modelFailure:result?.modelFailure==='model_unavailable'?'model_unavailable':result?.modelFailure==='binding_error'?'binding_error':'none',
    invalidResponse:result?.reason==='invalid_response',
    timedOutOrInferenceFailed:result?.reason==='ai_error' || result?.reason==='ai_unavailable',
    withinOneSecond:typeof result?.durationMs==='number' && result.durationMs<1000,
    aiFacts:result?.available===true && result?.answer==='facts' && result?.source==='ai',
    homeFormSelected:Array.isArray(result?.items) && result.items.some(item=>item.id==='form_home')
  };
}
export async function verifyMatchChatRemote(env=process.env){
  if(!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID)throw new Error('Existing Cloudflare workflow credentials are required.');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const dir=await mkdtemp(path.join(os.tmpdir(),'matchradar-chat-remote-'));
  const nonce=randomBytes(24).toString('hex');const port=await freePort();
  const report={scope:'Real Cloudflare AI binding with the actual question handler; fixed analysis and in-memory access/budget fixtures. Not a production Telegram authentication or delivery test.',previous:null,current:null,success:false};
  let child;let output='';
  try{
    const config=path.join(dir,'wrangler.json');
    await writeFile(config,JSON.stringify({name:'matchradar-chat-verification',main:path.join(root,'scripts/fixtures/match-chat-remote-worker.js'),compatibility_date:'2026-09-16',ai:{binding:'AI',remote:true},vars:{PROBE_NONCE:nonce}}));
    // Default dev runs code locally while allowing the configured remote AI binding.
    // --local explicitly disables remote bindings in Wrangler, including AI.
    child=spawn(path.join(root,'node_modules/.bin/wrangler'),['dev','--config',config,'--ip','127.0.0.1','--port',String(port),'--log-level','error'],{cwd:dir,env:{...env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',data=>{output=(output+String(data)).slice(-12000);});
    child.stderr.on('data',data=>{output=(output+String(data)).slice(-12000);});
    let spawnError=false;child.on('error',()=>{spawnError=true;});
    const base=`http://127.0.0.1:${port}`;
    let ready=false;
    for(let attempt=0;attempt<180;attempt++){
      if(spawnError || child.exitCode!==null)break;
      try{const response=await fetch(base+'/ready',{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready){report.failure='remote_binding_start_failed';report.permissionDenied=/403|401|forbidden|authentication error/i.test(output);return report;}
    for(const variant of ['previous','current']){
      try{
        const response=await fetch(base+'/probe',{method:'POST',headers:{'content-type':'application/json','x-probe-key':nonce},body:JSON.stringify({variant}),signal:AbortSignal.timeout(20000)});
        if(!response.ok){report[variant]={failure:'probe_http_error'};continue;}
        report[variant]=safeProbeReport(await response.json());
      }catch{report[variant]={failure:'probe_transport_error'};}
    }
    try{
      const response=await fetch(base+'/probe',{method:'POST',headers:{'content-type':'application/json','x-probe-key':nonce},body:JSON.stringify({variant:'conversation'}),signal:AbortSignal.timeout(100000)});
      const value=response.ok ? await response.json() : {};
      const checks={};
      for(const name of ['liveScore','liveStatistics','followupContext','refreshedScore','missingLineups','generatedExplanation'])checks[name]=value.checks?.[name]===true;
      report.conversation={checks,modelCallsExpected:value.modelCalls===4,timings:Array.isArray(value.timings) ? value.timings.slice(0,5).map(ms=>Number.isInteger(ms) && ms>=0 && ms<=100000 ? ms : null) : [],passed:value.success===true && Object.values(checks).every(Boolean) && value.modelCalls===4};
    }catch{report.conversation={passed:false,failure:'conversation_probe_failed'};}
    report.success=report.current?.passed===true && report.conversation?.passed===true;
    return report;
  }finally{
    if(child && child.exitCode===null){
      const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');
      let timer;await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);})]);clearTimeout(timer);
    }
    await rm(dir,{recursive:true,force:true});
    const outputDir=path.join(root,'load-results');await import('node:fs/promises').then(fs=>fs.mkdir(outputDir,{recursive:true}));
    await writeFile(path.join(outputDir,'match-chat-remote.json'),JSON.stringify(report,null,2)+'\n');
    const summary='# Match chat: real AI binding\n\n'+JSON.stringify(report,null,2)+'\n';
    if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,summary);
    process.stdout.write(summary);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const report=await verifyMatchChatRemote();if(!report.success)process.exitCode=1;}catch{console.error('Remote chat verification could not complete. No credentials or raw provider logs were printed.');process.exitCode=1;}
}
