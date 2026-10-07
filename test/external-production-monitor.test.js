import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateEndpoint,
  runMonitorAttempt,
} from '../scripts/external-production-monitor.js';
import {
  classifyPrimaryRunJobs,
  decideDiagnosticActions,
  parseTrackingIssueNumber,
  selectInfrastructureIncidentTarget,
} from '../scripts/external-monitor-control-plane.js';

const workflow=fs.readFileSync(
  '.github/workflows/external-production-monitor.yml',
  'utf8',
);
const runbook=fs.readFileSync(
  'docs/EXTERNAL_MONITORING_RUNBOOK_RU.md',
  'utf8',
);

function jsonResponse(status,body) {
  return {
    status,
    ok:status>=200 && status<300,
    statusText:status===200 ? 'OK' : 'Error',
    text:async()=>JSON.stringify(body),
  };
}

test('external monitor accepts healthy production contracts',()=>{
  assert.equal(evaluateEndpoint('live',{
    statusCode:200,
    body:{ok:true,status:'alive',version:'6.120.0'},
  }).passed,true);

  const ready=evaluateEndpoint('ready',{
    statusCode:200,
    elapsedMs:420,
    body:{
      ok:true,
      status:'ready',
      version:'6.120.0',
      latencyMs:390,
    },
  });
  assert.equal(ready.passed,true);
  assert.equal(ready.warning,false);

  const publicStatus=evaluateEndpoint('public_status',{
    statusCode:200,
    body:{ok:true,status:'operational'},
  });
  assert.equal(publicStatus.passed,true);
  assert.equal(publicStatus.warning,false);
});

test('readiness warning uses the slower of network and server-observed latency',()=>{
  const networkSlow=evaluateEndpoint('ready',{
    statusCode:200,
    elapsedMs:3200,
    body:{ok:true,status:'ready',latencyMs:120},
  },{readyWarningMs:3000});
  assert.equal(networkSlow.passed,true);
  assert.equal(networkSlow.warning,true);
  assert.match(networkSlow.reason,/3200 ms/);

  const serverSlow=evaluateEndpoint('ready',{
    statusCode:200,
    elapsedMs:400,
    body:{ok:true,status:'ready',latencyMs:3100},
  },{readyWarningMs:3000});
  assert.equal(serverSlow.passed,true);
  assert.equal(serverSlow.warning,true);
  assert.match(serverSlow.reason,/3100 ms/);
  assert.equal(serverSlow.observed.latencyMs,3100);
});

test('readiness 503 fails closed while maintenance remains an availability warning',()=>{
  const ready=evaluateEndpoint('ready',{
    statusCode:503,
    body:{ok:false,status:'not_ready'},
  });
  assert.equal(ready.passed,false);

  const maintenance=evaluateEndpoint('public_status',{
    statusCode:200,
    body:{ok:false,status:'maintenance'},
  });
  assert.equal(maintenance.passed,true);
  assert.equal(maintenance.warning,true);
});

test('unknown endpoints and coercive response fields cannot pass monitoring contracts',()=>{
  assert.equal(evaluateEndpoint('typo',{
    statusCode:200,
    body:{ok:true,status:'operational'},
  }).passed,false);

  assert.equal(evaluateEndpoint('live',{
    statusCode:'200',
    body:{ok:true,status:'alive'},
  }).passed,false);

  assert.equal(evaluateEndpoint('ready',{
    statusCode:200,
    elapsedMs:{valueOf(){throw new Error('must not coerce elapsed');}},
    body:{
      ok:true,
      status:'ready',
      latencyMs:{valueOf(){throw new Error('must not coerce latency');}},
    },
  }).warning,false);

  const hostileBody={ok:true};
  Object.defineProperty(hostileBody,'status',{
    enumerable:true,
    get(){throw new Error('hostile status getter');},
  });
  const hostile=evaluateEndpoint('live',{
    statusCode:200,
    body:hostileBody,
  });
  assert.equal(hostile.passed,false);
  assert.equal(hostile.observed.status,'');
});

