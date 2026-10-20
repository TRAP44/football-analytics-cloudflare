// Read-only Management APIs; optional fixed SELECT diagnostics. No mutations.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {collectSupabaseDiagnostics} from './supabase-server-diagnostics.js';

const text=value=>typeof value==='string'?value.replace(/[^a-zA-Z0-9 _./()-]/g,'').slice(0,80):null;
const states=new Set(['INACTIVE','ACTIVE_HEALTHY','ACTIVE_UNHEALTHY','COMING_UP','UNKNOWN','GOING_DOWN','INIT_FAILED','REMOVED','RESTORING','UPGRADING','PAUSING','RESTORE_FAILED','RESTARTING','PAUSE_FAILED','RESIZING']);

async function readJson(url,token,fetchImpl) {
  try {
    const response=await fetchImpl(url,{method:'GET',redirect:'error',
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    if(response.status!==200 || response.ok!==true)return {status:'unavailable',httpStatus:Number(response.status)||0};
    return {status:'observed',data:await response.json()};
  } catch {return {status:'unavailable',reason:'request_failed'};}
}
const invalid=()=>({status:'invalid_response'});

export async function auditInfrastructure({env={},fetchImpl=fetch}={}) {
  const inspectDatabase=env.SUPABASE_DIAGNOSTICS_ENABLED==='true';
  const report={scope:'read_only_management_apis',productionChanged:false,
    loadTestRun:false,productionCapacityConfirmed:false,
    cloudflare:{settings:{status:'not_configured'},workersSubscriptions:{status:'not_configured'}},
    supabase:{project:{status:'not_configured'},compute:{status:'not_configured'},
      organizationPlan:{status:'unknown',reason:'not_exposed_by_used_public_management_endpoints'}},
    nextStep:'Confirm missing observations, then prepare separate staging; this audit is not a capacity test.'};
  const account=env.CLOUDFLARE_ACCOUNT_ID?.trim(),cfToken=env.CLOUDFLARE_API_TOKEN?.trim();
  const project=env.SUPABASE_PROJECT_REF?.trim(),sbToken=env.SUPABASE_ACCESS_TOKEN?.trim();
  report.configuredInputs=Object.fromEntries(['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','SUPABASE_ACCESS_TOKEN','SUPABASE_PROJECT_REF'].map(name=>[name,typeof env[name]==='string' && env[name].trim().length>0]));
  const tasks=[];
  if(cfToken && /^[a-f0-9]{32}$/i.test(account || '')) {
    tasks.push((async()=>{
      const result=await readJson(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/account-settings`,cfToken,fetchImpl);
      if(result.status!=='observed'){report.cloudflare.settings=result;return;}
      const value=result.data?.result;
      report.cloudflare.settings=result.data?.success===true && value && typeof value==='object' && !Array.isArray(value)
        ? {status:'observed',defaultUsageModel:text(value.default_usage_model)} : invalid();
    })());
    tasks.push((async()=>{
      const result=await readJson(`https://api.cloudflare.com/client/v4/accounts/${account}/subscriptions`,cfToken,fetchImpl);
      if(result.status!=='observed'){report.cloudflare.workersSubscriptions=result;return;}
      if(result.data?.success!==true || !Array.isArray(result.data.result)){report.cloudflare.workersSubscriptions=invalid();return;}
      // Return only Workers plan labels, never invoices, prices, account or payment details.
      const plans=result.data.result.filter(row=>/workers/i.test(`${row?.rate_plan?.id || ''} ${row?.rate_plan?.public_name || ''}`))
        .map(row=>({name:text(row.rate_plan?.public_name),planCode:text(row.rate_plan?.id),state:text(row.state)}));
      report.cloudflare.workersSubscriptions={status:'observed',plans,planConclusion:plans.length?'review_observed_subscriptions':'unknown_no_workers_subscription_in_response'};
    })());
  } else if(cfToken || account) {
    report.cloudflare.settings={status:'not_configured',reason:'incomplete_or_invalid_account_credentials'};
    report.cloudflare.workersSubscriptions={...report.cloudflare.settings};
  }
  if(sbToken && /^[a-z0-9]{20}$/.test(project || '')) {
    tasks.push((async()=>{
      const result=await readJson(`https://api.supabase.com/v1/projects/${project}`,sbToken,fetchImpl);
      if(result.status!=='observed'){report.supabase.project=result;return;}
      const value=result.data;
      report.supabase.project=(value?.ref===project || (!value?.ref && value?.id===project)) && states.has(value.status)
        ? {status:'observed',projectStatus:value.status,region:text(value.region),postgresVersion:text(value.database?.version)} : invalid();
    })());
    if(!inspectDatabase)tasks.push((async()=>{
      const result=await readJson(`https://api.supabase.com/v1/projects/${project}/billing/addons`,sbToken,fetchImpl);
      if(result.status!=='observed'){report.supabase.compute=result;return;}
      if(!Array.isArray(result.data?.selected_addons)){report.supabase.compute=invalid();return;}
      const variants=result.data.selected_addons.filter(row=>row?.type==='compute_instance')
        .map(row=>text(row.variant?.id)).filter(Boolean);
      report.supabase.compute={status:'observed',selectedComputeVariants:variants,
        conclusion:variants.length?'compute_selection_not_organization_plan':'unknown_no_compute_selection'};
    })());
    else report.supabase.compute={status:'not_requested',reason:'billing_not_needed_for_database_diagnostics'};
  } else if(sbToken || project) {
    report.supabase.project={status:'not_configured',reason:'incomplete_or_invalid_project_credentials'};
    report.supabase.compute={...report.supabase.project};
  }
  await Promise.all(tasks);
  report.completeManagementObservations=[report.cloudflare.settings,report.cloudflare.workersSubscriptions,report.supabase.project,report.supabase.compute].every(row=>row.status==='observed');
  if(inspectDatabase){
    report.scope='read_only_server_diagnostics';
    report.supabase.diagnostics=await collectSupabaseDiagnostics({env,fetchImpl});
    report.completeDiagnosticsObservations=report.supabase.project.status==='observed'&&report.supabase.diagnostics.complete===true;
    report.nextStep='Review server evidence before changing queries or capacity; missing evidence is not healthy operation.';
  }
  return report;
}

export function auditSummary(report) {
  const rows=[['Workers settings',report.cloudflare.settings],['Workers subscriptions',report.cloudflare.workersSubscriptions],
    ['Supabase project',report.supabase.project],['Supabase compute',report.supabase.compute],['Supabase organization plan',report.supabase.organizationPlan]];
  return (report.supabase.diagnostics?'# Supabase server diagnostics (read-only)':'# Infrastructure capacity audit (read-only)')+'\n\nConfigured inputs (presence only): '+JSON.stringify(report.configuredInputs)+'\n\n'+rows.map(([name,value])=>`- ${name}: ${JSON.stringify(value)}`).join('\n')+
    (report.supabase.diagnostics?'\n\nFixed read-only server diagnostics:\n'+JSON.stringify(report.supabase.diagnostics,null,2):'')+
    '\n\nNo production changes, deployments, payments or load test. Unknown observations do not prove Free/paid or capacity.\n';
}
export async function main(env=process.env) {
  const report=await auditInfrastructure({env});
  fs.mkdirSync('load-results',{recursive:true});
  fs.writeFileSync('load-results/infrastructure-capacity.json',JSON.stringify(report,null,2)+'\n');
  const summary=auditSummary(report);
  if(env.GITHUB_STEP_SUMMARY)fs.appendFileSync(env.GITHUB_STEP_SUMMARY,summary);
  process.stdout.write(summary);
  // Complete means observed management data, never confirmed production capacity.
  if(!(env.SUPABASE_DIAGNOSTICS_ENABLED==='true'?report.completeDiagnosticsObservations:report.completeManagementObservations))process.exitCode=1;
  return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
