import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createMyTeamsRenderer } from '../public/modules/my-teams-renderer.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const loader=app.slice(app.indexOf('async function loadFavorites()'),app.indexOf('async function loadReminders()'));

function harness(initial={}) {
  const state={favorites:[],favoritesLoaded:false,favoritesLoading:false,favoritesRevision:0,matches:[],...initial};
  const root={innerHTML:'',querySelectorAll:()=>[]};
  const onboarding={hidden:false};
  let retry;
  let request;
  let requests=0;
  const renderer=createMyTeamsRenderer({
    state,
    elementById:id=>({myTeamsList:root,myTeamsOnboarding:onboarding,myTeamsRetry:{addEventListener:(_,fn)=>{retry=fn;}}})[id],
    escapeHtml:String,safeUrl:()=>'',timeOf:()=>'',onOpenTeam:()=>{},onOpenMatch:()=>{},
    onRetryLoad:()=>{request=load();},
  });
  let respond;
  const load=runInNewContext(`${loader}; loadFavorites`,{
    state,
    api:()=>{requests++;return new Promise((resolve,reject)=>{respond={resolve,reject};});},
    collectionItems:data=>data.items,
    uiErrorMessage:()=> 'Не удалось загрузить избранное.',
    toast:()=>{},renderFavoriteTeams:()=>{},renderMatches:()=>{},renderDiscoveryHome:()=>{},renderFirstRunGuide:()=>{},
    renderMyTeams:renderer.renderMyTeams,
  });
  return {state,root,onboarding,renderer,load,retry:()=>retry(),get request(){return request;},get respond(){return respond;},get requests(){return requests;}};
}

test('first failure leaves loading, hides onboarding, and retry restores saved teams',async()=>{
  const h=harness();
  h.renderer.renderMyTeams();
  assert.equal(h.onboarding.hidden,true);
  assert.match(h.root.innerHTML,/Загружаю ваши команды/);
  const first=h.load();
  assert.match(h.root.innerHTML,/Загружаю ваши команды/);
  h.respond.reject(new Error('Supabase HTTP 503 private details'));
  await first;
  assert.match(h.root.innerHTML,/Не удалось обновить команды/);
  assert.doesNotMatch(h.root.innerHTML,/Загружаю|Supabase|503|private/);
  assert.equal(h.onboarding.hidden,true);
  h.retry();
  assert.match(h.root.innerHTML,/Загружаю ваши команды/);
  h.retry();
  assert.equal(h.requests,2,'double click must not start a second request');
  h.respond.resolve({items:[{teamId:7,teamName:'Арсенал'}]});
  await h.request;
  assert.match(h.root.innerHTML,/Арсенал/);
  assert.doesNotMatch(h.root.innerHTML,/myTeamsRetry|Не удалось/);
  assert.equal(h.onboarding.hidden,true);
});

test('failed refresh preserves existing teams and recovery removes the warning',async()=>{
  const h=harness({favoritesLoaded:true,favorites:[{teamId:7,teamName:'Арсенал'}]});
  const first=h.load();
  assert.match(h.root.innerHTML,/Арсенал/);
  h.respond.reject(new Error('offline'));
  await first;
  assert.match(h.root.innerHTML,/Арсенал/);
  assert.match(h.root.innerHTML,/Показан ранее загруженный список/);
  h.retry();
  h.respond.resolve({items:[{teamId:9,teamName:'Милан'}]});
  await h.request;
  assert.match(h.root.innerHTML,/Милан/);
  assert.doesNotMatch(h.root.innerHTML,/Арсенал|myTeamsRetry/);
});

test('empty list invites selection only after successful load, including recovery',async()=>{
  const h=harness({favoritesLoaded:true});
  const first=h.load();
  assert.equal(h.onboarding.hidden,true);
  h.respond.reject(new Error('offline'));
  await first;
  assert.equal(h.onboarding.hidden,true);
  assert.match(h.root.innerHTML,/myTeamsRetry/);
  h.retry();
  h.respond.resolve({items:[]});
  await h.request;
  assert.equal(h.root.innerHTML,'');
  assert.equal(h.onboarding.hidden,false);
});

test('outdated failed request cannot overwrite a newer local favorite mutation',async()=>{
  const h=harness();
  const first=h.load();
  h.state.favoritesRevision++;
  h.state.favoritesLoaded=true;
  h.state.favorites=[{teamId:7,teamName:'Арсенал'}];
  h.respond.reject(new Error('offline'));
  await first;
  assert.match(h.root.innerHTML,/Арсенал/);
  assert.doesNotMatch(h.root.innerHTML,/myTeamsRetry/);
  assert.equal(h.state.favoritesLoading,false);
});
