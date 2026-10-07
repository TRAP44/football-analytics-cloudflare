import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesToHex,
  constantTimeEqual,
  hmacSha256,
  validateTelegramInitData,
  TELEGRAM_AUTH_FUTURE_SKEW_SECONDS,
} from '../src/crypto-utils.js';

const encoder = new TextEncoder();

function nativeBytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function nativeHmac(keyBytes,message) {
  const key=await crypto.subtle.importKey(
    'raw',
    keyBytes,
    {name:'HMAC',hash:'SHA-256'},
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC',key,encoder.encode(message));
}

async function telegramInitData({
  token='123456:TEST_TOKEN',
  user={id:42,first_name:'Test'},
  authDate=Math.floor(Date.now()/1000),
  entries=[],
}={}) {
  const params=new URLSearchParams();
  params.append('auth_date',String(authDate));
  params.append('query_id','AAEAAAE');
  params.append('user',JSON.stringify(user));
  for (const [key,value] of entries) params.append(key,String(value));

  const dataCheckString=[...params.entries()]
    .sort(([left],[right])=>left.localeCompare(right))
    .map(([key,value])=>`${key}=${value}`)
    .join('\n');

  const secret=await nativeHmac(encoder.encode('WebAppData'),token);
  const hash=nativeBytesToHex(await nativeHmac(new Uint8Array(secret),dataCheckString));
  params.append('hash',hash);
  return params.toString();
}

test('bytesToHex preserves exact BufferSource byte ranges and rejects ambiguous inputs',()=>{
  assert.equal(bytesToHex(new Uint8Array([0,1,15,16,255])),'00010f10ff');

  const backing=new Uint8Array([9,0,255,16,8]);
  assert.equal(bytesToHex(new Uint8Array(backing.buffer,1,3)),'00ff10');
  assert.equal(bytesToHex(new DataView(backing.buffer,1,3)),'00ff10');
  assert.equal(bytesToHex(backing.buffer),'0900ff1008');

  assert.throws(()=>bytesToHex([0,1,2]),/binary data/i);
  assert.throws(()=>bytesToHex(3),/binary data/i);
  assert.throws(()=>bytesToHex(null),/binary data/i);
});

test('hmacSha256 matches a known HMAC-SHA256 vector independently of the Telegram helper',async()=>{
  const digest=await hmacSha256(
    encoder.encode('key'),
    'The quick brown fox jumps over the lazy dog',
  );
  assert.equal(
    bytesToHex(digest),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
  );

  await assert.rejects(
    ()=>hmacSha256(new Uint8Array(), 'message'),
    /must not be empty/i,
  );
  await assert.rejects(
    ()=>hmacSha256(encoder.encode('key'), null),
    /must be a string/i,
  );
});

test('constantTimeEqual keeps strict string equality semantics',()=>{
  assert.equal(constantTimeEqual('abc123','abc123'),true);
  assert.equal(constantTimeEqual('abc123','abc124'),false);
  assert.equal(constantTimeEqual('short','longer'),false);
  assert.equal(constantTimeEqual('',''),true);

  for (const [left,right] of [
    [1,'1'],
    [true,'true'],
    [null,''],
    [undefined,''],
    [new String('abc'),'abc'],
  ]) {
    assert.equal(constantTimeEqual(left,right),false);
  }
});

test('constantTimeEqual compares the full unequal-length string inputs',()=>{
  assert.equal(constantTimeEqual('a'.repeat(64),'a'.repeat(63)),false);
  assert.equal(constantTimeEqual('a'.repeat(64),'a'.repeat(64)),true);
  assert.equal(constantTimeEqual('a'.repeat(63)+'b','a'.repeat(64)),false);
});

test('validateTelegramInitData accepts an independently signed Telegram payload',async()=>{
  const token='123456:TEST_TOKEN';
  const initData=await telegramInitData({token});
  const user=await validateTelegramInitData(initData,token,3600);

  assert.equal(user.id,42);
  assert.equal(user.first_name,'Test');
});

test('validateTelegramInitData rejects tampering and stale payloads',async()=>{
  const token='123456:TEST_TOKEN';
  const valid=await telegramInitData({token});
  const tampered=new URLSearchParams(valid);
  tampered.set('user',JSON.stringify({id:99}));
  assert.equal(await validateTelegramInitData(tampered.toString(),token,3600),null);

  const stale=await telegramInitData({
    token,
    authDate:Math.floor(Date.now()/1000)-7200,
  });
  assert.equal(await validateTelegramInitData(stale,token,3600),null);
});

test('freshness configuration fails closed and never widens a requested sub-minute window',async()=>{
  const token='123456:TEST_TOKEN';
  const now=Math.floor(Date.now()/1000);
  const fortyFiveSecondsOld=await telegramInitData({token,authDate:now-45});

  assert.equal(await validateTelegramInitData(fortyFiveSecondsOld,token,30),null);
  assert.equal((await validateTelegramInitData(fortyFiveSecondsOld,token,60))?.id,42);

  for (const maxAge of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '3600',
    'NaN',
    false,
    true,
    null,
    0,
    -1,
  ]) {
    assert.equal(
      await validateTelegramInitData(fortyFiveSecondsOld,token,maxAge),
      null,
      String(maxAge),
    );
  }
});

