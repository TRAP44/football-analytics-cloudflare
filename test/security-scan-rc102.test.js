import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forbiddenTrackedFile,
  scanTextForSecrets,
  scanTrackedFiles,
} from '../scripts/security-scan.js';

test('RC102 blocks secret-bearing tracked filenames', () => {
  assert.equal(forbiddenTrackedFile('.env'), true);
  assert.equal(forbiddenTrackedFile('.dev.vars'), true);
  assert.equal(forbiddenTrackedFile('certs/prod.pem'), true);
  assert.equal(forbiddenTrackedFile('.env.example'), false);
});

test('RC102 detects high-confidence credential formats', () => {
  const telegramToken='123456789:' + 'A'.repeat(35);
  const supabaseToken='sb_' + 'secret_' + 'a'.repeat(24);
  const privateKeyHeader='-----BEGIN ' + 'PRIVATE KEY-----';
  assert.deepEqual(scanTextForSecrets('token=' + telegramToken), ['telegram_bot_token']);
  assert.deepEqual(scanTextForSecrets('key=' + supabaseToken), ['supabase_secret_key']);
  assert.ok(scanTextForSecrets(privateKeyHeader).includes('private_key'));
});

test('RC102 allows safe example placeholders', () => {
  const example='TELEGRAM_BOT_TOKEN=PASTE_TELEGRAM_BOT_TOKEN\nSUPABASE_SECRET_KEY=\nAPI_FOOTBALL_KEY=PASTE_API_FOOTBALL_KEY\n';
  assert.deepEqual(scanTextForSecrets(example), []);
});

test('RC102 reports file and content violations without exposing secret values', () => {
  const files=['.env','safe.txt','token.txt'];
  const contents={
    'safe.txt':'PASTE_TOKEN_HERE',
    'token.txt':'sb_' + 'secret_' + 'a'.repeat(24),
  };
  const findings=scanTrackedFiles(files,path=>contents[path] || '');
  assert.deepEqual(findings,[
    {path:'.env',type:'forbidden_tracked_file'},
    {path:'token.txt',type:'supabase_secret_key'},
  ]);
  assert.equal(JSON.stringify(findings).includes('a'.repeat(24)), false);
});
