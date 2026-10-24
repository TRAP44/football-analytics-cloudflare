import test from 'node:test';
import assert from 'node:assert/strict';
import {createWatchExperience} from '../public/modules/watch-experience.js';
const KEY='matchradar:watch-mode:v1';
const mode=delaySeconds=>({fixtureId:420,delaySeconds,startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()});
function fixture(api){
 const values=new Map([[KEY,JSON.stringify(mode(90))]]),nodes=new Map();
 const banner={setAttribute(){},hidden:false,replaceChildren(){},querySelector:key=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key);}};
 const doc={body:{classList:{toggle(){}},before(){}},createElement:()=>banner,querySelector:()=>({before(){}}),getElementById:()=>({setAttribute(){}}),dispatchEvent(){}};
 const win={localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},setInterval(){}};
 return {experience:createWatchExperience({api,window:win,document:doc}),values};
}
test('restore uses the canonical server delay instead of confirming a stale local delay',async()=>{
 const server=mode(30),h=fixture(async()=>({watchSession:server}));await Promise.resolve();await Promise.resolve();
 assert.equal(h.experience.settings().delaySeconds,30);assert.equal(h.experience.settings().confirmed,true);assert.deepEqual(JSON.parse(h.values.get(KEY)),server);
});
test('late restore GET cannot overwrite a newer acknowledged user choice',async()=>{
 let finish;const old=new Promise(resolve=>finish=resolve);
 const h=fixture(async(_url,options)=>options?.method==='POST'?{watchSession:mode(60)}:old);
 await h.experience.setMode(420,true,60);finish({watchSession:mode(30)});await Promise.resolve();await Promise.resolve();
 assert.equal(h.experience.settings().delaySeconds,60);assert.equal(JSON.parse(h.values.get(KEY)).delaySeconds,60);
});
