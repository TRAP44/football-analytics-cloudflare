import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATION_MANIFEST_PATH = 'supabase/migration-order.json';
export const DOCTOR_PATH = 'supabase/doctor.sql';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRepoPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function fullSupabasePath(value) {
  const normalized = normalizeRepoPath(value);
  return normalized.startsWith('supabase/') ? normalized : `supabase/${normalized}`;
}

export function gitBlobSha(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return crypto
    .createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

export function migrationVersion(value) {
  const name = path.basename(String(value || ''));
  const match = /^supabase_migration_v(\d+(?:_\d+)*)\.sql$/i.exec(name);
  return match ? match[1].split('_').map(Number) : null;
}

export function compareMigrationVersions(left, right) {
  const length = Math.max(left?.length || 0, right?.length || 0);
  for (let index = 0; index < length; index += 1) {
    const a = left?.[index] || 0;
    const b = right?.[index] || 0;
    if (a !== b) return a - b;
  }
  return 0;
}

function assertStrictNumericOrder(paths, label, failures) {
  const parsed = paths.map((item) => ({
    path: item,
    version: migrationVersion(item),
  }));

  for (const item of parsed) {
    if (!item.version) failures.push(`${label} has invalid migration filename: ${item.path}`);
  }

  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    if (
      previous.version
      && current.version
      && compareMigrationVersions(previous.version, current.version) >= 0
    ) {
      failures.push(
        `${label} is not in strict numeric order: ${previous.path} -> ${current.path}`,
      );
    }
  }
}

