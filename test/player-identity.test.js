import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlayerIdentityResolver,
  describePlayerIdentity,
  normalizePlayerName,
} from '../src/player-identity.js';

test('player identity normalization accepts names only as strings', () => {
  assert.equal(normalizePlayerName(' José   Álvarez '),'jose alvarez');
  assert.equal(normalizePlayerName({name:'Alex Silva'}),'');
  assert.equal(normalizePlayerName(['Alex Silva']),'');
  assert.equal(normalizePlayerName(123),'');
});

test('player identity parses only safe integer IDs without JavaScript coercion', () => {
  assert.deepEqual(
    describePlayerIdentity({id:'00123',name:'Player'}),
    {
      id:123,
      ids:[123],
      name:'Player',
      normalizedName:'player',
      invalidKnownIdCount:0,
      invalidKnownIdValue:false,
      knownIdConflict:false,
    },
  );

  const booleanId=describePlayerIdentity({id:true,name:'Player'});
  assert.equal(booleanId.id,0);
  assert.equal(booleanId.invalidKnownIdValue,true);

  const arrayId=describePlayerIdentity({playerId:[123],name:'Player'});
  assert.equal(arrayId.id,0);
  assert.equal(arrayId.invalidKnownIdValue,true);

  const zeroAlias=describePlayerIdentity({id:0,playerId:'123',name:'Player'});
  assert.equal(zeroAlias.id,123);
  assert.equal(zeroAlias.invalidKnownIdValue,false);
});

test('player identity preserves safe fallback fields while treating blank IDs as absent', () => {
  const descriptor=describePlayerIdentity({
    id:'   ',
    playerId:'123',
    name:'',
    playerName:'Fallback Player',
  });
  assert.equal(descriptor.id,123);
  assert.equal(descriptor.name,'Fallback Player');
  assert.equal(descriptor.normalizedName,'fallback player');
  assert.equal(descriptor.invalidKnownIdValue,false);

  const alternateName=describePlayerIdentity({
    id:5,
    name:{unexpected:true},
    player_name:'Provider Name',
  });
  assert.equal(alternateName.name,'Provider Name');
  assert.equal(alternateName.normalizedName,'provider name');
});

test('resolver fails closed on malformed or conflicting known IDs', () => {
  const resolver=createPlayerIdentityResolver([
    {id:10,name:'Known Player'},
    {id:20,name:'Other Player'},
  ]);

  const malformed=resolver.resolve({id:true,name:'Known Player'});
  assert.equal(malformed.valid,false);
  assert.equal(malformed.reason,'invalid_known_id');
  assert.equal(malformed.via,'invalid_id');

  const conflicting=resolver.resolve({id:10,playerId:20,name:'Known Player'});
  assert.equal(conflicting.valid,false);
  assert.equal(conflicting.reason,'conflicting_known_ids');

  assert.equal(resolver.matches({id:true,name:'Known Player'},{id:10,name:'Known Player'}),false);
});

test('resolver does not merge two name-only players when that alias maps to multiple known IDs', () => {
  const resolver=createPlayerIdentityResolver([
    {id:101,name:'Alex Silva'},
    {id:202,name:'Alex Silva'},
  ]);

  const a={name:'Alex Silva'};
  const b={name:'Álex Silva'};

  assert.equal(resolver.resolve(a).valid,false);
  assert.equal(resolver.resolve(a).reason,'name_alias_ambiguous');
  assert.equal(resolver.matches(a,b),false);
  assert.deepEqual([...resolver.aliasIds('Alex Silva')].sort((x,y)=>x-y),[101,202]);
});

test('resolver preserves unique name aliases and authoritative explicit IDs', () => {
  const resolver=createPlayerIdentityResolver([
    {id:55,name:'José Álvarez'},
    {id:77,name:'Alex Silva'},
    {id:88,name:'Alex Silva'},
  ]);

  const alias=resolver.resolve({name:'Jose Alvarez'});
  assert.equal(alias.valid,true);
  assert.equal(alias.id,55);
  assert.equal(alias.key,'id:55');
  assert.equal(alias.via,'name_alias');

  assert.equal(resolver.matches({id:55,name:'José Álvarez'},{name:'Jose Alvarez'}),true);
  assert.equal(resolver.matches({id:77,name:'Alex Silva'},{name:'Alex Silva'}),false);
  assert.equal(resolver.matches({id:77,name:'Alex Silva'},{id:88,name:'Alex Silva'}),false);
});

test('aliasIds returns an isolated set that cannot mutate resolver state', () => {
  const resolver=createPlayerIdentityResolver([{id:9,name:'Player Nine'}]);
  const first=resolver.aliasIds('Player Nine');
  first.add(999);
  assert.deepEqual([...resolver.aliasIds('Player Nine')],[9]);
});
