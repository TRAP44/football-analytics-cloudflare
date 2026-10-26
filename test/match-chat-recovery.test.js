import test from 'node:test';
import assert from 'node:assert/strict';
import {matchChatErrorMessage,conversationHtml} from '../public/modules/match-questions.js';

test('chat distinguishes expired Telegram authentication, rate limits and connection failures',()=>{
 assert.match(matchChatErrorMessage({status:401}),/Сессия Telegram.*снова из бота/);
 assert.doesNotMatch(matchChatErrorMessage({status:401}),/AI сейчас не ответил/);
 assert.match(matchChatErrorMessage({status:408}),/слишком долго/);
 assert.match(matchChatErrorMessage({status:429}),/вопросов подряд/);
 assert.match(matchChatErrorMessage({status:503}),/Сервис временно недоступен/);
 assert.match(matchChatErrorMessage(new TypeError('network')),/соединение/);
 assert.match(matchChatErrorMessage({status:503},true),/Ответ прервался/);
});
test('only the latest failed turn offers manual retry, and response text stays escaped',()=>{
 const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
 const old={question:'old',error:'<img>',paragraphs:[]},latest={question:'new',error:'retry',paragraphs:[]};
 const html=conversationHtml({messages:[old,latest],busy:false},esc);
 assert.equal((html.match(/data-question-retry/g)||[]).length,1);assert.doesNotMatch(html,/<img>/);
 assert.match(conversationHtml({messages:[latest],busy:true},esc),/data-question-retry disabled/);
 assert.doesNotMatch(conversationHtml({messages:[old,{question:'ok',paragraphs:[{text:'answer'}]}],busy:false},esc),/data-question-retry/);
});
