import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';
import {
  cockpitFeatureTrusted,
  deriveMatchCockpit,
} from '../public/modules/match-cockpit.js';

const app=fs.readFileSync('public/app.js','utf8');
const styles=fs.readFileSync('public/styles.css','utf8');
const html=fs.readFileSync('public/index.html','utf8');

function trustedFeature(overrides={}) {
  return {
    available:true,
    usable:true,
    confidenceBearing:true,
    stale:false,
    provenanceState:'verified',
    state:'available',
    ...overrides,
  };
}

test('RC131 derives the at-a-glance cockpit without new data requests',()=>{
  const model=deriveMatchCockpit({
    match:{
      home:{name:'Home'},
      away:{name:'Away'},
    },
    recentForm:{
      home:{
        overall:{sample:5,ppg:2.2},
        venue:{sample:4,ppg:2.5},
      },
      away:{
        overall:{sample:5,ppg:1.4},
        venue:{sample:4,ppg:1.1},
      },
    },
    comparison:{
      metrics:[
        {key:'form_ppg',homeValue:2.2,awayValue:1.4},
        {key:'venue_ppg',homeValue:2.5,awayValue:1.1},
        {key:'table_rank',homeValue:2,awayValue:8},
      ],
    },
    providerReliability:{
      features:{
        injuries:trustedFeature(),
        lineups:trustedFeature(),
        odds:trustedFeature(),
      },
    },
    absences:{home:[{id:1}],away:[]},
    lineupImpact:{
      homeConfirmed:true,
      awayConfirmed:true,
    },
    h2h:{homeWins:3,draws:1,awayWins:1},
    market:{
      provider:'api-football',
      odds:{home:1.9,draw:3.4,away:4.2},
    },
    marketMovement:{
      sample:3,
      probabilityChange:{home:3,draw:-1,away:-2},
    },
    confidence:{score:74,label:'Рабочее качество'},
    completeness:{score:8,max:10},
  });

  assert.equal(model.form.available,true);
  assert.deepEqual(model.form.pair,{home:2.2,away:1.4});
  assert.equal(model.venue.available,true);
  assert.deepEqual(model.table.pair,{home:2,away:8});
  assert.equal(model.injuries.confirmed,true);
  assert.equal(model.injuries.homeAbs,1);
  assert.equal(model.lineups.confirmedCount,2);
  assert.equal(model.h2h.sample,5);
  assert.deepEqual(model.market.odds,{home:1.9,draw:3.4,away:4.2});
  assert.deepEqual(model.market.strongestMove,['П1',3]);
  assert.equal(model.quality.confidence,74);

  const start=app.indexOf('function matchCockpitHtml');
  const end=app.indexOf('function analysisGlanceHtml',start);
  const cockpit=app.slice(start,end);
  assert.match(app,/import \{ deriveMatchCockpit \} from '\.\/modules\/match-cockpit\.js';/);
  assert.match(cockpit,/deriveMatchCockpit\(d\)/);
  assert.doesNotMatch(cockpit,/\bapi\s*\(/);
  assert.doesNotMatch(cockpit,/fetch\s*\(/);
});

test('RC131 does not turn stale or untrusted injury evidence into a zero-loss claim',()=>{
  for (const meta of [
    trustedFeature({confidenceBearing:false}),
    trustedFeature({stale:true}),
    trustedFeature({provenanceState:'unknown'}),
    {
      available:'true',
      confidenceBearing:'true',
      stale:false,
      provenanceState:'verified',
    },
  ]) {
    assert.equal(cockpitFeatureTrusted(meta),false);

    const model=deriveMatchCockpit({
      providerReliability:{
        features:{injuries:meta},
      },
      absences:{home:[],away:[]},
    });

    assert.equal(model.injuries.confirmed,false);
    assert.equal(model.injuries.homeAbs,0);
    assert.equal(model.injuries.awayAbs,0);
  }

  assert.match(app,/пустой ответ — это не означает «потерь нет»/);
  assert.match(app,/Данные о потерях сейчас не подтверждены/);
});

test('RC131 lineup reliability cannot be overridden by stale structural confirmation',()=>{
  const trusted=trustedFeature();

  const authoritativeFalse=deriveMatchCockpit({
    providerReliability:{
      features:{lineups:trusted},
    },
    lineupImpact:{
      homeConfirmed:false,
      awayConfirmed:false,
    },
    lineups:{
      home:{quality:{confirmed:true}},
      away:{quality:{confirmed:true}},
    },
  });
  assert.equal(authoritativeFalse.lineups.confirmedCount,0);

  const untrusted=deriveMatchCockpit({
    providerReliability:{
      features:{
        lineups:trustedFeature({
          confidenceBearing:false,
          stale:true,
        }),
      },
    },
    lineupImpact:{
      homeConfirmed:true,
      awayConfirmed:true,
    },
    lineups:{
      home:{quality:{confirmed:true}},
      away:{quality:{confirmed:true}},
    },
  });
  assert.equal(untrusted.lineups.confirmedCount,0);

  const structuralFallback=deriveMatchCockpit({
    providerReliability:{
      features:{lineups:trusted},
    },
    lineups:{
      home:{quality:{confirmed:true}},
      away:{quality:{confirmed:false}},
    },
  });
  assert.equal(structuralFallback.lineups.confirmedCount,1);
});

test('RC131 rejects coercive form H2H market and quality values',()=>{
  const model=deriveMatchCockpit({
    recentForm:{
      home:{
        overall:{sample:true,ppg:['2.1']},
        venue:{sample:[],ppg:2},
      },
      away:{
        overall:{sample:5,ppg:1.4},
        venue:{sample:5,ppg:1.1},
      },
    },
    comparison:{
      metrics:[
        {key:'table_rank',homeValue:true,awayValue:5},
      ],
    },
    h2h:{
      homeWins:true,
      draws:1,
      awayWins:1,
    },
    providerReliability:{
      features:{
        odds:trustedFeature(),
      },
    },
    market:{
      odds:{
        home:[2],
        draw:3.1,
        away:4,
      },
    },
    confidence:{score:true},
    completeness:{score:[],max:10},
  });

  assert.equal(model.form.available,false);
  assert.equal(model.venue.available,false);
  assert.equal(model.table.available,false);
  assert.equal(model.h2h,null);
  assert.equal(model.market,null);
  assert.equal(model.quality.confidence,null);
  assert.equal(model.quality.completeness,null);
});

test('RC131 market card requires trusted odds provenance and coherent movement',()=>{
  const unavailable=deriveMatchCockpit({
    providerReliability:{
      features:{
        odds:trustedFeature({
          confidenceBearing:false,
        }),
      },
    },
    market:{
      odds:{home:2,draw:3,away:4},
    },
  });
  assert.equal(unavailable.market,null);

  const incoherent=deriveMatchCockpit({
    providerReliability:{
      features:{odds:trustedFeature()},
    },
    market:{
      odds:{home:2,draw:3,away:4},
    },
    marketMovement:{
      sample:3,
      probabilityChange:{
        home:10,
        draw:10,
        away:10,
      },
    },
  });
  assert.ok(incoherent.market);
  assert.equal(incoherent.market.strongestMove,null);
});

test('RC131 cockpit cards navigate to detailed tabs instead of duplicating screens',()=>{
  assert.match(app,/data-cockpit-tab=/);
  assert.match(app,/querySelectorAll\('\[data-cockpit-tab\]'\)/);
  assert.match(
    app,
    /setAnalysisTab\(btn\.dataset\.cockpitTab \|\| 'overview', true\)/,
  );
});

test('RC131 cockpit stays responsive and uses the existing visual tokens',()=>{
  assert.match(styles,/\.match-cockpit-grid\{display:grid/);
  assert.match(
    styles,
    /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width:560px\)[\s\S]*\.match-cockpit-grid\{grid-template-columns:1fr\}/,
  );
  assert.match(styles,/var\(--accent\)/);
  assert.match(styles,/var\(--line\)/);
});

test('RC131 cockpit capability is exposed by the current app manifest',()=>{
  const runtime=createAppCapabilitiesRuntime({
    memory:{provider:{plan:'FREE'}},
    appVersion:'test',
    minClientVersion:'test',
    apiContractVersion:1,
    releaseChannel:'test',
    releaseCandidate:'test',
    paidQuotaHealthy:()=>false,
    providerPublicBudgetMode:()=>({
      mode:'normal',
      label:'Норма',
      liveRefreshSeconds:30,
    }),
    runtimeControlsSnapshot:()=>({
      maintenanceMode:false,
      liveEnabled:true,
      expandedDataEnabled:true,
    }),
    isSecurityLockdownControls:()=>false,
    publicRuntimeControls:value=>value,
    currentReleaseIdentity:()=>({}),
    now:()=>new Date('2026-10-07T18:00:00.000Z'),
  });

  const manifest=runtime.appManifest({});
  assert.equal(manifest.features.matchAtAGlanceCockpit,true);
});

test('RC131 frontend revision includes the strict cockpit model',()=>{
  const revision=html.match(
    /frontend-asset-revision" content="([^"]+)"/,
  )?.[1];

  assert.equal(revision,'6.120.0-launch70');
  assert.ok(
    html.includes('/app.js?v='+revision),
  );
  assert.doesNotMatch(html,/6\.120\.0-launch51/);
});
