import test from 'node:test';import assert from 'node:assert/strict';
import {favoriteMatchRecipients} from '../src/favorite-match-notifications.js';
import {createSmartNotificationService} from '../src/smart-notification-service.js';
const now=Date.parse('2026-10-18T12:20:00Z');
const favorite=(user=1,team=11)=>({telegram_id:user,team_id:team,team_name:team===11?'Alpha':'Beta'});
const fixture=(status='1H',minute=20,date='2026-10-18T12:00:00Z')=>({fixture:{id:100,date,status:{short:status,elapsed:minute}},teams:{home:{id:11,name:'Alpha'},away:{id:22,name:'Beta'}},league:{name:'Premier League'}});
const batch=rows=>({fetchedAt:new Date(now).toISOString(),fixtures:rows});
test('favorite discovery merges both teams and repeated cache batches per user/fixture',()=>{
 const result=favoriteMatchRecipients([favorite(),favorite(1,22),favorite(2,33)],[batch([fixture()]),batch([fixture()])],now);
 assert.equal(result.rows.length,1);assert.deepEqual(result.rows[0]._favoriteTeams,['Alpha','Beta']);assert.deepEqual(result.rows[0]._favoriteTeamIds,[11,22]);assert.equal(result.rows[0]._favoriteMinMinute,10);
});
test('favorite discovery rejects stale/future/unrelated/final fixtures and bounds recipients',()=>{
 assert.equal(favoriteMatchRecipients([favorite()],[{...batch([fixture()]),fetchedAt:new Date(now-11*60000).toISOString()}],now).rows.length,0);
 assert.equal(favoriteMatchRecipients([favorite()],[{...batch([fixture()]),fetchedAt:new Date(now+2*60000).toISOString()}],now).rows.length,0);
 assert.equal(favoriteMatchRecipients([favorite()],[batch([fixture('FT')])],now).rows.length,0);
 const result=favoriteMatchRecipients([favorite(),favorite(2)],[batch([fixture()])],now,1);assert.equal(result.rows.length,1);assert.equal(result.truncated,true);
});
test('match day uses Moscow date and confirmed future fixtures only',()=>{
 const at=Date.parse('2026-10-18T21:10:00Z');
 const rows=favoriteMatchRecipients([favorite()],[{fetchedAt:new Date(at).toISOString(),fixtures:[fixture('NS',null,'2026-10-18T22:00:00Z')]}],at).rows;
 assert.equal(rows.length,1);assert.equal(rows[0]._favoriteToday,true);
});
function harness({reminders=[],favorites=[favorite()],rows=[fixture()],blocked=false,favoriteFailure=false}={}){
 const deliveries=[],ledger=new Set();let active=favorites;
 const service=createSmartNotificationService({hasSupabase:()=>true,loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
 getCache:async key=>key==='provider-fixtures:2026-10-18:v1'?batch(rows):null,
 supaSelectPaged:async(_cfg,table)=>{if(table==='favorites'&&favoriteFailure)throw new Error('DB');return {rows:table==='favorites'?active:reminders};},
 filterRecipients:async input=>({rows:blocked?[]:input}),loadFavoritePlayersByUser:async()=>new Map(),
 loadLiveNotificationSnapshot:async()=>({trusted:true,stale:false,events:[
 {minute:2,type:'Goal',detail:'Normal Goal',teamId:11,playerId:9,eventKey:'old'},
 {minute:20,type:'Goal',detail:'Normal Goal',teamId:11,playerId:10,playerName:'Forward',eventKey:'goal'},
 {minute:20,type:'Card',detail:'Yellow Card',teamId:11,playerId:10,playerName:'Forward',eventKey:'yellow'},
 {minute:20,type:'Card',detail:'Red Card',teamId:22,playerId:20,playerName:'Defender',eventKey:'red'},]}),
 loadLineupSnapshot:async()=>({confirmed:false}),getAnalysisTimelineSnapshots:async()=>[],
 deliverSmartNotification:async input=>{const key=`${input.row.telegram_id}:${input.dedupeKey}`;if(ledger.has(key))return {state:'duplicate'};ledger.add(key);deliveries.push(input);return {state:'sent'};},recordOpsEvent:async()=>{},
 });return {service,deliveries,remove:()=>active=[]};
}
async function fixed(fn){const old=Date.now;Date.now=()=>now;try{await fn();}finally{Date.now=old;}}
test('favorite-only audiences get short fresh goals and both card colors once; removal stops events',()=>fixed(async()=>{
 const h=harness();await h.service.processSmartNotifications({botToken:'test'});await h.service.processSmartNotifications({botToken:'test'});
 assert.deepEqual(h.deliveries.map(x=>x.eventType),['match.goal','match.yellow_card','match.red_card']);
 assert.ok(h.deliveries.every(x=>!x.text.includes('Оценка модели')&&!x.text.includes('Откройте MatchRadar')));
 assert.match(h.deliveries[1].text,/🟨/);assert.match(h.deliveries[2].text,/🟥/);
 h.remove();assert.equal((await h.service.processSmartNotifications({botToken:'test'})).checked,0);
}));
test('explicit watching plus favorites does not duplicate recipients; opt-outs fail closed',()=>fixed(async()=>{
 const reminder={telegram_id:1,fixture_id:100,fixture_date:'2026-10-18T12:00:00Z',home_name:'Alpha',away_name:'Beta',enabled:true};
 const h=harness({reminders:[reminder]});await h.service.processSmartNotifications({botToken:'test'});
 assert.equal(h.deliveries.filter(x=>x.eventType==='match.yellow_card').length,1);
 const off=harness({blocked:true});await off.service.processSmartNotifications({botToken:'test'});assert.equal(off.deliveries.length,0);
 const failed=harness({favoriteFailure:true});const summary=await failed.service.processSmartNotifications({botToken:'test'});assert.equal(failed.deliveries.length,0);assert.equal(summary.failed,1);
}));
test('favorite match-day reminder is one compact message per fixture, without automatic AI',()=>fixed(async()=>{
 const h=harness({rows:[fixture('NS',null,'2026-10-18T18:00:00Z')]});await h.service.processSmartNotifications({botToken:'test'});await h.service.processSmartNotifications({botToken:'test'});
 assert.equal(h.deliveries.length,1);assert.equal(h.deliveries[0].eventType,'team.match_day');assert.match(h.deliveries[0].text,/Любимая команда Alpha сегодня играет/);assert.match(h.deliveries[0].text,/21:00 МСК/);
}));

