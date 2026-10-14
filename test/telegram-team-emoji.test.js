import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTeamEmojiMap,teamEmojiHtml,withoutTeamCustomEmoji,isTeamEmojiRejected} from '../src/telegram-team-emoji.js';
import {createCommonInfrastructureRuntime} from '../src/common-infrastructure-runtime.js';

const emoji='5368324170671202286'; // Test identifier only; not a claimed club crest.
test('emoji config keeps large IDs as strings, rejects unsafe values and is off by default',()=>{
  const map=parseTeamEmojiMap(JSON.stringify({'40':emoji,'41':5368324170671202000,'42':'123" onclick="bad','__proto__':emoji}));
  assert.equal(map['40'],emoji);
  assert.deepEqual(Object.keys(map),['40']);
  for (const raw of ['',null,'[]','null','{bad','x'.repeat(50001)]) assert.deepEqual(Object.keys(parseTeamEmojiMap(raw)),[]);
  const api=createCommonInfrastructureRuntime({telegramIdList:()=>[],BILLING_PLANS:{PRO:{stars:1},PREMIUM:{stars:2}}});
  assert.equal(api.config({}).telegramTeamEmojiEnabled,false);
  const cfg=api.config({TELEGRAM_TEAM_EMOJI_ENABLED:'true',TELEGRAM_TEAM_EMOJI_IDS:JSON.stringify({'40':emoji})});
  assert.equal(cfg.telegramTeamEmojiEnabled,true);
  assert.equal(cfg.telegramTeamEmojiIds['40'],emoji);
});
test('club emoji lookup uses exact team IDs and safe HTML with a football fallback',()=>{
  const map=parseTeamEmojiMap(JSON.stringify({'40':emoji}));
  assert.equal(teamEmojiHtml(40,map),`<tg-emoji emoji-id="${emoji}">⚽</tg-emoji>`);
  for (const id of [41,0,-1,NaN,'40"',null,'040']) assert.equal(teamEmojiHtml(id,map),'⚽');
  const text=`<b>Матч</b> ${teamEmojiHtml(40,map)} Liverpool`;
  assert.equal(withoutTeamCustomEmoji(text),'<b>Матч</b> ⚽ Liverpool');
});
test('emoji fallback is allowed only after a definite Telegram rejection',()=>{
  assert.equal(isTeamEmojiRejected({status:400,code:'TELEGRAM_REJECTED',message:'CUSTOM_EMOJI_ID_INVALID'}),true);
  for (const error of [
    {status:429,code:'TELEGRAM_RATE_LIMIT',message:'custom emoji'},
    {status:500,code:'TELEGRAM_UPSTREAM',message:'custom emoji'},
    {code:'TELEGRAM_TIMEOUT',message:'custom emoji'},
    {status:400,code:'TELEGRAM_REJECTED',message:'chat not found'},
  ]) assert.equal(isTeamEmojiRejected(error),false);
});
