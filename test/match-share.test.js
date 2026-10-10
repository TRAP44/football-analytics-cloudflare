import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildMatchShareText,
  shareMatch,
  shareProbabilities,
  telegramComposerUrl,
} from '../public/modules/match-share.js';

const dateTime=()=>'10 окт., 22:54';
const match={ fixtureId:9003, home:{name:'Милан'}, away:{name:'Рома'}, league:'Серия А', date:'2026-10-10T19:54:00Z' };

test('share text is neutral: plain outcome words, no betting shorthand',()=>{
  const text=buildMatchShareText({ match, probabilities:{home:48.4,draw:27,away:24.6}, confidence:66, dateTime });
  assert.equal(text.split('\n')[0],'⚽ Милан — Рома');
  assert.match(text,/Серия А · 10 окт\., 22:54/);
  assert.match(text,/MatchRadar AI: хозяева 48% · ничья 27% · гости 25%/);
  assert.match(text,/Уверенность модели: 66\/100/);
  assert.match(text,/не гарантия результата/);
  assert.doesNotMatch(text,/П1|П2|\bН\b|ТБ|ТМ|Обе забьют|ставк|коэфф/i);
});

test('probabilities and confidence are shown only when the payload is valid',()=>{
  assert.equal(shareProbabilities({home:48,draw:27}),null);
  assert.equal(shareProbabilities({home:80,draw:30,away:20}),null);
  assert.equal(shareProbabilities({home:'abc',draw:50,away:50}),null);
  assert.equal(shareProbabilities({home:null,draw:50,away:50}),null);
  assert.deepEqual(shareProbabilities({home:'48',draw:'27',away:'25'}),[48,27,25]);
  const noProbs=buildMatchShareText({ match, probabilities:null, confidence:66, dateTime });
  assert.doesNotMatch(noProbs,/MatchRadar AI:|Уверенность/);
  assert.match(noProbs,/Разбор и данные матча — в MatchRadar/);
  const badConfidence=buildMatchShareText({ match, probabilities:{home:48,draw:27,away:25}, confidence:140, dateTime });
  assert.doesNotMatch(badConfidence,/Уверенность/);
});

test('live and finished matches include the real score, upcoming never invents one',()=>{
  const live=buildMatchShareText({ match:{...match, live:true, elapsed:67, score:{home:1,away:1}}, dateTime });
  assert.match(live,/Сейчас 1 : 1 · 67′/);
  const finished=buildMatchShareText({ match:{...match, finished:true, score:{home:3,away:1}}, dateTime });
  assert.match(finished,/Итог 3 : 1/);
  const upcoming=buildMatchShareText({ match:{...match, score:{home:null,away:null}}, dateTime });
  assert.doesNotMatch(upcoming,/Сейчас|Итог|0 : 0/);
  const missing=buildMatchShareText({ match:{...match, live:true, score:{home:null,away:2}}, dateTime });
  assert.doesNotMatch(missing,/Сейчас/);
});

test('telegram composer carries the deep link and the neutral text',()=>{
  const url=telegramComposerUrl('https://t.me/MatchRadarBot?startapp=fx9003','⚽ Милан — Рома');
  const parsed=new URL(url);
  assert.equal(parsed.hostname,'t.me');
  assert.equal(parsed.pathname,'/share/url');
  assert.equal(parsed.searchParams.get('url'),'https://t.me/MatchRadarBot?startapp=fx9003');
  assert.equal(parsed.searchParams.get('text'),'⚽ Милан — Рома');
  assert.equal(telegramComposerUrl('javascript:alert(1)','x'),'');
  assert.equal(telegramComposerUrl('','x'),'');
});

test('shareMatch opens Telegram composer with the share link and our text',async()=>{
  const opened=[]; const toasts=[]; const calls=[];
  const result=await shareMatch({
    match, probabilities:{home:48,draw:27,away:25}, confidence:66, source:'center', dateTime,
    api:async path=>{ calls.push(path); return { url:'https://t.me/MatchRadarBot?startapp=fx9003' }; },
    tg:{ openTelegramLink:url=>opened.push(url) },
    toast:message=>toasts.push(message),
    navigatorRef:{},
  });
  assert.equal(result,'telegram');
  assert.match(calls[0],/\/api\/share-link\?fixtureId=9003&source=social&campaign=match_share&content=center/);
  const text=new URL(opened[0]).searchParams.get('text');
  assert.match(text,/хозяева 48%/);
  assert.equal(toasts.length,1);
});

test('shareMatch falls back to clipboard and survives a failed share link',async()=>{
  const copied=[];
  const result=await shareMatch({
    match, dateTime,
    api:async()=>{ throw new Error('offline'); },
    tg:null,
    toast:()=>{},
    navigatorRef:{ clipboard:{ writeText:async value=>copied.push(value) } },
  });
  assert.equal(result,'clipboard');
  assert.match(copied[0],/⚽ Милан — Рома/);
  assert.doesNotMatch(copied[0],/https:/);
  const cancelled=await shareMatch({ match, dateTime, api:async()=>({}), navigatorRef:{ share:async()=>{ const e=new Error('x'); e.name='AbortError'; throw e; } } });
  assert.equal(cancelled,'cancelled');
});

test('match center offers sharing and passes only saved, validated analysis data',()=>{
  const view=fs.readFileSync('public/modules/match-center-view.js','utf8');
  assert.match(view,/id="centerShareBtn"[^>]*>↗ Поделиться<\/button>/);
  assert.match(view,/probabilities: history\?\.aiProbabilities \|\| null/);
  assert.match(view,/confidence: history\?\.aiConfidence \?\? null/);
  assert.match(view,/source: 'center'/);
});