test('recipient cursor reaches followers beyond the per-run limit and wraps fairly',()=>{
 const favorites=Array.from({length:5},(_,i)=>favorite(i+1));let cursor=null;const users=new Set();
 for(let i=0;i<3;i++){const result=favoriteMatchRecipients(favorites,[batch([fixture()])],now,2,cursor);cursor=result.cursor;for(const row of result.rows)users.add(row.telegram_id);}
 assert.deepEqual([...users],[1,2,3,4,5]);
});
test('favorite metadata survives an explicit reminder for match-day announcement',()=>fixed(async()=>{
 const reminder={telegram_id:1,fixture_id:100,fixture_date:'2026-10-18T18:00:00Z',home_name:'Alpha',away_name:'Beta',enabled:true};
 const h=harness({reminders:[reminder],rows:[fixture('NS',null,reminder.fixture_date)]});await h.service.processSmartNotifications({botToken:'test'});
 assert.equal(h.deliveries.filter(x=>x.eventType==='team.match_day').length,1);assert.deepEqual(h.deliveries.find(x=>x.eventType==='team.match_day').row._favoriteTeamIds,[11]);
}));
test('production wiring supplies the actual shared cache to smart notification discovery',async()=>{
 const {createServiceWiringRuntime}=await import('../src/service-wiring-runtime.js');
 const cache=async()=>null;let captured;
 const fake=new Proxy({getCache:cache,setCache:cache,SMART_NOTIFICATION_POLICY:{}},{get:(obj,key)=>key in obj?obj[key]:String(key).startsWith('create')?(deps)=>{if(key==='createSmartNotificationService')captured=deps;return {};}:()=>{}});
 createServiceWiringRuntime(fake);assert.equal(captured.getCache,cache);assert.equal(captured.setCache,cache);
});

test('source keyset continues past the first 10000 favorites and wraps at the end',()=>fixed(async()=>{
 let cursor=null;const queries=[],sent=[];
 const service=createSmartNotificationService({hasSupabase:()=>true,loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
 getCache:async key=>key.includes('favorite-recipient-cursor')?cursor:key==='provider-fixtures:2026-10-18:v1'?batch([fixture('NS',null,'2026-10-18T18:00:00Z')]):null,
 setCache:async(key,_id,value)=>{if(key.includes('favorite-recipient-cursor'))cursor=value;},
 supaSelectPaged:async(_cfg,table,filters)=>{
   if(table!=='favorites')return {rows:[]};queries.push(filters);
   if(!filters.telegram_id)return {rows:[favorite(1),favorite(10000)],truncated:true};
   if(filters.telegram_id==='gte.10000')return {rows:[favorite(10000),favorite(10001)],truncated:false};
   return {rows:[favorite(10001)],truncated:false};
 },filterRecipients:async rows=>({rows}),loadFavoritePlayersByUser:async()=>new Map(),
 deliverSmartNotification:async input=>{sent.push(input.row.telegram_id);return {state:'sent'};},recordOpsEvent:async()=>{},
 });
 await service.processSmartNotifications({botToken:'test'});assert.equal(cursor.userId,10000);
 await service.processSmartNotifications({botToken:'test'});assert.equal(cursor.userId,10001);
 assert.deepEqual(sent,[1,10000,10001]);assert.ok(queries.some(x=>x.telegram_id==='gte.10000'));
 await service.processSmartNotifications({botToken:'test'});assert.equal(cursor.userId,10000,'end wraps to the beginning');
}));

