// Reproducible isolated measurement of the actual Worker analysis composition.
// All fetches are replaced, with an explicit host allowlist of test hosts.
// No production credentials or process environment are passed to the Worker.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'prematch-cost-'));
const originalFetch=globalThis.fetch;
try {
  const source=await fs.readFile(path.join(root,'src/worker.js'),'utf8');
  const modulePath=path.join(directory,'worker.mjs');
  await fs.writeFile(modulePath,source.replaceAll("from './",`from '${pathToFileURL(path.join(root,'src/')).href}`)
    +'\nexport {getAnalysisRuntime,memory,config};\n');
  const results=[];
  for (const leadMinutes of [120,60]) {
    const requests=[];
    let firstPrediction=null;
    const predictionWrites=[];
    const fixtureId=770+leadMinutes;
    const fixture={fixture:{id:fixtureId,date:new Date(Date.now()+leadMinutes*60000).toISOString(),
      status:{short:'NS',elapsed:null},venue:{name:'Test stadium'},referee:null},
      league:{id:39,name:'Premier League',country:'England',season:2026,round:'Regular Season - 10'},
      teams:{home:{id:40,name:'Liverpool'},away:{id:50,name:'Manchester City'}},goals:{home:null,away:null},score:{fulltime:{home:null,away:null}}};
    globalThis.fetch=async(input,init)=>{
      const url=new URL(typeof input==='string'?input:input.url || String(input));
      if (url.hostname==='isolated.supabase.test') {
        let result=[];
        if (url.pathname.endsWith('/claim_provider_request')) result={allowed:true,count:1};
        if (init?.method==='POST' && url.pathname.endsWith('/analysis_cache')) result=JSON.parse(init.body);
        if (url.pathname.endsWith('/model_predictions') && init?.method==='POST') {
          const row=JSON.parse(init.body);
          const prefer=new Headers(init.headers).get('Prefer');
          predictionWrites.push({method:init.method,prefer,conflict:url.searchParams.get('on_conflict')});
          firstPrediction ??=row;
        }
        return Response.json(result);
      }
      if (url.hostname!=='isolated-relay.test') throw new Error('Measurement blocked an unexpected external host.');
      const endpoint=url.pathname.replace('/functions/v1/football-relay','');
      requests.push({endpoint,params:Object.fromEntries(url.searchParams)});
      let response=[];
      if (endpoint==='/fixtures' && url.searchParams.has('id')) response=[fixture];
      if (endpoint==='/predictions') response=[{predictions:{percent:{home:'45%',draw:'25%',away:'30%'}},
        teams:{home:{last_5:{form:'60%',goals:{for:{average:'1.8'},against:{average:'1'}}}},
          away:{last_5:{form:'50%',goals:{for:{average:'1.4'},against:{average:'1.2'}}}}}}];
      return Response.json({response,errors:[],results:response.length},{headers:{
        'x-ratelimit-requests-limit':'7500','x-ratelimit-requests-remaining':'7400',
        'x-ratelimit-limit':'300','x-ratelimit-remaining':'280',
      }});
    };
    const worker=await import(`${pathToFileURL(modulePath).href}?lead=${leadMinutes}`);
    worker.memory.provider={plan:'PRO',dailyLimit:7500,dailyRemaining:7400,minuteLimit:300,minuteRemaining:280,updatedAt:new Date().toISOString()};
    const cfg=worker.config({API_FOOTBALL_KEY:'isolated-test-key',
      API_FOOTBALL_BASE_URL:'https://isolated-relay.test/functions/v1/football-relay',
      SUPABASE_URL:'https://isolated.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'isolated-test-key'});
    for (const mode of ['cold','cached']) {
      requests.length=0;
      const result=await worker.getAnalysisRuntime().analyzeFixtureForSystem(fixtureId,cfg);
      const body=await result.json();
      if (result.status!==200) throw new Error(`Analysis measurement failed: ${result.status}`);
      results.push({leadMinutes,mode,status:result.status,cached:body.cached,
        providerRequests:requests.length,requests:[...requests]});
    }
    if (leadMinutes===60 && process.argv.includes('--lineup-refresh')) {
      const initialPrediction=JSON.stringify(firstPrediction);
      const data=[40,50].map((teamId,side)=>({team:{id:teamId},formation:'4-3-3',
        startXI:Array.from({length:11},(_,index)=>({player:{id:1000+side*100+index,name:`Player ${side}-${index}`}})),substitutes:[]}));
      const event={fixtureId,feature:'lineups',provider:'api-football',fetchedAt:new Date().toISOString(),data};
      const options={lineupEvent:event};
      for (const mode of ['lineup-refresh','lineup-repeat']) {
        requests.length=0;
        const result=await worker.getAnalysisRuntime().analyzeFixtureForSystem(fixtureId,cfg,options);
        const body=await result.json();
        if (result.status!==200) throw new Error(`Lineup measurement failed: ${result.status}, ${body.code}`);
        const analysis=worker.memory.cache.get(`fixture:${fixtureId}:v17-starting-xi-rc146`)?.payload;
        results.push({leadMinutes,mode,status:result.status,cached:body.cached,
          providerRequests:requests.length,requests:[...requests],lineupsConfirmed:analysis?.lineupQuality?.bothConfirmed,
          completedLineupRefresh:Boolean(analysis?.prematchLineupRefresh),firstPredictionUnchanged:JSON.stringify(firstPrediction)===initialPrediction,
          predictionWrites:[...predictionWrites]});
      }
    }
  }
  console.log(JSON.stringify({isolated:true,results},null,2));
} finally {
  globalThis.fetch=originalFetch;
  await fs.rm(directory,{recursive:true,force:true});
}
