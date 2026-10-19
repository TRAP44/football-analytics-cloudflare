import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchQuestionAnswerHtml, matchQuestionsShellHtml } from '../public/modules/match-questions.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

test('shell: four ready questions, bounded input, honest note', () => {
  const html = matchQuestionsShellHtml(esc);
  assert.equal((html.match(/data-question-preset=/g) || []).length, 4);
  for (const label of ['Почему такой прогноз?', 'Что может изменить исход?', 'Кто в форме?', 'Что с составами и потерями?']) assert.ok(html.includes(label), label);
  assert.match(html, /maxlength="200"/);
  assert.match(html, /<button[^>]*type="button"[^>]*data-question-start/);
  assert.match(html, /Ответы основаны на данных этого матча/);
  assert.doesNotMatch(html, /коэффициент|П1|П2|1X2/);
});

test('answers: server facts only, "not in the data", refusal and limits', () => {
  const facts = matchQuestionAnswerHtml({
    available: true, answer: 'facts', question: 'Кто в форме?', remaining: 4,
    items: [
      { role: 'support', connector: 'Это подкрепляет:', text: 'Милан: 4 победы в 5 матчах.' },
      { role: 'bogus', connector: 'X', text: 'выдумка' },
      { role: 'risk', connector: 'Риск:', text: '<img src=x onerror=alert(1)>' },
    ],
  }, esc);
  assert.match(facts, /«Кто в форме\?»/);
  assert.match(facts, /Милан: 4 победы/);
  assert.doesNotMatch(facts,/Это подкрепляет|<ol|<b>Риск/);
  assert.doesNotMatch(facts, /выдумка/, 'unknown roles are dropped');
  assert.doesNotMatch(facts, /<img/);
  assert.match(facts, /Осталось своих вопросов в этот час: 4/);

  assert.match(matchQuestionAnswerHtml({ available: true, answer: 'not_in_data', question: 'Погода?' }, esc), /В данных этого матча ответа на этот вопрос нет/);
  assert.match(matchQuestionAnswerHtml({ available: true, answer: 'facts', items: [] }, esc), /ответа на этот вопрос нет/, 'empty facts fall back to "not in the data"');
  assert.match(matchQuestionAnswerHtml({ available: true, answer: 'refused' }, esc), /Ставки мы не подсказываем/);
  assert.match(matchQuestionAnswerHtml({ available: false, reason: 'user_limit', remaining: 0 }, esc), /Лимит вопросов на этот час исчерпан/);
  assert.match(matchQuestionAnswerHtml({ available: false, reason: 'daily_limit' }, esc), /На сегодня вопросы к AI закончились/);
  assert.match(matchQuestionAnswerHtml({ available: false, reason: 'rate_limited' }, esc), /подождите минуту/);
  assert.match(matchQuestionAnswerHtml(null, esc), /Не удалось получить ответ/);
});

test('analysis screen mounts the questions block lazily under the explanation', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /id="matchExplanation"[^\n]*\n\s*<section class="panel match-explanation match-questions" id="matchQuestions" data-fixture=/);
  assert.match(app, /import\('\.\/modules\/match-questions\.js\?v=6\.120\.0-launch\d+'\)/);
  assert.match(app, /void loadMatchQuestions\(Number\(m\.fixtureId\)\);/);
  const css = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
  assert.match(css, /\.match-question-form input \{[\s\S]*?min-width: 0;/);
});

test('complete long starting XI is visible and escaped; regular answer size stays bounded',()=>{
  const text=Array.from({length:11},(_,i)=>`Player ${i+1} Longfamilyname Surname`).join(', ');
  const html=matchQuestionAnswerHtml({available:true,answer:'facts',items:[{id:'starters_home',role:'caveat',connector:'Данные:',text:text+' <script>'}]},esc);
  assert.ok(html.includes('Player 11 Longfamilyname Surname'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.doesNotMatch(html,/<script>/);
  const ordinary=matchQuestionAnswerHtml({available:true,answer:'facts',items:[{id:'form_home',role:'support',connector:'Форма:',text:'x'.repeat(400)}]},esc);
  assert.ok(ordinary.includes('x'.repeat(300)));
  assert.ok(!ordinary.includes('x'.repeat(301)));
});