test('recipient progress does not skip fixtures deferred by the fixture limit',()=>fixed(async()=>{
 const state=new Map(),sent=new Set();const matches=Array.from({length:8},(_,i)=>({...fixture('NS',null,'2026-10-18T18:00:00Z'),fixture:{...fixture('NS',null,'2026-10-18T18:00:00Z').fixture,id:100+i}}));
 const service=createSmartNotificationService({hasSupabase:()=>true,loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),maxFixturesPerRun:2,
 getCache:async key=>state.get(key)??(key==='provider-fixtures:2026-10-18:v1'?batch(matches):null),setCache:async(key,_id,value)=>state.set(key,value),
 supaSelectPaged:async(_cfg,table)=>({rows:table==='favorites'?[favorite()]:[]}),filterRecipients:async rows=>({rows}),loadFavoritePlayersByUser:async()=>new Map(),
 deliverSmartNotification:async input=>{sent.add(input.row.fixture_id);return {state:'sent'};},recordOpsEvent:async()=>{},
 });
 for(let i=0;i<5;i++){const result=await service.processSmartNotifications({botToken:'test'});if(result.truncated)assert.equal(result.status,'degraded','a bounded page is not a hard failure');}
 assert.equal(sent.size,8,'all deferred fixtures eventually reach delivery');
}));

test('yellow-card catch-up uses a fresh real match clock and never treats null as minute zero',async()=>{
 const {recentNotificationMinutes}=await import('../src/favorite-match-notifications.js');
 assert.equal(recentNotificationMinutes([batch([fixture('2H',80)])],now).get(100),70);
 assert.equal(recentNotificationMinutes([batch([fixture('HT',null)])],now).size,0);
 assert.equal(recentNotificationMinutes([{...batch([fixture('2H',80)]),fetchedAt:new Date(now-11*60000).toISOString()}],now).size,0);
});

test('fast LIVE mode excludes future/AI/player jobs and keeps normal discovery cursors separate',()=>fixed(async()=>{
 const written=[],deliveries=[];let guarded=0;
 const live=fixture(),future=fixture('NS',null,'2026-10-18T18:00:00Z');future.fixture.id=101;
 const service=createSmartNotificationService({hasSupabase:()=>true,loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
 getCache:async key=>key==='provider-fixtures:2026-10-18:v1'?batch([live,future]):null,setCache:async key=>written.push(key),
 supaSelectPaged:async(_cfg,table)=>({rows:table==='favorites'?[favorite()]:[]}),filterRecipients:async rows=>({rows}),
 prepareLiveNotificationConfig:async cfg=>{guarded++;return {...cfg,guarded:true};},
 loadFavoritePlayersByUser:async()=>assert.fail('not a fast job'),loadLineupSnapshot:async()=>assert.fail('not a fast job'),getAnalysisTimelineSnapshots:async()=>assert.fail('not a fast job'),
 loadLiveNotificationSnapshot:async(_id,cfg)=>{assert.equal(cfg.guarded,true);return {trusted:true,stale:false,events:[{minute:20,type:'Goal',detail:'Normal Goal',teamId:11,playerId:10,eventKey:'goal'}]};},
 deliverSmartNotification:async input=>{deliveries.push(input);return {state:'sent'};},recordOpsEvent:async()=>{},
 });
 await service.processSmartNotifications({botToken:'test'},{liveOnly:true});
 assert.equal(guarded,1);assert.deepEqual(deliveries.map(x=>x.eventType),['match.goal']);
 assert.ok(written.length>0);assert.ok(written.every(key=>key.includes(':live-')));
}));

test('LIVE discovery filters future pairs before its limit so future matches cannot pin the LIVE cursor',()=>{
 const favorites=Array.from({length:1100},(_,i)=>favorite(i+1));favorites.push(favorite(1101,33));
 const upcoming=fixture('NS',null,'2026-10-18T18:00:00Z');
 const active=fixture();active.fixture.id=200;active.teams.home.id=33;active.teams.away.id=44;
 const result=favoriteMatchRecipients(favorites,[batch([upcoming,active])],now,1000,null,false,true);
 assert.deepEqual(result.rows.map(x=>x.telegram_id),[1101]);assert.equal(result.cursor.userId,1101);
});
