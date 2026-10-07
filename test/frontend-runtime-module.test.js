import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCENT_PALETTES,
  CLIENT_API_CONTRACT,
  CLIENT_RELEASE_CHANNEL,
  CLIENT_VERSION,
  DEFAULT_UI_PREFERENCES,
  FRONTEND_ASSET_REVISION,
  MATCH_WATCHLIST_KEY,
  SUPABASE_SCHEMA_HINT,
  UI_PREFERENCES_KEY,
  readMatchWatchlist,
  readUiPreferences,
} from '../public/modules/app-runtime.js';

const pkg=JSON.parse(
  readFileSync(new URL('../package.json',import.meta.url),'utf8'),
);
const releaseContract=JSON.parse(
  readFileSync(new URL('../release-contract.json',import.meta.url),'utf8'),
);
const worker=readFileSync(
  new URL('../src/worker.js',import.meta.url),
  'utf8',
);
const verifier=readFileSync(
  new URL('../scripts/verify-release.js',import.meta.url),
  'utf8',
);

function storageWith(value) {
  return {
    getItem() {
      return value;
    },
  };
}

function latestMigrationVersion() {
  const match=/supabase_migration_v(\d+(?:_\d+)*)\.sql$/i.exec(
    releaseContract.latestMigration || '',
  );
  assert.ok(match,'latest migration naming must remain parseable');
  return match[1].replaceAll('_','.');
}

test('frontend runtime identity follows release contract instead of stale literals',()=>{
  const runtimeMatch=/^(\d+\.\d+\.\d+)-rc(\d+)$/i.exec(
    releaseContract.runtimeVersion,
  );
  assert.ok(runtimeMatch);
  assert.equal(releaseContract.applicationVersion,pkg.version);
  assert.equal(CLIENT_VERSION,releaseContract.runtimeVersion);
  assert.equal(CLIENT_RELEASE_CHANNEL,'rc'+runtimeMatch[2]);
  assert.equal(CLIENT_API_CONTRACT,5);
  assert.match(
    worker,
    new RegExp(
      'const API_CONTRACT_VERSION = '+CLIENT_API_CONTRACT+';',
    ),
  );
  assert.match(
    FRONTEND_ASSET_REVISION,
    new RegExp(
      '^'
      +pkg.version.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')
      +'-launch\\d+$',
    ),
  );
});

test('schema guidance names the actual latest migration, not only the schema family',()=>{
  const latest=latestMigrationVersion();
  assert.match(SUPABASE_SCHEMA_HINT,/baseline v6\.19/);
  assert.ok(
    SUPABASE_SCHEMA_HINT.includes('миграции до v'+latest),
    SUPABASE_SCHEMA_HINT,
  );
  assert.ok(
    worker.includes('миграции до v'+latest),
    'worker schema guidance drifted from latest migration',
  );
});

test('release verification consumes runtime constants and schema guidance semantically',()=>{
  for (const symbol of [
    'CLIENT_API_CONTRACT',
    'CLIENT_RELEASE_CHANNEL',
    'CLIENT_VERSION',
    'FRONTEND_ASSET_REVISION',
    'SUPABASE_SCHEMA_HINT',
  ]) {
    assert.match(verifier,new RegExp('\\b'+symbol+'\\b'));
  }
  assert.match(
    verifier,
    /latestMigrationVersion/,
  );
  assert.match(
    verifier,
    /Client and worker API contract versions must match/,
  );
});

test('runtime preference defaults are immutable and palette entries are frozen',()=>{
  assert.equal(Object.isFrozen(DEFAULT_UI_PREFERENCES),true);
  assert.equal(Object.isFrozen(ACCENT_PALETTES),true);
  for (const palette of Object.values(ACCENT_PALETTES)) {
    assert.equal(Object.isFrozen(palette),true);
    assert.equal(Object.isFrozen(palette.dark),true);
    assert.equal(Object.isFrozen(palette.light),true);
  }
  assert.equal(UI_PREFERENCES_KEY,'football-analytics:ui:v1');
});

