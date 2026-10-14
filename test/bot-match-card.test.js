import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBotMatchCardSvg,botCardSignature,validCachedBotCard} from '../src/bot-match-card.js';
import {renderBotMatchCard,fetchBotCardLogo} from '../scripts/bot-match-card-renderer.js';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZwoAAAAASUVORK5CYII=';
const row={fixtureId:1,home:{id:42},away:{id:49},homeName:'Arsenal',awayName:'Chelsea',league:'Премьер-лига',live:true,status:'2H',elapsed:63,goalsHome:1,goalsAway:0};

test('card cache binds score, minute, names, order and mode and expires after six minutes',()=>{
  const signature=botCardSignature([row],true);
  const card={signature,png,generatedAt:1000000};
  assert.equal(validCachedBotCard(card,signature,1000001),true);
  assert.equal(validCachedBotCard(card,signature,999999),false);
  assert.equal(validCachedBotCard({...card,generatedAt:NaN},signature,1000001),false);
  assert.equal(validCachedBotCard(card,signature,1360001),false);
  for (const changes of [{elapsed:64},{goalsHome:2},{homeName:'Other club'}]) {
    assert.equal(validCachedBotCard(card,botCardSignature([{...row,...changes}],true),1000001),false);
  }
  assert.notEqual(signature,botCardSignature([row],false));
  assert.equal(validCachedBotCard({...card,png:'bad'},signature,1000001),false);
});

test('SVG escapes provider text, uses actual scores, caps rows and rejects external image URLs',()=>{
  const svg=buildBotMatchCardSvg(Array.from({length:10},()=>({...row,homeName:'<script> & Arsenal'})),{
    logos:new Map([[42,'https://attacker.example/crest.svg']]),generatedAt:1000000,
  });
  assert.match(svg,/&lt;script&gt;/);
  assert.match(svg,/1 : 0/);
  assert.match(svg,/LIVE · 63′/);
  assert.doesNotMatch(svg,/<script>|attacker.example/);
  assert.equal((svg.match(/width="592"/g)||[]).length,4);
  const upcoming=buildBotMatchCardSvg([{...row,live:false,goalsHome:null,goalsAway:null,date:'2026-10-14T19:00:00Z'}]);
  assert.match(upcoming,/22:00 МСК/);
  assert.doesNotMatch(upcoming,/1 : 0/);
});

test('real background rasterizer produces bounded PNG with Cyrillic and embedded crests',async()=>{
  const image=await renderBotMatchCard([row,{...row,homeName:'Очень длинное название футбольной команды'}],{
    fetchLogo:async()=>`data:image/png;base64,${png}`,
  });
  const bytes=Buffer.from(image,'base64');
  assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  assert.equal(bytes.readUInt32BE(16),640);
  assert.equal(bytes.readUInt32BE(20),369);
  assert.ok(bytes.length>1000 && bytes.length<250000);
});

test('logo loader uses only canonical host, prohibits redirects and bounds PNG size/dimensions',async()=>{
  let url,options;
  const fake=async(u,o)=>{url=u;options=o;return new Response(Buffer.from(png,'base64'));};
  assert.equal(await fetchBotCardLogo(42,fake),`data:image/png;base64,${png}`);
  assert.equal(url,'https://media.api-sports.io/football/teams/42.png');
  assert.equal(options.redirect,'error');
  assert.equal(await fetchBotCardLogo('https://evil.example',()=>{throw new Error('must not fetch');}),null);
  assert.equal(await fetchBotCardLogo(42,async()=>new Response('not a png')),null);
  assert.equal(await fetchBotCardLogo(42,async()=>new Response(new Uint8Array(128001))),null);
  const large=Buffer.from(png,'base64');large.writeUInt32BE(2000,16);
  assert.equal(await fetchBotCardLogo(42,async()=>new Response(large)),null);
});
