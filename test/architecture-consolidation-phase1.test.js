import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function fileUrl(path) {
  return new URL('../' + path, import.meta.url);
}

function read(path) {
  return readFileSync(fileUrl(path),'utf8');
}

function exists(path) {
  return existsSync(fileUrl(path));
}

function releaseContract() {
  return JSON.parse(read('release-contract.json'));
}

test('fresh-install baseline path is owned by the release contract and remains frozen at v6.19',()=>{
  const contract=releaseContract();

  assert.equal(contract.productionSchema,'6.29');
  assert.equal(contract.freshInstallBaseline,'supabase/baseline/supabase_baseline_v6_19.sql');
  assert.equal(exists(contract.freshInstallBaseline),true);

  const sql=read(contract.freshInstallBaseline);
  assert.match(sql,/HISTORICAL \/ FROZEN BOOTSTRAP CONTRACT/);
  assert.match(sql,/Fresh-install baseline refused/);

  for(const token of [
    'analysis_cache',
    'provider text',
    'source_updated_at',
    'freshness_status',
    'bookmaker_count',
    'data_provenance',
    'model_inputs_version',
  ]) {
    assert.match(sql,new RegExp(token));
  }

  const guard=sql.indexOf('Fresh-install baseline refused');
  const firstSchemaMutation=Math.min(
    ...['create table','alter table','create or replace function']
      .map(token=>sql.toLowerCase().indexOf(token))
      .filter(index=>index>=0),
  );
  assert.ok(guard>=0 && guard<firstSchemaMutation,'fresh-install safety guard must run before schema mutation');
});

test('release contract paths exist and documentation mirrors the exact current contract',()=>{
  const contract=releaseContract();
  const readme=read('supabase/README.md');
  const install=read('INSTALL_RU.md');

  assert.equal(exists(contract.freshInstallBaseline),true);
  assert.equal(exists(contract.latestMigration),true);

  for(const document of [readme,install]) {
    assert.match(document,new RegExp(contract.productionSchema.replaceAll('.','\\.')));
    assert.ok(
      document.includes(contract.freshInstallBaseline),
      'documentation must name the exact fresh-install baseline from release-contract.json',
    );
    assert.ok(
      document.includes(contract.latestMigration),
      'documentation must name the exact latest migration from release-contract.json',
    );
  }

  assert.match(readme,/приоритет всегда имеет `\/release-contract\.json`/);
  assert.match(install,/Актуальные версии и требования всегда смотрите в `release-contract\.json`/);
});

test('install guide mirrors current application and runtime versions from release contract',()=>{
  const contract=releaseContract();
  const install=read('INSTALL_RU.md');

  assert.ok(install.includes(`приложение: \`${contract.applicationVersion}\``));
  assert.ok(install.includes(`runtime: \`${contract.runtimeVersion}\``));
  assert.ok(install.includes(`schema: \`${contract.productionSchema}\``));
});

test('fresh-install baseline includes every additive v6.19 column before forward migrations begin',()=> {
  const migration=read('supabase/migrations/supabase_migration_v6_19.sql');
  const baseline=read(releaseContract().freshInstallBaseline);
  const columns=[...migration.matchAll(
    /add\s+column\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)/gi,
  )].map(match=>match[1]);

  assert.ok(columns.length>0,'v6.19 migration must expose schema additions');
  for(const column of new Set(columns)) {
    assert.match(
      baseline,
      new RegExp('\\b'+column+'\\b','i'),
      'baseline missing v6.19 column '+column,
    );
  }
});

test('public feedback copy hides internal beta/severity terminology while keeping stable machine values',()=>{
  const html=read('public/index.html');
  const start=html.indexOf('<section class="panel profile-about-service">');
  const end=html.indexOf('<nav class="bottom-nav"',start);

  assert.ok(start>=0,'public service panel missing');
  assert.ok(end>start,'public service panel boundary missing');

  const publicFeedback=html.slice(start,end);
  assert.match(publicFeedback,/Сообщить о проблеме/);
  assert.match(publicFeedback,/>\s*Важность\s*</);
  assert.match(publicFeedback,/>\s*Работает нестабильно или непонятно\s*</);
  assert.match(publicFeedback,/>\s*Основной функцией невозможно пользоваться\s*</);
  assert.match(publicFeedback,/>\s*Визуальный или небольшой недочёт\s*</);

  // Stable values remain implementation details; raw labels must not be user-facing copy.
  assert.match(publicFeedback,/value="MAJOR"/);
  assert.match(publicFeedback,/value="BLOCKER"/);
  assert.match(publicFeedback,/value="MINOR"/);
  assert.doesNotMatch(publicFeedback,/Closed beta|Beta Dashboard/i);
  assert.doesNotMatch(publicFeedback,/>\s*(?:BLOCKER|MAJOR|MINOR)\s*</i);
});

test('admin beta dashboard stays lazy-loaded behind an admin check',()=>{
  const app=read('public/app.js');
  const start=app.indexOf('async function ensureAdminBetaDashboardModule()');
  const end=app.indexOf('function renderBetaDashboard()',start);
  assert.ok(start>=0 && end>start,'admin beta dashboard loader missing');

  const loader=app.slice(start,end);
  const guard=loader.indexOf('if (!isAdmin()) return null');
  const dynamicImport=loader.indexOf("import('./modules/admin-beta-dashboard.js')");

  assert.ok(guard>=0,'admin guard missing');
  assert.ok(dynamicImport>guard,'admin module must not load before the role guard');
  assert.doesNotMatch(
    app.slice(0,start),
    /from ['"]\.\/modules\/admin-beta-dashboard\.js['"]/,
  );
});

test('release contract keeps public access and production baseline safety explicit',()=>{
  const contract=releaseContract();

  assert.equal(contract.accessContract,'public-telegram-validated-by-default');
  assert.equal(contract.strictBeta,'opt-in-only-when-BETA_ACCESS_ENABLED=true');
  assert.equal(
    contract.productionDatabaseRule,
    'never-run-fresh-install-baseline-over-existing-production',
  );
  assert.ok(Array.isArray(contract.qualityGate));
  for(const command of [
    'npm run security:scan',
    'npm run check',
    'npm test',
    'npm run lint',
    'npm run verify:release',
    'npm run verify:worker',
  ]) {
    assert.ok(contract.qualityGate.includes(command),command);
  }
});
