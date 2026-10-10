import test from 'node:test';
import assert from 'node:assert/strict';
import { observationRows,renderObservationPanel } from '../public/modules/match-observation.js';

test('observation retains missing and finished matches, deduplicates ids and prioritizes LIVE',()=>{
 const rows=observationRows([{fixtureId:1},{fixtureId:'1'},{fixtureId:2},{fixtureId:3},{fixtureId:true}], [{fixtureId:2,live:true},{fixtureId:3,finished:true}]);
 assert.deepEqual(rows.map(r=>r.id),[2,1,3]);
 assert.equal(rows[1].match,undefined);
 assert.equal(rows[2].match.finished,true);
});
test('empty observation hides and clears previous content',()=>{
 const root={hidden:false,innerHTML:'old'};
 renderObservationPanel({root,watchlist:[],matches:[]});
 assert.equal(root.hidden,true);assert.equal(root.innerHTML,'');
});
test('observation escapes names and exposes separate notification state',()=>{
 const root={hidden:true,innerHTML:'',querySelectorAll:()=>[]};
 renderObservationPanel({root,watchlist:[{fixtureId:1,homeName:'<script><SCRIPT>',awayName:'B'}],matches:[],reminders:[{fixtureId:1}],escapeHtml:s=>String(s).replaceAll('<','&lt;'),dateTime:()=>'',onOpen:()=>{},onRemove:()=>{}});
 assert.equal(root.hidden,false);
 assert.match(root.innerHTML,/&lt;script>/);assert.match(root.innerHTML,/&lt;SCRIPT>/);assert.doesNotMatch(root.innerHTML,/<script>/i);
 assert.match(root.innerHTML,/Нет в текущей ленте/);
 assert.match(root.innerHTML,/Telegram-напоминание включено/);
});
