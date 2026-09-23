import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC80 records only real recovery attempts',()=>{
  assert.match(worker,/eventName:'news_impact_recovery_attempt'/);
  assert.match(worker,/function newsImpactRecoveryCallback\(/);
  assert.match(worker,/\^ni:r:/);
  assert.match(worker,/if \(recoveryCode\) await recordNewsImpactRecoveryAttempt/);
  assert.match(worker,/if \(newsImpactRecoveryCode\) \{[\s\S]{0,260}recordNewsImpactRecoveryAttempt/);
});

test('RC80 deduplicates repeated clicks by latest recovery journey',()=>{
  assert.match(worker,/function newsImpactRecoveryJourneyKey\(/);
  assert.match(worker,/const latestAttempts=new Map\(\)/);
  assert.match(worker,/attemptAt>previous\.attemptAt/);
  assert.match(worker,/base && recovery \? /);
});

test('RC80 requires a post-attempt confirmed delivery inside the maturity window',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_WINDOW_MINUTES = 5/);
  assert.match(worker,/event\.at>=item\.attemptAt && event\.at<=item\.attemptAt\+windowMs/);
  assert.match(worker,/state='recovered'/);
  assert.match(worker,/else if \(failure\) \{ state='failed'/);
  assert.match(worker,/item\.attemptAt<=asOfMs-windowMs/);
});

test('RC80 tracks full-AI fallback attribution through Mini App launch params',()=>{
  assert.match(worker,/function newsImpactRecoveryAnalysisUrl\(/);
  assert.match(worker,/newsImpactRecoveryCode:r/);
  assert.match(app,/newsImpactRecoveryCode:String\(options\.newsImpactRecoveryCode/);
  assert.match(app,/params\.get\('newsImpactRecoveryCode'\)/);
  assert.match(app,/newsImpactRecoveryFrom/);
});

test('RC80 admin UI keeps pending out of premature failure conclusions',()=>{
  assert.match(app,/Recovery → подтверждённый результат/);
  assert.match(app,/только реальные повторные попытки/);
  assert.match(app,/ещё ожидают/);
  assert.match(app,/Сам показ fallback или повторной кнопки успехом не считается/);
});

test('RC80 sample-aware recovery ranking and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryBest\(/);
  assert.match(worker,/confidence\?\.eligibleForBottleneck/);
  assert.match(worker,/function newsImpactRecoveryEffectivenessDrill\(/);
  assert.match(worker,/newsImpactRecoveryEffectivenessSelfTest: newsImpactRecoveryEffectivenessDrill\(\)\.pass \? 'enabled' : 'failed'/);
});

test('RC80 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|rc80/i.test(x)));
});
