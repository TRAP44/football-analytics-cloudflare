import test from 'node:test';
import assert from 'node:assert/strict';
import {teamInitials,usableCrestUrl,crestFallbackHtml,installCrestFallback} from '../public/modules/team-crest.js';
test('neutral initials support Cyrillic and single names without inventing a club logo',()=>{
  assert.equal(teamInitials('FARDU'),'FA');assert.equal(teamInitials('Манчестер Юнайтед'),'МЮ');assert.equal(teamInitials(''),'FC');
  assert.equal(teamInitials('⚽ Étoile'),'ÉT');
  assert.doesNotMatch(crestFallbackHtml('<script>',s=>s.replaceAll('<','&lt;')),/<script>/);
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
