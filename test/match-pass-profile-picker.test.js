import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBillingModule,matchPassPickerRows} from '../public/modules/billing.js';

const fixture=(fixtureId,home,away,{live=false,finished=false}={})=>({
  fixtureId,home:{name:home},away:{name:away},league:'Premier League',
  date:'2026-10-08T18:00:00Z',live,finished,
});

test('profile Match Pass picker searches, filters, and excludes non-fixtures',()=>{
  const rows=[
    fixture(101,'Ливерпуль','Челси'),
    fixture(102,'Реал','Барселона',{live:true}),
    fixture(103,'Арсенал','Тоттенхэм',{finished:true}),
    fixture(-1,'Демо','Демо'),
  ];
  assert.deepEqual(matchPassPickerRows(rows,{query:'ливерПУЛЬ'}).map(x=>x.fixtureId),[101]);
  assert.deepEqual(matchPassPickerRows(rows,{query:'Premier'}).map(x=>x.fixtureId),[101,102,103]);
  assert.deepEqual(matchPassPickerRows(rows,{status:'live'}).map(x=>x.fixtureId),[102]);
  assert.deepEqual(matchPassPickerRows(rows,{status:'upcoming'}).map(x=>x.fixtureId),[101]);
  assert.deepEqual(matchPassPickerRows(rows).map(x=>x.fixtureId),[101,102,103]);
  assert.deepEqual(matchPassPickerRows(null),[]);
});

class FakeElement {
  constructor(){
    this.hidden=false;
    this.disabled=false;
    this.dataset={};
    this.classList={toggle:()=>{},add:()=>{},remove:()=>{}};
    this.events={};
    this.children=[];
    this.textContent='';
    this.value='';
  }
  addEventListener(name,handler){this.events[name]=handler;}
  setAttribute(){}
  scrollIntoView(){}
  replaceChildren(...rows){this.children=rows;}
  append(...rows){this.children.push(...rows);}
}

test('profile button selects a match before attempting Stars invoice',async()=>{
  const ids=['billingPanel','passStore','matchPassCard','matchPassBtn','matchPassPicker',
    'matchPassPickerClose','matchPassPickerDate','matchPassPickerSearch','matchPassPickerFilter',
    'matchPassPickerStatus','matchPassPickerMatches','passContext','matchPassState'];
  const elements=new Map(ids.map(id=>[id,new FakeElement()]));
  const calls=[],opened=[];
  const storedDocument=globalThis.document;
  globalThis.document={createElement:()=>new FakeElement(),querySelectorAll:()=>[]};
  const entitlement={
    paymentsEnabled:true,
    products:{MATCH_PASS:{stars:39,saleReady:true,durationHours:72}},
    entitlement:{subscriptionActive:false,decisions:[],passes:{active:[]}},
  };
  const fixtures=[fixture(701,'Ливерпуль','Челси'),fixture(702,'Реал','Барселона')];
  try{
    const module=createBillingModule({
      state:{
        profile:{features:{monetizationEnabled:true},quota:{plan:'FREE',used:0,limit:3,left:3}},
        billing:{enabled:true,ready:true,current:{plan:'FREE'}},
        matchesMeta:{date:'2026-10-08'},
        matches:fixtures,
      },
      elementById:id=>elements.get(id)||null,
      api:async(url,options={})=>{
        calls.push({url,options});
        if(url.startsWith('/api/entitlements'))return entitlement;
        if(url.startsWith('/api/matches'))return {matches:fixtures};
        if(url==='/api/billing/invoice')return {invoiceUrl:'https://t.me/$test',fixtureId:701};
        throw Error('Unexpected API: '+url);
      },
      telegram:{openInvoice:(url)=>opened.push(url)},
      dateTime:()=> '08 окт., 18:00',
    });
    module.bind();
    await module.loadPassAccess({force:true});
    assert.equal(elements.get('matchPassBtn').disabled,false);
    assert.match(elements.get('matchPassBtn').textContent,/Выбрать матч.*39/);
    elements.get('matchPassBtn').events.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(module.snapshot().matchPickerOpen,true);
    assert.equal(elements.get('matchPassPickerMatches').children.length,2);
    assert.equal(calls.some(x=>x.url==='/api/billing/invoice'),false);
    elements.get('matchPassPickerSearch').events.input({target:{value:'Ливерпуль'}});
    assert.equal(elements.get('matchPassPickerMatches').children.length,1);
    elements.get('matchPassPickerMatches').children[0].events.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(module.snapshot().passFixtureId,701);
    assert.equal(module.snapshot().matchPickerOpen,false);
    assert.match(elements.get('passContext').textContent,/Ливерпуль — Челси/);
    assert.match(elements.get('matchPassBtn').textContent,/Купить.*39/);
    assert.equal(calls.some(x=>x.url==='/api/billing/invoice'),false);
    elements.get('matchPassBtn').events.click();
    await new Promise(resolve=>setImmediate(resolve));
    const invoice=calls.find(x=>x.url==='/api/billing/invoice');
    assert.deepEqual(JSON.parse(invoice.options.body),{passType:'MATCH_PASS',fixtureId:701});
    assert.deepEqual(opened,['https://t.me/$test']);
  }finally{
    globalThis.document=storedDocument;
  }
});

test('profile picker HTML is accessible and asset revision matches runtime',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/styles/premium-ui.css',import.meta.url),'utf8');
  const runtime=readFileSync(new URL('../public/modules/app-runtime.js',import.meta.url),'utf8');
  for(const id of ['matchPassPicker','matchPassPickerDate','matchPassPickerSearch',
    'matchPassPickerFilter','matchPassPickerMatches','matchPassPickerClose']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(css,/\.match-pass-picker-matches/);
  assert.match(css,/\.match-pass-picker\[hidden\]/);
  assert.match(html,/6\.120\.0-launch72/);
  assert.match(runtime,/FRONTEND_ASSET_REVISION = '6\.120\.0-launch72'/);
});
