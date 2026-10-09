import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { digestLocalDeliveryWindow } from '../public/modules/digest-settings.js';
import { buildPassPurchaseBody } from '../public/modules/billing.js';
import { createBetaFeedbackModule } from '../public/modules/beta-feedback.js';

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const billing = fs.readFileSync('public/modules/billing.js', 'utf8');
const digest = fs.readFileSync('public/modules/digest-settings.js', 'utf8');
const notifications = fs.readFileSync('public/modules/smart-notifications.js', 'utf8');

test('Profile removes the duplicate My Teams block and makes useful counters actionable', () => {
  assert.doesNotMatch(html, /profile-teams-shortcut/);
  assert.doesNotMatch(html, /id="profileMyTeamsBtn"/);
  assert.match(html, /id="profileFavoriteTeamsBtn"/);
  assert.match(html, /id="profileRemindersBtn"/);
  assert.match(html, /id="remindersPanel"/);
  assert.match(html, /id="reminderList"/);
  assert.match(html, /Активные напоминания/);
  assert.match(app, /profileFavoriteTeamsBtn/);
  assert.match(app, /profileRemindersBtn[^]*remindersPanel[^]*scrollIntoView/);
});

test('Profile uses plain Russian copy and removes technical data availability chrome', () => {
  assert.doesNotMatch(html, /smart-уведомления/);
  assert.doesNotMatch(html, /notification-возможности/);
  assert.doesNotMatch(html, /Что может быть в матче/);
  assert.doesNotMatch(html, /profile-data-details/);
  assert.match(notifications, /УМНЫЕ УВЕДОМЛЕНИЯ/);
  assert.match(notifications, /AI-сигналы/);
  assert.doesNotMatch(notifications, /Smart Alerts/);
  assert.doesNotMatch(notifications, /cooldown/);
});

test('Digest renders the fixed delivery schedule in local browser time without implementation wording', () => {
  assert.match(digest, /digestLocalDeliveryWindow/);
  assert.match(digest, /По вашему местному времени/);
  assert.match(digest, /Время доставки задаётся автоматически/);
  assert.doesNotMatch(digest, /Время пока нельзя изменить вручную|серверное окно доставки|Фиксированное окно текущей серверной доставки · 07:00–07:55 UTC/);
});

test('Match Pass profile context does not inherit an unrelated last viewed fixture', () => {
  assert.match(billing, /return safeFixtureId\(passFixtureId\)/);
  assert.match(billing, /function clearPassContext/);
  assert.doesNotMatch(billing, /Сервер подпишет именно этот fixtureId/);
  assert.match(billing, /После выбора подтвердите покупку/);
  assert.match(app, /profileBtn[\s\S]*billingModule\?\.clearPassContext/);
  assert.match(app, /navProfile[\s\S]*billingModule\?\.clearPassContext/);
});



test('Digest invalid timezone falls back to the browser local window rather than raw UTC',()=>{
  const when=new Date('2026-06-15T12:00:00.000Z');
  const local=digestLocalDeliveryWindow(7,when);
  assert.equal(digestLocalDeliveryWindow(7,when,'Not/ARealZone'),local);
  assert.match(local,/^\d{2}:\d{2}–\d{2}:\d{2}$/);
});

test('Digest delivery respects named summer and winter timezone offsets',()=>{
  assert.equal(digestLocalDeliveryWindow(7,new Date('2026-06-15T12:00:00Z'),'Europe/Riga'),'10:00–10:55');
  assert.equal(digestLocalDeliveryWindow(7,new Date('2026-12-15T12:00:00Z'),'Europe/Riga'),'09:00–09:55');
  assert.equal(digestLocalDeliveryWindow(7,new Date('2026-06-15T12:00:00Z'),'UTC'),'07:00–07:55');
});

test('Match Pass purchase always requires a validated explicitly selected fixture',()=>{
  assert.deepEqual(buildPassPurchaseBody('MATCH_PASS',12345),{passType:'MATCH_PASS',fixtureId:12345});
  assert.deepEqual(buildPassPurchaseBody('MATCH_PASS','00012345'),{passType:'MATCH_PASS',fixtureId:12345});
  for(const invalid of [undefined,null,0,-1,true,[],{},'1e3','123?next=45','9007199254740992']){
    assert.equal(buildPassPurchaseBody('MATCH_PASS',invalid),null);
  }
  assert.deepEqual(buildPassPurchaseBody('DAY_PASS',0),{passType:'DAY_PASS'});
  assert.equal(buildPassPurchaseBody('UNKNOWN',123),null);
});

test('Profile and navigation clicks clear old Match Pass fixture context before entering profile',()=>{
  const handlers=[
    app.slice(app.indexOf("$('profileBtn').addEventListener"),app.indexOf("$('profileBtn').addEventListener")+350),
    app.slice(app.indexOf("$('navProfile').addEventListener"),app.indexOf("$('navProfile').addEventListener")+230),
  ];
  for(const handler of handlers){
    assert.match(handler,/billingModule\?\.clearPassContext\(\)/);
    assert.ok(handler.indexOf('clearPassContext()')<handler.indexOf('openProfileView()'));
  }
});



