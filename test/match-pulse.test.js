import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  deriveMatchPulse,
  renderMatchPulse,
} from '../public/modules/match-pulse.js';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');
const source=fs.readFileSync('public/modules/match-pulse.js','utf8');

function trustedMeta(feature) {
  return {
    feature,
    confidenceBearing:true,
    stale:false,
    provenanceState:'verified',
  };
}

function payload(overrides = {}) {
  return {
    mode:'live',
    match:{
      home:{name:'Arsenal'},
      away:{name:'Chelsea'},
      score:{home:1,away:0},
      elapsed:64,
    },
    ...overrides,
  };
}

function withTrust(data,features=[]) {
  const availability={...(data.availability || {})};
  const dataFreshness={...(data.dataFreshness || {})};
  for (const feature of features) {
    availability[feature]=true;
    dataFreshness[feature]=trustedMeta(feature);
  }
  return {
    ...data,
    availability,
    dataFreshness,
  };
}

test('Match Pulse hides completely when Match Center has no trusted usable signal', () => {
  assert.equal(
    deriveMatchPulse(payload({mode:'upcoming'})),
    null,
  );
  assert.equal(
    renderMatchPulse(payload({mode:'upcoming'})),
    '',
  );

  assert.equal(
    deriveMatchPulse(payload({
      livePressure:{home:70,away:30},
      statistics:{
        items:[{key:'Shots on Goal',home:8,away:2}],
      },
      events:[{minute:61,type:'Goal',side:'home'}],
      oddsMovement:{
        sample:2,
        probabilityChange:{home:3,draw:-1,away:-2},
      },
    })),
    null,
  );
});

test('statistics boundary rejects malformed containers and coercive values', () => {
  assert.doesNotThrow(()=>
    deriveMatchPulse(withTrust(payload({
      statistics:{items:{key:'Ball Possession',home:58,away:42}},
    }),['statistics'])),
  );
  assert.equal(
    deriveMatchPulse(withTrust(payload({
      statistics:{items:{key:'Ball Possession',home:58,away:42}},
    }),['statistics'])),
    null,
  );

  assert.equal(
    deriveMatchPulse(withTrust(payload({
      statistics:{
        items:[
          {key:'Shots on Goal',home:[6],away:true},
          {key:'Ball Possession',home:[58],away:['42%']},
        ],
      },
    }),['statistics'])),
    null,
  );
});

test('partial statistics never promote non-confidence-bearing xG into Match Pulse', () => {
  const pulse=deriveMatchPulse(withTrust(payload({
    statistics:{
      items:[
        {key:'expected_goals',home:1.2,away:null},
        {key:'Ball Possession',home:'58%',away:'42%'},
      ],
    },
    availability:{xg:false},
    xgQuality:{confidenceBearing:false},
    statisticsQuality:{state:'partial'},
  }),['statistics']));

  assert.ok(pulse);
  assert.deepEqual(
    pulse.metrics.map(metric=>metric.key),
    ['possession'],
  );
  assert.ok(pulse.flags.includes('Частичная статистика'));
  assert.ok(pulse.flags.includes('xG частичный'));
  assert.doesNotMatch(
    renderMatchPulse(withTrust(payload({
      statistics:{
        items:[{key:'Ball Possession',home:58,away:42}],
      },
    }),['statistics'])),
    /data-pulse-metric="xg"/,
  );
});

