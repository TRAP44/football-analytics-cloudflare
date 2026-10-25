// Reuse the shared fixture feed: discovering a follower never calls a provider.
const LIVE=new Set(['1H','HT','2H','ET','BT','P','INT','LIVE']);
const id=value=>{const n=typeof value==='string' && /^\d+$/.test(value)?Number(value):value;return Number.isSafeInteger(n)&&n>0?n:0;};
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,100):'';
export function favoriteMatchRecipients(favorites,batches,now=Date.now(),limit=1000,cursor=null,wrap=true,liveOnly=false){
  const byTeam=new Map();
  for(const row of Array.isArray(favorites)?favorites:[]){
    const user=id(row?.telegram_id),team=id(row?.team_id);if(!user||!team)continue;
    const users=byTeam.get(team)||new Map();users.set(user,text(row.team_name));byTeam.set(team,users);
  }
  const today=new Date(now+3*3600_000).toISOString().slice(0,10),after=new Map(),before=new Map();let truncated=false;
  const compare=(a,b)=>a.telegram_id-b.telegram_id||a.fixture_id-b.fixture_id;
  const pivot={telegram_id:id(cursor?.userId),fixture_id:id(cursor?.fixtureId)};
  const trim=map=>{if(map.size>limit*2){const keep=[...map.values()].sort(compare).slice(0,limit);map.clear();for(const row of keep)map.set(`${row.telegram_id}:${row.fixture_id}`,row);truncated=true;}};
  for(const batch of Array.isArray(batches)?batches:[]){
    const fetched=Date.parse(batch?.fetchedAt||'');
    if(!Number.isFinite(fetched)||now-fetched>10*60_000||fetched>now+60_000||!Array.isArray(batch.fixtures))continue;
    for(const item of batch.fixtures){
      const fixture=item?.fixture,fixtureId=id(fixture?.id),kickoff=Date.parse(fixture?.date||'');
      const code=fixture?.status?.short;
      if(!fixtureId||!Number.isFinite(kickoff)||kickoff<now-4*3600_000)continue;
      const future=code==='NS'&&kickoff>now&&new Date(kickoff+3*3600_000).toISOString().slice(0,10)===today;
      if(!future&&!LIVE.has(code))continue;
      if(liveOnly){
        const raw=fixture.status?.elapsed;const minute=raw===null||raw===undefined||raw===''||typeof raw==='boolean'?NaN:Number(raw);
        if(future||!Number.isInteger(minute)||minute<0||minute>150)continue;
      }
      const homeId=id(item?.teams?.home?.id),awayId=id(item?.teams?.away?.id);
      if(!homeId||!awayId)continue;
      for(const teamId of [homeId,awayId])for(const [user,name] of byTeam.get(teamId)||[]){
        const key=`${user}:${fixtureId}`;const rows=compare({telegram_id:user,fixture_id:fixtureId},pivot)>0?after:before;let row=rows.get(key);
        if(!row){
          const rawElapsed=fixture.status?.elapsed;const elapsed=rawElapsed===null||rawElapsed===undefined||rawElapsed===''||typeof rawElapsed==='boolean'?NaN:Number(rawElapsed);
          row={telegram_id:user,fixture_id:fixtureId,fixture_date:new Date(kickoff).toISOString(),home_name:text(item.teams.home.name),away_name:text(item.teams.away.name),league_name:text(item.league?.name),enabled:true,_favoriteOnly:true,_favoriteOpponent:text(item.teams[teamId===homeId?'away':'home'].name),_favoriteTeams:[],_favoriteTeamIds:[],_favoriteToday:future,_favoriteMinMinute:Number.isInteger(elapsed)&&elapsed>=0?Math.max(0,elapsed-10):null};
          rows.set(key,row);
        }
        if(!row._favoriteTeamIds.includes(teamId))row._favoriteTeamIds.push(teamId);
        const team=name||text(item.teams[teamId===homeId?'home':'away'].name);
        if(team&&!row._favoriteTeams.includes(team))row._favoriteTeams.push(team);
        trim(rows);
      }
    }
  }
  const candidates=[...[...after.values()].sort(compare),...(wrap?[...before.values()].sort(compare):[])];
  truncated ||= candidates.length>limit;
  const rows=candidates.slice(0,limit),last=rows.at(-1);
  return {rows,truncated,cursor:last?{userId:last.telegram_id,fixtureId:last.fixture_id}:null};
}

export function recentNotificationMinutes(batches,now=Date.now()){
  const result=new Map();
  for(const batch of batches){
    const at=Date.parse(batch?.fetchedAt||'');
    if(!Number.isFinite(at)||now-at>10*60000||at>now+60000||!Array.isArray(batch.fixtures))continue;
    for(const row of batch.fixtures){
      if(!LIVE.has(row?.fixture?.status?.short))continue;
      const raw=row?.fixture?.status?.elapsed,fixtureId=id(row?.fixture?.id);
      if(!fixtureId||raw===null||raw===undefined||raw===''||typeof raw==='boolean')continue;
      const minute=Number(raw);if(!Number.isInteger(minute)||minute<0||minute>150)continue;
      result.set(fixtureId,Math.max(result.get(fixtureId)??0,Math.max(0,minute-10)));
    }
  }
  return result;
}
