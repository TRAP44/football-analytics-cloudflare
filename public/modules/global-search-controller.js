const SEARCH_MODES=Object.freeze([
  'all',
  'teams',
  'competitions',
  'upcoming',
  'finished',
]);

function plainObject(value) {
  try {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeText(value,max=240) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
}

function positiveId(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>0 ? value : 0;
  }
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
}

function seasonValue(value) {
  const parsed=positiveId(value);
  return parsed>=1900 && parsed<=2500 ? parsed : 0;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeCall(fn,...args) {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
}

function safeShallowCopy(value) {
  const source=plainObject(value);
  if (!source) return {};
  let keys=[];
  try {
    keys=Object.keys(source).slice(0,120);
  } catch {
    return {};
  }
  const out={};
  for (const key of keys) {
    const item=safeRead(source,key);
    if (item!==undefined) out[key]=item;
  }
  return out;
}

function strictInstantMs(value) {
  if (typeof value!=='string' || !value.trim()) return null;
  const raw=value.trim();
  const dateOnly=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const year=Number(dateOnly[1]);
    const month=Number(dateOnly[2]);
    const day=Number(dateOnly[3]);
    if (month<1 || month>12 || day<1) return null;
    const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    return day<=maxDay ? Date.UTC(year,month-1,day) : null;
  }
  const timestamp=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(raw);
  if (!timestamp) return null;
  const year=Number(timestamp[1]);
  const month=Number(timestamp[2]);
  const day=Number(timestamp[3]);
  if (month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectRows(value) {
  return safeArray(value)
    .map(plainObject)
    .filter(Boolean)
    .map(safeShallowCopy);
}

function entityRows(value,idKey) {
  return objectRows(value)
    .map(row=>{
      const id=positiveId(safeRead(row,idKey));
      return id ? {...row,[idKey]:id} : null;
    })
    .filter(Boolean);
}

function knownTeamRows(value) {
  return objectRows(value)
    .map(row=>{
      const name=safeText(safeRead(row,'name'),160);
      if (!name) return null;
      return {
        ...row,
        id:0,
        name,
        country:safeText(safeRead(row,'country'),100),
        logo:safeText(safeRead(row,'logo'),2048),
        catalogOnly:safeRead(row,'catalogOnly')===true,
      };
    })
    .filter(Boolean);
}

function safeElements(selectAll,selector) {
  const result=safeCall(selectAll,selector);
  if (!result) return [];
  try {
    return Array.from(result).filter(Boolean);
  } catch {
    return [];
  }
}

export function discoveryText(value) {
  return safeText(value,240)
    .toLowerCase()
    .replace(/ё/g,'е');
}

export function discoveryMatchRank(value,query) {
  const text=discoveryText(value);
  const q=discoveryText(query);
  if (!text || !q) return 99;
  if (text===q) return 0;
  if (text.startsWith(q)) return 1;
  if (text.split(/\s+/).some(part=>part.startsWith(q))) return 2;
  return text.includes(q) ? 3 : 99;
}

export function mergeById(first=[],second=[],idKey='id') {
  if (typeof idKey!=='string' || !idKey) return [];
  const seen=new Set();
  const out=[];
  for (const row of [...safeArray(first),...safeArray(second)]) {
    const source=plainObject(row);
    if (!source) continue;
    const id=positiveId(safeRead(source,idKey));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({...safeShallowCopy(source),[idKey]:id});
  }
  return out;
}

export function createGlobalSearchController(options={}) {
  const config=plainObject(options) || {};
  const state=plainObject(safeRead(config,'state'));
  const globalSearch=plainObject(safeRead(state,'globalSearch'));
  const elementById=safeRead(config,'elementById');
  const querySelectorAll=safeRead(config,'querySelectorAll');
  const runtimeAllows=safeRead(config,'runtimeAllows');
  const api=safeRead(config,'api');
  const renderSearch=safeRead(config,'renderSearch');
  const sendProductAction=safeRead(config,'sendProductAction');
  const sendOperationTiming=safeRead(config,'sendOperationTiming');
  const isAdmin=safeRead(config,'isAdmin');
  const renderProvider=safeRead(config,'renderProvider');
  const apiErrorCategory=safeRead(config,'apiErrorCategory');
  const friendlyErrorMessage=safeRead(config,'friendlyErrorMessage');
  const sendActionError=safeRead(config,'sendActionError');
  const toast=safeRead(config,'toast');
  const nowIso=typeof safeRead(config,'nowIso')==='function'
    ? safeRead(config,'nowIso')
    : ()=>new Date().toISOString();
  const performanceNow=typeof safeRead(config,'performanceNow')==='function'
    ? safeRead(config,'performanceNow')
    : ()=>globalThis.performance?.now?.() ?? Date.now();
  const setTimer=typeof safeRead(config,'setTimer')==='function'
    ? safeRead(config,'setTimer')
    : (fn,ms)=>setTimeout(fn,ms);
  const clearTimer=typeof safeRead(config,'clearTimer')==='function'
    ? safeRead(config,'clearTimer')
    : handle=>clearTimeout(handle);

  if (!state || !globalSearch || typeof elementById!=='function') {
    throw new TypeError(
      'Global search controller requires state.globalSearch and elementById.',
    );
  }
  if (typeof runtimeAllows!=='function' || typeof api!=='function') {
    throw new TypeError(
      'Global search controller requires runtimeAllows and api.',
    );
  }

  const selectAll=typeof querySelectorAll==='function'
    ? querySelectorAll
    : ()=>[];
  const render=typeof renderSearch==='function' ? renderSearch : ()=>{};
  const productAction=typeof sendProductAction==='function'
    ? sendProductAction
    : ()=>{};
  const operationTiming=typeof sendOperationTiming==='function'
    ? sendOperationTiming
    : ()=>{};
  const adminCheck=typeof isAdmin==='function' ? isAdmin : ()=>false;
  const providerRender=typeof renderProvider==='function'
    ? renderProvider
    : ()=>{};
  const errorCategory=typeof apiErrorCategory==='function'
    ? apiErrorCategory
    : ()=>'error';
  const friendlyError=typeof friendlyErrorMessage==='function'
    ? friendlyErrorMessage
    : ()=>'Не удалось обновить поиск.';
  const actionError=typeof sendActionError==='function'
    ? sendActionError
    : ()=>{};
  const showToast=typeof toast==='function' ? toast : ()=>{};

  let searchTimer=null;
  let controlsBound=false;

  function currentRequestSeq() {
    const value=safeRead(globalSearch,'requestSeq');
    return Number.isSafeInteger(value) && value>=0 ? value : 0;
  }

  function nextRequestSeq() {
    const seq=currentRequestSeq()+1;
    globalSearch.requestSeq=seq;
    return seq;
  }

  function currentQuery() {
    return safeText(safeRead(globalSearch,'query'),240);
  }

  function safeRender() {
    safeCall(render);
  }

  function safeNow() {
    const value=safeCall(nowIso);
    return strictInstantMs(value)!==null
      ? value
      : new Date().toISOString();
  }

  function localDiscoveryResults(query) {
    const q=discoveryText(query);
    if (!q) return {teams:[],competitions:[],matches:[]};

    const teams=new Map();
    const competitions=new Map();
    const matches=[];
    const currentYear=new Date().getUTCFullYear();

    for (const rawMatch of safeArray(safeRead(state,'matches')).slice(0,1000)) {
      const match=plainObject(rawMatch);
      if (!match) continue;
      const home=plainObject(safeRead(match,'home'));
      const away=plainObject(safeRead(match,'away'));
      const country=safeText(safeRead(match,'country'),100);

      for (const rawTeam of [home,away]) {
        if (!rawTeam) continue;
        const id=positiveId(safeRead(rawTeam,'id'));
        const name=safeText(safeRead(rawTeam,'name'),160);
        if (!id || !name) continue;
        const rank=Math.min(
          discoveryMatchRank(name,q),
          discoveryMatchRank(name+' '+country,q),
        );
        if (rank<99 && !teams.has(id)) {
          teams.set(id,{
            ...safeShallowCopy(rawTeam),
            id,
            name,
            country,
            _searchRank:rank,
          });
        }
      }

      const leagueId=positiveId(safeRead(match,'leagueId'));
      const league=safeText(safeRead(match,'league'),160);
      const leagueOriginal=safeText(safeRead(match,'leagueOriginal'),160);
      const leagueShort=safeText(safeRead(match,'leagueShort'),80);
      const names=[leagueShort,league,leagueOriginal].filter(Boolean);
      const compRank=Math.min(
        ...names.map(name=>discoveryMatchRank(name,q)),
        discoveryMatchRank(league+' '+country,q),
      );
      if (leagueId && compRank<99 && !competitions.has(leagueId)) {
        const competition=plainObject(safeRead(match,'competition')) || {};
        competitions.set(leagueId,{
          leagueId,
          season:
            seasonValue(safeRead(match,'season'))
            || currentYear,
          name:league || leagueOriginal || 'Турнир',
          shortName:leagueShort || league || leagueOriginal || 'Турнир',
          country,
          category:safeText(safeRead(match,'category'),60),
          tier:safeText(safeRead(competition,'tier'),40) || 'standard',
          logo:safeText(safeRead(match,'leagueLogo'),2048),
          _searchRank:compRank,
        });
      }

      const teamRank=Math.min(
        discoveryMatchRank(safeRead(home,'name'),q),
        discoveryMatchRank(safeRead(away,'name'),q),
      );
      const matchRank=Math.min(
        teamRank,
        discoveryMatchRank(league,q),
        discoveryMatchRank(leagueOriginal,q),
      );
      const fixtureId=positiveId(safeRead(match,'fixtureId'));
      if (matchRank<99 && fixtureId) {
        matches.push({
          ...safeShallowCopy(match),
          fixtureId,
          home:home ? safeShallowCopy(home) : null,
          away:away ? safeShallowCopy(away) : null,
          _searchRank:matchRank,
        });
      }
    }

    const teamRows=[...teams.values()].sort((a,b)=>
      a._searchRank-b._searchRank
      || a.name.localeCompare(b.name,'ru')
    );
    const compRows=[...competitions.values()].sort((a,b)=>
      a._searchRank-b._searchRank
      || Number(b.tier==='top')-Number(a.tier==='top')
      || a.shortName.localeCompare(b.shortName,'ru')
    );
    matches.sort((a,b)=>{
      const rankDelta=a._searchRank-b._searchRank;
      if (rankDelta) return rankDelta;
      const liveDelta=Number(safeRead(b,'live')===true)
        -Number(safeRead(a,'live')===true);
      if (liveDelta) return liveDelta;
      const aDate=strictInstantMs(safeText(safeRead(a,'date'),80));
      const bDate=strictInstantMs(safeText(safeRead(b,'date'),80));
      return (aDate ?? Number.POSITIVE_INFINITY)
        -(bDate ?? Number.POSITIVE_INFINITY);
    });

    return {
      teams:teamRows.slice(0,10),
      competitions:compRows.slice(0,8),
      matches:matches.slice(0,20),
    };
  }

  function setGlobalSearchMode(mode) {
    const normalized=safeText(mode,30);
    globalSearch.mode=SEARCH_MODES.includes(normalized)
      ? normalized
      : 'all';

    for (const btn of safeElements(selectAll,'[data-search-mode]')) {
      const dataset=plainObject(safeRead(btn,'dataset')) || {};
      const active=safeRead(dataset,'searchMode')===globalSearch.mode;
      const classList=safeRead(btn,'classList');
      const toggle=safeRead(classList,'toggle');
      if (typeof toggle==='function') {
        safeCall(toggle.bind(classList),'active',active);
      }
      const setAttribute=safeRead(btn,'setAttribute');
      if (typeof setAttribute==='function') {
        safeCall(
          setAttribute.bind(btn),
          'aria-pressed',
          active ? 'true' : 'false',
        );
      }
    }
    safeRender();
  }

  function resetRemoteSearchState(query) {
    Object.assign(globalSearch,{
      query,
      warning:'',
      resolvedQuery:'',
      remoteTeams:[],
      knownTeams:[],
      remoteCompetitions:[],
      remoteMatches:[],
      matchSourceTeam:'',
      matchDiscovery:null,
      primaryFixtureId:null,
      searchedAt:null,
    });
  }

  async function runGlobalSearch(runOptions={}) {
    const manual=safeRead(plainObject(runOptions),'manual')===true;
    const input=safeCall(elementById,'globalSearchInput');
    const query=safeText(safeRead(input,'value'),240);
    const seq=nextRequestSeq();
    resetRemoteSearchState(query);

    const searchEnabled=safeCall(runtimeAllows,'searchEnabled')===true;
    if (query.length<2 || !searchEnabled) {
      Object.assign(globalSearch,{
        loading:false,
        status:query.length<2 ? 'idle' : 'done',
      });
      if (!searchEnabled && query.length>=2) {
        globalSearch.warning=
          'Удалённый поиск временно недоступен. Уже загруженные матчи остаются доступны.';
      }
      safeRender();
      return;
    }

    const local=localDiscoveryResults(query);
    const localCount=
      local.teams.length
      +local.competitions.length
      +local.matches.length;

    safeCall(productAction,'search_used','searchView');
    const timingValue=safeCall(performanceNow);
    const timingStartedAt=
      typeof timingValue==='number' && Number.isFinite(timingValue)
        ? timingValue
        : Date.now();

    globalSearch.loading=true;
    globalSearch.status=localCount ? 'refreshing' : 'searching';
    safeRender();

    try {
      const response=await api(
        '/api/search?q='+encodeURIComponent(query),
        {timeoutMs:6500,retry:false},
      );

      if (
        seq!==currentRequestSeq()
        || query!==currentQuery()
      ) return;

      const data=plainObject(response) || {};
      const matchSource=plainObject(safeRead(data,'matchSource')) || {};
      const matchDiscovery=
        plainObject(safeRead(data,'matchDiscovery')) || null;
      const primaryFixtureId=
        positiveId(safeRead(data,'primaryFixtureId'))
        || positiveId(safeRead(matchDiscovery,'primaryFixtureId'))
        || null;
      const warning=safeText(
        safeRead(data,'warning') || safeRead(data,'hint'),
        280,
      );

      Object.assign(globalSearch,{
        remoteTeams:entityRows(safeRead(data,'teams'),'id'),
        knownTeams:knownTeamRows(safeRead(data,'knownTeams')),
        remoteCompetitions:entityRows(
          safeRead(data,'competitions'),
          'leagueId',
        ),
        resolvedQuery:safeText(safeRead(data,'resolvedQuery'),240),
        remoteMatches:entityRows(
          safeRead(data,'matches'),
          'fixtureId',
        ),
        matchSourceTeam:safeText(safeRead(matchSource,'name'),160),
        matchDiscovery:matchDiscovery
          ? safeShallowCopy(matchDiscovery)
          : null,
        primaryFixtureId,
        warning,
        searchedAt:
          strictInstantMs(safeText(safeRead(data,'refreshedAt'),80))!==null
            ? safeText(safeRead(data,'refreshedAt'),80)
            : safeNow(),
      });

      const merged=localDiscoveryResults(query);
      const totalMatches=mergeById(
        globalSearch.remoteMatches,
        merged.matches,
        'fixtureId',
      ).length;
      const totalEntities=
        mergeById(
          merged.teams,
          globalSearch.remoteTeams,
          'id',
        ).length
        +mergeById(
          merged.competitions,
          globalSearch.remoteCompetitions,
          'leagueId',
        ).length
        +globalSearch.knownTeams.length;

      globalSearch.status=totalMatches
        ? 'found'
        : totalEntities
          ? 'done'
          : 'empty';

      safeCall(
        productAction,
        totalMatches || totalEntities
          ? 'search_found'
          : 'search_empty',
        'searchView',
      );
      safeCall(
        operationTiming,
        'search',
        timingStartedAt,
        'searchView',
      );

      const provider=plainObject(safeRead(data,'provider'));
      if (
        safeCall(adminCheck)===true
        && provider
        && safeRead(provider,'visibility')==='admin'
      ) {
        state.provider=safeShallowCopy(provider);
        safeCall(providerRender);
      }
    } catch (error) {
      if (seq!==currentRequestSeq()) return;
      const categoryValue=safeCall(errorCategory,error);
      const category=typeof categoryValue==='string'
        ? categoryValue
        : 'error';
      globalSearch.status=category==='timeout' ? 'timeout' : 'error';

      if (category==='timeout') {
        globalSearch.warning='Источник отвечает слишком долго.';
      } else {
        const friendly=safeCall(friendlyError,error);
        globalSearch.warning=safeText(friendly,280)
          || 'Не удалось обновить поиск.';
      }

      safeCall(actionError,'search',error,'searchView');
      if (manual && category!=='timeout') {
        safeCall(showToast,globalSearch.warning);
      }
    } finally {
      if (seq===currentRequestSeq()) {
        globalSearch.loading=false;
        safeRender();
      }
    }
  }

  function cancelSearchTimer() {
    if (searchTimer===null) return;
    safeCall(clearTimer,searchTimer);
    searchTimer=null;
  }

  function handleSearchInput(event) {
    cancelSearchTimer();
    nextRequestSeq();

    const target=plainObject(safeRead(event,'target'));
    const query=safeText(safeRead(target,'value'),240);
    resetRemoteSearchState(query);
    globalSearch.loading=false;
    globalSearch.status=query.length>=2 ? 'local' : 'idle';
    safeRender();

    if (query.length>=3) {
      const handle=safeCall(
        setTimer,
        ()=>{
          searchTimer=null;
          void runGlobalSearch();
        },
        500,
      );
      searchTimer=handle===undefined ? null : handle;
    }
  }

  function addListener(element,type,handler) {
    const addEventListener=safeRead(element,'addEventListener');
    if (typeof addEventListener!=='function') return;
    safeCall(addEventListener.bind(element),type,handler);
  }

  function bindGlobalSearchControls() {
    if (controlsBound) return;
    controlsBound=true;

    const button=safeCall(elementById,'globalSearchBtn');
    const input=safeCall(elementById,'globalSearchInput');

    addListener(button,'click',()=>{
      cancelSearchTimer();
      void runGlobalSearch({manual:true});
    });
    addListener(input,'input',handleSearchInput);
    addListener(input,'keydown',event=>{
      if (safeRead(event,'key')!=='Enter') return;
      const preventDefault=safeRead(event,'preventDefault');
      if (typeof preventDefault==='function') {
        safeCall(preventDefault.bind(event));
      }
      cancelSearchTimer();
      void runGlobalSearch({manual:true});
    });

    for (const btn of safeElements(selectAll,'[data-search-mode]')) {
      addListener(btn,'click',()=>{
        const dataset=plainObject(safeRead(btn,'dataset')) || {};
        setGlobalSearchMode(safeRead(dataset,'searchMode'));
      });
    }
  }

  return Object.freeze({
    localDiscoveryResults,
    mergeById,
    runGlobalSearch,
    setGlobalSearchMode,
    bindGlobalSearchControls,
  });
}