function createFeedbackHarness({api=async()=>({ok:true})}={}){
  const state={betaFeedbackSending:false};
  const elements=new Map();
  const el=id=>{
    if(!elements.has(id))elements.set(id,{
      value:'',textContent:'',disabled:false,hidden:id==='betaFeedbackForm',
      attrs:{},setAttribute(name,value){this.attrs[name]=value;},
      focus(){this.focused=true;},
    });
    return elements.get(id);
  };
  el('betaFeedbackCategory').value='search';
  el('betaFeedbackSeverity').value='MAJOR';
  el('betaFeedbackNote').value='Проблема с поиском';
  const calls=[],scheduled=[];
  const module=createBetaFeedbackModule({
    state,elementById:el,
    api:async(path,options)=>{calls.push({path,options});return api(path,options);},
    schedule:(fn,ms)=>scheduled.push({fn,ms}),
  });
  return {state,module,el,calls,scheduled};
}

test('feedback submits only explicit category, severity and text with no retry',async()=>{
  const h=createFeedbackHarness();
  h.module.setBetaFeedbackOpen(true);
  await h.module.submitBetaFeedback();
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].path,'/api/beta-feedback');
  assert.deepEqual(JSON.parse(h.calls[0].options.body),{
    category:'search',severity:'MAJOR',note:'Проблема с поиском',
  });
  assert.equal(h.calls[0].options.method,'POST');
  assert.equal(h.calls[0].options.retry,false);
  assert.equal(h.calls[0].options.dedupe,false);
  assert.equal(h.calls[0].options.timeoutMs,6500);
  assert.equal(h.el('betaFeedbackNote').value,'');
  assert.equal(h.scheduled[0].ms,900);
  h.scheduled[0].fn();
  assert.equal(h.el('betaFeedbackForm').hidden,true);
});

test('feedback rejects invalid fields and oversized text without contacting the API',async()=>{
  const h=createFeedbackHarness();
  const category=h.el('betaFeedbackCategory');
  const severity=h.el('betaFeedbackSeverity');
  const note=h.el('betaFeedbackNote');
  category.value='invalid';
  await h.module.submitBetaFeedback();
  assert.match(h.el('betaFeedbackStatus').textContent,/Выберите раздел/);
  category.value='search';severity.value='WRONG';
  await h.module.submitBetaFeedback();
  assert.match(h.el('betaFeedbackStatus').textContent,/Выберите важность/);
  severity.value='MAJOR';note.value=' abc ';
  await h.module.submitBetaFeedback();
  assert.match(h.el('betaFeedbackStatus').textContent,/Кратко опишите/);
  note.value='x'.repeat(601);
  await h.module.submitBetaFeedback();
  assert.match(h.el('betaFeedbackStatus').textContent,/600 символов/);
  assert.equal(h.calls.length,0);
  note.value='x'.repeat(600);
  await h.module.submitBetaFeedback();
  assert.equal(h.calls.length,1);
});

test('feedback prevents concurrent duplicate writes and re-enables the send control',async()=>{
  let resolve;
  const h=createFeedbackHarness({api:()=>new Promise(r=>{resolve=r;})});
  h.module.setBetaFeedbackOpen(true);
  const send=h.module.submitBetaFeedback();
  assert.equal(h.state.betaFeedbackSending,true);
  assert.equal(h.el('betaFeedbackSendBtn').disabled,true);
  await h.module.submitBetaFeedback();
  assert.equal(h.calls.length,1);
  resolve({ok:true});
  await send;
  assert.equal(h.state.betaFeedbackSending,false);
  assert.equal(h.el('betaFeedbackSendBtn').disabled,false);
});

test('late feedback responses never erase a new draft after form close and reopen',async()=>{
  let resolve;
  const h=createFeedbackHarness({api:()=>new Promise(r=>{resolve=r;})});
  h.module.setBetaFeedbackOpen(true);
  const send=h.module.submitBetaFeedback();
  h.module.setBetaFeedbackOpen(false);
  h.module.setBetaFeedbackOpen(true);
  h.el('betaFeedbackNote').value='Новая проблема после переподключения';
  resolve({ok:true});
  await send;
  assert.equal(h.el('betaFeedbackNote').value,'Новая проблема после переподключения');
  assert.equal(h.el('betaFeedbackForm').hidden,false);
  assert.equal(h.el('betaFeedbackStatus').textContent,'');
  assert.equal(h.scheduled.length,0);
});

test('editing a new draft during submission prevents auto-close and preserves error text safely',async()=>{
  let resolve;
  const h=createFeedbackHarness({api:()=>new Promise(r=>{resolve=r;})});
  h.module.setBetaFeedbackOpen(true);
  const send=h.module.submitBetaFeedback();
  h.el('betaFeedbackNote').value='Новая версия обращения';
  resolve({ok:true});
  await send;
  assert.equal(h.el('betaFeedbackNote').value,'Новая версия обращения');
  assert.equal(h.scheduled.length,0);
  const fail=createFeedbackHarness({api:async()=>{throw new Error('<img src=x onerror=alert(1)>')}});
  await fail.module.submitBetaFeedback();
  assert.equal(fail.el('betaFeedbackStatus').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(fail.state.betaFeedbackSending,false);
  assert.equal(fail.el('betaFeedbackSendBtn').disabled,false);
});
