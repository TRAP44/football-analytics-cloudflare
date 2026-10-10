import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../public/modules/match-center-view.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function sourceBetween(startNeedle, endNeedle) {
  const start = app.indexOf(startNeedle);
  const end = app.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  assert.ok(end > start, `missing boundary ${endNeedle}`);
  return app.slice(start, end);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;',
  })[char]);
}

function narrativeRenderer() {
  const source=sourceBetween(
    'function matchChangeNarrativeHtml',
    'function smartInsightsHeroHtml',
  );
  return new Function(
    'minuteLabel',
    'publicText',
    'signedPp',
    'escapeHtml',
    `${source}; return matchChangeNarrativeHtml;`,
  )(
    event => {
      const minute=Number(event?.minute);
      const extra=Number(event?.extra || 0);
      return Number.isFinite(minute)
        ? extra>0 ? `${minute}+${extra}′` : `${minute}′`
        : '—';
    },
    value => typeof value === 'string' ? value : String(value ?? ''),
    value => {
      const number=Number(value);
      return Number.isFinite(number)
        ? `${number>0?'+':''}${number.toFixed(1)} п.п.`
        : '—';
    },
    escapeHtml,
  );
}

function trustedFeature() {
  return {
    confidenceBearing:true,
    stale:false,
    provenanceState:'verified',
  };
}

const match={
  home:{name:'Home'},
  away:{name:'Away'},
};

test('Match Radar change narrative requires trusted current evidence', () => {
  const render=narrativeRenderer();

  const staleEvent=render({
    mode:'live',
    events:[{
      minute:55,
      extra:0,
      side:'home',
      type:'Goal',
      detail:'Normal Goal',
      label:'⚽ Гол',
      player:'Player',
    }],
    availability:{events:false},
    dataFreshness:{
      events:{
        confidenceBearing:false,
        stale:true,
        provenanceState:'verified',
      },
    },
  },match);

  assert.equal(staleEvent,'');

  const trustedEvent=render({
    mode:'live',
    events:[
      {minute:70,extra:0,side:'away',type:'Goal',label:'⚽ Гол'},
      {minute:50,extra:0,side:'home',type:'Card',label:'🟨 Карточка'},
    ],
    availability:{events:true},
    dataFreshness:{events:trustedFeature()},
  },match);

  assert.match(trustedEvent,/Что изменилось/);
  assert.match(trustedEvent,/70′/);
  assert.doesNotMatch(trustedEvent,/50′ · 🟨 Карточка/);
});

test('current pressure is described as state, not invented temporal change', () => {
  const render=narrativeRenderer();

  const html=render({
    mode:'live',
    livePressure:{home:68,away:32,leader:'away'},
    availability:{statistics:true},
    dataFreshness:{statistics:trustedFeature()},
  },match);

  assert.match(html,/Что важно сейчас/);
  assert.match(html,/Давление сейчас на стороне: Home/);
  assert.doesNotMatch(html,/усилил давление/);
  assert.doesNotMatch(html,/<h2>Что изменилось<\/h2>/);
});

test('market movement rejects coercive or incoherent probability deltas', () => {
  const render=narrativeRenderer();
  const base={
    mode:'live',
    availability:{liveOdds:true},
    dataFreshness:{liveOdds:trustedFeature()},
  };

  assert.equal(
    render({
      ...base,
      oddsMovement:{
        sample:2,
        probabilityChange:{home:[4],draw:-1,away:-3},
      },
    },match),
    '',
  );

  assert.equal(
    render({
      ...base,
      oddsMovement:{
        sample:2,
        probabilityChange:{home:10,draw:10,away:10},
      },
    },match),
    '',
  );

  const valid=render({
    ...base,
    oddsMovement:{
      sample:2,
      probabilityChange:{home:4,draw:-1,away:-3},
    },
  },match);

  assert.match(valid,/Изменилась оценка: Home/);
  assert.match(valid,/\+4\.0 п\.п\./);
});

test('upcoming absences require trusted freshness and are not mislabeled as a detected change', () => {
  const render=narrativeRenderer();
  const absences={
    home:[{name:'A'}],
    away:[{name:'B'}],
  };

  const stale=render({
    mode:'upcoming',
    absences,
    availability:{injuries:true},
    dataFreshness:{
      injuries:{
        confidenceBearing:true,
        stale:true,
        provenanceState:'verified',
      },
    },
  },match);
  assert.equal(stale,'');

  const trusted=render({
    mode:'upcoming',
    absences,
    availability:{injuries:true},
    dataFreshness:{injuries:trustedFeature()},
  },match);

  assert.match(trusted,/Что важно сейчас/);
  assert.match(trusted,/Отмечены подтверждённые потери состава/);
  assert.doesNotMatch(trusted,/Есть изменения по доступности игроков/);
});

test('change narrative keeps strict signal boundaries in source', () => {
  const source=sourceBetween(
    'function matchChangeNarrativeHtml',
    'function smartInsightsHeroHtml',
  );

  assert.match(source,/d\?\.availability\?\.\[key\] === true/);
  assert.match(source,/meta\?\.confidenceBearing === true/);
  assert.match(source,/meta\?\.stale !== true/);
  assert.match(source,/provenanceState/);
  assert.match(source,/Number\.isSafeInteger\(minute\)/);
  assert.match(source,/Math\.abs\(home \+ away - 100\) <= 2/);
  assert.match(source,/rows\.reduce\(\(sum,row\)=>sum\+row\.value,0\)/);
  assert.doesNotMatch(source,/Math\.random/);
  assert.doesNotMatch(source,/homeProbability|drawProbability|awayProbability/);
});

test('What changed appears before AI and detailed Match Center data', () => {
  const source = sourceBetween('export function renderMatchCenterView', '// end renderMatchCenterView');
  const changes = source.indexOf('matchChangeNarrativeHtml(d, m)');
  const liveAi = source.indexOf('liveAiCoachHtml(d.liveAiCoach, m)');
  const details = source.indexOf('data-center-panel="summary"');
  assert.ok(changes >= 0);
  assert.ok(liveAi > changes);
  assert.ok(details > liveAi);
});

test('Match Intelligence assets use the current frontend revision', () => {
  assert.match(styles, /Match Intelligence/);
  assert.match(styles, /\.match-change-panel\s*\{/);
  assert.match(styles, /\.match-change-item\s*\{/);

  const revision=index.match(
    /frontend-asset-revision" content="([^"]+)"/,
  )?.[1];
  assert.equal(revision,'6.120.0-launch79');
  for (const asset of [
    'styles.css',
    'styles/public-shell.css',
    'styles/premium-ui.css',
    'app.js',
  ]) {
    assert.ok(index.includes('/'+asset+'?v='+revision),asset);
  }
});