test('UI preferences accept only explicit supported string values',()=>{
  const good=storageWith(JSON.stringify({
    theme:'ocean',
    accent:'violet',
    buttonStyle:'compact',
  }));
  assert.deepEqual(readUiPreferences(good),{
    theme:'ocean',
    accent:'violet',
    buttonStyle:'compact',
  });

  const partial=storageWith(JSON.stringify({
    theme:'dark',
    accent:true,
    buttonStyle:['compact'],
  }));
  assert.deepEqual(readUiPreferences(partial),{
    theme:'dark',
    accent:'system',
    buttonStyle:'soft',
  });

  const unsafe=storageWith(JSON.stringify({
    theme:'unknown',
    accent:'pink',
    buttonStyle:'huge',
  }));
  assert.deepEqual(readUiPreferences(unsafe),DEFAULT_UI_PREFERENCES);
});

test('UI preference storage failures and malformed payloads fail safe',()=>{
  assert.deepEqual(readUiPreferences(undefined),DEFAULT_UI_PREFERENCES);
  assert.deepEqual(readUiPreferences(storageWith('{bad json')),DEFAULT_UI_PREFERENCES);
  assert.deepEqual(readUiPreferences(storageWith('null')),DEFAULT_UI_PREFERENCES);
  assert.deepEqual(readUiPreferences(storageWith('[]')),DEFAULT_UI_PREFERENCES);
  assert.deepEqual(readUiPreferences(storageWith(42)),DEFAULT_UI_PREFERENCES);

  const broken={
    getItem() {
      throw new Error('storage blocked');
    },
  };
  assert.deepEqual(readUiPreferences(broken),DEFAULT_UI_PREFERENCES);

  const hostile={};
  Object.defineProperty(hostile,'getItem',{
    get(){throw new Error('hostile getItem getter');},
  });
  assert.doesNotThrow(()=>readUiPreferences(hostile));
  assert.deepEqual(readUiPreferences(hostile),DEFAULT_UI_PREFERENCES);
});

test('watchlist storage rejects coercive identities and sanitizes local display fields',()=>{
  assert.equal(MATCH_WATCHLIST_KEY,'matchradar:watchlist:v1');
  const rows=[
    {
      fixtureId:10,
      homeName:'  Home\u0000 Team  ',
      awayName:'Away',
      league:' League ',
      date:'2026-10-07T18:00:00Z',
      homeId:'101',
      awayId:202,
      homeLogo:'https://img.example/home.png',
      awayLogo:'javascript:alert(1)',
      addedAt:'2026-10-07T12:00:00Z',
    },
    {
      fixtureId:'10',
      homeName:'Duplicate',
      awayName:'Away',
    },
    {
      fixtureId:true,
      homeName:'Boolean id',
      awayName:'Away',
    },
    {
      fixtureId:[11],
      homeName:'Array id',
      awayName:'Away',
    },
    {
      fixtureId:'12',
      homeName:['Not','text'],
      awayName:'Away',
    },
  ];

  const items=readMatchWatchlist(storageWith(JSON.stringify(rows)));
  assert.equal(items.length,1);
  assert.deepEqual(items[0],{
    fixtureId:10,
    homeName:'Home Team',
    awayName:'Away',
    league:'League',
    date:'2026-10-07T18:00:00Z',
    homeId:101,
    awayId:202,
    homeLogo:'https://img.example/home.png',
    awayLogo:'',
    addedAt:'2026-10-07T12:00:00Z',
  });
});

test('watchlist remains bounded after invalid rows and duplicates are removed',()=>{
  const rows=[];
  for (let index=0;index<80;index+=1) {
    rows.push({
      fixtureId:index+1,
      homeName:'Home '+index,
      awayName:'Away '+index,
    });
  }
  rows.unshift({
    fixtureId:false,
    homeName:'Invalid',
    awayName:'Invalid',
  });

  const items=readMatchWatchlist(storageWith(JSON.stringify(rows)));
  assert.equal(items.length,50);
  assert.equal(items[0].fixtureId,1);
  assert.equal(items.at(-1).fixtureId,50);
  assert.equal(new Set(items.map(item=>item.fixtureId)).size,50);
});

test('watchlist malformed storage fails closed without throwing',()=>{
  assert.deepEqual(readMatchWatchlist(undefined),[]);
  assert.deepEqual(readMatchWatchlist(storageWith('{}')),[]);
  assert.deepEqual(readMatchWatchlist(storageWith('{bad')),[]);
  assert.deepEqual(readMatchWatchlist(storageWith({length:1})),[]);

  const broken={
    getItem() {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(readMatchWatchlist(broken),[]);
});
