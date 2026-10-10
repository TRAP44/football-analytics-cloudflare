import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHomePersonalMatch } from '../public/modules/home-match-priority.js';

const nowMs=Date.parse('2026-10-10T10:00:00Z');
function row(fixtureId,{live=true,favorite=true,date='',score=0}={}) {
  return {fixtureId,live,date,insight:{favorite,viewedTeam:!favorite,score}};
}
function select(matches) {
  return selectHomePersonalMatch({matches,signals:{hasPersonalData:true},nowMs,insightForMatch:m=>m.insight})?.match;
}
function permutations(rows) {
  if (!rows.length) return [[]];
  return rows.flatMap((row,i)=>permutations(rows.filter((_,j)=>j!==i)).map(rest=>[row,...rest]));
}
function assertOrder(rows,expected) {
  for (const input of permutations(rows)) {
    const remaining=[...input],actual=[];
    while (remaining.length) {
      const best=select(remaining);
      assert.ok(best);
      actual.push(best.fixtureId);
      remaining.splice(remaining.indexOf(best),1);
    }
    assert.deepEqual(actual,expected,JSON.stringify(input.map(r=>r.fixtureId)));
  }
}

test('LIVE remains ahead of scheduled favorites and favorite evidence outranks viewed teams',()=>{
  assertOrder([
    row(1,{live:false,date:'2026-10-10T11:00:00Z',score:999}),
    row(2,{favorite:false,date:'2026-10-10T10:30:00Z',score:999}),
    row(3,{favorite:true,score:0}),
  ],[3,2,1]);
});
test('known kickoff precedes unknown kickoff even with a lower score, in either input order',()=>{
  assertOrder([row(1,{date:'2026-10-10T11:00:00Z',score:1}),row(2,{score:999})],[1,2]);
});
test('two known kickoffs sort chronologically before rating',()=>{
  assertOrder([row(1,{date:'2026-10-10T11:00:00Z',score:1}),row(2,{date:'2026-10-10T12:00:00Z',score:999})],[1,2]);
});
test('equal known kickoffs and two unknown kickoffs use numeric score',()=>{
  assertOrder([row(1,{date:'2026-10-10T11:00:00Z',score:5}),row(2,{date:'2026-10-10T11:00:00Z',score:10})],[2,1]);
  assertOrder([row(1,{score:5}),row(2,{score:10})],[2,1]);
});
test('mixed known and unknown kickoff order is transitive across all permutations',()=>{
  assertOrder([
    row(1,{date:'2026-10-10T11:00:00Z',score:0}),
    row(2,{date:'2026-10-10T12:00:00Z',score:100}),
    row(3,{score:50}),
    row(4,{date:'malformed',score:200}),
  ],[1,2,4,3]);
});
test('equal keys remain stable and unknown scheduled kickoff is still excluded',()=>{
  const a=row(1),b=row(2);
  assert.equal(select([a,b]),a);
  assert.equal(select([b,a]),b);
  a.date=b.date='2026-10-10T11:00:00Z';
  assert.equal(select([a,b]),a);
  assert.equal(select([b,a]),b);
  assert.equal(select([row(3,{live:false,score:999})]),undefined);
});
