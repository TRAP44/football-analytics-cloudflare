import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadSupabaseMigrationContract,
  validateSupabaseMigrationContract,
} from './verify-supabase-contract.js';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const DEFAULT_CONTRACT = loadSupabaseMigrationContract(DEFAULT_REPO_ROOT);

export const FRESH_BASELINE = DEFAULT_CONTRACT.baselinePath;
export const POST_BASELINE_MIGRATIONS = Object.freeze([
  ...DEFAULT_CONTRACT.postBaselineMigrations,
]);

function timestampForIndex(index) {
  return '2026010100' + String(index).padStart(2, '0') + '00';
}

export function buildMigrationPlan(mode = 'fresh', repositoryContract = null) {
  if (!['fresh', 'upgrade-base', 'latest-only'].includes(mode)) {
    throw new Error('Unsupported Supabase CI migration mode: ' + mode);
  }

  const baseline = repositoryContract?.baselinePath || FRESH_BASELINE;
  const postBaseline = repositoryContract?.postBaselineMigrations
    || POST_BASELINE_MIGRATIONS;
  const latest = postBaseline.at(-1);

  if (!latest) {
    throw new Error('Supabase CI migration manifest has no post-baseline migrations.');
  }

  let sources;
  if (mode === 'latest-only') {
    sources = [latest];
  } else {
    const selected = mode === 'upgrade-base'
      ? postBaseline.slice(0, -1)
      : postBaseline;
    sources = [baseline, ...selected];
  }

  return sources.map((source, index) => {
    const canonicalIndex = source === latest && mode === 'latest-only'
      ? postBaseline.length
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
  const verified = validateSupabaseMigrationContract(repoRoot);

  if (
    releaseContract.freshInstallBaseline
    !== verified.releaseContract.freshInstallBaseline
  ) {
    throw new Error('Supabase CI release-contract baseline changed during validation.');
  }
  if (releaseContract.latestMigration !== verified.releaseContract.latestMigration) {
    throw new Error('Supabase CI release-contract latest migration changed during validation.');
  }

  for (const item of buildMigrationPlan('fresh', verified)) {
    const sourcePath = path.join(repoRoot, item.source);
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Missing Supabase CI migration source: ' + item.source);
    }
  }

  return verified;
}

function nearestExistingAncestor(value) {
  let current = path.resolve(value);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function resolvedPathThroughExistingAncestors(value) {
  const absolute = path.resolve(value);
  const ancestor = nearestExistingAncestor(absolute);
  const ancestorReal = fs.realpathSync(ancestor);
  const remainder = path.relative(ancestor, absolute);
  return path.resolve(ancestorReal, remainder);
}

function pathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === ''
    || (
      !relative.startsWith('..' + path.sep)
      && relative !== '..'
      && !path.isAbsolute(relative)
    );
}

function validatedStagePaths(repoRoot, targetDir) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw new TypeError('Supabase CI repoRoot is required.');
  }
  if (typeof targetDir !== 'string' || !targetDir.trim()) {
    throw new TypeError('Supabase CI targetDir is required.');
  }

  const repo = path.resolve(repoRoot);
  const target = path.resolve(targetDir);
  const parsedTarget = path.parse(target);
  if (target === parsedTarget.root) {
    throw new Error('Refusing to stage Supabase migrations into a filesystem root.');
  }
  if (
    path.basename(target) !== 'migrations'
    || path.basename(path.dirname(target)) !== 'supabase'
  ) {
    throw new Error('Supabase CI targetDir must end with supabase/migrations.');
  }

  const repoReal = fs.realpathSync(repo);
  const targetResolved = resolvedPathThroughExistingAncestors(target);
  if (pathInside(repoReal, targetResolved)) {
    throw new Error(
      'Refusing to stage generated CI migrations inside the source repository, including through symlinked paths.',
    );
  }

  return { repoRoot: repo, targetDir: target };
}

export function stageMigrationPlan({
  repoRoot,
  targetDir,
  mode = 'fresh',
  clear = true,
}) {
  const paths = validatedStagePaths(repoRoot, targetDir);
  const releaseContract = JSON.parse(
    fs.readFileSync(path.join(paths.repoRoot, 'release-contract.json'), 'utf8'),
  );
  const repositoryContract = validateMigrationPlan(
    paths.repoRoot,
    releaseContract,
  );

  if (clear) {
    fs.rmSync(paths.targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(paths.targetDir, { recursive: true });

  const plan = buildMigrationPlan(mode, repositoryContract);
  for (const item of plan) {
    fs.copyFileSync(
      path.join(paths.repoRoot, item.source),
      path.join(paths.targetDir, item.filename),
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
