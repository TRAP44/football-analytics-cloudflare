import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartNotificationAudience } from '../src/smart-notification-audience.js';

function runtime(overrides={}) {
  const queries=[];
  const deps={
    hasSupabase:()=>true,
    supaSelectMany:async(_cfg,table,filters,options)=>{
      queries.push({table,filters,options});
      if (table==='users') return [];
      if (table==='user_preferences') return [];
      if (table==='favorite_players') return [];
      return [];
    },
    getPreferences:async()=>({notificationPreferences:{enabled:true,match:true,players:true,aiRadar:true}}),
    getUserRecord:async userId=>({telegram_id:userId,plan:'FREE'}),
    getFavoritePlayers:async()=>[],
    ...overrides,
  };
  return {api:createSmartNotificationAudience(deps),queries};
}

test('audience rejects JavaScript id coercion and deduplicates recipient rows',async()=>{
  const {api}=runtime({
    supaSelectMany:async(_cfg,table)=>{
      if(table==='users') return [{telegram_id:7,plan:'FREE'}];
      if(table==='user_preferences') return [{telegram_id:7,notification_preferences:{enabled:true,match:true}}];
      return [];
    },
  });
  const rows=[
    {telegram_id:7,fixture_id:1},
    {telegram_id:'7',fixture_id:1},
    {telegram_id:true,fixture_id:1},
    {telegram_id:[7],fixture_id:1},
    {telegram_id:0,fixture_id:1},
    null,
  ];
  const result=await api.filterRecipients(rows,'match.goal',{});
  assert.equal(result.checked,rows.length);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].telegram_id,7);
  assert.equal(result.invalidRecipients,4);
});

test('truthy non-boolean Supabase availability uses local context path',async()=>{
  let dbCalls=0;
  let userCalls=0;
  const {api}=runtime({
    hasSupabase:()=> 'true',
    supaSelectMany:async()=>{dbCalls+=1;return [];},
    getUserRecord:async userId=>{
      userCalls+=1;
      return {telegram_id:userId,plan:'FREE'};
    },
    getPreferences:async()=>({notificationPreferences:{enabled:true,match:true}}),
  });
  const result=await api.filterRecipients([{telegram_id:5}],'match.goal',{});
  assert.equal(result.rows.length,1);
  assert.equal(dbCalls,0);
  assert.equal(userCalls,1);
});

test('Supabase context rows are confined to requested audience and duplicate context fails safe',async()=>{
  const {api}=runtime({
    supaSelectMany:async(_cfg,table)=>{
      if(table==='users') return [
        {telegram_id:1,plan:'FREE'},
        {telegram_id:2,plan:'PRO'},
        {telegram_id:999,plan:'PRO'},
        {telegram_id:2,plan:'FREE'},
      ];
      if(table==='user_preferences') return [
        {telegram_id:1,notification_preferences:{enabled:true,players:true}},
        {telegram_id:2,notification_preferences:{enabled:true,players:true}},
        {telegram_id:999,notification_preferences:{enabled:true,players:true}},
      ];
      return [];
    },
  });
  const rows=[{telegram_id:1},{telegram_id:2}];
  const result=await api.filterRecipients(rows,'player.goal',{});
  assert.deepEqual(result.rows,[]);
  assert.equal(result.blockedByEntitlement,2);
});

test('duplicate preference rows block that user instead of selecting an arbitrary preference',async()=>{
  const {api}=runtime({
    supaSelectMany:async(_cfg,table)=>{
      if(table==='users') return [{telegram_id:8,plan:'FREE'}];
      if(table==='user_preferences') return [
        {telegram_id:8,notification_preferences:{enabled:true,match:true}},
        {telegram_id:8,notification_preferences:{enabled:false,match:false}},
      ];
      return [];
    },
  });
  const result=await api.filterRecipients([{telegram_id:8}],'match.goal',{});
  assert.equal(result.rows.length,0);
  assert.equal(result.blockedByPreference,1);
  assert.equal(result.contextFailures,1);
});

test('missing local preference dependency blocks delivery instead of default-enabling it',async()=>{
  const {api}=runtime({
    hasSupabase:()=>false,
    getPreferences:undefined,
    getUserRecord:async userId=>({telegram_id:userId,plan:'FREE'}),
  });
  const result=await api.filterRecipients([{telegram_id:3}],'match.goal',{});
  assert.equal(result.rows.length,0);
  assert.equal(result.blockedByPreference,1);
  assert.equal(result.contextFailures,1);
});

