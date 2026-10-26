import test from 'node:test';
import assert from 'node:assert/strict';
import {teamInitials,usableCrestUrl,crestFallbackHtml,installCrestFallback,preferredTeamCrestUrl,canonicalCrestUrl} from '../public/modules/team-crest.js';
test('neutral initials support Cyrillic and single names without inventing a club logo',()=>{
  assert.equal(teamInitials('FARDU'),'FA');assert.equal(teamInitials('Манчестер Юнайтед'),'МЮ');assert.equal(teamInitials(''),'FC');
  assert.equal(teamInitials('⚽ Étoile'),'ÉT');
  assert.equal(crestFallbackHtml('<script>',s=>s),'<span class="team-crest-initials" aria-hidden="true">SC</span>');
});
test('only usable http URLs are accepted; legitimate default paths are retained',()=>{
  for(const value of ['',null,'javascript:alert(1)','https://user:secret@example.com/a.png'])assert.equal(usableCrestUrl(value),'');
  assert.equal(usableCrestUrl('https://example.com/default/team.png'),'https://example.com/default/team.png');
});
function image({complete=false,width=0}={}){
  let src='https://example.com/team.png',replacement=null,handler;
  const img={dataset:{teamCrest:'FARDU'},complete,naturalWidth:width,parentNode:{},matches:()=>true,
    getAttribute:()=>src,addEventListener:(_name,fn)=>{handler=fn;},replaceWith:node=>{replacement=node;},
    ownerDocument:{createElement:()=>({setAttribute(){}})}};
  return {img,error:()=>handler?.(),change:()=>{src='https://example.com/new.png';},get replacement(){return replacement;}};
}
test('missing images become text-only shields and loaded logos remain intact',()=>{
  const missing=image({complete:true});installCrestFallback(missing.img);assert.equal(missing.replacement.textContent,'FA');
  const failed=image();installCrestFallback(failed.img);failed.error();assert.equal(failed.replacement.textContent,'FA');
  const loaded=image({complete:true,width:100});installCrestFallback(loaded.img);assert.equal(loaded.replacement,null);
  const changed=image();installCrestFallback(changed.img);changed.change();changed.error();assert.equal(changed.replacement,null);
});

test('official crests require verified provider identity, never an unrelated matching name',()=>{
  assert.equal(preferredTeamCrestUrl({id:25763,name:'FARDU'}),'/assets/teams/fardu-pfl.webp');
  assert.equal(preferredTeamCrestUrl({id:123,name:'FARDU'}),canonicalCrestUrl(123));
  const lochin={id:900001,name:'Lochin'},context={league:'Pro League A',opponentId:25763,opponentName:'FARDU'};
  assert.equal(preferredTeamCrestUrl(lochin,context),'/assets/teams/lochin-pfl.webp');
  for(const change of [{league:'Other league'},{opponentId:123},{opponentName:'Other club'}])assert.equal(preferredTeamCrestUrl(lochin,{...context,...change}),canonicalCrestUrl(lochin.id));
  assert.equal(preferredTeamCrestUrl(lochin),canonicalCrestUrl(lochin.id));
  assert.equal(canonicalCrestUrl('33'),'');assert.equal(canonicalCrestUrl(0),'');
});

test('loaded camera classification is fenced when the source changes',async()=>{
  let finish,source=canonicalCrestUrl(900001),replaced=false;const listeners={};
  const img={dataset:{teamCrest:'Camera FC'},complete:true,naturalWidth:150,naturalHeight:150,crossOrigin:'anonymous',parentNode:{},matches:()=>true,getAttribute:()=>source,
    addEventListener:(name,handler)=>{listeners[name]=handler;},replaceWith:()=>{replaced=true;},ownerDocument:{createElement:()=>({setAttribute(){}})}};
  installCrestFallback(img,{inspectLoaded:()=>new Promise(resolve=>{finish=resolve;})});
  await Promise.resolve();source=canonicalCrestUrl(33);finish(true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(replaced,false);
});
