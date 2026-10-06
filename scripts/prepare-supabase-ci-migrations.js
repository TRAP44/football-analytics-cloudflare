import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FRESH_BASELINE = 'supabase/baseline/supabase_baseline_v6_19.sql';

export const POST_BASELINE_MIGRATIONS = Object.freeze([
  'supabase/migrations/supabase_migration_v6_20.sql',
  'supabase/migrations/supabase_migration_v6_21.sql',
  'supabase/migrations/supabase_migration_v6_21_1.sql',
  'supabase/migrations/supabase_migration_v6_21_2.sql',
  'supabase/migrations/supabase_migration_v6_21_3.sql',
  'supabase/migrations/supabase_migration_v6_22.sql',
  'supabase/migrations/supabase_migration_v6_23.sql',
  'supabase/migrations/supabase_migration_v6_24.sql',
  'supabase/migrations/supabase_migration_v6_25.sql',
  'supabase/migrations/supabase_migration_v6_25_1.sql',
  'supabase/migrations/supabase_migration_v6_25_2.sql',
  'supabase/migrations/supabase_migration_v6_26.sql',
  'supabase/migrations/supabase_migration_v6_26_1.sql',
  'supabase/migrations/supabase_migration_v6_26_2.sql',
  'supabase/migrations/supabase_migration_v6_26_3.sql',
  'supabase/migrations/supabase_migration_v6_27.sql',
  'supabase/migrations/supabase_migration_v6_27_1.sql',
  'supabase/migrations/supabase_migration_v6_27_2.sql',
  'supabase/migrations/supabase_migration_v6_27_3.sql',
  'supabase/migrations/supabase_migration_v6_28.sql',
  'supabase/migrations/supabase_migration_v6_29.sql',
  'supabase/migrations/supabase_migration_v6_29_1.sql',
  'supabase/migrations/supabase_migration_v6_29_2.sql',
  'supabase/migrations/supabase_migration_v6_29_3.sql',
  'supabase/migrations/supabase_migration_v6_29_4.sql',
  'supabase/migrations/supabase_migration_v6_29_5.sql',
  'supabase/migrations/supabase_migration_v6_29_6.sql',
  'supabase/migrations/supabase_migration_v6_29_7.sql',
  'supabase/migrations/supabase_migration_v6_29_8.sql',
  'supabase/migrations/supabase_migration_v6_29_9.sql',
]);

function timestampForIndex(index) {
  return '2026010100' + String(index).padStart(2, '0') + '00';
}

function migrationVersion(source) {
  const name=path.basename(String(source || ''));
  const match=/^supabase_migration_v(\d+(?:_\d+)*)\.sql$/i.exec(name);
  if (!match) return null;
  return match[1].split('_').map(Number);
}

function compareVersions(a,b) {
  const length=Math.max(a.length,b.length);
  for (let i=0;i<length;i+=1) {
    const left=a[i] || 0;
    const right=b[i] || 0;
    if (left !== right) return left-right;
  }
  return 0;
}

export function buildMigrationPlan(mode = 'fresh') {
  if (!['fresh', 'upgrade-base', 'latest-only'].includes(mode)) {
    throw new Error('Unsupported Supabase CI migration mode: ' + mode);
  }

  const latest = POST_BASELINE_MIGRATIONS.at(-1);
  let sources;
  if (mode === 'latest-only') {
    sources = [latest];
  } else {
    const postBaseline = mode === 'upgrade-base'
      ? POST_BASELINE_MIGRATIONS.slice(0, -1)
      : POST_BASELINE_MIGRATIONS;
    sources = [FRESH_BASELINE, ...postBaseline];
  }

  return sources.map((source, index) => {
    const canonicalIndex = source === latest && mode === 'latest-only'
      ? POST_BASELINE_MIGRATIONS.length
      : index;
    const version = timestampForIndex(canonicalIndex);
    const baseName = path.basename(source).replace(/\.sql$/i, '');
    return {
      source,
      version,
      filename: version + '_' + baseName + '.sql',
    };
  });
}

export function validateMigrationPlan(repoRoot, releaseContract) {
  if (new Set(POST_BASELINE_MIGRATIONS).size !== POST_BASELINE_MIGRATIONS.length) {
    throw new Error('POST_BASELINE_MIGRATIONS contains duplicate entries.');
  }
  if (releaseContract.freshInstallBaseline !== FRESH_BASELINE) {
    throw new Error(
      'release-contract freshInstallBaseline drift: '
        + releaseContract.freshInstallBaseline,
    );
  }
  if (releaseContract.latestMigration !== POST_BASELINE_MIGRATIONS.at(-1)) {
    throw new Error(
      'release-contract latestMigration drift: ' + releaseContract.latestMigration,
    );
  }

  for (const item of buildMigrationPlan('fresh')) {
    const sourcePath = path.join(repoRoot, item.source);
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Missing Supabase CI migration source: ' + item.source);
    }
  }

  const migrationsDir=path.join(repoRoot,'supabase','migrations');
  const latestVersion=migrationVersion(releaseContract.latestMigration);
  if (!latestVersion) {
    throw new Error('release-contract latestMigration has an invalid filename.');
  }
  const newerFiles=fs.readdirSync(migrationsDir,{withFileTypes:true})
    .filter(entry=>entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry=>({name:entry.name,version:migrationVersion(entry.name)}))
    .filter(item=>item.version && compareVersions(item.version,latestVersion)>0)
    .map(item=>item.name)
    .sort();
  if (newerFiles.length) {
    throw new Error(
      'Supabase migration(s) newer than release-contract latestMigration: '
        + newerFiles.join(', '),
    );
  }
}

export function stageMigrationPlan({
  repoRoot,
  targetDir,
  mode = 'fresh',
  clear = true,
}) {
  const contract = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'release-contract.json'), 'utf8'),
  );
  validateMigrationPlan(repoRoot, contract);

  if (clear) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const plan = buildMigrationPlan(mode);
  for (const item of plan) {
    fs.copyFileSync(
      path.join(repoRoot, item.source),
      path.join(targetDir, item.filename),
    );
  }
  return plan;
}

function main() {
  const [mode, targetDir, repoRoot = process.cwd()] = process.argv.slice(2);
  if (!mode || !targetDir) {
    throw new Error(
      'Usage: node scripts/prepare-supabase-ci-migrations.js '
        + '<fresh|upgrade-base|latest-only> <targetDir> [repoRoot]',
    );
  }

  const plan = stageMigrationPlan({
    repoRoot: path.resolve(repoRoot),
    targetDir: path.resolve(targetDir),
    mode,
    clear: mode !== 'latest-only',
  });

  console.log(
    'Prepared ' + plan.length
      + ' deterministic Supabase CI migration file(s) for ' + mode + '.',
  );
}

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(1);
  }
}
