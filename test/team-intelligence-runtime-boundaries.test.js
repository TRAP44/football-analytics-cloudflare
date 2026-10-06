import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTeamIntelligenceRuntime } from '../src/team-intelligence-runtime.js';

function lineupPlayer(entry) {
  const player=entry?.player;
  if (!player?.name) return null;
  return {
    id:Number.isSafeInteger(Number(player.id)) && Number(player.id)>0 ? Number(player.id) : null,
    name:String(player.name),
    number:Number.isSafeInteger(Number(player.number)) && Number(player.number)>0 ? Number(player.number) : null,
    pos:String(player.pos || ''),
    grid:String(player.grid || ''),
    photo:String(player.photo || ''),
  };
}

function deps(overrides = {}) {
  return {
    annotateEventReliability:(meta,quality)=>({
      ...meta,
      confidenceBearing:quality?.confidenceBearing === true,
      stale:false,
    }),
    annotateLineupReliability:(meta,quality)=>({
      ...meta,
      confirmed:quality?.bothConfirmed === true,
      confidenceBearing:quality?.bothConfirmed === true,
      stale:false,
    }),
    apiFootball:async()=>({
      team:{id:10,name:'Team'},
      league:{id:39,name:'League',season:2026},
    }),
    applyFeatureFreshness:meta=>({
      ...meta,
      confidenceBearing:true,
      freshnessState:'fresh',
      provenanceState:'verified',
      stale:false,
    }),
    assessMatchEventQuality:events=>({
      observed:Array.isArray(events) && events.length>0,
      sourceTrusted:true,
      displayCount:Array.isArray(events) ? events.length : 0,
      analyticalCount:0,
      confidenceBearing:Array.isArray(events) && events.length>0,
      displayEventIndices:Array.isArray(events) ? events.map((_,index)=>index) : [],
    }),
    assessMatchLineups:lineups=>{
      const ids = side => (lineups?.[side]?.startXI || [])
        .map(player=>player?.id)
        .filter(Boolean);
      const home=ids('home');
      const away=ids('away');
      const bothConfirmed=home.length===11
        && away.length===11
        && new Set(home).size===11
        && new Set(away).size===11
        && !home.some(id=>away.includes(id));
      return {
        anyPublished:Boolean(home.length || away.length),
        bothPublished:Boolean(home.length && away.length),
        bothConfirmed,
        confirmedSides:Number(home.length===11)+Number(away.length===11),
        partialSides:Number(home.length>0 && home.length!==11)+Number(away.length>0 && away.length!==11),
      };
    },
    compactProviderError:error=>({
      code:String(error?.code || 'provider_error'),
      status:Number(error?.status || 0) || null,
    }),
    formatLiveEvents:rows=>(Array.isArray(rows) ? rows : [])
      .map((row,index)=>({
        id:`${row?.time?.elapsed ?? '?'}-0-${index}`,
        minute:Number(row?.time?.elapsed ?? 0),
        extra:0,
        teamId:Number(row?.team?.id || 0),
        player:String(row?.player?.name || ''),
        assist:String(row?.assist?.name || ''),
        type:String(row?.type || ''),
        detail:String(row?.detail || ''),
      }))
      .sort((a,b)=>a.minute-b.minute),
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    getStaleCache:async()=>null,
    json:(body,status=200,headers={})=>({body,status,headers}),
    normalizeLineupPlayer:lineupPlayer,
    normalizeTeamSeasonStatistics:row=>({
      available:Boolean(row?.team?.id),
      team:{id:Number(row?.team?.id || 0),name:String(row?.team?.name || '')},
      league:{
        id:Number(row?.league?.id || 0),
        name:String(row?.league?.name || ''),
        season:Number(row?.league?.season || 0),
      },
    }),
    providerFeatureFetch:async()=>({
      data:[],
      meta:{
        confidenceBearing:true,
        available:true,
        usable:true,
        source:'network',
        freshnessState:'fresh',
        provenanceState:'verified',
      },
    }),
    publicDataCapabilities:()=>({provider:'test'}),
    resolveTeamSeasonPlayers:async()=>({
      available:false,
      complete:false,
      partial:false,
      players:[],
      summary:{count:0,complete:false,pagesLoaded:0,pagesTotal:0,sourceScope:'team-season'},
      reason:'empty',
      sourceMeta:{provider:'none'},
    }),
    runtimeControlsSnapshot:()=>({liveEnabled:true}),
    setCache:async()=>{},
    sourceMeta:input=>({...input}),
    ...overrides,
  };
}

