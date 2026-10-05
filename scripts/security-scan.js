import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TRACKED_SECRET_FILES = [
  /^\.env$/i,
  /^\.env\.(?!example$)[^/]+$/i,
  /^\.dev\.vars$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/i,
];

const SECRET_PATTERNS = [
  { id: 'private_key', pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/g },
  { id: 'telegram_bot_token', pattern: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g },
  { id: 'supabase_secret_key', pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/gi },
  { id: 'github_token', pattern: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { id: 'tavily_key', pattern: /\btvly-[A-Za-z0-9_-]{20,}\b/gi },
  { id: 'jwt_secret', pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
];

const TEXT_FILE = /(?:^|\/)(?:[^/]+\.(?:js|mjs|cjs|json|md|html|css|sql|yml|yaml|toml|txt|example)|\.gitignore)$/i;

export function scanTextForSecrets(text = '') {
  const findings = [];
  for (const { id, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(String(text))) findings.push(id);
  }
  return findings;
}

export function forbiddenTrackedFile(path = '') {
  return TRACKED_SECRET_FILES.some(pattern => pattern.test(String(path)));
}

export function scanTrackedFiles(paths, readFile = path => fs.readFileSync(path, 'utf8')) {
  const findings = [];
  for (const path of paths || []) {
    if (forbiddenTrackedFile(path)) {
      findings.push({ path, type: 'forbidden_tracked_file' });
      continue;
    }
    if (!TEXT_FILE.test(path)) continue;
    let text;
    try {
      text = readFile(path);
    } catch {
      continue;
    }
    for (const type of scanTextForSecrets(text)) findings.push({ path, type });
  }
  return findings;
}

export function trackedFiles(run = execFileSync) {
  let output;
  try {
    output = run('git', ['ls-files', '-z'], {
      encoding:'utf8',
      stdio:['ignore','pipe','pipe'],
    });
  } catch (error) {
    const failure = new Error(
      'Secret Leak Guard needs a git checkout (git ls-files failed). '
      + 'Run it inside a cloned repository, not an unpacked ZIP archive.',
    );
    failure.code = 'SECURITY_SCAN_NO_GIT';
    failure.cause = error;
    throw failure;
  }
  return String(output).split('\0').filter(Boolean);
}

export function runSecurityScan() {
  const findings = scanTrackedFiles(trackedFiles());
  if (findings.length) {
    console.error('Secret Leak Guard blocked the release:');
    for (const finding of findings) console.error(`- ${finding.path}: ${finding.type}`);
    return { ok: false, findings };
  }
  console.log('Secret Leak Guard: tracked files are clean.');
  return { ok: true, findings: [] };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  try {
    const result = runSecurityScan();
    if (!result.ok) process.exit(1);
  } catch (error) {
    if (error?.code !== 'SECURITY_SCAN_NO_GIT') throw error;
    console.error(error.message);
    process.exit(2);
  }
}
