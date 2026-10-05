import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billingPurchaseVisibility,
  billingUiSnapshot,
  createBillingModule,
} from '../public/modules/billing.js';

function element() {
  return {
    hidden:false,
    disabled:false,
    textContent:'',
    className:'',
    dataset:{},
    style:{},
    classList:{ toggle(){} },
    parentElement:{ setAttribute(){} },
    setAttribute(){},
    addEventListener(){},
    scrollIntoView(){},
  };
}

function harness({ monetizationEnabled=false } = {}) {
  const ids=[
    'billingPanel','billingPricingGrid','passStore','billingActions','billingFootnote',
    'quotaUpgradeBtn','billingKicker','billingTitle','billingIntro','billingPlanBadge',
    'billingQuotaUsed','billingQuotaLimit','billingQuotaLeft','freeLimit',
    'billingQuotaProgress','billingExpiry','billingStatus','subscriptionDetails',
    'subscriptionPlan','subscriptionCopy','subscriptionManageBtn','billingSyncBtn',
    'analysisQuotaPaywall',
  ];
  const nodes=Object.fromEntries(ids.map(id=>[id,element()]));
  nodes.billingPricingGrid.hidden=true;
  nodes.passStore.hidden=true;
  nodes.billingActions.hidden=true;
  nodes.billingFootnote.hidden=true;
  nodes.quotaUpgradeBtn.hidden=true;

  const state={
    profile:{
      quota:{plan:'FREE',used:1,limit:3,left:2},
      billing:{plan:'FREE'},
      features:{monetizationEnabled},
    },
    billing:monetizationEnabled
      ? {enabled:true,ready:true,current:{plan:'FREE'},plans:{FREE:{dailyLimit:3},PRO:{stars:199,dailyLimit:20},PREMIUM:{stars:399,dailyLimit:100}}}
      : null,
  };
  let apiCalls=0;
  const module=createBillingModule({
    state,
    elementById:id=>nodes[id] || null,
    api:async()=>{ apiCalls+=1; throw new Error('unexpected api call'); },
    toast:()=>{},
    telegram:{openInvoice:()=>{}},
    dateTime:value=>String(value || ''),
    reloadProfile:async()=>{},
    openProfile:async()=>{},
    openPassMatches:()=>{},
  });
  return {module,nodes,state,getApiCalls:()=>apiCalls};
}

test('purchase visibility is fail-closed when monetization is paused',()=>{
  const snapshot=billingUiSnapshot({
    quota:{plan:'FREE',used:1,limit:3,left:2},
    billing:{plan:'FREE'},
    features:{monetizationEnabled:false},
  },{enabled:false,ready:false});
  assert.deepEqual(billingPurchaseVisibility(snapshot),{
    enabled:false,
    pricing:false,
    passes:false,
    paymentActions:false,
    quotaUpgrade:false,
  });
});

test('paused monetization renders free quota but performs zero billing/product requests',async()=>{
  const originalDocument=globalThis.document;
  globalThis.document={querySelectorAll:()=>[]};
  try {
    const {module,nodes,getApiCalls}=harness({monetizationEnabled:false});
    await module.load();

    assert.equal(getApiCalls(),0);
    assert.equal(nodes.billingPricingGrid.hidden,true);
    assert.equal(nodes.passStore.hidden,true);
    assert.equal(nodes.billingActions.hidden,true);
    assert.equal(nodes.billingFootnote.hidden,true);
    assert.equal(nodes.quotaUpgradeBtn.hidden,true);
    assert.equal(nodes.billingTitle.textContent,'AI-лимит');
    assert.match(nodes.billingIntro.textContent,/Бесплатный режим активен/);
    assert.equal(nodes.billingQuotaUsed.textContent,'1');
    assert.equal(nodes.billingQuotaLeft.textContent,'2');

    const result=await module.openPassStoreForFixture(777);
    assert.deepEqual(result,{opened:false,reason:'monetization_paused'});
    assert.equal(getApiCalls(),0);

    module.showQuotaPaywall(777);
    assert.equal(nodes.analysisQuotaPaywall.hidden,false);
    assert.equal(nodes.quotaUpgradeBtn.hidden,true);
  } finally {
    globalThis.document=originalDocument;
  }
});

test('enabled monetization reveals the existing purchase surfaces without changing their contract',()=>{
  const originalDocument=globalThis.document;
  globalThis.document={querySelectorAll:()=>[]};
  try {
    const {module,nodes}=harness({monetizationEnabled:true});
    module.render();
    assert.equal(nodes.billingPricingGrid.hidden,false);
    assert.equal(nodes.passStore.hidden,false);
    assert.equal(nodes.billingActions.hidden,false);
    assert.equal(nodes.billingFootnote.hidden,false);
    assert.equal(nodes.quotaUpgradeBtn.hidden,false);
    assert.equal(nodes.billingTitle.textContent,'Тариф и AI-доступ');
    assert.match(nodes.billingIntro.textContent,/Telegram Stars/);
  } finally {
    globalThis.document=originalDocument;
  }
});
