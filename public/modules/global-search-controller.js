export function discoveryText(value) {
return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

export function discoveryMatchRank(value, query) {
const text=discoveryText(value), q=discoveryText(query);
if (!text || !q) return 99;
if (text === q) return 0;
if (text.startsWith(q)) return 1;
if (text.split(/\s+/).some(part => part.startsWith(q))) return 2;
return text.includes(q) ? 3 : 99;
}

export function mergeById(first=[], second=[], idKey='id') {
const seen=new Set(), out=[];
for (const row of [...first,...second]) {
  const id=Number(row?.[idKey] || 0);
  if (!id || seen.has(id)) continue;
  seen.add(id);
  out.push(row);
}
return out;
}

export function createGlobalSearchController({
state, elementById, querySelectorAll, runtimeAllows, api, renderSearch,
sendProductAction, sendOperationTiming, isAdmin, renderProvider,
apiErrorCategory, friendlyErrorMessage, sendActionError, toast,
nowIso=()=>new Date().toISOString(),
performanceNow=()=>globalThis.performance?.now?.() ?? Date.now(),
setTimer=(fn,ms)=>setTimeout(fn,ms),
clearTimer=handle=>clearTimeout(handle),
}) {
if (!state?.globalSearch || typeof elementById !== 'function') throw new TypeError('Global search controller requires state.globalSearch and elementById.');
if (typeof runtimeAllows !== 'function' || typeof api !== 'function') throw new TypeError('Global search controller requires runtimeAllows and api.');

const $=elementById;
const selectAll=typeof querySelectorAll === 'function' ? querySelectorAll : ()=>[];
const render=typeof renderSearch === 'function' ? renderSearch : ()=>{};
const productAction=typeof sendProductAction === 'function' ? sendProductAction : ()=>{};
const operationTiming=typeof sendOperationTiming === 'function' ? sendOperationTiming : ()=>{};
const adminCheck=typeof isAdmin === 'function' ? isAdmin : ()=>false;
const providerRender=typeof renderProvider === 'function' ? renderProvider : ()=>{};
const errorCategory=typeof apiErrorCategory === 'function' ? apiErrorCategory : ()=>'error';
const friendlyError=typeof friendlyErrorMessage === 'function' ? friendlyErrorMessage : ()=>'Не удалось обновить поиск.';
const actionError=typeof sendActionError === 'function' ? sendActionError : ()=>{};
const showToast=typeof toast === 'function' ? toast : ()=>{};
let searchTimer=null, controlsBound=false;

function localDiscoveryResults(query) {
  const q=discoveryText(query);
  if (!q) return {teams:[],competitions:[],matches:[]};
  const teams=new Map(), competitions=new Map(), matches=[];

  for (const m of state.matches || []) {
    for (const team of [m.home,m.away]) {
      if (!team?.id || !team?.name) continue;
      const rank=Math.min(discoveryMatchRank(team.name,q),discoveryMatchRank(`${team.name} ${m.country || ''}`,q));
      if (rank<99 && !teams.has(Number(team.id))) teams.set(Number(team.id),{...team,country:m.country || '',_searchRank:rank});
    }

    const names=[m.leagueShort,m.league,m.leagueOriginal].filter(Boolean);
    const compRank=Math.min(...names.map(name=>discoveryMatchRank(name,q)),discoveryMatchRank(`${m.league || ''} ${m.country || ''}`,q));
    if (Number(m.leagueId)>0 && compRank<99 && !competitions.has(Number(m.leagueId))) {
      competitions.set(Number(m.leagueId),{
        leagueId:Number(m.leagueId), season:Number(m.season || new Date().getFullYear()),
        name:m.league || m.leagueOriginal || 'Турнир', shortName:m.leagueShort || m.league || 'Турнир',
        country:m.country || '', category:m.category || '', tier:m.competition?.tier || 'standard',
        logo:m.leagueLogo || '', _searchRank:compRank,
      });
    }

    const teamRank=Math.min(discoveryMatchRank(m.home?.name,q),discoveryMatchRank(m.away?.name,q));
    const matchRank=Math.min(teamRank,discoveryMatchRank(m.league,q),discoveryMatchRank(m.leagueOriginal,q));
    if (matchRank<99 && Number(m.fixtureId)>0) matches.push({...m,_searchRank:matchRank});
  }

  const teamRows=[...teams.values()].sort((a,b)=>Number(a._searchRank||99)-Number(b._searchRank||99) || String(a.name||'').localeCompare(String(b.name||''),'ru'));
  const compRows=[...competitions.values()].sort((a,b)=>Number(a._searchRank||99)-Number(b._searchRank||99) || Number(b.tier==='top')-Number(a.tier==='top') || String(a.shortName||a.name||'').localeCompare(String(b.shortName||b.name||''),'ru'));
  matches.sort((a,b)=>Number(a._searchRank||99)-Number(b._searchRank||99) || Number(Boolean(b.live))-Number(Boolean(a.live)) || Date.parse(a.date||0)-Date.parse(b.date||0));
  return {teams:teamRows.slice(0,10),competitions:compRows.slice(0,8),matches:matches.slice(0,20)};
}

function setGlobalSearchMode(mode) {
  state.globalSearch.mode=['all','teams','competitions','upcoming','finished'].includes(mode) ? mode : 'all';
  selectAll('[data-search-mode]').forEach(btn=>{
    const active=btn.dataset.searchMode===state.globalSearch.mode;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-pressed',active ? 'true' : 'false');
  });
  render();
}

async function runGlobalSearch({manual=false}={}) {
  const input=$('globalSearchInput');
  const query=String(input?.value || '').trim();
  const seq=++state.globalSearch.requestSeq;
  Object.assign(state.globalSearch,{
    query, warning:'', resolvedQuery:'', remoteMatches:[], knownTeams:[],
    matchSourceTeam:'', matchDiscovery:null, primaryFixtureId:null,
  });

  const searchEnabled = runtimeAllows('searchEnabled');
  if (query.length < 2 || !searchEnabled) {
    Object.assign(state.globalSearch,{
      loading:false, status:query.length<2 ? 'idle' : 'done',
      remoteTeams:[], remoteCompetitions:[],
    });
    if (!searchEnabled) state.globalSearch.warning='Удалённый поиск временно недоступен. Уже загруженные матчи остаются доступны.';
    render();
    return;
  }

  const local=localDiscoveryResults(query);
  const localCount=local.teams.length+local.competitions.length+local.matches.length;
  productAction('search_used','searchView');
  const timingStartedAt=performanceNow();
  state.globalSearch.loading=true;
  state.globalSearch.status=localCount ? 'refreshing' : 'searching';
  render();

  try {
    const data=await api(`/api/search?q=${encodeURIComponent(query)}`,{timeoutMs:6500,retry:false});
    if (seq !== state.globalSearch.requestSeq || query !== String(state.globalSearch.query || '').trim()) return;
    Object.assign(state.globalSearch,{
      remoteTeams:data.teams || [], knownTeams:data.knownTeams || [],
      remoteCompetitions:data.competitions || [], resolvedQuery:data.resolvedQuery || '',
      remoteMatches:data.matches || [], matchSourceTeam:data.matchSource?.name || '',
      matchDiscovery:data.matchDiscovery || null,
      primaryFixtureId:Number(data.primaryFixtureId || data.matchDiscovery?.primaryFixtureId || 0) || null,
      warning:data.warning || data.hint || '', searchedAt:data.refreshedAt || nowIso(),
    });
    const merged=localDiscoveryResults(query);
    const totalMatches=mergeById(state.globalSearch.remoteMatches,merged.matches,'fixtureId').length;
    const totalEntities=mergeById(merged.teams,state.globalSearch.remoteTeams,'id').length
      + mergeById(merged.competitions,state.globalSearch.remoteCompetitions,'leagueId').length
      + state.globalSearch.knownTeams.length;
    state.globalSearch.status=totalMatches ? 'found' : totalEntities ? 'done' : 'empty';
    productAction(totalMatches || totalEntities ? 'search_found' : 'search_empty','searchView');
    operationTiming('search',timingStartedAt,'searchView');
    if (adminCheck() && data.provider?.visibility === 'admin') {
      state.provider=data.provider;
      providerRender();
    }
  } catch (error) {
    if (seq !== state.globalSearch.requestSeq) return;
    const category=errorCategory(error);
    state.globalSearch.status=category === 'timeout' ? 'timeout' : 'error';
    state.globalSearch.warning=category === 'timeout' ? 'Источник отвечает слишком долго.' : friendlyError(error);
    actionError('search',error,'searchView');
    if (manual && category !== 'timeout') showToast(state.globalSearch.warning);
  } finally {
    if (seq === state.globalSearch.requestSeq) {
      state.globalSearch.loading=false;
      render();
    }
  }
}

function handleSearchInput(event) {
  clearTimer(searchTimer);
  state.globalSearch.requestSeq+=1;
  Object.assign(state.globalSearch,{
    loading:false, query:event.target.value || '',
    remoteTeams:[], remoteCompetitions:[], remoteMatches:[], matchSourceTeam:'', warning:'',
  });
  state.globalSearch.status=state.globalSearch.query.trim().length>=2 ? 'local' : 'idle';
  render();
  if (state.globalSearch.query.trim().length >= 3) searchTimer = setTimer(() => runGlobalSearch(), 500);
}

function bindGlobalSearchControls() {
  if (controlsBound) return;
  controlsBound=true;
  $('globalSearchBtn')?.addEventListener('click',()=>{
    clearTimer(searchTimer);
    void runGlobalSearch({manual:true});
  });
  $('globalSearchInput')?.addEventListener('input',handleSearchInput);
  $('globalSearchInput')?.addEventListener('keydown',event=>{
    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimer(searchTimer);
    void runGlobalSearch({manual:true});
  });
  selectAll('[data-search-mode]').forEach(btn=>btn.addEventListener('click',()=>setGlobalSearchMode(btn.dataset.searchMode || 'all')));
}

return Object.freeze({localDiscoveryResults,mergeById,runGlobalSearch,setGlobalSearchMode,bindGlobalSearchControls});
}
