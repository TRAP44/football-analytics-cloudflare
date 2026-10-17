import test from 'node:test';
import assert from 'node:assert/strict';
import {withAnalysisWebBudget} from '../src/analysis-web-budget.js';

test('fast optional web results preserve data and receive a cancellation signal and capped budget',async()=>{
  const expected={available:true,answer:'confirmed context',results:[{title:'source'}]};
  const value=await withAnalysisWebBudget(async(signal,budget)=>{
    assert.equal(signal.aborted,false);assert.equal(budget,1500);return expected;
  },{timeoutMs:7000});
  assert.equal(value,expected);
});

test('a transport ignoring cancellation cannot hold analysis past the optional budget',async()=>{
  let signal,complete;
  const pending=withAnalysisWebBudget(async(value)=>{signal=value;return await new Promise(resolve=>{complete=resolve;});},{timeoutMs:20});
  await assert.rejects(pending,{code:'AI_WEB_TIME_BUDGET'});
  assert.equal(signal.aborted,true);
  complete({available:true,answer:'late data'});
  await new Promise(resolve=>setImmediate(resolve));
});

test('the same deadline covers response body parsing after fast headers',async()=>{
  let signal,rejectBody;
  const pending=withAnalysisWebBudget(async(value)=>{
    signal=value;
    const response={ok:true,json:()=>new Promise((_,reject)=>{rejectBody=reject;})};
    return await response.json();
  },{timeoutMs:20});
  await assert.rejects(pending,{code:'AI_WEB_TIME_BUDGET'});
  assert.equal(signal.aborted,true);
  rejectBody(new Error('late transport failure'));
  await new Promise(resolve=>setImmediate(resolve));
});

test('late success is rejected even when the event loop has not delivered the deadline timer',async()=>{
  let now=0,signal;
  await assert.rejects(withAnalysisWebBudget(async(value)=>{signal=value;now=1600;return {available:true};},{now:()=>now}),{code:'AI_WEB_TIME_BUDGET'});
  assert.equal(signal.aborted,true);
});

test('ordinary upstream failures propagate to the existing unavailable fallback',async()=>{
  const error=new Error('provider unavailable');
  await assert.rejects(withAnalysisWebBudget(async()=>{throw error;}),value=>value===error);
});