test('full monitor attempt checks only the three public contracts and returns structured evidence',async()=>{
  const seen=[];
  const result=await runMonitorAttempt({
    baseUrl:'https://monitor.example/',
    timeoutMs:5000,
    readyWarningMs:3000,
    fetchImpl:async url=>{
      const value=String(url);
      seen.push(value);
      if (value.includes('/health/live')) {
        return jsonResponse(200,{
          ok:true,
          status:'alive',
          version:'6.120.0',
        });
      }
      if (value.includes('/health/ready')) {
        return jsonResponse(200,{
          ok:true,
          status:'ready',
          version:'6.120.0',
          latencyMs:100,
        });
      }
      if (value.includes('/api/public-status')) {
        return jsonResponse(200,{
          ok:true,
          status:'operational',
        });
      }
      throw new Error('unexpected endpoint');
    },
  });

  assert.equal(result.ok,true);
  assert.equal(result.warning,false);
  assert.equal(result.baseUrl,'https://monitor.example');
  assert.deepEqual(
    Object.keys(result.checks).sort(),
    ['live','public_status','ready'],
  );
  assert.equal(seen.length,3);
  assert.ok(seen.every(url=>url.includes('external_monitor=')));
});

test('malformed target URL fails closed instead of silently probing default production',async()=>{
  await assert.rejects(
    ()=>runMonitorAttempt({
      baseUrl:'ftp://monitor.example',
      fetchImpl:async()=>jsonResponse(200,{ok:true,status:'alive'}),
    }),
    /protocol must be HTTP or HTTPS/,
  );

  await assert.rejects(
    ()=>runMonitorAttempt({
      baseUrl:{toString(){return 'https://wrong.example';}},
      fetchImpl:async()=>jsonResponse(200,{ok:true,status:'alive'}),
    }),
    /must be a string/,
  );
});

test('malformed endpoint transport becomes failed evidence rather than throwing',async()=>{
  const result=await runMonitorAttempt({
    baseUrl:'https://monitor.example',
    fetchImpl:async()=>({
      status:200,
      ok:true,
      text:{},
    }),
  });

  assert.equal(result.ok,false);
  for (const check of Object.values(result.checks)) {
    assert.equal(check.passed,false);
    assert.equal(check.statusCode,0);
    assert.equal(check.parseOk,false);
    assert.equal(check.transportError,'Error');
  }
});

test('workflow is independent, retried and incident-aware without application secrets',()=>{
  assert.match(workflow,/cron: "17 \* \* \* \*"/);
  assert.match(workflow,/workflow_run:/);
  assert.match(workflow,/workflows: \["Deploy Production"\]/);
  assert.match(workflow,/types: \[completed\]/);
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/runs-on: ubuntu-latest/);
  assert.match(workflow,/issues: write/);
  assert.match(workflow,/EXTERNAL_MONITOR_RETRIES: "3"/);
  assert.match(workflow,/EXTERNAL_MONITOR_READY_WARNING_MS: "3000"/);
  assert.match(workflow,/external-production-monitor\.js/);
  assert.match(workflow,/external-monitor-control-plane\.js primary/);
  assert.doesNotMatch(workflow,/\bgh issue\b/);
  assert.match(workflow,/retention-days: 3/);
  assert.doesNotMatch(
    workflow,
    /API_FOOTBALL_KEY|THE_ODDS_API_KEY|TAVILY_KEY|SUPABASE_SECRET_KEY/,
  );
});

test('failed primary monitor has integrated self-hosted diagnostics with read-only Actions access',()=>{
  assert.match(workflow,/diagnose:/);
  assert.match(workflow,/if: \$\{\{ failure\(\) \}\}/);
  assert.match(workflow,/runs-on: \[self-hosted, Linux, X64\]/);
  assert.match(workflow,/actions: read/);
  assert.match(workflow,/issues: write/);
  assert.match(workflow,/MONITOR_INFRA_TRACKING_ISSUE: "463"/);
  assert.match(workflow,/external-monitor-control-plane\.js diagnose/);
  assert.doesNotMatch(
    workflow,
    /API_FOOTBALL_KEY|THE_ODDS_API_KEY|TAVILY_KEY|SUPABASE_SECRET_KEY/,
  );

  assert.match(runbook,/failure domain/i);
  assert.match(runbook,/job `diagnose`/);
  assert.doesNotMatch(
    runbook,
    /external-production-monitor-diagnostics\.yml/,
  );
  assert.match(runbook,/не выполняет rollback автоматически/i);
});