test('trusted live mode uses pressure xG shots and time-ordered important events', () => {
  const data=withTrust(payload({
    livePressure:{home:64,away:36,leader:'home'},
    statistics:{
      items:[
        {key:'expected_goals',home:1.62,away:0.71},
        {key:'Shots on Goal',home:6,away:2},
        {key:'Ball Possession',home:'57%',away:'43%'},
      ],
    },
    availability:{xg:true},
    xgQuality:{confidenceBearing:true},
    events:[
      {
        time:{elapsed:61},
        type:'Card',
        detail:'Red Card',
        side:'away',
        player:'B. Player',
      },
      {
        time:{elapsed:18},
        type:'Goal',
        side:'home',
        player:'A. Player',
      },
    ],
  }),['statistics','events']);

  const pulse=deriveMatchPulse(data);
  assert.equal(pulse.mode,'live');
  assert.equal(pulse.pressure.home,64);
  assert.equal(pulse.pressure.away,36);
  assert.match(pulse.leaderText,/Arsenal/);
  assert.deepEqual(
    pulse.metrics.map(metric=>metric.key),
    ['xg','shots-on','possession'],
  );
  assert.equal(pulse.change.label,'Последнее событие');
  assert.match(pulse.change.text,/61′/);
  assert.match(pulse.change.text,/Красная карточка/);
  assert.equal(pulse.timeline.length,2);
  assert.match(pulse.timeline[0].minute,/18′/);
  assert.match(pulse.timeline[1].minute,/61′/);

  const rendered=renderMatchPulse(data);
  assert.match(rendered,/MATCH PULSE/);
  assert.match(rendered,/aria-label="Match Pulse./);
  assert.match(rendered,/width:64.00%/);
});

test('finished mode keeps an honest final snapshot without inventing momentum', () => {
  const data=withTrust(payload({
    mode:'finished',
    livePressure:null,
    statistics:{
      items:[{key:'Shots on Goal',home:8,away:4}],
    },
  }),['statistics']);

  const pulse=deriveMatchPulse(data);
  assert.ok(pulse);
  assert.equal(pulse.modeLabel,'ФИНАЛ');
  assert.match(pulse.leaderText,/Итоговая картина/);
  assert.equal(pulse.pressure,null);
  assert.doesNotMatch(renderMatchPulse(data),/momentum/i);
});

test('pressure requires both bounded sides and a coherent pair instead of clamping bad input', () => {
  const equal=deriveMatchPulse(withTrust(payload({
    livePressure:{home:50,away:50},
  }),['statistics']));
  assert.equal(equal.pressure.leader,'equal');
  assert.equal(equal.leaderText,'Баланс по индексу давления');

  for (const livePressure of [
    {home:140,away:-20},
    {home:80,away:30},
    {home:64},
    {home:[64],away:36},
    {home:true,away:99},
  ]) {
    assert.equal(
      deriveMatchPulse(withTrust(payload({livePressure}),['statistics'])),
      null,
    );
  }
});

test('stale or unverified live evidence cannot look current', () => {
  const stale=payload({
    stale:true,
    livePressure:{home:60,away:40},
    statistics:{
      items:[{key:'Shots on Goal',home:6,away:2}],
    },
    events:[{minute:55,type:'Goal',side:'home'}],
    availability:{statistics:true,events:true},
    dataFreshness:{
      statistics:{
        confidenceBearing:true,
        stale:true,
        provenanceState:'verified',
      },
      events:{
        confidenceBearing:false,
        stale:true,
        provenanceState:'verified',
      },
    },
  });

  assert.equal(deriveMatchPulse(stale),null);
  assert.equal(renderMatchPulse(stale),'');
});

test('team names remain escaped and bounded on trusted pressure data', () => {
  const home='Очень длинное название футбольного клуба <Home>';
  const away='Ещё более длинное название клуба & Away';
  const data=withTrust(payload({
    match:{home:{name:home},away:{name:away}},
    livePressure:{home:52,away:48},
  }),['statistics']);

  const pulse=deriveMatchPulse(data);
  assert.ok(pulse);
  const rendered=renderMatchPulse(data);
  assert.match(rendered,/&lt;Home&gt;/);
  assert.match(rendered,/&amp; Away/);
  assert.match(
    css,
    /.match-pulse-team{[sS]*?min-width:0[sS]*?overflow-wrap:anywhere/,
  );
});

test('market movement requires trusted coherent history and Smart Insights need trusted context', () => {
  const market=deriveMatchPulse(withTrust(payload({
    oddsMovement:{
      sample:2,
      probabilityChange:{home:2.4,draw:-0.6,away:-1.8},
    },
  }),['liveOdds']));
  assert.equal(market.change.label,'Рынок');
  assert.equal(market.change.text,'Arsenal: +2.4 п.п.');

  for (const probabilityChange of [
    {home:[2.4],draw:-0.6,away:-1.8},
    {home:2.4,draw:-0.6},
    {home:10,draw:10,away:10},
  ]) {
    assert.equal(
      deriveMatchPulse(withTrust(payload({
        oddsMovement:{sample:2,probabilityChange},
      }),['liveOdds'])),
      null,
    );
  }

  assert.equal(
    deriveMatchPulse(withTrust(payload({
      oddsMovement:{
        sample:1,
        probabilityChange:{home:2.4,draw:-0.6,away:-1.8},
      },
    }),['liveOdds'])),
    null,
  );

  const insight=deriveMatchPulse(withTrust(payload({
    smartInsights:{
      available:true,
      headline:'Хозяева чаще доходят до опасных зон',
      insights:[],
    },
  }),['statistics']));
  assert.equal(insight.change.label,'Инсайт');
  assert.match(insight.change.text,/опасных зон/);

  assert.equal(
    deriveMatchPulse(payload({
      smartInsights:{
        available:true,
        headline:'Неподтверждённый вывод',
      },
    })),
    null,
  );
});

test('Match Pulse source keeps strict freshness and scalar boundaries', () => {
  assert.match(source,/Array.isArray(statistics?.items)/);
  assert.match(source,/typeof value==='string'/);
  assert.match(source,/provenanceState/);
  assert.match(source,/confidenceBearing===true/);
  assert.match(source,/meta?.stale!==true/);
  assert.match(source,/Math.abs(home+away-100)>2/);
  assert.match(source,/source?.sample,2,100000/);
  assert.match(source,/rows.reduce((sum,row)=>sum+row.value,0)/);
  assert.doesNotMatch(
    source,
    /lasts*10|последние 10 минут|fake|synthetic momentum/i,
  );
});

test('Match Pulse integration stays below scoreboard without creating a new tab', () => {
  const start=app.indexOf('function renderMatchCenter');
  const end=app.indexOf('async function openMatchCenter',start);
  const center=app.slice(start,end);

  assert.match(
    app,
    /import\('\.\/modules\/match-pulse\.js\?v=6\.120\.0-launch54'\)/,
  );
  const pulseRender=center.indexOf('${matchPulseHtml}');
  assert.ok(pulseRender>=0);
  assert.ok(center.indexOf('center-scoreboard')<pulseRender);
  assert.ok(pulseRender<center.indexOf('match-center-primary'));
  assert.equal(
    (center.match(/data-center-tab="pulse"/g) || []).length,
    0,
  );
  assert.doesNotMatch(center,/livePressureHtml(/);
});

test('mobile rules cover 320 360 375 390 430 without horizontal Match Pulse scroll', () => {
  for (const width of [320,360,375,390,430]) {
    assert.match(
      css,
      new RegExp('@media\\(max-width:'+width+'px\\)'),
    );
  }
  assert.match(
    css,
    /.match-pulse{[sS]*?min-width:0[sS]*?overflow:hidden/,
  );
  assert.match(
    css,
    /.match-pulse-metrics{[sS]*?minmax(0,1fr)/,
  );
  assert.match(
    css,
    /.match-pulse-timeline{[sS]*?minmax(0,1fr)/,
  );
  assert.doesNotMatch(
    css.slice(css.indexOf('/* Match Pulse — Issue #286 */')),
    /overflow-xs*:s*(auto|scroll)/,
  );
});

test('Match Pulse keeps navigation onboarding and frontend revision contracts intact', () => {
  assert.match(
    html,
    /id="navMatches"[sS]*id="navMyTeams"[sS]*id="navHistory"[sS]*id="navProfile"/,
  );
  assert.match(app,/class="center-tabs"/);
  assert.match(app,/data-center-tab="summary"/);
  assert.match(app,/smart-open-insights/);
  assert.match(app,/details.open = true/);
  assert.match(html,/id="firstRunGuide"/);
  assert.match(html,/id="firstRunGuideSearch"/);
  assert.match(html,/id="firstRunGuideFavorite"/);

  const revision=html.match(
    /frontend-asset-revision" content="([^"]+)"/,
  )?.[1];
  assert.equal(revision,'6.120.0-launch54');
  assert.match(
    html,
    /<script type="module" src="/app.js?v=6.120.0-launch54"></script>/,
  );
});
