import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketParserRuntime } from '../src/market-parser.js';

const round1=n=>Math.round(n*10)/10;
const normalizeThree=(a,b,c)=>{
  const sum=a+b+c;
  if (!sum) return null;
  return {home:round1(a/sum*100),draw:round1(b/sum*100),away:round1(c/sum*100)};
};
const {parsePercent,extractMarket}=createMarketParserRuntime({round1,normalizeThree});

test('parsePercent accepts percent strings and comma decimals',()=>{
  assert.equal(parsePercent('53%'),53);
  assert.equal(parsePercent('27,5%'),27.5);
  assert.equal(parsePercent(19),19);
  assert.equal(parsePercent('invalid'),null);
});

test('extractMarket averages valid Match Winner books and normalizes implied probabilities',()=>{
  const result=extractMarket([
    {bookmakers:[
      {bets:[{name:'Match Winner',values:[
        {value:'Home',odd:'2.00'},
        {value:'Draw',odd:'3.50'},
        {value:'Away',odd:'4.00'},
      ]}]},
      {bets:[{name:'Match Winner',values:[
        {value:'Home',odd:'2.20'},
        {value:'Draw',odd:'3.30'},
        {value:'Away',odd:'3.80'},
      ]}]},
    ]},
  ]);

  assert.deepEqual(result.odds,{home:2.1,draw:3.4,away:3.9});
  assert.equal(result.bookmakers,2);
  assert.equal(result.sources,2);
  assert.equal(result.provider,'api-football');
  const total=result.probabilities.home+result.probabilities.draw+result.probabilities.away;
  assert.ok(Math.abs(total-100)<=0.2);
  assert.ok(result.probabilities.home>result.probabilities.draw);
  assert.ok(result.probabilities.draw>result.probabilities.away);
});

test('extractMarket ignores incomplete or non-Match-Winner rows',()=>{
  const result=extractMarket([
    {bookmakers:[
      {bets:[{name:'Goals Over/Under',values:[{value:'Over 2.5',odd:'1.8'}]}]},
      {bets:[{name:'Match Winner',values:[
        {value:'Home',odd:'2.0'},
        {value:'Draw',odd:'3.0'},
      ]}]},
    ]},
  ]);
  assert.equal(result,null);
});