test('diagnostics classify zero-step and post-probe failures as monitor infrastructure failures',()=>{
  const zeroStep=classifyPrimaryRunJobs([
    {name:'monitor',conclusion:'failure',steps:[]},
  ]);
  assert.deepEqual(zeroStep,{
    category:'monitor_infrastructure',
    reason:'zero_step_failure',
    requiresFallback:true,
  });

  const postProbe=classifyPrimaryRunJobs([{
    name:'monitor',
    conclusion:'failure',
    steps:[
      {
        name:'Check production from external runner',
        conclusion:'success',
      },
      {
        name:'Reconcile availability incidents',
        conclusion:'failure',
      },
    ],
  }]);
  assert.deepEqual(postProbe,{
    category:'monitor_infrastructure',
    reason:'production_probe_passed_before_workflow_failure',
    requiresFallback:false,
  });
  assert.deepEqual(decideDiagnosticActions(postProbe),{
    availability:'close',
    infrastructure:'open',
  });
});

test('diagnostics classify the monitor job rather than unrelated jobs in the same workflow',()=>{
  const result=classifyPrimaryRunJobs([
    {
      name:'diagnose',
      steps:[{
        name:'Check production from external runner',
        conclusion:'success',
      }],
    },
    {
      name:'monitor',
      steps:[{
        name:'Check production from external runner',
        conclusion:'failure',
      }],
    },
  ]);

  assert.deepEqual(result,{
    category:'ambiguous',
    reason:'production_probe_failed',
    requiresFallback:true,
  });
});

test('diagnostics use fallback health to separate app outage from monitor failure',()=>{
  const probeFailure=classifyPrimaryRunJobs([{
    name:'monitor',
    conclusion:'failure',
    steps:[{
      name:'Check production from external runner',
      conclusion:'failure',
    }],
  }]);

  assert.deepEqual(decideDiagnosticActions(probeFailure,true),{
    availability:'close',
    infrastructure:'open',
  });
  assert.deepEqual(decideDiagnosticActions(probeFailure,false),{
    availability:'open',
    infrastructure:'close',
  });

  const zeroStep=classifyPrimaryRunJobs([
    {name:'monitor',conclusion:'failure',steps:[]},
  ]);
  assert.deepEqual(decideDiagnosticActions(zeroStep,false),{
    availability:'open',
    infrastructure:'open',
  });
});

test('diagnostic classifiers tolerate hostile metadata without inventing health evidence',()=>{
  const hostileJob={name:'monitor'};
  Object.defineProperty(hostileJob,'steps',{
    get(){throw new Error('hostile steps getter');},
  });
  assert.deepEqual(classifyPrimaryRunJobs([hostileJob]),{
    category:'monitor_infrastructure',
    reason:'zero_step_failure',
    requiresFallback:true,
  });

  const hostilePrimary={};
  Object.defineProperty(hostilePrimary,'requiresFallback',{
    get(){throw new Error('hostile fallback getter');},
  });
  assert.deepEqual(decideDiagnosticActions(hostilePrimary),{
    availability:'unchanged',
    infrastructure:'unchanged',
  });
});

test('known monitor-infrastructure failures reuse only a valid open tracking issue',()=>{
  assert.equal(parseTrackingIssueNumber('463'),463);
  assert.equal(parseTrackingIssueNumber(463),463);
  assert.equal(parseTrackingIssueNumber('0'),0);
  assert.equal(parseTrackingIssueNumber(true),0);
  assert.equal(parseTrackingIssueNumber('bad'),0);
  assert.equal(
    parseTrackingIssueNumber({
      toString(){throw new Error('must not coerce issue id');},
    }),
    0,
  );

  const openIssues=[
    {
      number:463,
      title:'P1 — Eliminate self-hosted runner as a single point of failure',
    },
    {
      number:507,
      title:'[monitor-infra] External Production Monitor execution failure',
    },
  ];
  assert.deepEqual(
    selectInfrastructureIncidentTarget(openIssues,463),
    {kind:'tracking',number:463},
  );
  assert.deepEqual(
    selectInfrastructureIncidentTarget(openIssues,999),
    {kind:'dedicated',number:0},
  );
  assert.deepEqual(
    selectInfrastructureIncidentTarget([
      {number:463,pull_request:{}},
    ],463),
    {kind:'dedicated',number:0},
  );

  const hostileIssue={};
  Object.defineProperty(hostileIssue,'number',{
    get(){throw new Error('hostile issue getter');},
  });
  assert.deepEqual(
    selectInfrastructureIncidentTarget([hostileIssue],463),
    {kind:'dedicated',number:0},
  );
});