test('local preference lookup failure blocks delivery for that user',async()=>{
  const {api}=runtime({
    hasSupabase:()=>false,
    getUserRecord:async userId=>({telegram_id:userId,plan:'PRO'}),
    getPreferences:async()=>{throw new Error('preferences unavailable');},
  });
  const result=await api.filterRecipients([{telegram_id:9}],'player.goal',{});
  assert.equal(result.rows.length,0);
  assert.equal(result.blockedByPreference,1);
  assert.equal(result.contextFailures,1);
});

test('coercible user plan cannot unlock paid notification categories',async()=>{
  const {api}=runtime({
    supaSelectMany:async(_cfg,table)=>{
      if(table==='users') return [{
        telegram_id:7,
        plan:{toString:()=> 'PRO'},
      }];
      if(table==='user_preferences') return [{
        telegram_id:7,
        notification_preferences:{enabled:true,players:true},
      }];
      return [];
    },
  });
  const result=await api.filterRecipients([{telegram_id:7}],'player.goal',{});
  assert.equal(result.rows.length,0);
  assert.equal(result.blockedByEntitlement,1);
});

test('malformed persisted notification preferences fail closed',async()=>{
  const {api}=runtime({
    supaSelectMany:async(_cfg,table)=>{
      if(table==='users') return [{telegram_id:7,plan:'FREE'}];
      if(table==='user_preferences') return [{
        telegram_id:7,
        notification_preferences:'{"enabled":true,"match":true}',
      }];
      return [];
    },
  });
  const result=await api.filterRecipients([{telegram_id:7}],'match.goal',{});
  assert.equal(result.rows.length,0);
  assert.equal(result.blockedByPreference,1);
  assert.equal(result.contextFailures,1);
});

test('unknown notification namespace fails closed instead of defaulting to free match category',async()=>{
  const {api}=runtime();
  const result=await api.filterRecipients([{telegram_id:1}],'unknown.event',{});
  assert.equal(result.rows.length,0);
  assert.equal(result.blockedByPreference,1);
  assert.equal(result.contextFailures,1);
});

test('invalid event type fails closed without calling policy on recipients',async()=>{
  const {api}=runtime();
  const result=await api.filterRecipients([{telegram_id:1}],{toString:()=> 'match.goal'},{});
  assert.equal(result.rows.length,0);
  assert.equal(result.blockedByPreference,1);
  assert.equal(result.contextFailures,1);
});

test('favorite-player audience ignores injected users, malformed ids and duplicate players',async()=>{
  const {api}=runtime({
    supaSelectMany:async(_cfg,table)=>{
      assert.equal(table,'favorite_players');
      return [
        {telegram_id:1,player_id:10,player_name:'A'},
        {telegram_id:1,player_id:'10',player_name:'A duplicate'},
        {telegram_id:1,player_id:true,player_name:'bad'},
        {telegram_id:2,player_id:20,player_name:'B'},
        {telegram_id:999,player_id:99,player_name:'Injected'},
      ];
    },
  });
  const byUser=await api.loadFavoritePlayersByUser([{telegram_id:1},{telegram_id:2}],{});
  assert.deepEqual(byUser.get(1).map(row=>Number(row.player_id)),[10]);
  assert.deepEqual(byUser.get(2).map(row=>Number(row.player_id)),[20]);
  assert.equal(byUser.has(999),false);
});

test('local favorite-player lookup is fail-closed per user',async()=>{
  const {api}=runtime({
    hasSupabase:()=>false,
    getFavoritePlayers:async userId=>{
      if(userId===1) throw new Error('unavailable');
      return [
        {telegram_id:userId,player_id:22},
        {telegram_id:999,player_id:99},
      ];
    },
  });
  const byUser=await api.loadFavoritePlayersByUser([{telegram_id:1},{telegram_id:2}],{});
  assert.deepEqual(byUser.get(1),[]);
  assert.deepEqual(byUser.get(2).map(row=>row.player_id),[22]);
});

test('audience constructor requires database boundary dependencies',()=>{
  assert.throws(()=>createSmartNotificationAudience({}),/hasSupabase is required/);
  assert.throws(()=>createSmartNotificationAudience({hasSupabase:()=>false}),/supaSelectMany is required/);
});