function lineup(teamId, startIds) {
  return {
    team:{id:teamId,name:`Team ${teamId}`},
    formation:'4-3-3',
    startXI:startIds.map(id=>({
      player:{id,name:`Player ${id}`,number:id,pos:'M'},
    })),
    substitutes:[],
  };
}

test('team intelligence runtime validates dependencies and freezes its public surface', () => {
  const broken=deps();
  delete broken.normalizeLineupPlayer;
  assert.throws(
    () => createTeamIntelligenceRuntime(broken),
    /normalizeLineupPlayer is required/,
  );

  const runtime=createTeamIntelligenceRuntime(deps());
  assert.equal(Object.isFrozen(runtime),true);
});

test('Worker explicitly wires the lineup normalizer into the extracted runtime', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/team-intelligence-runtime.js','utf8');

  assert.match(
    worker,
    /createTeamIntelligenceRuntime\(\{[\s\S]*?normalizeLineupPlayer,[\s\S]*?normalizeTeamSeasonStatistics/,
  );
  assert.match(
    source,
    /const requiredFunctions = \{[\s\S]*?normalizeLineupPlayer,[\s\S]*?normalizeTeamSeasonStatistics/,
  );
  assert.match(source,/return Object\.freeze\(\{/);
});

test('team intelligence endpoint rejects unsafe ids and fail-closes quota errors', async () => {
  const runtime=createTeamIntelligenceRuntime(deps({
    freeQuotaHealthy:()=>{ throw new Error('quota state unavailable'); },
  }));

  const invalid=await runtime.apiTeamIntelligence({
    url:'https://example.test/api/team-intelligence?teamId=1.5&leagueId=39&season=2026',
  },{});
  assert.equal(invalid.status,400);

  const guarded=await runtime.apiTeamIntelligence({
    url:'https://example.test/api/team-intelligence?teamId=10&leagueId=39&season=2026',
  },{});
  assert.equal(guarded.status,200);
  assert.equal(guarded.body.available,false);
  assert.equal(guarded.body.quotaGuard,true);
});

test('team intelligence rejects statistics returned for another provider scope', async () => {
  const writes=[];
  const runtime=createTeamIntelligenceRuntime(deps({
    apiFootball:async()=>({
      team:{id:99,name:'Wrong Team'},
      league:{id:39,name:'League',season:2026},
    }),
    setCache:async(...args)=>writes.push(args),
  }));

  const response=await runtime.apiTeamIntelligence({
    url:'https://example.test/api/team-intelligence?teamId=10&leagueId=39&season=2026&teamName=Team',
  },{});

  assert.equal(response.status,200);
  assert.equal(response.body.available,false);
  assert.equal(response.body.stats.team.id,10);
  assert.equal(response.body.stats.league.id,39);
  assert.equal(writes.length,0);
});

test('team intelligence and squad caches are rejected when entity identity does not match', async () => {
  const runtime=createTeamIntelligenceRuntime(deps({
    getCache:async key=>String(key).startsWith('team:intelligence:')
      ? {
          available:true,
          stats:{team:{id:99},league:{id:39,season:2026}},
          refreshedAt:'2026-10-06T00:00:00Z',
        }
      : {
          available:true,
          team:{id:99,name:'Wrong Team'},
          players:[{id:1,name:'Wrong Player'}],
        },
    apiFootball:async path=>path==='/players/squads'
      ? [{
          team:{id:10,name:'Team'},
          players:[{id:1,name:'Keeper',age:25,number:1,position:'Goalkeeper'}],
        }]
      : {
          team:{id:10,name:'Team'},
          league:{id:39,name:'League',season:2026},
        },
  }));

  const intelligence=await runtime.apiTeamIntelligence({
    url:'https://example.test/api/team-intelligence?teamId=10&leagueId=39&season=2026',
  },{});
  assert.equal(intelligence.body.cached,false);
  assert.equal(intelligence.body.stats.team.id,10);

  const squad=await runtime.apiTeamSquad({
    url:'https://example.test/api/team-squad?teamId=10',
  },{});
  assert.equal(squad.body.cached,false);
  assert.equal(squad.body.team.id,10);
});

test('successful provider data survives cache write failure', async () => {
  const runtime=createTeamIntelligenceRuntime(deps({
    apiFootball:async path=>path==='/players/squads'
      ? [{
          team:{id:10,name:'Team'},
          players:[{id:1,name:'Keeper',age:25,number:1,position:'Goalkeeper'}],
        }]
      : {
          team:{id:10,name:'Team'},
          league:{id:39,name:'League',season:2026},
        },
    setCache:async()=>{ throw new Error('cache unavailable'); },
  }));

  const intelligence=await runtime.apiTeamIntelligence({
    url:'https://example.test/api/team-intelligence?teamId=10&leagueId=39&season=2026',
  },{});
  assert.equal(intelligence.status,200);
  assert.equal(intelligence.body.available,true);
  assert.equal(intelligence.body.cached,false);

  const squad=await runtime.apiTeamSquad({
    url:'https://example.test/api/team-squad?teamId=10',
  },{});
  assert.equal(squad.status,200);
  assert.equal(squad.body.available,true);
  assert.equal(squad.body.cached,false);
});

test('squad normalization never falls back to another team and sanitizes players', () => {
  const runtime=createTeamIntelligenceRuntime(deps());

  const wrong=runtime.normalizeTeamSquad([
    {
      team:{id:20,name:'Wrong Team'},
      players:[{id:1,name:'Wrong Player',age:25,position:'Midfielder'}],
    },
  ],10);
  assert.equal(wrong.available,false);
  assert.equal(wrong.team.id,10);
  assert.deepEqual(wrong.players,[]);

  const squad=runtime.normalizeTeamSquad([
    {
      team:{id:10,name:'Team'},
      players:[
        {id:1,name:'Keeper',age:25,number:1,position:'Goalkeeper'},
        {id:1,name:'Keeper duplicate',age:25,number:1,position:'Goalkeeper'},
        {id:2,name:'Forward',age:101,number:-9,position:'Forward'},
      ],
    },
  ],10);

  assert.equal(squad.available,true);
  assert.equal(squad.players.length,2);
  assert.equal(squad.players[1].age,null);
  assert.equal(squad.players[1].number,null);
  assert.equal(squad.summary.goalkeepers,1);
  assert.equal(squad.summary.attackers,1);
});

test('lineup normalization preserves duplicate starters so integrity checks can reject them', async () => {
  const homeIds=[1,1,2,3,4,5,6,7,8,9,10];
  const awayIds=[21,22,23,24,25,26,27,28,29,30,31];
  const runtime=createTeamIntelligenceRuntime(deps({
    providerFeatureFetch:async()=>({
      data:[lineup(10,homeIds),lineup(20,awayIds)],
      meta:{
        confidenceBearing:true,
        available:true,
        usable:true,
        source:'network',
        freshnessState:'fresh',
        provenanceState:'verified',
      },
    }),
  }));

  const normalized=runtime.normalizeLineupNotificationRow(lineup(10,homeIds));
  assert.equal(normalized.startXI.length,11);
  assert.equal(normalized.startXI[0].id,1);
  assert.equal(normalized.startXI[1].id,1);

  const snapshot=await runtime.loadLineupNotificationSnapshot(100,{});
  assert.equal(snapshot.confirmed,false);
  assert.equal(snapshot.reason,'lineup_incomplete');
});

test('lineup snapshot prefers an exact eleven over a richer malformed duplicate row', async () => {
  const ids=Array.from({length:11},(_,index)=>index+1);
  const runtime=createTeamIntelligenceRuntime(deps({
    providerFeatureFetch:async()=>({
      data:[
        lineup(10,Array.from({length:12},(_,index)=>index+1)),
        lineup(10,ids),
        lineup(20,ids.map(id=>id+20)),
      ],
      meta:{
        confidenceBearing:true,
        available:true,
        usable:true,
        source:'network',
        freshnessState:'fresh',
        provenanceState:'verified',
      },
    }),
  }));

  const snapshot=await runtime.loadLineupNotificationSnapshot(100,{});
  assert.equal(snapshot.confirmed,true);
  assert.equal(snapshot.teams[0].startXI.length,11);
});

test('lineup snapshot fails closed when the provider returns more than two teams', async () => {
  const ids=Array.from({length:11},(_,index)=>index+1);
  const runtime=createTeamIntelligenceRuntime(deps({
    providerFeatureFetch:async()=>({
      data:[
        lineup(10,ids),
        lineup(20,ids.map(id=>id+20)),
        lineup(30,ids.map(id=>id+40)),
      ],
      meta:{},
    }),
  }));

  const snapshot=await runtime.loadLineupNotificationSnapshot(100,{});
  assert.equal(snapshot.confirmed,false);
  assert.equal(snapshot.reason,'unexpected_team_count');
  assert.equal(snapshot.teamCount,3);
});

test('event snapshot preserves raw player ids after formatted events are time-sorted', async () => {
  const rawRows=[
    {
      time:{elapsed:80},
      team:{id:10},
      player:{id:200,name:'Late'},
      assist:{id:201,name:'Assist'},
      type:'Goal',
      detail:'Normal Goal',
    },
    {
      time:{elapsed:10},
      team:{id:20},
      player:{id:100,name:'Early'},
      type:'Card',
      detail:'Red Card',
    },
  ];

  const runtime=createTeamIntelligenceRuntime(deps({
    providerFeatureFetch:async()=>({
      data:rawRows,
      meta:{
        confidenceBearing:true,
        available:true,
        usable:true,
        source:'network',
        freshnessState:'fresh',
        provenanceState:'verified',
      },
    }),
  }));

  const snapshot=await runtime.loadSmartNotificationEventSnapshot(100,{});
  assert.equal(snapshot.trusted,true);
  assert.equal(snapshot.events[0].minute,10);
  assert.equal(snapshot.events[0].playerId,100);
  assert.equal(snapshot.events[1].minute,80);
  assert.equal(snapshot.events[1].playerId,200);
  assert.equal(snapshot.events[1].assistPlayerId,201);
});

test('event snapshot bounds hostile provider collections', async () => {
  const rawRows=Array.from({length:600},(_,index)=>({
    time:{elapsed:index%121},
    team:{id:10},
    player:{id:index+1,name:`Player ${index+1}`},
    type:'Goal',
    detail:'Normal Goal',
  }));
  const runtime=createTeamIntelligenceRuntime(deps({
    providerFeatureFetch:async()=>({
      data:rawRows,
      meta:{
        confidenceBearing:true,
        available:true,
        usable:true,
        source:'network',
        freshnessState:'fresh',
        provenanceState:'verified',
      },
    }),
  }));

  const snapshot=await runtime.loadSmartNotificationEventSnapshot(100,{});
  assert.equal(snapshot.events.length,500);
});

test('live notification snapshot respects runtime live disable before provider access', async () => {
  let providerCalls=0;
  const runtime=createTeamIntelligenceRuntime(deps({
    runtimeControlsSnapshot:()=>({liveEnabled:false}),
    providerFeatureFetch:async()=>{
      providerCalls+=1;
      return {data:[]};
    },
  }));

  const snapshot=await runtime.loadSmartNotificationEventSnapshot(100,{});
  assert.equal(snapshot.trusted,false);
  assert.equal(snapshot.reason,'live_disabled');
  assert.equal(providerCalls,0);
});
