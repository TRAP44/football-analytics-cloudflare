import test from 'node:test';
import assert from 'node:assert/strict';
import {morningNewsCompact} from '../src/morning-news-format.js';
test('morning feed uses team colours and links without redundant service text',()=>{
 const text=morningNewsCompact([{title:'Liverpool and Manchester City announce squads | BBC',url:'https://www.bbc.com/sport/1'}]);
 assert.match(text,/🔴 Liverpool · 🔵 Manchester City/);
 assert.match(text,/announce squads<\/b><\/a>/);
 assert.doesNotMatch(text,/Веб-источник|влияние|Источник 1|\| BBC/);
});
test('morning feed rejects betting pages and unsafe URLs and escapes HTML',()=>{
 const text=morningNewsCompact([{title:'Liverpool Prediction',url:'https://example.com/a'},{title:'Unsafe',url:'javascript:alert(1)'},{title:'<SCRIPT>Club & news</SCRIPT>',url:'https://example.com/b'}]);
 assert.doesNotMatch(text,/<script>|Prediction|javascript:/i);
 assert.match(text,/&lt;SCRIPT&gt;/);assert.match(text,/&amp;/);
 assert.equal(morningNewsCompact([]),'');
});

test('morning feed caps unique news and identifies Inter without a Milan duplicate',()=>{
 const items=Array.from({length:6},(_,i)=>({title:`Inter Milan club update ${i}`,url:`https://example.com/${i}`}));
 const text=morningNewsCompact([items[0],items[0],...items.slice(1)]);
 assert.equal((text.match(/<a href=/g)||[]).length,3);
 assert.match(text,/🔵⚫ Inter/);
 assert.doesNotMatch(text,/🔴⚫ Milan/);
 assert.equal(morningNewsCompact([{title:'Unsafe',url:'https://user:password@example.com/'}]),'');
});
