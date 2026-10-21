import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync('public/app.js','utf8');
function block(start,end){return app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));}
function harness({get,post}={}){
  const requests=[],messages=[];
  const state={reminders:[],remindersLoaded:false,remindersLoading:false,remindersLoadError:'earlier failure',remindersRevision:0,reminderMutations:new Set(),matches:[],preferences:{reminderMinutes:15,kickoffNotification:true}};
  const context={state,collectionItems:x=>x.items,api:async(url,options)=>{requests.push({url,...options});return options?.method==='POST' ? (post ? post() : {item:{fixtureId:42,remindBeforeMinutes:15}}) : get ? get() : {items:[]};},toast:x=>messages.push(x),uiErrorMessage:(_e,fallback)=>fallback,renderReminderList(){},syncAllQuickReminderButtons(){},renderRadarFeed(){},renderObservationPanel(){},renderMatchCenter(){},renderProfile(){},renderAnalysis(){},syncReminderMutationUi(){},positiveEntityId:Number,runtimeAllows:()=>true,reminderMinutesValue:()=>15,hasReminder:id=>state.reminders.some(x=>x.fixtureId===id)};
  vm.createContext(context);
  vm.runInContext(block('let remindersLoadPromise = null;','async function handleReminderRemove')+block('async function toggleReminder','function clampPercent'),context);
  return {state,requests,messages,toggle:()=>context.toggleReminder({fixtureId:42})};
}
test('one tap after an initial reminder-read failure reloads then saves the selected 15 minute reminder',async()=>{
  const h=harness();await h.toggle();assert.deepEqual(h.requests.map(x=>x.method||'GET'),['GET','POST']);
  assert.equal(JSON.parse(h.requests[1].body).reminderMinutes,15);assert.equal(h.state.reminders[0].fixtureId,42);assert.match(h.messages[0],/за 15 минут/);assert.equal(h.state.reminderMutations.size,0);
});
test('concurrent taps share the recovery read and cannot submit duplicate reminder mutations',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});const h=harness({get:async()=>{await wait;return {items:[]};}});
  const a=h.toggle(),b=h.toggle();assert.equal(h.requests.length,1);release();await Promise.all([a,b]);assert.equal(h.requests.filter(x=>x.method==='POST').length,1);
});
test('a failed recovery read cannot write or claim a reminder was enabled',async()=>{
  const h=harness({get:async()=>{throw Error('offline');}});await h.toggle();assert.equal(h.requests.length,1);assert.equal(h.state.reminders.length,0);assert.doesNotMatch(h.messages.join(' '),/Напомним/);
});
test('the analysis reminder button exits Saving and reflects the confirmed active reminder',()=>{
  const button={disabled:true,textContent:'Сохраняю…',classList:{toggle(){}},setAttribute(){}};
  const state={reminderMutations:new Set(),preferences:{reminderMinutes:15},currentAnalysis:{match:{fixtureId:42}}};
  const context={state,positiveEntityId:Number,hasReminder:()=>true,reminderMinutesValue:()=>15,$:()=>button,document:{querySelectorAll:()=>[]}};
  vm.createContext(context);vm.runInContext(block('function syncQuickReminderButton','function syncAllQuickReminderButtons')+block('function syncReminderMutationUi','async function toggleReminder'),context);context.syncReminderMutationUi(42);assert.equal(button.disabled,false);assert.match(button.textContent,/Напоминание включено/);assert.doesNotMatch(button.textContent,/Сохраняю/);
});
