import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {verifyReportedCrest,REPORTED_CREST_URL,installCrestFallback} from '../public/modules/team-crest.js';
const placeholder=fs.readFileSync('test-support/fixtures/api-sports-unavailable-25763.png');
test('the actual HTTP200 camera PNG is rejected by exact bytes; a replacement asset is preserved',async()=>{
  for(const [bytes,expected] of [[placeholder,'placeholder'],[Buffer.from('replacement asset'),'different']]){
    const result=await verifyReportedCrest(REPORTED_CREST_URL,{fetchImpl:async(url,options)=>{
      assert.equal(url,REPORTED_CREST_URL);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.headers,undefined);
      return new Response(bytes,{status:200});
    }});assert.equal(result,expected);
  }
});
test('unreported hosts never get inspected and resource failures remain a neutral fallback',async()=>{
  assert.equal(await verifyReportedCrest('https://other.example/logo.png',{fetchImpl:async()=>assert.fail('no network')}),'uninspected');
  for(const fetchImpl of [async()=>new Response(null,{status:404}),async()=>new Response(new Uint8Array(128001)),async()=>{throw Error('private token');}])assert.equal(await verifyReportedCrest(REPORTED_CREST_URL,{fetchImpl}),'unavailable');
});
function harness(){
 let source=REPORTED_CREST_URL,removed=false,marker,error;
 const image={dataset:{teamCrest:'FARDU'},parentNode:{},getAttribute:()=>source,matches:()=>true,addEventListener:(name,handler)=>{if(name==='error')error=handler;},hidden:false,
  ownerDocument:{createElement:()=>({setAttribute(){},remove(){this.removed=true;}})},
  before:m=>{marker=m;},remove:()=>{removed=true;image.parentNode=null;},replaceWith:m=>{marker=m;removed=true;image.parentNode=null;}};
 return {image,error:()=>error?.(),change:()=>{source='https://other.example/new.png';},get removed(){return removed;},get marker(){return marker;}};
}
test('verified placeholders never flash while a changed real badge is allowed to show',async()=>{
 for(const result of ['placeholder','different','unavailable']){
  const h=harness();installCrestFallback(h.image,{verify:async()=>result});assert.equal(h.image.hidden,true);assert.equal(h.marker.textContent,'FA');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.removed,result!=='different');
  if(result==='different'){assert.equal(h.image.hidden,false);assert.equal(h.marker.removed,true);}
 }
});
test('late verification does not overwrite a changed image source',async()=>{
 let finish;const h=harness();installCrestFallback(h.image,{verify:()=>new Promise(resolve=>{finish=resolve;})});
 await Promise.resolve();h.change();finish('placeholder');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.removed,false);assert.equal(h.marker.removed,true);assert.equal(h.image.hidden,false);
});


test('network error fallback is retained when a late verification finishes',async()=>{
 let finish;const h=harness();installCrestFallback(h.image,{verify:()=>new Promise(resolve=>{finish=resolve;})});
 await Promise.resolve();h.error();finish('placeholder');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.removed,true);assert.notEqual(h.marker.removed,true);assert.equal(h.marker.textContent,'FA');
});


test('rejected late verification also unhides a changed source',async()=>{
 let reject;const h=harness();installCrestFallback(h.image,{verify:()=>new Promise((_resolve,fail)=>{reject=fail;})});
 await Promise.resolve();h.change();reject(Error('failed'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.removed,false);assert.equal(h.marker.removed,true);assert.equal(h.image.hidden,false);
});


test('a neutral marker preserves compact feed badge dimensions before hiding the image',async()=>{
 const h=harness(),properties={};h.image.getBoundingClientRect=()=>({width:18,height:18});
 h.image.ownerDocument.createElement=()=>({setAttribute(){},style:{setProperty:(key,value)=>{properties[key]=value;}},remove(){}});
 installCrestFallback(h.image,{verify:async()=> 'placeholder'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(properties['--crest-width'],'18px');assert.equal(properties['--crest-height'],'18px');assert.equal(properties['--crest-font-size'],'8px');
});