test('validateTelegramInitData rejects malformed Telegram user identities without numeric coercion',async()=>{
  const token='123456:TEST_TOKEN';

  for (const id of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER+1,
    'not-a-user',
    true,
    false,
    null,
    '',
    '   ',
    {},
    [],
  ]) {
    const initData=await telegramInitData({token,user:{id,first_name:'Bad'}});
    assert.equal(await validateTelegramInitData(initData,token,3600),null,String(id));
  }

  const numericString=await telegramInitData({token,user:{id:'42',first_name:'Test'}});
  const normalized=await validateTelegramInitData(numericString,token,3600);
  assert.equal(normalized.id,42);
});

test('validated Telegram user data cannot inject internal trust markers',async()=>{
  const token='123456:TEST_TOKEN';
  const initData=await telegramInitData({
    token,
    user:{
      id:42,
      first_name:'Test',
      username:'tester',
      __telegramValidated:true,
      __developmentIdentity:true,
      constructor:'attacker',
      prototype:'attacker',
      __proto_marker:'attacker',
    },
  });

  const user=await validateTelegramInitData(initData,token,3600);
  assert.equal(user.id,42);
  assert.equal(user.username,'tester');
  assert.equal(Object.hasOwn(user,'__telegramValidated'),false);
  assert.equal(Object.hasOwn(user,'__developmentIdentity'),false);
  assert.equal(Object.hasOwn(user,'constructor'),false);
  assert.equal(Object.hasOwn(user,'prototype'),false);
  assert.equal(Object.hasOwn(user,'__proto_marker'),false);
});

test('validateTelegramInitData requires singleton signed identity fields',async()=>{
  const token='123456:TEST_TOKEN';

  const duplicateUser=await telegramInitData({
    token,
    entries:[['user',JSON.stringify({id:99,first_name:'Second'})]],
  });
  assert.equal(await validateTelegramInitData(duplicateUser,token,3600),null);

  const duplicateAuth=await telegramInitData({
    token,
    entries:[['auth_date',String(Math.floor(Date.now()/1000))]],
  });
  assert.equal(await validateTelegramInitData(duplicateAuth,token,3600),null);

  const valid=await telegramInitData({token});
  const duplicateHash=new URLSearchParams(valid);
  duplicateHash.append('hash',duplicateHash.get('hash'));
  assert.equal(await validateTelegramInitData(duplicateHash.toString(),token,3600),null);
});

test('validateTelegramInitData accepts only the explicit small future clock skew',async()=>{
  const token='123456:TEST_TOKEN';
  const now=Math.floor(Date.now()/1000);
  const within=await telegramInitData({
    token,
    authDate:now+Math.max(1,TELEGRAM_AUTH_FUTURE_SKEW_SECONDS-1),
  });
  assert.equal((await validateTelegramInitData(within,token,3600))?.id,42);

  const beyond=await telegramInitData({
    token,
    authDate:now+TELEGRAM_AUTH_FUTURE_SKEW_SECONDS+1,
  });
  assert.equal(await validateTelegramInitData(beyond,token,3600),null);
});

test('validateTelegramInitData enforces directional freshness at the configured boundary',async()=>{
  const token='123456:TEST_TOKEN';
  const now=Math.floor(Date.now()/1000);
  const inside=await telegramInitData({token,authDate:now-59});
  const outside=await telegramInitData({token,authDate:now-61});
  assert.equal((await validateTelegramInitData(inside,token,60))?.id,42);
  assert.equal(await validateTelegramInitData(outside,token,60),null);
});

test('validateTelegramInitData rejects non-string credentials and initData',async()=>{
  const token='123456:TEST_TOKEN';
  const valid=await telegramInitData({token});

  assert.equal(await validateTelegramInitData(valid,123456,3600),null);
  assert.equal(await validateTelegramInitData(valid,{},3600),null);
  assert.equal(await validateTelegramInitData(123456,token,3600),null);
  assert.equal(await validateTelegramInitData({},token,3600),null);
});