function doctorStatements(sql) {
  const withoutBlockComments = String(sql || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  return withoutLineComments
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function loadSupabaseMigrationContract(repoRoot = DEFAULT_REPO_ROOT) {
  const root = path.resolve(repoRoot);
  const releaseContract = readJson(path.join(root, 'release-contract.json'));
  const manifest = readJson(path.join(root, MIGRATION_MANIFEST_PATH));
  const baselinePath = fullSupabasePath(manifest.baseline);
  const historicalMigrations = (manifest.historicalMigrations || [])
    .map((entry) => fullSupabasePath(entry.path));
  const postBaselineMigrations = (manifest.freshInstallAfterBaseline || [])
    .map((entry) => fullSupabasePath(entry.path));

  return {
    repoRoot: root,
    releaseContract,
    manifest,
    baselinePath,
    historicalMigrations,
    postBaselineMigrations,
  };
}

export function validateSupabaseMigrationContract(repoRoot = DEFAULT_REPO_ROOT) {
  const contract = loadSupabaseMigrationContract(repoRoot);
  const {
    releaseContract,
    manifest,
    baselinePath,
    historicalMigrations,
    postBaselineMigrations,
  } = contract;
  const failures = [];

  if (manifest.formatVersion !== 2) {
    failures.push('supabase/migration-order.json formatVersion must be 2.');
  }
  if (manifest.sourceOfTruth !== '../release-contract.json') {
    failures.push('migration-order sourceOfTruth must remain ../release-contract.json.');
  }

  if (releaseContract.freshInstallBaseline !== baselinePath) {
    failures.push(
      `baseline drift: manifest=${baselinePath} release-contract=${releaseContract.freshInstallBaseline}`,
    );
  }

  const latestMigration = postBaselineMigrations.at(-1) || '';
  if (releaseContract.latestMigration !== latestMigration) {
    failures.push(
      `latest migration drift: manifest=${latestMigration} release-contract=${releaseContract.latestMigration}`,
    );
  }

  const expectedQualityStep = 'npm run verify:supabase';
  if (!Array.isArray(releaseContract.qualityGate)
      || !releaseContract.qualityGate.includes(expectedQualityStep)) {
    failures.push('release-contract qualityGate must include npm run verify:supabase.');
  }

  const baselineAbsolute = path.join(contract.repoRoot, baselinePath);
  if (!fs.existsSync(baselineAbsolute)) {
    failures.push(`missing baseline: ${baselinePath}`);
  } else {
    const actualBaselineSha = gitBlobSha(fs.readFileSync(baselineAbsolute));
    if (!/^[a-f0-9]{40}$/.test(String(manifest.baselineGitBlobSha || ''))) {
      failures.push('migration-order baselineGitBlobSha must be a Git blob SHA-1.');
    } else if (actualBaselineSha !== manifest.baselineGitBlobSha) {
      failures.push(
        `baseline was modified without a new baseline contract: expected ${manifest.baselineGitBlobSha}, got ${actualBaselineSha}`,
      );
    }
  }

  const manifestEntries = [
    ...(manifest.historicalMigrations || []),
    ...(manifest.freshInstallAfterBaseline || []),
  ];
  const manifestPaths = manifestEntries.map((entry) => fullSupabasePath(entry.path));
  const duplicates = manifestPaths.filter(
    (value, index) => manifestPaths.indexOf(value) !== index,
  );
  if (duplicates.length) {
    failures.push(`duplicate migration manifest entries: ${[...new Set(duplicates)].join(', ')}`);
  }

  assertStrictNumericOrder(historicalMigrations, 'historicalMigrations', failures);
  assertStrictNumericOrder(postBaselineMigrations, 'freshInstallAfterBaseline', failures);

  if (historicalMigrations.length && postBaselineMigrations.length) {
    const oldLast = migrationVersion(historicalMigrations.at(-1));
    const newFirst = migrationVersion(postBaselineMigrations[0]);
    if (oldLast && newFirst && compareMigrationVersions(oldLast, newFirst) >= 0) {
      failures.push('historical migrations overlap the post-baseline migration range.');
    }
  }

  const migrationsDir = path.join(contract.repoRoot, 'supabase', 'migrations');
  const diskMigrations = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => `supabase/migrations/${entry.name}`)
    .sort();

  const manifestSet = new Set(manifestPaths);
  const untrackedMigrations = diskMigrations.filter((item) => !manifestSet.has(item));
  const missingMigrations = manifestPaths.filter(
    (item) => !fs.existsSync(path.join(contract.repoRoot, item)),
  );

  if (untrackedMigrations.length) {
    failures.push(
      `migration-order is missing SQL file(s): ${untrackedMigrations.join(', ')}`,
    );
  }
  if (missingMigrations.length) {
    failures.push(
      `migration-order references missing SQL file(s): ${missingMigrations.join(', ')}`,
    );
  }

  for (const entry of manifestEntries) {
    const repoPath = fullSupabasePath(entry.path);
    const absolute = path.join(contract.repoRoot, repoPath);
    if (!fs.existsSync(absolute)) continue;
    if (!/^[a-f0-9]{40}$/.test(String(entry.gitBlobSha || ''))) {
      failures.push(`${repoPath} is missing a valid gitBlobSha.`);
      continue;
    }

    const actual = gitBlobSha(fs.readFileSync(absolute));
    if (actual !== entry.gitBlobSha) {
      failures.push(
        `immutable migration changed: ${repoPath}; expected ${entry.gitBlobSha}, got ${actual}. Add a forward migration instead.`,
      );
    }
  }

  const doctorAbsolute = path.join(contract.repoRoot, DOCTOR_PATH);
  if (!fs.existsSync(doctorAbsolute)) {
    failures.push(`missing read-only doctor: ${DOCTOR_PATH}`);
  } else {
    const statements = doctorStatements(fs.readFileSync(doctorAbsolute, 'utf8'));
    for (const statement of statements) {
      if (!/^(select|with)\b/i.test(statement)) {
        failures.push(
          `doctor.sql must remain read-only; unsupported statement starts with: ${statement.slice(0, 48)}`,
        );
      }
    }
  }

  const packageJson = readJson(path.join(contract.repoRoot, 'package.json'));
  if (packageJson.scripts?.['verify:supabase'] !== 'node scripts/verify-supabase-contract.js') {
    failures.push('package.json must define verify:supabase.');
  }

  const qualityPath = path.join(contract.repoRoot, '.github', 'workflows', 'quality.yml');
  const quality = fs.readFileSync(qualityPath, 'utf8');
  if (!quality.includes('- run: npm run verify:supabase')) {
    failures.push('Quality workflow must execute npm run verify:supabase.');
  }

  if (failures.length) {
    const error = new Error(
      ['Supabase repository contract failed:', ...failures.map((item) => `- ${item}`)].join('\n'),
    );
    error.failures = failures;
    throw error;
  }

  return {
    ...contract,
    migrationCount: manifestPaths.length,
    latestMigration,
    doctorReadOnly: true,
  };
}

function main() {
  const repoRoot = process.argv[2] || DEFAULT_REPO_ROOT;
  const result = validateSupabaseMigrationContract(repoRoot);
  console.log(
    `Supabase repository contract passed: ${result.migrationCount} migrations; latest ${result.latestMigration}.`,
  );
}

const isCli = process.argv[1]
  && path.resolve(process.argv[1]) === SCRIPT_PATH;

if (isCli) {
  try {
    main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(1);
  }
}
